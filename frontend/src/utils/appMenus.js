export const APP_MENU_GROUPS = [
  {
    group: 'appMenusLanguage',
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

export const APP_MENU_KEYS = APP_MENU_GROUPS.flatMap((g) => g.items);

export const DEFAULT_APP_MENUS = [...APP_MENU_KEYS];

const PATH_PREFIXES = [
  ['/customers', 'customers'],
  ['/messages', 'messages'],
  ['/card-reader', 'cardReader'],
  ['/receipts-withdrawals', 'receiptsWithdrawals'],
  ['/accounts', 'accounts'],
  ['/currencies', 'currencies'],
  ['/rates', 'rates'],
  ['/buy', 'buy'],
  ['/sell', 'sell'],
  ['/exchange', 'exchange'],
  ['/remittances', 'remittances'],
  ['/cashboxes', 'cashboxes'],
  ['/balance', 'balance'],
  ['/expenses', 'expenses'],
  ['/journal', 'journal'],
  ['/reports', 'reports'],
  ['/profit-loss', 'profitLoss'],
  ['/branches', 'branches'],
  ['/staff', 'staff'],
  ['/audit', 'audit'],
  ['/settings', 'settings'],
];

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

export function menuKeyFromPath(pathname) {
  const path = String(pathname || '');
  if (!path || path === '/') return 'dashboard';
  if (path.startsWith('/transactions/')) return null;
  for (const [prefix, key] of PATH_PREFIXES) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return key;
  }
  return null;
}

export function navItemAllowed(key, hasPermission) {
  if (key === 'journal' || key === 'profitLoss') return hasPermission('reports');
  if (key === 'messages' || key === 'cardReader') return hasPermission('customers');
  if (key === 'receiptsWithdrawals') return hasPermission('accounts');
  return hasPermission(key);
}
