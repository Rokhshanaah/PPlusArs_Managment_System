import { useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api, messageOf } from '../api/client.js';
import { ErrorBox, Field, Loading, Modal, PageHeader, Pagination, SearchBox, Table } from '../components/Common.jsx';
import SearchableSelect from '../components/SearchableSelect.jsx';
import { useDeleteConfirm } from '../components/ConfirmDelete.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { dateTime, money } from '../utils/format.js';
import { localizeCurrency, localizeValue, translatePersonName, translatePlace, translateState } from '../utils/labels.js';
import { openCustomerWhatsapp } from '../utils/whatsapp.js';

const initial = {
  senderId: '',
  receiverName: '',
  receiverPhone: '',
  fromBranchId: '',
  toBranchId: '',
  currencyId: '',
  sourceCashboxId: '',
  destinationCashboxId: '',
  amount: '',
  fee: '0',
  feeCurrencyId: '',
  note: '',
};

const TRANSFER_MODES = [
  { id: 'person_to_person', labelKey: 'personToPerson' },
  { id: 'person_to_cashbox', labelKey: 'personToCashbox' },
  { id: 'cashbox_to_person', labelKey: 'cashboxToPerson' },
];

const transferInitial = {
  mode: 'person_to_person',
  senderId: '',
  receiverCustomerId: '',
  cashboxId: '',
  currencyId: '',
  amount: '',
  fee: '0',
  feeCurrencyId: '',
  note: '',
};

function defaultTransferForm(lookups) {
  const currency = lookups?.currencies?.[0];
  return {
    ...transferInitial,
    currencyId: currency ? String(currency.id) : '',
    feeCurrencyId: currency ? String(currency.id) : '',
  };
}

function noteForEdit(note) {
  return String(note || '')
    .replace(/\s*\|\s*ZH_FEE:[\d.]+\s*/g, '')
    .replace(/\s→\s.*$/, '')
    .replace(/\s←\s.*$/, '')
    .trim();
}

function buildTransferPayload(form) {
  return {
    direction: form.mode,
    fromCustomerId: form.senderId ? Number(form.senderId) : null,
    toCustomerId: form.receiverCustomerId ? Number(form.receiverCustomerId) : null,
    cashboxId: form.cashboxId ? Number(form.cashboxId) : null,
    currencyId: Number(form.currencyId),
    amount: Number(form.amount),
    fee: form.mode === 'person_to_person' ? Number(form.fee || 0) : 0,
    feeCurrencyId: Number(form.feeCurrencyId || form.currencyId),
    note: form.note || null,
  };
}

export default function RemittancesPage() {
  const { t } = useTranslation();
  const { show } = useToast();
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [lookups, setLookups] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(initial);
  const [transferForm, setTransferForm] = useState(transferInitial);
  const [transferSaving, setTransferSaving] = useState(false);
  const [accountTransferOpen, setAccountTransferOpen] = useState(false);
  const [editingAccountTransfer, setEditingAccountTransfer] = useState(null);
  const [accountTransferForm, setAccountTransferForm] = useState(transferInitial);
  const [accountTransferSaving, setAccountTransferSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [a, b] = await Promise.all([
        api.get('/remittances', { params: { page, limit: 15, search: search || undefined } }),
        api.get('/lookups'),
      ]);
      setRows(a.data.data.rows || []);
      setPagination(a.data.data.pagination);
      setLookups(b.data.data);
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
  }, [page, search]);

  useEffect(() => {
    const handler = () => load();
    window.addEventListener('zarin:remittances:changed', handler);
    return () => window.removeEventListener('zarin:remittances:changed', handler);
  }, [page, search]);

  useEffect(() => {
    if (lookups && !transferForm.currencyId) {
      setTransferForm(defaultTransferForm(lookups));
    }
  }, [lookups]);

  const customerSelectOptions = useMemo(
    () => (lookups?.customers || []).map((c) => ({
      value: String(c.id),
      label: `#${c.id} — ${translatePersonName(t, c.name)}`,
      searchText: `${c.id} ${c.name} ${c.phone || ''}`,
    })),
    [lookups?.customers, t],
  );

  const { askDelete, dialog: deleteDialog } = useDeleteConfirm({
    onDeleted: () => {
      show(t('success'));
      load();
    },
    translateLabel: (row) => row.number,
  });

  const sourceCashboxes = useMemo(
    () => lookups?.cashboxes?.filter((c) => String(c.branchId) === String(form.fromBranchId)) || [],
    [lookups, form.fromBranchId],
  );

  const formDestinationCashboxes = useMemo(
    () => lookups?.cashboxes?.filter((c) => String(c.branchId) === String(form.toBranchId)) || [],
    [lookups, form.toBranchId],
  );

  const openCreate = () => {
    if (!lookups) return;
    const branches = lookups.branches || [];
    const from = branches[0];
    const to = branches.find((b) => b.id !== from?.id) || branches[1] || from;
    const currency = lookups.currencies?.[0];
    const sourceCash = lookups.cashboxes?.find((c) => c.branchId === from?.id);
    const destCash = lookups.cashboxes?.find((c) => c.branchId === to?.id);
    setEditing(null);
    setForm({
      ...initial,
      fromBranchId: from ? String(from.id) : '',
      toBranchId: to ? String(to.id) : '',
      currencyId: currency ? String(currency.id) : '',
      sourceCashboxId: sourceCash ? String(sourceCash.id) : '',
      destinationCashboxId: destCash ? String(destCash.id) : '',
      feeCurrencyId: currency ? String(currency.id) : '',
    });
    setOpen(true);
  };

  const openEdit = (r) => {
    setEditing(r);
    setForm({
      senderId: r.senderId ? String(r.senderId) : '',
      receiverName: r.receiverName || '',
      receiverPhone: r.receiverPhone || '',
      fromBranchId: String(r.fromBranchId),
      toBranchId: String(r.toBranchId),
      currencyId: String(r.currencyId),
      sourceCashboxId: r.sourceCashboxId ? String(r.sourceCashboxId) : '',
      destinationCashboxId: r.destinationCashboxId ? String(r.destinationCashboxId) : '',
      amount: String(r.amount),
      fee: String(r.fee ?? 0),
      feeCurrencyId: String(r.feeCurrencyId || r.currencyId),
      note: r.note || '',
    });
    setOpen(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    const payload = {
      senderId: form.senderId ? Number(form.senderId) : null,
      receiverName: form.receiverName,
      receiverPhone: form.receiverPhone || null,
      fromBranchId: Number(form.fromBranchId),
      toBranchId: Number(form.toBranchId),
      currencyId: Number(form.currencyId),
      sourceCashboxId: Number(form.sourceCashboxId),
      destinationCashboxId: form.destinationCashboxId ? Number(form.destinationCashboxId) : null,
      amount: Number(form.amount),
      fee: Number(form.fee || 0),
      feeCurrencyId: Number(form.feeCurrencyId || form.currencyId),
      note: form.note || null,
    };
    try {
      if (editing) await api.put(`/remittances/${editing.id}`, payload);
      else {
        const { data } = await api.post('/remittances', payload);
        openCustomerWhatsapp(data.data?.whatsapp);
      }
      show(t('success'));
      setOpen(false);
      setEditing(null);
      load();
    } catch (err) {
      show(messageOf(err), 'error');
    }
  };

  const submitTransfer = async (e) => {
    e.preventDefault();
    if (
      transferForm.mode === 'person_to_person'
      && transferForm.senderId
      && transferForm.receiverCustomerId
      && transferForm.senderId === transferForm.receiverCustomerId
    ) {
      show(t('sameSenderReceiver'), 'error');
      return;
    }
    setTransferSaving(true);
    try {
      const { data } = await api.post('/customer-transfers', buildTransferPayload(transferForm));
      openCustomerWhatsapp(data.data?.whatsapp);
      show(t('customerTransferSuccess'));
      setTransferForm(defaultTransferForm(lookups));
      load();
    } catch (err) {
      show(messageOf(err), 'error');
    } finally {
      setTransferSaving(false);
    }
  };

  const openEditAccountTransfer = (row) => {
    setEditingAccountTransfer(row);
    setAccountTransferForm({
      mode: row.direction || 'person_to_person',
      senderId: row.fromCustomerId ? String(row.fromCustomerId) : (row.sender?.id ? String(row.sender.id) : ''),
      receiverCustomerId: row.toCustomerId ? String(row.toCustomerId) : (row.receiverCustomer?.id ? String(row.receiverCustomer.id) : ''),
      cashboxId: row.cashboxId ? String(row.cashboxId) : '',
      currencyId: String(row.currencyId || row.currency?.id || ''),
      amount: String(row.amount),
      fee: String(row.fee ?? 0),
      feeCurrencyId: String(row.feeCurrencyId || row.currencyId || row.currency?.id || ''),
      note: noteForEdit(row.note),
    });
    setAccountTransferOpen(true);
  };

  const submitAccountTransferEdit = async (e) => {
    e.preventDefault();
    if (
      accountTransferForm.mode === 'person_to_person'
      && accountTransferForm.senderId
      && accountTransferForm.receiverCustomerId
      && accountTransferForm.senderId === accountTransferForm.receiverCustomerId
    ) {
      show(t('sameSenderReceiver'), 'error');
      return;
    }
    if (!editingAccountTransfer?.ledgerId) return;
    setAccountTransferSaving(true);
    try {
      await api.put(`/customer-transfers/${editingAccountTransfer.ledgerId}`, buildTransferPayload(accountTransferForm));
      show(t('success'));
      setAccountTransferOpen(false);
      setEditingAccountTransfer(null);
      load();
    } catch (err) {
      show(messageOf(err), 'error');
    } finally {
      setAccountTransferSaving(false);
    }
  };

  const deleteRemittanceRow = (row) => {
    if (row.rowKind === 'account_transfer') {
      return api.delete(`/customer-transfers/${row.ledgerId}`);
    }
    return api.delete(`/remittances/${row.id}`);
  };

  const isPending = (r) => {
    const state = String(r?.state || '');
    return state.includes('انتظار') || state.toLowerCase() === 'pending';
  };

  const isAccountTransfer = (r) => r.rowKind === 'account_transfer';

  const transferDirectionLabel = (direction) => {
    if (direction === 'person_to_cashbox') return t('personToCashbox');
    if (direction === 'cashbox_to_person') return t('cashboxToPerson');
    return t('personToPerson');
  };

  return (
    <>
      <PageHeader
        title={t('remittances')}
        actions={(
          <button type="button" className="btn primary" onClick={openCreate} disabled={!lookups}>
            <Plus size={17} />
            {t('add')}
          </button>
        )}
      />

      <section className="panel remittance-transfer-panel">
        <div className="remittance-transfer-head">
          <div>
            <h2>{t('remittance')}</h2>
            <p className="field-hint">{t('remittanceSectionHint')}</p>
            <p className="field-hint">{t('p2pTransferHint')}</p>
          </div>
        </div>

        <div className="remittance-mode-tabs" role="tablist" aria-label={t('remittanceDirection')}>
          {TRANSFER_MODES.map((mode) => (
            <button
              key={mode.id}
              type="button"
              role="tab"
              aria-selected={transferForm.mode === mode.id}
              className={`remittance-mode-tab${transferForm.mode === mode.id ? ' active' : ''}`}
              onClick={() => setTransferForm({
                ...defaultTransferForm(lookups),
                mode: mode.id,
              })}
            >
              {t(mode.labelKey)}
            </button>
          ))}
        </div>

        <form className="form-grid remittance-transfer-form" onSubmit={submitTransfer}>
          {(transferForm.mode === 'person_to_person' || transferForm.mode === 'person_to_cashbox') ? (
            <Field label={t('sender')}>
              <SearchableSelect
                value={transferForm.senderId}
                onChange={(senderId) => setTransferForm({ ...transferForm, senderId })}
                options={customerSelectOptions}
                emptyLabel={t('selectCustomer')}
              />
            </Field>
          ) : null}

          {(transferForm.mode === 'person_to_person' || transferForm.mode === 'cashbox_to_person') ? (
            <Field label={t('receiverName')}>
              <SearchableSelect
                value={transferForm.receiverCustomerId}
                onChange={(receiverCustomerId) => setTransferForm({ ...transferForm, receiverCustomerId })}
                options={customerSelectOptions.filter((o) => o.value !== transferForm.senderId)}
                emptyLabel={t('selectCustomer')}
              />
            </Field>
          ) : null}

          {(transferForm.mode === 'person_to_cashbox' || transferForm.mode === 'cashbox_to_person') ? (
            <Field label={t('cashbox')} className={transferForm.mode === 'person_to_person' ? '' : 'full'}>
              <select
                required
                value={transferForm.cashboxId}
                onChange={(e) => setTransferForm({ ...transferForm, cashboxId: e.target.value })}
              >
                <option value="">{t('selectCashbox')}</option>
                {lookups?.cashboxes?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {localizeValue(t, c.name)}
                    {c.branch?.name ? ` — ${localizeValue(t, c.branch.name)}` : ''}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}

          <Field label={t('currency')}>
            <select
              required
              value={transferForm.currencyId}
              onChange={(e) => setTransferForm({
                ...transferForm,
                currencyId: e.target.value,
                feeCurrencyId: transferForm.feeCurrencyId || e.target.value,
              })}
            >
              {lookups?.currencies?.map((c) => (
                <option key={c.id} value={c.id}>{c.code} — {localizeCurrency(t, c)}</option>
              ))}
            </select>
          </Field>
          <Field label={t('amount')}>
            <input
              required
              type="number"
              min="0.000001"
              step="any"
              value={transferForm.amount}
              onChange={(e) => setTransferForm({ ...transferForm, amount: e.target.value })}
            />
          </Field>

          {transferForm.mode === 'person_to_person' ? (
            <>
              <Field label={t('fee')}>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={transferForm.fee}
                  onChange={(e) => setTransferForm({ ...transferForm, fee: e.target.value })}
                />
              </Field>
              <Field label={t('feeCurrency')}>
                <select
                  required
                  value={transferForm.feeCurrencyId}
                  onChange={(e) => setTransferForm({ ...transferForm, feeCurrencyId: e.target.value })}
                >
                  {lookups?.currencies?.map((c) => (
                    <option key={c.id} value={c.id}>{c.code} — {localizeCurrency(t, c)}</option>
                  ))}
                </select>
              </Field>
            </>
          ) : null}

          <Field label={t('note')} className="full">
            <input value={transferForm.note} onChange={(e) => setTransferForm({ ...transferForm, note: e.target.value })} />
          </Field>

          <div className="form-actions full">
            <button className="btn primary" type="submit" disabled={transferSaving || !lookups}>
              {transferSaving ? t('loading') : t('save')}
            </button>
          </div>
        </form>
      </section>

      <div className="panel">
        <SearchBox
          value={search}
          onChange={(v) => { setPage(1); setSearch(v); }}
          onRefresh={load}
        />
        {loading ? <Loading /> : error ? <ErrorBox message={error} /> : (
          <>
            <Table
              rows={rows}
              columns={[
                { key: 'number', label: t('number'), render: (r) => <strong>{r.number}</strong> },
                { key: 'sender', label: t('sender'), render: (r) => (r.sender ? (
                  <div>
                    <strong>{translatePersonName(t, r.sender?.name)}</strong>
                    <small>#{r.sender.id}</small>
                  </div>
                ) : '—') },
                { key: 'receiverName', label: t('receiverName'), render: (r) => translatePersonName(t, r.receiverName || r.receiverCustomer?.name) },
                {
                  key: 'route',
                  label: t('branch'),
                  render: (r) => (
                    isAccountTransfer(r) ? (
                      <div>
                        <div>{transferDirectionLabel(r.direction)}</div>
                        {r.cashbox?.name ? (
                          <small>{localizeValue(t, r.cashbox.name)}{r.cashbox.branch?.name ? ` · ${localizeValue(t, r.cashbox.branch.name)}` : ''}</small>
                        ) : null}
                      </div>
                    ) : (
                      <div>
                        <div>
                          {t('fromBranch')}: {translatePlace(t, r.fromBranch?.name)}
                          {r.sourceCashbox?.name ? ` · ${localizeValue(t, r.sourceCashbox.name)} (${t('sourceCashbox')})` : ''}
                        </div>
                        <small>
                          {t('toBranch')}: {translatePlace(t, r.toBranch?.name)}
                          {r.destinationCashbox?.name ? ` · ${localizeValue(t, r.destinationCashbox.name)} (${t('destinationCashbox')})` : ''}
                        </small>
                      </div>
                    )
                  ),
                },
                {
                  key: 'amount',
                  label: t('amount'),
                  render: (r) => {
                    const feePart = Number(r.fee) > 0
                      ? ` + ${money(r.fee)} ${r.feeCurrency?.code || r.currency?.code || ''} ${t('fee')}`
                      : '';
                    return `${money(r.amount)} ${r.currency?.code || ''}${feePart}`;
                  },
                },
                {
                  key: 'state',
                  label: t('status'),
                  render: (r) => (
                    <span className={`badge ${r.state === 'پرداخت شده' || r.state === 'ثبت شده' ? 'success' : r.state === 'لغو شده' ? 'muted' : 'warning'}`}>
                      {translateState(t, r.state)}
                    </span>
                  ),
                },
                { key: 'date', label: t('date'), render: (r) => dateTime(r.createdAt) },
                {
                  key: 'actions',
                  label: t('actions'),
                  render: (r) => (
                    <div className="row-actions">
                      {isAccountTransfer(r) || isPending(r) ? (
                        <button
                          type="button"
                          className="icon-btn"
                          title={t('edit')}
                          onClick={() => (isAccountTransfer(r) ? openEditAccountTransfer(r) : openEdit(r))}
                        >
                          <Pencil size={17} />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="icon-btn danger"
                        title={t('delete')}
                        onClick={() => askDelete(r, deleteRemittanceRow)}
                      >
                        <Trash2 size={17} />
                      </button>
                    </div>
                  ),
                },
              ]}
            />
            <Pagination pagination={pagination} onPage={setPage} />
          </>
        )}
      </div>

      <Modal open={open} onClose={() => { setOpen(false); setEditing(null); }} title={editing ? t('edit') : t('add')} wide>
        <form className="form-grid" onSubmit={submit}>
          <Field label={t('sender')}>
            <SearchableSelect
              value={form.senderId}
              onChange={(senderId) => setForm({ ...form, senderId })}
              options={customerSelectOptions}
              emptyLabel={t('optional')}
            />
          </Field>
          <Field label={t('receiverName')}>
            <input required value={form.receiverName} onChange={(e) => setForm({ ...form, receiverName: e.target.value })} />
          </Field>
          <Field label={t('receiverPhone')} className="full">
            <input value={form.receiverPhone} onChange={(e) => setForm({ ...form, receiverPhone: e.target.value })} />
          </Field>

          <div className="remittance-sides">
            <section className="remittance-side">
              <div className="remittance-side-head">{t('fromBranch')} — {t('sourceCashbox')}</div>
              <div className="form-grid">
                <Field label={t('fromBranch')}>
                  <select
                    required
                    value={form.fromBranchId}
                    onChange={(e) => setForm({ ...form, fromBranchId: e.target.value, sourceCashboxId: '' })}
                  >
                    {lookups?.branches?.map((b) => (
                      <option key={b.id} value={b.id}>{localizeValue(t, b.name)}</option>
                    ))}
                  </select>
                </Field>
                <Field label={t('sourceCashbox')}>
                  <select
                    required
                    value={form.sourceCashboxId}
                    onChange={(e) => setForm({ ...form, sourceCashboxId: e.target.value })}
                  >
                    <option value="">{t('selectCashbox')}</option>
                    {sourceCashboxes.map((c) => (
                      <option key={c.id} value={c.id}>{localizeValue(t, c.name)}</option>
                    ))}
                  </select>
                </Field>
                <Field label={t('currency')}>
                  <select
                    required
                    value={form.currencyId}
                    onChange={(e) => setForm({
                      ...form,
                      currencyId: e.target.value,
                      feeCurrencyId: form.feeCurrencyId || e.target.value,
                    })}
                  >
                    {lookups?.currencies?.map((c) => (
                      <option key={c.id} value={c.id}>{c.code} — {localizeCurrency(t, c)}</option>
                    ))}
                  </select>
                </Field>
                <Field label={t('amount')}>
                  <input
                    required
                    type="number"
                    min="0.000001"
                    step="any"
                    value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  />
                </Field>
              </div>
            </section>

            <section className="remittance-side">
              <div className="remittance-side-head">{t('toBranch')} — {t('destinationCashbox')}</div>
              <div className="form-grid">
                <Field label={t('toBranch')}>
                  <select
                    required
                    value={form.toBranchId}
                    onChange={(e) => setForm({ ...form, toBranchId: e.target.value, destinationCashboxId: '' })}
                  >
                    {lookups?.branches?.map((b) => (
                      <option key={b.id} value={b.id}>{localizeValue(t, b.name)}</option>
                    ))}
                  </select>
                </Field>
                <Field label={t('destinationCashbox')}>
                  <select
                    required
                    value={form.destinationCashboxId}
                    onChange={(e) => setForm({ ...form, destinationCashboxId: e.target.value })}
                  >
                    <option value="">{t('selectCashbox')}</option>
                    {formDestinationCashboxes.map((c) => (
                      <option key={c.id} value={c.id}>{localizeValue(t, c.name)}</option>
                    ))}
                  </select>
                </Field>
                <Field label={t('currency')}>
                  <select
                    required
                    value={form.currencyId}
                    onChange={(e) => setForm({
                      ...form,
                      currencyId: e.target.value,
                      feeCurrencyId: form.feeCurrencyId || e.target.value,
                    })}
                  >
                    {lookups?.currencies?.map((c) => (
                      <option key={c.id} value={c.id}>{c.code} — {localizeCurrency(t, c)}</option>
                    ))}
                  </select>
                </Field>
                <Field label={t('amount')}>
                  <input
                    required
                    type="number"
                    min="0.000001"
                    step="any"
                    value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  />
                </Field>
              </div>
            </section>
          </div>

          <Field label={t('fee')}>
            <input
              type="number"
              min="0"
              step="any"
              value={form.fee}
              onChange={(e) => setForm({ ...form, fee: e.target.value })}
            />
          </Field>
          <Field label={t('feeCurrency')}>
            <select
              required
              value={form.feeCurrencyId}
              onChange={(e) => setForm({ ...form, feeCurrencyId: e.target.value })}
            >
              {lookups?.currencies?.map((c) => (
                <option key={c.id} value={c.id}>{c.code} — {localizeCurrency(t, c)}</option>
              ))}
            </select>
          </Field>
          <Field label={t('note')} className="full">
            <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </Field>
          <div className="form-actions full">
            <button type="button" className="btn soft" onClick={() => { setOpen(false); setEditing(null); }}>{t('cancel')}</button>
            <button className="btn primary" type="submit">{editing ? t('update') : t('save')}</button>
          </div>
        </form>
      </Modal>

      <Modal
        open={accountTransferOpen}
        onClose={() => { setAccountTransferOpen(false); setEditingAccountTransfer(null); }}
        title={t('edit')}
        wide
      >
        <form className="form-grid remittance-transfer-form" onSubmit={submitAccountTransferEdit}>
          <Field label={t('remittanceDirection')} className="full">
            <select
              value={accountTransferForm.mode}
              onChange={(e) => setAccountTransferForm({ ...accountTransferForm, mode: e.target.value })}
            >
              {TRANSFER_MODES.map((mode) => (
                <option key={mode.id} value={mode.id}>{t(mode.labelKey)}</option>
              ))}
            </select>
          </Field>

          {(accountTransferForm.mode === 'person_to_person' || accountTransferForm.mode === 'person_to_cashbox') ? (
            <Field label={t('sender')}>
              <SearchableSelect
                value={accountTransferForm.senderId}
                onChange={(senderId) => setAccountTransferForm({ ...accountTransferForm, senderId })}
                options={customerSelectOptions}
                emptyLabel={t('selectCustomer')}
              />
            </Field>
          ) : null}

          {(accountTransferForm.mode === 'person_to_person' || accountTransferForm.mode === 'cashbox_to_person') ? (
            <Field label={t('receiverName')}>
              <SearchableSelect
                value={accountTransferForm.receiverCustomerId}
                onChange={(receiverCustomerId) => setAccountTransferForm({ ...accountTransferForm, receiverCustomerId })}
                options={customerSelectOptions.filter((o) => o.value !== accountTransferForm.senderId)}
                emptyLabel={t('selectCustomer')}
              />
            </Field>
          ) : null}

          {(accountTransferForm.mode === 'person_to_cashbox' || accountTransferForm.mode === 'cashbox_to_person') ? (
            <Field label={t('cashbox')} className="full">
              <select
                required
                value={accountTransferForm.cashboxId}
                onChange={(e) => setAccountTransferForm({ ...accountTransferForm, cashboxId: e.target.value })}
              >
                <option value="">{t('selectCashbox')}</option>
                {lookups?.cashboxes?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {localizeValue(t, c.name)}
                    {c.branch?.name ? ` — ${localizeValue(t, c.branch.name)}` : ''}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}

          <Field label={t('currency')}>
            <select
              required
              value={accountTransferForm.currencyId}
              onChange={(e) => setAccountTransferForm({
                ...accountTransferForm,
                currencyId: e.target.value,
                feeCurrencyId: accountTransferForm.feeCurrencyId || e.target.value,
              })}
            >
              {lookups?.currencies?.map((c) => (
                <option key={c.id} value={c.id}>{c.code} — {localizeCurrency(t, c)}</option>
              ))}
            </select>
          </Field>
          <Field label={t('amount')}>
            <input
              required
              type="number"
              min="0.000001"
              step="any"
              value={accountTransferForm.amount}
              onChange={(e) => setAccountTransferForm({ ...accountTransferForm, amount: e.target.value })}
            />
          </Field>

          {accountTransferForm.mode === 'person_to_person' ? (
            <>
              <Field label={t('fee')}>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={accountTransferForm.fee}
                  onChange={(e) => setAccountTransferForm({ ...accountTransferForm, fee: e.target.value })}
                />
              </Field>
              <Field label={t('feeCurrency')}>
                <select
                  required
                  value={accountTransferForm.feeCurrencyId}
                  onChange={(e) => setAccountTransferForm({ ...accountTransferForm, feeCurrencyId: e.target.value })}
                >
                  {lookups?.currencies?.map((c) => (
                    <option key={c.id} value={c.id}>{c.code} — {localizeCurrency(t, c)}</option>
                  ))}
                </select>
              </Field>
            </>
          ) : null}

          <Field label={t('note')} className="full">
            <input
              value={accountTransferForm.note}
              onChange={(e) => setAccountTransferForm({ ...accountTransferForm, note: e.target.value })}
            />
          </Field>

          <div className="form-actions full">
            <button
              type="button"
              className="btn soft"
              onClick={() => { setAccountTransferOpen(false); setEditingAccountTransfer(null); }}
            >
              {t('cancel')}
            </button>
            <button className="btn primary" type="submit" disabled={accountTransferSaving || !lookups}>
              {accountTransferSaving ? t('loading') : t('update')}
            </button>
          </div>
        </form>
      </Modal>

      {deleteDialog}
    </>
  );
}
