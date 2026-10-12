export const APP_MENU_KEYS = [
  'language',
  'dashboard', 'customers', 'messages', 'cardReader', 'receiptsWithdrawals', 'accounts',
  'currencies', 'rates', 'buy', 'sell', 'exchange',
  'remittances', 'cashboxes', 'balance', 'expenses', 'journal', 'reports', 'profitLoss',
  'branches', 'staff', 'audit', 'settings',
];

export const DEFAULT_APP_MENUS = [...APP_MENU_KEYS];

export function parseAppMenus(raw, { allowEmpty = false } = {}) {
  if (raw == null) return allowEmpty ? [] : [...DEFAULT_APP_MENUS];
  const picked = String(raw)
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((k) => APP_MENU_KEYS.includes(k));
  if (picked.length) return [...new Set(picked)];
  if (allowEmpty || String(raw).trim() === '') return [];
  return [...DEFAULT_APP_MENUS];
}
