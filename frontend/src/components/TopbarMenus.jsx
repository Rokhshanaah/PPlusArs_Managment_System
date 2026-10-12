import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Bell,
  LogOut,
  Moon,
  Settings,
  Sun,
  UserRound,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useCompany } from '../context/CompanyContext.jsx';
import { useNotifications } from '../context/NotificationContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import UserAvatar from './UserAvatar.jsx';
import { dateTime } from '../utils/format.js';
import { translatePersonName, translateRole } from '../utils/labels.js';

function useOutsideClose(open, onClose) {
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    const onPointer = (event) => {
      if (ref.current && !ref.current.contains(event.target)) {
        onClose();
      }
    };

    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
    };

    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  return ref;
}

export function ThemeToggleButton() {
  const { t } = useTranslation();
  const { isDark, toggleTheme } = useTheme();

  return (
    <button
      type="button"
      className="topbar-icon-btn"
      onClick={toggleTheme}
      title={isDark ? t('lightMode') : t('darkMode')}
      aria-label={isDark ? t('lightMode') : t('darkMode')}
    >
      {isDark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}

export function NotificationMenu() {
  const { t } = useTranslation();
  const { items, unreadCount, markAllRead, markRead, clearAll } =
    useNotifications();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const rootRef = useOutsideClose(open, close);

  const toggle = () => {
    setOpen((prev) => {
      const next = !prev;
      if (next) markAllRead();
      return next;
    });
  };

  return (
    <div className="topbar-menu" ref={rootRef}>
      <button
        type="button"
        className="topbar-icon-btn"
        onClick={toggle}
        aria-expanded={open}
        aria-label={t('notifications')}
        title={t('notifications')}
      >
        <Bell size={16} />
        {unreadCount > 0 ? (
          <span className="topbar-badge">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="topbar-dropdown topbar-dropdown-notifications" role="menu">
          <div className="topbar-dropdown-head">
            <strong>{t('notifications')}</strong>
            <button type="button" className="btn tiny soft" onClick={clearAll}>
              {t('clearNotifications')}
            </button>
          </div>

          {items.length === 0 ? (
            <p className="topbar-dropdown-empty">{t('noNotifications')}</p>
          ) : (
            <ul className="topbar-notification-list">
              {items.slice(0, 12).map((item) => (
                <li
                  key={item.id}
                  className={`topbar-notification-item ${item.read ? '' : 'unread'} tone-${item.tone}`}
                >
                  <button type="button" onClick={() => markRead(item.id)}>
                    <strong>{t(item.messageKey)}</strong>
                    <span>{dateTime(item.createdAt)}</span>
                  </button>
                  {item.event === 'messages:changed' ? (
                    <Link
                      to="/messages"
                      className="topbar-notification-link"
                      onClick={close}
                    >
                      {t('messages')}
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function ProfileMenu() {
  const { t } = useTranslation();
  const { user, logout, hasPermission, isSuperAdmin } = useAuth();
  const { isAppMenuEnabled } = useCompany();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const rootRef = useOutsideClose(open, close);

  return (
    <div className="topbar-menu" ref={rootRef}>
      <button
        type="button"
        className="topbar-profile-btn"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-label={t('profile')}
        title={t('profile')}
      >
        <UserAvatar user={user} className="topbar-profile-avatar" />
      </button>

      {open ? (
        <div className="topbar-dropdown topbar-dropdown-profile" role="menu">
          <div className="topbar-profile-card">
            <UserAvatar user={user} className="topbar-profile-avatar large" />
            <div className="topbar-profile-info">
              <strong>{translatePersonName(t, user?.name)}</strong>
              {translateRole(t, user?.role) !== translatePersonName(t, user?.name) ? (
                <span>{translateRole(t, user?.role)}</span>
              ) : null}
              {user?.username ? <small>@{user.username}</small> : null}
            </div>
          </div>

          <div className="topbar-dropdown-actions">
            {isSuperAdmin ? (
              <Link to="/settings" className="topbar-dropdown-link" onClick={close}>
                <Settings size={15} />
                <span>{t('settings')}</span>
              </Link>
            ) : null}

            {hasPermission('staff') && isAppMenuEnabled('staff') ? (
              <Link to="/staff" className="topbar-dropdown-link" onClick={close}>
                <UserRound size={15} />
                <span>{t('staff')}</span>
              </Link>
            ) : null}

            <button
              type="button"
              className="topbar-dropdown-link danger"
              onClick={() => {
                close();
                logout();
              }}
            >
              <LogOut size={15} />
              <span>{t('logout')}</span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
