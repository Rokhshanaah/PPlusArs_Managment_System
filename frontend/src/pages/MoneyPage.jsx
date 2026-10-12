import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Calculator, ReceiptText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api, messageOf } from '../api/client.js';
import { ErrorBox, Field, Loading, PageHeader } from '../components/Common.jsx';
import SearchableSelect from '../components/SearchableSelect.jsx';
import OnlineRatesPanel from '../components/OnlineRatesPanel.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { money } from '../utils/format.js';
import { localizeCurrency, localizeValue } from '../utils/labels.js';
import { openCustomerWhatsapp } from '../utils/whatsapp.js';

function balanceOf(cashbox, currencyId) {
  if (!cashbox || !currencyId) return 0;
  const row = (cashbox.balances || []).find((b) => Number(b.currencyId) === Number(currencyId));
  return Number(row?.amount || 0);
}

/** Prefer cashbox that already has the pay currency (toCurrency). */
function pickCashbox(cashboxes, payCurrencyId, preferredId) {
  if (!cashboxes?.length) return null;
  if (preferredId) {
    const current = cashboxes.find((c) => String(c.id) === String(preferredId));
    if (current && balanceOf(current, payCurrencyId) > 0) return current;
  }
  const ranked = [...cashboxes].sort(
    (a, b) => balanceOf(b, payCurrencyId) - balanceOf(a, payCurrencyId),
  );
  return ranked[0] || cashboxes[0];
}

export default function MoneyPage({ kind }) {
  const { t } = useTranslation();
  const { show } = useToast();
  const isExchange = kind === 'exchange';
  const [lookups, setLookups] = useState(null);
  const [balanceCustomers, setBalanceCustomers] = useState([]);
  const [mode, setMode] = useState('cashbox');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [calculated, setCalculated] = useState(null);
  const [created, setCreated] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
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
  });

  const isBuySell = kind === 'buy' || kind === 'sell';
  const showRateField = !isBuySell || lookups?.tradeShowRateField !== false;

  const loadLookups = async () => {
    setLoading(true);
    try {
      const requests = [api.get('/lookups')];
      if (isExchange) requests.push(api.get('/customers-with-balances'));
      const results = await Promise.all(requests);
      const l = results[0].data.data;
      setLookups(l);
      if (isExchange) setBalanceCustomers(results[1].data.data || []);

      const afn = l.currencies.find((c) => c.code === 'AFN');
      const foreign = l.currencies.find((c) => c.code === 'USD') || l.currencies.find((c) => c.id !== afn?.id);
      const fromCurrencyId = String(kind === 'sell' ? afn?.id || '' : foreign?.id || '');
      const toCurrencyId = String(kind === 'sell' ? foreign?.id || '' : afn?.id || '');

      // Prefer branch/cashbox that holds the currency we will PAY out
      const allBoxes = l.cashboxes || [];
      const bestOverall = pickCashbox(allBoxes, toCurrencyId);
      const branchId = bestOverall?.branchId
        ? String(bestOverall.branchId)
        : (l.branches[0] ? String(l.branches[0].id) : '');
      const branchBoxes = allBoxes.filter((c) => String(c.branchId) === branchId);
      const bestBox = pickCashbox(branchBoxes, toCurrencyId) || bestOverall;

      setForm((f) => ({
        ...f,
        branchId,
        cashboxId: bestBox ? String(bestBox.id) : '',
        fromCurrencyId,
        toCurrencyId,
      }));
      setError('');
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLookups();
  }, [kind]);

  useEffect(() => {
    const reload = () => {
      api.get('/lookups').then(({ data }) => setLookups(data.data)).catch(() => {});
    };
    window.addEventListener('zarin:settings:changed', reload);
    return () => window.removeEventListener('zarin:settings:changed', reload);
  }, []);

  useEffect(() => {
    if (!isExchange) return undefined;
    const h = () => {
      api.get('/customers-with-balances').then(({ data }) => setBalanceCustomers(data.data || [])).catch(() => {});
    };
    window.addEventListener('zarin:accounts:changed', h);
    window.addEventListener('zarin:customers:changed', h);
    return () => {
      window.removeEventListener('zarin:accounts:changed', h);
      window.removeEventListener('zarin:customers:changed', h);
    };
  }, [isExchange]);

  const balanceMode = isExchange && mode === 'balance';
  const branchCashboxes = useMemo(
    () => lookups?.cashboxes.filter((c) => String(c.branchId) === String(form.branchId)) || [],
    [lookups, form.branchId],
  );
  const selectedFrom = lookups?.currencies.find((c) => String(c.id) === String(form.fromCurrencyId));
  const selectedTo = lookups?.currencies.find((c) => String(c.id) === String(form.toCurrencyId));
  const selectedCashbox = lookups?.cashboxes.find((c) => String(c.id) === String(form.cashboxId));
  const cashboxPayBalance = balanceOf(selectedCashbox, form.toCurrencyId);
  const selectedBalanceCustomer = balanceCustomers.find((c) => String(c.id) === String(form.customerId));
  const availableFromBalance = selectedBalanceCustomer?.balances?.find(
    (b) => String(b.currencyId) === String(form.fromCurrencyId),
  );
  const availableAmount = Number(availableFromBalance?.amount || 0);

  // When pay currency or branch changes, switch to a cashbox that actually has that currency
  useEffect(() => {
    if (balanceMode || !lookups || !form.toCurrencyId || !form.branchId) return;
    const boxes = lookups.cashboxes.filter((c) => String(c.branchId) === String(form.branchId));
    const best = pickCashbox(boxes, form.toCurrencyId, form.cashboxId);
    if (best && String(best.id) !== String(form.cashboxId)) {
      setForm((f) => ({ ...f, cashboxId: String(best.id) }));
    }
  }, [balanceMode, lookups, form.branchId, form.toCurrencyId]);

  const autoRate = async (next = form) => {
    if (!next.fromCurrencyId || !next.toCurrencyId) return;
    try {
      const { data } = await api.get('/transactions/rate', {
        params: {
          fromCurrencyId: next.fromCurrencyId,
          toCurrencyId: next.toCurrencyId,
          branchId: next.branchId || undefined,
          kind,
        },
      });
      if (data.data.rate) setForm((f) => ({ ...f, rate: String(data.data.rate) }));
    } catch {
      /* keep manual rate */
    }
  };

  useEffect(() => {
    if (!showRateField || balanceMode) return undefined;
    if (form.fromCurrencyId && form.toCurrencyId) autoRate();
    return undefined;
  }, [form.fromCurrencyId, form.toCurrencyId, form.branchId, kind, showRateField, balanceMode]);

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (!form.fromAmount || !form.fromCurrencyId || !form.toCurrencyId) {
        setCalculated(null);
        return;
      }
      if (!showRateField && !balanceMode) {
        const direct = Number(form.toAmount);
        setCalculated(direct > 0 ? String(direct) : null);
        return;
      }
      if (!form.rate) {
        setCalculated(null);
        return;
      }
      try {
        const { data } = await api.post('/transactions/calculate', {
          fromCurrencyId: Number(form.fromCurrencyId),
          toCurrencyId: Number(form.toCurrencyId),
          fromAmount: Number(form.fromAmount),
          rate: Number(form.rate),
          fee: Number(form.fee || 0),
        });
        setCalculated(data.data.toAmount);
      } catch {
        setCalculated(null);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [form.fromAmount, form.toAmount, form.rate, form.fee, form.fromCurrencyId, form.toCurrencyId, showRateField, balanceMode]);

  const set = (key, value) => {
    setCreated(null);
    setForm((f) => {
      const next = {
        ...f,
        [key]: value,
        ...(key === 'branchId' ? { cashboxId: '' } : {}),
        ...(key === 'customerId' && balanceMode ? { fromAmount: '' } : {}),
      };
      if (key === 'branchId' && lookups) {
        const boxes = lookups.cashboxes.filter((c) => String(c.branchId) === String(value));
        const best = pickCashbox(boxes, next.toCurrencyId);
        next.cashboxId = best ? String(best.id) : '';
      }
      return next;
    });
  };

  const switchMode = (next) => {
    setMode(next);
    setCreated(null);
    setForm((f) => ({ ...f, customerId: '', fromAmount: '', note: '' }));
  };

  const translateMoneyError = (raw) => {
    const text = String(raw || '');
    if (text.includes('موجودی صندوق کافی نیست')) {
      const match = text.match(/موجودی\s+([A-Z]+):\s*([\d.]+)/i);
      if (match) return `${t('insufficientCashboxBalance')} ${match[1]}: ${money(match[2])}`;
      return t('insufficientCashboxBalance');
    }
    return text;
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (balanceMode) {
        if (!form.customerId) throw new Error(t('selectCustomer'));
        if (availableAmount <= 0) throw new Error(t('noConvertibleBalance'));
        if (Number(form.fromAmount) > availableAmount) {
          throw new Error(`${t('insufficientCustomerBalance')} ${money(availableAmount)} ${selectedFrom?.code || ''}`);
        }
        const { data } = await api.post(`/customers/${form.customerId}/convert-balance`, {
          fromCurrencyId: Number(form.fromCurrencyId),
          toCurrencyId: Number(form.toCurrencyId),
          fromAmount: Number(form.fromAmount),
          rate: Number(form.rate),
          fee: Number(form.fee || 0),
          note: form.note || null,
        });
        setCreated({ number: data.data.number, id: null, balanceConvert: true });
        show(data.message);
        openCustomerWhatsapp(data.data?.whatsapp);
        const refreshed = await api.get('/customers-with-balances');
        setBalanceCustomers(refreshed.data.data || []);
        setForm((f) => ({ ...f, fromAmount: '', toAmount: '', fee: '0', note: '' }));
        setCalculated(null);
      } else {
        if (calculated != null && Number(calculated) > cashboxPayBalance) {
          throw new Error(
            `${t('insufficientCashboxBalance')} ${selectedTo?.code || ''}: ${money(cashboxPayBalance)}. ${t('pickCashboxWithBalance')}`,
          );
        }
        const payload = {
          kind,
          customerId: form.customerId ? Number(form.customerId) : null,
          branchId: Number(form.branchId),
          cashboxId: Number(form.cashboxId),
          fromCurrencyId: Number(form.fromCurrencyId),
          toCurrencyId: Number(form.toCurrencyId),
          fromAmount: Number(form.fromAmount),
          fee: showRateField ? Number(form.fee || 0) : 0,
          note: form.note || null,
        };
        if (showRateField) {
          payload.rate = Number(form.rate);
        } else {
          payload.toAmount = Number(form.toAmount);
        }
        const { data } = await api.post('/transactions', payload);
        setCreated(data.data);
        show(data.message);
        openCustomerWhatsapp(data.data?.whatsapp);
        await loadLookups();
        setForm((f) => ({ ...f, fromAmount: '', toAmount: '', fee: '0', note: '' }));
        setCalculated(null);
      }
    } catch (err) {
      const raw = err?.response ? messageOf(err) : (err.message || messageOf(err));
      show(translateMoneyError(raw), 'error');
    } finally {
      setSaving(false);
    }
  };

  const customerList = balanceMode ? balanceCustomers : lookups?.customers;
  const customerSelectOptions = useMemo(
    () => (customerList || []).map((c) => ({
      value: String(c.id),
      label: `#${c.id} — ${localizeValue(t, c.name)} — ${c.phone || ''}${
        balanceMode && c.balances?.length
          ? ` (${c.balances.map((b) => `${b.currency?.code}: ${money(b.amount)}`).join(' · ')})`
          : ''
      }`,
      searchText: `${c.id} ${c.name} ${c.phone || ''}`,
    })),
    [customerList, balanceMode, t],
  );

  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} />;

  return (
    <>
      <PageHeader
        title={t(kind)}
        subtitle={balanceMode ? t('balanceConvertHint') : `${t('fromCurrency')} → ${t('toCurrency')}`}
      />

      {isExchange && (
        <div className="mode-switch" role="tablist">
          <button
            type="button"
            className={mode === 'cashbox' ? 'active' : ''}
            onClick={() => switchMode('cashbox')}
          >
            {t('cashbox')}
          </button>
          <button
            type="button"
            className={mode === 'balance' ? 'active' : ''}
            onClick={() => switchMode('balance')}
          >
            {t('balanceStock')}
          </button>
        </div>
      )}

      <div className="content-grid money-layout">
        <aside className="calculation-card">
          <span>{t('calculatedAmount')}</span>
          <strong>
            {calculated !== null ? money(calculated) : '—'}{' '}
            <small>{selectedTo?.code || ''}</small>
          </strong>
          <div className="formula">
            {showRateField || balanceMode ? (
              <>
                {form.fromAmount || 0} {selectedFrom?.code || ''} ×/÷ {form.rate || 0} − {form.fee || 0} {selectedTo?.code || ''}
              </>
            ) : (
              <>
                {form.fromAmount || 0} {selectedFrom?.code || ''} → {form.toAmount || 0} {selectedTo?.code || ''}
              </>
            )}
          </div>
          {!balanceMode && (
            <p className={`balance-mode-note ${calculated != null && Number(calculated) > cashboxPayBalance ? 'warn' : ''}`}>
              {t('cashboxPayBalance')}: {money(cashboxPayBalance)} {selectedTo?.code || ''}
            </p>
          )}
          {balanceMode && (
            <p className="balance-mode-note">{t('balanceConvertNoCashbox')}</p>
          )}
          {created && (
            <div className="success-card">
              <strong>{created.number}</strong>
              <span>{t('success')}</span>
              {created.id ? (
                <Link className="btn primary" to={`/transactions/${created.id}/receipt`}>
                  <ReceiptText size={17} />
                  {t('receipt')}
                </Link>
              ) : created.balanceConvert && form.customerId ? (
                <Link className="btn primary" to={`/customers/${form.customerId}/ledger`}>
                  <ReceiptText size={17} />
                  {t('accountLedger')}
                </Link>
              ) : null}
            </div>
          )}
        </aside>

        <section className="panel">
          <form className="form-grid" onSubmit={submit}>
            <Field label={t('customer')} className="full">
              <SearchableSelect
                required={balanceMode}
                value={form.customerId}
                onChange={(customerId) => set('customerId', customerId)}
                options={customerSelectOptions}
                emptyLabel={balanceMode ? t('selectCustomer') : t('optional')}
              />
            </Field>

            {balanceMode && selectedBalanceCustomer && (
              <div className="customer-balance-chips full">
                {selectedBalanceCustomer.balances.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    className={`badge info balance-chip ${String(b.currencyId) === String(form.fromCurrencyId) ? 'selected' : ''}`}
                    onClick={() => set('fromCurrencyId', String(b.currencyId))}
                  >
                    {b.currency?.code}: {money(b.amount)}
                  </button>
                ))}
              </div>
            )}

            {!balanceMode && (
              <>
                <Field label={t('branch')}>
                  <select required value={form.branchId} onChange={(e) => set('branchId', e.target.value)}>
                    <option value="">{t('selectBranch')}</option>
                    {lookups.branches.map((b) => (
                      <option key={b.id} value={b.id}>{localizeValue(t, b.name)}</option>
                    ))}
                  </select>
                </Field>
                <Field label={t('cashbox')}>
                  <select required value={form.cashboxId} onChange={(e) => set('cashboxId', e.target.value)}>
                    <option value="">{t('selectCashbox')}</option>
                    {branchCashboxes.map((c) => {
                      const payBal = balanceOf(c, form.toCurrencyId);
                      const code = selectedTo?.code || '';
                      return (
                        <option key={c.id} value={c.id}>
                          {localizeValue(t, c.name)}
                          {code ? ` — ${code}: ${money(payBal)}` : ''}
                        </option>
                      );
                    })}
                  </select>
                  <small className={`field-hint ${cashboxPayBalance <= 0 ? 'warn' : ''}`}>
                    {t('cashboxPayBalance')}: {money(cashboxPayBalance)} {selectedTo?.code || ''}
                    {cashboxPayBalance <= 0 ? ` — ${t('pickCashboxWithBalance')}` : ''}
                  </small>
                </Field>
              </>
            )}

            <Field label={t('fromCurrency')}>
              <select required value={form.fromCurrencyId} onChange={(e) => set('fromCurrencyId', e.target.value)}>
                <option value="">{t('selectCurrency')}</option>
                {(balanceMode
                  ? lookups.currencies.filter((c) => selectedBalanceCustomer?.balances?.some((b) => Number(b.currencyId) === Number(c.id) && Number(b.amount) > 0))
                  : lookups.currencies
                ).map((c) => (
                  <option key={c.id} value={c.id}>{c.code} — {localizeCurrency(t, c)}</option>
                ))}
              </select>
            </Field>
            <Field label={t('toCurrency')}>
              <select required value={form.toCurrencyId} onChange={(e) => set('toCurrencyId', e.target.value)}>
                <option value="">{t('selectCurrency')}</option>
                {lookups.currencies.map((c) => (
                  <option key={c.id} value={c.id}>{c.code} — {localizeCurrency(t, c)}</option>
                ))}
              </select>
            </Field>

            <Field label={`${t('fromAmount')} (${selectedFrom?.code || ''})`}>
              <input
                required
                type="number"
                min="0.000001"
                max={balanceMode && availableAmount > 0 ? availableAmount : undefined}
                step="any"
                value={form.fromAmount}
                onChange={(e) => set('fromAmount', e.target.value)}
              />
              {balanceMode && (
                <small className="field-hint">
                  {t('availableBalance')}: {money(availableAmount)} {selectedFrom?.code || ''}
                </small>
              )}
            </Field>
            {showRateField || balanceMode ? (
              <Field label={t('rate')}>
                <div className="input-action">
                  <input
                    required
                    type="number"
                    min="0.00000001"
                    step="any"
                    value={form.rate}
                    onChange={(e) => set('rate', e.target.value)}
                  />
                  <button type="button" className="icon-btn" onClick={() => autoRate()}>
                    <Calculator size={18} />
                  </button>
                </div>
              </Field>
            ) : (
              <Field label={`${t('toAmount')} (${selectedTo?.code || ''})`}>
                <input
                  required
                  type="number"
                  min="0.000001"
                  step="any"
                  value={form.toAmount}
                  onChange={(e) => set('toAmount', e.target.value)}
                />
                <small className="field-hint">{t('tradeDirectAmountHint')}</small>
              </Field>
            )}
            {(showRateField || balanceMode) && (
              <Field label={`${t('fee')}${selectedTo?.code ? ` (${selectedTo.code})` : ''}`}>
                <input type="number" min="0" step="any" value={form.fee} onChange={(e) => set('fee', e.target.value)} />
              </Field>
            )}
            <Field label={t('note')}>
              <input value={form.note} onChange={(e) => set('note', e.target.value)} />
            </Field>
            <div className="form-actions full">
              <button className="btn primary large" disabled={saving}>
                {saving ? t('loading') : (balanceMode ? t('convertBalance') : t('registerTransaction'))}
              </button>
            </div>
          </form>
        </section>

        {!balanceMode && showRateField ? (
          <OnlineRatesPanel
            onUseRate={(code, rateValue, side) => {
              const from = selectedFrom?.code;
              const to = selectedTo?.code;
              if (!from || !to) {
                show(t('selectCurrency'), 'error');
                return;
              }
              if ((from === 'AFN' && to === code) || (to === 'AFN' && from === code)) {
                set('rate', String(rateValue));
                show(`${t('rateApplied')} (${side === 'buy' ? t('buyRate') : t('sellRate')})`);
              } else {
                show(t('ratePairMismatch'), 'error');
              }
            }}
          />
        ) : null}
      </div>
    </>
  );
}
