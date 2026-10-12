import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext.jsx';
import { useCompany } from '../context/CompanyContext.jsx';
import { api, messageOf } from '../api/client.js';
import { ErrorBox, Field, Loading, PageHeader, Table } from '../components/Common.jsx';
import DateInput from '../components/DateInput.jsx';
import { money } from '../utils/format.js';
import { localizeCurrency, localizeValue } from '../utils/labels.js';
import { Printer } from 'lucide-react';

function convertByCustomRate({ amount, fromCode, toCode, rate, baseCode }) {
  const n = Number(amount || 0);
  const r = Number(rate || 0);
  if (!Number.isFinite(n)) return 0;
  if (!Number.isFinite(r) || r <= 0) return null;
  if (!fromCode || !toCode) return null;
  if (fromCode === toCode) return n;

  const base = String(baseCode || 'AFN').toUpperCase();
  const from = String(fromCode).toUpperCase();
  const to = String(toCode).toUpperCase();

  // Same semantics as backend calculation:
  // base -> X uses amount / rate
  // Otherwise uses amount * rate
  if (from === base && to !== base) {
    return n / r;
  }
  if (from !== base && to === base) {
    return n * r;
  }
  return n * r;
}

export default function IncomeStatementPage() {
  const { t, i18n } = useTranslation();
  const { isBranchScoped, branchName } = useAuth();
  const { displayName } = useCompany();

  const [filters, setFilters] = useState({ dateFrom: '', dateTo: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statement, setStatement] = useState(null);

  const [lookups, setLookups] = useState(null);
  const [customToCurrencyId, setCustomToCurrencyId] = useState('');
  const [customRate, setCustomRate] = useState('');

  const baseCurrencyCode = statement?.baseCurrency?.code || statement?.unit || '';

  const periodLabel = useMemo(() => {
    const from = filters.dateFrom;
    const to = filters.dateTo;
    const parts = [
      from ? String(from) : t('all'),
      to ? String(to) : t('all'),
    ];
    return parts.join(' — ');
  }, [filters.dateFrom, filters.dateTo, t, i18n.language]);

  const subtitle = useMemo(() => {
    const scopedBranchLabel = branchName;
    return [
      periodLabel,
      (isBranchScoped) && scopedBranchLabel ? `${t('branchScopeHint')}: ${localizeValue(t, scopedBranchLabel)}` : null,
    ].filter(Boolean).join(' · ');
  }, [periodLabel, isBranchScoped, branchName, t]);

  const load = async () => {
    setLoading(true);
    try {
      const [s, l] = await Promise.all([
        api.get('/income-statement', { params: filters }),
        api.get('/lookups'),
      ]);
      setStatement(s.data.data);
      setLookups(l.data.data);
      setError('');
    } catch (e) {
      setError(messageOf(e) || t('error'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!lookups?.currencies?.length || !baseCurrencyCode) return;
    if (customToCurrencyId) return;

    const base = lookups.currencies.find((c) => c.code === baseCurrencyCode);
    const preferred = lookups.currencies.find((c) => c.code === 'USD' && (!base || c.id !== base.id))
      || lookups.currencies.find((c) => !base || c.id !== base.id)
      || lookups.currencies[0];

    setCustomToCurrencyId(preferred ? String(preferred.id) : '');
    setCustomRate(''); // user input
  }, [lookups, baseCurrencyCode, customToCurrencyId]);

  const baseAmount = statement?.statement || null;
  const currencyPositions = statement?.currencyPositions || [];

  const desiredCurrency = useMemo(() => {
    if (!lookups?.currencies?.length || !customToCurrencyId) return null;
    return lookups.currencies.find((c) => String(c.id) === String(customToCurrencyId)) || null;
  }, [lookups, customToCurrencyId]);

  const converted = useMemo(() => {
    if (!baseAmount || !desiredCurrency) return null;
    const rate = customRate;

    return {
      grossProfit: convertByCustomRate({
        amount: baseAmount.grossProfit,
        fromCode: baseCurrencyCode,
        toCode: desiredCurrency.code,
        rate,
        baseCode: baseCurrencyCode,
      }),
      expenses: convertByCustomRate({
        amount: baseAmount.expenses,
        fromCode: baseCurrencyCode,
        toCode: desiredCurrency.code,
        rate,
        baseCode: baseCurrencyCode,
      }),
      loss: convertByCustomRate({
        amount: baseAmount.loss,
        fromCode: baseCurrencyCode,
        toCode: desiredCurrency.code,
        rate,
        baseCode: baseCurrencyCode,
      }),
    };
  }, [baseAmount, baseCurrencyCode, desiredCurrency, customRate]);

  const desiredNetProfit = useMemo(() => {
    if (!converted) return null;
    if (converted.grossProfit == null || converted.expenses == null || converted.loss == null) return null;
    return converted.grossProfit - converted.expenses - converted.loss;
  }, [converted]);

  const positionColumns = useMemo(() => [
    {
      key: 'currency',
      label: t('currency'),
      render: (row) => (
        <div>
          <strong>{row.code}</strong>
          <small style={{ display: 'block', opacity: 0.75 }}>{localizeCurrency(t, row)}</small>
        </div>
      ),
    },
    {
      key: 'cash',
      label: t('cashBalance'),
      render: (row) => `${money(row.cash)} ${row.unit || row.code}`,
    },
    {
      key: 'receivable',
      label: t('receivableAmount'),
      render: (row) => `${money(row.receivable)} ${row.unit || row.code}`,
    },
    {
      key: 'payable',
      label: t('payableAmount'),
      render: (row) => `${money(row.payable)} ${row.unit || row.code}`,
    },
    {
      key: 'netPosition',
      label: t('netPosition'),
      render: (row) => `${money(row.netPosition)} ${row.unit || row.code}`,
    },
    {
      key: 'profit',
      label: t('netProfit'),
      render: (row) => (
        row.profit == null ? '—' : `${money(row.profit)} ${row.unit || row.code}`
      ),
    },
  ], [t, i18n.language]);

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="reports-page">
      <PageHeader
        title={t('profitLoss')}
        subtitle={[subtitle, t('profitLossHint')].filter(Boolean).join(' · ')}
        actions={(
          <div className="no-print page-actions">
            <button type="button" className="btn soft" onClick={handlePrint}>
              <Printer size={17} />
              {t('print')}
            </button>
          </div>
        )}
      />

      <section className="panel report-filters no-print">
        <div className="form-grid inline">
          <Field label={t('dateFrom')}>
            <DateInput
              value={filters.dateFrom}
              onChange={(dateFrom) => setFilters({ ...filters, dateFrom })}
            />
          </Field>
          <Field label={t('dateTo')}>
            <DateInput
              value={filters.dateTo}
              onChange={(dateTo) => setFilters({ ...filters, dateTo })}
            />
          </Field>

          <Field label={t('desiredCurrency')}>
            <select
              value={customToCurrencyId}
              onChange={(e) => setCustomToCurrencyId(e.target.value)}
            >
              <option value="">{t('selectCurrency')}</option>
              {(lookups?.currencies || []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {localizeCurrency(t, c)}
                </option>
              ))}
            </select>
          </Field>

          <Field label={t('customRate')}>
            <input
              type="number"
              min="0"
              step="any"
              value={customRate}
              onChange={(e) => setCustomRate(e.target.value)}
              placeholder="مثال: 0.0001"
              disabled={!desiredCurrency || desiredCurrency.code === baseCurrencyCode}
            />
          </Field>

          <button type="button" className="btn primary align-end" onClick={load}>
            {t('filter')}
          </button>
        </div>
      </section>

      {loading ? <Loading /> : error ? <ErrorBox message={error || t('error')} /> : !baseAmount ? (
        <div className="panel">
          <div className="muted-hint">{t('noData')}</div>
        </div>
      ) : (
        <div className="panel">
          {baseAmount.transactionCount === 0 ? (
            <div className="muted-hint">{t('profitLossNoTransactions')}</div>
          ) : null}
          {!baseAmount.ratesConfigured && baseAmount.transactionCount > 0 ? (
            <div className="muted-hint" style={{ marginBottom: 12 }}>
              {t('profitLossRatesHint')}
            </div>
          ) : null}
          {baseAmount.transactionCount > 0 ? (
            <div className="muted-hint" style={{ marginBottom: 12 }}>
              {t('profitLossTxSummary', {
                count: baseAmount.transactionCount,
                buy: baseAmount.buyCount || 0,
                sell: baseAmount.sellCount || 0,
              })}
            </div>
          ) : null}

          <div className="panel-head">
            <div>
              <h3>{t('baseCurrency')}</h3>
              <small>{baseCurrencyCode}</small>
            </div>
          </div>

          <div className="reports-stats no-print" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
            <div className="dashboard-stat-card tone-cyan">
              <div className="dashboard-stat-copy">
                <span>{t('grossProfit')}</span>
                <strong>{money(baseAmount?.grossProfit)} {baseCurrencyCode}</strong>
                <small>{t('profit')}</small>
              </div>
            </div>
            <div className="dashboard-stat-card tone-rose">
              <div className="dashboard-stat-copy">
                <span>{t('loss')}</span>
                <strong>{money(baseAmount?.loss)} {baseCurrencyCode}</strong>
                <small>{t('totalLoss')}</small>
              </div>
            </div>
            <div className="dashboard-stat-card tone-amber">
              <div className="dashboard-stat-copy">
                <span>{t('expenses')}</span>
                <strong>{money(baseAmount?.expenses)} {baseCurrencyCode}</strong>
                <small>{t('expenses')}</small>
              </div>
            </div>
            <div className="dashboard-stat-card tone-emerald">
              <div className="dashboard-stat-copy">
                <span>{t('netProfit')}</span>
                <strong>{money(baseAmount?.netProfit)} {baseCurrencyCode}</strong>
                <small>{t('profit')}</small>
              </div>
            </div>
          </div>

          {desiredCurrency ? (
            <div style={{ marginTop: 18 }}>
              <div className="panel-head">
                <div>
                  <h3>{t('desiredCurrency')}</h3>
                  <small>{desiredCurrency.code}</small>
                </div>
              </div>
              <div className="reports-stats no-print" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
                <div className="dashboard-stat-card tone-cyan">
                  <div className="dashboard-stat-copy">
                    <span>{t('grossProfit')}</span>
                    <strong>
                      {converted?.grossProfit == null ? '—' : `${money(converted.grossProfit)} ${desiredCurrency.code}`}
                    </strong>
                    <small>{t('profit')}</small>
                  </div>
                </div>
                <div className="dashboard-stat-card tone-rose">
                  <div className="dashboard-stat-copy">
                    <span>{t('loss')}</span>
                    <strong>
                      {converted?.loss == null ? '—' : `${money(converted.loss)} ${desiredCurrency.code}`}
                    </strong>
                    <small>{t('totalLoss')}</small>
                  </div>
                </div>
                <div className="dashboard-stat-card tone-amber">
                  <div className="dashboard-stat-copy">
                    <span>{t('expenses')}</span>
                    <strong>
                      {converted?.expenses == null ? '—' : `${money(converted.expenses)} ${desiredCurrency.code}`}
                    </strong>
                    <small>{t('expenses')}</small>
                  </div>
                </div>
                <div className="dashboard-stat-card tone-emerald">
                  <div className="dashboard-stat-copy">
                    <span>{t('netProfit')}</span>
                    <strong>
                      {desiredNetProfit == null ? '—' : `${money(desiredNetProfit)} ${desiredCurrency.code}`}
                    </strong>
                    <small>{t('profit')}</small>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {currencyPositions.length ? (
            <div style={{ marginTop: 24 }} className="print-table-panel">
              <div className="panel-head">
                <div>
                  <h3>{t('profitLossCurrencyPositions')}</h3>
                  <small>{t('profitLossPositionsHint')}</small>
                </div>
              </div>
              <Table
                columns={positionColumns}
                rows={currencyPositions}
                keyField="code"
              />
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

