import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiData } from '../hooks/useApiData.js';
import { ErrorBox, Loading, PageHeader, Pagination, SearchBox, Table } from '../components/Common.jsx';
import { dateTime } from '../utils/format.js';
import { localizeAuditAction, translatePersonName } from '../utils/labels.js';

export default function AuditPage() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const { data, loading, error, reload } = useApiData(
    `/audit?page=${page}&limit=20&search=${encodeURIComponent(search)}`,
  );

  return (
    <>
      <PageHeader title={t('audit')} />
      <div className="panel">
        <SearchBox
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          onRefresh={reload}
        />
        {loading ? <Loading /> : error ? <ErrorBox message={error} /> : (
          <>
            <Table
              rows={data?.rows || []}
              columns={[
                {
                  key: 'person',
                  label: t('person'),
                  render: (r) => <strong>{translatePersonName(t, r.person)}</strong>,
                },
                {
                  key: 'action',
                  label: t('action'),
                  render: (r) => localizeAuditAction(t, r.action),
                },
                {
                  key: 'ipAddress',
                  label: t('ipAddress'),
                  render: (r) => r.ipAddress || '—',
                },
                {
                  key: 'device',
                  label: t('device'),
                  render: (r) => (
                    <span className="truncate" title={r.device}>{r.device || '—'}</span>
                  ),
                },
                {
                  key: 'createdAt',
                  label: t('date'),
                  render: (r) => dateTime(r.createdAt),
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
