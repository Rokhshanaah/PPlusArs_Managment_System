import { AuditLog } from '../models/index.js';

export async function writeAudit({ req, user, action, transaction }) {
  return AuditLog.create({
    person: user?.name || user?.username || 'سامانه',
    action,
    ipAddress: req?.ip || null,
    device: req?.get?.('user-agent') || 'system',
    createdAt: new Date(),
  }, { transaction });
}
