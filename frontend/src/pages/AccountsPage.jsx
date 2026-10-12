import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FileDown, MessageCircle, WalletCards } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api, messageOf } from '../api/client.js';
import { useApiData } from '../hooks/useApiData.js';
import { ErrorBox, Loading, PageHeader, SearchBox, Table } from '../components/Common.jsx';
import UserAvatar from '../components/UserAvatar.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { money } from '../utils/format.js';
import { localizeCurrency, localizeValue, translatePersonName } from '../utils/labels.js';
import { openCustomerWhatsapp } from '../utils/whatsapp.js';
import { downloadAccountsReportPdf } from '../utils/accountsReportPdf.js';
import { useCompany } from '../context/CompanyContext.jsx';

function normalizeSide(value) {
  const side = String(value || '').toLowerCase();
  if (side === 'debtor' || side === 'creditor') return side;
  return '';
}

function normalizeSource(value) {
  return String(value || '').trim() === 'card_reader' ? 'card_reader' : '';
}

export default function AccountsPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const { hasFeature } = useCompany();
  const [searchParams, setSearchParams] = useSearchParams();
  const source = normalizeSource(searchParams.get('source'));
  const side = source ? '' : normalizeSide(searchParams.get('side'));
  const [search, setSearch] = useState('');
  const [sharing, setSharing] = useState(false);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (search.trim()) params.set('search', search.trim());
    if (source === 'card_reader') {
      params.set('source', 'card_reader');
    } else {
      params.set('source', 'manual');
      if (side) params.set('side', side);
    }
    return `/customer-accounts?${params.toString()}`;
  }, [search, side, source]);

  const { data, loading, error, reload } = useApiData(query, {
    event: ['zarin:accounts:changed', 'zarin:balances:changed', 'zarin:rates:changed', 'zarin:currencies:changed'],
  });

  const setTab = (next) => {
    const params = new URLSearchParams(searchParams);
    params.delete('side');
    params.delete('source');
    if (next === 'debtor' || next === 'creditor') params.set('side', next);
    else if (next === 'card_reader') params.set('source', 'card_reader');
    setSearchParams(params, { replace: true });
  };

  const title = source === 'card_reader'
    ? t('cardReaderCustomers')
    : side === 'debtor'
      ? t('marketReceivable')
      : side === 'creditor'
        ? t('marketPayable')
        : t('accounts');

  const subtitle = source === 'card_reader'
    ? t('cardReaderAccountsHint')
    : side === 'debtor'
      ? t('marketReceivableListHint')
      : side === 'creditor'
        ? t('marketPayableListHint')
        : t('accountsHint');

  const sideBadge = (accountSide) => {
    if (accountSide === 'creditor') return <span className="badge success">{t('creditor')}</span>;
    if (accountSide === 'debtor') return <span className="badge danger">{t('debtor')}</span>;
    if (accountSide === 'settled') return <span className="badge muted">{t('accountSettled')}</span>;
    if (accountSide === 'both') {
      return (
        <>
          <span className="badge success">{t('creditor')}</span>
          <span className="badge danger">{t('debtor')}</span>
        </>
      );
    }
    return <span className="badge muted">{t('accountSettled')}</span>;
  };

  // سازگاری با پاسخ قدیمی (آرایه) و جدید ({ rows, totals, baseCurrency })
  const rows = Array.isArray(data) ? data : (data?.rows || []);
  const totals = Array.isArray(data) ? null : (data?.totals || null);

  const shareFilters = () => {
    const payload = {};
    if (search.trim()) payload.search = search.trim();
    if (source === 'card_reader') payload.source = 'card_reader';
    else {
      payload.source = 'manual';
      if (side) payload.side = side;
    }
    return payload;
  };

  const handleShareWhatsappPdf = async () => {
    if (sharing || loading) return;
    setSharing(true);
    try {
      await downloadAccountsReportPdf({
        title,
        subtitle,
        rows,
        totals,
        side,
        labels: {
          customer: t('customer'),
          phone: t('phone'),
          currentBalance: t('currentBalance'),
          accountSide: t('accountSide'),
          creditor: t('creditor'),
          debtor: t('debtor'),
          settled: t('accountSettled'),
          receivableByCurrency: t('receivableByCurrency'),
          payableByCurrency: t('payableByCurrency'),
          generatedAt: t('accountsReportGeneratedAt'),
          noData: t('noData'),
        },
      });

      const { data: res } = await api.post('/customer-accounts/whatsapp-report', shareFilters());
      const whatsapp = res?.data?.whatsapp;
      if (whatsapp?.link) openCustomerWhatsapp(whatsapp);
      toast.show(t('accountsReportWhatsappReady'));
    } catch (err) {
      toast.show(messageOf(err), 'error');
    } finally {
      setSharing(false);
    }
  };

  const renderCurrencyTotals = (blockTitle, currencyRows, amountClass = '') => {
    const list = Array.isArray(currencyRows) ? currencyRows : [];
    if (!list.length) {
      return (
        <div className="rw-currency-totals-block">
          <h4>{blockTitle}</h4>
          <p className="rw-group-empty">{t('noData')}</p>
        </div>
      );
    }
    return (
      <div className="rw-currency-totals-block">
        <h4>{blockTitle}</h4>
        <div className="rw-currency-totals-list">
          {list.map((row) => (
            <div key={row.currencyId || row.code} className="rw-currency-total-row">
              <span>
                <strong>{row.code}</strong>
                {row.name ? <small>{localizeCurrency(t, row)}</small> : null}
              </span>
              <strong className={amountClass}>
                {money(row.amount)}
                {' '}
                {row.symbol || row.code}
              </strong>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <>
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={hasFeature('whatsapp') ? (
          <button
            type="button"
            className="btn soft"
            disabled={sharing || loading || !rows.length}
            onClick={handleShareWhatsappPdf}
            title={t('accountsReportWhatsappHint')}
          >
            {sharing ? <FileDown size={16} /> : <MessageCircle size={16} />}
            {sharing ? t('accountsReportPreparing') : t('accountsReportWhatsapp')}
          </button>
        ) : null}
      />

      <div className="panel">
        <div className="tabs" style={{ marginBottom: 12 }}>
          <button type="button" className={!side && !source ? 'active' : ''} onClick={() => setTab('')}>
            {t('all')}
          </button>
          <button type="button" className={side === 'debtor' ? 'active' : ''} onClick={() => setTab('debtor')}>
            {t('marketReceivable')}
          </button>
          <button type="button" className={side === 'creditor' ? 'active' : ''} onClick={() => setTab('creditor')}>
            {t('marketPayable')}
          </button>
          <button
            type="button"
            className={source === 'card_reader' ? 'active' : ''}
            onClick={() => setTab('card_reader')}
          >
            {t('cardReaderCustomers')}
          </button>
        </div>

        <SearchBox value={search} onChange={setSearch} onRefresh={reload} />

        {loading ? <Loading /> : error ? <ErrorBox message={error} /> : (
          <>
            <Table
              rows={rows}
              columns={[
                {
                  key: 'customer',
                  label: t('customer'),
                  render: (r) => (
                    <div className="row-with-avatar">
                      <UserAvatar name={r.name} avatarUrl={r.avatarUrl} className="large" />
                      <div>
                        <strong>{translatePersonName(t, r.name)}</strong>
                        <small>
                          #{r.id}
                          {r.fatherName ? ` · ${t('fatherName')}: ${translatePersonName(t, r.fatherName)}` : ''}
                        </small>
                      </div>
                    </div>
                  ),
                },
                {
                  key: 'phone',
                  label: t('phone'),
                  render: (r) => (r.phone && r.phone !== 'بدون‌شماره' ? r.phone : '—'),
                },
                {
                  key: 'whatsappPhone',
                  label: t('customerWhatsapp'),
                  render: (r) => r.whatsappPhone || '—',
                },
                {
                  key: 'document',
                  label: t('documentNumber'),
                  render: (r) => (
                    <div>
                      <strong>{r.documentNumber || '—'}</strong>
                      {r.documentType ? <small>{localizeValue(t, r.documentType)}</small> : null}
                    </div>
                  ),
                },
                {
                  key: 'address',
                  label: t('address'),
                  render: (r) => r.address || '—',
                },
                {
                  key: 'summary',
                  label: side === 'debtor'
                    ? t('receivableAmount')
                    : side === 'creditor'
                      ? t('payableAmount')
                      : t('currentBalance'),
                  render: (r) => (
                    <div className="summary-chips">
                      {r.accountSide === 'settled' ? (
                        <span className="badge muted">{t('accountSettled')}</span>
                      ) : (r.openBalances || []).length
                        ? (r.openBalances || [])
                          .filter((b) => b.side !== 'settled')
                          .map((b) => (
                            <span
                              key={`${b.code}-${b.side}`}
                              className={`badge ${b.side === 'creditor' ? 'success' : 'danger'}`}
                              title={b.side === 'creditor' ? t('creditor') : t('debtor')}
                            >
                              {b.code}: {money(Math.abs(Number(b.amount || 0)))}
                            </span>
                          ))
                        : Object.entries(r.summary || {}).length
                          ? Object.entries(r.summary).map(([code, s]) => (
                            <span
                              key={code}
                              className={`badge ${s.balance > 0 ? 'success' : s.balance < 0 ? 'danger' : 'muted'}`}
                            >
                              {Number(s.balance) === 0
                                ? `${code}: ${t('accountSettled')}`
                                : `${code}: ${money(s.balance)}`}
                            </span>
                          ))
                          : <span className="badge muted">{t('accountSettled')}</span>}
                    </div>
                  ),
                },
                {
                  key: 'side',
                  label: t('accountSide'),
                  render: (r) => sideBadge(r.accountSide),
                },
                {
                  key: 'actions',
                  label: t('actions'),
                  render: (r) => (
                    <div className="row-actions accounts-row-actions">
                      <Link
                        className="btn tiny primary"
                        to={`/customers/${r.id}/ledger`}
                        title={r.accountSide === 'settled' ? t('accountLedger') : t('settleAccount')}
                      >
                        <WalletCards size={16} />
                        {r.accountSide === 'settled' ? t('accountLedger') : (side ? t('settleAccount') : t('accountLedger'))}
                      </Link>
                    </div>
                  ),
                },
              ]}
            />

            {totals ? (
              <div className="accounts-totals rw-currency-summary">
                {!side ? (
                  <div className="rw-currency-summary-grid">
                    {renderCurrencyTotals(t('receivableByCurrency'), totals.receivableByCurrency, 'negative')}
                    {renderCurrencyTotals(t('payableByCurrency'), totals.payableByCurrency, 'positive')}
                  </div>
                ) : side === 'debtor' ? (
                  renderCurrencyTotals(t('receivableByCurrency'), totals.receivableByCurrency, 'negative')
                ) : (
                  renderCurrencyTotals(t('payableByCurrency'), totals.payableByCurrency, 'positive')
                )}
              </div>
            ) : null}
          </>
        )}

        {!loading && !error && (side || source) && rows.length === 0 ? (
          <p className="muted-hint" style={{ marginTop: 12 }}>{t('marketListEmpty')}</p>
        ) : null}
      </div>
    </>
  );
}
