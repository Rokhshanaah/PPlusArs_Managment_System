import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Link2, MessageCircle, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api, messageOf } from '../api/client.js';
import { ErrorBox, Field, Loading, Modal, PageHeader, SearchBox } from '../components/Common.jsx';
import CustomerLedgerStatement from '../components/CustomerLedgerStatement.jsx';
import { useDeleteConfirm } from '../components/ConfirmDelete.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { money } from '../utils/format.js';
import { localizeCurrency, localizeValue, translatePersonName } from '../utils/labels.js';
import { openCustomerWhatsapp } from '../utils/whatsapp.js';
import { buildPortalLinkPair } from '../utils/portalUrl.js';
import { useCompany } from '../context/CompanyContext.jsx';

function previewSettleAmount(settleCode, payCode, payAmount, rate) {
  const amount = Number(payAmount);
  const r = Number(rate);
  if (!(amount > 0) || !(r > 0)) return null;
  const settleIsAfn = String(settleCode || '').toUpperCase() === 'AFN';
  const payIsAfn = String(payCode || '').toUpperCase() === 'AFN';
  if (settleIsAfn && !payIsAfn) return amount * r;
  return amount / r;
}

export default function CustomerLedgerPage() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const { show } = useToast();
  const { hasFeature } = useCompany();
  const { askDelete, dialog: deleteDialog } = useDeleteConfirm({
    onDeleted: () => load(),
    translateLabel: (row) => row.number || row.type,
  });
  const [data, setData] = useState(null);
  const [lookups, setLookups] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [linkModal, setLinkModal] = useState({ online: '', local: '' });
  const [sendingWhatsapp, setSendingWhatsapp] = useState(false);
  const [form, setForm] = useState({
    type: 'received',
    currencyId: '',
    cashboxId: '',
    amount: '',
    note: '',
    side: 'creditor',
    settleFromCurrencyId: '',
    rate: '',
  });

  const load = async () => {
    setLoading(true);
    try {
      const [a, b] = await Promise.all([
        api.get(`/customers/${id}/ledger`),
        api.get('/lookups'),
      ]);
      setData(a.data.data);
      setLookups(b.data.data);
      setError('');
      if (!form.currencyId && b.data.data.currencies[0]) {
        setForm((f) => ({
          ...f,
          currencyId: String(b.data.data.currencies[0].id),
          cashboxId: f.cashboxId || (b.data.data.cashboxes[0] ? String(b.data.data.cashboxes[0].id) : ''),
        }));
      }
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [id]);

  const creditBalances = useMemo(
    () => (data?.balances || []).filter((b) => Number(b.amount) > 0),
    [data],
  );

  const payCurrency = lookups?.currencies?.find((c) => String(c.id) === String(form.currencyId));
  const settleCurrency = lookups?.currencies?.find((c) => String(c.id) === String(form.settleFromCurrencyId));
  const crossSettle = form.type === 'paid'
    && form.settleFromCurrencyId
    && String(form.settleFromCurrencyId) !== String(form.currencyId);

  const settlePreview = crossSettle
    ? previewSettleAmount(settleCurrency?.code, payCurrency?.code, form.amount, form.rate)
    : null;

  const submit = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        type: form.type,
        currencyId: Number(form.currencyId),
        amount: Number(form.amount),
        note: form.note || undefined,
        side: form.type === 'opening' ? form.side : undefined,
      };
      if (form.type !== 'opening') {
        payload.cashboxId = Number(form.cashboxId);
      }
      if (form.type === 'paid' && form.settleFromCurrencyId) {
        payload.settleFromCurrencyId = Number(form.settleFromCurrencyId);
        if (String(form.settleFromCurrencyId) !== String(form.currencyId)) {
          payload.rate = Number(form.rate);
        }
      }
      const { data: res } = await api.post(`/customers/${id}/ledger`, payload);
      show(t('success'));
      openCustomerWhatsapp(res.data?.whatsapp);
      setOpen(false);
      setForm((f) => ({ ...f, amount: '', note: '', settleFromCurrencyId: '', rate: '' }));
      load();
    } catch (err) {
      show(messageOf(err), 'error');
    }
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

  const copyPortalLink = async () => {
    try {
      const { data } = await api.get(`/customers/${id}/portal-link`);
      setLinkModal(buildPortalLinkPair(data.data.viewPath, data.data.viewUrl));
    } catch (err) {
      show(messageOf(err), 'error');
    }
  };

  const sendLedgerWhatsapp = async () => {
    setSendingWhatsapp(true);
    try {
      const { data: res } = await api.post(`/customers/${id}/ledger/whatsapp`);
      const whatsapp = res?.data?.whatsapp;
      if (whatsapp?.link) {
        openCustomerWhatsapp(whatsapp);
        show(t('ledgerWhatsappReady'));
      } else {
        show(t('error'), 'error');
      }
    } catch (err) {
      show(messageOf(err), 'error');
    } finally {
      setSendingWhatsapp(false);
    }
  };

  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} />;

  void i18n.language;

  const customerName = translatePersonName(t, data.customer.name);
  const customerAddress = data.customer.address
    ? localizeValue(t, data.customer.address)
    : '—';

  return (
    <>
      <PageHeader
        title={`${t('accountLedger')} — ${customerName}`}
        subtitle={`#${data.customer.id} • ${data.customer.phone && data.customer.phone !== 'بدون‌شماره' ? data.customer.phone : '—'} • WA: ${data.customer.whatsappPhone || '—'} • ${customerAddress}`}
        actions={(
          <>
            <Link className="btn soft" to="/customers">
              <ArrowLeft size={17} />
              {t('back')}
            </Link>
            {hasFeature('customerPortal') ? (
              <button type="button" className="btn soft" onClick={copyPortalLink}>
                <Link2 size={17} />
                {t('copyCustomerLink')}
              </button>
            ) : null}
            {hasFeature('whatsapp') ? (
              <button
                type="button"
                className="btn soft"
                onClick={sendLedgerWhatsapp}
                disabled={sendingWhatsapp}
                title={t('ledgerWhatsappHint')}
              >
                <MessageCircle size={17} />
                {sendingWhatsapp ? t('accountsReportPreparing') : t('ledgerWhatsapp')}
              </button>
            ) : null}
            <button type="button" className="btn primary" onClick={() => setOpen(true)}>
              <Plus size={17} />
              {t('add')}
            </button>
          </>
        )}
      />

      <div className="balance-cards">
        {data.balances.map((b) => (
          <article key={b.id}>
            <span>{b.currency?.code} — {localizeCurrency(t, b.currency)}</span>
            <strong className={Number(b.amount) > 0 ? 'positive' : Number(b.amount) < 0 ? 'negative' : ''}>
              {money(b.amount)} {b.currency?.symbol}
            </strong>
            <small>
              {Number(b.amount) > 0 ? t('creditor') : Number(b.amount) < 0 ? t('debtor') : t('settled')}
            </small>
          </article>
        ))}
      </div>

      <div className="panel ledger-panel">
        <SearchBox value={search} onChange={setSearch} />
        <CustomerLedgerStatement
          currencyGroups={data.currencyGroups}
          search={search}
          showCashbox
          onDelete={(row) => askDelete(row, () => api.delete(`/customers/${id}/ledger/${row.id}`))}
        />
      </div>

      {deleteDialog}

      <Modal open={open} onClose={() => setOpen(false)} title={t('add')}>
        <form className="form-grid" onSubmit={submit}>
          <Field label={t('state')} className="full">
            <select
              value={form.type}
              onChange={(e) => setForm({
                ...form,
                type: e.target.value,
                settleFromCurrencyId: e.target.value === 'paid' ? form.settleFromCurrencyId : '',
                rate: e.target.value === 'paid' ? form.rate : '',
              })}
            >
              <option value="opening">{t('opening')}</option>
              <option value="received">{t('received')}</option>
              <option value="paid">{t('paid')}</option>
            </select>
          </Field>
          {form.type === 'opening' && (
            <Field label={t('accountSide')}>
              <select value={form.side} onChange={(e) => setForm({ ...form, side: e.target.value })}>
                <option value="creditor">{t('creditor')}</option>
                <option value="debtor">{t('debtor')}</option>
              </select>
            </Field>
          )}
          <Field label={form.type === 'paid' ? t('payCurrencyCash') : t('currency')}>
            <select
              required
              value={form.currencyId}
              onChange={(e) => setForm({ ...form, currencyId: e.target.value })}
            >
              <option value="">{t('selectCurrency')}</option>
              {lookups.currencies.map((c) => (
                <option key={c.id} value={c.id}>{c.code} — {localizeCurrency(t, c)}</option>
              ))}
            </select>
          </Field>
          {form.type !== 'opening' && (
            <Field label={t('cashbox')}>
              <select
                required
                value={form.cashboxId}
                onChange={(e) => setForm({ ...form, cashboxId: e.target.value })}
              >
                <option value="">{t('selectCashbox')}</option>
                {lookups.cashboxes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {localizeValue(t, c.name)} — {localizeValue(t, c.branch?.name)}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label={t('amount')}>
            <input
              required
              min="0.000001"
              step="any"
              type="number"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
            />
          </Field>

          {form.type === 'paid' && (
            <>
              <Field label={t('settleFromAccount')} className="full">
                <select
                  value={form.settleFromCurrencyId}
                  onChange={(e) => setForm({ ...form, settleFromCurrencyId: e.target.value })}
                >
                  <option value="">{t('settleFromSameCurrency')}</option>
                  {creditBalances.map((b) => (
                    <option key={b.id} value={b.currencyId}>
                      {b.currency?.code} — {localizeCurrency(t, b.currency)} ({money(b.amount)} {t('creditor')})
                    </option>
                  ))}
                </select>
              </Field>
              <p className="full settings-danger-text">{t('settleFromHint')}</p>
              {crossSettle && (
                <>
                  <Field label={t('rate')}>
                    <input
                      required
                      min="0.000001"
                      step="any"
                      type="number"
                      value={form.rate}
                      onChange={(e) => setForm({ ...form, rate: e.target.value })}
                      placeholder={t('settleRatePlaceholder')}
                    />
                  </Field>
                  {settlePreview != null && (
                    <Field label={t('settleDeductPreview')}>
                      <input
                        readOnly
                        value={`${money(settlePreview)} ${settleCurrency?.code || ''}`}
                      />
                    </Field>
                  )}
                </>
              )}
            </>
          )}

          <Field label={t('note')}>
            <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </Field>
          <div className="form-actions full">
            <button type="button" className="btn soft" onClick={() => setOpen(false)}>{t('cancel')}</button>
            <button className="btn primary" type="submit">{t('save')}</button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(linkModal.local || linkModal.online)}
        onClose={() => setLinkModal({ online: '', local: '' })}
        title={t('customerLink')}
      >
        <p className="field-hint">{t('customerLinkHint')}</p>
        {linkModal.online ? (
          <Field label={t('onlineLink')} className="full">
            <div className="link-copy-row">
              <input readOnly value={linkModal.online} onFocus={(e) => e.target.select()} />
              <button type="button" className="btn soft" onClick={() => copyText(linkModal.online)}>
                {t('copy')}
              </button>
            </div>
          </Field>
        ) : (
          <p className="full field-hint">{t('publicAppUrlRequired')}</p>
        )}
        <Field label={t('localLink')} className="full">
          <div className="link-copy-row">
            <input readOnly value={linkModal.local} onFocus={(e) => e.target.select()} />
            <button type="button" className="btn soft" onClick={() => copyText(linkModal.local)}>
              {t('copy')}
            </button>
          </div>
        </Field>
        <div className="form-actions full">
          <button
            type="button"
            className="btn primary"
            onClick={() => setLinkModal({ online: '', local: '' })}
          >
            {t('close')}
          </button>
        </div>
      </Modal>
    </>
  );
}
