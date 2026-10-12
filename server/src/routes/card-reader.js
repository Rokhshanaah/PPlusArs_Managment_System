import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { createHash, randomBytes } from 'crypto';
import { z } from 'zod';
import { Op } from 'sequelize';
import { requirePermission } from '../middleware/auth.js';
import { requirePlanMenu } from '../utils/appPlans.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import { writeAudit } from '../utils/audit.js';
import {
  CardReaderEntry, Customer, Currency, CustomerLedger, CustomerBalance, Cashbox,
} from '../models/index.js';
import { createCustomerLedgerEntry, deleteCustomerLedgerEntry } from '../services/accounting.js';
import { emitChange, pageInfo, paginationResult, searchWhere } from './common.js';
import { assertCashboxAccess } from '../utils/branchScope.js';
import { cardReaderUpload, publicCardReaderUrl, cardReaderDir } from '../middleware/upload.js';
import { buildRateToAfnMap, getBaseCurrency, toBase } from '../utils/currencyConvert.js';

const router = Router();
router.use((req, res, next) => {
  if (String(req.path || '').startsWith('/card-reader')) {
    return requirePlanMenu('cardReader')(req, res, next);
  }
  return next();
});
const empty = z.object({});
const queryAny = z.record(z.string(), z.any()).optional().default({});
const wrap = (body, params = empty, query = queryAny) => z.object({ body, params, query });
const idParams = z.object({ id: z.coerce.number().int().positive() });
const optionalText = (max = 255) => z.string().trim().max(max).optional().nullable().transform((v) => v || null);
const requiredText = (max = 255) => z.string().trim().min(1).max(max);

function dateRangeWhere(query, field = 'createdAt') {
  const where = {};
  if (query.dateFrom) where[field] = { ...(where[field] || {}), [Op.gte]: `${query.dateFrom} 00:00:00` };
  if (query.dateTo) where[field] = { ...(where[field] || {}), [Op.lte]: `${query.dateTo} 23:59:59` };
  return where;
}

function unlinkCardReaderFile(url) {
  if (!url || !String(url).startsWith('/uploads/card-reader/')) return;
  const filePath = path.join(cardReaderDir, path.basename(url));
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    /* ignore */
  }
}

async function hashFingerprintFile(filePath) {
  const buf = await fs.promises.readFile(filePath);
  return createHash('sha256').update(buf).digest('hex');
}

function normalizeKind(raw) {
  if (raw === 'withdrawal') return 'withdrawal';
  if (raw === 'note') return 'note';
  return 'deposit';
}

function parseCardReaderBody(raw = {}) {
  const fingerprintConfirmed = ['1', 'true', 'on', 'yes', true, 1].includes(raw.fingerprintConfirmed);
  const numOrNull = (v) => (v === '' || v == null ? null : Number(v));

  let cardTransfers = [];
  const rawTransfers = raw.cardTransfers ?? raw.card_transfers;
  if (typeof rawTransfers === 'string' && rawTransfers.trim()) {
    try {
      const parsed = JSON.parse(rawTransfers);
      if (Array.isArray(parsed)) cardTransfers = parsed;
    } catch {
      cardTransfers = [];
    }
  } else if (Array.isArray(rawTransfers)) {
    cardTransfers = rawTransfers;
  }

  // Fallback: cardTransfer_0_cashboxId / cardTransfer_0_amount ...
  if (!cardTransfers.length) {
    const count = Number(raw.cardTransferCount || 0);
    const max = Number.isFinite(count) && count > 0 ? count : 20;
    for (let i = 0; i < max; i += 1) {
      const cashboxId = numOrNull(raw[`cardTransfer_${i}_cashboxId`]);
      const amountRaw = raw[`cardTransfer_${i}_amount`];
      const amount = amountRaw === '' || amountRaw == null ? null : Number(amountRaw);
      if (cashboxId && amount != null && Number(amount) > 0) {
        cardTransfers.push({ cashboxId, amount });
      } else if (!raw[`cardTransfer_${i}_cashboxId`] && !raw[`cardTransfer_${i}_amount`] && i >= count) {
        break;
      }
    }
  }

  cardTransfers = cardTransfers
    .map((row) => ({
      cashboxId: numOrNull(row?.cashboxId ?? row?.id),
      amount: row?.amount === '' || row?.amount == null ? null : Number(row.amount),
    }))
    .filter((row) => row.cashboxId && row.amount != null && Number(row.amount) > 0);

  let amount = raw.amount === '' || raw.amount == null ? null : Number(raw.amount);
  if (cardTransfers.length) {
    amount = cardTransfers.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  }

  return {
    customerName: String(raw.customerName || '').trim(),
    phone: String(raw.phone || '').trim(),
    documentNumber: String(raw.documentNumber || '').trim(),
    cardNumber: String(raw.cardNumber || '').trim(),
    bankName: String(raw.bankName || '').trim() || null,
    cardHolderName: String(raw.cardHolderName || '').trim() || null,
    kind: normalizeKind(raw.kind),
    amount,
    fee: raw.fee === '' || raw.fee == null ? 0 : Number(raw.fee),
    currencyId: raw.currencyId === '' || raw.currencyId == null ? null : Number(raw.currencyId),
    cashAmount: raw.cashAmount === '' || raw.cashAmount == null ? null : Number(raw.cashAmount),
    cashCurrencyId: raw.cashCurrencyId === '' || raw.cashCurrencyId == null ? null : Number(raw.cashCurrencyId),
    cashboxId: numOrNull(raw.cashboxId),
    receiveCashboxId: numOrNull(raw.receiveCashboxId) || cardTransfers[0]?.cashboxId || null,
    payCashboxId: numOrNull(raw.payCashboxId),
    cardTransfers,
    note: String(raw.note || '').trim() || null,
    customerId: raw.customerId === '' || raw.customerId == null ? null : Number(raw.customerId),
    fingerprintSeed: String(raw.fingerprintSeed || '').trim() || null,
    fingerprintTemplate: String(raw.fingerprintTemplate || '').trim() || null,
    fingerprintFormat: String(raw.fingerprintFormat || 'ZK10').trim().slice(0, 32) || 'ZK10',
    fingerprintConfirmed,
  };
}

function encodeCardReaderCashboxNote(
  userNote,
  receiveCashboxId,
  payCashboxId,
  {
    payLedgerEntryId = null,
    cashAmount = null,
    cashCurrencyId = null,
    cardSplits = null,
  } = {},
) {
  const clean = String(userNote || '')
    .replace(/\s*\|\s*ZH_RECV:\d+/g, '')
    .replace(/\s*\|\s*ZH_SPLITS:[^|]*/g, '')
    .replace(/\s*\|\s*ZH_PAY:\d+/g, '')
    .replace(/\s*\|\s*ZH_PAY_LEDGER:\d+/g, '')
    .replace(/\s*\|\s*ZH_CASH:[\d.]+:\d+/g, '')
    .trim();
  const tags = [];
  if (Array.isArray(cardSplits) && cardSplits.length) {
    const encoded = cardSplits
      .map((s) => `${Number(s.cashboxId)}:${Number(s.amount)}:${Number(s.ledgerId || 0)}`)
      .join(',');
    tags.push(`ZH_SPLITS:${encoded}`);
    tags.push(`ZH_RECV:${Number(cardSplits[0].cashboxId)}`);
  } else if (receiveCashboxId) {
    tags.push(`ZH_RECV:${receiveCashboxId}`);
  }
  if (payCashboxId) tags.push(`ZH_PAY:${payCashboxId}`);
  if (payLedgerEntryId) tags.push(`ZH_PAY_LEDGER:${payLedgerEntryId}`);
  if (cashAmount != null && cashCurrencyId) {
    tags.push(`ZH_CASH:${cashAmount}:${cashCurrencyId}`);
  }
  if (!tags.length) return clean || null;
  return clean ? `${clean} | ${tags.join(' | ')}` : tags.join(' | ');
}

function parseCardReaderCashboxNote(note) {
  const text = String(note || '');
  const receive = /ZH_RECV:(\d+)/.exec(text);
  const pay = /ZH_PAY:(\d+)/.exec(text);
  const payLedger = /ZH_PAY_LEDGER:(\d+)/.exec(text);
  const cash = /ZH_CASH:([\d.]+):(\d+)/.exec(text);
  const splitsMatch = /ZH_SPLITS:([^|]+)/.exec(text);
  const cardTransfers = [];
  if (splitsMatch?.[1]) {
    for (const part of splitsMatch[1].split(',')) {
      const [cashboxId, amount, ledgerId] = part.split(':');
      const cid = Number(cashboxId);
      const amt = Number(amount);
      if (Number.isFinite(cid) && cid > 0 && Number.isFinite(amt) && amt > 0) {
        cardTransfers.push({
          cashboxId: cid,
          amount: amt,
          ledgerId: Number(ledgerId) > 0 ? Number(ledgerId) : null,
        });
      }
    }
  }
  const cleanNote = text
    .replace(/\s*\|\s*ZH_RECV:\d+/g, '')
    .replace(/\s*\|\s*ZH_SPLITS:[^|]*/g, '')
    .replace(/\s*\|\s*ZH_PAY:\d+/g, '')
    .replace(/\s*\|\s*ZH_PAY_LEDGER:\d+/g, '')
    .replace(/\s*\|\s*ZH_CASH:[\d.]+:\d+/g, '')
    .trim() || null;
  return {
    receiveCashboxId: receive ? Number(receive[1]) : (cardTransfers[0]?.cashboxId || null),
    payCashboxId: pay ? Number(pay[1]) : null,
    payLedgerEntryId: payLedger ? Number(payLedger[1]) : null,
    cashAmount: cash ? Number(cash[1]) : null,
    cashCurrencyId: cash ? Number(cash[2]) : null,
    cardTransfers,
    cleanNote,
  };
}

/**
 * برداشت:
 *   1) پول از کارت مشتری → یک یا چند کارت من (+)
 *   2) پول نقد از صندوق → مشتری (−)
 * واریز:
 *   فقط پول از کارت من → کارت مشتری (− از کارت من)
 */
async function createCardReaderCashboxLedgers(customerId, body, {
  receiveCashboxId,
  payCashboxId,
  cardTransfers = [],
  req,
  user,
}) {
  const baseNote = buildLedgerNote(body);
  const cardAmount = body.amount;
  const cardCurrencyId = body.currencyId;

  if (body.kind === 'withdrawal') {
    const splits = (Array.isArray(cardTransfers) && cardTransfers.length)
      ? cardTransfers
      : (receiveCashboxId
        ? [{ cashboxId: Number(receiveCashboxId), amount: Number(cardAmount) }]
        : []);

    if (!splits.length) throw new AppError('حداقل یک کارت من را با مبلغ انتخاب کنید.', 400);
    if (!payCashboxId) throw new AppError('صندوق پرداخت نقد را انتخاب کنید.', 400);
    if (body.cashAmount == null || !(Number(body.cashAmount) > 0)) {
      throw new AppError('مبلغ پرداخت نقد به مشتری را وارد کنید.', 400);
    }
    if (!body.cashCurrencyId) throw new AppError('ارز پرداخت نقد به مشتری را انتخاب کنید.', 400);

    const splitSum = splits.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    if (!(splitSum > 0)) throw new AppError('مبلغ کارت‌های من باید بیشتر از صفر باشد.', 400);
    if (Math.abs(splitSum - Number(cardAmount)) > 0.000001) {
      throw new AppError('جمع مبلغ کارت‌های من باید با مبلغ کل کارت برابر باشد.', 400);
    }

    const uniqueBoxes = new Set(splits.map((s) => Number(s.cashboxId)));
    if (uniqueBoxes.size !== splits.length) {
      throw new AppError('هر کارت من را فقط یک‌بار انتخاب کنید.', 400);
    }

    await assertCashboxAccess(user, payCashboxId, Cashbox);
    for (const split of splits) {
      await assertCashboxAccess(user, split.cashboxId, Cashbox);
    }

    const cardSplits = [];
    let primaryLedger = null;
    for (const split of splits) {
      const cardLedger = await createCustomerLedgerEntry(customerId, {
        type: 'received',
        cashboxId: Number(split.cashboxId),
        currencyId: cardCurrencyId,
        amount: Number(split.amount),
        note: `${baseNote} | کارت مشتری → کارت من #${split.cashboxId} (${split.amount})`,
        skipCustomerBalance: true,
        skipNotify: true,
      }, { req, user });
      const ledgerId = cardLedger.id || cardLedger.entry?.id || null;
      if (!primaryLedger) primaryLedger = cardLedger;
      cardSplits.push({
        cashboxId: Number(split.cashboxId),
        amount: Number(split.amount),
        ledgerId,
      });
    }

    const cashLedger = await createCustomerLedgerEntry(customerId, {
      type: 'paid',
      cashboxId: payCashboxId,
      currencyId: body.cashCurrencyId,
      amount: body.cashAmount,
      note: `${baseNote} | نقد از صندوق به مشتری`,
      skipCustomerBalance: true,
      skipNotify: true,
    }, { req, user });

    return {
      primaryLedger,
      ledgerCashboxId: cardSplits[0].cashboxId,
      payLedgerEntryId: cashLedger.id || cashLedger.entry?.id || null,
      cashAmount: body.cashAmount,
      cashCurrencyId: body.cashCurrencyId,
      cardSplits,
    };
  }

  if (!receiveCashboxId) throw new AppError('صندوق کارت من را انتخاب کنید.', 400);
  await assertCashboxAccess(user, receiveCashboxId, Cashbox);
  const ledger = await createCustomerLedgerEntry(customerId, {
    type: 'paid',
    cashboxId: receiveCashboxId,
    currencyId: cardCurrencyId,
    amount: cardAmount,
    note: `${baseNote} | کارت من → کارت مشتری`,
    skipCustomerBalance: true,
    skipNotify: true,
  }, { req, user });

  return {
    primaryLedger: ledger,
    ledgerCashboxId: receiveCashboxId,
    payLedgerEntryId: null,
    cashAmount: null,
    cashCurrencyId: null,
    cardSplits: null,
  };
}

async function deleteCustomerLedgerEntryIfExists(entryId, context) {
  if (!Number.isFinite(entryId) || entryId <= 0) return false;
  const entry = await CustomerLedger.findByPk(entryId, { attributes: ['id'] });
  if (!entry) return false;
  await deleteCustomerLedgerEntry(entryId, context);
  return true;
}

async function reverseCardReaderLedgers(row, { req, user }) {
  const parsed = parseCardReaderCashboxNote(row.note);
  const ledgerIds = new Set();
  if (parsed.payLedgerEntryId) ledgerIds.add(Number(parsed.payLedgerEntryId));
  if (row.ledgerEntryId) ledgerIds.add(Number(row.ledgerEntryId));
  for (const split of parsed.cardTransfers || []) {
    if (split.ledgerId) ledgerIds.add(Number(split.ledgerId));
  }
  for (const id of ledgerIds) {
    await deleteCustomerLedgerEntryIfExists(id, { req, user });
  }
}

async function enrichCardReaderEntries(rows) {
  const list = (rows || []).map((row) => (row.toJSON ? row.toJSON() : row));
  const cashboxIds = new Set();
  const currencyIds = new Set();
  const parsedRows = list.map((json) => {
    const parsed = parseCardReaderCashboxNote(json.note);
    const receiveCashboxId = parsed.receiveCashboxId
      || json.cashboxId
      || null;
    const payCashboxId = parsed.payCashboxId || null;
    const cashAmount = parsed.cashAmount;
    const cashCurrencyId = parsed.cashCurrencyId;
    const cardTransfers = parsed.cardTransfers?.length
      ? parsed.cardTransfers
      : (receiveCashboxId
        ? [{ cashboxId: Number(receiveCashboxId), amount: Number(json.amount), ledgerId: json.ledgerEntryId || null }]
        : []);
    if (receiveCashboxId) cashboxIds.add(Number(receiveCashboxId));
    if (payCashboxId) cashboxIds.add(Number(payCashboxId));
    if (cashCurrencyId) currencyIds.add(Number(cashCurrencyId));
    for (const split of cardTransfers) {
      if (split.cashboxId) cashboxIds.add(Number(split.cashboxId));
    }
    return {
      json, parsed, receiveCashboxId, payCashboxId, cashAmount, cashCurrencyId, cardTransfers,
    };
  });

  const [boxes, currencies] = await Promise.all([
    cashboxIds.size
      ? Cashbox.findAll({ where: { id: { [Op.in]: [...cashboxIds] } } })
      : Promise.resolve([]),
    currencyIds.size
      ? Currency.findAll({ where: { id: { [Op.in]: [...currencyIds] } } })
      : Promise.resolve([]),
  ]);
  const boxMap = new Map(boxes.map((b) => [Number(b.id), b.toJSON ? b.toJSON() : b]));
  const curMap = new Map(currencies.map((c) => [Number(c.id), c.toJSON ? c.toJSON() : c]));

  return parsedRows.map(({
    json, parsed, receiveCashboxId, payCashboxId, cashAmount, cashCurrencyId, cardTransfers,
  }) => {
    const fallback = json.cashbox || null;
    const receiveCashbox = receiveCashboxId
      ? (boxMap.get(Number(receiveCashboxId))
        || (fallback && Number(fallback.id) === Number(receiveCashboxId) ? fallback : null))
      : null;
    const payCashbox = payCashboxId
      ? (boxMap.get(Number(payCashboxId))
        || (fallback && Number(fallback.id) === Number(payCashboxId) ? fallback : null))
      : null;
    const cashCurrency = cashCurrencyId ? (curMap.get(Number(cashCurrencyId)) || null) : null;
    const enrichedTransfers = cardTransfers.map((split) => ({
      ...split,
      cashbox: boxMap.get(Number(split.cashboxId)) || null,
    }));
    return {
      ...json,
      note: parsed.cleanNote,
      receiveCashboxId,
      payCashboxId,
      receiveCashbox,
      payCashbox,
      cashAmount,
      cashCurrencyId,
      cashCurrency,
      cardTransfers: enrichedTransfers,
    };
  });
}

const cardReaderManualBody = z.object({
  customerName: z.string().trim().min(1, 'نام مشتری را وارد کنید.').max(160),
  phone: z.string().trim().min(1, 'شماره تماس را وارد کنید.').max(40),
  documentNumber: z.string().trim().min(1, 'شماره تذکره / کد ملی را وارد کنید.').max(80),
  cardNumber: z.string().trim().min(1, 'شماره کارت را وارد کنید.').max(80),
  bankName: optionalText(120),
  cardHolderName: optionalText(160),
  kind: z.enum(['note', 'withdrawal', 'deposit'], {
    errorMap: () => ({ message: 'نوع عملیات را انتخاب کنید (واریز یا برداشت).' }),
  }).default('deposit'),
  amount: z.coerce.number({ invalid_type_error: 'مبلغ کارت معتبر نیست.' }).positive('مبلغ کارت باید بیشتر از صفر باشد.'),
  fee: z.coerce.number().min(0).default(0),
  currencyId: z.coerce.number({ invalid_type_error: 'ارز کارت را انتخاب کنید.' }).int().positive('ارز کارت را انتخاب کنید.'),
  cashAmount: z.number().positive().optional().nullable(),
  cashCurrencyId: z.number().int().positive().optional().nullable(),
  cashboxId: z.coerce.number({ invalid_type_error: 'صندوق را انتخاب کنید.' }).int().positive('صندوق را انتخاب کنید.'),
  note: optionalText(2000),
  customerId: z.coerce.number().int().positive().optional().nullable(),
  fingerprintSeed: optionalText(80),
  fingerprintTemplate: z.string().trim().max(200000).optional().nullable(),
  fingerprintFormat: z.string().trim().max(32).optional().default('ZK10'),
  fingerprintConfirmed: z.boolean().default(false),
}).superRefine((data, ctx) => {
  if (data.kind === 'withdrawal') {
    if (data.cashAmount == null || !(Number(data.cashAmount) > 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'مبلغ پرداخت نقد به مشتری را وارد کنید.',
        path: ['cashAmount'],
      });
    }
    if (!data.cashCurrencyId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'ارز پرداخت نقد به مشتری را انتخاب کنید.',
        path: ['cashCurrencyId'],
      });
    }
  }
});

function uploadFields(req, res, next) {
  cardReaderUpload.fields([
    { name: 'photo', maxCount: 1 },
    { name: 'fingerprint', maxCount: 1 },
  ])(req, res, (err) => {
    if (err) return next(err instanceof AppError ? err : new AppError(err.message || 'آپلود ناموفق.', 400));
    return next();
  });
}

function displayName(row) {
  return row.customerName || row.customer?.name || `#${row.id}`;
}

function kindLabel(kind) {
  if (kind === 'withdrawal') return 'برداشت';
  if (kind === 'note') return 'رسیده گی';
  return 'واریز';
}

function isCardReaderCustomer(customer) {
  return Boolean(customer) && String(customer.source || '') === 'card_reader';
}

function assertCardReaderCustomer(customer, message = 'این مشتری متعلق به کارت‌خوان نیست.') {
  if (!isCardReaderCustomer(customer)) throw new AppError(message, 404);
}

function cardReaderEntryCustomerScope() {
  return {
    [Op.or]: [
      { customerId: null },
      { '$customer.source$': 'card_reader' },
    ],
  };
}

async function resolveCustomer(body) {
  if (body.customerId) {
    const existing = await Customer.findByPk(body.customerId);
    if (!existing) throw new AppError('مشتری پیدا نشد.', 404);
    assertCardReaderCustomer(existing);
    return existing;
  }
  const byPhone = await Customer.findOne({ where: { phone: body.phone, source: 'card_reader' } });
  if (byPhone) {
    await byPhone.update({
      name: body.customerName || byPhone.name,
      documentNumber: body.documentNumber || byPhone.documentNumber,
    });
    return byPhone;
  }
  return Customer.create({
    name: body.customerName,
    phone: body.phone,
    documentNumber: body.documentNumber || null,
    documentType: 'تذکره',
    trustLevel: 'عادی',
    state: 'تأیید شده',
    source: 'card_reader',
    viewToken: randomBytes(24).toString('hex'),
  });
}

async function enrollCustomerFingerprint(
  customer,
  {
    fingerFile = null,
    fingerprintHash = null,
    fingerprintSeed = null,
    fingerprintTemplate = null,
    fingerprintFormat = 'ZK10',
  } = {},
) {
  if (!customer) return;

  if (fingerprintTemplate) {
    // Exact duplicate protection is only a last server-side guard.
    // Real biometric matching is performed by the local ZKFinger SDK bridge.
    const templateOwner = await Customer.findOne({
      where: { fingerprintTemplate, source: 'card_reader' },
    });
    if (templateOwner && Number(templateOwner.id) !== Number(customer.id)) {
      throw new AppError('این اثر انگشت قبلاً برای مشتری دیگری ثبت شده است.', 409);
    }
  }

  if (fingerprintHash) {
    const hashOwner = await Customer.findOne({ where: { fingerprintHash, source: 'card_reader' } });
    if (hashOwner && Number(hashOwner.id) !== Number(customer.id)) {
      // Do not use image hash as biometric identity. Only reject exact duplicate upload.
      throw new AppError('این فایل اثر انگشت قبلاً برای مشتری دیگری ثبت شده است.', 409);
    }
  }

  if (fingerprintSeed) {
    const seedOwner = await Customer.findOne({ where: { fingerprintSeed, source: 'card_reader' } });
    if (seedOwner && Number(seedOwner.id) !== Number(customer.id)) {
      throw new AppError('شناسه قدیمی اثر انگشت متعلق به مشتری دیگری است.', 409);
    }
  }

  const patch = {};

  if (fingerFile) {
    const fingerprintUrl = publicCardReaderUrl(fingerFile.filename);
    if (fingerprintUrl) patch.fingerprintUrl = fingerprintUrl;
  }
  if (fingerprintHash) patch.fingerprintHash = fingerprintHash;
  if (fingerprintSeed) patch.fingerprintSeed = fingerprintSeed;
  if (fingerprintTemplate) {
    patch.fingerprintTemplate = fingerprintTemplate;
    patch.fingerprintFormat = fingerprintFormat || 'ZK10';
  }

  if (Object.keys(patch).length) {
    await customer.update(patch);
  }
}

async function loadCustomerBalances(customerId) {
  if (!customerId) return [];
  const rows = await CustomerBalance.findAll({
    where: { customerId },
    include: [{ association: 'currency', required: false }],
    order: [['id', 'ASC']],
  });
  return rows
    .map((row) => {
      const json = row.toJSON ? row.toJSON() : row;
      return {
        currencyId: json.currencyId,
        amount: Number(json.amount || 0),
        currency: json.currency
          ? {
            id: json.currency.id,
            code: json.currency.code,
            name: json.currency.name,
            symbol: json.currency.symbol,
          }
          : null,
      };
    })
    .filter((b) => Number(b.amount) !== 0);
}

async function buildIdentityPayload(customer, card = {}) {
  if (!customer) return null;
  const balances = await loadCustomerBalances(customer.id);
  const fingerprintUrl = customer.fingerprintUrl || card.fingerprintUrl || null;
  const rawPhoto = customer.avatarUrl || card.photoUrl || null;
  return {
    customerId: customer.id,
    customerName: customer.name,
    phone: customer.phone,
    documentNumber: customer.documentNumber,
    cardNumber: card.cardNumber || null,
    bankName: card.bankName || null,
    cardHolderName: card.cardHolderName || null,
    // Never fall back to fingerprint image as the face photo
    photoUrl: rawPhoto && rawPhoto !== fingerprintUrl ? rawPhoto : null,
    fingerprintUrl,
    fingerprintSeed: customer.fingerprintSeed || null,
    fingerprintFormat: customer.fingerprintFormat || 'ZK10',
    balances,
  };
}

function buildLedgerNote(body) {
  const parts = [
    `کارت‌خوان (${kindLabel(body.kind)})`,
    body.cardNumber ? `کارت: ${body.cardNumber}` : null,
    body.bankName ? `بانک: ${body.bankName}` : null,
    body.cardHolderName ? `صاحب کارت: ${body.cardHolderName}` : null,
    Number(body.fee) > 0 ? `کارمزد: ${body.fee}` : null,
    body.note || null,
  ].filter(Boolean);
  return parts.join(' | ');
}

async function loadEntry(id) {
  const row = await CardReaderEntry.findByPk(id, {
    include: ['customer', 'currency', 'cashbox'],
  });
  if (!row) return null;
  const [enriched] = await enrichCardReaderEntries([row]);
  return enriched;
}

async function latestCardDetailsForIdentity({ customerId, fingerprintHash, fallbackEntry = null }) {
  let latest = fallbackEntry;
  if (!latest && customerId) {
    latest = await CardReaderEntry.findOne({
      where: { customerId },
      order: [['id', 'DESC']],
    });
  }
  if (!latest && fingerprintHash) {
    latest = await CardReaderEntry.findOne({
      where: { fingerprintHash },
      order: [['id', 'DESC']],
    });
  }
  if (!latest) {
    return {
      cardNumber: null,
      bankName: null,
      cardHolderName: null,
      photoUrl: null,
      fingerprintUrl: null,
    };
  }
  return {
    cardNumber: latest.cardNumber || null,
    bankName: latest.bankName || null,
    cardHolderName: latest.cardHolderName || null,
    photoUrl: latest.photoUrl || null,
    fingerprintUrl: latest.fingerprintUrl || null,
  };
}

async function findByFingerprintHash(hash) {
  if (!hash) return null;
  const customer = await Customer.findOne({ where: { fingerprintHash: hash, source: 'card_reader' } });
  if (customer) {
    const card = await latestCardDetailsForIdentity({
      customerId: customer.id,
      fingerprintHash: hash,
    });
    return {
      matched: true,
      source: 'customer',
      customer,
      identity: await buildIdentityPayload(customer, card),
    };
  }
  const entry = await CardReaderEntry.findOne({
    where: { fingerprintHash: hash },
    include: [{ association: 'customer', required: false }],
    order: [['id', 'DESC']],
  });
  if (!entry) return null;
  const card = await latestCardDetailsForIdentity({
    customerId: entry.customerId || entry.customer?.id || null,
    fingerprintHash: hash,
    fallbackEntry: entry,
  });
  const linked = entry.customer || (entry.customerId ? await Customer.findByPk(entry.customerId) : null);
  if (isCardReaderCustomer(linked)) {
    return {
      matched: true,
      source: 'entry',
      customer: linked,
      identity: await buildIdentityPayload(linked, {
        ...card,
        cardNumber: card.cardNumber || entry.cardNumber,
        bankName: card.bankName || entry.bankName,
        cardHolderName: card.cardHolderName || entry.cardHolderName,
        photoUrl: (() => {
          const p = entry.photoUrl || card.photoUrl || null;
          const f = entry.fingerprintUrl || card.fingerprintUrl || null;
          return p && p !== f ? p : null;
        })(),
        fingerprintUrl: entry.fingerprintUrl || card.fingerprintUrl,
      }),
    };
  }
  return {
    matched: true,
    source: 'entry',
    customer: null,
    identity: {
      customerId: null,
      customerName: entry.customerName || null,
      phone: entry.phone || null,
      documentNumber: entry.documentNumber || null,
      cardNumber: card.cardNumber || entry.cardNumber || null,
      bankName: card.bankName || entry.bankName || null,
      cardHolderName: card.cardHolderName || entry.cardHolderName || null,
      photoUrl: (() => {
        const p = entry.photoUrl || card.photoUrl || null;
        const f = entry.fingerprintUrl || card.fingerprintUrl || null;
        return p && p !== f ? p : null;
      })(),
      fingerprintUrl: entry.fingerprintUrl || card.fingerprintUrl || null,
      balances: [],
    },
  };
}

router.get('/card-reader', requirePermission('customers'), asyncHandler(async (req, res) => {
  const { page, limit, offset } = pageInfo(req.query);
  const search = String(req.query.search || '').trim();
  const clauses = [dateRangeWhere(req.query), cardReaderEntryCustomerScope()];
  if (['note', 'withdrawal', 'deposit'].includes(req.query.kind)) {
    clauses.push({ kind: req.query.kind });
  }
  if (search) {
    clauses.push(searchWhere(search, [
      'customerName', 'phone', 'documentNumber', 'cardNumber', 'bankName', 'cardHolderName', 'note',
    ]));
  }
  const where = clauses.length === 1 ? clauses[0] : { [Op.and]: clauses };
  const result = await CardReaderEntry.findAndCountAll({
    where,
    include: [
      { association: 'customer', required: false },
      { association: 'currency', required: false },
      { association: 'cashbox', required: false },
    ],
    order: [['id', 'DESC']],
    limit,
    offset,
    distinct: true,
  });
  const enrichedRows = await enrichCardReaderEntries(result.rows);
  res.json({
    success: true,
    data: paginationResult({ rows: enrichedRows, count: result.count }, page, limit),
  });
}));

router.get('/card-reader/lookup-card', requirePermission('customers'), asyncHandler(async (req, res) => {
  const normalizeCardNumber = (value) => String(value || '').replace(/[\s-]+/g, '').trim();
  const cardNumber = normalizeCardNumber(req.query.cardNumber);
  if (!cardNumber) throw new AppError('شماره کارت را وارد کنید.', 400);

  const candidates = await CardReaderEntry.findAll({
    where: {
      cardNumber: { [Op.ne]: null },
    },
    include: [{ association: 'customer', required: false }],
    order: [['id', 'DESC']],
    limit: 500,
  });

  const entry = candidates.find(
    (row) => normalizeCardNumber(row.cardNumber) === cardNumber,
  );

  if (!entry) {
    return res.json({
      success: true,
      data: { matched: false, identity: null, balances: [] },
      message: 'کارتی با این شماره پیدا نشد.',
    });
  }

  const linkedCustomer = entry.customer
    || (entry.customerId ? await Customer.findByPk(entry.customerId) : null);
  const customer = isCardReaderCustomer(linkedCustomer) ? linkedCustomer : null;

  const card = {
    cardNumber: entry.cardNumber,
    bankName: entry.bankName,
    cardHolderName: entry.cardHolderName,
    photoUrl: entry.photoUrl,
    fingerprintUrl: entry.fingerprintUrl,
  };

  const identity = customer
    ? await buildIdentityPayload(customer, card)
    : {
      customerId: entry.customerId || null,
      customerName: entry.customerName || null,
      phone: entry.phone || null,
      documentNumber: entry.documentNumber || null,
      ...card,
      balances: [],
    };

  res.json({
    success: true,
    data: {
      matched: true,
      identity,
      balances: identity.balances || [],
    },
    message: identity.customerName
      ? `کارت متعلق به ${identity.customerName}`
      : 'کارت پیدا شد.',
  });
}));

router.post('/card-reader/identify-fingerprint', requirePermission('customers'), uploadFields, asyncHandler(async (req, res) => {
  const fingerFile = req.files?.fingerprint?.[0];
  if (!fingerFile) throw new AppError('اثر انگشت ارسال نشد.', 400);
  const hash = await hashFingerprintFile(fingerFile.path);
  const found = await findByFingerprintHash(hash);
  const scanUrl = publicCardReaderUrl(fingerFile.filename);
  if (!found) {
    return res.json({
      success: true,
      data: {
        matched: false,
        fingerprintHash: hash,
        fingerprintUrl: scanUrl,
        identity: null,
      },
      message: 'اثر انگشت جدید است؛ مشتری شناسایی نشد.',
    });
  }
  res.json({
    success: true,
    data: {
      matched: true,
      fingerprintHash: hash,
      fingerprintUrl: scanUrl,
      source: found.source,
      identity: found.identity,
      customer: found.customer,
    },
    message: `شناسایی شد: ${found.identity.customerName}`,
  });
}));

router.post('/card-reader/identify-by-seed', requirePermission('customers'), asyncHandler(async (req, res) => {
  const seed = String(req.body?.seed || '').trim();
  if (!seed) throw new AppError('شناسه اثر انگشت نامعتبر است.', 400);

  const customer = await Customer.findOne({ where: { fingerprintSeed: seed, source: 'card_reader' } });
  if (!customer) {
    return res.json({
      success: true,
      data: { matched: false, identity: null },
      message: 'اثر انگشت در سامانه پیدا نشد.',
    });
  }

  const card = await latestCardDetailsForIdentity({
    customerId: customer.id,
    fingerprintHash: customer.fingerprintHash,
  });
  const identity = await buildIdentityPayload(customer, card);
  res.json({
    success: true,
    data: {
      matched: true,
      source: 'seed',
      identity,
      customer,
    },
    message: `شناسایی شد: ${identity.customerName}`,
  });
}));

router.post('/card-reader/customer/:id/fingerprint-image', requirePermission('customers'), uploadFields, asyncHandler(async (req, res) => {
  const customerId = Number(req.params.id);
  if (!Number.isInteger(customerId) || customerId <= 0) {
    throw new AppError('شناسه مشتری نامعتبر است.', 400);
  }

  const customer = await Customer.findByPk(customerId);
  if (!customer) throw new AppError('مشتری پیدا نشد.', 404);
  assertCardReaderCustomer(customer);

  const fingerFile = req.files?.fingerprint?.[0];
  if (!fingerFile) throw new AppError('تصویر اثر انگشت ارسال نشده است.', 400);

  const fingerprintUrl = publicCardReaderUrl(fingerFile.filename);
  const fingerprintHash = await hashFingerprintFile(fingerFile.path);

  await customer.update({ fingerprintUrl, fingerprintHash });

  const latest = await CardReaderEntry.findOne({
    where: { customerId },
    order: [['id', 'DESC']],
  });
  if (latest && !latest.fingerprintUrl) {
    await latest.update({ fingerprintUrl, fingerprintHash });
  }

  const card = await latestCardDetailsForIdentity({ customerId });
  const identity = await buildIdentityPayload(customer, {
    ...card,
    fingerprintUrl,
  });

  res.json({
    success: true,
    data: { identity },
    message: 'تصویر اثر انگشت مشتری ذخیره شد.',
  });
}));

router.post('/card-reader', requirePermission('customers'), uploadFields, asyncHandler(async (req, res) => {
  const parsed = cardReaderManualBody.safeParse(parseCardReaderBody(req.body));
  if (!parsed.success) {
    const msg = parsed.error.issues?.[0]?.message || 'اطلاعات ناقص است.';
    throw new AppError(msg, 400);
  }
  const body = parsed.data;
  const raw = parseCardReaderBody(req.body);
  // کارت من همیشه receiveCashbox؛ صندوق نقد فقط برای برداشت
  const cardTransfers = body.kind === 'withdrawal' ? (raw.cardTransfers || []) : [];
  const receiveCashboxId = cardTransfers[0]?.cashboxId
    || raw.receiveCashboxId
    || body.cashboxId
    || null;
  const payCashboxId = body.kind === 'withdrawal'
    ? (raw.payCashboxId || null)
    : null;
  body.cashAmount = body.kind === 'withdrawal' ? (raw.cashAmount ?? body.cashAmount) : null;
  body.cashCurrencyId = body.kind === 'withdrawal' ? (raw.cashCurrencyId ?? body.cashCurrencyId) : null;
  if (body.kind === 'withdrawal' && cardTransfers.length) {
    const splitSum = cardTransfers.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    body.amount = splitSum;
  }
  if (!body.fingerprintConfirmed) {
    throw new AppError('تأیید اثر انگشت ضروری است.', 400);
  }
  const currency = await Currency.findByPk(body.currencyId);
  if (!currency) throw new AppError('ارز کارت پیدا نشد.', 404);
  if (body.kind === 'withdrawal' && body.cashCurrencyId) {
    const cashCurrency = await Currency.findByPk(body.cashCurrencyId);
    if (!cashCurrency) throw new AppError('ارز پرداخت نقد پیدا نشد.', 404);
  }

  const photoFile = req.files?.photo?.[0];
  const fingerFile = req.files?.fingerprint?.[0];

  // Existing enrolled customer (matched by ZK4500) may submit without re-uploading
  // a fresh template/image — required so withdrawal registration does not fail.
  let enrolledCustomer = null;
  if (!fingerFile && !body.fingerprintTemplate) {
    if (body.customerId) {
      enrolledCustomer = await Customer.findByPk(body.customerId);
      if (enrolledCustomer) assertCardReaderCustomer(enrolledCustomer);
    }
    if (!enrolledCustomer?.fingerprintTemplate
      && !enrolledCustomer?.fingerprintHash
      && !enrolledCustomer?.fingerprintUrl) {
      throw new AppError('Template واقعی اثر انگشت ZK4500 ضروری است.', 400);
    }
  }
  const fingerprintHash = fingerFile ? await hashFingerprintFile(fingerFile.path) : null;

  const byFinger = fingerprintHash ? await findByFingerprintHash(fingerprintHash) : null;
  if (byFinger?.identity?.customerId) {
    if (body.customerId && Number(body.customerId) !== Number(byFinger.identity.customerId)) {
      throw new AppError('این اثر انگشت متعلق به مشتری دیگری است.', 409);
    }
    if (!body.customerId) body.customerId = byFinger.identity.customerId;
  }

  const customer = enrolledCustomer && Number(enrolledCustomer.id) === Number(body.customerId)
    ? enrolledCustomer
    : await resolveCustomer(body);
  const fingerScanUrl = fingerFile ? publicCardReaderUrl(fingerFile.filename) : null;
  let photoUrl = photoFile ? publicCardReaderUrl(photoFile.filename) : (customer.avatarUrl || null);
  if (photoUrl && (photoUrl === fingerScanUrl || photoUrl === customer.fingerprintUrl)) {
    photoUrl = customer.avatarUrl || null;
  }
  if (photoUrl && byFinger?.identity?.fingerprintUrl && photoUrl === byFinger.identity.fingerprintUrl) {
    photoUrl = customer.avatarUrl || null;
  }

  const {
    primaryLedger,
    ledgerCashboxId,
    payLedgerEntryId,
    cashAmount,
    cashCurrencyId,
    cardSplits,
  } = await createCardReaderCashboxLedgers(customer.id, body, {
    receiveCashboxId,
    payCashboxId,
    cardTransfers,
    req,
    user: req.user,
  });
  body.cashboxId = ledgerCashboxId;

  const fingerprintUrl = fingerScanUrl;
  await enrollCustomerFingerprint(customer, {
    fingerFile,
    fingerprintHash,
    fingerprintSeed: body.fingerprintSeed,
    fingerprintTemplate: body.fingerprintTemplate,
    fingerprintFormat: body.fingerprintFormat,
  });
  await customer.reload();

  const row = await CardReaderEntry.create({
    customerId: customer.id,
    customerName: body.customerName,
    phone: body.phone,
    documentNumber: body.documentNumber,
    cardNumber: body.cardNumber,
    bankName: body.bankName,
    cardHolderName: body.cardHolderName,
    photoUrl,
    fingerprintUrl,
    fingerprintHash,
    fingerprintTemplate: body.fingerprintTemplate,
    fingerprintFormat: body.fingerprintFormat || 'ZK10',
    fingerprintConfirmed: true,
    kind: body.kind === 'note' ? 'deposit' : body.kind,
    amount: body.amount,
    fee: body.fee || 0,
    currencyId: body.currencyId,
    cashboxId: ledgerCashboxId,
    ledgerEntryId: primaryLedger.id || primaryLedger.entry?.id || null,
    note: encodeCardReaderCashboxNote(body.note, receiveCashboxId, payCashboxId, {
      payLedgerEntryId,
      cashAmount,
      cashCurrencyId,
      cardSplits,
    }),
    createdByName: req.user?.name || null,
  });

  const full = await loadEntry(row.id);
  const identity = await buildIdentityPayload(customer, {
    cardNumber: body.cardNumber,
    bankName: body.bankName,
    cardHolderName: body.cardHolderName,
    photoUrl,
    fingerprintUrl,
  });
  const fullJson = full?.toJSON ? full.toJSON() : full;
  await writeAudit({ req, user: req.user, action: `تراکنش کارت‌خوان (${kindLabel(body.kind)}): ${body.customerName}` });
  emitChange(req, 'card-reader:changed', { id: row.id });
  emitChange(req, 'accounts:changed', { customerId: customer.id });
  emitChange(req, 'balances:changed');
  res.status(201).json({
    success: true,
    data: { ...fullJson, identity },
    message: body.kind === 'withdrawal'
      ? 'برداشت ثبت شد: به کارت من اضافه و نقد از صندوق به مشتری پرداخت شد.'
      : 'واریز ثبت شد: از کارت من به کارت مشتری پرداخت شد.',
  });
}));

router.put('/card-reader/:id', requirePermission('customers'), uploadFields, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new AppError('شناسه نامعتبر است.', 400);
  const row = await CardReaderEntry.findByPk(id);
  if (!row) throw new AppError('رکورد پیدا نشد.', 404);
  const parsed = cardReaderManualBody.safeParse(parseCardReaderBody(req.body));
  if (!parsed.success) {
    const msg = parsed.error.issues?.[0]?.message || 'اطلاعات ناقص است.';
    throw new AppError(msg, 400);
  }
  const body = parsed.data;
  const raw = parseCardReaderBody(req.body);
  const cardTransfers = body.kind === 'withdrawal' ? (raw.cardTransfers || []) : [];
  const receiveCashboxId = cardTransfers[0]?.cashboxId
    || raw.receiveCashboxId
    || body.cashboxId
    || null;
  const payCashboxId = body.kind === 'withdrawal'
    ? (raw.payCashboxId || null)
    : null;
  body.cashAmount = body.kind === 'withdrawal' ? (raw.cashAmount ?? body.cashAmount) : null;
  body.cashCurrencyId = body.kind === 'withdrawal' ? (raw.cashCurrencyId ?? body.cashCurrencyId) : null;
  if (body.kind === 'withdrawal' && cardTransfers.length) {
    const splitSum = cardTransfers.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    body.amount = splitSum;
  }
  if (!body.fingerprintConfirmed && !row.fingerprintConfirmed) {
    throw new AppError('تأیید اثر انگشت ضروری است.', 400);
  }
  const currency = await Currency.findByPk(body.currencyId);
  if (!currency) throw new AppError('ارز کارت پیدا نشد.', 404);
  if (body.kind === 'withdrawal' && body.cashCurrencyId) {
    const cashCurrency = await Currency.findByPk(body.cashCurrencyId);
    if (!cashCurrency) throw new AppError('ارز پرداخت نقد پیدا نشد.', 404);
  }

  const photoFile = req.files?.photo?.[0];
  const fingerFile = req.files?.fingerprint?.[0];

  const previousPhoto = row.photoUrl;
  const previousFinger = row.fingerprintUrl;
  let fingerprintHash = row.fingerprintHash || null;
  let fingerprintUrl = row.fingerprintUrl;
  if (fingerFile) {
    fingerprintHash = await hashFingerprintFile(fingerFile.path);
    fingerprintUrl = publicCardReaderUrl(fingerFile.filename);
    if (row.customerId) {
      const customer = await Customer.findByPk(row.customerId);
      if (customer) await enrollCustomerFingerprint(customer, {
        fingerFile,
        fingerprintHash,
        fingerprintSeed: body.fingerprintSeed,
        fingerprintTemplate: body.fingerprintTemplate,
        fingerprintFormat: body.fingerprintFormat,
      });
    }
  }

  if (body.fingerprintTemplate && row.customerId && !fingerFile) {
    const customer = await Customer.findByPk(row.customerId);
    if (customer) {
      await enrollCustomerFingerprint(customer, {
        fingerprintTemplate: body.fingerprintTemplate,
        fingerprintFormat: body.fingerprintFormat,
      });
    }
  }

  // Reverse previous cashbox movements, then apply updated amount/currency/cashboxes.
  await reverseCardReaderLedgers(row, { req, user: req.user });

  const customer = body.customerId
    ? await Customer.findByPk(body.customerId)
    : (row.customerId ? await Customer.findByPk(row.customerId) : await resolveCustomer(body));
  if (!customer) throw new AppError('مشتری پیدا نشد.', 404);
  assertCardReaderCustomer(customer);

  const {
    primaryLedger,
    ledgerCashboxId,
    payLedgerEntryId,
    cashAmount,
    cashCurrencyId,
    cardSplits,
  } = await createCardReaderCashboxLedgers(customer.id, body, {
    receiveCashboxId,
    payCashboxId,
    cardTransfers,
    req,
    user: req.user,
  });

  await row.update({
    customerId: customer.id,
    customerName: body.customerName,
    phone: body.phone,
    documentNumber: body.documentNumber,
    cardNumber: body.cardNumber,
    bankName: body.bankName,
    cardHolderName: body.cardHolderName,
    photoUrl: photoFile ? publicCardReaderUrl(photoFile.filename) : row.photoUrl,
    fingerprintUrl,
    fingerprintHash,
    fingerprintTemplate: body.fingerprintTemplate || row.fingerprintTemplate,
    fingerprintFormat: body.fingerprintFormat || row.fingerprintFormat || 'ZK10',
    fingerprintConfirmed: body.fingerprintConfirmed || row.fingerprintConfirmed,
    kind: body.kind === 'note' ? 'deposit' : body.kind,
    amount: body.amount,
    fee: body.fee || 0,
    currencyId: body.currencyId,
    cashboxId: ledgerCashboxId,
    ledgerEntryId: primaryLedger.id || primaryLedger.entry?.id || null,
    note: encodeCardReaderCashboxNote(body.note, receiveCashboxId, payCashboxId, {
      payLedgerEntryId,
      cashAmount,
      cashCurrencyId,
      cardSplits,
    }),
  });
  if (photoFile && previousPhoto) unlinkCardReaderFile(previousPhoto);
  if (fingerFile && previousFinger) unlinkCardReaderFile(previousFinger);
  const full = await loadEntry(row.id);
  await writeAudit({ req, user: req.user, action: `اصلاح کارت‌خوان: ${body.customerName}` });
  emitChange(req, 'card-reader:changed', { id: row.id });
  emitChange(req, 'accounts:changed', { customerId: customer.id });
  emitChange(req, 'balances:changed');
  res.json({
    success: true,
    data: full,
    message: body.kind === 'withdrawal'
      ? 'اصلاح شد: کارت من و صندوق نقد به‌روز گردید.'
      : 'اصلاح شد: از کارت من به کارت مشتری به‌روز گردید.',
  });
}));

router.get('/card-reader/fingerprint-enrollments', requirePermission('customers'), asyncHandler(async (_req, res) => {
  const customers = await Customer.findAll({
    where: {
      source: 'card_reader',
      fingerprintTemplate: { [Op.ne]: null },
    },
    attributes: [
      'id',
      'name',
      'phone',
      'documentNumber',
      'avatarUrl',
      'fingerprintUrl',
      'fingerprintTemplate',
      'fingerprintFormat',
      'updatedAt',
    ],
    order: [['updatedAt', 'DESC']],
    limit: 5000,
  });

  const customerIds = customers.map((c) => c.id);
  const latestEntries = customerIds.length
    ? await CardReaderEntry.findAll({
      where: { customerId: { [Op.in]: customerIds } },
      order: [['id', 'DESC']],
    })
    : [];

  const latestByCustomer = new Map();
  for (const entry of latestEntries) {
    const cid = Number(entry.customerId);
    if (!latestByCustomer.has(cid)) latestByCustomer.set(cid, entry);
  }

  const data = [];
  for (const customer of customers) {
    const entry = latestByCustomer.get(Number(customer.id));
    const fingerprintUrl = customer.fingerprintUrl || entry?.fingerprintUrl || null;
    const rawPhoto = customer.avatarUrl || entry?.photoUrl || null;

    data.push({
      customerId: customer.id,
      customerName: customer.name,
      phone: customer.phone,
      documentNumber: customer.documentNumber,
      cardNumber: entry?.cardNumber || null,
      bankName: entry?.bankName || null,
      cardHolderName: entry?.cardHolderName || null,
      photoUrl: rawPhoto && rawPhoto !== fingerprintUrl ? rawPhoto : null,
      fingerprintUrl,
      fingerprintTemplate: customer.fingerprintTemplate,
      fingerprintFormat: customer.fingerprintFormat || 'ZK10',
      balances: await loadCustomerBalances(customer.id),
    });
  }

  res.json({ success: true, data });
}));

router.delete('/card-reader/:id', requirePermission('customers'), validate(wrap(empty, idParams)), asyncHandler(async (req, res) => {
  const row = await CardReaderEntry.findByPk(req.validated.params.id, { include: ['customer'] });
  if (!row) throw new AppError('رکورد پیدا نشد.', 404);
  const customerId = row.customerId;
  if (row.ledgerEntryId || parseCardReaderCashboxNote(row.note).payLedgerEntryId) {
    await reverseCardReaderLedgers(row, { req, user: req.user });
    if (customerId) emitChange(req, 'accounts:changed', { customerId });
    emitChange(req, 'balances:changed');
  }
  unlinkCardReaderFile(row.photoUrl);
  unlinkCardReaderFile(row.fingerprintUrl);
  await row.destroy();
  await writeAudit({ req, user: req.user, action: `حذف کارت‌خوان: ${displayName(row)}` });
  emitChange(req, 'card-reader:changed', { id: row.id });
  res.json({ success: true, message: 'حذف شد و در صورت نیاز از صندوق برگشت داده شد.' });
}));

const receiptBody = z.object({
  customerId: z.coerce.number().int().positive().optional().nullable(),
  customerName: z.string().trim().min(2).max(120).optional().nullable(),
  phone: z.string().trim().max(30).optional().nullable(),
  fatherName: z.string().trim().max(120).optional().nullable(),
  address: z.string().trim().max(255).optional().nullable(),
  documentNumber: z.string().trim().max(80).optional().nullable(),
  cashboxId: z.coerce.number().int().positive(),
  currencyId: z.coerce.number().int().positive(),
  amount: z.coerce.number().positive(),
  note: optionalText(500),
}).superRefine((data, ctx) => {
  if (!data.customerId && !String(data.customerName || '').trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'مشتری را انتخاب کنید یا نام بنویسید.', path: ['customerId'] });
  }
});

const withdrawalBody = z.object({
  customerId: z.coerce.number().int().positive().optional().nullable(),
  customerName: z.string().trim().min(2).max(120).optional().nullable(),
  phone: z.string().trim().max(30).optional().nullable(),
  fatherName: z.string().trim().max(120).optional().nullable(),
  address: z.string().trim().max(255).optional().nullable(),
  documentNumber: z.string().trim().max(80).optional().nullable(),
  cashboxId: z.coerce.number().int().positive(),
  currencyId: z.coerce.number().int().positive(),
  amount: z.coerce.number().positive(),
  note: optionalText(2000),
}).superRefine((data, ctx) => {
  if (!data.customerId && !String(data.customerName || '').trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'مشتری را انتخاب کنید یا نام بنویسید.', path: ['customerId'] });
  }
});

async function resolveReceiptsCustomer(body) {
  if (body.customerId) {
    const existing = await Customer.findByPk(body.customerId);
    if (!existing) throw new AppError('مشتری پیدا نشد.', 404);
    return existing;
  }
  const name = String(body.customerName || '').trim();
  if (name.length < 2) throw new AppError('نام مشتری را وارد کنید.', 400);
  const phone = String(body.phone || '').trim();
  return Customer.create({
    name,
    phone: phone || 'بدون‌شماره',
    fatherName: String(body.fatherName || '').trim() || null,
    address: String(body.address || '').trim() || null,
    documentNumber: String(body.documentNumber || '').trim() || null,
    documentType: 'تذکره',
    trustLevel: 'عادی',
    state: 'تأیید شده',
    source: 'manual',
    viewToken: randomBytes(24).toString('hex'),
  });
}

/** Real card-reader ops vs plain «برده گی» rows stored in the same table. */
const CARD_READER_NOTE_NOT = {
  [Op.and]: [
    { [Op.or]: [{ note: null }, { note: { [Op.notLike]: '%ZH_RECV:%' } }] },
    { [Op.or]: [{ note: null }, { note: { [Op.notLike]: '%ZH_PAY:%' } }] },
    { [Op.or]: [{ note: null }, { note: { [Op.notLike]: '%ZH_CASH:%' } }] },
    { [Op.or]: [{ note: null }, { note: { [Op.notLike]: '%ZH_CB0%' } }] },
    { [Op.or]: [{ note: null }, { note: { [Op.notLike]: '%کارت مشتری%' } }] },
    { [Op.or]: [{ note: null }, { note: { [Op.notLike]: '%کارت من%' } }] },
  ],
};

function receiptListWhere(query) {
  return {
    type: 'received',
    ...dateRangeWhere(query),
    ...CARD_READER_NOTE_NOT,
  };
}

function withdrawalListWhere(query, search = '') {
  const where = {
    kind: 'withdrawal',
    ...dateRangeWhere(query),
    cardNumber: null,
    fingerprintConfirmed: false,
    [Op.and]: [
      { [Op.or]: [{ note: null }, { note: { [Op.notLike]: '%ZH_RECV:%' } }] },
      { [Op.or]: [{ note: null }, { note: { [Op.notLike]: '%ZH_PAY:%' } }] },
      { [Op.or]: [{ note: null }, { note: { [Op.notLike]: '%ZH_CASH:%' } }] },
    ],
  };
  if (search) {
    Object.assign(where, searchWhere(search, [
      'customerName', 'phone', 'documentNumber', 'note',
    ]));
  }
  return where;
}

function cardReaderListWhere(query, search = '') {
  const where = {
    ...dateRangeWhere(query),
    [Op.or]: [
      { kind: 'deposit' },
      { cardNumber: { [Op.ne]: null } },
      { fingerprintConfirmed: true },
      { fingerprintUrl: { [Op.ne]: null } },
      { note: { [Op.like]: '%ZH_RECV:%' } },
      { note: { [Op.like]: '%ZH_PAY:%' } },
      { note: { [Op.like]: '%ZH_CASH:%' } },
    ],
  };
  if (search) {
    Object.assign(where, searchWhere(search, [
      'customerName', 'phone', 'documentNumber', 'cardNumber', 'note',
    ]));
  }
  return where;
}

function sumRowsByCurrency(rows, baseCurrency) {
  const map = new Map();
  for (const row of rows) {
    const json = row.toJSON ? row.toJSON() : row;
    const currency = json.currency || {};
    const code = currency.code || baseCurrency.code;
    const key = String(currency.id || code);
    const prev = map.get(key) || {
      currencyId: currency.id || null,
      code,
      name: currency.name || code,
      symbol: currency.symbol || '',
      amount: 0,
    };
    prev.amount += Number(json.amount || 0);
    map.set(key, prev);
  }
  return [...map.values()]
    .filter((row) => row.amount !== 0)
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
}

async function receiptsWithdrawalsTotals(query = {}) {
  const search = String(query.search || '');
  const [receiptRows, withdrawalRows, cardReaderRows, rateMap, baseCurrency] = await Promise.all([
    CustomerLedger.findAll({
      where: receiptListWhere(query),
      attributes: ['currencyId', 'amount'],
      include: [{ association: 'currency', attributes: ['id', 'code', 'symbol', 'name'], required: false }],
    }),
    CardReaderEntry.findAll({
      where: withdrawalListWhere(query, search),
      attributes: ['currencyId', 'amount'],
      include: [{ association: 'currency', attributes: ['id', 'code', 'symbol', 'name'], required: false }],
    }),
    CardReaderEntry.findAll({
      where: cardReaderListWhere(query, search),
      attributes: ['currencyId', 'amount'],
      include: [{ association: 'currency', attributes: ['id', 'code', 'symbol', 'name'], required: false }],
    }),
    buildRateToAfnMap(),
    getBaseCurrency(),
  ]);

  const sumInBase = (rows) => rows.reduce((sum, row) => {
    const json = row.toJSON ? row.toJSON() : row;
    const code = json.currency?.code || baseCurrency.code;
    return sum + toBase(Number(json.amount || 0), code, rateMap, baseCurrency.code);
  }, 0);

  const receiptsBase = sumInBase(receiptRows);
  const withdrawalsBase = sumInBase(withdrawalRows);
  const cardReaderBase = sumInBase(cardReaderRows);

  return {
    baseCurrency,
    receiptsBase,
    withdrawalsBase,
    cardReaderBase,
    netBase: receiptsBase - withdrawalsBase,
    receiptsByCurrency: sumRowsByCurrency(receiptRows, baseCurrency),
    withdrawalsByCurrency: sumRowsByCurrency(withdrawalRows, baseCurrency),
    cardReaderByCurrency: sumRowsByCurrency(cardReaderRows, baseCurrency),
  };
}

router.get('/receipts-withdrawals', requirePermission('accounts'), asyncHandler(async (req, res) => {
  const { page, limit, offset } = pageInfo(req.query);
  const kind = req.query.kind || 'all';
  const search = String(req.query.search || '');
  const totals = await receiptsWithdrawalsTotals(req.query);

  if (kind === 'receipt') {
    const where = receiptListWhere(req.query);
    const result = await CustomerLedger.findAndCountAll({
      where,
      include: [
        {
          association: 'customer',
          required: true,
          where: search ? searchWhere(search, ['name', 'fatherName', 'phone']) : undefined,
        },
        'currency',
        'cashbox',
      ],
      order: [['id', 'DESC']],
      limit,
      offset,
    });
    return res.json({
      success: true,
      data: {
        ...paginationResult(result, page, limit),
        rows: result.rows.map((r) => ({ ...r.toJSON(), entryKind: 'receipt' })),
        totals,
      },
    });
  }

  if (kind === 'withdrawal') {
    const result = await CardReaderEntry.findAndCountAll({
      where: withdrawalListWhere(req.query, search),
      include: [
        { association: 'customer', required: false },
        'currency',
        'cashbox',
      ],
      order: [['id', 'DESC']],
      limit,
      offset,
    });
    return res.json({
      success: true,
      data: {
        ...paginationResult(result, page, limit),
        rows: result.rows.map((r) => ({ ...r.toJSON(), entryKind: 'withdrawal' })),
        totals,
      },
    });
  }

  if (kind === 'card_reader') {
    const result = await CardReaderEntry.findAndCountAll({
      where: cardReaderListWhere(req.query, search),
      include: [
        { association: 'customer', required: false },
        'currency',
        'cashbox',
      ],
      order: [['id', 'DESC']],
      limit,
      offset,
    });
    return res.json({
      success: true,
      data: {
        ...paginationResult(result, page, limit),
        rows: result.rows.map((r) => ({
          ...r.toJSON(),
          entryKind: 'card_reader',
          cardReaderKind: r.kind,
        })),
        totals,
      },
    });
  }

  // kind=all → three separate groups (no mixed list)
  const groupLimit = Math.min(Math.max(limit, 10), 50);
  const [receipts, withdrawals, cardReader] = await Promise.all([
    CustomerLedger.findAll({
      where: receiptListWhere(req.query),
      include: [
        {
          association: 'customer',
          required: true,
          where: search ? searchWhere(search, ['name', 'fatherName', 'phone']) : undefined,
        },
        'currency',
        'cashbox',
      ],
      order: [['id', 'DESC']],
      limit: groupLimit,
    }),
    CardReaderEntry.findAll({
      where: withdrawalListWhere(req.query, search),
      include: [
        { association: 'customer', required: false },
        'currency',
        'cashbox',
      ],
      order: [['id', 'DESC']],
      limit: groupLimit,
    }),
    CardReaderEntry.findAll({
      where: cardReaderListWhere(req.query, search),
      include: [
        { association: 'customer', required: false },
        'currency',
        'cashbox',
      ],
      order: [['id', 'DESC']],
      limit: groupLimit,
    }),
  ]);

  const groups = {
    receipts: receipts.map((r) => ({ ...r.toJSON(), entryKind: 'receipt' })),
    withdrawals: withdrawals.map((r) => ({ ...r.toJSON(), entryKind: 'withdrawal' })),
    cardReader: cardReader.map((r) => ({
      ...r.toJSON(),
      entryKind: 'card_reader',
      cardReaderKind: r.kind,
    })),
  };

  res.json({
    success: true,
    data: {
      rows: [
        ...groups.receipts,
        ...groups.withdrawals,
        ...groups.cardReader,
      ],
      groups,
      pagination: {
        page: 1,
        limit: groupLimit,
        total: groups.receipts.length + groups.withdrawals.length + groups.cardReader.length,
        pages: 1,
      },
      totals,
    },
  });
}));

router.post('/receipts-withdrawals/receipt', requirePermission('accounts'), validate(wrap(receiptBody)), asyncHandler(async (req, res) => {
  const body = req.validated.body;
  await assertCashboxAccess(req.user, body.cashboxId, Cashbox);
  const customer = await resolveReceiptsCustomer(body);
  const data = await createCustomerLedgerEntry(customer.id, {
    type: 'received',
    cashboxId: body.cashboxId,
    currencyId: body.currencyId,
    amount: body.amount,
    note: body.note || 'رسید پول مشتری',
  }, { req, user: req.user });
  emitChange(req, 'customers:changed', { id: customer.id });
  emitChange(req, 'accounts:changed', { customerId: customer.id });
  emitChange(req, 'balances:changed');
  emitChange(req, 'card-reader:changed');
  res.status(201).json({ success: true, data, message: 'رسید ثبت شد و به صندوق اضافه گردید.' });
}));

router.put('/receipts-withdrawals/receipt/:id', requirePermission('accounts'), validate(wrap(receiptBody, idParams)), asyncHandler(async (req, res) => {
  const entry = await CustomerLedger.findByPk(req.validated.params.id);
  if (!entry || entry.type !== 'received') throw new AppError('رسید پیدا نشد.', 404);
  const body = req.validated.body;
  await assertCashboxAccess(req.user, body.cashboxId, Cashbox);
  const previousCustomerId = entry.customerId;
  const customer = await resolveReceiptsCustomer(body);

  await deleteCustomerLedgerEntry(entry.id, { req, user: req.user });
  const data = await createCustomerLedgerEntry(customer.id, {
    type: 'received',
    cashboxId: body.cashboxId,
    currencyId: body.currencyId,
    amount: body.amount,
    note: body.note || 'رسید پول مشتری',
  }, { req, user: req.user });

  emitChange(req, 'accounts:changed', { customerId: previousCustomerId });
  if (Number(previousCustomerId) !== Number(customer.id)) {
    emitChange(req, 'accounts:changed', { customerId: customer.id });
  }
  emitChange(req, 'customers:changed', { id: customer.id });
  emitChange(req, 'balances:changed');
  emitChange(req, 'card-reader:changed');
  res.json({ success: true, data, message: 'رسید اصلاح شد و صندوق به‌روز گردید.' });
}));

router.post('/receipts-withdrawals/withdrawal', requirePermission('accounts'), validate(wrap(withdrawalBody)), asyncHandler(async (req, res) => {
  const body = req.validated.body;
  const customer = await resolveReceiptsCustomer(body);
  const currency = await Currency.findByPk(body.currencyId);
  if (!currency) throw new AppError('ارز پیدا نشد.', 404);
  await assertCashboxAccess(req.user, body.cashboxId, Cashbox);

  const ledger = await createCustomerLedgerEntry(customer.id, {
    type: 'paid',
    cashboxId: body.cashboxId,
    currencyId: body.currencyId,
    amount: body.amount,
    note: body.note || 'برده گی پول مشتری',
    allowNegativeCustomerBalance: true,
  }, { req, user: req.user });

  const row = await CardReaderEntry.create({
    customerId: customer.id,
    customerName: customer.name,
    phone: customer.phone || null,
    documentNumber: customer.documentNumber || null,
    cardNumber: null,
    photoUrl: customer.avatarUrl || null,
    fingerprintUrl: null,
    fingerprintConfirmed: false,
    kind: 'withdrawal',
    amount: body.amount,
    fee: 0,
    currencyId: body.currencyId,
    cashboxId: body.cashboxId,
    ledgerEntryId: ledger.id || ledger.entry?.id || null,
    note: body.note || 'برده گی پول مشتری',
    createdByName: req.user?.name || null,
  });
  const full = await loadEntry(row.id);
  await writeAudit({ req, user: req.user, action: `برده گی از صندوق برای ${customer.name}` });
  emitChange(req, 'customers:changed', { id: customer.id });
  emitChange(req, 'accounts:changed', { customerId: customer.id });
  emitChange(req, 'balances:changed');
  emitChange(req, 'card-reader:changed', { id: row.id });
  res.status(201).json({
    success: true,
    data: full,
    message: 'برده گی ثبت شد و از صندوق کم گردید.',
  });
}));

router.put('/receipts-withdrawals/withdrawal/:id', requirePermission('accounts'), validate(wrap(withdrawalBody, idParams)), asyncHandler(async (req, res) => {
  const row = await CardReaderEntry.findByPk(req.validated.params.id);
  if (!row || row.kind !== 'withdrawal') throw new AppError('برده گی پیدا نشد.', 404);
  const body = req.validated.body;
  const customer = await resolveReceiptsCustomer(body);
  const currency = await Currency.findByPk(body.currencyId);
  if (!currency) throw new AppError('ارز پیدا نشد.', 404);
  await assertCashboxAccess(req.user, body.cashboxId, Cashbox);

  // Reverse previous cashbox/ledger movement, then apply the updated amounts.
  if (row.ledgerEntryId) {
    await deleteCustomerLedgerEntry(row.ledgerEntryId, { req, user: req.user });
  }
  const ledger = await createCustomerLedgerEntry(customer.id, {
    type: 'paid',
    cashboxId: body.cashboxId,
    currencyId: body.currencyId,
    amount: body.amount,
    note: body.note || 'برده گی پول مشتری',
    allowNegativeCustomerBalance: true,
  }, { req, user: req.user });

  await row.update({
    customerId: customer.id,
    customerName: customer.name,
    phone: customer.phone || row.phone,
    documentNumber: customer.documentNumber || row.documentNumber,
    amount: body.amount,
    currencyId: body.currencyId,
    cashboxId: body.cashboxId,
    ledgerEntryId: ledger.id || ledger.entry?.id || null,
    note: body.note || row.note,
  });
  const full = await loadEntry(row.id);
  await writeAudit({ req, user: req.user, action: `اصلاح برده گی: ${customer.name}` });
  emitChange(req, 'customers:changed', { id: customer.id });
  emitChange(req, 'accounts:changed', { customerId: customer.id });
  emitChange(req, 'balances:changed');
  emitChange(req, 'card-reader:changed', { id: row.id });
  res.json({ success: true, data: full, message: 'برده گی اصلاح شد و صندوق به‌روز گردید.' });
}));

router.delete('/receipts-withdrawals/receipt/:id', requirePermission('accounts'), validate(wrap(empty, idParams)), asyncHandler(async (req, res) => {
  const entry = await CustomerLedger.findByPk(req.validated.params.id);
  if (!entry || entry.type !== 'received') throw new AppError('رسید پیدا نشد.', 404);
  await deleteCustomerLedgerEntry(entry.id, { req, user: req.user });
  emitChange(req, 'accounts:changed', { customerId: entry.customerId });
  emitChange(req, 'balances:changed');
  emitChange(req, 'card-reader:changed');
  res.json({ success: true, message: 'رسید حذف و از صندوق برگشت داده شد.' });
}));

router.delete('/receipts-withdrawals/withdrawal/:id', requirePermission('accounts'), validate(wrap(empty, idParams)), asyncHandler(async (req, res) => {
  const row = await CardReaderEntry.findByPk(req.validated.params.id, { include: ['customer'] });
  if (!row || row.kind !== 'withdrawal') throw new AppError('برده گی پیدا نشد.', 404);
  const reversed = row.ledgerEntryId
    ? await deleteCustomerLedgerEntryIfExists(row.ledgerEntryId, { req, user: req.user })
    : false;
  if (reversed) {
    emitChange(req, 'accounts:changed', { customerId: row.customerId });
    emitChange(req, 'balances:changed');
  }
  await row.destroy();
  await writeAudit({ req, user: req.user, action: `حذف برده گی: ${displayName(row)}` });
  emitChange(req, 'card-reader:changed', { id: row.id });
  res.json({ success: true, message: 'برده گی حذف و در صورت نیاز به صندوق برگشت داده شد.' });
}));

export default router;
