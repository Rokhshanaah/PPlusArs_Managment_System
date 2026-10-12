import { Trash2 } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { dateTime, money } from '../utils/format.js';
import { localizeCurrency, localizeNote, localizeValue } from '../utils/labels.js';

const DELETABLE_LEDGER_TYPES = new Set(['opening', 'received', 'paid']);

const TYPE_I18N = {
  opening_creditor: 'ledgerTypeOpeningCreditor',
  opening_debtor: 'ledgerTypeOpeningDebtor',
  received: 'ledgerTypeReceived',
  paid: 'ledgerTypePaid',
  transfer_out: 'ledgerTypeTransferOut',
  transfer_in: 'ledgerTypeTransferIn',
  convert_out: 'ledgerTypeConvertOut',
  convert_in: 'ledgerTypeConvertIn',
};

function sideLabel(t, side) {
  if (side === 'creditor') return t('creditor');
  if (side === 'debtor') return t('debtor');
  return t('settled');
}

function typeLabel(t, row) {
  const key = TYPE_I18N[row.typeKey] || TYPE_I18N[row.type];
  if (key) return t(key);
  return localizeValue(t, row.type);
}

function filterGroups(currencyGroups, search) {
  const q = search.trim().toLowerCase();
  if (!q) return currencyGroups || [];
  return (currencyGroups || [])
    .map((group) => {
      const entries = (group.entries || []).filter((row) => {
        const hay = [
          row.number,
          row.note,
          row.type,
          row.typeKey,
        ].filter(Boolean).join(' ').toLowerCase();
        return hay.includes(q);
      });
      return { ...group, entries };
    })
    .filter((group) => group.entries.length > 0);
}

function RunningBalanceCell({ t, row, symbol }) {
  const amount = Number(row.runningBalance);
  return (
    <span className={`ledger-running ${amount > 0 ? 'positive' : amount < 0 ? 'negative' : ''}`}>
      <strong>{money(row.runningBalance)} {symbol}</strong>
      <small>{sideLabel(t, row.runningSide)}</small>
    </span>
  );
}

export default function CustomerLedgerStatement({
  currencyGroups,
  search = '',
  showCashbox = true,
  compact = false,
  onDelete,
}) {
  const { t } = useTranslation();

  const groups = useMemo(
    () => filterGroups(currencyGroups, search),
    [currencyGroups, search],
  );

  if (!groups.length) {
    return <p className="empty-hint">{t('noData')}</p>;
  }

  return (
    <div className="ledger-statement">
      {groups.map((group) => {
        const code = group.currency?.code || '';
        const symbol = group.currency?.symbol || code;
        return (
          <section key={group.currencyId} className="ledger-currency-section">
            <header className="ledger-currency-header">
              <div>
                <h3>
                  {code}
                  {group.currency ? ` — ${localizeCurrency(t, group.currency)}` : ''}
                </h3>
                <p className="ledger-currency-meta">
                  {t('ledgerStatementRows', { count: group.entryCount })}
                  {group.openingBalance != null ? (
                    <>
                      {' • '}
                      {t('ledgerOpeningLine')}: {money(group.openingBalance)} {symbol}
                      {' '}
                      ({sideLabel(t, group.openingSide || 'settled')})
                    </>
                  ) : null}
                </p>
              </div>
              <div className={`ledger-current-balance ${Number(group.currentBalance) > 0 ? 'positive' : Number(group.currentBalance) < 0 ? 'negative' : ''}`}>
                <span>{t('currentBalance')}</span>
                <strong>{money(group.currentBalance)} {symbol}</strong>
                <small>{sideLabel(t, group.currentSide)}</small>
              </div>
            </header>

            <div className="table-wrap ledger-table-wrap">
              <table className="ledger-table">
                <thead>
                  <tr>
                    <th>{t('date')}</th>
                    <th>{t('number')}</th>
                    <th>{t('state')}</th>
                    <th className="num">{t('ledgerCredit')}</th>
                    <th className="num">{t('ledgerDebit')}</th>
                    <th className="num">{t('ledgerRunningBalance')}</th>
                    {!compact && showCashbox ? <th>{t('cashbox')}</th> : null}
                    {!compact ? <th>{t('note')}</th> : null}
                    {onDelete ? <th>{t('actions')}</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {group.entries.map((row) => (
                    <tr
                      key={row.id || `${row.number}-${row.createdAt}`}
                      className={row.isOpening ? 'ledger-row-opening' : ''}
                    >
                      <td data-label={t('date')}>{dateTime(row.createdAt)}</td>
                      <td data-label={t('number')}>{row.number}</td>
                      <td data-label={t('state')}>
                        <span className={`badge ledger-type ${row.debit ? 'warning' : 'success'}`}>
                          {typeLabel(t, row)}
                        </span>
                      </td>
                      <td className="num credit" data-label={t('ledgerCredit')}>
                        {row.credit ? `${money(row.credit)} ${symbol}` : '—'}
                      </td>
                      <td className="num debit" data-label={t('ledgerDebit')}>
                        {row.debit ? `${money(row.debit)} ${symbol}` : '—'}
                      </td>
                      <td className="num" data-label={t('ledgerRunningBalance')}>
                        <RunningBalanceCell t={t} row={row} symbol={symbol} />
                      </td>
                      {!compact && showCashbox ? (
                        <td data-label={t('cashbox')}>
                          {row.cashbox?.name ? localizeValue(t, row.cashbox.name) : '—'}
                        </td>
                      ) : null}
                      {!compact ? (
                        <td data-label={t('note')}>
                          {row.note ? localizeNote(t, row.note) : '—'}
                        </td>
                      ) : null}
                      {onDelete ? (
                        <td data-label={t('actions')}>
                          {DELETABLE_LEDGER_TYPES.has(row.type) ? (
                            <button
                              type="button"
                              className="icon-btn danger"
                              title={t('delete')}
                              onClick={() => onDelete(row)}
                            >
                              <Trash2 size={16} />
                            </button>
                          ) : '—'}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}
