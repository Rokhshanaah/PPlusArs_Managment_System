import { Router } from 'express';
import { Op } from 'sequelize';
import { hasPermission } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import { Currency, ExchangeRate } from '../models/index.js';
import { ratesWhere } from '../utils/branchScope.js';

const router = Router();

const CACHE_MS = 3 * 60 * 1000;
const cache = new Map();

/** Markets mapped to Afghan provinces / official source (sarafi.af). */
export const MARKET_REGIONS = [
  {
    id: 1,
    key: 'kabul',
    province: 'کابل',
    provinceEn: 'Kabul',
    market: 'سرای شهزاده',
    marketEn: 'Sarai Shahzada',
  },
  {
    id: 2,
    key: 'herat',
    province: 'هرات',
    provinceEn: 'Herat',
    market: 'بازار خراسان',
    marketEn: 'Khorasan Market',
  },
  {
    id: 3,
    key: 'dab',
    province: 'نرخ رسمی',
    provinceEn: 'Official',
    market: 'بانک مرکزی افغانستان',
    marketEn: 'Da Afghanistan Bank',
  },
];

const CODE_FROM_PAIR = {
  USDAFN: 'USD',
  EURAFN: 'EUR',
  GBPAFN: 'GBP',
  PKRAFN: 'PKR',
  IRRAFN: 'IRR',
  INRAFN: 'INR',
  SARAFN: 'SAR',
  AEDAFN: 'AED',
  CHFAFN: 'CHF',
  AUDAFN: 'AUD',
  CADAFN: 'CAD',
  TRYAFN: 'TRY',
  CNYAFN: 'CNY',
  RUBAFN: 'RUB',
  JPYAFN: 'JPY',
  KWDAFN: 'KWD',
  QARAFN: 'QAR',
  BHDAFN: 'BHD',
};

const LABELS = {
  USD: 'دالر', EUR: 'یورو', GBP: 'پوند', PKR: 'کلدار', IRR: 'ریال',
  INR: 'روپیه', SAR: 'ریال سعودی', AED: 'درهم', CHF: 'فرانک', AUD: 'دالر آس',
  CAD: 'دالر کانادا', TRY: 'لیره', CNY: 'یوان', RUB: 'روبل', JPY: 'ین',
  KWD: 'دینار کویت', QAR: 'ریال قطر', BHD: 'دینار بحرین',
};

async function fetchSarafiMarket(marketId) {
  const url = `https://sarafi.af/api/exchange-rates/${marketId}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(10000),
    headers: { Accept: 'application/json', 'User-Agent': 'PPlusArz/3.0' },
  });
  if (!res.ok) throw new Error(`sarafi HTTP ${res.status}`);
  const json = await res.json();
  const block = json.default_market_rates;
  if (!block?.rates?.length) throw new Error('Empty sarafi rates');
  return block;
}

function normalizeRates(block) {
  const rows = [];
  for (const item of block.rates || []) {
    const pair = String(item.currency || '').toUpperCase();
    const code = CODE_FROM_PAIR[pair];
    if (!code) continue;
    const buy = Number(item.buy_rate);
    const sell = Number(item.sell_rate);
    if (!Number.isFinite(buy) || !Number.isFinite(sell)) continue;
    rows.push({
      code,
      label: LABELS[code] || item.currency_name || code,
      buyRate: buy,
      sellRate: sell,
      changePct: item.change?.percentage != null ? Number(item.change.percentage) : null,
      updatedAt: item.created_at || null,
      unitNote: (code === 'PKR' || code === 'IRR' || code === 'INR' || code === 'JPY')
        ? 'per_1000_hint'
        : null,
    });
  }
  return rows;
}

router.get('/rates/markets', asyncHandler(async (req, res) => {
  const allowed = ['rates', 'buy', 'sell', 'exchange', 'dashboard']
    .some((p) => hasPermission(req.user, p));
  if (!allowed) throw new AppError('شما اجازه دسترسی به این بخش را ندارید.', 403, 'FORBIDDEN');
  res.json({ success: true, data: MARKET_REGIONS });
}));

router.get('/rates/online', asyncHandler(async (req, res) => {
  const allowed = ['rates', 'buy', 'sell', 'exchange', 'dashboard']
    .some((p) => hasPermission(req.user, p));
  if (!allowed) throw new AppError('شما اجازه دسترسی به این بخش را ندارید.', 403, 'FORBIDDEN');

  const regionKey = String(req.query.region || req.query.province || 'kabul').toLowerCase();
  const region = MARKET_REGIONS.find((r) => r.key === regionKey || String(r.id) === regionKey)
    || MARKET_REGIONS[0];

  const cacheKey = `m-${region.id}`;
  const hit = cache.get(cacheKey);
  const now = Date.now();
  if (hit && (now - hit.at) < CACHE_MS) {
    return res.json({ success: true, data: { ...hit.data, cached: true } });
  }

  const block = await fetchSarafiMarket(region.id);
  const rows = normalizeRates(block);

  const afn = await Currency.findOne({ where: { code: 'AFN' } });
  const local = [];
  if (afn && rows.length) {
    const codes = rows.map((r) => r.code);
    const currencies = await Currency.findAll({ where: { code: { [Op.in]: codes } } });
    const byCode = Object.fromEntries(currencies.map((c) => [c.code, c]));
    const rateRows = await ExchangeRate.findAll({
      where: { isActive: true, ...ratesWhere(req.user) },
      include: ['fromCurrency', 'toCurrency'],
      order: [['id', 'DESC']],
      limit: 200,
    });
    for (const code of codes) {
      const cur = byCode[code];
      if (!cur) continue;
      const found = rateRows.find((r) => (
        (Number(r.fromCurrencyId) === Number(cur.id) && Number(r.toCurrencyId) === Number(afn.id))
        || (Number(r.toCurrencyId) === Number(cur.id) && Number(r.fromCurrencyId) === Number(afn.id))
      ));
      if (!found) continue;
      local.push({
        code,
        buyRate: Number(found.buyRate),
        sellRate: Number(found.sellRate),
      });
    }
  }

  const data = {
    base: 'AFN',
    source: 'sarafi.af',
    region,
    regions: MARKET_REGIONS,
    updatedAt: rows[0]?.updatedAt || new Date().toISOString(),
    rows,
    local,
    cached: false,
  };
  cache.set(cacheKey, { at: now, data });
  res.json({ success: true, data });
}));

export default router;
