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

export function planHasFeature(plan, feature) {
  return Boolean(parseAppPlan(plan?.id || plan).features[feature]);
}

/** Menus/features for the UI — never expose the sold plan name to staff. */
export function accessFromCompany(company) {
  const menusRaw = String(company?.app_enabled_menus || '').trim();
  const featuresRaw = String(company?.app_features || '').trim();
  if (menusRaw || featuresRaw) {
    const menus = menusRaw
      ? menusRaw.split(',').map((item) => item.trim()).filter(Boolean)
      : [];
    const featureList = featuresRaw
      ? featuresRaw.split(',').map((item) => item.trim()).filter(Boolean)
      : [];
    const features = {
      language: featureList.includes('language') || menus.includes('language'),
      whatsapp: featureList.includes('whatsapp'),
      cardReader: featureList.includes('cardReader') || menus.includes('cardReader'),
      customerPortal: featureList.includes('customerPortal'),
      branches: featureList.includes('branches') || menus.includes('branches'),
    };
    const parsedMax = Number(company?.max_branches);
    return {
      menus,
      features,
      maxBranches: Number.isFinite(parsedMax) && parsedMax > 0
        ? parsedMax
        : (features.branches ? 2 : 1),
    };
  }
  const fallback = parseAppPlan(company?.app_plan);
  return {
    menus: fallback.menus,
    features: fallback.features,
    maxBranches: fallback.maxBranches,
  };
}
