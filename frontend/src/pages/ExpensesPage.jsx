import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api, messageOf } from '../api/client.js';
import {
  ErrorBox,
  Field,
  Loading,
  Modal,
  PageHeader,
  Pagination,
  PrimaryButton,
  SearchBox,
  Table,
} from '../components/Common.jsx';
import DateInput from '../components/DateInput.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useDeleteConfirm } from '../components/ConfirmDelete.jsx';
import { dateOnly, dateTime, money } from '../utils/format.js';
import { localizeCurrency, translatePlace } from '../utils/labels.js';

const EXPENSE_CATEGORIES = [
  'اجاره',
  'برق و آب',
  'معاش کارمندان',
  'اینترنت و مخابرات',
  'حمل و نقل',
  'لوازم اداری',
  'مهمان‌نوازی',
  'تعمیرات',
  'عمومی',
  'سایر',
];

const emptyForm = {
  cashboxId: '',
  currencyId: '',
  amount: '',
  category: 'عمومی',
  description: '',
  note: '',
  entryDate: '',
};

export default function ExpensesPage() {
  const { t } = useTranslation();
  const { show } = useToast();
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [lookups, setLookups] = useState({ currencies: [], cashboxes: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ dateFrom: '', dateTo: '' });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const { askDelete, dialog: deleteDialog } = useDeleteConfirm({
    onDeleted: () => {
      show(t('success'));
      load();
    },
    translateLabel: (row) => row.number || `#${row.id}`,
  });

  const load = async () => {
    setLoading(true);
    try {
      const [listRes, lookupsRes] = await Promise.all([
        api.get('/expenses', {
          params: {
            search,
            page,
            limit: 20,
            dateFrom: filters.dateFrom || undefined,
            dateTo: filters.dateTo || undefined,
          },
        }),
        api.get('/lookups'),
      ]);
      setRows(listRes.data.data.rows || []);
      setPagination(listRes.data.data.pagination);
      setLookups(lookupsRes.data.data);
      setError('');
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(load, 200);
    return () => clearTimeout(timer);
  }, [search, page, filters.dateFrom, filters.dateTo]);

  useEffect(() => {
    const h = () => load();
    window.addEventListener('zarin:expenses:changed', h);
    window.addEventListener('zarin:balances:changed', h);
    return () => {
      window.removeEventListener('zarin:expenses:changed', h);
      window.removeEventListener('zarin:balances:changed', h);
    };
  }, [search, page, filters.dateFrom, filters.dateTo]);

  const openCreate = () => {
    setForm({
      ...emptyForm,
      cashboxId: lookups.cashboxes?.[0] ? String(lookups.cashboxes[0].id) : '',
      currencyId: lookups.currencies?.[0] ? String(lookups.currencies[0].id) : '',
      category: EXPENSE_CATEGORIES[8],
    });
    setOpen(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/expenses', {
        cashboxId: Number(form.cashboxId),
        currencyId: Number(form.currencyId),
        amount: Number(form.amount),
        category: form.category,
        description: form.description,
        note: form.note || null,
        entryDate: form.entryDate || undefined,
      });
      show(t('expenseSavedCashbox'));
      setOpen(false);
      setForm(emptyForm);
      load();
    } catch (err) {
      show(messageOf(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    { key: 'number', label: t('number'), render: (r) => <strong>{r.number}</strong> },
    {
      key: 'category',
      label: t('expenseCategory'),
      render: (r) => r.category || '—',
    },
    {
      key: 'description',
      label: t('description'),
      render: (r) => r.description || '—',
    },
    {
      key: 'amount',
      label: t('amount'),
      render: (r) => `${money(r.amount)} ${r.currency?.code || ''}`.trim(),
    },
    {
      key: 'cashbox',
      label: t('cashbox'),
      render: (r) => translatePlace(t, r.cashbox?.name) || '—',
    },
    {
      key: 'date',
      label: t('date'),
      render: (r) => (r.entryDate ? dateOnly(r.entryDate) : dateTime(r.createdAt)),
    },
    {
      key: 'actions',
      label: t('actions'),
      render: (r) => (
        <button
          type="button"
          className="icon-btn danger"
          title={t('delete')}
          onClick={() => askDelete(r, (row) => api.delete(`/expenses/${row.id}`))}
        >
          <Trash2 size={17} />
        </button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('expenses')}
        subtitle={t('expensesHint')}
        actions={(
          <button type="button" className="btn primary" onClick={openCreate} disabled={!lookups.cashboxes?.length}>
            <Plus size={17} />
            {t('registerExpense')}
          </button>
        )}
      />

      <section className="panel">
        <div className="form-grid inline" style={{ marginBottom: 12 }}>
          <SearchBox value={search} onChange={setSearch} placeholder={t('search')} />
          <Field label={t('dateFrom')}>
            <DateInput
              value={filters.dateFrom}
              onChange={(dateFrom) => { setPage(1); setFilters({ ...filters, dateFrom }); }}
            />
          </Field>
          <Field label={t('dateTo')}>
            <DateInput
              value={filters.dateTo}
              onChange={(dateTo) => { setPage(1); setFilters({ ...filters, dateTo }); }}
            />
          </Field>
        </div>

        {loading ? <Loading /> : error ? <ErrorBox message={error} /> : (
          <>
            <Table rows={rows} columns={columns} />
            <Pagination pagination={pagination} onChange={setPage} />
          </>
        )}
      </section>

      <Modal open={open} onClose={() => setOpen(false)} title={t('registerExpense')}>
        <form onSubmit={submit} className="form-grid">
          <p className="muted-hint" style={{ gridColumn: '1 / -1', margin: 0 }}>
            {t('expenseCashboxHint')}
          </p>
          <Field label={t('expenseCategory')}>
            <select
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              required
            >
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label={t('description')}>
            <input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder={t('expenseDescriptionHint')}
              required
            />
          </Field>
          <Field label={t('amount')}>
            <input
              type="number"
              min="0"
              step="any"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              required
            />
          </Field>
          <Field label={t('currency')}>
            <select
              value={form.currencyId}
              onChange={(e) => setForm({ ...form, currencyId: e.target.value })}
              required
            >
              <option value="">{t('selectCurrency')}</option>
              {(lookups.currencies || []).map((c) => (
                <option key={c.id} value={c.id}>{localizeCurrency(t, c)}</option>
              ))}
            </select>
          </Field>
          <Field label={t('cashbox')}>
            <select
              value={form.cashboxId}
              onChange={(e) => setForm({ ...form, cashboxId: e.target.value })}
              required
            >
              <option value="">{t('selectCashbox')}</option>
              {(lookups.cashboxes || []).map((c) => (
                <option key={c.id} value={c.id}>{translatePlace(t, c.name)}</option>
              ))}
            </select>
          </Field>
          <Field label={t('date')}>
            <DateInput
              value={form.entryDate}
              onChange={(entryDate) => setForm({ ...form, entryDate })}
            />
          </Field>
          <Field label={t('note')}>
            <textarea
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              rows={2}
            />
          </Field>
          <div className="modal-actions">
            <button type="button" className="btn soft" onClick={() => setOpen(false)}>
              {t('cancel')}
            </button>
            <PrimaryButton type="submit" disabled={saving}>
              {saving ? t('loading') : t('save')}
            </PrimaryButton>
          </div>
        </form>
      </Modal>

      {deleteDialog}
    </>
  );
}
