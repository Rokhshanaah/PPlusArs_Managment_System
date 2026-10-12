import { ExchangeRate, Currency } from '../models/index.js';

const RIAL_CODES = new Set(['IRR', 'IRT', 'TMN', 'TOMAN']);

export function isRialCode(code = '') {
  const c = String(code || '').toUpperCase();
  return RIAL_CODES.has(c);
}

export function toToman(amount, code) {
  const n = Number(amount) || 0;
  const c = String(code || '').toUpperCase();
  if (c === 'IRR') return n / 10;
  return n;
}

export async function buildRateToAfnMap() {
  const rates = await ExchangeRate.findAll({
    where: { isActive: true },
    include: ['fromCurrency', 'toCurrency'],
    order: [['id', 'DESC']],
  });
  const map = { AFN: 1 };
  for (const row of rates) {
    const from = row.fromCurrency?.code;
    const to = row.toCurrency?.code;
    const buy = Number(row.buyRate) || 0;
    const sell = Number(row.sellRate) || 0;
    const mid = buy && sell ? (buy + sell) / 2 : (buy || sell);
    if (!from || !to || !mid) continue;
    if (to === 'AFN' && map[from] == null) map[from] = mid;
    if (from === 'AFN' && map[to] == null) map[to] = 1 / mid;
  }
  return map;
}

/** Reference buy/sell rates per foreign currency, expressed in base currency per 1 unit. */
export async function buildBuySellToBaseMap(baseCode) {
  const base = String(baseCode ?? (await getBaseCurrency()).code).toUpperCase();
  const rates = await ExchangeRate.findAll({
    where: { isActive: true },
    include: ['fromCurrency', 'toCurrency'],
    order: [['branchId', 'DESC'], ['id', 'DESC']],
  });
  const map = {};
  for (const row of rates) {
    const from = String(row.fromCurrency?.code || '').toUpperCase();
    const to = String(row.toCurrency?.code || '').toUpperCase();
    const buy = Number(row.buyRate) || 0;
    const sell = Number(row.sellRate) || 0;
    if (!buy || !sell) continue;
    if (to === base && from && from !== base && !map[from]) {
      map[from] = { buy, sell };
    }
    if (from === base && to && to !== base && !map[to]) {
      map[to] = { buy: 1 / sell, sell: 1 / buy };
    }
  }
  return map;
}

export function toAfn(amount, code, rateMap) {
  const n = Number(amount) || 0;
  const c = String(code || '').toUpperCase();
  if (!c || c === 'AFN') return n;
  if (isRialCode(c)) {
    const toman = toToman(n, c);
    if (rateMap.IRT) return toman * rateMap.IRT;
    if (rateMap.TMN) return toman * rateMap.TMN;
    if (rateMap.IRR) return (c === 'IRR' ? n : toman * 10) * rateMap.IRR;
    return toman;
  }
  return rateMap[c] ? n * rateMap[c] : n;
}

export function toBase(amount, fromCode, rateMap, baseCode = 'AFN') {
  const base = String(baseCode || 'AFN').toUpperCase();
  const from = String(fromCode || 'AFN').toUpperCase();
  if (from === base) return Number(amount) || 0;
  const afn = toAfn(amount, from, rateMap);
  if (base === 'AFN') return afn;
  const basePerAfn = rateMap[base];
  if (!basePerAfn) return afn;
  return afn / basePerAfn;
}

export async function getBaseCurrency() {
  const row = await Currency.findOne({ where: { isBase: true, isActive: true } });
  return {
    code: row?.code || 'AFN',
    name: row?.name || 'افغانی',
    symbol: row?.symbol || row?.code || 'AFN',
  };
}
