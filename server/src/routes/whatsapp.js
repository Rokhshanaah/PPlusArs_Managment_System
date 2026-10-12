import { Router } from 'express';
import { Op } from 'sequelize';
import { requirePermission } from '../middleware/auth.js';
import { requirePlanFeature } from '../utils/appPlans.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { SystemSetting, WhatsappMessage } from '../models/index.js';
import { applyWhatsappStatusUpdate, processWhatsappQueue } from '../services/whatsapp.js';
import { pageInfo, paginationResult } from './common.js';

export const whatsappWebhookRouter = Router();
export const whatsappAdminRouter = Router();

async function verifyTokenFromSettings(token) {
  if (!token) return false;
  if (process.env.WHATSAPP_VERIFY_TOKEN && token === process.env.WHATSAPP_VERIFY_TOKEN) return true;
  const row = await SystemSetting.findOne({ where: { settingKey: 'whatsapp_webhook_verify_token' } });
  return Boolean(row?.settingValue && row.settingValue === token);
}

whatsappWebhookRouter.get('/webhooks/whatsapp', asyncHandler(async (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && await verifyTokenFromSettings(token)) {
    return res.status(200).send(String(challenge || ''));
  }
  return res.sendStatus(403);
}));

whatsappWebhookRouter.post('/webhooks/whatsapp', asyncHandler(async (req, res) => {
  const body = req.body || {};
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      for (const statusRow of change.value?.statuses || []) {
        await applyWhatsappStatusUpdate({
          providerMessageId: statusRow.id,
          status: statusRow.status,
          timestamp: statusRow.timestamp,
        });
      }
    }
  }
  res.sendStatus(200);
}));

whatsappAdminRouter.get('/whatsapp/messages', requirePermission('settings'), requirePlanFeature('whatsapp'), asyncHandler(async (req, res) => {
  const { page, limit, offset } = pageInfo(req.query);
  const where = {};
  if (req.query.status) where.status = req.query.status;
  if (req.query.search) {
    const q = `%${req.query.search}%`;
    where[Op.or] = [
      { phone: { [Op.like]: q } },
      { customerName: { [Op.like]: q } },
      { documentNumber: { [Op.like]: q } },
      { body: { [Op.like]: q } },
    ];
  }
  const result = await WhatsappMessage.findAndCountAll({
    where,
    order: [['id','DESC']],
    limit,
    offset,
  });
  res.json({ success: true, data: paginationResult(result, page, limit) });
}));

whatsappAdminRouter.post('/whatsapp/process-queue', requirePermission('settings'), requirePlanFeature('whatsapp'), asyncHandler(async (_req, res) => {
  const data = await processWhatsappQueue({ limit: 50 });
  res.json({ success: true, data });
}));
