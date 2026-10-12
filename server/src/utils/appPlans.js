const BASIC_MENUS = [
  'dashboard',
  'customers',
  'receiptsWithdrawals',
  'buy',
  'sell',
  'accounts',
  'currencies',
  'cashboxes',
  'staff',
  'settings',
];

const STANDARD_MENUS = [
  ...BASIC_MENUS,
  'rates',
  'exchange',
  'remittances',
  'balance',
  'expenses',
  'journal',
  'reports',
  'profitLoss',
];

const PROFESSIONAL_MENUS = [
  ...STANDARD_MENUS,
  'messages',
  'cardReader',
  'audit',
];

const PREMIUM_MENUS = [
  ...PROFESSIONAL_MENUS,
  'language',
  'branches',
];

const OFF_FEATURES = {
  language: false,
  whatsapp: false,
  cardReader: false,
  customerPortal: false,
  branches: false,
};

export const APP_PLAN_IDS = ['basic', 'standard', 'professional', 'premium'];
export const DEFAULT_APP_PLAN = 'premium';

export const APP_PLANS = {
  basic: {
    menus: BASIC_MENUS,
    features: { ...OFF_FEATURES },
    maxBranches: 1,
  },
  standard: {
    menus: STANDARD_MENUS,
    features: { ...OFF_FEATURES },
    maxBranches: 1,
  },
  professional: {
    menus: PROFESSIONAL_MENUS,
    features: {
      language: false,
      whatsapp: true,
      cardReader: true,
      customerPortal: true,
      branches: false,
    },
    maxBranches: 1,
  },
  premium: {
    menus: PREMIUM_MENUS,
    features: {
      language: true,
      whatsapp: true,
      cardReader: true,
      customerPortal: true,
      branches: true,
    },
    maxBranches: 2,
  },
};

export function parseAppPlan(raw) {
  const id = String(raw || '').trim().toLowerCase();
  const plan = APP_PLANS[id] || APP_PLANS[DEFAULT_APP_PLAN];
  return {
    id: APP_PLANS[id] ? id : DEFAULT_APP_PLAN,
    menus: [...plan.menus],
    features: { ...plan.features },
    maxBranches: plan.maxBranches,
  };
}

export const PERMISSION_TO_MENU = {
  dashboard: 'dashboard',
  customers: 'customers',
  accounts: 'accounts',
  currencies: 'currencies',
  rates: 'rates',
  buy: 'buy',
  sell: 'sell',
  exchange: 'exchange',
  remittances: 'remittances',
  cashboxes: 'cashboxes',
  balance: 'balance',
  expenses: 'expenses',
  reports: 'reports',
  branches: 'branches',
  staff: 'staff',
  audit: 'audit',
  settings: 'settings',
};

export function planAllowsPermission(plan, permission) {
  const menu = PERMISSION_TO_MENU[permission];
  if (!menu) return true;
  return parseAppPlan(plan?.id || plan).menus.includes(menu);
}

export function planToPublicFields(plan) {
  const parsed = parseAppPlan(plan?.id || plan);
  return {
    app_enabled_menus: parsed.menus.join(','),
    app_features: Object.entries(parsed.features)
      .filter(([, on]) => on)
      .map(([key]) => key)
      .join(','),
    max_branches: String(parsed.maxBranches),
  };
}

let planCache = { at: 0, plan: null };

export function clearAppPlanCache() {
  planCache = { at: 0, plan: null };
}

export async function loadAppPlan() {
  if (planCache.plan && Date.now() - planCache.at < 4000) return planCache.plan;
  const { SystemSetting } = await import('../models/index.js');
  const row = await SystemSetting.findOne({ where: { settingKey: 'app_plan' } });
  const plan = parseAppPlan(row?.settingValue);
  planCache = { at: Date.now(), plan };
  return plan;
}

export function requirePlanMenu(menuKey) {
  return async (req, _res, next) => {
    try {
      const plan = await loadAppPlan();
      req.appPlan = plan;
      if (!plan.menus.includes(menuKey)) {
        const { AppError } = await import('./AppError.js');
        return next(new AppError('این بخش فعال نیست.', 403, 'PLAN_FORBIDDEN'));
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requirePlanFeature(feature) {
  return async (req, _res, next) => {
    try {
      const plan = await loadAppPlan();
      req.appPlan = plan;
      if (!plan.features[feature]) {
        const { AppError } = await import('./AppError.js');
        return next(new AppError('این بخش فعال نیست.', 403, 'PLAN_FORBIDDEN'));
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

function normalizePassword(value) {
  return String(value || '')
    .replace(/[۰-۹]/g, (ch) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(ch)))
    .replace(/[٠-٩]/g, (ch) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(ch)))
    .trim();
}

const PLAN_LOCK_KEY = 'app_plan_lock_hash';

export async function isPlanLockRegistered() {
  const { SystemSetting } = await import('../models/index.js');
  const row = await SystemSetting.findOne({ where: { settingKey: PLAN_LOCK_KEY } });
  return Boolean(String(row?.settingValue || '').trim());
}

export async function registerPlanLock(password, confirm) {
  const { AppError } = await import('./AppError.js');
  const { SystemSetting } = await import('../models/index.js');
  const bcryptMod = await import('bcryptjs');
  const bcrypt = bcryptMod.default || bcryptMod;
  const given = normalizePassword(password);
  const repeated = normalizePassword(confirm);
  if (given.length < 4) {
    throw new AppError('رمز ادمین کوتاه است.', 400, 'PLAN_LOCK_WEAK');
  }
  if (given !== repeated) {
    throw new AppError('رمز و تکرار آن یکسان نیست.', 400, 'PLAN_LOCK_MISMATCH');
  }
  if (await isPlanLockRegistered()) {
    throw new AppError('رمز ادمین قبلاً ثبت شده است.', 409, 'PLAN_LOCK_EXISTS');
  }
  await SystemSetting.upsert({
    settingKey: PLAN_LOCK_KEY,
    settingValue: await bcrypt.hash(given, 12),
  });
}

export async function assertPlanLock(password) {
  const { AppError } = await import('./AppError.js');
  const { SystemSetting } = await import('../models/index.js');
  const bcryptMod = await import('bcryptjs');
  const bcrypt = bcryptMod.default || bcryptMod;
  const row = await SystemSetting.findOne({ where: { settingKey: PLAN_LOCK_KEY } });
  const hash = String(row?.settingValue || '').trim();
  if (!hash) {
    throw new AppError('اول رمز ادمین را ثبت کنید.', 400, 'PLAN_LOCK_MISSING');
  }
  const given = normalizePassword(password);
  const normalizedHash = hash.startsWith('$2y$') ? `$2b$${hash.slice(4)}` : hash;
  const ok = Boolean(given) && await bcrypt.compare(given, normalizedHash);
  if (!ok) {
    throw new AppError('رمز اشتباه است.', 403, 'PLAN_PIN_INVALID');
  }
}

export async function changePlanLock(current, next, confirm) {
  await assertPlanLock(current);
  const { AppError } = await import('./AppError.js');
  const { SystemSetting } = await import('../models/index.js');
  const bcryptMod = await import('bcryptjs');
  const bcrypt = bcryptMod.default || bcryptMod;
  const given = normalizePassword(next);
  const repeated = normalizePassword(confirm);
  if (given.length < 4) {
    throw new AppError('رمز ادمین کوتاه است.', 400, 'PLAN_LOCK_WEAK');
  }
  if (given !== repeated) {
    throw new AppError('رمز و تکرار آن یکسان نیست.', 400, 'PLAN_LOCK_MISMATCH');
  }
  await SystemSetting.upsert({
    settingKey: PLAN_LOCK_KEY,
    settingValue: await bcrypt.hash(given, 12),
  });
}
