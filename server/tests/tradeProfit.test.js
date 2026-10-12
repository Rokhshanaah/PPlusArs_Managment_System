import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceRunningRates,
  computeTransactionProfitInBase,
  seedRunningFromMap,
  sumTransactionProfits,
} from '../src/utils/tradeProfit.js';

const rateMap = { AFN: 1, USD: 70 };

test('sell spread profit uses executed sell rate minus reference buy rate', () => {
  const buySellMap = { USD: { buy: 70, sell: 72 } };
  const tx = {
    kind: 'فروش پول',
    fromCurrency: { code: 'AFN' },
    toCurrency: { code: 'USD' },
    fromAmount: 7200,
    toAmount: 100,
    rate: 72,
    fee: 0,
    state: 'تکمیل شده',
  };
  const { profit, loss } = computeTransactionProfitInBase(tx, buySellMap, rateMap, 'AFN');
  assert.equal(profit, 200);
  assert.equal(loss, 0);
});

test('buy spread profit uses reference sell rate minus executed buy rate', () => {
  const buySellMap = { USD: { buy: 70, sell: 72 } };
  const tx = {
    kind: 'خرید پول',
    fromCurrency: { code: 'USD' },
    toCurrency: { code: 'AFN' },
    fromAmount: 100,
    toAmount: 7000,
    rate: 70,
    fee: 0,
    state: 'تکمیل شده',
  };
  const { profit, loss } = computeTransactionProfitInBase(tx, buySellMap, rateMap, 'AFN');
  assert.equal(profit, 200);
  assert.equal(loss, 0);
});

test('includes commission in payout currency converted to base', () => {
  const buySellMap = { USD: { buy: 70, sell: 72 } };
  const tx = {
    kind: 'خرید پول',
    fromCurrency: { code: 'USD' },
    toCurrency: { code: 'AFN' },
    fromAmount: 100,
    toAmount: 695,
    rate: 70,
    fee: 5,
    state: 'تکمیل شده',
  };
  const { profit } = computeTransactionProfitInBase(tx, buySellMap, rateMap, 'AFN');
  assert.equal(profit, 205);
});

test('uses prior transaction rates when exchange-rate table is empty', () => {
  const txs = [
    {
      id: 1,
      kind: 'فروش پول',
      fromCurrency: { code: 'AFN' },
      toCurrency: { code: 'USD' },
      fromAmount: 30000,
      toAmount: 461.538462,
      rate: 65,
      fee: 0,
      profit: 0,
      state: 'تکمیل شده',
      createdAt: '2026-01-01T10:00:00.000Z',
    },
    {
      id: 2,
      kind: 'خرید پول',
      fromCurrency: { code: 'USD' },
      toCurrency: { code: 'AFN' },
      fromAmount: 500,
      toAmount: 27500,
      rate: 55,
      fee: 0,
      profit: 0,
      state: 'تکمیل شده',
      createdAt: '2026-01-02T10:00:00.000Z',
    },
    {
      id: 3,
      kind: 'فروش پول',
      fromCurrency: { code: 'AFN' },
      toCurrency: { code: 'USD' },
      fromAmount: 35000,
      toAmount: 500,
      rate: 70,
      fee: 0,
      profit: 0,
      state: 'تکمیل شده',
      createdAt: '2026-01-03T10:00:00.000Z',
    },
  ];

  const { grossProfit, loss } = sumTransactionProfits(txs, {}, rateMap, 'AFN');
  assert.equal(loss, 0);
  // sell@65 (no prior buy) + buy@55 vs prior sell@65 + sell@70 vs prior buy@55
  assert.equal(grossProfit, 5000 + 7500);
});

test('advanceRunningRates tracks latest buy and sell per currency', () => {
  const running = seedRunningFromMap({});
  advanceRunningRates({
    kind: 'فروش پول',
    fromCurrency: { code: 'AFN' },
    toCurrency: { code: 'USD' },
    rate: 65,
  }, running, 'AFN');
  advanceRunningRates({
    kind: 'خرید پول',
    fromCurrency: { code: 'USD' },
    toCurrency: { code: 'AFN' },
    rate: 55,
  }, running, 'AFN');

  assert.equal(running.latestSell.USD, 65);
  assert.equal(running.latestBuy.USD, 55);
});
