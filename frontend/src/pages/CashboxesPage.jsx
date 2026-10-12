import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeftRight, Landmark, ListOrdered, Pencil, Scale, Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api, messageOf } from '../api/client.js';
import {
  ErrorBox, Field, Loading, Modal, PageHeader, PrimaryButton, SearchBox, StatusBadge, Table,
} from '../components/Common.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import DateInput from '../components/DateInput.jsx';
import { dateTime, dateOnly, money, BUSINESS_TIMEZONE } from '../utils/format.js';
import { localizeCurrency, localizeValue, translatePersonName } from '../utils/labels.js';
import { useDeleteConfirm } from '../components/ConfirmDelete.jsx';
import { downloadCashboxLedgerPdf } from '../utils/accountsReportPdf.js';

const initial = { branchId: '', name: '', keeperName: '', isActive: true };
const transferInitial = { fromCashboxId: '', toCashboxId: '', currencyId: '', amount: '', note: '' };

const cardTones = ['emerald', 'blue', 'amber', 'cyan', 'purple', 'slate', 'rose'];

function todayIso() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}


function movementSourceLabel(t, source) {
  const map = {
    receipt: 'cashInReceipt',
    payment: 'cashOutPayment',
    card_deposit: 'cashInCardDeposit',
    card_withdrawal: 'cashOutCardWithdrawal',
    buy: 'cashInBuy',
    sell: 'cashInSell',
    exchange: 'cashInExchange',
    remittance_in: 'cashInRemittance',
    remittance_fee: 'cashInRemittanceFee',
    remittance_out: 'cashOutRemittance',
    expense: 'cashOutExpense',
    transfer_in: 'cashInTransfer',
    transfer_out: 'cashOutTransfer',
    adjustment_in: 'cashInAdjustment',
    adjustment_out: 'cashOutAdjustment',
  };
  const key = map[source];
  return key ? t(key) : source;
}

export default function CashboxesPage() {
  const { t } = useTranslation();
  const { show } = useToast();
  const { isBranchScoped, branchId } = useAuth();
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const [lookups, setLookups] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(initial);
  const [adjust, setAdjust] = useState(null);
  const [balanceForm, setBalanceForm] = useState({ currencyId: '', amount: '' });
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferForm, setTransferForm] = useState(transferInitial);
  const [transferSaving, setTransferSaving] = useState(false);
  const [historyBox, setHistoryBox] = useState(null);
  const [historyRows, setHistoryRows] = useState([]);
  const [historySummary, setHistorySummary] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [historyDirection, setHistoryDirection] = useState('all');
  const [historyDates, setHistoryDates] = useState({ dateFrom: '', dateTo: '' });
  const [historyPdfBusy, setHistoryPdfBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [a, b] = await Promise.all([api.get('/cashboxes'), api.get('/lookups')]);
      setRows(a.data.data);
      setLookups(b.data.data);
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

  const defaultBranchId = () => {
    if (isBranchScoped && branchId) return String(branchId);
    return lookups?.branches?.[0] ? String(lookups.branches[0].id) : '';
  };

  const edit = (r) => {
    setEditing(r);
    setForm({
      branchId: String(r.branchId),
      name: r.name,
      keeperName: r.keeperName || '',
      isActive: Boolean(r.isActive),
    });
    setOpen(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    const payload = {
      ...form,
      branchId: Number(isBranchScoped ? branchId : form.branchId),
    };
    try {
      if (editing) await api.put(`/cashboxes/${editing.id}`, payload);
      else await api.post('/cashboxes', payload);
      show(t('success'));
      setOpen(false);
      load();
    } catch (err) {
      show(messageOf(err), 'error');
    }
  };

  const openAdjust = (r) => {
    setAdjust(r);
    const first = lookups.currencies[0];
    setBalanceForm({ currencyId: first ? String(first.id) : '', amount: '' });
  };

  const openTransfer = (fromRow) => {
    const firstCurrency = lookups?.currencies?.[0];
    const other = rows.find((r) => r.id !== fromRow?.id && r.isActive) || rows.find((r) => r.id !== fromRow?.id);
    setTransferForm({
      fromCashboxId: fromRow ? String(fromRow.id) : (rows[0] ? String(rows[0].id) : ''),
      toCashboxId: other ? String(other.id) : '',
      currencyId: firstCurrency ? String(firstCurrency.id) : '',
      amount: '',
      note: '',
    });
    setTransferOpen(true);
  };

  const loadHistory = async (box, direction, dates) => {
    if (!box) return;
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const { data } = await api.get(`/cashboxes/${box.id}/movements`, {
        params: {
          direction,
          limit: 200,
          dateFrom: dates.dateFrom || undefined,
          dateTo: dates.dateTo || undefined,
        },
      });
      setHistoryRows(data.data?.rows || []);
      setHistorySummary(data.data?.byCurrency || []);
    } catch (err) {
      setHistoryRows([]);
      setHistorySummary([]);
      setHistoryError(messageOf(err));
    } finally {
      setHistoryLoading(false);
    }
  };

  const openHistory = (box) => {
    const dates = { dateFrom: todayIso(), dateTo: todayIso() };
    setHistoryBox(box);
    setHistoryDirection('all');
    setHistoryDates(dates);
    loadHistory(box, 'all', dates);
  };

  const changeHistoryDirection = (direction) => {
    if (!historyBox) return;
    setHistoryDirection(direction);
    loadHistory(historyBox, direction, historyDates);
  };

  const changeHistoryDates = (next) => {
    const dates = { ...historyDates, ...next };
    setHistoryDates(dates);
    if (historyBox) loadHistory(historyBox, historyDirection, dates);
  };

  const downloadHistoryPdf = async () => {
    if (!historyBox || historyPdfBusy || historyLoading) return;
    setHistoryPdfBusy(true);
    try {
      const fromLabel = historyDates.dateFrom ? dateOnly(historyDates.dateFrom) : t('all');
      const toLabel = historyDates.dateTo ? dateOnly(historyDates.dateTo) : t('all');
      await downloadCashboxLedgerPdf({
        title: `${t('cashboxLedger')} — ${localizeValue(t, historyBox.name)}`,
        periodLabel: `${t('dateFrom')}: ${fromLabel}  ·  ${t('dateTo')}: ${toLabel}`,
        generatedAt: dateTime(new Date()),
        summary: historySummary,
        rows: historyRows.map((row) => ({
          ...row,
          sourceLabel: movementSourceLabel(t, row.source),
          title: translatePersonName(t, row.title) || row.title,
        })),
        labels: {
          opening: t('cashboxOpeningAtDate'),
          moneyIn: t('cashboxMoneyInTotal'),
          moneyOut: t('cashboxMoneyOutTotal'),
          remaining: t('cashboxRemaining'),
          source: t('cashInSource'),
          person: t('person'),
          amount: t('amount'),
          number: t('number'),
          date: t('date'),
          generatedAt: t('accountsReportGeneratedAt'),
          noData: t('noData'),
        },
      });
      show(t('cashboxLedgerPdfReady'));
    } catch (err) {
      show(messageOf(err), 'error');
    } finally {
      setHistoryPdfBusy(false);
    }
  };

  const saveBalance = async (e) => {
    e.preventDefault();
    try {
      await api.put(`/cashboxes/${adjust.id}/balances/${balanceForm.currencyId}`, {
        amount: Number(balanceForm.amount),
      });
      show(t('success'));
      setAdjust(null);
      load();
    } catch (err) {
      show(messageOf(err), 'error');
    }
  };

  const saveTransfer = async (e) => {
    e.preventDefault();
    setTransferSaving(true);
    try {
      await api.post('/cashboxes/transfer', {
        fromCashboxId: Number(transferForm.fromCashboxId),
        toCashboxId: Number(transferForm.toCashboxId),
        currencyId: Number(transferForm.currencyId),
        amount: Number(transferForm.amount),
        note: transferForm.note || undefined,
      });
      show(t('transferSuccess'));
      setTransferOpen(false);
      load();
    } catch (err) {
      show(messageOf(err), 'error');
    } finally {
      setTransferSaving(false);
    }
  };

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const hay = [r.name, r.keeperName, r.branch?.name].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [rows, search]);

  const selectedOpeningBalance = useMemo(() => {
    if (!adjust || !balanceForm.currencyId) return 0;
    const row = adjust.balances?.find((b) => String(b.currencyId) === String(balanceForm.currencyId));
    return Number(row?.amount || 0);
  }, [adjust, balanceForm.currencyId]);

  const selectedBalanceCurrency = useMemo(() => {
    if (!lookups?.currencies?.length || !balanceForm.currencyId) return null;
    return lookups.currencies.find((c) => String(c.id) === String(balanceForm.currencyId)) || null;
  }, [lookups, balanceForm.currencyId]);

  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} />;

  return (
    <>
      <PageHeader
        title={t('cashboxes')}
        subtitle={t('cashboxMovementsHint')}
        actions={(
          <>
            <button type="button" className="btn soft" onClick={() => openTransfer(rows[0])}>
              <ArrowLeftRight size={17} />
              {t('transferBetweenCashboxes')}
            </button>
            <PrimaryButton
              onClick={() => {
                setEditing(null);
                setForm({ ...initial, branchId: defaultBranchId() });
                setOpen(true);
              }}
            >
              {t('add')}
            </PrimaryButton>
          </>
        )}
      />

      {filteredRows.length ? (
        <section className="cashbox-cards cashbox-summary-cards">
          {filteredRows.map((r, index) => (
            <article
              key={`summary-${r.id}`}
              className={`cashbox-card cashbox-summary-card tone-${cardTones[index % cardTones.length]} ${r.isActive ? '' : 'is-inactive'}`}
            >
              <header className="cashbox-card-head">
                <div className="cashbox-card-icon">
                  <Landmark size={20} />
                </div>
                <div className="cashbox-card-title">
                  <strong>{localizeValue(t, r.name)}</strong>
                  <small>{localizeValue(t, r.branch?.name) || '—'}</small>
                </div>
              </header>
              <div className="summary-chips">
                {r.balances?.length
                  ? r.balances
                    .filter((b) => Number(b.amount || 0) !== 0)
                    .map((b) => (
                      <span key={b.id} className="badge info">
                        {b.currency?.code}: {money(b.amount, b.currency?.decimalPlaces)}
                      </span>
                    ))
                  : null}
                {!r.balances?.some((b) => Number(b.amount || 0) !== 0) ? (
                  <span className="muted-hint">—</span>
                ) : null}
              </div>
            </article>
          ))}
        </section>
      ) : null}

      <div className="panel">
        <SearchBox value={search} onChange={setSearch} onRefresh={load} />
        <Table
          rows={filteredRows}
          columns={[
            {
              key: 'name',
              label: t('name'),
              render: (r) => (
                <div>
                  <strong>{localizeValue(t, r.name)}</strong>
                  <small>{r.keeperName || '—'}</small>
                </div>
              ),
            },
            { key: 'branch', label: t('branch'), render: (r) => localizeValue(t, r.branch?.name) },
            {
              key: 'balances',
              label: t('currencyBalances'),
              render: (r) => (
                <div className="summary-chips">
                  {r.balances?.length
                    ? r.balances.map((b) => (
                      <span key={b.id} className="badge info">
                        {b.currency?.code}: {money(b.amount, b.currency?.decimalPlaces)}
                      </span>
                    ))
                    : '—'}
                </div>
              ),
            },
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
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => openHistory(r)}
                    title={t('cashboxLedger')}
                  >
                    <ListOrdered size={17} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => openTransfer(r)}
                    title={t('transferBetweenCashboxes')}
                  >
                    <ArrowLeftRight size={17} />
                  </button>
                  <button type="button" className="icon-btn" onClick={() => openAdjust(r)} title={t('openingBalance')}>
                    <Scale size={17} />
                  </button>
                  <button type="button" className="icon-btn" onClick={() => edit(r)}>
                    <Pencil size={17} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn danger"
                    onClick={() => askDelete(r, (row) => api.delete(`/cashboxes/${row.id}`))}
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              ),
            },
          ]}
        />
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? t('edit') : t('add')}>
        <form className="form-grid" onSubmit={submit}>
          <Field label={t('branch')}>
            {isBranchScoped ? (
              <input
                readOnly
                value={localizeValue(
                  t,
                  lookups?.branches?.find((b) => String(b.id) === String(branchId))?.name || '',
                )}
              />
            ) : (
              <select
                required
                value={form.branchId}
                onChange={(e) => setForm({ ...form, branchId: e.target.value })}
              >
                <option value="">{t('selectBranch')}</option>
                {lookups?.branches?.map((b) => (
                  <option key={b.id} value={b.id}>{localizeValue(t, b.name)}</option>
                ))}
              </select>
            )}
          </Field>
          <Field label={t('name')}>
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label={t('keeperName')}>
            <input value={form.keeperName} onChange={(e) => setForm({ ...form, keeperName: e.target.value })} />
          </Field>
          <Field label={t('status')}>
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

      <Modal
        open={Boolean(adjust)}
        onClose={() => setAdjust(null)}
        title={`${t('openingBalance')} — ${adjust ? localizeValue(t, adjust.name) : ''}`}
      >
        <form className="form-grid" onSubmit={saveBalance}>
          <Field label={t('currency')}>
            <select
              required
              value={balanceForm.currencyId}
              onChange={(e) => setBalanceForm({ ...balanceForm, currencyId: e.target.value })}
            >
              {lookups?.currencies?.map((c) => (
                <option key={c.id} value={c.id}>{c.code} — {localizeCurrency(t, c)}</option>
              ))}
            </select>
          </Field>
          <Field label={t('currentBalance')}>
            <input
              readOnly
              value={money(
                selectedOpeningBalance,
                selectedBalanceCurrency?.decimalPlaces,
              )}
            />
          </Field>
          <Field label={t('amount')}>
            <input
              required
              type="number"
              step="any"
              min="0.000001"
              value={balanceForm.amount}
              onChange={(e) => setBalanceForm({ ...balanceForm, amount: e.target.value })}
            />
            <small className="field-hint">{t('cashboxOpeningBalanceHint')}</small>
          </Field>
          <div className="form-actions full">
            <button type="button" className="btn soft" onClick={() => setAdjust(null)}>{t('cancel')}</button>
            <button className="btn primary" type="submit">{t('save')}</button>
          </div>
        </form>
      </Modal>

      <Modal
        open={transferOpen}
        onClose={() => setTransferOpen(false)}
        title={t('transferBetweenCashboxes')}
      >
        <form className="form-grid" onSubmit={saveTransfer}>
          <Field label={t('fromCashbox')}>
            <select
              required
              value={transferForm.fromCashboxId}
              onChange={(e) => setTransferForm({ ...transferForm, fromCashboxId: e.target.value })}
            >
              <option value="">{t('selectCashbox')}</option>
              {rows.filter((r) => r.isActive).map((c) => (
                <option key={c.id} value={c.id}>
                  {localizeValue(t, c.name)} — {localizeValue(t, c.branch?.name)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('toCashbox')}>
            <select
              required
              value={transferForm.toCashboxId}
              onChange={(e) => setTransferForm({ ...transferForm, toCashboxId: e.target.value })}
            >
              <option value="">{t('selectCashbox')}</option>
              {rows.filter((r) => r.isActive && String(r.id) !== String(transferForm.fromCashboxId)).map((c) => (
                <option key={c.id} value={c.id}>
                  {localizeValue(t, c.name)} — {localizeValue(t, c.branch?.name)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('currency')}>
            <select
              required
              value={transferForm.currencyId}
              onChange={(e) => setTransferForm({ ...transferForm, currencyId: e.target.value })}
            >
              <option value="">{t('selectCurrency')}</option>
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
          <Field label={t('note')} className="full">
            <input
              value={transferForm.note}
              onChange={(e) => setTransferForm({ ...transferForm, note: e.target.value })}
              placeholder={t('optional')}
            />
          </Field>
          <div className="form-actions full">
            <button type="button" className="btn soft" onClick={() => setTransferOpen(false)}>{t('cancel')}</button>
            <button className="btn primary" type="submit" disabled={transferSaving}>
              {transferSaving ? t('loading') : t('save')}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(historyBox)}
        onClose={() => {
          setHistoryBox(null);
          setHistoryRows([]);
          setHistorySummary([]);
          setHistoryError('');
        }}
        title={`${t('cashboxLedger')} — ${historyBox ? localizeValue(t, historyBox.name) : ''}`}
        wide
      >
        <p className="muted-hint" style={{ marginTop: 0 }}>{t('cashboxLedgerHint')}</p>
        <div className="form-grid inline report-filters" style={{ marginBottom: 12 }}>
          <Field label={t('dateFrom')}>
            <DateInput
              value={historyDates.dateFrom}
              onChange={(dateFrom) => changeHistoryDates({ dateFrom })}
            />
          </Field>
          <Field label={t('dateTo')}>
            <DateInput
              value={historyDates.dateTo}
              onChange={(dateTo) => changeHistoryDates({ dateTo })}
            />
          </Field>
          <div className="field" style={{ alignSelf: 'end' }}>
            <button
              type="button"
              className="btn soft"
              disabled={historyPdfBusy || historyLoading}
              onClick={downloadHistoryPdf}
            >
              {historyPdfBusy ? t('accountsReportPreparing') : t('cashboxLedgerPdf')}
            </button>
          </div>
        </div>
        {!historyLoading && !historyError && historySummary.length ? (
          <div className="cashbox-ledger-summary">
            {historySummary.map((row) => (
              <div key={row.currencyId || row.code} className="cashbox-ledger-currency">
                <h4>{row.code}{row.symbol ? ` ${row.symbol}` : ''}</h4>
                <div className="cashbox-ledger-stats">
                  <div className="cashbox-ledger-stat opening">
                    <small>{t('cashboxOpeningAtDate')}</small>
                    <strong>{money(row.opening)} {row.code}</strong>
                  </div>
                  <div className="cashbox-ledger-stat money-in">
                    <small>{t('cashboxMoneyInTotal')}</small>
                    <strong className="positive">+{money(row.totalIn)} {row.code}</strong>
                  </div>
                  <div className="cashbox-ledger-stat money-out">
                    <small>{t('cashboxMoneyOutTotal')}</small>
                    <strong className="negative">−{money(row.totalOut)} {row.code}</strong>
                  </div>
                  <div className="cashbox-ledger-stat remaining">
                    <small>{t('cashboxRemaining')}</small>
                    <strong>{money(row.remaining)} {row.code}</strong>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : null}
        <div className="tabs" style={{ marginBottom: 12 }}>
          <button
            type="button"
            className={`tab ${historyDirection === 'all' ? 'active' : ''}`}
            onClick={() => changeHistoryDirection('all')}
          >
            {t('all')}
          </button>
          <button
            type="button"
            className={`tab ${historyDirection === 'in' ? 'active' : ''}`}
            onClick={() => changeHistoryDirection('in')}
          >
            {t('cashboxMoneyIn')}
          </button>
          <button
            type="button"
            className={`tab ${historyDirection === 'out' ? 'active' : ''}`}
            onClick={() => changeHistoryDirection('out')}
          >
            {t('cashboxMoneyOut')}
          </button>
        </div>
        {historyLoading ? <Loading /> : historyError ? <ErrorBox message={historyError} /> : (
          <Table
            rows={historyRows}
            columns={[
              {
                key: 'source',
                label: t('cashInSource'),
                render: (r) => (
                  <span className={`badge ${r.direction === 'in' ? 'success' : 'muted'}`}>
                    {movementSourceLabel(t, r.source)}
                  </span>
                ),
              },
              {
                key: 'title',
                label: t('person'),
                render: (r) => translatePersonName(t, r.title) || r.title || '—',
              },
              {
                key: 'amount',
                label: t('amount'),
                render: (r) => (
                  <strong className={r.direction === 'in' ? 'text-in' : 'text-out'}>
                    {r.direction === 'in' ? '+' : '−'}{money(r.amount)} {r.currencyCode}
                  </strong>
                ),
              },
              {
                key: 'number',
                label: t('number'),
                render: (r) => r.number || '—',
              },
              {
                key: 'note',
                label: t('note'),
                render: (r) => r.note || '—',
              },
              {
                key: 'at',
                label: t('date'),
                render: (r) => dateTime(r.at),
              },
            ]}
          />
        )}
      </Modal>

      {deleteDialog}
    </>
  );
}
