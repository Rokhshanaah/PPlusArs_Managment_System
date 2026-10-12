import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Banknote,
  CircleDollarSign,
  Coins,
  Landmark,
  Wallet,
  WalletCards,
} from 'lucide-react';
import { useApiData } from '../hooks/useApiData.js';
import { ErrorBox, Field, Loading, PageHeader, SearchBox, Table } from '../components/Common.jsx';
import DateInput from '../components/DateInput.jsx';
import { dateOnly, money } from '../utils/format.js';
import { localizeCountry, localizeCurrency, localizeNote, translatePlace } from '../utils/labels.js';

const currencyTones = ['emerald', 'blue', 'amber', 'cyan', 'purple', 'slate', 'rose'];
const currencyIcons = [Banknote, CircleDollarSign, Coins, Wallet, WalletCards, Coins, Banknote];

export default function BalancePage() {
  const { t } = useTranslation();
  const [filters, setFilters] = useState({ dateFrom: '', dateTo: '' });
  const [search, setSearch] = useState('');

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
    if (filters.dateTo) params.set('dateTo', filters.dateTo);
    const q = params.toString();
    return q ? `?${q}` : '';
  }, [filters.dateFrom, filters.dateTo]);

  const { data, loading, error, reload } = useApiData(`/balances${query}`, {
    event: 'zarin:balances:changed',
  });

  const currencies = data?.currencies || (Array.isArray(data) ? data : []);
  const period = data?.period;

  const filteredCurrencies = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return currencies;
    return currencies
      .map((group) => {
        const currencyHay = [
          group.currency?.code,
          group.currency?.symbol,
          localizeCurrency(t, group.currency),
          group.currency?.country,
        ].filter(Boolean).join(' ').toLowerCase();
        const groupMatch = currencyHay.includes(q);
        const cashboxes = (group.cashboxes || []).filter((row) => {
          const hay = [
            row.cashbox?.name,
            row.cashbox?.branch?.name,
          ].filter(Boolean).join(' ').toLowerCase();
          return hay.includes(q);
        });
        if (groupMatch) return group;
        if (cashboxes.length) return { ...group, cashboxes };
        return null;
      })
      .filter(Boolean);
  }, [currencies, search, t]);

  return (
    <>
      <PageHeader
        title={t('balance')}
        actions={(
          <button type="button" className="btn soft" onClick={reload}>
            {t('refresh')}
          </button>
        )}
      />

      <div className="panel" style={{ marginBottom: 16 }}>
        <SearchBox value={search} onChange={setSearch} onRefresh={reload} />
        <div className="form-grid inline report-filters">
          <Field label={t('dateFrom')}>
            <DateInput
              value={filters.dateFrom}
              onChange={(dateFrom) => setFilters((f) => ({ ...f, dateFrom }))}
            />
          </Field>
          <Field label={t('dateTo')}>
            <DateInput
              value={filters.dateTo}
              onChange={(dateTo) => setFilters((f) => ({ ...f, dateTo }))}
            />
          </Field>
          <div className="form-actions" style={{ alignItems: 'end' }}>
            <button type="button" className="btn soft" onClick={reload}>{t('filter')}</button>
          </div>
        </div>
      </div>

      {loading ? <Loading /> : error ? <ErrorBox message={error} /> : (
        <>
          {filteredCurrencies.length ? (
            <div className="balance-page-grid">
              {filteredCurrencies.map((group, index) => {
                const tone = currencyTones[index % currencyTones.length];
                const Icon = currencyIcons[index % currencyIcons.length];
                const cashboxes = group.cashboxes || [];
                const symbol = group.currency?.symbol || group.currency?.code || '';

                return (
                  <article
                    className={`balance-card tone-${tone}`}
                    key={group.currency?.id || group.currency?.code || index}
                  >
                    <header className="balance-card-head">
                      <div className="balance-card-icon">
                        <Icon size={22} />
                      </div>
                      <div className="balance-card-title">
                        <div className="balance-card-code-row">
                          <h3>{group.currency?.code || '—'}</h3>
                          {group.currency?.symbol ? (
                            <span className="balance-card-symbol">{group.currency.symbol}</span>
                          ) : null}
                        </div>
                        <span>
                          {localizeCurrency(t, group.currency)}
                          {group.currency?.country
                            ? ` · ${localizeCountry(t, group.currency.country)}`
                            : ''}
                        </span>
                      </div>
                    </header>

                    <div className="balance-card-total">
                      <small>{t('total')}</small>
                      <strong>
                        {money(group.total)}
                        {symbol ? ` ${symbol}` : ''}
                      </strong>
                    </div>

                    <div className="balance-card-meta">
                      <Landmark size={14} />
                      <span>
                        {cashboxes.length} {t('cashboxes')}
                      </span>
                    </div>

                    <ul className="balance-cashbox-list">
                      {cashboxes.map((row) => (
                        <li key={row.id || `${row.cashboxId}-${row.currencyId}`}>
                          <div>
                            <b>{translatePlace(t, row.cashbox?.name)}</b>
                            <span>{translatePlace(t, row.cashbox?.branch?.name)}</span>
                          </div>
                          <strong>
                            {money(row.amount)}
                            {' '}
                            {row.currency?.symbol || symbol}
                          </strong>
                        </li>
                      ))}
                    </ul>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="panel">
              <p className="muted-hint" style={{ margin: 0, textAlign: 'center', padding: 24 }}>
                —
              </p>
            </div>
          )}

          {period ? (
            <div className="panel" style={{ marginTop: 16 }}>
              <h3 style={{ marginBottom: 12 }}>
                {t('periodTurnover')}
                {' · '}
                {period.dateFrom ? dateOnly(period.dateFrom) : t('all')}
                {' — '}
                {period.dateTo ? dateOnly(period.dateTo) : t('all')}
              </h3>
              <Table
                rows={period.movements || []}
                columns={[
                  {
                    key: 'currency',
                    label: t('currency'),
                    render: (r) => localizeCurrency(t, r.currency),
                  },
                  {
                    key: 'total',
                    label: t('amount'),
                    render: (r) => money(r.total),
                  },
                  {
                    key: 'count',
                    label: t('number'),
                    render: (r) => r.count,
                  },
                ]}
              />
              {(period.entries || []).length ? (
                <Table
                  rows={period.entries}
                  columns={[
                    { key: 'date', label: t('date'), render: (r) => dateOnly(r.entryDate) },
                    { key: 'number', label: t('number'), render: (r) => r.number },
                    {
                      key: 'description',
                      label: t('note'),
                      render: (r) => localizeNote(t, r.description),
                    },
                    {
                      key: 'amount',
                      label: t('amount'),
                      render: (r) => `${money(r.amount)} ${r.currency?.code || ''}`.trim(),
                    },
                  ]}
                />
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </>
  );
}
