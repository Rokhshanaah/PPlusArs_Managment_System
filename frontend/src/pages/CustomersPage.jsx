import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Link2, Pencil, Plus, Trash2, WalletCards, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api, messageOf } from '../api/client.js';
import {
  ErrorBox,
  Field,
  Loading,
  Modal,
  PageHeader,
  PrimaryButton,
  SearchBox,
  StatusBadge,
  Table,
} from '../components/Common.jsx';
import UserAvatar from '../components/UserAvatar.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useDeleteConfirm } from '../components/ConfirmDelete.jsx';
import {
  CUSTOMER_STATE_OPTIONS,
  DOCUMENT_TYPE_OPTIONS,
  TRUST_OPTIONS,
  localizeCurrency,
  localizeValue,
} from '../utils/labels.js';
import { buildPortalLinkPair } from '../utils/portalUrl.js';
import { normalizeAmountInput } from '../utils/format.js';
import { useCompany } from '../context/CompanyContext.jsx';

const emptyOpeningRow = () => ({ currencyId: '', amount: '', side: 'creditor' });

const initial = {
  name: '',
  fatherName: '',
  phone: '',
  whatsappPhone: '',
  address: '',
  documentType: '',
  documentNumber: '',
  trustLevel: 'عادی',
  state: 'تأیید شده',
  openingBalances: [emptyOpeningRow()],
};

export default function CustomersPage() {
  const { t } = useTranslation();
  const { show } = useToast();
  const { hasFeature } = useCompany();
  const [rows, setRows] = useState([]);
  const [currencies, setCurrencies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sourceTab, setSourceTab] = useState('manual');
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [createdLinks, setCreatedLinks] = useState({ online: '', local: '' });
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState('');
  const [removeAvatar, setRemoveAvatar] = useState(false);

  const [openingLocked, setOpeningLocked] = useState(false);

  const { askDelete, dialog: deleteDialog } = useDeleteConfirm({
    onDeleted: () => {
      show(t('success'));
      load();
    },
    translateLabel: (row) => localizeValue(t, row.name),
  });

  const load = async () => {
    setLoading(true);
    try {
      const [customersRes, lookupsRes] = await Promise.all([
        api.get('/customers', { params: { search, all: 1, source: sourceTab } }),
        api.get('/lookups'),
      ]);
      setRows(customersRes.data.data.rows);
      setCurrencies(lookupsRes.data.data.currencies || []);
      setError('');
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [search, sourceTab]);

  useEffect(() => {
    const h = () => load();
    window.addEventListener('zarin:customers:changed', h);
    return () => window.removeEventListener('zarin:customers:changed', h);
  }, [search, sourceTab]);

  useEffect(() => () => {
    if (avatarPreview && avatarPreview.startsWith('blob:')) {
      URL.revokeObjectURL(avatarPreview);
    }
  }, [avatarPreview]);

  const resetAvatarState = () => {
    if (avatarPreview && avatarPreview.startsWith('blob:')) {
      URL.revokeObjectURL(avatarPreview);
    }
    setAvatarFile(null);
    setAvatarPreview('');
    setRemoveAvatar(false);
  };

  const openCreate = () => {
    setSourceTab('manual');
    setEditing(null);
    setOpeningLocked(false);
    resetAvatarState();
    const baseCurrency = currencies.find((c) => c.isBase) || currencies[0];
    setForm({
      ...initial,
      openingBalances: [{
        currencyId: baseCurrency ? String(baseCurrency.id) : '',
        amount: '',
        side: 'creditor',
      }],
    });
    setModal(true);
  };

  const openEdit = async (r) => {
    setEditing(r);
    resetAvatarState();
    setOpeningLocked(false);
    setForm({
      name: r.name || '',
      fatherName: r.fatherName || '',
      phone: r.phone === 'بدون‌شماره' ? '' : (r.phone || ''),
      whatsappPhone: r.whatsappPhone || '',
      address: r.address || '',
      documentType: r.documentType || '',
      documentNumber: r.documentNumber || '',
      trustLevel: r.trustLevel || 'عادی',
      state: r.state || 'تأیید شده',
      openingBalances: [emptyOpeningRow()],
    });
    setModal(true);
    try {
      const { data } = await api.get(`/customers/${r.id}/opening-balances`);
      const openings = data.data?.openings || [];
      const balances = data.data?.balances || [];
      const balanceByCurrency = Object.fromEntries(
        balances.map((b) => [String(b.currencyId || b.currency?.id), Number(b.amount || 0)]),
      );
      setOpeningLocked(data.data?.editable === false);
      if (openings.length) {
        setForm((prev) => ({
          ...prev,
          openingBalances: openings.map((e) => {
            const currencyId = String(e.currencyId || e.currency?.id || '');
            const bal = balanceByCurrency[currencyId];
            const note = String(e.note || '');
            let side = 'creditor';
            if (note.includes('قرضدار') || (Number.isFinite(bal) && bal < 0)) side = 'debtor';
            else if (note.includes('طلبکار') || (Number.isFinite(bal) && bal > 0)) side = 'creditor';
            return {
              currencyId,
              amount: String(Math.abs(Number(e.amount || 0)) || ''),
              side,
            };
          }),
        }));
      } else {
        const baseCurrency = currencies.find((c) => c.isBase) || currencies[0];
        setForm((prev) => ({
          ...prev,
          openingBalances: [{
            currencyId: baseCurrency ? String(baseCurrency.id) : '',
            amount: '',
            side: 'creditor',
          }],
        }));
      }
    } catch {
      setOpeningLocked(true);
    }
  };

  const onAvatarChange = (e) => {
    const file = e.target.files?.[0] || null;
    setRemoveAvatar(false);
    setAvatarFile(file);
    if (avatarPreview && avatarPreview.startsWith('blob:')) {
      URL.revokeObjectURL(avatarPreview);
    }
    setAvatarPreview(file ? URL.createObjectURL(file) : '');
  };

  const updateOpeningRow = (index, patch) => {
    setForm((prev) => ({
      ...prev,
      openingBalances: prev.openingBalances.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    }));
  };

  const addOpeningRow = () => {
    setForm((prev) => ({
      ...prev,
      openingBalances: [...prev.openingBalances, emptyOpeningRow()],
    }));
  };

  const removeOpeningRow = (index) => {
    setForm((prev) => ({
      ...prev,
      openingBalances: prev.openingBalances.length > 1
        ? prev.openingBalances.filter((_, i) => i !== index)
        : [emptyOpeningRow()],
    }));
  };

  const openLinkModal = (viewPath, viewUrl) => {
    setCreatedLinks(buildPortalLinkPair(viewPath, viewUrl));
  };

  const copyText = async (url) => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      show(t('linkCopied'));
    } catch {
      show(t('error'), 'error');
    }
  };

  const copyPortalLink = async (customerId) => {
    try {
      const { data } = await api.get(`/customers/${customerId}/portal-link`);
      openLinkModal(data.data.viewPath, data.data.viewUrl);
    } catch (err) {
      show(messageOf(err), 'error');
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      let saved;
      if (editing) {
        const openingBalances = openingLocked
          ? undefined
          : form.openingBalances
            .filter((row) => Number(row.amount) > 0 && row.currencyId)
            .map((row) => ({
              currencyId: Number(row.currencyId),
              amount: Number(row.amount),
              side: row.side,
            }));
        const payload = {
          name: form.name,
          fatherName: form.fatherName || null,
          phone: form.phone,
          whatsappPhone: form.whatsappPhone,
          address: form.address || null,
          documentType: form.documentType || null,
          documentNumber: form.documentNumber || null,
          trustLevel: form.trustLevel,
          state: form.state,
        };
        if (openingBalances !== undefined) payload.openingBalances = openingBalances;
        const { data } = await api.put(`/customers/${editing.id}`, payload);
        saved = data.data;
        show(t('success'));
      } else {
        const openingBalances = form.openingBalances
          .filter((row) => Number(row.amount) > 0 && row.currencyId)
          .map((row) => ({
            currencyId: Number(row.currencyId),
            amount: Number(row.amount),
            side: row.side,
          }));
        const { data } = await api.post('/customers', {
          name: form.name,
          fatherName: form.fatherName || null,
          phone: form.phone,
          whatsappPhone: form.whatsappPhone,
          address: form.address || null,
          documentType: form.documentType || null,
          documentNumber: form.documentNumber || null,
          trustLevel: form.trustLevel,
          state: form.state,
          openingBalances,
        });
        saved = data.data;
        const path = data.viewPath || (saved?.viewToken ? `/c/${saved.viewToken}` : '');
        if (hasFeature('customerPortal') && path) {
          openLinkModal(path, data.viewUrl);
          show(t('customerCreatedWithLink'));
        } else {
          show(t('success'));
        }
      }

      if (saved?.id && avatarFile) {
        const body = new FormData();
        body.append('avatar', avatarFile);
        await api.post(`/customers/${saved.id}/avatar`, body);
      } else if (saved?.id && removeAvatar && editing?.avatarUrl) {
        await api.delete(`/customers/${saved.id}/avatar`);
      }

      setModal(false);
      resetAvatarState();
      load();
    } catch (err) {
      show(messageOf(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = (r) => {
    askDelete(r, (row) => api.delete(`/customers/${row.id}`));
  };

  const columns = useMemo(() => [
    {
      key: 'id',
      label: t('customerId'),
      render: (r) => <strong>#{r.id}</strong>,
    },
    {
      key: 'name',
      label: t('name'),
      render: (r) => (
        <div className="staff-name-cell">
          <UserAvatar name={r.name} avatarUrl={r.avatarUrl} size="sm" />
          <div>
            <strong>{localizeValue(t, r.name)}</strong>
            {r.isSystem ? (
              <small className="badge info" style={{ marginInlineStart: 6 }}>
                {t('defaultCustomer') || 'پیش‌فرض'}
              </small>
            ) : (
              <small>{r.fatherName || ''}</small>
            )}
          </div>
        </div>
      ),
    },
    { key: 'phone', label: t('phone'), render: (r) => (r.phone && r.phone !== 'بدون‌شماره' ? r.phone : '—') },
    { key: 'whatsappPhone', label: t('customerWhatsapp'), render: (r) => r.whatsappPhone || '—' },
    {
      key: 'documentNumber',
      label: t('documentNumber'),
      render: (r) => r.documentNumber || '—',
    },
    {
      key: 'trustLevel',
      label: t('trustLevel'),
      render: (r) => localizeValue(t, r.trustLevel),
    },
    {
      key: 'state',
      label: t('status'),
      render: (r) => (
        <StatusBadge active={!String(r.state || '').includes('غیر')}>
          {localizeValue(t, r.state)}
        </StatusBadge>
      ),
    },
    {
      key: 'actions',
      label: t('actions'),
      render: (r) => (
        <div className="row-actions">
          <Link className="icon-btn" to={`/customers/${r.id}/ledger`} title={t('accountLedger')}>
            <WalletCards size={17} />
          </Link>
          {hasFeature('customerPortal') ? (
            <button
              type="button"
              className="icon-btn"
              title={t('copyCustomerLink')}
              onClick={() => copyPortalLink(r.id)}
            >
              <Link2 size={17} />
            </button>
          ) : null}
          <button type="button" className="icon-btn" onClick={() => openEdit(r)}>
            <Pencil size={17} />
          </button>
          {r.isSystem ? null : (
            <button type="button" className="icon-btn danger" onClick={() => remove(r)}>
              <Trash2 size={17} />
            </button>
          )}
        </div>
      ),
    },
  ], [t, hasFeature]);

  return (
    <>
      <PageHeader
        title={t('customers')}
        actions={sourceTab === 'manual' ? (
          <PrimaryButton onClick={openCreate}>{t('add')}</PrimaryButton>
        ) : null}
      />
      <div className="panel">
        <div className="tabs" style={{ marginBottom: 12 }}>
          <button
            type="button"
            className={sourceTab === 'manual' ? 'active' : ''}
            onClick={() => setSourceTab('manual')}
          >
            {t('myCustomers')}
          </button>
          <button
            type="button"
            className={sourceTab === 'card_reader' ? 'active' : ''}
            onClick={() => setSourceTab('card_reader')}
          >
            {t('cardReaderCustomers')}
          </button>
        </div>
        <SearchBox
          value={search}
          onChange={setSearch}
          onRefresh={load}
        />
        {loading ? <Loading /> : error ? <ErrorBox message={error} /> : (
          <Table rows={rows} columns={columns} />
        )}
      </div>

      <Modal
        open={modal}
        onClose={() => {
          setModal(false);
          resetAvatarState();
        }}
        title={editing ? t('edit') : t('add')}
        wide
      >
        <form className="form-grid" onSubmit={submit}>
          <div className="staff-avatar-field full">
            <UserAvatar
              name={form.name || editing?.name}
              avatarUrl={removeAvatar ? null : (avatarPreview || editing?.avatarUrl)}
              className="large"
            />
            <div>
              <Field label={t('customerPhotoOptional')}>
                <input type="file" accept="image/*" onChange={onAvatarChange} />
              </Field>
              <small>{t('profilePhotoHint')}</small>
              {(editing?.avatarUrl || avatarFile) && !removeAvatar ? (
                <button
                  type="button"
                  className="btn tiny soft"
                  onClick={() => {
                    setRemoveAvatar(true);
                    setAvatarFile(null);
                    if (avatarPreview && avatarPreview.startsWith('blob:')) {
                      URL.revokeObjectURL(avatarPreview);
                    }
                    setAvatarPreview('');
                  }}
                >
                  {t('removePhoto')}
                </button>
              ) : null}
            </div>
          </div>
          <Field label={t('name')}>
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label={t('fatherName')}>
            <input value={form.fatherName} onChange={(e) => setForm({ ...form, fatherName: e.target.value })} />
          </Field>
          <Field label={t('phone')}>
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder={t('optional')} />
          </Field>
          <Field label={t('customerWhatsapp')}>
            <input
              required={!(editing && editing.source === 'card_reader')}
              value={form.whatsappPhone}
              onChange={(e) => setForm({ ...form, whatsappPhone: e.target.value })}
              placeholder={t('customerWhatsappHint')}
            />
          </Field>
          <Field label={t('address')}>
            <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </Field>
          <Field label={t('documentType')}>
            <select
              value={form.documentType || ''}
              onChange={(e) => setForm({ ...form, documentType: e.target.value })}
            >
              <option value="">—</option>
              {DOCUMENT_TYPE_OPTIONS.map(([value, key]) => (
                <option key={value} value={value}>{t(key)}</option>
              ))}
            </select>
          </Field>
          <Field label={t('documentNumber')}>
            <input
              value={form.documentNumber}
              onChange={(e) => setForm({ ...form, documentNumber: e.target.value })}
            />
          </Field>
          <Field label={t('trustLevel')}>
            <select
              value={form.trustLevel}
              onChange={(e) => setForm({ ...form, trustLevel: e.target.value })}
            >
              {TRUST_OPTIONS.map(([value, key]) => (
                <option key={value} value={value}>{t(key)}</option>
              ))}
            </select>
          </Field>
          <Field label={t('status')}>
            <select value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })}>
              {CUSTOMER_STATE_OPTIONS.map(([value, key]) => (
                <option key={value} value={value}>{t(key)}</option>
              ))}
            </select>
          </Field>

          <div className="full opening-balances-block">
            <div className="opening-balances-head">
              <div>
                <strong>{t('openingBalance')}</strong>
                <small className="field-hint">
                  {openingLocked ? t('openingBalanceLockedHint') : t('openingBalanceHint')}
                </small>
              </div>
              {!openingLocked ? (
                <button type="button" className="btn soft tiny" onClick={addOpeningRow}>
                  <Plus size={15} />
                  {t('addOpeningBalanceRow')}
                </button>
              ) : null}
            </div>
            {form.openingBalances.map((row, index) => (
              <div className="opening-balance-row" key={`opening-${index}`}>
                <Field label={t('currency')}>
                  <select
                    value={row.currencyId}
                    disabled={openingLocked}
                    onChange={(e) => updateOpeningRow(index, { currencyId: e.target.value })}
                  >
                    <option value="">{t('selectCurrency')}</option>
                    {currencies.map((c) => (
                      <option key={c.id} value={c.id}>{c.code} — {localizeCurrency(t, c)}</option>
                    ))}
                  </select>
                </Field>
                <Field label={t('amount')}>
                  <input
                    type="text"
                    inputMode="decimal"
                    dir="ltr"
                    lang="en"
                    autoComplete="off"
                    className="amount-input"
                    value={row.amount}
                    disabled={openingLocked}
                    onChange={(e) => updateOpeningRow(index, { amount: normalizeAmountInput(e.target.value) })}
                    placeholder="0"
                  />
                </Field>
                <Field label={t('accountSide')}>
                  <select
                    value={row.side}
                    disabled={openingLocked}
                    onChange={(e) => updateOpeningRow(index, { side: e.target.value })}
                  >
                    <option value="creditor">{t('creditor')}</option>
                    <option value="debtor">{t('debtor')}</option>
                  </select>
                </Field>
                {!openingLocked ? (
                  <button
                    type="button"
                    className="icon-btn danger opening-balance-remove"
                    title={t('delete')}
                    onClick={() => removeOpeningRow(index)}
                  >
                    <X size={17} />
                  </button>
                ) : null}
              </div>
            ))}
          </div>

          <div className="form-actions full">
            <button className="btn soft" type="button" onClick={() => { setModal(false); resetAvatarState(); }}>{t('cancel')}</button>
            <button className="btn primary" disabled={saving}>{saving ? t('loading') : t('save')}</button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(createdLinks.local || createdLinks.online)}
        onClose={() => setCreatedLinks({ online: '', local: '' })}
        title={t('customerLink')}
      >
        <p className="field-hint">{t('customerLinkHint')}</p>
        {createdLinks.online ? (
          <Field label={t('onlineLink')} className="full">
            <div className="link-copy-row">
              <input readOnly value={createdLinks.online} onFocus={(e) => e.target.select()} />
              <button type="button" className="btn soft" onClick={() => copyText(createdLinks.online)}>
                {t('copy')}
              </button>
            </div>
          </Field>
        ) : (
          <p className="full field-hint">{t('publicAppUrlRequired')}</p>
        )}
        <Field label={t('localLink')} className="full">
          <div className="link-copy-row">
            <input readOnly value={createdLinks.local} onFocus={(e) => e.target.select()} />
            <button type="button" className="btn soft" onClick={() => copyText(createdLinks.local)}>
              {t('copy')}
            </button>
          </div>
        </Field>
        <div className="form-actions full">
          <button
            type="button"
            className="btn primary"
            onClick={() => setCreatedLinks({ online: '', local: '' })}
          >
            {t('close')}
          </button>
        </div>
      </Modal>

      {deleteDialog}
    </>
  );
}
