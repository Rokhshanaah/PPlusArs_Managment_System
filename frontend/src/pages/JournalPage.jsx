import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiData } from '../hooks/useApiData.js';
import { ErrorBox, Field, Loading, PageHeader, Pagination, SearchBox, Table } from '../components/Common.jsx';
import DateInput from '../components/DateInput.jsx';
import { dateOnly, money } from '../utils/format.js';
import { localizeNote, translatePlace } from '../utils/labels.js';

export default function JournalPage() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ dateFrom: '', dateTo: '' });

  const query = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), limit: '20' });
    if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
    if (filters.dateTo) params.set('dateTo', filters.dateTo);
    if (search.trim()) params.set('search', search.trim());
    return params.toString();
  }, [page, filters.dateFrom, filters.dateTo, search]);

  const { data, loading, error, reload } = useApiData(`/journal?${query}`, {
    event: 'zarin:transactions:changed',
  });

  return (
    <>
      <PageHeader
        title={t('journal')}
        actions={(
          <button type="button" className="btn soft" onClick={reload}>
            {t('refresh')}
          </button>
        )}
      />
      <div className="panel">
        <SearchBox
          value={search}
          onChange={(v) => {
            setPage(1);
            setSearch(v);
          }}
          onRefresh={reload}
        />
        <div className="form-grid inline report-filters" style={{ marginBottom: 12 }}>
          <Field label={t('dateFrom')}>
            <DateInput
              value={filters.dateFrom}
              onChange={(dateFrom) => {
                setPage(1);
                setFilters((f) => ({ ...f, dateFrom }));
              }}
            />
          </Field>
          <Field label={t('dateTo')}>
            <DateInput
              value={filters.dateTo}
              onChange={(dateTo) => {
                setPage(1);
                setFilters((f) => ({ ...f, dateTo }));
              }}
            />
          </Field>
        </div>
        {loading ? <Loading /> : error ? <ErrorBox message={error} /> : (
          <>
            <Table
              rows={data?.rows || []}
              columns={[
                { key: 'number', label: t('number'), render: (r) => <strong>{r.number}</strong> },
                { key: 'date', label: t('date'), render: (r) => dateOnly(r.entryDate) },
                {
                  key: 'description',
                  label: t('note'),
                  render: (r) => localizeNote(t, r.description),
                },
                { key: 'debitAccount', label: t('received'), render: (r) => localizeNote(t, r.debitAccount) },
                { key: 'creditAccount', label: t('paid'), render: (r) => localizeNote(t, r.creditAccount) },
                {
                  key: 'amount',
                  label: t('amount'),
                  render: (r) => `${money(r.amount)} ${r.currency?.code || ''}`.trim(),
                },
                {
                  key: 'branch',
                  label: t('branch'),
                  render: (r) => translatePlace(t, r.branch?.name),
                },
              ]}
            />
            <Pagination pagination={data?.pagination} onPage={setPage} />
          </>
        )}
      </div>
    </>
  );
}
