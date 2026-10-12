import { Router } from 'express';
import { z } from 'zod';
import { Op } from 'sequelize';
import { requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import { Expense, Cashbox } from '../models/index.js';
import { createExpense, deleteExpense } from '../services/accounting.js';
import { emitChange, pageInfo, paginationResult, searchWhere } from './common.js';
import { assertCashboxAccess, branchWhere, mergeWhere } from '../utils/branchScope.js';

const router = Router();
const empty = z.object({});
const queryAny = z.record(z.string(), z.any()).optional().default({});
const wrap = (body, params = empty, query = queryAny) => z.object({ body, params, query });
const idParams = z.object({ id: z.coerce.number().int().positive() });

const expenseBody = z.object({
  cashboxId: z.coerce.number().int().positive(),
  currencyId: z.coerce.number().int().positive(),
  amount: z.coerce.number().positive(),
  category: z.string().trim().min(1).max(120).default('عمومی'),
  description: z.string().trim().min(1).max(255),
  note: z.string().trim().max(2000).optional().nullable(),
  entryDate: z.string().trim().optional().nullable(),
});

router.get('/expenses', requirePermission('expenses'), asyncHandler(async (req, res) => {
  const { page, limit, offset } = pageInfo(req.query);
  const where = mergeWhere(
    {
      ...searchWhere(req.query.search, ['number', 'category', 'description', 'note', 'createdByName']),
    },
    branchWhere(req.user),
  );

  if (req.query.dateFrom || req.query.dateTo) {
    where.entryDate = {};
    if (req.query.dateFrom) where.entryDate[Op.gte] = req.query.dateFrom;
    if (req.query.dateTo) where.entryDate[Op.lte] = req.query.dateTo;
  }
  if (req.query.cashboxId) where.cashboxId = Number(req.query.cashboxId);
  if (req.query.category) where.category = String(req.query.category);

  const result = await Expense.findAndCountAll({
    where,
    include: ['cashbox', 'currency', 'branch'],
    order: [['id', 'DESC']],
    limit,
    offset,
  });

  res.json({ success: true, data: paginationResult(result, page, limit) });
}));

router.post('/expenses', requirePermission('expenses'), validate(wrap(expenseBody)), asyncHandler(async (req, res) => {
  const body = req.validated.body;
  await assertCashboxAccess(req.user, body.cashboxId, Cashbox);
  const row = await createExpense(body, { req, user: req.user });
  emitChange(req, 'expenses:changed', { id: row.id });
  emitChange(req, 'balances:changed');
  emitChange(req, 'cashboxes:changed');
  res.status(201).json({ success: true, data: row, message: 'هزینه ثبت شد و از صندوق کم گردید.' });
}));

router.delete('/expenses/:id', requirePermission('expenses'), validate(wrap(empty, idParams)), asyncHandler(async (req, res) => {
  const existing = await Expense.findByPk(req.validated.params.id);
  if (!existing) throw new AppError('هزینه پیدا نشد.', 404);
  await assertCashboxAccess(req.user, existing.cashboxId, Cashbox);
  const data = await deleteExpense(existing.id, { req, user: req.user });
  emitChange(req, 'expenses:changed', { id: data.id });
  emitChange(req, 'balances:changed');
  emitChange(req, 'cashboxes:changed');
  res.json({ success: true, data, message: 'هزینه حذف و مبلغ به صندوق برگشت.' });
}));

export default router;
