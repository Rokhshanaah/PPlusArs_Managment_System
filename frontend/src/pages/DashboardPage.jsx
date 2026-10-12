import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Banknote,
  CircleDollarSign,
  Coins,
  HandCoins,
  RefreshCw,
  Scale,
  Send,
  TrendingDown,
  TrendingUp,
  Wallet,
  WalletCards,
} from 'lucide-react';
import { useApiData } from '../hooks/useApiData.js';
import { useCompany } from '../context/CompanyContext.jsx';
import { ErrorBox, Loading } from '../components/Common.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { jalaliTodayLong, money } from '../utils/format.js';
import { localizeCurrency, localizeValue } from '../utils/labels.js';

const DASHBOARD_EVENTS = [
  'zarin:transactions:changed',
  'zarin:balances:changed',
  'zarin:remittances:changed',
  'zarin:accounts:changed',
  'zarin:expenses:changed',
  'zarin:currencies:changed',
  'zarin:rates:changed',
];

const currencyTones = ['emerald', 'blue', 'amber', 'cyan', 'purple', 'slate', 'rose'];
const currencyIcons = [Banknote, CircleDollarSign, Coins, Wallet, WalletCards, Coins, Banknote];

function useLiveBusinessDate() {
  const { i18n } = useTranslation();
  const [today, setToday] = useState(() => jalaliTodayLong());

  useEffect(() => {
    const refresh = () => setToday(jalaliTodayLong());
    refresh();

    // Refresh every minute so the date flips automatically after midnight (Kabul).
    const timer = window.setInterval(refresh, 60_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', refresh);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', refresh);
    };
  }, [i18n.language]);

  return today;
}

export default function DashboardPage() {
  const { t, i18n } = useTranslation();
  const { displayName, displaySlogan } = useCompany();
  const { isBranchScoped, branchName } = useAuth();
  const today = useLiveBusinessDate();
  const { data, loading, error, reload } = useApiData('/dashboard', {
    event: DASHBOARD_EVENTS,
  });

  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} />;

  void i18n.language;

  const currencyCards = (data?.currencyCards || []).map((row, index) => ({
    key: `cur-${row.code}`,
    label: localizeCurrency(t, row),
    value: `${money(row.total)} ${row.unit || row.code}`,
    hint: row.code === 'TMN' ? t('tomanFromRial') : (row.symbol || row.code),
    icon: currencyIcons[index % currencyIcons.length],
    to: '/balance',
    tone: currencyTones[index % currencyTones.length],
  }));

  const finance = data?.finance || {};
  const base = data?.baseCurrency || { code: finance.unit || 'AFN', name: '', symbol: '' };
  const baseUnit = base.code || finance.unit || 'AFN';
  const withBase = (value) => `${money(value)} ${baseUnit}`;

  const financeCards = [
    {
      key: 'grossProfit',
      label: t('grossProfit'),
      value: withBase(finance.grossProfit),
      hint: `${t('profit')} · ${t('baseCurrency')}: ${baseUnit}`,
      icon: TrendingUp,
      to: '/reports',
      tone: 'emerald',
    },
    {
      key: 'expenses',
      label: t('expenses'),
      value: withBase(finance.expenses),
      hint: `${t('expenses')} · ${baseUnit}`,
      icon: HandCoins,
      to: '/expenses',
      tone: 'amber',
    },
    {
      key: 'loss',
      label: t('loss'),
      value: withBase(finance.loss),
      hint: `${t('totalLoss')} · ${baseUnit}`,
      icon: TrendingDown,
      to: '/reports',
      tone: 'rose',
    },
    {
      key: 'netProfit',
      label: t('netProfit'),
      value: withBase(finance.netProfit),
      hint: `${t('profit')} · ${baseUnit}`,
      icon: WalletCards,
      to: '/reports',
      tone: 'cyan',
    },
    {
      key: 'receivables',
      label: t('marketReceivable'),
      value: withBase(finance.receivables),
      hint: `${t('marketReceivableHint')} · ${baseUnit}`,
      icon: Scale,
      to: '/accounts?side=debtor',
      tone: 'blue',
    },
    {
      key: 'payables',
      label: t('marketPayable'),
      value: withBase(finance.payables),
      hint: `${t('marketPayableHint')} · ${baseUnit}`,
      icon: Scale,
      to: '/accounts?side=creditor',
      tone: 'purple',
    },
    {
      key: 'waitingRemittances',
      label: t('waitingRemittances'),
      value: finance.waitingRemittances ?? 0,
      hint: `${withBase(finance.waitingRemittanceAmount)} · ${t('pendingPayment')}`,
      icon: Send,
      to: '/remittances',
      tone: 'rose',
    },
  ];

  const cards = [...currencyCards, ...financeCards];

  const scope = data?.scope;
  const scopedBranchLabel = scope?.branchName || branchName;

  return (
    <div className="dashboard-page">
      <section className="dashboard-hero">
        <div>
          <span>{displayName}</span>
          <h2>{t('dashboard')}</h2>
          <p>{displaySlogan}</p>
          {(isBranchScoped || scope?.scoped) && scopedBranchLabel ? (
            <p className="branch-scope-badge">
              {t('branchScopeHint')}: <strong>{localizeValue(t, scopedBranchLabel)}</strong>
            </p>
          ) : null}
        </div>
        <div className="dashboard-hero-actions">
          <strong className="dashboard-today">{today}</strong>
          <button type="button" className="dashboard-refresh" onClick={reload}>
            <RefreshCw size={17} />
            {t('refresh')}
          </button>
        </div>
      </section>

      <section className="dashboard-stats">
        {cards.map(({ key, label, value, hint, icon: Icon, to, tone }) => (
          <Link className={`dashboard-stat-card tone-${tone}`} to={to} key={key}>
            <div className="dashboard-stat-icon"><Icon size={22} /></div>
            <div className="dashboard-stat-copy">
              <span>{label}</span>
              <strong>{value}</strong>
              <small>{hint}</small>
            </div>
          </Link>
        ))}
      </section>
    </div>
  );
}
