import { useEffect, useMemo, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api, messageOf } from '../api/client.js';
import { ErrorBox, Field, Loading, Modal, PageHeader, PrimaryButton, SearchBox, StatusBadge, Table } from '../components/Common.jsx';
import { useDeleteConfirm } from '../components/ConfirmDelete.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useCompany } from '../context/CompanyContext.jsx';
import { localizeValue } from '../utils/labels.js';

const initial = { name: '', city: '', address: '', isActive: true };

export default function BranchesPage() {
  const { t } = useTranslation();
  const { show } = useToast();
  const { isSuperAdmin } = useAuth();
  const { maxBranches } = useCompany();
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(initial);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/branches', { skipBranchFilter: true });
      setRows(data.data);
      setError('');
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const { askDelete, dialog: deleteDialog } = useDeleteConfirm({
    onDeleted: () => {
      show(t('success'));
      load();
    },
    translateLabel: (row) => localizeValue(t, row.name),
  });

  const edit = (r) => {
    setEditing(r);
    setForm({
      name: r.name,
      city: r.city,
      address: r.address || '',
      isActive: Boolean(r.isActive),
    });
    setOpen(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    try {
      if (editing) await api.put(`/branches/${editing.id}`, form);
      else await api.post('/branches', form);
      show(t('success'));
      setOpen(false);
      load();
    } catch (err) {
      show(messageOf(err), 'error');
    }
  };

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const hay = [r.name, r.city, r.address].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [rows, search]);

  return (
    <>
      <PageHeader
        title={t('branches')}
        actions={isSuperAdmin && rows.length < maxBranches ? (
          <PrimaryButton
            onClick={() => {
              setEditing(null);
              setForm(initial);
              setOpen(true);
            }}
          >
            {t('add')}
          </PrimaryButton>
        ) : null}
      />
      <div className="panel">
        <SearchBox value={search} onChange={setSearch} onRefresh={load} />
        {loading ? <Loading /> : error ? <ErrorBox message={error} /> : (
          <Table
            rows={filteredRows}
            columns={[
              { key: 'name', label: t('name'), render: (r) => localizeValue(t, r.name) },
              { key: 'city', label: t('city'), render: (r) => localizeValue(t, r.city) },
              {
                key: 'address',
                label: t('address'),
                render: (r) => (r.address ? localizeValue(t, r.address) : '—'),
              },
              { key: 'cashboxes', label: t('cashboxes'), render: (r) => r.cashboxes?.length || 0 },
              {
                key: 'status',
                label: t('status'),
                render: (r) => (
                  <StatusBadge active={r.isActive}>
                    {r.isActive ? t('active') : t('inactive')}
                  </StatusBadge>
                ),
              },
              {
                key: 'actions',
                label: t('actions'),
                render: (r) => (
                  <div className="row-actions">
                    <button type="button" className="icon-btn" onClick={() => edit(r)}>
                      <Pencil size={17} />
                    </button>
                    {isSuperAdmin ? (
                      <button
                        type="button"
                        className="icon-btn danger"
                        onClick={() => askDelete(r, (row) => api.delete(`/branches/${row.id}`))}
                      >
                        <Trash2 size={17} />
                      </button>
                    ) : null}
                  </div>
                ),
              },
            ]}
          />
        )}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? t('edit') : t('add')}>
        <form className="form-grid" onSubmit={submit}>
          <Field label={t('name')}>
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label={t('city')}>
            <input required value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          </Field>
          <Field label={t('address')} className="full">
            <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </Field>
          <Field label={t('status')} className="full">
            <label className="toggle">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              />
              <span />
              {form.isActive ? t('active') : t('inactive')}
            </label>
          </Field>
          <div className="form-actions full">
            <button type="button" className="btn soft" onClick={() => setOpen(false)}>{t('cancel')}</button>
            <button className="btn primary" type="submit">{t('save')}</button>
          </div>
        </form>
      </Modal>
      {deleteDialog}
    </>
  );
}
