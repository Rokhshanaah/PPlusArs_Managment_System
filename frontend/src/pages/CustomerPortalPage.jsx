import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, messageOf } from '../api/client.js';
import { ErrorBox, LanguageSwitcher, Loading } from '../components/Common.jsx';
import CustomerLedgerStatement from '../components/CustomerLedgerStatement.jsx';
import PageMotion from '../components/PageMotion.jsx';
import { dateTime, money } from '../utils/format.js';
import { localizeCurrency, localizeValue } from '../utils/labels.js';
import { DEFAULT_CUSTOMER_PORTAL_MENUS, parseCustomerPortalLanguage } from '../utils/customerPortal.js';
import { useCompany } from '../context/CompanyContext.jsx';

const LEDGER_KEYS = new Set(['accounts', 'receiptsWithdrawals', 'journal']);
const BALANCE_KEYS = new Set(['dashboard', 'balance']);
const RATE_KEYS = new Set(['rates', 'buy', 'sell', 'exchange']);

function BalancesBlock({ data, t }) {
  return (
    <section className="balance-cards">
      {(data.balances || []).length === 0 ? (
        <article>
          <span>{t('currentBalance')}</span>
          <strong>0</strong>
          <small>{t('settled')}</small>
        </article>
      ) : (
        data.balances.map((b, index) => {
          const amount = Number(b.amount);
          return (
            <article key={`${b.currency?.code || 'x'}-${index}`}>
              <span>
                {b.currency?.code}
                {b.currency ? ` — ${localizeCurrency(t, b.currency)}` : ''}
              </span>
              <strong className={amount > 0 ? 'positive' : amount < 0 ? 'negative' : ''}>
                {money(b.amount)} {b.currency?.symbol || ''}
              </strong>
              <small>
                {amount > 0 ? t('creditor') : amount < 0 ? t('debtor') : t('settled')}
              </small>
            </article>
          );
        })
      )}
    </section>
  );
}

function MessagesBlock({ data, t, messageText, setMessageText, sending, sendError, sendOk, sendMessage }) {
  return (
    <section className="panel customer-portal-messages">
      <h3>{t('sendMessageToOffice')}</h3>
      <p className="empty-hint">{t('sendMessageHint')}</p>
      <form className="portal-message-form" onSubmit={sendMessage}>
        <textarea
          rows={4}
          maxLength={2000}
          value={messageText}
          onChange={(e) => setMessageText(e.target.value)}
          placeholder={t('messagePlaceholder')}
        />
        {sendError ? <ErrorBox message={sendError} /> : null}
        {sendOk ? <p className="portal-message-ok">{sendOk}</p> : null}
        <button className="btn primary" type="submit" disabled={sending}>
          {sending ? t('sending') : t('sendMessage')}
        </button>
      </form>

      {(data.messages || []).length > 0 ? (
        <div className="portal-message-thread">
          <h4>{t('yourMessages')}</h4>
          <ul>
            {data.messages.map((m) => (
              <li key={m.id}>
                <p>{m.body}</p>
                <small>
                  {dateTime(m.createdAt)}
                  {m.readAt ? ` • ${t('read')}` : ''}
                </small>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

export default function CustomerPortalPage() {
  const { token } = useParams();
  const { t, i18n } = useTranslation();
  const { languageEnabled } = useCompany();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [messageText, setMessageText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [sendOk, setSendOk] = useState('');
  const [activeMenu, setActiveMenu] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/public/customers/${token}`);
      setData(res.data.data);
      setError('');
    } catch (e) {
      setError(messageOf(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const res = await api.get(`/public/customers/${token}`);
        if (!alive) return;
        setData(res.data.data);
        setError('');
      } catch (e) {
        if (!alive) return;
        setError(messageOf(e));
        setData(null);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [token]);

  const menus = data?.portal?.menus?.length ? data.portal.menus : DEFAULT_CUSTOMER_PORTAL_MENUS;
  const navMenus = useMemo(
    () => menus.filter((key) => key !== 'language'),
    [menus],
  );
  const defaultLang = parseCustomerPortalLanguage(data?.portal?.language);
  const dataReady = Boolean(data);
  const activeLang = languageEnabled
    ? parseCustomerPortalLanguage(i18n.language)
    : 'fa';

  useEffect(() => {
    if (!dataReady) return;
    const prev = i18n.language;
    i18n.changeLanguage(languageEnabled ? defaultLang : 'fa');
    return () => { i18n.changeLanguage(prev); };
  }, [dataReady, languageEnabled, defaultLang, token, i18n]);

  useEffect(() => {
    if (!navMenus.length) return;
    setActiveMenu((current) => (navMenus.includes(current) ? current : navMenus[0]));
  }, [navMenus]);

  const sendMessage = async (e) => {
    e.preventDefault();
    const body = messageText.trim();
    if (body.length < 2) {
      setSendError(t('messageTooShort'));
      return;
    }
    setSending(true);
    setSendError('');
    setSendOk('');
    try {
      await api.post(`/public/customers/${token}/messages`, { body });
      setMessageText('');
      setSendOk(t('messageSent'));
      await load();
    } catch (err) {
      setSendError(messageOf(err));
    } finally {
      setSending(false);
    }
  };

  const dir = activeLang === 'en' ? 'ltr' : 'rtl';

  const body = useMemo(() => {
    if (!data || !activeMenu) return null;
    if (BALANCE_KEYS.has(activeMenu)) return <BalancesBlock data={data} t={t} />;
    if (activeMenu === 'customers') {
      return (
        <section className="panel customer-portal-ledger">
          <h3>{t('customer')}</h3>
          <p><strong>{localizeValue(t, data.customer.name)}</strong></p>
          {data.customer.fatherName ? <p>{t('fatherName')}: {data.customer.fatherName}</p> : null}
          {data.customer.phone ? <p>{t('phone')}: {data.customer.phone}</p> : null}
          {data.customer.address ? <p>{t('address')}: {localizeValue(t, data.customer.address)}</p> : null}
        </section>
      );
    }
    if (LEDGER_KEYS.has(activeMenu)) {
      return (
        <section className="panel customer-portal-ledger">
          <h3>{t('accountLedger')}</h3>
          <CustomerLedgerStatement
            currencyGroups={data.currencyGroups}
            showCashbox={false}
            compact
          />
        </section>
      );
    }
    if (activeMenu === 'messages') {
      return (
        <MessagesBlock
          data={data}
          t={t}
          messageText={messageText}
          setMessageText={setMessageText}
          sending={sending}
          sendError={sendError}
          sendOk={sendOk}
          sendMessage={sendMessage}
        />
      );
    }
    if (RATE_KEYS.has(activeMenu)) {
      return (
        <section className="panel customer-portal-ledger">
          <h3>{t('rates')}</h3>
          {(data.rates || []).length ? (
            <ul className="portal-simple-list">
              {data.rates.map((r) => (
                <li key={r.id}>
                  <strong>{r.from?.code || '—'} / {r.to?.code || '—'}</strong>
                  <span>{t('buyRate')}: {money(r.buyRate, 4)}</span>
                  <span>{t('sellRate')}: {money(r.sellRate, 4)}</span>
                </li>
              ))}
            </ul>
          ) : <p className="empty-hint">{t('noData')}</p>}
        </section>
      );
    }
    if (activeMenu === 'currencies') {
      return (
        <section className="panel customer-portal-ledger">
          <h3>{t('currencies')}</h3>
          {(data.currencies || []).length ? (
            <ul className="portal-simple-list">
              {data.currencies.map((c) => (
                <li key={c.id}>
                  <strong>{c.code}</strong>
                  <span>{localizeCurrency(t, c)} {c.symbol || ''}</span>
                </li>
              ))}
            </ul>
          ) : <p className="empty-hint">{t('noData')}</p>}
        </section>
      );
    }
    if (activeMenu === 'remittances') {
      return (
        <section className="panel customer-portal-ledger">
          <h3>{t('remittances')}</h3>
          {(data.remittances || []).length ? (
            <ul className="portal-simple-list">
              {data.remittances.map((r) => (
                <li key={r.id}>
                  <strong>{r.number}</strong>
                  <span>{money(r.amount)} {r.currency?.symbol || r.currency?.code || ''}</span>
                  <span>{r.receiverName}</span>
                  <small>{localizeValue(t, r.state)} • {dateTime(r.createdAt)}</small>
                </li>
              ))}
            </ul>
          ) : <p className="empty-hint">{t('noData')}</p>}
        </section>
      );
    }
    return (
      <section className="panel customer-portal-ledger">
        <h3>{t(activeMenu)}</h3>
        <p className="empty-hint">{t('customerPortalInternalOnly')}</p>
      </section>
    );
  }, [activeMenu, data, t, messageText, sending, sendError, sendOk]);

  if (loading) {
    return (
      <div className="customer-portal">
        <Loading />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="customer-portal">
        <div className="customer-portal-card">
          <ErrorBox message={error || t('notFound')} />
        </div>
      </div>
    );
  }

  return (
    <PageMotion>
    <div className="customer-portal" dir={dir} lang={activeLang}>
      <div className="customer-portal-card">
        <header className="customer-portal-brand">
          <h1>{data.company?.name || t('systemName')}</h1>
          {data.company?.slogan ? <p>{data.company.slogan}</p> : null}
          {languageEnabled ? (
            <div className="customer-portal-lang">
              <LanguageSwitcher compact />
            </div>
          ) : null}
        </header>

        <section className="customer-portal-identity">
          <h2>{t('customerAccountView')}</h2>
          <p>
            <strong>{localizeValue(t, data.customer.name)}</strong>
            {data.customer.phone ? <span> • {data.customer.phone}</span> : null}
          </p>
        </section>

        {navMenus.length > 1 ? (
          <nav className="customer-portal-nav" aria-label={t('menu')}>
            {navMenus.map((key) => (
              <button
                key={key}
                type="button"
                className={activeMenu === key ? 'active' : ''}
                onClick={() => setActiveMenu(key)}
              >
                {t(key)}
              </button>
            ))}
          </nav>
        ) : null}

        {body}

        {data.company?.phone ? (
          <footer className="customer-portal-footer">
            {t('phone')}: {data.company.phone}
          </footer>
        ) : null}
      </div>
    </div>
    </PageMotion>
  );
}
