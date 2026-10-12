import { toBase } from './currencyConvert.js';

function txKindFlags(kind = '') {
  const k = String(kind);
  return {
    isBuy: k.includes('خرید') || k === 'buy',
    isSell: k.includes('فروش') || k === 'sell',
  };
}

/** Seed running buy/sell refs from the exchange-rate table. */
export function seedRunningFromMap(buySellMap = {}) {
  const latestBuy = {};
  const latestSell = {};
  for (const [code, refs] of Object.entries(buySellMap)) {
    if (refs?.buy) latestBuy[code] = refs.buy;
    if (refs?.sell) latestSell[code] = refs.sell;
  }
  return { latestBuy, latestSell };
}

/** Update running buy/sell rates after a transaction is processed. */
export function advanceRunningRates(tx, running, baseCode = 'AFN') {
  if (!running) return;
  const base = String(baseCode || 'AFN').toUpperCase();
  const from = String(tx.fromCurrency?.code || '').toUpperCase();
  const to = String(tx.toCurrency?.code || '').toUpperCase();
  const rate = Number(tx.rate || 0);
  if (!rate) return;

  const { isBuy, isSell } = txKindFlags(tx.kind);
  if (isSell && from === base && to !== base) {
    running.latestSell[to] = rate;
  } else if (isBuy && to === base && from !== base) {
    running.latestBuy[from] = rate;
  }
}

/**
 * Buy/sell reference rates per foreign currency code, in base currency per 1 unit foreign.
 * running.latestBuy / running.latestSell come from prior transactions when rate table is empty.
 */
export function computeTransactionProfitInBase(tx, buySellMap, rateMap, baseCode = 'AFN', running = null) {
  const base = String(baseCode || 'AFN').toUpperCase();
  const from = String(tx.fromCurrency?.code || '').toUpperCase();
  const to = String(tx.toCurrency?.code || '').toUpperCase();
  const { isBuy, isSell } = txKindFlags(tx.kind);

  const fee = Number(tx.fee || 0);
  const feeInBase = toBase(Math.abs(fee), tx.toCurrency?.code || base, rateMap, base);

  let spread = 0;

  if (isSell && from === base && to !== base) {
    const foreignAmount = Number(tx.toAmount || 0);
    const txRate = Number(tx.rate || 0);
    const refs = buySellMap?.[to] || {};
    const refBuy = running?.latestBuy?.[to] ?? refs.buy;
    if (refBuy && txRate > 0 && foreignAmount > 0) {
      spread = foreignAmount * (txRate - refBuy);
    }
  } else if (isBuy && to === base && from !== base) {
    const foreignAmount = Number(tx.fromAmount || 0);
    const txRate = Number(tx.rate || 0);
    const refs = buySellMap?.[from] || {};
    const refSell = running?.latestSell?.[from] ?? refs.sell;
    if (refSell && txRate > 0 && foreignAmount > 0) {
      spread = foreignAmount * (refSell - txRate);
    }
  } else if (!isBuy && !isSell) {
    const legacy = Number(tx.profit ?? tx.fee ?? 0);
    if (!legacy) return { profit: 0, loss: 0 };
    const inBase = toBase(Math.abs(legacy), tx.toCurrency?.code || base, rateMap, base);
    return legacy > 0 ? { profit: inBase, loss: 0 } : { profit: 0, loss: inBase };
  } else {
    const total = feeInBase;
    if (total > 0) return { profit: total, loss: 0 };
    return fallbackStoredProfit(tx, rateMap, base);
  }

  let total = spread + feeInBase;
  if (total === 0) {
    const stored = fallbackStoredProfit(tx, rateMap, base);
    if (stored.profit || stored.loss) return stored;
  }
  if (total >= 0) return { profit: total, loss: 0 };
  return { profit: 0, loss: Math.abs(total) };
}

function fallbackStoredProfit(tx, rateMap, base) {
  const stored = Number(tx.profit || 0);
  if (!stored) return { profit: 0, loss: 0 };
  const inBase = toBase(Math.abs(stored), tx.toCurrency?.code || base, rateMap, base);
  return stored > 0 ? { profit: inBase, loss: 0 } : { profit: 0, loss: inBase };
}

/**
 * Sum profit/loss chronologically so prior buy/sell rates feed later spread calculations.
 * seedTransactions: full history used to build running rates (defaults to transactions).
 */
export function sumTransactionProfits(transactions, buySellMap, rateMap, baseCode, options = {}) {
  const { seedTransactions = transactions } = options;
  const running = seedRunningFromMap(buySellMap);
  const profitIds = new Set(transactions.map((tx) => tx.id));
  const allSorted = [...seedTransactions].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  let grossProfit = 0;
  let loss = 0;
  for (const tx of allSorted) {
    if (tx.state === 'برگشت داده شد') continue;
    if (profitIds.has(tx.id)) {
      const result = computeTransactionProfitInBase(tx, buySellMap, rateMap, baseCode, running);
      grossProfit += result.profit;
      loss += result.loss;
    }
    advanceRunningRates(tx, running, baseCode);
  }
  return { grossProfit, loss };
}
