import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { Op } from 'sequelize';
import { sequelize } from '../db/sequelize.js';
import { allPermissions } from '../db/init.js';
import { requirePermission } from '../middleware/auth.js';
import { clearAppPlanCache, loadAppPlan, parseAppPlan, requirePlanFeature, assertPlanLock, registerPlanLock, changePlanLock } from '../utils/appPlans.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import { writeAudit } from '../utils/audit.js';
import {
  Branch, Cashbox, CashboxBalance, Currency, Customer, CustomerBalance, CustomerLedger,
  CustomerAccountEntry, CustomerMessage, ExchangeRate, Expense, Transaction, Remittance,
  User, AuditLog, SystemSetting, JournalEntry, WhatsappMessage, CardReaderEntry,
} from '../models/index.js';
import { emitChange, pageInfo, paginationResult, searchWhere } from './common.js';
import {
  createCustomerLedgerEntry,
  replaceCustomerOpeningBalances,
  customerHasOnlyOpeningLedger,
  buildCustomerLedgerStatement,
  deleteCustomerLedgerEntry,
  addCashboxOpeningBalance,
  convertCustomerBalance,
  transferCashboxBalance,
  transferCustomerBetweenCustomers,
  deleteAccountTransfer,
  updateAccountTransfer,
} from '../services/accounting.js';
import {
  assertBranchAccess,
  assertCashboxAccess,
  assertSuperAdmin,
  branchSelfWhere,
  branchWhere,
  isSuperAdmin,
  ratesWhere,
  sanitizeStaffPayload,
} from '../utils/branchScope.js';
import { buildCustomerViewUrl } from '../utils/publicUrl.js';
import { avatarUpload, publicAvatarUrl, avatarsDir } from '../middleware/upload.js';
import { buildRateToAfnMap, getBaseCurrency, toBase } from '../utils/currencyConvert.js';
import { enqueueWhatsappMessage, normalizeWhatsappPhone, queueNotifyLedgerStatement, customerNotifyPhone } from '../services/whatsapp.js';
import {
  CUSTOMER_LIST_ORDER,
  ensureDefaultCustomer,
  ensureSequentialCustomerIds,
  GENERAL_CUSTOMER_NAME,
  isGeneralCustomer,
} from '../utils/defaultCustomer.js';
import fs from 'fs';
import path from 'path';

const router = Router();
const empty = z.object({});
const wrap = (body, params = empty, query = z.record(z.string(), z.any()).optional().default({})) => z.object({ body, params, query });
const idParams = z.object({ id: z.coerce.number().int().positive() });
const ledgerEntryParams = z.object({
  id: z.coerce.number().int().positive(),
  entryId: z.coerce.number().int().positive(),
});
const DELETABLE_LEDGER_TYPES = new Set(['opening', 'received', 'paid']);
const optionalText = (max = 255) => z.string().trim().max(max).optional().nullable().transform((v) => v || null);

function newViewToken() {
  return randomBytes(24).toString('hex');
}

async function ensureCustomerViewToken(customer, { force = false } = {}) {
  if (!force && customer.viewToken) return customer.viewToken;
  let token = newViewToken();
  for (let i = 0; i < 5; i += 1) {
    const exists = await Customer.findOne({ where: { viewToken: token } });
    if (!exists) break;
    token = newViewToken();
  }
  await customer.update({ viewToken: token });
  return token;
}

router.get('/lookups', asyncHandler(async (req, res) => {
  const branchFilter = branchSelfWhere(req.user);
  const cashboxFilter = branchWhere(req.user);
  const [branches, cashboxes, currencies, customers, rateSetting] = await Promise.all([
    Branch.findAll({ where: { isActive: true, ...branchFilter }, order: [['name', 'ASC']] }),
    Cashbox.findAll({
      where: { isActive: true, ...cashboxFilter },
      include: ['branch', { association: 'balances', include: ['currency'] }],
      order: [['name', 'ASC']],
    }),
    Currency.findAll({ where: { isActive: true }, order: [['isBase', 'DESC'], ['code', 'ASC']] }),
    // Newest customers first so walk-ins / no-account people appear at the top of selects
    Customer.findAll({ where: { state: { [Op.ne]: 'غیرفعال' } }, order: CUSTOMER_LIST_ORDER, limit: 2000 }),
    SystemSetting.findOne({ where: { settingKey: 'trade_show_rate_field' }, attributes: ['settingValue'] }),
  ]);
  const tradeShowRateField = (rateSetting?.settingValue ?? 'خاموش') === 'روشن';
  res.json({ success: true, data: { branches, cashboxes, currencies, customers, tradeShowRateField } });
}));

const customerFields = {
  name: z.string().trim().min(2).max(120), fatherName: optionalText(120),
  phone: z.string().trim().max(30).optional().nullable().transform((v) => {
    const t = String(v || '').trim();
    return t || 'بدون‌شماره';
  }),
  whatsappPhone: z.string().trim().max(30).optional().nullable().transform((v) => {
    const t = String(v || '').trim();
    return t || null;
  }),
  address: optionalText(255), documentType: optionalText(80), documentNumber: optionalText(80),
  trustLevel: z.string().trim().min(1).max(50).default('عادی'), state: z.string().trim().min(1).max(50).default('تأیید شده'),
};
const customerBody = z.object(customerFields);
const openingBalanceRow = z.object({
  currencyId: z.coerce.number().int().positive(),
  amount: z.coerce.number().positive(),
  side: z.enum(['creditor', 'debtor']).default('creditor'),
});
function refineOpeningBalances(data, ctx) {
  const legacyAmount = Number(data.openingAmount || 0);
  if (legacyAmount > 0 && !data.openingCurrencyId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'برای موجودی اول دوره، ارز را انتخاب کنید.', path: ['openingCurrencyId'] });
  }
  const rows = data.openingBalances?.length
    ? data.openingBalances
    : (legacyAmount > 0 && data.openingCurrencyId
      ? [{ currencyId: data.openingCurrencyId, amount: legacyAmount, side: data.openingSide || 'creditor' }]
      : []);
  const seen = new Set();
  for (const row of rows) {
    if (seen.has(row.currencyId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'هر ارز فقط یک‌بار برای موجودی اول دوره ثبت می‌شود.', path: ['openingBalances'] });
      break;
    }
    seen.add(row.currencyId);
  }
}
const customerCreateBody = z.object({
  ...customerFields,
  whatsappPhone: z.string().trim().min(8, 'شماره واتساپ اجباری است.').max(30),
  openingCurrencyId: z.coerce.number().int().positive().optional().nullable(),
  openingAmount: z.coerce.number().nonnegative().optional().nullable().default(0),
  openingSide: z.enum(['creditor', 'debtor']).optional().default('creditor'),
  openingBalances: z.array(openingBalanceRow).optional().default([]),
}).superRefine(refineOpeningBalances);
const customerUpdateBody = z.object({
  ...customerFields,
  openingBalances: z.array(openingBalanceRow).optional(),
}).superRefine((data, ctx) => {
  if (data.openingBalances == null) return;
  refineOpeningBalances(data, ctx);
});
router.get('/customers', requirePermission('customers'), asyncHandler(async (req, res) => {
  await ensureDefaultCustomer();
  const source = String(req.query.source || '').trim();
  const where = {
    ...searchWhere(req.query.search, ['name', 'fatherName', 'phone', 'whatsappPhone', 'documentNumber', 'address']),
  };
  if (source === 'manual' || source === 'card_reader') {
    where.source = source;
  }

  // Single-page list: return every matching customer (no multi-page split)
  const wantAll = String(req.query.all || '') === '1'
    || String(req.query.limit || '').toLowerCase() === 'all'
    || Number(req.query.limit) >= 5000;
  if (wantAll) {
    const rows = await Customer.findAll({
      where,
      order: CUSTOMER_LIST_ORDER,
      limit: 50000,
    });
    return res.json({
      success: true,
      data: {
        rows,
        pagination: {
          page: 1,
          limit: rows.length,
          total: rows.length,
          pages: 1,
        },
      },
    });
  }

  const { page, limit, offset } = pageInfo(req.query);
  const result = await Customer.findAndCountAll({
    where,
    order: CUSTOMER_LIST_ORDER,
    limit,
    offset,
  });
  res.json({ success: true, data: paginationResult(result, page, limit) });
}));
router.post('/customers', requirePermission('customers'), validate(wrap(customerCreateBody)), asyncHandler(async (req, res) => {
  const {
    openingCurrencyId,
    openingAmount,
    openingSide,
    openingBalances,
    ...customerData
  } = req.validated.body;
  const row = await Customer.create({ ...customerData, source: 'manual', viewToken: newViewToken() });
  const rows = openingBalances?.length
    ? openingBalances
    : (Number(openingAmount || 0) > 0 && openingCurrencyId
      ? [{ currencyId: openingCurrencyId, amount: Number(openingAmount), side: openingSide || 'creditor' }]
      : []);
  for (const entry of rows) {
    const sideNote = entry.side === 'debtor' ? 'قرضدار' : 'طلبکار';
    await createCustomerLedgerEntry(row.id, {
      type: 'opening',
      currencyId: entry.currencyId,
      amount: entry.amount,
      note: `موجودی اول دوره (${sideNote})`,
      side: entry.side,
    }, { req, user: req.user });
  }
  await writeAudit({ req, user: req.user, action: `مشتری نو ثبت شد: ${row.name}` }); emitChange(req, 'customers:changed', { id: row.id });
  emitChange(req, 'accounts:changed', { customerId: row.id });
  if (rows.length) emitChange(req, 'balances:changed');
  const viewPath = `/c/${row.viewToken}`;
  const viewUrl = await buildCustomerViewUrl(viewPath);
  res.status(201).json({
    success: true,
    data: row,
    viewPath,
    viewUrl,
    message: 'مشتری نو ثبت شد.',
  });
}));
router.get('/customers/:id/portal-link', requirePermission('customers'), requirePlanFeature('customerPortal'), validate(wrap(empty, idParams)), asyncHandler(async (req, res) => {
  const row = await Customer.findByPk(req.validated.params.id);
  if (!row) throw new AppError('مشتری پیدا نشد.', 404);
  const token = await ensureCustomerViewToken(row);
  const viewPath = `/c/${token}`;
  const viewUrl = await buildCustomerViewUrl(viewPath);
  res.json({ success: true, data: { token, viewPath, viewUrl } });
}));
router.post('/customers/:id/portal-link/refresh', requirePermission('customers'), requirePlanFeature('customerPortal'), validate(wrap(empty, idParams)), asyncHandler(async (req, res) => {
  const row = await Customer.findByPk(req.validated.params.id);
  if (!row) throw new AppError('مشتری پیدا نشد.', 404);
  const token = await ensureCustomerViewToken(row, { force: true });
  await writeAudit({ req, user: req.user, action: `لینک مشاهده حساب مشتری تازه شد: ${row.name}` });
  const viewPath = `/c/${token}`;
  const viewUrl = await buildCustomerViewUrl(viewPath);
  res.json({ success: true, data: { token, viewPath, viewUrl }, message: 'لینک جدید ساخته شد.' });
}));
router.put('/customers/:id', requirePermission('customers'), validate(wrap(customerUpdateBody, idParams)), asyncHandler(async (req, res) => {
  const row = await Customer.findByPk(req.validated.params.id); if (!row) throw new AppError('مشتری پیدا نشد.',404);
  const {
    openingBalances,
    ...customerFieldsOnly
  } = req.validated.body;
  const body = { ...customerFieldsOnly };
  delete body.source;
  if (isGeneralCustomer(row)) {
    body.name = GENERAL_CUSTOMER_NAME;
    body.isSystem = true;
    body.state = body.state || 'تأیید شده';
  } else {
    delete body.isSystem;
  }
  await row.update(body);

  if (openingBalances !== undefined) {
    await replaceCustomerOpeningBalances(row.id, openingBalances, { req, user: req.user });
    emitChange(req, 'accounts:changed', { customerId: row.id });
    emitChange(req, 'balances:changed');
  }

  await writeAudit({ req, user: req.user, action: `معلومات مشتری اصلاح شد: ${row.name}` });
  emitChange(req, 'customers:changed', { id: row.id });
  res.json({ success: true, data: row, message: 'معلومات مشتری اصلاح شد.' });
}));
router.delete('/customers/:id', requirePermission('customers'), validate(wrap(empty, idParams)), asyncHandler(async (req, res) => {
  const row = await Customer.findByPk(req.validated.params.id); if (!row) throw new AppError('مشتری پیدا نشد.',404);
  if (isGeneralCustomer(row)) {
    throw new AppError('مشتری عمومی پیش‌فرض است و حذف نمی‌شود.', 409);
  }
  const [transactions, remittances, cardReader, onlyOpening] = await Promise.all([
    Transaction.count({ where: { customerId: row.id } }),
    Remittance.count({ where: { senderId: row.id } }),
    CardReaderEntry.count({ where: { customerId: row.id } }),
    customerHasOnlyOpeningLedger(row.id),
  ]);
  if (transactions || remittances || cardReader || !onlyOpening) {
    throw new AppError('این مشتری گردش مالی دارد و حذف آن مجاز نیست؛ حالت مشتری را غیرفعال کنید.', 409);
  }

  const openingEntries = await CustomerLedger.findAll({
    where: { customerId: row.id, type: 'opening' },
    attributes: ['id'],
  });
  for (const entry of openingEntries) {
    await deleteCustomerLedgerEntry(entry.id, { req, user: req.user });
  }
  await Promise.all([
    CustomerBalance.destroy({ where: { customerId: row.id } }),
    CustomerAccountEntry.destroy({ where: { customerId: row.id } }),
    CustomerMessage.destroy({ where: { customerId: row.id } }),
    WhatsappMessage.destroy({ where: { customerId: row.id } }),
  ]);

  await row.destroy();
  await writeAudit({ req, user: req.user, action: `مشتری حذف شد: ${row.name}` });
  emitChange(req, 'customers:changed', { id: row.id });
  emitChange(req, 'accounts:changed', { customerId: row.id });
  emitChange(req, 'balances:changed');
  await ensureSequentialCustomerIds();
  res.json({ success: true, message: 'مشتری حذف شد.' });
}));

router.post(
  '/customers/:id/avatar',
  requirePermission('customers'),
  validate(wrap(empty, idParams)),
  (req, res, next) => {
    avatarUpload.single('avatar')(req, res, (err) => {
      if (err) {
        if (err instanceof AppError) return next(err);
        if (err?.code === 'LIMIT_FILE_SIZE') {
          return next(new AppError('حجم عکس حداکثر ۲ مگابایت باشد.', 400));
        }
        return next(new AppError(err.message || 'آپلود عکس ناموفق بود.', 400));
      }
      return next();
    });
  },
  asyncHandler(async (req, res) => {
    const row = await Customer.findByPk(req.validated.params.id);
    if (!row) throw new AppError('مشتری پیدا نشد.', 404);
    if (!req.file) throw new AppError('فایل عکس انتخاب نشده است.', 400);
    const previous = row.avatarUrl;
    const nextUrl = publicAvatarUrl(req.file.filename);
    await row.update({ avatarUrl: nextUrl });
    if (previous && previous.startsWith('/uploads/avatars/')) {
      const oldPath = path.join(avatarsDir, path.basename(previous));
      fs.promises.unlink(oldPath).catch(() => {});
    }
    await writeAudit({ req, user: req.user, action: `عکس مشتری به‌روز شد: ${row.name}` });
    emitChange(req, 'customers:changed', { id: row.id });
    res.json({ success: true, data: row });
  }),
);

router.delete(
  '/customers/:id/avatar',
  requirePermission('customers'),
  validate(wrap(empty, idParams)),
  asyncHandler(async (req, res) => {
    const row = await Customer.findByPk(req.validated.params.id);
    if (!row) throw new AppError('مشتری پیدا نشد.', 404);
    const previous = row.avatarUrl;
    await row.update({ avatarUrl: null });
    if (previous && previous.startsWith('/uploads/avatars/')) {
      const oldPath = path.join(avatarsDir, path.basename(previous));
      fs.promises.unlink(oldPath).catch(() => {});
    }
    emitChange(req, 'customers:changed', { id: row.id });
    res.json({ success: true, data: row });
  }),
);

router.get('/customers/:id/ledger', requirePermission('accounts'), validate(wrap(empty, idParams)), asyncHandler(async (req, res) => {
  const data = await buildCustomerLedgerStatement(req.validated.params.id);
  res.json({ success: true, data });
}));
router.post('/customers/:id/ledger/whatsapp', requirePermission('accounts'), requirePlanFeature('whatsapp'), validate(wrap(empty, idParams)), asyncHandler(async (req, res) => {
  const statement = await buildCustomerLedgerStatement(req.validated.params.id);
  const phone = customerNotifyPhone(statement.customer);
  if (!phone) {
    throw new AppError('شماره واتساپ این مشتری ثبت نشده است.', 400);
  }
  const lang = req.headers['x-language'] || req.query?.lang || req.body?.language;
  const whatsapp = await queueNotifyLedgerStatement(statement, lang);
  if (!whatsapp) {
    throw new AppError('ارسال واتساپ فعال نیست یا شماره معتبر نیست. تنظیمات واتساپ را بررسی کنید.', 400);
  }
  res.json({
    success: true,
    data: {
      whatsapp,
      phone: whatsapp.phone,
      entryCount: statement.entries?.length || 0,
    },
    message: 'متن گردش حساب برای واتساپ آماده شد.',
  });
}));
router.get('/customers/:id/opening-balances', requirePermission('customers'), validate(wrap(empty, idParams)), asyncHandler(async (req, res) => {
  const customer = await Customer.findByPk(req.validated.params.id);
  if (!customer) throw new AppError('مشتری پیدا نشد.', 404);
  const [entries, balances] = await Promise.all([
    CustomerLedger.findAll({
      where: { customerId: customer.id },
      include: ['currency'],
      order: [['id', 'ASC']],
    }),
    CustomerBalance.findAll({
      where: { customerId: customer.id },
      include: ['currency'],
      order: [['currencyId', 'ASC']],
    }),
  ]);
  const openings = entries.filter((e) => e.type === 'opening');
  const editable = entries.every((e) => e.type === 'opening');
  res.json({
    success: true,
    data: {
      editable,
      openings,
      balances,
    },
  });
}));
const convertBalanceBody = z.object({
  fromCurrencyId: z.coerce.number().int().positive(),
  toCurrencyId: z.coerce.number().int().positive(),
  fromAmount: z.coerce.number().positive(),
  rate: z.coerce.number().positive(),
  fee: z.coerce.number().min(0).default(0),
  note: optionalText(500),
});
router.post('/customers/:id/convert-balance', requirePermission('exchange'), validate(wrap(convertBalanceBody, idParams)), asyncHandler(async (req, res) => {
  const data = await convertCustomerBalance(req.validated.params.id, req.validated.body, { req, user: req.user });
  emitChange(req, 'accounts:changed', { customerId: req.validated.params.id });
  res.status(201).json({
    success: true,
    data,
    message: `موجودی حساب تبدیل شد. نمبر سند: ${data.number}`,
  });
}));
const customerTransferBody = z.object({
  direction: z.enum(['person_to_person', 'person_to_cashbox', 'cashbox_to_person']),
  fromCustomerId: z.coerce.number().int().positive().optional().nullable(),
  toCustomerId: z.coerce.number().int().positive().optional().nullable(),
  cashboxId: z.coerce.number().int().positive().optional().nullable(),
  currencyId: z.coerce.number().int().positive(),
  amount: z.coerce.number().positive(),
  fee: z.coerce.number().min(0).default(0),
  feeCurrencyId: z.coerce.number().int().positive().optional().nullable(),
  note: optionalText(500),
}).superRefine((data, ctx) => {
  if (data.direction === 'person_to_person') {
    if (!data.fromCustomerId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'فرستنده را انتخاب کنید.', path: ['fromCustomerId'] });
    }
    if (!data.toCustomerId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'گیرنده را انتخاب کنید.', path: ['toCustomerId'] });
    }
    if (data.fromCustomerId && data.toCustomerId && data.fromCustomerId === data.toCustomerId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'فرستنده و گیرنده نباید یکسان باشند.', path: ['toCustomerId'] });
    }
  }
  if (data.direction === 'person_to_cashbox') {
    if (!data.fromCustomerId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'فرستنده را انتخاب کنید.', path: ['fromCustomerId'] });
    }
    if (!data.cashboxId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'صندوق را انتخاب کنید.', path: ['cashboxId'] });
    }
  }
  if (data.direction === 'cashbox_to_person') {
    if (!data.toCustomerId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'گیرنده را انتخاب کنید.', path: ['toCustomerId'] });
    }
    if (!data.cashboxId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'صندوق را انتخاب کنید.', path: ['cashboxId'] });
    }
  }
});
router.post('/customer-transfers', requirePermission('remittances'), validate(wrap(customerTransferBody)), asyncHandler(async (req, res) => {
  const body = req.validated.body;
  let data;
  if (body.direction === 'person_to_person') {
    data = await transferCustomerBetweenCustomers({
      fromCustomerId: body.fromCustomerId,
      toCustomerId: body.toCustomerId,
      currencyId: body.currencyId,
      amount: body.amount,
      fee: body.fee,
      feeCurrencyId: body.feeCurrencyId || body.currencyId,
      note: body.note,
    }, { req, user: req.user });
  } else if (body.direction === 'person_to_cashbox') {
    await assertCashboxAccess(req.user, body.cashboxId, Cashbox);
    data = await createCustomerLedgerEntry(body.fromCustomerId, {
      type: 'received',
      cashboxId: body.cashboxId,
      currencyId: body.currencyId,
      amount: body.amount,
      note: body.note || 'انتقال از مشتری به صندوق',
    }, { req, user: req.user });
  } else {
    await assertCashboxAccess(req.user, body.cashboxId, Cashbox);
    data = await createCustomerLedgerEntry(body.toCustomerId, {
      type: 'paid',
      cashboxId: body.cashboxId,
      currencyId: body.currencyId,
      amount: body.amount,
      note: body.note || 'انتقال از صندوق به مشتری',
    }, { req, user: req.user });
  }
  emitChange(req, 'accounts:changed');
  emitChange(req, 'balances:changed');
  emitChange(req, 'cashboxes:changed');
  emitChange(req, 'remittances:changed');
  res.status(201).json({
    success: true,
    data,
    message: body.direction === 'person_to_person'
      ? `انتقال حساب ثبت شد. نمبر سند: ${data.number}`
      : 'انتقال ثبت شد.',
  });
}));

const transferIdParams = z.object({ id: z.coerce.number().int().positive() });

router.put('/customer-transfers/:id', requirePermission('remittances'), validate(wrap(customerTransferBody, transferIdParams)), asyncHandler(async (req, res) => {
  const body = req.validated.body;
  if (body.direction !== 'person_to_person' && body.cashboxId) {
    await assertCashboxAccess(req.user, body.cashboxId, Cashbox);
  }
  const data = await updateAccountTransfer(req.validated.params.id, body, { req, user: req.user });
  emitChange(req, 'accounts:changed');
  emitChange(req, 'balances:changed');
  emitChange(req, 'cashboxes:changed');
  emitChange(req, 'remittances:changed');
  res.json({
    success: true,
    data,
    message: 'حواله اصلاح شد.',
  });
}));

router.delete('/customer-transfers/:id', requirePermission('remittances'), validate(wrap(z.object({}), transferIdParams)), asyncHandler(async (req, res) => {
  const data = await deleteAccountTransfer(req.validated.params.id, { req, user: req.user });
  emitChange(req, 'accounts:changed');
  emitChange(req, 'balances:changed');
  emitChange(req, 'cashboxes:changed');
  emitChange(req, 'remittances:changed');
  res.json({
    success: true,
    data,
    message: 'حواله حذف شد.',
  });
}));

router.get('/customers-with-balances', requirePermission('exchange'), asyncHandler(async (_req, res) => {
  const balances = await CustomerBalance.findAll({
    where: { amount: { [Op.ne]: 0 } },
    include: [
      { association: 'customer', required: true },
      { association: 'currency', required: true },
    ],
    order: [['customerId', 'ASC'], ['currencyId', 'ASC']],
  });
  const map = new Map();
  for (const row of balances) {
    const customer = row.customer;
    if (!customer) continue;
    if (!map.has(customer.id)) {
      map.set(customer.id, {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        fatherName: customer.fatherName,
        balances: [],
      });
    }
    map.get(customer.id).balances.push({
      id: row.id,
      currencyId: row.currencyId,
      amount: row.amount,
      currency: row.currency,
    });
  }
  res.json({ success: true, data: [...map.values()] });
}));
const ledgerBody = z.object({
  cashboxId: z.coerce.number().int().positive().optional().nullable(),
  currencyId: z.coerce.number().int().positive(),
  type: z.enum(['opening', 'received', 'paid']),
  amount: z.coerce.number().positive(),
  note: optionalText(500),
  side: z.enum(['creditor', 'debtor']).optional().default('creditor'),
  settleFromCurrencyId: z.coerce.number().int().positive().optional().nullable(),
  rate: z.coerce.number().positive().optional().nullable(),
  fee: z.coerce.number().min(0).optional().default(0),
}).superRefine((data, ctx) => {
  if (data.type !== 'opening' && !data.cashboxId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'برای رسید یا پرداخت، انتخاب صندوق ضروری است.',
      path: ['cashboxId'],
    });
  }
  if (
    data.type === 'paid'
    && data.settleFromCurrencyId
    && Number(data.settleFromCurrencyId) !== Number(data.currencyId)
    && !(data.rate > 0)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'برای کسر از حساب ارز دیگر، نرخ را وارد کنید.',
      path: ['rate'],
    });
  }
});
router.post('/customers/:id/ledger', requirePermission('accounts'), validate(wrap(ledgerBody, idParams)), asyncHandler(async (req, res) => {
  const row = await createCustomerLedgerEntry(req.validated.params.id, req.validated.body, { req, user: req.user });
  emitChange(req, 'accounts:changed', { customerId: req.validated.params.id });
  emitChange(req, 'balances:changed');
  res.status(201).json({ success: true, data: row, message: 'رسید / برد مشتری ثبت شد.' });
}));
router.delete('/customers/:id/ledger/:entryId', requirePermission('accounts'), validate(wrap(empty, ledgerEntryParams)), asyncHandler(async (req, res) => {
  const customerId = req.validated.params.id;
  const entry = await CustomerLedger.findByPk(req.validated.params.entryId);
  if (!entry || Number(entry.customerId) !== customerId) {
    throw new AppError('رکورد حساب پیدا نشد.', 404);
  }
  if (!DELETABLE_LEDGER_TYPES.has(entry.type)) {
    throw new AppError('این نوع سند از دفتر حساب حذف نمی‌شود؛ از بخش مربوطه آن را لغو کنید.', 409);
  }
  await deleteCustomerLedgerEntry(entry.id, { req, user: req.user });
  emitChange(req, 'accounts:changed', { customerId });
  emitChange(req, 'balances:changed');
  res.json({ success: true, message: 'سند حساب حذف و در صورت نیاز از صندوق برگشت داده شد.' });
}));
async function buildCustomerAccountsData(query = {}) {
  const search = String(query.search || '');
  const side = String(query.side || '').toLowerCase(); // debtor | creditor | ''
  const source = String(query.source || '').trim(); // manual | card_reader | ''
  const where = {
    ...searchWhere(search, ['name', 'fatherName', 'phone', 'documentNumber', 'address']),
  };
  if (source === 'manual' || source === 'card_reader') {
    where.source = source;
  } else if (side === 'debtor' || side === 'creditor') {
    // Market receivable/payable lists stay separate from card-reader walk-ins.
    where.source = 'manual';
  }
  const [customers, rateMap, baseCurrency] = await Promise.all([
    Customer.findAll({
      where,
      order: CUSTOMER_LIST_ORDER,
    }),
    buildRateToAfnMap(),
    getBaseCurrency(),
  ]);
  const baseCode = baseCurrency.code;
  const customerIds = customers.map((c) => c.id);
  const balances = customerIds.length
    ? await CustomerBalance.findAll({
      where: { customerId: { [Op.in]: customerIds } },
      include: ['currency'],
    })
    : [];
  const balanceMap = new Map();
  for (const b of balances) {
    if (!balanceMap.has(b.customerId)) balanceMap.set(b.customerId, []);
    balanceMap.get(b.customerId).push(b);
  }
  const rows = customers.map((c) => {
    const customerBalances = balanceMap.get(c.id) || [];
    const summary = {};
    const openBalances = [];
    let hasCreditor = false;
    let hasDebtor = false;
    let receivableBase = 0;
    let payableBase = 0;
    for (const b of customerBalances) {
      const code = b.currency?.code || '-';
      const amount = Number(b.amount || 0);
      summary[code] = {
        received: amount > 0 ? amount : 0,
        paid: amount < 0 ? Math.abs(amount) : 0,
        balance: amount,
      };
      // Same sign as ledger / dashboard / CustomerLedgerPage:
      // amount > 0 → طلبکار (creditor) → we owe them → قرض / payable
      // amount < 0 → قرضدار (debtor) → they owe us → طلب / receivable
      if (amount > 0) {
        hasCreditor = true;
        const inBase = toBase(amount, code, rateMap, baseCode);
        payableBase += inBase;
        openBalances.push({
          currencyId: b.currencyId,
          code,
          amount,
          amountBase: inBase,
          side: 'creditor',
          currency: b.currency,
        });
      } else if (amount < 0) {
        hasDebtor = true;
        const inBase = toBase(Math.abs(amount), code, rateMap, baseCode);
        receivableBase += inBase;
        openBalances.push({
          currencyId: b.currencyId,
          code,
          amount,
          amountBase: inBase,
          side: 'debtor',
          currency: b.currency,
        });
      } else if (side === 'debtor' || side === 'creditor') {
        openBalances.push({
          currencyId: b.currencyId,
          code,
          amount: 0,
          amountBase: 0,
          side: 'settled',
          currency: b.currency,
        });
      }
    }
    let accountSide = null;
    if (hasCreditor && hasDebtor) accountSide = 'both';
    else if (hasCreditor) accountSide = 'creditor';
    else if (hasDebtor) accountSide = 'debtor';
    else if (customerBalances.length) accountSide = 'settled';

    return {
      ...c.toJSON(),
      summary,
      openBalances,
      accountSide,
      receivableBase,
      payableBase,
    };
  }).filter((row) => {
    if (side === 'debtor') {
      return row.accountSide === 'debtor'
        || row.accountSide === 'both'
        || row.accountSide === 'settled';
    }
    if (side === 'creditor') {
      return row.accountSide === 'creditor'
        || row.accountSide === 'both'
        || row.accountSide === 'settled';
    }
    return true;
  }).map((row) => {
    if (side !== 'debtor' && side !== 'creditor') return row;
    if (row.accountSide === 'settled') {
      return {
        ...row,
        openBalances: (row.openBalances || []).filter((b) => b.side === 'settled'),
        accountSide: 'settled',
        receivableBase: 0,
        payableBase: 0,
      };
    }
    const filteredOpen = (row.openBalances || []).filter((b) => b.side === side || b.side === 'settled');
    const filteredSummary = {};
    for (const b of filteredOpen) {
      if (row.summary[b.code]) filteredSummary[b.code] = row.summary[b.code];
    }
    return {
      ...row,
      openBalances: filteredOpen,
      summary: filteredSummary,
      accountSide: row.accountSide === 'both' ? side : row.accountSide,
      receivableBase: side === 'debtor' ? row.receivableBase : 0,
      payableBase: side === 'creditor' ? row.payableBase : 0,
    };
  });

  rows.sort((a, b) => {
    const rank = (sideValue) => (sideValue === 'settled' ? 1 : 0);
    return rank(a.accountSide) - rank(b.accountSide) || (b.id - a.id);
  });

  let totalReceivableBase = 0;
  let totalPayableBase = 0;
  const receivableMap = new Map();
  const payableMap = new Map();
  const addByCurrency = (map, balance) => {
    const currency = balance.currency || {};
    const code = balance.code || currency.code || '-';
    const key = String(balance.currencyId || currency.id || code);
    const prev = map.get(key) || {
      currencyId: balance.currencyId || currency.id || null,
      code,
      name: currency.name || code,
      symbol: currency.symbol || '',
      amount: 0,
    };
    prev.amount += Math.abs(Number(balance.amount || 0));
    map.set(key, prev);
  };
  for (const row of rows) {
    totalReceivableBase += Number(row.receivableBase || 0);
    totalPayableBase += Number(row.payableBase || 0);
    for (const b of row.openBalances || []) {
      if (b.side === 'debtor') addByCurrency(receivableMap, b);
      else if (b.side === 'creditor') addByCurrency(payableMap, b);
    }
  }
  const sortByAbsAmount = (list) => list
    .filter((item) => item.amount !== 0)
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

  return {
    rows,
    baseCurrency,
    side,
    source,
    totals: {
      receivableBase: totalReceivableBase,
      payableBase: totalPayableBase,
      unit: baseCode,
      receivableByCurrency: sortByAbsAmount([...receivableMap.values()]),
      payableByCurrency: sortByAbsAmount([...payableMap.values()]),
    },
  };
}

function formatAccountsAmount(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return '0';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n);
}

function buildAccountsWhatsappBody(data, settings = {}) {
  const company = String(settings.company_name || 'PPlus.Arz').trim() || 'PPlus.Arz';
  const title = data.side === 'debtor'
    ? 'لیست طلب بازار'
    : data.side === 'creditor'
      ? 'لیست قرض بازار'
      : data.source === 'card_reader'
        ? 'حساب‌های کارت‌خوان'
        : 'خلاصه حساب‌های مشتریان';
  const dateLabel = new Intl.DateTimeFormat('fa-AF-u-ca-persian-nu-latn', {
    timeZone: 'Asia/Kabul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date());

  const lines = [
    company.startsWith('صرافی') ? company : `صرافی ${company}`,
    title,
    `تاریخ: ${dateLabel}`,
    `تعداد حساب: ${data.rows.length}`,
    '',
  ];

  const receivable = data.totals?.receivableByCurrency || [];
  const payable = data.totals?.payableByCurrency || [];
  if ((!data.side || data.side === 'debtor') && receivable.length) {
    lines.push('جمع طلب:');
    for (const row of receivable) {
      lines.push(`• ${row.code}: ${formatAccountsAmount(row.amount)}`);
    }
    lines.push('');
  }
  if ((!data.side || data.side === 'creditor') && payable.length) {
    lines.push('جمع قرض:');
    for (const row of payable) {
      lines.push(`• ${row.code}: ${formatAccountsAmount(row.amount)}`);
    }
    lines.push('');
  }

  const openRows = data.rows.filter((r) => r.accountSide && r.accountSide !== 'settled');
  const maxRows = 12;
  if (openRows.length) {
    lines.push('جزئیات حساب‌ها:');
    for (const row of openRows.slice(0, maxRows)) {
      const balances = (row.openBalances || [])
        .filter((b) => b.side !== 'settled')
        .map((b) => {
          const sideLabel = b.side === 'creditor' ? 'طلبکار' : 'قرضدار';
          return `${b.code} ${formatAccountsAmount(Math.abs(Number(b.amount || 0)))} (${sideLabel})`;
        })
        .join(' | ');
      lines.push(`- ${row.name}: ${balances || '—'}`);
    }
    if (openRows.length > maxRows) {
      lines.push(`… و ${openRows.length - maxRows} حساب دیگر (در فایل PDF)`);
    }
  }

  lines.push('', 'فایل PDF کامل را از برنامه پیوست کنید.');
  return lines.join('\n').trim();
}

router.get('/customer-accounts', requirePermission('accounts'), asyncHandler(async (req, res) => {
  const data = await buildCustomerAccountsData(req.query);
  res.json({
    success: true,
    data: {
      rows: data.rows,
      baseCurrency: data.baseCurrency,
      totals: data.totals,
    },
  });
}));

router.post('/customer-accounts/whatsapp-report', requirePermission('accounts'), requirePlanFeature('whatsapp'), asyncHandler(async (req, res) => {
  const settingsRows = await SystemSetting.findAll({
    where: { settingKey: ['company_whatsapp', 'company_name', 'whatsapp_default_country_code'] },
  });
  const settings = Object.fromEntries(settingsRows.map((r) => [r.settingKey, r.settingValue]));
  const targetPhone = String(settings.company_whatsapp || '').trim();
  if (!targetPhone) {
    throw new AppError('شماره واتساپ صرافی در تنظیمات ثبت نشده است.', 400);
  }

  const data = await buildCustomerAccountsData(req.body || {});
  const body = buildAccountsWhatsappBody(data, settings);
  const whatsapp = await enqueueWhatsappMessage({
    customerName: settings.company_name || 'صرافی',
    phone: targetPhone,
    eventType: 'accounts_report',
    referenceType: 'accounts_report',
    documentNumber: `ACC-${Date.now()}`,
    body,
  });

  if (!whatsapp) {
    throw new AppError('ارسال واتساپ فعال نیست یا شماره معتبر نیست. تنظیمات واتساپ را بررسی کنید.', 400);
  }

  res.json({
    success: true,
    data: {
      whatsapp,
      phone: normalizeWhatsappPhone(targetPhone, settings.whatsapp_default_country_code || '93'),
      totals: data.totals,
      rowCount: data.rows.length,
    },
  });
}));

const branchBody=z.object({name:z.string().trim().min(2).max(120),city:z.string().trim().min(2).max(120),address:optionalText(255),isActive:z.boolean().default(true)});
router.get('/branches', requirePermission('branches'), asyncHandler(async (req, res) => {
  const rows = await Branch.findAll({
    /* مدیر کل همیشه همه شعبه‌ها را برای مدیریت می‌بیند */
    where: isSuperAdmin(req.user) ? {} : branchSelfWhere(req.user),
    include: [{ association: 'cashboxes' }],
    order: [['id','DESC']],
  });
  res.json({ success: true, data: rows });
}));
router.post('/branches', requirePermission('branches'), validate(wrap(branchBody)), asyncHandler(async (req, res) => {
  assertSuperAdmin(req.user);
  const plan = req.appPlan || await loadAppPlan();
  const count = await Branch.count();
  if (count >= plan.maxBranches) {
    throw new AppError(`این سطح برنامه حداکثر ${plan.maxBranches} شعبه دارد.`, 403, 'PLAN_FORBIDDEN');
  }
  const row = await Branch.create(req.validated.body);
  await writeAudit({ req, user: req.user, action: `شعبه ثبت شد: ${row.name}` });
  emitChange(req, 'branches:changed', { id: row.id });
  res.status(201).json({ success: true, data: row });
}));
router.put('/branches/:id', requirePermission('branches'), validate(wrap(branchBody, idParams)), asyncHandler(async (req, res) => {
  const row = await Branch.findByPk(req.validated.params.id);
  if (!row) throw new AppError('شعبه پیدا نشد.', 404);
  assertBranchAccess(req.user, row.id);
  await row.update(req.validated.body);
  await writeAudit({ req, user: req.user, action: `شعبه اصلاح شد: ${row.name}` });
  emitChange(req, 'branches:changed', { id: row.id });
  res.json({ success: true, data: row });
}));
router.delete('/branches/:id', requirePermission('branches'), validate(wrap(empty, idParams)), asyncHandler(async (req, res) => {
  assertSuperAdmin(req.user);
  const row = await Branch.findByPk(req.validated.params.id);if(!row)throw new AppError('شعبه پیدا نشد.',404);
  if(await Cashbox.count({where:{branchId:row.id}}))throw new AppError('این شعبه صندوق دارد و حذف نمی‌شود.',409);
  if(await Transaction.count({where:{branchId:row.id}}))throw new AppError('این شعبه گردش مالی دارد و حذف نمی‌شود؛ آن را غیرفعال کنید.',409);
  await row.destroy();emitChange(req,'branches:changed',{id:row.id});res.json({success:true});
}));

const cashboxBody=z.object({branchId:z.coerce.number().int().positive(),name:z.string().trim().min(2).max(120),keeperName:optionalText(120),isActive:z.boolean().default(true)});
router.get('/cashboxes', requirePermission('cashboxes'), asyncHandler(async (req, res) => {
  const rows = await Cashbox.findAll({
    where: branchWhere(req.user),
    include: ['branch', { association: 'balances', include: ['currency'] }],
    order: [['id','DESC']],
  });
  res.json({ success: true, data: rows });
}));

router.get('/cashboxes/:id/movements', requirePermission('cashboxes'), validate(wrap(empty, idParams)), asyncHandler(async (req, res) => {
  const box = await Cashbox.findByPk(req.validated.params.id);
  if (!box) throw new AppError('صندوق پیدا نشد.', 404);
  assertBranchAccess(req.user, box.branchId);

  const direction = String(req.query.direction || 'all').toLowerCase();
  const limit = Math.min(400, Math.max(1, Number(req.query.limit) || 200));
  const dateFrom = req.query.dateFrom ? String(req.query.dateFrom) : null;
  const dateTo = req.query.dateTo ? String(req.query.dateTo) : null;

  const movements = [];

  const ledgers = await CustomerLedger.findAll({
    where: {
      cashboxId: box.id,
      type: { [Op.in]: ['received', 'paid'] },
    },
    include: ['customer', 'currency'],
    order: [['id', 'DESC']],
  });
  for (const row of ledgers) {
    const isIn = row.type === 'received';
    const note = row.note || '';
    let source = isIn ? 'receipt' : 'payment';
    if (String(note).includes('کارت‌خوان')) source = isIn ? 'card_deposit' : 'card_withdrawal';
    movements.push({
      id: `ledger-${row.id}`,
      source,
      direction: isIn ? 'in' : 'out',
      number: row.number,
      amount: row.amount,
      currencyId: row.currencyId,
      currencyCode: row.currency?.code || '',
      at: row.createdAt,
      title: row.customer?.name || '—',
      note: note || null,
    });
  }

  const transactions = await Transaction.findAll({
    where: {
      cashboxId: box.id,
      state: { [Op.ne]: 'برگشت داده شد' },
    },
    include: ['customer', 'fromCurrency', 'toCurrency'],
    order: [['id', 'DESC']],
  });
  for (const row of transactions) {
    const kind = String(row.kind || '').toLowerCase();
    const source = kind.includes('خرید') || kind === 'buy' ? 'buy'
      : (kind.includes('فروش') || kind === 'sell' ? 'sell' : 'exchange');
    // پول دریافتی وارد صندوق می‌شود
    movements.push({
      id: `tx-in-${row.id}`,
      source,
      direction: 'in',
      number: row.number,
      amount: row.fromAmount,
      currencyId: row.fromCurrencyId,
      currencyCode: row.fromCurrency?.code || '',
      at: row.createdAt,
      title: row.customer?.name || row.kind,
      note: row.note || `${row.kind}`,
    });
    // پول پرداختی از صندوق خارج می‌شود
    movements.push({
      id: `tx-out-${row.id}`,
      source,
      direction: 'out',
      number: row.number,
      amount: row.toAmount,
      currencyId: row.toCurrencyId,
      currencyCode: row.toCurrency?.code || '',
      at: row.createdAt,
      title: row.customer?.name || row.kind,
      note: row.note || `${row.kind}`,
    });
  }

  // ثبت: خروج از صندوق پرداخت مبدأ
  const remittancesOutFrom = await Remittance.findAll({
    where: {
      sourceCashboxId: box.id,
      cancelledAt: null,
    },
    include: ['sender', 'currency', 'feeCurrency'],
    order: [['id', 'DESC']],
  });
  for (const row of remittancesOutFrom) {
    movements.push({
      id: `rem-out-src-${row.id}`,
      source: 'remittance_out',
      direction: 'out',
      number: row.number,
      amount: row.amount,
      currencyId: row.currencyId,
      currencyCode: row.currency?.code || '',
      at: row.createdAt,
      title: row.sender?.name || row.receiverName,
      note: row.note || `پرداخت حواله به ${row.receiverName}`,
    });
    if (Number(row.fee) > 0) {
      movements.push({
        id: `rem-fee-${row.id}`,
        source: 'remittance_fee',
        direction: 'in',
        number: row.number,
        amount: row.fee,
        currencyId: row.feeCurrencyId || row.currencyId,
        currencyCode: row.feeCurrency?.code || row.currency?.code || '',
        at: row.createdAt,
        title: row.sender?.name || row.receiverName,
        note: 'کمیشن حواله',
      });
    }
  }

  // ثبت: ورود به صندوق دریافت مقصد
  const remittancesIn = await Remittance.findAll({
    where: {
      destinationCashboxId: box.id,
      cancelledAt: null,
    },
    include: ['sender', 'currency'],
    order: [['id', 'DESC']],
  });
  for (const row of remittancesIn) {
    movements.push({
      id: `rem-in-${row.id}`,
      source: 'remittance_in',
      direction: 'in',
      number: row.number,
      amount: row.amount,
      currencyId: row.currencyId,
      currencyCode: row.currency?.code || '',
      at: row.createdAt,
      title: row.sender?.name || row.receiverName,
      note: row.note || `دریافت حواله برای ${row.receiverName}`,
    });
  }

  // پرداخت با رمز: خروج از صندوق دریافت مقصد به گیرنده
  const remittancesPaidOut = await Remittance.findAll({
    where: {
      destinationCashboxId: box.id,
      paidAt: { [Op.ne]: null },
      cancelledAt: null,
    },
    include: ['sender', 'currency'],
    order: [['id', 'DESC']],
  });
  for (const row of remittancesPaidOut) {
    movements.push({
      id: `rem-out-pay-${row.id}`,
      source: 'remittance_out',
      direction: 'out',
      number: row.number,
      amount: row.amount,
      currencyId: row.currencyId,
      currencyCode: row.currency?.code || '',
      at: row.paidAt || row.createdAt,
      title: row.receiverName,
      note: row.note || 'پرداخت حواله به گیرنده',
    });
  }

  const expenses = await Expense.findAll({
    where: {
      cashboxId: box.id,
    },
    include: ['currency'],
    order: [['id', 'DESC']],
  });
  for (const row of expenses) {
    movements.push({
      id: `expense-${row.id}`,
      source: 'expense',
      direction: 'out',
      number: row.number,
      amount: row.amount,
      currencyId: row.currencyId,
      currencyCode: row.currency?.code || '',
      at: row.createdAt,
      title: row.category || 'هزینه',
      note: row.description || row.note || null,
    });
  }

  const nameNeedle = `%${box.name}%`;
  const journals = await JournalEntry.findAll({
    where: {
      [Op.or]: [
        { description: { [Op.like]: nameNeedle } },
        { debitAccount: { [Op.like]: nameNeedle } },
        { creditAccount: { [Op.like]: nameNeedle } },
      ],
    },
    include: ['currency'],
    order: [['id', 'DESC']],
  });
  for (const row of journals) {
    const debit = String(row.debitAccount || '');
    const credit = String(row.creditAccount || '');
    const desc = String(row.description || '');
    const boxTag = `صندوق ${box.name}`;
    const debitIsBox = debit.includes(boxTag) || debit.includes(box.name);
    const creditIsBox = credit.includes(boxTag) || credit.includes(box.name);
    const descIsBox = desc.includes(box.name);
    const isOpening = desc.includes('موجودی اول دوره') || desc.includes('اصلاح موجودی');
    const at = row.createdAt || row.entryDate;

    if (debitIsBox && credit.includes('صندوق') && !isOpening) {
      movements.push({
        id: `xfr-in-${row.id}`,
        source: 'transfer_in',
        direction: 'in',
        number: row.number,
        amount: row.amount,
        currencyId: row.currencyId,
        currencyCode: row.currency?.code || '',
        at,
        title: box.name,
        note: desc,
      });
      continue;
    }
    if (creditIsBox && debit.includes('صندوق') && !isOpening) {
      movements.push({
        id: `xfr-out-${row.id}`,
        source: 'transfer_out',
        direction: 'out',
        number: row.number,
        amount: row.amount,
        currencyId: row.currencyId,
        currencyCode: row.currency?.code || '',
        at,
        title: box.name,
        note: desc,
      });
      continue;
    }

    if (!descIsBox && !debitIsBox && !creditIsBox) continue;

    const cashIn = debitIsBox || (isOpening && debit.startsWith('صندوق'));
    const cashOut = creditIsBox || (isOpening && credit.startsWith('صندوق'));
    if (cashIn && !cashOut) {
      movements.push({
        id: `adj-in-${row.id}`,
        source: 'adjustment_in',
        direction: 'in',
        number: row.number,
        amount: row.amount,
        currencyId: row.currencyId,
        currencyCode: row.currency?.code || '',
        at,
        title: box.name,
        note: desc,
      });
    } else if (cashOut && !cashIn) {
      movements.push({
        id: `adj-out-${row.id}`,
        source: 'adjustment_out',
        direction: 'out',
        number: row.number,
        amount: row.amount,
        currencyId: row.currencyId,
        currencyCode: row.currency?.code || '',
        at,
        title: box.name,
        note: desc,
      });
    }
  }

  const startMs = dateFrom ? new Date(`${dateFrom} 00:00:00`).getTime() : null;
  const endMs = dateTo ? new Date(`${dateTo} 23:59:59`).getTime() : null;
  const inPeriod = (at) => {
    const t = new Date(at).getTime();
    if (!Number.isFinite(t)) return false;
    if (startMs != null && t < startMs) return false;
    if (endMs != null && t > endMs) return false;
    return true;
  };
  const afterPeriod = (at) => {
    if (endMs == null) return false;
    const t = new Date(at).getTime();
    return Number.isFinite(t) && t > endMs;
  };

  const balances = await CashboxBalance.findAll({
    where: { cashboxId: box.id },
    include: ['currency'],
  });
  const summaryMap = new Map();
  const ensureSummary = (currencyId, code, extra = {}) => {
    const key = String(currencyId || code || '-');
    if (!summaryMap.has(key)) {
      summaryMap.set(key, {
        currencyId: currencyId || null,
        code: code || '-',
        name: extra.name || code || '-',
        symbol: extra.symbol || '',
        current: 0,
        opening: 0,
        openingAdj: 0,
        totalIn: 0,
        totalOut: 0,
        remaining: 0,
        netAfterEnd: 0,
      });
    }
    return summaryMap.get(key);
  };
  for (const b of balances) {
    const row = ensureSummary(b.currencyId, b.currency?.code, {
      name: b.currency?.name,
      symbol: b.currency?.symbol,
    });
    row.current = Number(b.amount || 0);
  }
  for (const m of movements) {
    const row = ensureSummary(m.currencyId, m.currencyCode);
    const amt = Number(m.amount || 0);
    const signed = m.direction === 'in' ? amt : -amt;
    const isOpeningAdj = m.source === 'adjustment_in' || m.source === 'adjustment_out';
    if (afterPeriod(m.at)) row.netAfterEnd += signed;
    if (inPeriod(m.at)) {
      if (isOpeningAdj) {
        row.openingAdj += signed;
      } else if (m.direction === 'in') {
        row.totalIn += amt;
      } else {
        row.totalOut += amt;
      }
    }
  }
  const byCurrency = [...summaryMap.values()]
    .map((row) => {
      const remaining = Number(row.current || 0) - Number(row.netAfterEnd || 0);
      const opening = remaining - Number(row.totalIn || 0) + Number(row.totalOut || 0);
      return {
        currencyId: row.currencyId,
        code: row.code,
        name: row.name,
        symbol: row.symbol,
        opening,
        totalIn: row.totalIn,
        totalOut: row.totalOut,
        remaining,
        current: row.current,
      };
    })
    .filter((row) => row.opening || row.totalIn || row.totalOut || row.remaining || row.current)
    .sort((a, b) => Math.abs(b.remaining) - Math.abs(a.remaining));

  let filtered = movements.filter((m) => inPeriod(m.at));
  // موجودی اول دوره جداست؛ در لیست ورود/خروج نشان داده نشود
  if (direction === 'in') {
    filtered = filtered.filter((m) => m.direction === 'in' && m.source !== 'adjustment_in' && m.source !== 'adjustment_out');
  } else if (direction === 'out') {
    filtered = filtered.filter((m) => m.direction === 'out' && m.source !== 'adjustment_in' && m.source !== 'adjustment_out');
  } else {
    filtered = filtered.filter((m) => m.source !== 'adjustment_in' && m.source !== 'adjustment_out');
  }

  filtered.sort((a, b) => new Date(b.at) - new Date(a.at) || String(b.id).localeCompare(String(a.id)));
  const rows = filtered.slice(0, limit);

  res.json({
    success: true,
    data: {
      cashbox: { id: box.id, name: box.name },
      dateFrom,
      dateTo,
      rows,
      byCurrency,
      totals: {
        inCount: movements.filter((m) => inPeriod(m.at) && m.direction === 'in').length,
        outCount: movements.filter((m) => inPeriod(m.at) && m.direction === 'out').length,
      },
    },
  });
}));
router.post('/cashboxes', requirePermission('cashboxes'), validate(wrap(cashboxBody)), asyncHandler(async (req, res) => {
  assertBranchAccess(req.user, req.validated.body.branchId);
  const row = await Cashbox.create(req.validated.body);
  await writeAudit({ req, user: req.user, action: `صندوق ثبت شد: ${row.name}` });
  emitChange(req, 'cashboxes:changed', { id: row.id });
  res.status(201).json({ success: true, data: row });
}));
router.put('/cashboxes/:id', requirePermission('cashboxes'), validate(wrap(cashboxBody, idParams)), asyncHandler(async (req, res) => {
  const row = await Cashbox.findByPk(req.validated.params.id);
  if (!row) throw new AppError('صندوق پیدا نشد.', 404);
  assertBranchAccess(req.user, row.branchId);
  assertBranchAccess(req.user, req.validated.body.branchId);
  await row.update(req.validated.body);
  await writeAudit({ req, user: req.user, action: `صندوق اصلاح شد: ${row.name}` });
  emitChange(req, 'cashboxes:changed', { id: row.id });
  res.json({ success: true, data: row });
}));
router.delete('/cashboxes/:id', requirePermission('cashboxes'), validate(wrap(empty, idParams)), asyncHandler(async (req, res) => {
  const row = await Cashbox.findByPk(req.validated.params.id);
  if (!row) throw new AppError('صندوق پیدا نشد.', 404);
  assertBranchAccess(req.user, row.branchId);const used=(await Transaction.count({where:{cashboxId:row.id}}))+(await CustomerLedger.count({where:{cashboxId:row.id}}));if(used)throw new AppError('این صندوق گردش مالی دارد و حذف نمی‌شود؛ آن را غیرفعال کنید.',409);await row.destroy();emitChange(req,'cashboxes:changed',{id:row.id});res.json({success:true});}));
router.put('/cashboxes/:id/balances/:currencyId', requirePermission('cashboxes'), validate(wrap(z.object({ amount: z.coerce.number().refine((v) => v !== 0, 'مبلغ موجودی اول دوره باید بیشتر از صفر باشد.') }), z.object({ id: z.coerce.number().int().positive(), currencyId: z.coerce.number().int().positive() }))), asyncHandler(async (req, res) => {
  const box = await Cashbox.findByPk(req.validated.params.id);
  if (!box) throw new AppError('صندوق پیدا نشد.', 404);
  assertBranchAccess(req.user, box.branchId);
  const row = await addCashboxOpeningBalance(req.validated.params.id, req.validated.params.currencyId, req.validated.body.amount, { req, user: req.user });
  emitChange(req, 'balances:changed', { cashboxId: req.validated.params.id });
  res.json({ success: true, data: row, message: 'موجودی اول دوره ثبت شد.' });
}));

const cashboxTransferBody = z.object({
  fromCashboxId: z.coerce.number().int().positive(),
  toCashboxId: z.coerce.number().int().positive(),
  currencyId: z.coerce.number().int().positive(),
  amount: z.coerce.number().positive(),
  note: optionalText(255),
}).refine((v) => v.fromCashboxId !== v.toCashboxId, {
  message: 'صندوق مبدأ و مقصد نباید یکسان باشد.',
  path: ['toCashboxId'],
});
router.post('/cashboxes/transfer', requirePermission('cashboxes'), validate(wrap(cashboxTransferBody)), asyncHandler(async (req, res) => {
  const { fromCashboxId, toCashboxId } = req.validated.body;
  const [fromBox, toBox] = await Promise.all([
    Cashbox.findByPk(fromCashboxId),
    Cashbox.findByPk(toCashboxId),
  ]);
  if (!fromBox || !toBox) throw new AppError('صندوق پیدا نشد.', 404);
  assertBranchAccess(req.user, fromBox.branchId);
  assertBranchAccess(req.user, toBox.branchId);
  const data = await transferCashboxBalance(req.validated.body, { req, user: req.user });
  emitChange(req, 'balances:changed');
  emitChange(req, 'cashboxes:changed');
  res.status(201).json({ success: true, data, message: 'انتقال بین صندوق‌ها ثبت شد.' });
}));

const currencyBody=z.object({name:z.string().trim().min(1).max(120),code:z.string().trim().min(3).max(10).transform(v=>v.toUpperCase()),country:optionalText(120),symbol:optionalText(20),decimalPlaces:z.coerce.number().int().min(0).max(8).default(2),isActive:z.boolean().default(true),isBase:z.boolean().default(false)});
router.get('/currencies',requirePermission('currencies'),asyncHandler(async(req,res)=>{const rows=await Currency.findAll({where:searchWhere(req.query.search,['name','code','country']),order:[['isBase','DESC'],['isActive','DESC'],['code','ASC']]});res.json({success:true,data:rows});}));
router.post('/currencies',requirePermission('currencies'),validate(wrap(currencyBody)),asyncHandler(async(req,res)=>{const body=req.validated.body;const row=await sequelize.transaction(async t=>{if(body.isBase)await Currency.update({isBase:false},{where:{},transaction:t});return Currency.create({...body,sign:body.symbol},{transaction:t});});await writeAudit({req,user:req.user,action:`ارز ثبت شد: ${row.code}`});emitChange(req,'currencies:changed',{id:row.id});res.status(201).json({success:true,data:row});}));
router.put('/currencies/:id',requirePermission('currencies'),validate(wrap(currencyBody,idParams)),asyncHandler(async(req,res)=>{const row=await Currency.findByPk(req.validated.params.id);if(!row)throw new AppError('ارز پیدا نشد.',404);await sequelize.transaction(async t=>{if(req.validated.body.isBase)await Currency.update({isBase:false},{where:{},transaction:t});await row.update({...req.validated.body,sign:req.validated.body.symbol},{transaction:t});});emitChange(req,'currencies:changed',{id:row.id});res.json({success:true,data:row});}));
router.patch('/currencies/:id/base',requirePermission('currencies'),validate(wrap(empty,idParams)),asyncHandler(async(req,res)=>{const row=await Currency.findByPk(req.validated.params.id);if(!row)throw new AppError('ارز پیدا نشد.',404);await sequelize.transaction(async t=>{await Currency.update({isBase:false},{where:{},transaction:t});await row.update({isBase:true,isActive:true},{transaction:t});});emitChange(req,'currencies:changed',{id:row.id});res.json({success:true,data:row});}));
router.delete('/currencies/:id',requirePermission('currencies'),validate(wrap(empty,idParams)),asyncHandler(async(req,res)=>{const row=await Currency.findByPk(req.validated.params.id);if(!row)throw new AppError('ارز پیدا نشد.',404);const used=await CashboxBalance.count({where:{currencyId:row.id}})+await Transaction.count({where:{[Op.or]:[{fromCurrencyId:row.id},{toCurrencyId:row.id}]}});if(used)throw new AppError('این ارز گردش مالی دارد و حذف نمی‌شود؛ آن را غیرفعال کنید.',409);await row.destroy();emitChange(req,'currencies:changed',{id:row.id});res.json({success:true});}));

const rateBody=z.object({fromCurrencyId:z.coerce.number().int().positive(),toCurrencyId:z.coerce.number().int().positive(),buyRate:z.coerce.number().positive(),sellRate:z.coerce.number().positive(),specialRate:z.coerce.number().positive().optional().nullable(),branchId:z.coerce.number().int().positive().optional().nullable(),isActive:z.boolean().default(true)}).refine(v=>v.fromCurrencyId!==v.toCurrencyId,{message:'دو ارز نباید یکسان باشد.'});
router.get('/rates', requirePermission('rates'), asyncHandler(async (req, res) => {
  const rows = await ExchangeRate.findAll({
    where: ratesWhere(req.user),
    include: ['fromCurrency', 'toCurrency', 'branch'],
    order: [['id','DESC']],
    limit: 500,
  });
  res.json({ success: true, data: rows });
}));
router.post('/rates', requirePermission('rates'), validate(wrap(rateBody)), asyncHandler(async (req, res) => {
  if (req.validated.body.branchId) assertBranchAccess(req.user, req.validated.body.branchId);
  const row = await ExchangeRate.create(req.validated.body);await writeAudit({req,user:req.user,action:`نرخ ${row.fromCurrencyId}/${row.toCurrencyId} ثبت شد`});emitChange(req,'rates:changed',{id:row.id});res.status(201).json({success:true,data:await ExchangeRate.findByPk(row.id,{include:['fromCurrency','toCurrency','branch']})});}));
router.put('/rates/:id', requirePermission('rates'), validate(wrap(rateBody, idParams)), asyncHandler(async (req, res) => {
  const row = await ExchangeRate.findByPk(req.validated.params.id);
  if (!row) throw new AppError('نرخ پیدا نشد.', 404);
  if (row.branchId) assertBranchAccess(req.user, row.branchId);
  if (req.validated.body.branchId) assertBranchAccess(req.user, req.validated.body.branchId);
  await row.update(req.validated.body);emitChange(req,'rates:changed',{id:row.id});res.json({success:true,data:row});}));
router.delete('/rates/:id',requirePermission('rates'),validate(wrap(empty,idParams)),asyncHandler(async(req,res)=>{const row=await ExchangeRate.findByPk(req.validated.params.id);if(!row)throw new AppError('نرخ پیدا نشد.',404);await row.destroy();emitChange(req,'rates:changed',{id:row.id});res.json({success:true});}));

const staffBody=z.object({name:z.string().trim().min(2).max(120),phone:optionalText(30),username:z.string().trim().min(3).max(80),password:z.string().min(8).optional().or(z.literal('')),role:z.string().trim().min(1).max(80),branchId:z.coerce.number().int().positive().optional().nullable(),permissions:z.array(z.enum(allPermissions)).default([]),isActive:z.boolean().default(true)});
router.get('/staff', requirePermission('staff'), asyncHandler(async (req, res) => {
  const where = branchWhere(req.user);
  const rows = await User.findAll({ where, include: ['branch'], order: [['id','DESC']] });
  const normalized = rows.map((row) => {
    const json = row.toJSON();
    const raw = json.permissions;
    json.permissions = Array.isArray(raw) ? raw : (typeof raw === 'string' ? (() => { try { const p = JSON.parse(raw); return Array.isArray(p) ? p : []; } catch { return []; } })() : []);
    return json;
  });
  res.json({ success: true, data: { rows: normalized, permissions: allPermissions } });
}));
router.post('/staff', requirePermission('staff'), validate(wrap(staffBody.refine(v => v.password && v.password.length >= 8, { message: 'رمز ورود حداقل ۸ حرف باشد.' }))), asyncHandler(async (req, res) => {
  const body = sanitizeStaffPayload(req.user, req.validated.body);
  if (body.branchId) assertBranchAccess(req.user, body.branchId);
  const row = await User.unscoped().create({ ...body, password: await bcrypt.hash(body.password, 12) });
  await writeAudit({ req, user: req.user, action: `کارمند نو ساخته شد: ${row.name}` });
  emitChange(req, 'staff:changed', { id: row.id });
  res.status(201).json({ success: true, data: await User.findByPk(row.id, { include: ['branch'] }) });
}));
router.put('/staff/:id', requirePermission('staff'), validate(wrap(staffBody, idParams)), asyncHandler(async (req, res) => {
  const row = await User.unscoped().findByPk(req.validated.params.id);
  if (!row) throw new AppError('کارمند پیدا نشد.', 404);
  if (row.branchId) assertBranchAccess(req.user, row.branchId);
  if (row.username === 'admin' && !req.validated.body.isActive) throw new AppError('حساب مدیر اصلی بسته نمی‌شود.');
  const body = sanitizeStaffPayload(req.user, req.validated.body);
  if (body.branchId) assertBranchAccess(req.user, body.branchId);
  if (body.password) body.password = await bcrypt.hash(body.password, 12);
  else delete body.password;
  await row.update(body);await writeAudit({req,user:req.user,action:`کارمند اصلاح شد: ${row.name}`});emitChange(req,'staff:changed',{id:row.id});res.json({success:true,data:await User.findByPk(row.id,{include:['branch']})});}));

router.post(
  '/staff/:id/avatar',
  requirePermission('staff'),
  validate(wrap(empty, idParams)),
  (req, res, next) => {
    avatarUpload.single('avatar')(req, res, (err) => {
      if (err) {
        if (err instanceof AppError) return next(err);
        if (err?.code === 'LIMIT_FILE_SIZE') {
          return next(new AppError('حجم عکس حداکثر ۲ مگابایت باشد.', 400));
        }
        return next(new AppError(err.message || 'آپلود عکس ناموفق بود.', 400));
      }
      return next();
    });
  },
  asyncHandler(async (req, res) => {
    const row = await User.findByPk(req.validated.params.id);
    if (!row) throw new AppError('کارمند پیدا نشد.', 404);
    if (row.branchId) assertBranchAccess(req.user, row.branchId);
    if (!req.file) throw new AppError('فایل عکس انتخاب نشده است.', 400);

    const previous = row.avatarUrl;
    const nextUrl = publicAvatarUrl(req.file.filename);
    await row.update({ avatarUrl: nextUrl });

    if (previous && previous.startsWith('/uploads/avatars/')) {
      const oldPath = path.join(avatarsDir, path.basename(previous));
      fs.promises.unlink(oldPath).catch(() => {});
    }

    await writeAudit({ req, user: req.user, action: `عکس پروفایل به‌روز شد: ${row.name}` });
    emitChange(req, 'staff:changed', { id: row.id });
    res.json({ success: true, data: await User.findByPk(row.id, { include: ['branch'] }) });
  }),
);

router.delete(
  '/staff/:id/avatar',
  requirePermission('staff'),
  validate(wrap(empty, idParams)),
  asyncHandler(async (req, res) => {
    const row = await User.findByPk(req.validated.params.id);
    if (!row) throw new AppError('کارمند پیدا نشد.', 404);
    if (row.branchId) assertBranchAccess(req.user, row.branchId);
    const previous = row.avatarUrl;
    await row.update({ avatarUrl: null });
    if (previous && previous.startsWith('/uploads/avatars/')) {
      const oldPath = path.join(avatarsDir, path.basename(previous));
      fs.promises.unlink(oldPath).catch(() => {});
    }
    emitChange(req, 'staff:changed', { id: row.id });
    res.json({ success: true, data: await User.findByPk(row.id, { include: ['branch'] }) });
  }),
);

router.delete('/staff/:id', requirePermission('staff'), validate(wrap(empty, idParams)), asyncHandler(async (req, res) => {
  if (Number(req.user.id) === req.validated.params.id) throw new AppError('حساب خود را حذف نمی‌توانید.');
  const row = await User.unscoped().findByPk(req.validated.params.id);
  if (!row) throw new AppError('کارمند پیدا نشد.', 404);
  if (row.branchId) assertBranchAccess(req.user, row.branchId);
  if (row.username === 'admin') throw new AppError('حساب مدیر اصلی حذف نمی‌شود.');await row.destroy();emitChange(req,'staff:changed',{id:row.id});res.json({success:true});}));

router.get('/audit', requirePermission('audit'), asyncHandler(async (req, res) => {
  assertSuperAdmin(req.user);const {page,limit,offset}=pageInfo(req.query);const result=await AuditLog.findAndCountAll({where:searchWhere(req.query.search,['person','action','ipAddress','device']),order:[['id','DESC']],limit,offset});res.json({success:true,data:paginationResult(result,page,limit)});}));
router.get('/settings', requirePermission('settings'), asyncHandler(async (req, res) => {
  assertSuperAdmin(req.user);
  const rows = await SystemSetting.findAll();
  const data = Object.fromEntries(rows.map((r) => [r.settingKey, r.settingValue]));
  const planLockRegistered = Boolean(String(data.app_plan_lock_hash || '').trim());
  const telegramTokenSet = Boolean(String(data.telegram_bot_token || '').trim());
  delete data.app_plan_pin;
  delete data.app_plan_lock_hash;
  delete data.telegram_bot_token;
  delete data.telegram_backup_last_date;
  data.plan_lock_registered = planLockRegistered;
  data.telegram_bot_token_set = telegramTokenSet;
  res.json({ success: true, data });
}));
router.put('/settings', requirePermission('settings'), validate(wrap(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])))), asyncHandler(async (req, res) => {
  assertSuperAdmin(req.user);
  await sequelize.transaction(async (t) => {
    const body = { ...req.validated.body };
    delete body.app_plan;
    delete body.app_enabled_menus;
    delete body.app_plan_pin;
    delete body.app_plan_lock_hash;
    delete body.plan_lock_registered;
    delete body.telegram_bot_token_set;
    delete body.telegram_backup_last_date;
    for (const [settingKey, value] of Object.entries(body)) {
      // Keep existing secret token if client sends blank (UI leave-unchanged).
      if ((settingKey === 'whatsapp_access_token' || settingKey === 'telegram_bot_token') && !String(value ?? '').trim()) continue;
      let settingValue = value == null ? '' : String(value);
      if (settingKey === 'whatsapp_access_token' || settingKey === 'telegram_bot_token') {
        settingValue = settingValue.replace(/^["'\s]+|["'\s]+$/g, '').replace(/\s+/g, '').trim();
      }
      if (settingKey === 'telegram_chat_id') {
        settingValue = settingValue
          .replace(/[۰-۹]/g, (ch) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(ch)))
          .replace(/[٠-٩]/g, (ch) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(ch)))
          .trim();
      }
      await SystemSetting.upsert({ settingKey, settingValue }, { transaction: t });
    }
    if (Object.prototype.hasOwnProperty.call(req.validated.body, 'numbering_start')) {
      const { applyNumberingStart } = await import('../utils/ids.js');
      await applyNumberingStart(req.validated.body.numbering_start, t);
    }
    await writeAudit({ req, user: req.user, action: 'تنظیمات سامانه اصلاح شد', transaction: t });
  });
  try {
    const { clearNegativeCashboxCache } = await import('../services/accounting.js');
    clearNegativeCashboxCache();
  } catch { /* ignore */ }
  emitChange(req, 'settings:changed');
  clearAppPlanCache();
  // If WhatsApp credentials were saved, retry waiting messages automatically.
  setImmediate(() => {
    import('../services/whatsapp.js')
      .then(({ retryPendingWhatsappMessages }) => retryPendingWhatsappMessages())
      .catch((err) => console.error('[whatsapp] retry after settings:', err?.message || err));
  });
  res.json({ success: true, message: 'تنظیمات با موفقیت ذخیره شد.' });
}));

router.post('/settings/plan-lock', requirePermission('settings'), validate(wrap(z.object({
  password: z.string().min(1).max(80),
  confirm: z.string().min(1).max(80),
}))), asyncHandler(async (req, res) => {
  assertSuperAdmin(req.user);
  await registerPlanLock(req.validated.body.password, req.validated.body.confirm);
  await writeAudit({ req, user: req.user, action: 'رمز ادمین سطح برنامه ثبت شد' });
  res.json({ success: true, message: 'رمز ادمین ثبت شد.' });
}));

router.put('/settings/plan-lock', requirePermission('settings'), validate(wrap(z.object({
  current: z.string().min(1).max(80),
  password: z.string().min(1).max(80),
  confirm: z.string().min(1).max(80),
}))), asyncHandler(async (req, res) => {
  assertSuperAdmin(req.user);
  await changePlanLock(req.validated.body.current, req.validated.body.password, req.validated.body.confirm);
  await writeAudit({ req, user: req.user, action: 'رمز ادمین سطح برنامه تغییر کرد' });
  res.json({ success: true, message: 'رمز ادمین تغییر کرد.' });
}));

router.put('/settings/plan', requirePermission('settings'), validate(wrap(z.object({
  password: z.string().min(1).max(80),
  app_plan: z.string().trim().min(1).max(40),
}))), asyncHandler(async (req, res) => {
  assertSuperAdmin(req.user);
  await assertPlanLock(req.validated.body.password);
  const plan = parseAppPlan(req.validated.body.app_plan);
  await sequelize.transaction(async (t) => {
    await SystemSetting.upsert({ settingKey: 'app_plan', settingValue: plan.id }, { transaction: t });
    await SystemSetting.upsert({ settingKey: 'app_enabled_menus', settingValue: plan.menus.join(',') }, { transaction: t });
    await writeAudit({ req, user: req.user, action: `سطح برنامه به ${plan.id} تغییر کرد`, transaction: t });
  });
  clearAppPlanCache();
  emitChange(req, 'settings:changed');
  res.json({ success: true, data: { app_plan: plan.id }, message: 'سطح برنامه ذخیره شد.' });
}));

router.post('/settings/telegram/chat-id', requirePermission('settings'), validate(wrap(z.object({
  token: z.string().optional(),
}))), asyncHandler(async (req, res) => {
  assertSuperAdmin(req.user);
  const { resolveTelegramChat } = await import('../services/telegramBackup.js');
  const data = await resolveTelegramChat(req.validated.body.token);
  res.json({ success: true, data, message: 'آیدی چت پیدا شد.' });
}));

router.post('/system/backup/telegram', requirePermission('settings'), validate(wrap(z.object({
  token: z.string().optional(),
  chat_id: z.string().optional(),
}))), asyncHandler(async (req, res) => {
  assertSuperAdmin(req.user);
  const { sendTelegramBackup } = await import('../services/telegramBackup.js');
  const data = await sendTelegramBackup({
    token: req.validated.body.token,
    chatId: req.validated.body.chat_id,
  });
  await writeAudit({ req, user: req.user, action: 'بک‌آپ به تلگرام ارسال شد' });
  res.json({ success: true, data, message: 'بک‌آپ به تلگرام ارسال شد.' });
}));

router.get('/system/backup', requirePermission('settings'), asyncHandler(async (req, res) => {
  assertSuperAdmin(req.user);
  const format = String(req.query.format || 'sql').toLowerCase();
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const { buildSystemBackup, buildSystemSqlBackup } = await import('../services/systemMaintenance.js');

  if (format === 'json') {
    const data = await buildSystemBackup();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="pplus-arz-backup-${stamp}.json"`);
    return res.json({ success: true, data });
  }

  const sql = await buildSystemSqlBackup();
  res.setHeader('Content-Type', 'application/sql; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="pplus-arz-backup-${stamp}.sql"`);
  return res.send(sql);
}));

router.get('/system/reset-categories', requirePermission('settings'), asyncHandler(async (req, res) => {
  assertSuperAdmin(req.user);
  const { listResetCategories } = await import('../services/systemMaintenance.js');
  const categories = await listResetCategories();
  res.json({ success: true, data: categories });
}));

router.post('/system/reset', requirePermission('settings'), validate(wrap(z.object({
  confirm: z.literal('RESET'),
  mode: z.enum(['full', 'selective']).default('full'),
  categories: z.array(z.string()).optional(),
}))), asyncHandler(async (req, res) => {
  assertSuperAdmin(req.user);
  const { resetSystemData } = await import('../services/systemMaintenance.js');
  const { mode, categories } = req.validated.body;
  await resetSystemData({ req, user: req.user, mode, categories });
  ['customers:changed', 'accounts:changed', 'transactions:changed', 'balances:changed', 'remittances:changed', 'cashboxes:changed', 'staff:changed', 'rates:changed', 'settings:changed'].forEach((ev) => emitChange(req, ev));
  const message = mode === 'selective'
    ? 'موارد انتخاب‌شده پاک شدند.'
    : 'همه اطلاعات سامانه به‌جز کاربران و فهرست ارزها پاک شد.';
  res.json({ success: true, message });
}));

export default router;
