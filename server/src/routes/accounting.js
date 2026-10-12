import { Router } from 'express';
import { z } from 'zod';
import { Op } from 'sequelize';
import { requirePermission, hasPermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import {
  CashboxBalance, Cashbox, CustomerLedger, JournalEntry, Remittance, Transaction,
} from '../models/index.js';
import {
  assertBranchAccess,
  assertCashboxAccess,
  branchWhere,
  cashboxInclude,
  mergeWhere,
  remittanceWhere,
} from '../utils/branchScope.js';
import {
  calculateTransaction, createMoneyTransaction, createRemittance, findRate,
  payRemittance, reverseMoneyTransaction, updateMoneyTransaction, deleteMoneyTransaction,
  updateRemittance, cancelRemittance,
  listAccountTransferRows, transactionIncludes,
} from '../services/accounting.js';
import { emitChange, pageInfo, paginationResult, searchWhere } from './common.js';

const router = Router();
const empty = z.object({});
const queryAny = z.record(z.string(), z.any()).optional().default({});
const wrap = (body, params = empty, query = queryAny) => z.object({ body, params, query });
const idParams = z.object({ id: z.coerce.number().int().positive() });

const transactionFields = {
  kind: z.enum(['buy','sell','exchange']),
  customerId: z.coerce.number().int().positive().optional().nullable(),
  branchId: z.coerce.number().int().positive(),
  cashboxId: z.coerce.number().int().positive(),
  fromCurrencyId: z.coerce.number().int().positive(),
  toCurrencyId: z.coerce.number().int().positive(),
  fromAmount: z.coerce.number().positive(),
  rate: z.coerce.number().positive().optional(),
  toAmount: z.coerce.number().positive().optional(),
  fee: z.coerce.number().min(0).default(0),
  note: z.string().trim().max(1000).optional().nullable(),
};

const transactionCalculateBody = z.object({
  fromCurrencyId: transactionFields.fromCurrencyId,
  toCurrencyId: transactionFields.toCurrencyId,
  fromAmount: transactionFields.fromAmount,
  rate: z.coerce.number().positive(),
  fee: transactionFields.fee,
});

const transactionBody = z.object(transactionFields).superRefine((data, ctx) => {
  const hasRate = data.rate != null && Number(data.rate) > 0;
  const hasToAmount = data.toAmount != null && Number(data.toAmount) > 0;
  if (!hasRate && !hasToAmount) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'نرخ یا مبلغ پرداختی را وارد کنید.',
      path: ['rate'],
    });
  }
});

router.post('/transactions/calculate', validate(wrap(transactionCalculateBody)), asyncHandler(async(req,res)=>{
  const data=await calculateTransaction(req.validated.body); res.json({success:true,data:{toAmount:data.toAmount,fromCurrency:data.fromCurrency,toCurrency:data.toCurrency}});
}));
router.get('/transactions/rate', asyncHandler(async(req,res)=>{
  const schema=z.object({fromCurrencyId:z.coerce.number().int().positive(),toCurrencyId:z.coerce.number().int().positive(),branchId:z.coerce.number().int().positive().optional(),kind:z.enum(['buy','sell','exchange']).default('sell')});
  const q=schema.parse(req.query); const rate=await findRate(q); res.json({success:true,data:{rate}});
}));
router.get('/transactions', requirePermission('reports'), asyncHandler(async (req, res) => {
  const { page, limit, offset } = pageInfo(req.query);
  const where = mergeWhere({}, branchWhere(req.user));
  if (req.query.kind) { const map = { buy: 'خرید', sell: 'فروش', exchange: 'تبدیل' }; where.kind = { [Op.like]: `%${map[req.query.kind] || req.query.kind}%` }; }
  if (req.query.state) where.state = req.query.state;
  if (req.query.customerId) where.customerId = Number(req.query.customerId);
  if (req.query.dateFrom || req.query.dateTo) {
    where.createdAt = {};
    if (req.query.dateFrom) where.createdAt[Op.gte] = new Date(`${req.query.dateFrom}T00:00:00`);
    if (req.query.dateTo) where.createdAt[Op.lte] = new Date(`${req.query.dateTo}T23:59:59.999`);
  }
  const result = await Transaction.findAndCountAll({ where, include: transactionIncludes, order: [['id','DESC']], limit, offset, distinct: true });
  res.json({ success: true, data: paginationResult(result, page, limit) });
}));
router.get('/transactions/:id', validate(wrap(empty, idParams)), asyncHandler(async (req, res) => {
  const row = await Transaction.findByPk(req.validated.params.id, { include: transactionIncludes });
  if (!row) throw new AppError('معامله پیدا نشد.', 404);
  assertBranchAccess(req.user, row.branchId);
  res.json({ success: true, data: row });
}));
router.post('/transactions', validate(wrap(transactionBody)), asyncHandler(async (req, res) => {
  const permission = req.validated.body.kind;
  if (!hasPermission(req.user, permission)) {
    throw new AppError('شما اجازه ثبت این نوع معامله را ندارید.', 403, 'FORBIDDEN');
  }
  assertBranchAccess(req.user, req.validated.body.branchId);
  await assertCashboxAccess(req.user, req.validated.body.cashboxId, Cashbox);
  const row = await createMoneyTransaction(req.validated.body, { req, user: req.user });
  emitChange(req, 'transactions:changed', { id: row.id });
  emitChange(req, 'balances:changed');
  res.status(201).json({ success: true, data: row, message: `معامله ثبت شد. نمبر سند: ${row.number}` });
}));
router.post('/transactions/:id/reverse', requirePermission('reports'), validate(wrap(empty, idParams)), asyncHandler(async (req, res) => {
  const existing = await Transaction.findByPk(req.validated.params.id);
  if (!existing) throw new AppError('معامله پیدا نشد.', 404);
  assertBranchAccess(req.user, existing.branchId);
  const row = await reverseMoneyTransaction(req.validated.params.id, { req, user: req.user });
  emitChange(req, 'transactions:changed', { id: row.id });
  emitChange(req, 'balances:changed');
  res.json({ success: true, data: row, message: 'معامله برگشت داده شد و موجودی صندوق اصلاح گردید.' });
}));
router.put('/transactions/:id', requirePermission('reports'), validate(wrap(transactionBody, idParams)), asyncHandler(async (req, res) => {
  const existing = await Transaction.findByPk(req.validated.params.id);
  if (!existing) throw new AppError('معامله پیدا نشد.', 404);
  assertBranchAccess(req.user, existing.branchId);
  assertBranchAccess(req.user, req.validated.body.branchId);
  await assertCashboxAccess(req.user, req.validated.body.cashboxId, Cashbox);
  const permission = req.validated.body.kind;
  if (!hasPermission(req.user, permission) && !hasPermission(req.user, 'reports')) {
    throw new AppError('شما اجازه ویرایش این نوع معامله را ندارید.', 403, 'FORBIDDEN');
  }
  const row = await updateMoneyTransaction(req.validated.params.id, req.validated.body, { req, user: req.user });
  emitChange(req, 'transactions:changed', { id: row.id });
  emitChange(req, 'balances:changed');
  res.json({ success: true, data: row, message: `معامله ${row.number} ویرایش شد.` });
}));
router.delete('/transactions/:id', requirePermission('reports'), validate(wrap(empty, idParams)), asyncHandler(async (req, res) => {
  const existing = await Transaction.findByPk(req.validated.params.id);
  if (!existing) throw new AppError('معامله پیدا نشد.', 404);
  assertBranchAccess(req.user, existing.branchId);
  const row = await deleteMoneyTransaction(req.validated.params.id, { req, user: req.user });
  emitChange(req, 'transactions:changed', { id: row.id });
  emitChange(req, 'balances:changed');
  res.json({ success: true, data: row, message: `معامله ${row.number} حذف شد.` });
}));

const remittanceBody=z.object({
  senderId:z.coerce.number().int().positive().optional().nullable(),
  receiverName:z.string().trim().min(2).max(120),
  receiverPhone:z.string().trim().max(30).optional().nullable(),
  fromBranchId:z.coerce.number().int().positive(),
  toBranchId:z.coerce.number().int().positive(),
  currencyId:z.coerce.number().int().positive(),
  sourceCashboxId:z.coerce.number().int().positive(),
  destinationCashboxId:z.coerce.number().int().positive(),
  amount:z.coerce.number().positive(),
  fee:z.coerce.number().min(0).default(0),
  feeCurrencyId:z.coerce.number().int().positive().optional().nullable(),
  note:z.string().trim().max(1000).optional().nullable(),
});
router.get('/remittances', requirePermission('remittances'), asyncHandler(async (req, res) => {
  const { page, limit, offset } = pageInfo(req.query);
  const search = String(req.query.search || '').trim();
  const where = mergeWhere(
    searchWhere(search, ['number', 'receiverName', 'receiverPhone', 'secretNumber', 'note']),
    remittanceWhere(req.user),
  );
  if (req.query.state) where.state = req.query.state;

  const [branchRows, accountRows] = await Promise.all([
    Remittance.findAll({
      where,
      include: ['sender', 'currency', 'feeCurrency', 'fromBranch', 'toBranch', 'sourceCashbox', 'destinationCashbox'],
      order: [['id', 'DESC']],
    }),
    listAccountTransferRows(search),
  ]);

  const merged = [
    ...branchRows.map((row) => ({ ...row.toJSON(), rowKind: 'inter_branch' })),
    ...accountRows,
  ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const total = merged.length;
  const rows = merged.slice(offset, offset + limit);
  res.json({
    success: true,
    data: {
      rows,
      pagination: {
        page,
        limit,
        total,
        pages: Math.max(1, Math.ceil(total / limit)),
      },
    },
  });
}));
router.post('/remittances', requirePermission('remittances'), validate(wrap(remittanceBody)), asyncHandler(async (req, res) => {
  assertBranchAccess(req.user, req.validated.body.fromBranchId);
  await assertCashboxAccess(req.user, req.validated.body.sourceCashboxId, Cashbox);
  const row = await createRemittance(req.validated.body, { req, user: req.user });
  emitChange(req, 'remittances:changed', { id: row.id });
  emitChange(req, 'balances:changed');
  res.status(201).json({ success: true, data: row, message: `حواله ثبت شد. شماره حواله: ${row.number}` });
}));
router.put('/remittances/:id', requirePermission('remittances'), validate(wrap(remittanceBody, idParams)), asyncHandler(async (req, res) => {
  const existing = await Remittance.findByPk(req.validated.params.id);
  if (!existing) throw new AppError('حواله پیدا نشد.', 404);
  assertBranchAccess(req.user, existing.fromBranchId);
  assertBranchAccess(req.user, req.validated.body.fromBranchId);
  await assertCashboxAccess(req.user, req.validated.body.sourceCashboxId, Cashbox);
  const row = await updateRemittance(req.validated.params.id, req.validated.body, { req, user: req.user });
  emitChange(req, 'remittances:changed', { id: row.id });
  emitChange(req, 'balances:changed');
  res.json({ success: true, data: row, message: 'حواله اصلاح شد.' });
}));
router.delete('/remittances/:id', requirePermission('remittances'), validate(wrap(empty, idParams)), asyncHandler(async (req, res) => {
  const existing = await Remittance.findByPk(req.validated.params.id);
  if (!existing) throw new AppError('حواله پیدا نشد.', 404);
  assertBranchAccess(req.user, existing.fromBranchId);
  const row = await cancelRemittance(req.validated.params.id, { req, user: req.user });
  emitChange(req, 'remittances:changed', { id: row.id });
  emitChange(req, 'balances:changed');
  res.json({ success: true, data: row, message: 'حواله لغو و حذف شد.' });
}));
router.post('/remittances/:id/pay', requirePermission('remittances'), validate(wrap(z.object({
  destinationCashboxId: z.coerce.number().int().positive().optional().nullable(),
  secretNumber: z.coerce.string().min(6).max(30),
}), idParams)), asyncHandler(async (req, res) => {
  const existing = await Remittance.findByPk(req.validated.params.id);
  if (!existing) throw new AppError('حواله پیدا نشد.', 404);
  assertBranchAccess(req.user, existing.toBranchId);
  const payCashboxId = req.validated.body.destinationCashboxId || existing.destinationCashboxId;
  if (!payCashboxId) throw new AppError('صندوق دریافت شعبه مقصد مشخص نیست.');
  await assertCashboxAccess(req.user, payCashboxId, Cashbox);
  const row = await payRemittance(req.validated.params.id, {
    ...req.validated.body,
    destinationCashboxId: payCashboxId,
  }, { req, user: req.user });
  emitChange(req, 'remittances:changed', { id: row.id });
  emitChange(req, 'balances:changed');
  res.json({ success: true, data: row, message: 'حواله پرداخت شد.' });
}));

router.get('/balances', requirePermission('balance'), asyncHandler(async (req, res) => {
  const rows = await CashboxBalance.findAll({
    include: [{ association: 'currency' }, cashboxInclude(req.user, { include: ['branch'] })],
    order: [['currencyId', 'ASC'], ['cashboxId', 'ASC']],
  });
  const totals = {};
  for (const row of rows) {
    const code = row.currency?.code || String(row.currencyId);
    totals[code] = totals[code] || { currency: row.currency, total: 0, cashboxes: [] };
    totals[code].total += Number(row.amount);
    totals[code].cashboxes.push(row);
  }

  let period = null;
  if (req.query.dateFrom || req.query.dateTo) {
    const journalWhere = {
      ...branchWhere(req.user),
    };
    if (req.query.dateFrom) {
      journalWhere.entryDate = { ...(journalWhere.entryDate || {}), [Op.gte]: req.query.dateFrom };
    }
    if (req.query.dateTo) {
      journalWhere.entryDate = { ...(journalWhere.entryDate || {}), [Op.lte]: req.query.dateTo };
    }
    const movements = await JournalEntry.findAll({
      where: journalWhere,
      include: ['currency', 'branch'],
      order: [['entryDate', 'ASC'], ['id','DESC']],
    });
    const byCurrency = {};
    for (const m of movements) {
      const code = m.currency?.code || String(m.currencyId);
      byCurrency[code] = byCurrency[code] || { currency: m.currency, total: 0, count: 0 };
      byCurrency[code].total += Number(m.amount);
      byCurrency[code].count += 1;
    }
    period = {
      dateFrom: req.query.dateFrom || null,
      dateTo: req.query.dateTo || null,
      movements: Object.values(byCurrency),
      entries: movements.slice(0, 100),
    };
  }

  res.json({ success: true, data: { currencies: Object.values(totals), period } });
}));
router.get('/journal', requirePermission('reports'), asyncHandler(async (req, res) => {
  const { page, limit, offset } = pageInfo(req.query);
  const where = {
    ...branchWhere(req.user),
    ...searchWhere(req.query.search, ['number', 'description', 'debitAccount', 'creditAccount', 'createdByName']),
  };
  if (req.query.dateFrom) {
    where.entryDate = { ...(where.entryDate || {}), [Op.gte]: req.query.dateFrom };
  }
  if (req.query.dateTo) {
    where.entryDate = { ...(where.entryDate || {}), [Op.lte]: req.query.dateTo };
  }
  const result = await JournalEntry.findAndCountAll({ where, include: ['currency', 'branch'], order: [['id','DESC']], limit, offset });
  res.json({ success: true, data: paginationResult(result, page, limit) });
}));

export default router;
