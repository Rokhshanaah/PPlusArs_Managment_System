import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

const STORAGE_KEY = 'zarin_notifications';
const MAX_ITEMS = 40;
const NotificationContext = createContext(null);

const EVENT_META = {
  'transactions:changed': { key: 'notifTransaction', tone: 'info' },
  'balances:changed': { key: 'notifBalance', tone: 'info' },
  'customers:changed': { key: 'notifCustomer', tone: 'success' },
  'accounts:changed': { key: 'notifAccount', tone: 'info' },
  'remittances:changed': { key: 'notifRemittance', tone: 'warning' },
  'cashboxes:changed': { key: 'notifCashbox', tone: 'info' },
  'branches:changed': { key: 'notifBranch', tone: 'info' },
  'currencies:changed': { key: 'notifCurrency', tone: 'info' },
  'rates:changed': { key: 'notifRate', tone: 'success' },
  'staff:changed': { key: 'notifStaff', tone: 'warning' },
  'settings:changed': { key: 'notifSettings', tone: 'info' },
  'messages:changed': { key: 'notifMessage', tone: 'success' },
};

function readStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_ITEMS) : [];
  } catch {
    return [];
  }
}

function persist(items) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_ITEMS)));
  } catch {
    /* ignore */
  }
}

export function NotificationProvider({ children }) {
  const [items, setItems] = useState(readStored);

  useEffect(() => {
    const handlers = Object.keys(EVENT_META).map((eventName) => {
      const listener = (event) => {
        const meta = EVENT_META[eventName];
        const detail = event?.detail || {};
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const nextItem = {
          id,
          event: eventName,
          messageKey: meta.key,
          tone: meta.tone,
          detailId: detail.id || detail.transactionId || null,
          createdAt: new Date().toISOString(),
          read: false,
        };

        setItems((prev) => {
          const next = [nextItem, ...prev].slice(0, MAX_ITEMS);
          persist(next);
          return next;
        });
      };

      window.addEventListener(`zarin:${eventName}`, listener);
      return () => window.removeEventListener(`zarin:${eventName}`, listener);
    });

    return () => {
      handlers.forEach((off) => off());
    };
  }, []);

  const unreadCount = useMemo(
    () => items.filter((item) => !item.read).length,
    [items],
  );

  const markAllRead = useCallback(() => {
    setItems((prev) => {
      const next = prev.map((item) => ({ ...item, read: true }));
      persist(next);
      return next;
    });
  }, []);

  const markRead = useCallback((id) => {
    setItems((prev) => {
      const next = prev.map((item) =>
        item.id === id ? { ...item, read: true } : item,
      );
      persist(next);
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    setItems([]);
    persist([]);
  }, []);

  const value = useMemo(
    () => ({
      items,
      unreadCount,
      markAllRead,
      markRead,
      clearAll,
    }),
    [items, unreadCount, markAllRead, markRead, clearAll],
  );

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) {
    return {
      items: [],
      unreadCount: 0,
      markAllRead: () => {},
      markRead: () => {},
      clearAll: () => {},
    };
  }
  return ctx;
}
