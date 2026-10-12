export const CUSTOMER_PORTAL_MENU_GROUPS = [
  {
    group: 'customerPortalSettings',
    items: ['language'],
  },
  {
    group: 'management',
    items: ['dashboard', 'customers', 'messages', 'cardReader', 'receiptsWithdrawals', 'accounts'],
  },
  {
    group: 'trade',
    items: ['currencies', 'rates', 'buy', 'sell', 'exchange'],
  },
  {
    group: 'treasury',
    items: ['remittances', 'cashboxes', 'balance', 'expenses', 'journal', 'reports', 'profitLoss'],
  },
  {
    group: 'security',
    items: ['branches', 'staff', 'audit', 'settings'],
  },
];

export const CUSTOMER_PORTAL_MENU_KEYS = CUSTOMER_PORTAL_MENU_GROUPS.flatMap((g) => g.items);

export const DEFAULT_CUSTOMER_PORTAL_MENUS = ['dashboard', 'accounts', 'messages'];

export function parseCustomerPortalMenus(raw, { allowEmpty = false } = {}) {
  const picked = String(raw || '')
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((k) => CUSTOMER_PORTAL_MENU_KEYS.includes(k));
  if (picked.length) return [...new Set(picked)];
  return allowEmpty ? [] : [...DEFAULT_CUSTOMER_PORTAL_MENUS];
}

export function parseCustomerPortalLanguage(raw) {
  const s = String(raw || '').toLowerCase().split(/[-_]/)[0];
  return s === 'ps' || s === 'en' ? s : 'fa';
}
