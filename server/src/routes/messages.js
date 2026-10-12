import { Router } from 'express';
import { z } from 'zod';
import { Op } from 'sequelize';
import { requirePermission } from '../middleware/auth.js';
import { requirePlanMenu } from '../utils/appPlans.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import { CustomerMessage } from '../models/index.js';
import { emitChange, pageInfo, paginationResult, searchWhere } from './common.js';

const router = Router();
router.use(requirePlanMenu('messages'));
const empty = z.object({});
const wrap = (body, params = empty, query = z.record(z.string(), z.any()).optional().default({})) =>
  z.object({ body, params, query });
const idParams = z.object({ id: z.coerce.number().int().positive() });

router.get(
  '/messages',
  requirePermission('customers'),
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = pageInfo(req.query);
    const unreadOnly = String(req.query.unread || '') === '1';
    const search = String(req.query.search || '').trim();
    const where = {
      sender: 'customer',
      ...(unreadOnly ? { readAt: null } : {}),
    };

    if (search) {
      where[Op.or] = [
        ...searchWhere(search, ['body'])[Op.or],
        { '$customer.name$': { [Op.like]: `%${search}%` } },
        { '$customer.phone$': { [Op.like]: `%${search}%` } },
      ];
    }

    const { rows, count } = await CustomerMessage.findAndCountAll({
      where,
      include: [{ association: 'customer', attributes: ['id', 'name', 'phone'] }],
      order: [['id','DESC']],
      limit,
      offset,
    });

    const unreadCount = await CustomerMessage.count({
      where: { sender: 'customer', readAt: null },
    });

    res.json({
      success: true,
      data: {
        ...paginationResult({ rows, count }, page, limit),
        unreadCount,
      },
    });
  }),
);

router.get(
  '/messages/unread-count',
  requirePermission('customers'),
  asyncHandler(async (_req, res) => {
    const unreadCount = await CustomerMessage.count({
      where: { sender: 'customer', readAt: null },
    });
    res.json({ success: true, data: { unreadCount } });
  }),
);

router.patch(
  '/messages/:id/read',
  requirePermission('customers'),
  validate(wrap(empty, idParams)),
  asyncHandler(async (req, res) => {
    const row = await CustomerMessage.findByPk(req.validated.params.id, {
      include: [{ association: 'customer', attributes: ['id', 'name', 'phone'] }],
    });
    if (!row) throw new AppError('پیام پیدا نشد.', 404);
    if (!row.readAt) {
      await row.update({
        readAt: new Date(),
        readByUserId: req.user.id,
      });
    }
    emitChange(req, 'messages:changed', { id: row.id, unread: false });
    res.json({ success: true, data: row });
  }),
);

router.post(
  '/messages/read-all',
  requirePermission('customers'),
  asyncHandler(async (req, res) => {
    await CustomerMessage.update(
      { readAt: new Date(), readByUserId: req.user.id },
      { where: { sender: 'customer', readAt: { [Op.is]: null } } },
    );
    emitChange(req, 'messages:changed', { unread: false });
    res.json({ success: true });
  }),
);

export default router;
