import { isRialCode, toToman } from './currencyConvert.js';

const PRIMARY_CODES = ['AFN', 'USD', 'PKR'];
const RIAL_CODES = new Set(['IRR', 'IRT', 'TMN', 'TOMAN']);

function emptyBucket() {
  return { cash: 0, receivable: 0, payable: 0 };
}

function addTo(map, code, field, amount) {
  if (!code) return;
  if (!map[code]) map[code] = emptyBucket();
  map[code][field] += Number(amount) || 0;
}

/**
 * Build per-currency cash + AR/AP rows (dashboard order).
 * CustomerBalance sign: amount > 0 = payable (قرض), amount < 0 = receivable (طلب).
 */
export function buildCurrencyPositions({
  cashboxBalances = [],
  customerBalances = [],
  currencies = [],
  baseCode = 'AFN',
  netProfit = null,
} = {}) {
  const byCode = {};

  for (const row of cashboxBalances) {
    const code = row.currency?.code;
    addTo(byCode, code, 'cash', row.amount);
  }

  for (const row of customerBalances) {
    const code = row.currency?.code;
    const amount = Number(row.amount || 0);
    if (amount > 0) addTo(byCode, code, 'payable', amount);
    else if (amount < 0) addTo(byCode, code, 'receivable', Math.abs(amount));
  }

  const currencyByCode = Object.fromEntries(
    (currencies || []).map((c) => [c.code, c]),
  );

  const makeRow = (code, name, symbol, bucket, displayCode = code) => {
    const cash = Number(bucket?.cash || 0);
    const receivable = Number(bucket?.receivable || 0);
    const payable = Number(bucket?.payable || 0);
    const unit = displayCode;
    const isBase = displayCode === baseCode || code === baseCode;
    return {
      code: displayCode,
      name,
      symbol: symbol || '',
      unit,
      cash,
      receivable,
      payable,
      netPosition: cash + receivable - payable,
      profit: isBase ? Number(netProfit) || 0 : null,
    };
  };

  const rows = [];
  const shown = new Set();

  for (const code of PRIMARY_CODES) {
    const cur = currencyByCode[code];
    rows.push(makeRow(code, cur?.name || code, cur?.symbol, byCode[code]));
    shown.add(code);
  }

  const tmn = emptyBucket();
  for (const [code, bucket] of Object.entries(byCode)) {
    if (!isRialCode(code) && !RIAL_CODES.has(code)) continue;
    tmn.cash += toToman(bucket.cash, code);
    tmn.receivable += toToman(bucket.receivable, code);
    tmn.payable += toToman(bucket.payable, code);
  }
  rows.push(makeRow('TMN', 'تومن', 'تومان', tmn, 'TMN'));
  shown.add('TMN');
  for (const code of RIAL_CODES) shown.add(code);

  const extraCodes = new Set(
    Object.keys(byCode).filter((code) => {
      if (shown.has(code)) return false;
      const b = byCode[code];
      return (b.cash || 0) !== 0 || (b.receivable || 0) !== 0 || (b.payable || 0) !== 0;
    }),
  );

  const extras = [...extraCodes]
    .map((code) => {
      const cur = currencyByCode[code];
      return makeRow(code, cur?.name || code, cur?.symbol, byCode[code]);
    })
    .sort((a, b) => Math.abs(b.netPosition) - Math.abs(a.netPosition));

  rows.push(...extras);
  return rows;
}
