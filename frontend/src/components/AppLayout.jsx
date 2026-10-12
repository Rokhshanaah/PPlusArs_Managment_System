import { useCallback, useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { io } from 'socket.io-client';
import {
  ArrowLeftRight,
  BadgeDollarSign,
  BookOpenText,
  Building2,
  ChartNoAxesCombined,
  ChevronDown,
  Coins,
  CreditCard,
  FileText,
  HandCoins,
  Landmark,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquareText,
  Send,
  Settings,
  ShieldCheck,
  ShoppingCart,
  UserCog,
  Users,
  WalletCards,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useBranchFilter } from '../context/BranchFilterContext.jsx';
import { LanguageSwitcher } from './Common.jsx';
import BrandWordmark from './BrandWordmark.jsx';
import PageMotion from './PageMotion.jsx';
import UserAvatar from './UserAvatar.jsx';
import { useCompany } from '../context/CompanyContext.jsx';
import {
  menuKeyFromPath,
  navItemAllowed,
} from '../utils/appMenus.js';
import {
  NotificationMenu,
  ProfileMenu,
  ThemeToggleButton,
} from './TopbarMenus.jsx';
import { localizeValue, translatePersonName, translatePlace } from '../utils/labels.js';

const navigation = [
  {
    group: 'management',
    items: [
      ['dashboard', '/', LayoutDashboard],
      ['customers', '/customers', Users],
      ['messages', '/messages', MessageSquareText],
      ['cardReader', '/card-reader', CreditCard],
      ['receiptsWithdrawals', '/receipts-withdrawals', FileText],
      ['accounts', '/accounts', WalletCards],
    ],
  },
  {
    group: 'trade',
    items: [
      ['currencies', '/currencies', Coins],
      ['rates', '/rates', BadgeDollarSign],
      ['buy', '/buy', ShoppingCart],
      ['sell', '/sell', HandCoins],
      ['exchange', '/exchange', ArrowLeftRight],
    ],
  },
  {
    group: 'treasury',
    items: [
      ['remittances', '/remittances', Send],
      ['cashboxes', '/cashboxes', Landmark],
      ['balance', '/balance', BadgeDollarSign],
      ['expenses', '/expenses', HandCoins],
      ['journal', '/journal', BookOpenText],
      ['reports', '/reports', ChartNoAxesCombined],
      ['profitLoss', '/profit-loss', FileText],
    ],
  },
  {
    group: 'security',
    items: [
      ['branches', '/branches', Building2],
      ['staff', '/staff', UserCog],
      ['audit', '/audit', ShieldCheck],
      ['settings', '/settings', Settings],
    ],
  },
];

const socketEvents = [
  'transactions:changed',
  'balances:changed',
  'customers:changed',
  'accounts:changed',
  'remittances:changed',
  'cashboxes:changed',
  'branches:changed',
  'currencies:changed',
  'rates:changed',
  'staff:changed',
  'settings:changed',
  'messages:changed',
  'card-reader:changed',
  'expenses:changed',
];

function pathMatches(path, pathname) {
  return path === '/' ? pathname === '/' : pathname === path || pathname.startsWith(`${path}/`);
}

export default function AppLayout() {
  const { t } = useTranslation();
  const { user, logout, hasPermission, isSuperAdmin, branchName } = useAuth();
  const {
    branches,
    selectedBranchId,
    selectedBranchName,
    setSelectedBranchId,
    isAdminFilterActive,
  } = useBranchFilter();

  const displayBranch = isSuperAdmin
    ? (isAdminFilterActive
      ? translatePlace(t, selectedBranchName)
      : t('allBranches'))
    : (branchName
      ? translatePlace(t, branchName)
      : (user?.branch?.name
        ? localizeValue(t, user.branch.name)
        : t('centralBranch')));

  const { displayName, isAppMenuEnabled, languageEnabled } = useCompany();
  const [open, setOpen] = useState(false);
  const [connected, setConnected] = useState(false);
  const [expanded, setExpanded] = useState({});
  const location = useLocation();
  const navigate = useNavigate();

  const canShowNav = useCallback((key) => {
    if (key === 'settings') return Boolean(isSuperAdmin);
    return isAppMenuEnabled(key) && navItemAllowed(key, hasPermission);
  }, [hasPermission, isAppMenuEnabled, isSuperAdmin]);

  const firstAllowedPath = useMemo(() => {
    for (const group of navigation) {
      for (const [key, path] of group.items) {
        if (canShowNav(key)) return path;
      }
    }
    return isSuperAdmin ? '/settings' : '/';
  }, [canShowNav, isSuperAdmin]);

  const pageScopeKey = isSuperAdmin
    ? `branch-${selectedBranchId || 'all'}`
    : 'branch-fixed';

  useEffect(() => setOpen(false), [location.pathname]);

  useEffect(() => {
    const key = menuKeyFromPath(location.pathname);
    if (!key) return;
    if (canShowNav(key)) return;
    const destKey = menuKeyFromPath(firstAllowedPath);
    if (!destKey || destKey === key) return;
    if (!canShowNav(destKey)) return;
    navigate(firstAllowedPath, { replace: true });
  }, [firstAllowedPath, canShowNav, location.pathname, navigate]);

  useEffect(() => {
    const next = {};
    for (const group of navigation) {
      const active = group.items.some(([, path]) => pathMatches(path, location.pathname));
      if (active) next[group.group] = true;
    }
    setExpanded((prev) => ({ ...prev, ...next }));
  }, [location.pathname]);

  useEffect(() => {
    const socket = io(import.meta.env.VITE_SOCKET_URL || window.location.origin, {
      auth: { token: localStorage.getItem('zarin_token') },
    });

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    for (const event of socketEvents) {
      socket.on(event, (detail) => {
        window.dispatchEvent(new CustomEvent(`zarin:${event}`, { detail }));
      });
    }

    return () => socket.disconnect();
  }, []);

  const title = useMemo(() => {
    for (const group of navigation) {
      for (const [key, path] of group.items) {
        if (pathMatches(path, location.pathname)) return t(key);
      }
    }
    return t('systemName');
  }, [location.pathname, t]);

  useEffect(() => {
    document.title = `${title} | ${displayName}`;
  }, [title, displayName]);

  const toggleGroup = (group) => {
    setExpanded((prev) => ({ ...prev, [group]: !prev[group] }));
  };

  return (
    <div className="app-shell">
      <div
        className={`sidebar-backdrop ${open ? 'show' : ''}`}
        onClick={() => setOpen(false)}
      />

      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <button
          type="button"
          className="sidebar-close"
          onClick={() => setOpen(false)}
          aria-label={t('close')}
        >
          <X />
        </button>

        <div className="brand-card">
          <BrandWordmark size="sidebar" showSlogan />
        </div>

        <div className="user-card">
          <UserAvatar user={user} className="avatar" />
          <div>
            <strong>{translatePersonName(t, user?.name)}</strong>
            <small className="user-branch">{displayBranch}</small>
          </div>
        </div>

        <nav className="sidebar-nav">
          {navigation.map((group) => {
            const items = group.items.filter(([key]) => canShowNav(key));

            if (!items.length) return null;

            const isOpen = Boolean(expanded[group.group]);
            const hasActive = items.some(([, path]) => pathMatches(path, location.pathname));

            return (
              <section
                key={group.group}
                className={`nav-group ${isOpen ? 'open' : ''} ${hasActive ? 'has-active' : ''}`}
              >
                <button
                  type="button"
                  className="nav-group-toggle"
                  onClick={() => toggleGroup(group.group)}
                  aria-expanded={isOpen}
                >
                  <span className="nav-group-dot" />
                  <span>{t(group.group)}</span>
                  <ChevronDown size={16} className={`nav-chevron ${isOpen ? 'open' : ''}`} />
                </button>

                <div className={`nav-group-items ${isOpen ? 'open' : ''}`}>
                  {items.map(([key, path, Icon]) => (
                    <NavLink
                      key={key}
                      to={path}
                      end={path === '/'}
                      className={({ isActive }) => (isActive ? 'active' : '')}
                    >
                      <span className="nav-icon"><Icon size={18} /></span>
                      <span>{t(key)}</span>
                    </NavLink>
                  ))}
                </div>
              </section>
            );
          })}
        </nav>

        <button type="button" className="logout-btn" onClick={logout}>
          <LogOut size={19} />
          <span>{t('logout')}</span>
        </button>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-main">
            <button
              type="button"
              className="menu-btn"
              onClick={() => setOpen(true)}
              aria-label={t('menu')}
            >
              <Menu />
            </button>

            <div className="topbar-titles">
              <div className="topbar-brand-row">
                <div className="topbar-brand">
                  <BrandWordmark size="nav" />
                </div>
                {languageEnabled ? <LanguageSwitcher compact /> : null}
              </div>
              <h1>{title}</h1>
            </div>
          </div>

          <div className="topbar-actions">
            {isSuperAdmin && isAppMenuEnabled('branches') ? (
              <label className="topbar-branch topbar-branch-select" title={displayBranch}>
                <Building2 size={15} />
                <select
                  value={selectedBranchId || ''}
                  onChange={(e) => setSelectedBranchId(e.target.value || null)}
                  aria-label={t('selectBranch')}
                >
                  <option value="">{t('allBranches')}</option>
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {translatePlace(t, branch.name) || localizeValue(t, branch.name)}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <span className="topbar-branch" title={displayBranch}>
                <Building2 size={15} />
                <span>{displayBranch}</span>
              </span>
            )}
            <span className={`connection-pill ${connected ? 'ok' : 'off'}`}>
              {connected ? <Wifi size={15} /> : <WifiOff size={15} />}
              {connected ? t('online') : t('offline')}
            </span>
            <ThemeToggleButton />
            <NotificationMenu />
            <ProfileMenu />
          </div>
        </header>

        <div className="page-container">
          <PageMotion>
            <Outlet key={pageScopeKey} />
          </PageMotion>
        </div>
      </main>
    </div>
  );
}
