import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeftRight,
  Download,
  HandCoins,
  Pencil,
  Printer,
  ReceiptText,
  ShoppingCart,
  Trash2,
  UserRound,
  Users,
  WalletCards,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useCompany } from '../context/CompanyContext.jsx';
import { api, messageOf } from '../api/client.js';
import { ErrorBox, Field, Loading, Modal, PageHeader, Table } from '../components/Common.jsx';
import DateInput from '../components/DateInput.jsx';
import { useDeleteConfirm } from '../components/ConfirmDelete.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { dateOnly, dateTime, downloadCsv, money, number } from '../utils/format.js';
import {
  localizeCurrency,
  localizeValue,
  translateKind,
  translatePersonName,
  translateState,
} from '../utils/labels.js';

function tradeKindKey(kind) {
  const value = String(kind || '');
  if (value === 'buy' || value.includes('خرید')) return 'buy';
  if (value === 'sell' || value.includes('فروش')) return 'sell';
  if (value === 'exchange' || value.includes('تبدیل')) return 'exchange';
  return '';
}

function canManageTrade(row) {
  const key = tradeKindKey(row?.kind);
  return (key === 'buy' || key === 'sell') && row?.state !== 'برگشت داده شد';
}

const emptyEditForm = {
  kind: 'buy',
  customerId: '',
  branchId: '',
  cashboxId: '',
  fromCurrencyId: '',
  toCurrencyId: '',
  fromAmount: '',
  toAmount: '',
  rate: '',
  fee: '0',
  note: '',
};

export default function ReportsPage() {
  const { t, i18n } = useTranslation();
  const { displayName } = useCompany();
  const { show } = useToast();
  const { isBranchScoped, branchName, hasPermission } = useAuth();
  const [filters, setFilters] = useState({ dateFrom: '', dateTo: '' });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('transactions');
  const [lookups, setLookups] = useState(null);
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState(emptyEditForm);
  const [editError, setEditError] = useState('');
  const [saving, setSaving] = useState(false);

  const canEditTrades = hasPermission('reports');

  const { askDelete, dialog: deleteDialog } = useDeleteConfirm({
    onDeleted: () => {
      show(t('success'));
      load();
    },
    translateLabel: (row) => `${translateKind(t, row.kind)} ${row.number || `#${row.id}`}`,
  });

  const load = async () => {
    setLoading(true);
    try {
      const response = await api.get('/reports', { params: filters });
      setData(response.data.data);
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

  useEffect(() => {
    if (!canEditTrades) return undefined;
    api.get('/lookups')
      .then(({ data: res }) => setLookups(res.data))
      .catch(() => {});
    return undefined;
  }, [canEditTrades]);

  const transactions = data?.transactions || [];
  const summary = data?.summary || {};

  const baseUnit = summary.unit || data?.baseCurrency?.code || 'AFN';

  const cards = useMemo(() => [
    {
      label: t('totalTransactions'),
      value: number(summary.transactions ?? 0),
      hint: t('transactions'),
      icon: ReceiptText,
      tone: 'emerald',
      tab: 'transactions',
    },
    {
      label: t('totalCustomers'),
      value: number(summary.customers ?? 0),
      hint: t('customers'),
      icon: Users,
      tone: 'blue',
      tab: 'buyers',
    },
    {
      label: t('totalProfit'),
      value: `${money(summary.totalProfit)} ${baseUnit}`,
      hint: t('profit'),
      icon: WalletCards,
      tone: 'cyan',
      tab: 'transactions',
    },
    {
      label: t('totalLoss'),
      value: `${money(summary.totalLoss)} ${baseUnit}`,
      hint: t('totalLoss'),
      icon: HandCoins,
      tone: 'rose',
      tab: 'transactions',
    },
    {
      label: t('buyers'),
      value: number(summary.buy ?? 0),
      hint: t('buy'),
      icon: ShoppingCart,
      tone: 'blue',
      tab: 'buyers',
    },
    {
      label: t('sellers'),
      value: number(summary.sell ?? 0),
      hint: t('sell'),
      icon: HandCoins,
      tone: 'amber',
      tab: 'sellers',
    },
    {
      label: t('exchangers'),
      value: number(summary.exchange ?? 0),
      hint: t('exchange'),
      icon: ArrowLeftRight,
      tone: 'purple',
      tab: 'exchangers',
    },
    {
      label: t('debtors'),
      value: number(summary.debtors ?? 0),
      hint: t('debtor'),
      icon: UserRound,
      tone: 'rose',
      tab: 'debtors',
    },
    {
      label: t('creditors'),
      value: number(summary.creditors ?? 0),
      hint: t('creditor'),
      icon: Users,
      tone: 'slate',
      tab: 'creditors',
    },
  ], [summary, baseUnit, t, i18n.language]);

  const periodLabel = [
    filters.dateFrom ? dateOnly(filters.dateFrom) : t('all'),
    filters.dateTo ? dateOnly(filters.dateTo) : t('all'),
  ].join(' — ');

  const handlePrint = () => {
    let style = document.getElementById('reports-print-page');
    if (!style) {
      style = document.createElement('style');
      style.id = 'reports-print-page';
      document.head.appendChild(style);
    }
    style.textContent = '@media print { @page { size: A4 landscape; margin: 8mm; } }';
    window.print();
  };

  const exportData = () => {
    downloadCsv('pplus-arz-report.csv', transactions.map((r) => ({
      number: r.number,
      kind: translateKind(t, r.kind),
      customer: r.customer?.name
        ? `${translatePersonName(t, r.customer.name)}${r.customer.id ? ` (#${r.customer.id})` : ''}`
        : '',
      received: `${r.fromAmount} ${r.fromCurrency?.code || ''}`,
      paid: `${r.toAmount} ${r.toCurrency?.code || ''}`,
      fee: r.fee,
      state: translateState(t, r.state),
      date: dateTime(r.createdAt),
    })));
  };

  const openEdit = (row) => {
    if (!canManageTrade(row)) return;
    setEditing(row);
    setEditError('');
    setEditForm({
      kind: tradeKindKey(row.kind) || 'buy',
      customerId: row.customerId ? String(row.customerId) : '',
      branchId: row.branchId ? String(row.branchId) : '',
      cashboxId: row.cashboxId ? String(row.cashboxId) : '',
      fromCurrencyId: row.fromCurrencyId ? String(row.fromCurrencyId) : '',
      toCurrencyId: row.toCurrencyId ? String(row.toCurrencyId) : '',
      fromAmount: String(row.fromAmount ?? ''),
      toAmount: String(row.toAmount ?? ''),
      rate: String(row.rate ?? ''),
      fee: String(row.fee ?? '0'),
      note: row.note || '',
    });
  };

  const closeEdit = () => {
    if (saving) return;
    setEditing(null);
    setEditError('');
    setEditForm(emptyEditForm);
  };

  const setEdit = (key, value) => setEditForm((prev) => ({ ...prev, [key]: value }));

  const branchCashboxes = useMemo(() => {
    if (!lookups?.cashboxes) return [];
    return lookups.cashboxes.filter((c) => String(c.branchId) === String(editForm.branchId));
  }, [lookups, editForm.branchId]);

  const saveEdit = async (e) => {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    setEditError('');
    try {
      await api.put(`/transactions/${editing.id}`, {
        kind: editForm.kind,
        customerId: editForm.customerId ? Number(editForm.customerId) : null,
        branchId: Number(editForm.branchId),
        cashboxId: Number(editForm.cashboxId),
        fromCurrencyId: Number(editForm.fromCurrencyId),
        toCurrencyId: Number(editForm.toCurrencyId),
        fromAmount: Number(editForm.fromAmount),
        toAmount: editForm.toAmount ? Number(editForm.toAmount) : undefined,
        rate: editForm.rate ? Number(editForm.rate) : undefined,
        fee: Number(editForm.fee || 0),
        note: editForm.note || null,
      });
      show(t('success'));
      setEditing(null);
      setEditForm(emptyEditForm);
      setEditError('');
      await load();
    } catch (err) {
      setEditError(messageOf(err));
    } finally {
      setSaving(false);
    }
  };

  const balanceColumns = [
    {
      key: 'customer',
      label: t('customer'),
      render: (r) => (
        <div>
          <strong>{translatePersonName(t, r.customer?.name)}</strong>
          <small>
            {r.customer?.id ? `#${r.customer.id}` : ''}
            {r.customer?.phone ? `${r.customer?.id ? ' · ' : ''}${r.customer.phone}` : ''}
          </small>
        </div>
      ),
    },
    { key: 'currency', label: t('currency'), render: (r) => r.currency?.code },
    { key: 'received', label: t('received'), render: (r) => money(r.received) },
    { key: 'paid', label: t('paid'), render: (r) => money(r.paid) },
    {
      key: 'balance',
      label: t('currentBalance'),
      render: (r) => (
        <strong className={r.balance > 0 ? 'positive' : 'negative'}>{money(r.balance)}</strong>
      ),
    },
  ];

  const transactionColumns = [
    { key: 'number', label: t('number'), render: (r) => <strong>{r.number}</strong> },
    {
      key: 'kind',
      label: t('transactionType'),
      render: (r) => <span className="badge info">{translateKind(t, r.kind)}</span>,
    },
    {
      key: 'customer',
      label: t('customer'),
      render: (r) => (r.customer ? (
        <div>
          <strong>{translatePersonName(t, r.customer.name)}</strong>
          <small>#{r.customer.id}</small>
        </div>
      ) : '—'),
    },
    {
      key: 'received',
      label: t('received'),
      render: (r) => `${money(r.fromAmount)} ${r.fromCurrency?.code || ''}`,
    },
    {
      key: 'paid',
      label: t('paid'),
      render: (r) => `${money(r.toAmount)} ${r.toCurrency?.code || ''}`,
    },
    { key: 'fee', label: t('fee'), render: (r) => money(r.fee) },
    {
      key: 'status',
      label: t('status'),
      render: (r) => (
        <span className={`badge ${r.state === 'برگشت داده شد' ? 'danger' : 'success'}`}>
          {translateState(t, r.state)}
        </span>
      ),
    },
    { key: 'date', label: t('date'), render: (r) => dateTime(r.createdAt) },
    {
      key: 'actions',
      label: t('actions'),
      className: 'no-print',
      render: (r) => (
        <div className="row-actions">
          <Link className="icon-btn" to={`/transactions/${r.id}/receipt`} title={t('print')}>
            <ReceiptText size={17} />
          </Link>
          {canEditTrades && canManageTrade(r) ? (
            <>
              <button type="button" className="icon-btn" title={t('edit')} onClick={() => openEdit(r)}>
                <Pencil size={17} />
              </button>
              <button
                type="button"
                className="icon-btn danger"
                title={t('delete')}
                onClick={() => askDelete(r, (row) => api.delete(`/transactions/${row.id}`))}
              >
                <Trash2 size={17} />
              </button>
            </>
          ) : null}
        </div>
      ),
    },
  ];

  const tableRows = ['debtors', 'creditors'].includes(tab)
    ? (data?.[tab] || [])
    : tab === 'transactions'
      ? transactions
      : (data?.[tab] || []);

  const scope = data?.scope;
  const scopedBranchLabel = scope?.branchName || branchName;
  const subtitle = [
    periodLabel,
    (isBranchScoped || scope?.scoped) && scopedBranchLabel
      ? `${t('branchScopeHint')}: ${localizeValue(t, scopedBranchLabel)}`
      : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="reports-page">
      <PageHeader
        title={t('reports')}
        subtitle={subtitle}
        actions={(
          <div className="no-print page-actions">
            <button type="button" className="btn soft" onClick={handlePrint}>
              <Printer size={17} />
              {t('print')}
            </button>
            <button type="button" className="btn soft" onClick={exportData}>
              <Download size={17} />
              {t('exportCsv')}
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
          <button type="button" className="btn primary align-end" onClick={load}>
            {t('filter')}
          </button>
        </div>
      </section>

      <div className="print-only reports-print-banner">
        <h2>{displayName} — {t('reports')}</h2>
        <p>{periodLabel}</p>
        <small>{dateTime(new Date())}</small>
      </div>

      {loading ? <Loading /> : error ? <ErrorBox message={error} /> : (
        <>
          <section className="dashboard-stats reports-stats no-print">
            {cards.map(({ label, value, hint, icon: Icon, tone, tab: cardTab }) => (
              <button
                type="button"
                key={label}
                className={`dashboard-stat-card tone-${tone}`}
                onClick={() => setTab(cardTab)}
              >
                <div className="dashboard-stat-icon"><Icon size={22} /></div>
                <div className="dashboard-stat-copy">
                  <span>{label}</span>
                  <strong>{value}</strong>
                  <small>{hint}</small>
                </div>
              </button>
            ))}
          </section>

          <div className="tabs no-print">
            {['transactions', 'buyers', 'sellers', 'exchangers', 'debtors', 'creditors'].map((key) => (
              <button
                type="button"
                key={key}
                className={tab === key ? 'active' : ''}
                onClick={() => setTab(key)}
              >
                {t(key)}
              </button>
            ))}
          </div>

          <div className="panel reports-table-panel print-table-panel">
            <div className="panel-head">
              <div>
                <h3>{t(tab)}</h3>
                <span className="no-print">{number(tableRows.length)}</span>
                <span className="print-only reports-print-count">{number(tableRows.length)}</span>
              </div>
            </div>
            {['debtors', 'creditors'].includes(tab) ? (
              <Table rows={tableRows} columns={balanceColumns} />
            ) : (
              <Table rows={tableRows} columns={transactionColumns} />
            )}
          </div>
        </>
      )}

      <Modal
        open={Boolean(editing)}
        onClose={closeEdit}
        title={`${t('edit')} — ${editing?.number || ''}`}
        wide
      >
        <form className="form-grid" onSubmit={saveEdit}>
          {editError ? <div className="alert error full">{editError}</div> : null}
          <Field label={t('transactionType')}>
            <input value={translateKind(t, editing?.kind)} disabled readOnly />
          </Field>
          <Field label={t('customer')}>
            <select value={editForm.customerId} onChange={(e) => setEdit('customerId', e.target.value)}>
              <option value="">—</option>
              {(lookups?.customers || []).map((c) => (
                <option key={c.id} value={c.id}>{translatePersonName(t, c.name)} #{c.id}</option>
              ))}
            </select>
          </Field>
          <Field label={t('branch')}>
            <select
              required
              value={editForm.branchId}
              onChange={(e) => {
                const branchId = e.target.value;
                const boxes = (lookups?.cashboxes || []).filter((c) => String(c.branchId) === branchId);
                setEditForm((prev) => ({
                  ...prev,
                  branchId,
                  cashboxId: boxes.some((c) => String(c.id) === String(prev.cashboxId))
                    ? prev.cashboxId
                    : (boxes[0] ? String(boxes[0].id) : ''),
                }));
              }}
            >
              <option value="">{t('selectBranch')}</option>
              {(lookups?.branches || []).map((b) => (
                <option key={b.id} value={b.id}>{localizeValue(t, b.name)}</option>
              ))}
            </select>
          </Field>
          <Field label={t('cashbox')}>
            <select
              required
              value={editForm.cashboxId}
              onChange={(e) => setEdit('cashboxId', e.target.value)}
            >
              <option value="">{t('selectCashbox')}</option>
              {branchCashboxes.map((c) => (
                <option key={c.id} value={c.id}>{localizeValue(t, c.name)}</option>
              ))}
            </select>
          </Field>
          <Field label={t('fromCurrency')}>
            <select
              required
              value={editForm.fromCurrencyId}
              onChange={(e) => setEdit('fromCurrencyId', e.target.value)}
            >
              <option value="">{t('selectCurrency')}</option>
              {(lookups?.currencies || []).map((c) => (
                <option key={c.id} value={c.id}>{c.code} — {localizeCurrency(t, c)}</option>
              ))}
            </select>
          </Field>
          <Field label={t('toCurrency')}>
            <select
              required
              value={editForm.toCurrencyId}
              onChange={(e) => setEdit('toCurrencyId', e.target.value)}
            >
              <option value="">{t('selectCurrency')}</option>
              {(lookups?.currencies || []).map((c) => (
                <option key={c.id} value={c.id}>{c.code} — {localizeCurrency(t, c)}</option>
              ))}
            </select>
          </Field>
          <Field label={t('fromAmount')}>
            <input
              required
              type="number"
              min="0.000001"
              step="any"
              value={editForm.fromAmount}
              onChange={(e) => setEdit('fromAmount', e.target.value)}
            />
          </Field>
          <Field label={t('toAmount')}>
            <input
              type="number"
              min="0.000001"
              step="any"
              value={editForm.toAmount}
              onChange={(e) => setEdit('toAmount', e.target.value)}
            />
          </Field>
          <Field label={t('rate')}>
            <input
              type="number"
              min="0"
              step="any"
              value={editForm.rate}
              onChange={(e) => setEdit('rate', e.target.value)}
            />
          </Field>
          <Field label={t('fee')}>
            <input
              type="number"
              min="0"
              step="any"
              value={editForm.fee}
              onChange={(e) => setEdit('fee', e.target.value)}
            />
          </Field>
          <Field label={t('note')} className="full">
            <textarea
              rows={3}
              value={editForm.note}
              onChange={(e) => setEdit('note', e.target.value)}
            />
          </Field>
          <div className="form-actions full">
            <button type="button" className="btn soft" onClick={closeEdit} disabled={saving}>
              {t('cancel')}
            </button>
            <button type="submit" className="btn primary" disabled={saving}>
              {saving ? t('loading') : t('update')}
            </button>
          </div>
        </form>
      </Modal>

      {deleteDialog}
    </div>
  );
}
