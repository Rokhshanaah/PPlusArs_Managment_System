import { Op } from 'sequelize';
import { AppError } from './AppError.js';

export function isSuperAdmin(user) {
  return String(user?.role || '').trim() === 'مدیر کل';
}

/**
 * Branch id for data scoping.
 * Super-admin is org-wide unless an admin UI filter (branchFilterId) is set.
 */
export function scopedBranchId(user) {
  if (isSuperAdmin(user)) {
    const filterId = Number(user?.branchFilterId);
    if (Number.isFinite(filterId) && filterId > 0) return filterId;
    return null;
  }

  const id = Number(user?.branchId);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export function isBranchScoped(user) {
  return scopedBranchId(user) != null;
}

export function branchWhere(user, field = 'branchId') {
  const bid = scopedBranchId(user);
  return bid == null ? {} : { [field]: bid };
}

/** Filter Branch rows by primary key (branches.id, not branchId). */
export function branchSelfWhere(user) {
  return branchWhere(user, 'id');
}

export function remittanceWhere(user) {
  const bid = scopedBranchId(user);
  if (bid == null) return {};
  return {
    [Op.or]: [
      { fromBranchId: bid },
      { toBranchId: bid },
    ],
  };
}

export function ratesWhere(user) {
  const bid = scopedBranchId(user);
  if (bid == null) return {};
  return {
    [Op.or]: [
      { branchId: null },
      { branchId: bid },
    ],
  };
}

export function cashboxInclude(user, extra = {}) {
  const bid = scopedBranchId(user);
  const inc = { association: 'cashbox', ...extra };
  if (bid != null) {
    inc.where = { branchId: bid };
    inc.required = true;
  }
  return inc;
}

export function assertSuperAdmin(user, message = 'فقط مدیر کل به این بخش دسترسی دارد.') {
  if (!isSuperAdmin(user)) throw new AppError(message, 403, 'FORBIDDEN');
}

export function assertBranchAccess(user, branchId, message = 'شما به این شعبه دسترسی ندارید.') {
  const bid = scopedBranchId(user);
  if (bid == null) return;
  if (Number(branchId) !== bid) throw new AppError(message, 403, 'FORBIDDEN');
}

export async function assertCashboxAccess(user, cashboxId, Cashbox, message = 'شما به این صندوق دسترسی ندارید.') {
  const bid = scopedBranchId(user);
  if (bid == null) return;
  const box = await Cashbox.findByPk(cashboxId);
  if (!box || Number(box.branchId) !== bid) throw new AppError(message, 403, 'FORBIDDEN');
}

export function mergeWhere(base, scope) {
  if (!scope || !Object.keys(scope).length) return base;
  return { ...base, ...scope };
}

export function scopeMeta(user) {
  const bid = scopedBranchId(user);
  return {
    scoped: bid != null,
    branchId: bid,
    branchName: user?.branchFilterName || user?.branch?.name || null,
    adminFilter: Boolean(isSuperAdmin(user) && bid != null),
  };
}

/** Sanitize staff payload for branch-scoped managers. */
export function sanitizeStaffPayload(user, body) {
  const bid = scopedBranchId(user);
  if (bid == null) return body;
  if (String(body.role || '').trim() === 'مدیر کل') {
    throw new AppError('فقط مدیر کل می‌تواند نقش مدیر کل داشته باشد.', 403, 'FORBIDDEN');
  }
  const blocked = new Set(['branches', 'staff', 'settings', 'audit']);
  return {
    ...body,
    branchId: bid,
    permissions: (body.permissions || []).filter((p) => !blocked.has(p)),
  };
}
