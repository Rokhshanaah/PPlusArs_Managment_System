import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { Branch, User } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { isSuperAdmin } from '../utils/branchScope.js';
import { loadAppPlan, planAllowsPermission } from '../utils/appPlans.js';

function readBranchFilterHeader(req) {
  const raw = req.headers['x-branch-id'];
  if (raw == null || raw === '' || raw === 'all' || raw === '0') return null;
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export async function requireAuth(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new AppError('لطفاً دوباره وارد سامانه شوید.', 401, 'UNAUTHENTICATED');
    const payload = jwt.verify(token, env.jwtSecret);
    const user = await User.findByPk(payload.sub, { include: ['branch'] });
    if (!user || !user.isActive) throw new AppError('حساب کاربری فعال نیست.', 401, 'ACCOUNT_DISABLED');

    const filterId = isSuperAdmin(user) ? readBranchFilterHeader(req) : null;

    if (filterId) {
      const branch = await Branch.findByPk(filterId);
      if (!branch || !branch.isActive) {
        throw new AppError('شعبه انتخاب‌شده معتبر نیست.', 400, 'INVALID_BRANCH_FILTER');
      }
      user.branchFilterId = filterId;
      user.branchFilterName = branch.name;
    }

    req.user = user;
    next();
  } catch (error) {
    if (error instanceof AppError) return next(error);
    return next(new AppError('نشست شما پایان یافته است. دوباره وارد شوید.', 401, 'TOKEN_INVALID'));
  }
}

function readPermissions(user) {
  const raw = user?.permissions;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function hasPermission(user, permission) {
  return isSuperAdmin(user) || readPermissions(user).includes(permission);
}

export function requirePermission(permission) {
  return async (req, _res, next) => {
    if (!hasPermission(req.user, permission)) {
      return next(new AppError('شما اجازه دسترسی به این بخش را ندارید.', 403, 'FORBIDDEN'));
    }
    try {
      const plan = await loadAppPlan();
      req.appPlan = plan;
      if (permission === 'settings' && isSuperAdmin(req.user)) {
        return next();
      }
      if (!planAllowsPermission(plan, permission)) {
        return next(new AppError('این بخش فعال نیست.', 403, 'PLAN_FORBIDDEN'));
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
