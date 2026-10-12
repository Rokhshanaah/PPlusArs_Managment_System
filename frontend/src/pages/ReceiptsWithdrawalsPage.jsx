import { useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
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
import SearchableSelect from '../components/SearchableSelect.jsx';
import UserAvatar from '../components/UserAvatar.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useDeleteConfirm } from '../components/ConfirmDelete.jsx';
import { dateTime, money } from '../utils/format.js';
import { localizeCurrency, translatePersonName, translatePlace } from '../utils/labels.js';

const emptyReceipt = {
  id: null,
  customerMode: 'account',
  customerId: '',
  customerName: '',
  phone: '',
  fatherName: '',
  address: '',
  documentNumber: '',
  cashboxId: '',
  currencyId: '',
  amount: '',
  note: '',
};

const emptyWithdrawal = {
  id: null,
  customerMode: 'account',
  customerId: '',
  customerName: '',
  phone: '',
  fatherName: '',
  address: '',
  documentNumber: '',
  cashboxId: '',
  currencyId: '',
  amount: '',
  note: '',
};

export default function ReceiptsWithdrawalsPage() {
  const { t } = useTranslation();
  const { show } = useToast();
  const [rows, setRows] = useState([]);
  const [groups, setGroups] = useState({ receipts: [], withdrawals: [], cardReader: [] });
  const [totals, setTotals] = useState({
    baseCurrency: null,
    receiptsBase: 0,
    withdrawalsBase: 0,
    cardReaderBase: 0,
    netBase: 0,
    receiptsByCurrency: [],
    withdrawalsByCurrency: [],
    cardReaderByCurrency: [],
  });
  const [pagination, setPagination] = useState(null);
  const [lookups, setLookups] = useState({ customers: [], currencies: [], cashboxes: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ dateFrom: '', dateTo: '' });
  const [kind, setKind] = useState('all'); // all | receipt | withdrawal | card_reader
  const [modal, setModal] = useState(null);
  const [receiptForm, setReceiptForm] = useState(emptyReceipt);
  const [withdrawalForm, setWithdrawalForm] = useState(emptyWithdrawal);
  const [saving, setSaving] = useState(false);
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState('');

  const { askDelete, dialog: deleteDialog } = useDeleteConfirm({
    onDeleted: () => {
      show(t('success'));
      load();
    },
    translateLabel: (row) => (
      translatePersonName(t, row.customer?.name || row.customerName) || `#${row.id}`
    ),
  });

  const receiptCustomer = useMemo(
    () => lookups.customers?.find((c) => String(c.id) === String(receiptForm.customerId)),
    [lookups.customers, receiptForm.customerId],
  );
  const withdrawalCustomer = useMemo(
    () => lookups.customers?.find((c) => String(c.id) === String(withdrawalForm.customerId)),
    [lookups.customers, withdrawalForm.customerId],
  );

  const clearAvatarPick = () => {
    if (avatarPreview && avatarPreview.startsWith('blob:')) {
      URL.revokeObjectURL(avatarPreview);
    }
    setAvatarFile(null);
    setAvatarPreview('');
  };

  const load = async () => {
    setLoading(true);
    try {
      const [listRes, lookupsRes] = await Promise.all([
        api.get('/receipts-withdrawals', {
          params: {
            search,
            page,
            limit: 20,
            kind: kind === 'all' ? 'all' : kind,
            dateFrom: filters.dateFrom || undefined,
            dateTo: filters.dateTo || undefined,
          },
        }),
        api.get('/lookups'),
      ]);
      setRows(listRes.data.data.rows || []);
      setGroups(listRes.data.data.groups || {
        receipts: [],
        withdrawals: [],
        cardReader: [],
      });
      setPagination(listRes.data.data.pagination);
      setTotals(listRes.data.data.totals || {
        baseCurrency: null,
        receiptsBase: 0,
        withdrawalsBase: 0,
        cardReaderBase: 0,
        netBase: 0,
        receiptsByCurrency: [],
        withdrawalsByCurrency: [],
        cardReaderByCurrency: [],
      });
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
  }, [search, page, filters.dateFrom, filters.dateTo, kind]);

  useEffect(() => {
    const h = () => load();
    window.addEventListener('zarin:accounts:changed', h);
    window.addEventListener('zarin:balances:changed', h);
    window.addEventListener('zarin:card-reader:changed', h);
    return () => {
      window.removeEventListener('zarin:accounts:changed', h);
      window.removeEventListener('zarin:balances:changed', h);
      window.removeEventListener('zarin:card-reader:changed', h);
    };
  }, [search, page, filters, kind]);

  useEffect(() => () => {
    if (avatarPreview && avatarPreview.startsWith('blob:')) {
      URL.revokeObjectURL(avatarPreview);
    }
  }, [avatarPreview]);

  const uploadCustomerAvatar = async (customerId) => {
    if (!avatarFile || !customerId) return;
    const body = new FormData();
    body.append('avatar', avatarFile);
    await api.post(`/customers/${customerId}/avatar`, body);
  };

  const openReceipt = () => {
    clearAvatarPick();
    setReceiptForm({
      ...emptyReceipt,
      currencyId: lookups.currencies?.[0] ? String(lookups.currencies[0].id) : '',
      cashboxId: lookups.cashboxes?.[0] ? String(lookups.cashboxes[0].id) : '',
    });
    setModal('receipt');
  };

  const openWithdrawal = () => {
    clearAvatarPick();
    setWithdrawalForm({
      ...emptyWithdrawal,
      currencyId: lookups.currencies?.[0] ? String(lookups.currencies[0].id) : '',
      cashboxId: lookups.cashboxes?.[0] ? String(lookups.cashboxes[0].id) : '',
    });
    setModal('withdrawal');
  };

  const customerOptions = useMemo(
    () => {
      const customers = lookups.customers || [];
      const manual = customers.filter((c) => String(c.source || 'manual') !== 'card_reader');
      const cardReader = customers.filter((c) => String(c.source || '') === 'card_reader');
      const toOption = (c, groupLabel) => ({
        value: String(c.id),
        group: groupLabel,
        label: `#${c.id} — ${c.name}${c.phone ? ` — ${c.phone}` : ''}`,
        searchText: `${c.id} ${c.name} ${c.phone || ''} ${c.documentNumber || ''} ${groupLabel}`,
      });
      return [
        ...manual.map((c) => toOption(c, t('myCustomers'))),
        ...cardReader.map((c) => toOption(c, t('cardReaderCustomers'))),
      ];
    },
    [lookups.customers, t],
  );

  const openEdit = (row) => {
    clearAvatarPick();
    if (row.entryKind === 'card_reader') {
      show(t('editCardReaderElsewhere') || 'تراکنش کارت‌خوان را از صفحه کارت‌خوان اصلاح کنید.', 'error');
      return;
    }
    const form = {
      id: row.id,
      customerMode: 'account',
      customerId: String(row.customerId || row.customer?.id || ''),
      customerName: '',
      phone: '',
      fatherName: '',
      address: '',
      documentNumber: '',
      cashboxId: String(row.cashboxId || row.cashbox?.id || ''),
      currencyId: String(row.currencyId || row.currency?.id || ''),
      amount: String(row.amount ?? ''),
      note: row.note || '',
    };
    if (row.entryKind === 'withdrawal') {
      setWithdrawalForm(form);
      setModal('withdrawal');
    } else {
      setReceiptForm(form);
      setModal('receipt');
    }
  };

  const onAvatarChange = (e) => {
    const file = e.target.files?.[0] || null;
    setAvatarFile(file);
    if (avatarPreview && avatarPreview.startsWith('blob:')) {
      URL.revokeObjectURL(avatarPreview);
    }
    setAvatarPreview(file ? URL.createObjectURL(file) : '');
  };

  const submitReceipt = async (e) => {
    e.preventDefault();
    const isWalkIn = receiptForm.customerMode === 'walkin';
    const hasCustomer = !isWalkIn && Number(receiptForm.customerId) > 0;
    const walkInName = String(receiptForm.customerName || '').trim();
    if (isWalkIn) {
      if (walkInName.length < 2) {
        show(t('customerNameRequired') || 'نام مشتری را وارد کنید.', 'error');
        return;
      }
    } else if (!hasCustomer) {
      show(t('selectCustomer') || 'مشتری را انتخاب کنید.', 'error');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        cashboxId: Number(receiptForm.cashboxId),
        currencyId: Number(receiptForm.currencyId),
        amount: Number(receiptForm.amount),
        note: receiptForm.note || undefined,
      };
      if (hasCustomer) {
        payload.customerId = Number(receiptForm.customerId);
      } else {
        payload.customerName = walkInName;
        payload.phone = receiptForm.phone?.trim() || undefined;
        payload.fatherName = receiptForm.fatherName?.trim() || undefined;
        payload.address = receiptForm.address?.trim() || undefined;
        payload.documentNumber = receiptForm.documentNumber?.trim() || undefined;
      }

      let savedCustomerId = hasCustomer ? Number(receiptForm.customerId) : null;
      if (receiptForm.id) {
        const { data: res } = await api.put(`/receipts-withdrawals/receipt/${receiptForm.id}`, payload);
        savedCustomerId = res?.data?.customerId || savedCustomerId;
        show(t('success'));
      } else {
        const { data: res } = await api.post('/receipts-withdrawals/receipt', payload);
        savedCustomerId = res?.data?.customerId || savedCustomerId;
        show(t('receiptSavedCashbox'));
      }
      if (savedCustomerId) await uploadCustomerAvatar(savedCustomerId);
      setModal(null);
      clearAvatarPick();
      load();
    } catch (err) {
      show(messageOf(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  const submitWithdrawal = async (e) => {
    e.preventDefault();

    const isWalkIn = withdrawalForm.customerMode === 'walkin';
    const hasCustomer = !isWalkIn && Number(withdrawalForm.customerId) > 0;
    const walkInName = String(withdrawalForm.customerName || '').trim();
    const cashboxId = Number(withdrawalForm.cashboxId);
    const currencyId = Number(withdrawalForm.currencyId);
    const amount = Number(withdrawalForm.amount);

    if (isWalkIn) {
      if (walkInName.length < 2) {
        show(t('customerNameRequired') || 'نام مشتری را وارد کنید.', 'error');
        return;
      }
    } else if (!hasCustomer) {
      show(t('selectCustomer') || 'مشتری را انتخاب کنید.', 'error');
      return;
    }
    if (!Number.isInteger(cashboxId) || cashboxId <= 0) {
      show(t('selectCashbox') || 'صندوق را انتخاب کنید.', 'error');
      return;
    }
    if (!Number.isInteger(currencyId) || currencyId <= 0) {
      show(t('currency') || 'ارز را انتخاب کنید.', 'error');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      show(t('amountRequired') || 'مبلغ معتبر وارد کنید.', 'error');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        cashboxId,
        currencyId,
        amount,
        note: withdrawalForm.note?.trim() || undefined,
      };
      if (hasCustomer) {
        payload.customerId = Number(withdrawalForm.customerId);
      } else {
        payload.customerName = walkInName;
        payload.phone = withdrawalForm.phone?.trim() || undefined;
        payload.fatherName = withdrawalForm.fatherName?.trim() || undefined;
        payload.address = withdrawalForm.address?.trim() || undefined;
        payload.documentNumber = withdrawalForm.documentNumber?.trim() || undefined;
      }

      let savedCustomerId = hasCustomer ? Number(withdrawalForm.customerId) : null;
      if (withdrawalForm.id) {
        const { data: res } = await api.put(`/receipts-withdrawals/withdrawal/${withdrawalForm.id}`, payload);
        savedCustomerId = res?.data?.customerId || savedCustomerId;
        show(t('success'));
      } else {
        const { data: res } = await api.post('/receipts-withdrawals/withdrawal', payload);
        savedCustomerId = res?.data?.customerId || savedCustomerId;
        show(t('withdrawalSavedCashbox'));
      }

      if (avatarFile && savedCustomerId) {
        try {
          await uploadCustomerAvatar(savedCustomerId);
        } catch {
          show('برداشت ثبت شد؛ فقط آپلود عکس مشتری انجام نشد.');
        }
      }

      setModal(null);
      clearAvatarPick();
      await load();
    } catch (err) {
      show(messageOf(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  const closeModal = () => {
    setModal(null);
    clearAvatarPick();
  };

  const deleteRow = (row) => {
    if (row.entryKind === 'card_reader') {
      show(t('editCardReaderElsewhere'), 'error');
      return;
    }
    const path = row.entryKind === 'withdrawal'
      ? `/receipts-withdrawals/withdrawal/${row.id}`
      : `/receipts-withdrawals/receipt/${row.id}`;
    askDelete(row, () => api.delete(path));
  };

  const buildColumns = (groupKind) => [
    ...(groupKind === 'all' || groupKind === 'card_reader' ? [{
      key: 'kind',
      label: t('type'),
      render: (r) => {
          if (r.entryKind === 'card_reader') {
          const sub = r.cardReaderKind === 'deposit' ? t('cardDeposit') : t('cardWithdrawal');
          return (
            <span className="badge info">
              {t('cardReader')}
              {' · '}
              {sub}
            </span>
          );
        }
        return (
          <span className={`badge ${r.entryKind === 'withdrawal' ? 'warning' : 'success'}`}>
            {r.entryKind === 'withdrawal' ? t('withdrawal') : t('moneyReceipt')}
          </span>
        );
      },
    }] : []),
    {
      key: 'photo',
      label: t('photo'),
      render: (r) => (
        <UserAvatar
          name={r.customer?.name || r.customerName}
          avatarUrl={r.customer?.avatarUrl || r.photoUrl}
          className="large"
        />
      ),
    },
    {
      key: 'customer',
      label: t('customer'),
      render: (r) => (
        <div>
          <strong>{translatePersonName(t, r.customer?.name || r.customerName)}</strong>
          <small>
            #{r.customer?.id || r.customerId || '—'}
            {(r.customer?.fatherName) ? ` · ${r.customer.fatherName}` : ''}
            {(r.customer?.phone || r.phone) ? ` · ${r.customer?.phone || r.phone}` : ''}
            {r.cardNumber ? ` · ${r.cardNumber}` : ''}
          </small>
        </div>
      ),
    },
    {
      key: 'amount',
      label: t('amount'),
      render: (r) => {
        const isOut = r.entryKind === 'withdrawal'
          || (r.entryKind === 'card_reader' && r.cardReaderKind === 'deposit');
        return (
          <strong className={isOut ? 'text-out' : 'text-in'}>
            {isOut ? '−' : '+'}
            {money(r.amount)}
            {' '}
            {r.currency?.code || ''}
          </strong>
        );
      },
    },
    {
      key: 'cashbox',
      label: t('cashbox'),
      render: (r) => translatePlace(t, r.cashbox?.name) || '—',
    },
    {
      key: 'note',
      label: t('note'),
      render: (r) => r.note || '—',
    },
    {
      key: 'date',
      label: t('date'),
      render: (r) => dateTime(r.createdAt),
    },
    {
      key: 'actions',
      label: t('actions'),
      render: (r) => (
        <div className="row-actions">
          {r.entryKind === 'card_reader' ? null : (
            <>
              <button type="button" className="icon-btn" title={t('edit')} onClick={() => openEdit(r)}>
                <Pencil size={17} />
              </button>
              <button
                type="button"
                className="icon-btn danger"
                title={t('delete')}
                onClick={() => deleteRow(r)}
              >
                <Trash2 size={17} />
              </button>
            </>
          )}
        </div>
      ),
    },
  ];

  const columns = buildColumns(kind === 'all' ? 'all' : kind);

  const baseUnit = totals.baseCurrency?.symbol || totals.baseCurrency?.code || '';
  const pageTitle = kind === 'receipt'
    ? t('moneyReceipt')
    : kind === 'withdrawal'
      ? t('withdrawal')
      : kind === 'card_reader'
        ? t('cardReader')
        : t('receiptsWithdrawals');
  const editingReceipt = Boolean(receiptForm.id);
  const editingWithdrawal = Boolean(withdrawalForm.id);

  const changeKind = (next) => {
    setKind(next);
    setPage(1);
  };

  const renderCurrencyTotals = (title, rows, amountClass = '') => {
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) {
      return (
        <div className="rw-currency-totals-block">
          <h4>{title}</h4>
          <p className="rw-group-empty">{t('noData')}</p>
        </div>
      );
    }
    return (
      <div className="rw-currency-totals-block">
        <h4>{title}</h4>
        <div className="rw-currency-totals-list">
          {list.map((row) => (
            <div key={row.currencyId || row.code} className="rw-currency-total-row">
              <span>
                <strong>{row.code}</strong>
                {row.name ? (
                  <small>{localizeCurrency(t, row)}</small>
                ) : null}
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

  const renderBottomCurrencySummary = () => {
    if (kind === 'receipt') {
      return (
        <div className="accounts-totals rw-currency-summary">
          {renderCurrencyTotals(t('receiptsByCurrency'), totals.receiptsByCurrency, 'positive')}
        </div>
      );
    }
    if (kind === 'withdrawal') {
      return (
        <div className="accounts-totals rw-currency-summary">
          {renderCurrencyTotals(t('withdrawalsByCurrency'), totals.withdrawalsByCurrency, 'negative')}
        </div>
      );
    }
    if (kind === 'card_reader') {
      return (
        <div className="accounts-totals rw-currency-summary">
          <div className="accounts-total-row">
            <span>{t('totalCardReaderBase')}</span>
            <strong>
              {money(totals.cardReaderBase)}
              {baseUnit ? ` ${baseUnit}` : ''}
            </strong>
          </div>
          {renderCurrencyTotals(t('cardReaderByCurrency'), totals.cardReaderByCurrency)}
        </div>
      );
    }
    return (
      <div className="accounts-totals rw-currency-summary">
        <div className="rw-currency-summary-grid">
          {renderCurrencyTotals(t('receiptsByCurrency'), totals.receiptsByCurrency, 'positive')}
          {renderCurrencyTotals(t('withdrawalsByCurrency'), totals.withdrawalsByCurrency, 'negative')}
        </div>
      </div>
    );
  };

  const renderGroupSection = (title, sectionRows, sectionKind, totalKey, totalClass) => (
    <section className="rw-group-panel">
      <div className="rw-group-head">
        <h3>{title}</h3>
        <strong className={totalClass}>
          {money(totals[totalKey] || 0)}
          {baseUnit ? ` ${baseUnit}` : ''}
        </strong>
      </div>
      {sectionRows.length ? (
        <Table rows={sectionRows} columns={buildColumns(sectionKind)} />
      ) : (
        <p className="rw-group-empty">{t('noData')}</p>
      )}
    </section>
  );

  return (
    <>
      <PageHeader
        title={pageTitle}
        actions={(
          <div className="page-actions">
            <PrimaryButton onClick={openReceipt}>{t('moneyReceipt')}</PrimaryButton>
            <button type="button" className="btn soft" onClick={openWithdrawal}>
              <Plus size={16} />
              {t('withdrawal')}
            </button>
          </div>
        )}
      />
      <div className="panel">
        <div className="tabs" style={{ marginBottom: 12 }}>
          <button type="button" className={kind === 'all' ? 'active' : ''} onClick={() => changeKind('all')}>
            {t('all')}
          </button>
          <button type="button" className={kind === 'receipt' ? 'active' : ''} onClick={() => changeKind('receipt')}>
            {t('moneyReceipt')}
          </button>
          <button type="button" className={kind === 'withdrawal' ? 'active' : ''} onClick={() => changeKind('withdrawal')}>
            {t('withdrawal')}
          </button>
          <button type="button" className={kind === 'card_reader' ? 'active' : ''} onClick={() => changeKind('card_reader')}>
            {t('cardReader')}
          </button>
        </div>

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
        <SearchBox
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          onRefresh={load}
        />
        {loading ? <Loading /> : error ? <ErrorBox message={error} /> : (
          <>
            {kind === 'all' ? (
              <div className="rw-groups">
                {renderGroupSection(
                  t('moneyReceipt'),
                  groups.receipts || [],
                  'receipt',
                  'receiptsBase',
                  'positive',
                )}
                {renderGroupSection(
                  t('withdrawal'),
                  groups.withdrawals || [],
                  'withdrawal',
                  'withdrawalsBase',
                  'negative',
                )}
                {renderGroupSection(
                  t('cardReader'),
                  groups.cardReader || [],
                  'card_reader',
                  'cardReaderBase',
                  '',
                )}
                {renderBottomCurrencySummary()}
              </div>
            ) : (
              <>
                <Table rows={rows} columns={columns} />
                <Pagination pagination={pagination} onPage={setPage} />
                {renderBottomCurrencySummary()}
              </>
            )}
          </>
        )}
      </div>

      <Modal
        open={modal === 'receipt'}
        onClose={closeModal}
        title={editingReceipt ? t('edit') : t('moneyReceipt')}
        wide
      >
        <form className="form-grid" onSubmit={submitReceipt}>
          <div className="mode-switch full" role="tablist">
            <button
              type="button"
              className={receiptForm.customerMode === 'account' ? 'active' : ''}
              onClick={() => setReceiptForm({
                ...receiptForm,
                customerMode: 'account',
                customerName: '',
                phone: '',
                fatherName: '',
                address: '',
                documentNumber: '',
              })}
            >
              {t('customerWithAccount')}
            </button>
            <button
              type="button"
              className={receiptForm.customerMode === 'walkin' ? 'active' : ''}
              onClick={() => setReceiptForm({
                ...receiptForm,
                customerMode: 'walkin',
                customerId: '',
              })}
            >
              {t('customerWithoutAccount')}
            </button>
          </div>

          {receiptForm.customerMode === 'account' ? (
            <>
              <Field label={t('customer')} className="full">
                <SearchableSelect
                  required
                  value={receiptForm.customerId}
                  onChange={(customerId) => {
                    clearAvatarPick();
                    setReceiptForm({ ...receiptForm, customerId });
                  }}
                  options={customerOptions}
                  emptyLabel={t('selectCustomer')}
                  placeholder={t('search')}
                />
              </Field>
              {receiptCustomer ? (
                <div className="staff-avatar-field full">
                  <UserAvatar
                    name={receiptCustomer.name}
                    avatarUrl={avatarPreview || receiptCustomer.avatarUrl}
                    className="large"
                  />
                  <div>
                    <strong>{translatePersonName(t, receiptCustomer.name)}</strong>
                    <Field label={t('customerPhotoOptional')}>
                      <input type="file" accept="image/*" onChange={onAvatarChange} />
                    </Field>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <>
              <Field label={t('name')}>
                <input
                  required
                  value={receiptForm.customerName}
                  onChange={(e) => setReceiptForm({ ...receiptForm, customerName: e.target.value })}
                  autoComplete="off"
                />
              </Field>
              <Field label={t('phone')}>
                <input
                  value={receiptForm.phone}
                  onChange={(e) => setReceiptForm({ ...receiptForm, phone: e.target.value })}
                  autoComplete="off"
                />
              </Field>
              <Field label={t('fatherName')}>
                <input
                  value={receiptForm.fatherName}
                  onChange={(e) => setReceiptForm({ ...receiptForm, fatherName: e.target.value })}
                  autoComplete="off"
                />
              </Field>
              <Field label={t('address')} className="full">
                <input
                  value={receiptForm.address}
                  onChange={(e) => setReceiptForm({ ...receiptForm, address: e.target.value })}
                  autoComplete="off"
                />
              </Field>
              <Field label={t('documentNumber')}>
                <input
                  value={receiptForm.documentNumber}
                  onChange={(e) => setReceiptForm({ ...receiptForm, documentNumber: e.target.value })}
                  autoComplete="off"
                />
              </Field>
            </>
          )}
          <Field label={t('cashbox')}>
            <select
              required
              value={receiptForm.cashboxId}
              onChange={(e) => setReceiptForm({ ...receiptForm, cashboxId: e.target.value })}
            >
              <option value="">{t('selectCashbox')}</option>
              {(lookups.cashboxes || []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </Field>
          <Field label={t('currency')}>
            <select
              required
              value={receiptForm.currencyId}
              onChange={(e) => setReceiptForm({ ...receiptForm, currencyId: e.target.value })}
            >
              {(lookups.currencies || []).map((c) => (
                <option key={c.id} value={c.id}>{localizeCurrency(t, c)}</option>
              ))}
            </select>
          </Field>
          <Field label={t('amount')}>
            <input
              required
              type="number"
              min="0"
              step="any"
              value={receiptForm.amount}
              onChange={(e) => setReceiptForm({ ...receiptForm, amount: e.target.value })}
            />
          </Field>
          <Field label={t('note')} className="full">
            <input
              value={receiptForm.note}
              onChange={(e) => setReceiptForm({ ...receiptForm, note: e.target.value })}
            />
          </Field>
          <div className="form-actions full">
            <button type="button" className="btn soft" onClick={closeModal}>{t('cancel')}</button>
            <button className="btn primary" disabled={saving}>
              {saving ? t('loading') : (editingReceipt ? t('update') : t('save'))}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={modal === 'withdrawal'}
        onClose={closeModal}
        title={editingWithdrawal ? t('edit') : t('withdrawal')}
        wide
      >
        <form className="form-grid" onSubmit={submitWithdrawal}>
          <div className="mode-switch full" role="tablist">
            <button
              type="button"
              className={withdrawalForm.customerMode === 'account' ? 'active' : ''}
              onClick={() => setWithdrawalForm({
                ...withdrawalForm,
                customerMode: 'account',
                customerName: '',
                phone: '',
                fatherName: '',
                address: '',
                documentNumber: '',
              })}
            >
              {t('customerWithAccount')}
            </button>
            <button
              type="button"
              className={withdrawalForm.customerMode === 'walkin' ? 'active' : ''}
              onClick={() => setWithdrawalForm({
                ...withdrawalForm,
                customerMode: 'walkin',
                customerId: '',
              })}
            >
              {t('customerWithoutAccount')}
            </button>
          </div>

          {withdrawalForm.customerMode === 'account' ? (
            <>
              <Field label={t('customer')} className="full">
                <SearchableSelect
                  required
                  value={withdrawalForm.customerId}
                  onChange={(customerId) => {
                    clearAvatarPick();
                    setWithdrawalForm({ ...withdrawalForm, customerId });
                  }}
                  options={customerOptions}
                  emptyLabel={t('selectCustomer')}
                  placeholder={t('search')}
                />
              </Field>
              {withdrawalCustomer ? (
                <div className="staff-avatar-field full">
                  <UserAvatar
                    name={withdrawalCustomer.name}
                    avatarUrl={avatarPreview || withdrawalCustomer.avatarUrl}
                    className="large"
                  />
                  <div>
                    <strong>{translatePersonName(t, withdrawalCustomer.name)}</strong>
                    <Field label={t('customerPhotoOptional')}>
                      <input type="file" accept="image/*" onChange={onAvatarChange} />
                    </Field>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <>
              <Field label={t('name')}>
                <input
                  required
                  value={withdrawalForm.customerName}
                  onChange={(e) => setWithdrawalForm({ ...withdrawalForm, customerName: e.target.value })}
                  autoComplete="off"
                />
              </Field>
              <Field label={t('phone')}>
                <input
                  value={withdrawalForm.phone}
                  onChange={(e) => setWithdrawalForm({ ...withdrawalForm, phone: e.target.value })}
                  autoComplete="off"
                />
              </Field>
              <Field label={t('fatherName')}>
                <input
                  value={withdrawalForm.fatherName}
                  onChange={(e) => setWithdrawalForm({ ...withdrawalForm, fatherName: e.target.value })}
                  autoComplete="off"
                />
              </Field>
              <Field label={t('address')} className="full">
                <input
                  value={withdrawalForm.address}
                  onChange={(e) => setWithdrawalForm({ ...withdrawalForm, address: e.target.value })}
                  autoComplete="off"
                />
              </Field>
              <Field label={t('documentNumber')}>
                <input
                  value={withdrawalForm.documentNumber}
                  onChange={(e) => setWithdrawalForm({ ...withdrawalForm, documentNumber: e.target.value })}
                  autoComplete="off"
                />
              </Field>
            </>
          )}
          <Field label={t('cashbox')}>
            <select
              required
              value={withdrawalForm.cashboxId}
              onChange={(e) => setWithdrawalForm({ ...withdrawalForm, cashboxId: e.target.value })}
            >
              <option value="">{t('selectCashbox')}</option>
              {(lookups.cashboxes || []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </Field>
          <Field label={t('currency')}>
            <select
              required
              value={withdrawalForm.currencyId}
              onChange={(e) => setWithdrawalForm({ ...withdrawalForm, currencyId: e.target.value })}
            >
              {(lookups.currencies || []).map((c) => (
                <option key={c.id} value={c.id}>{localizeCurrency(t, c)}</option>
              ))}
            </select>
          </Field>
          <Field label={t('amount')}>
            <input
              required
              type="number"
              min="0"
              step="any"
              value={withdrawalForm.amount}
              onChange={(e) => setWithdrawalForm({ ...withdrawalForm, amount: e.target.value })}
            />
          </Field>
          <Field label={t('note')} className="full">
            <input
              value={withdrawalForm.note}
              onChange={(e) => setWithdrawalForm({ ...withdrawalForm, note: e.target.value })}
            />
          </Field>
          <div className="form-actions full">
            <button type="button" className="btn soft" onClick={closeModal}>{t('cancel')}</button>
            <button className="btn primary" disabled={saving}>
              {saving ? t('loading') : (editingWithdrawal ? t('update') : t('save'))}
            </button>
          </div>
        </form>
      </Modal>
      {deleteDialog}
    </>
  );
}
