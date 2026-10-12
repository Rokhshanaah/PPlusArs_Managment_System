import { useEffect, useState } from 'react';
import { CheckCheck, MessageSquareText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api, messageOf } from '../api/client.js';
import { ErrorBox, Loading, PageHeader, SearchBox } from '../components/Common.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { dateTime } from '../utils/format.js';
import { localizeValue, translatePersonName } from '../utils/labels.js';

export default function MessagesPage() {
  const { t } = useTranslation();
  const { show } = useToast();
  const [rows, setRows] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [search, setSearch] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/messages', {
        params: {
          limit: 50,
          unread: unreadOnly ? '1' : undefined,
          search: search.trim() || undefined,
        },
      });
      setRows(data.data.rows || []);
      setUnreadCount(data.data.unreadCount || 0);
      setError('');
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [unreadOnly, search]);

  useEffect(() => {
    const onChange = () => load();
    window.addEventListener('zarin:messages:changed', onChange);
    return () => window.removeEventListener('zarin:messages:changed', onChange);
  }, [unreadOnly, search]);

  const markRead = async (row) => {
    try {
      await api.patch(`/messages/${row.id}/read`);
      show(t('success'));
      load();
    } catch (e) {
      show(messageOf(e), 'error');
    }
  };

  const markAll = async () => {
    try {
      await api.post('/messages/read-all');
      show(t('success'));
      load();
    } catch (e) {
      show(messageOf(e), 'error');
    }
  };

  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} />;

  return (
    <>
      <PageHeader
        title={t('messages')}
        subtitle={t('messagesHint', { count: unreadCount })}
        actions={(
          <div className="page-actions">
            <button
              type="button"
              className={`btn soft ${unreadOnly ? 'primary' : ''}`}
              onClick={() => setUnreadOnly((v) => !v)}
            >
              {unreadOnly ? t('showAllMessages') : t('showUnreadMessages')}
            </button>
            {unreadCount > 0 ? (
              <button type="button" className="btn primary" onClick={markAll}>
                <CheckCheck size={16} />
                {t('markAllRead')}
              </button>
            ) : null}
          </div>
        )}
      />

      <div className="panel">
        <SearchBox value={search} onChange={setSearch} onRefresh={load} />
        {rows.length === 0 ? (
          <p className="empty-hint">{t('noMessages')}</p>
        ) : (
          <div className="messages-list">
            {rows.map((row) => (
              <article
                key={row.id}
                className={`message-card ${row.readAt ? '' : 'unread'}`}
              >
                <header>
                  <div className="message-card-title">
                    <MessageSquareText size={16} />
                    <strong>
                      {translatePersonName(t, row.customer?.name)
                        || localizeValue(t, row.customer?.name)
                        || t('customer')}
                    </strong>
                    {row.customer?.phone ? (
                      <span>{row.customer.phone}</span>
                    ) : null}
                  </div>
                  <small>{dateTime(row.createdAt)}</small>
                </header>
                <p>{row.body}</p>
                <footer>
                  {row.readAt ? (
                    <span className="badge success">{t('read')}</span>
                  ) : (
                    <button
                      type="button"
                      className="btn tiny soft"
                      onClick={() => markRead(row)}
                    >
                      {t('markRead')}
                    </button>
                  )}
                </footer>
              </article>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
