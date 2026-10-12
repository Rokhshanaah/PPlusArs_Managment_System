import { Router } from 'express';
import { Op } from 'sequelize';
import { requirePermission } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import {
  CashboxBalance, Currency, Customer, CustomerBalance, Expense, Remittance, Transaction,
} from '../models/index.js';
import { transactionIncludes } from '../services/accounting.js';
import {
  branchWhere,
  cashboxInclude,
  mergeWhere,
  remittanceWhere,
  scopeMeta,
} from '../utils/branchScope.js';
import {
  buildBuySellToBaseMap,
  buildRateToAfnMap,
  getBaseCurrency,
  isRialCode,
  toBase,
  toToman,
} from '../utils/currencyConvert.js';
import { sumTransactionProfits } from '../utils/tradeProfit.js';
import { buildCurrencyPositions } from '../utils/currencyPositions.js';

const router = Router();
const kindKey = (kind = '') => (
  kind.includes('خرید') ? 'buy'
    : kind.includes('فروش') ? 'sell'
      : kind.includes('تبدیل') ? 'exchange'
        : 'other'
);

const PRIMARY_CODES = ['AFN', 'USD', 'PKR'];
const RIAL_CODES = new Set(['IRR', 'IRT', 'TMN', 'TOMAN']);

router.get('/dashboard', requirePermission('dashboard'), asyncHandler(async (req, res) => {
  const txWhere = mergeWhere({ state: { [Op.ne]: 'برگشت داده شد' } }, branchWhere(req.user));
  const remittanceScope = remittanceWhere(req.user);
  const [
    balances,
    currencies,
    customerBalances,
    transactions,
    waitingRemittances,
    waitingRemittanceRows,
    remittanceFeeRows,
    rateMap,
    buySellMap,
    expenseRows,
    baseCurrency,
  ] = await Promise.all([
    CashboxBalance.findAll({
      include: [{ association: 'currency' }, cashboxInclude(req.user, { include: ['branch'] })],
    }),
    Currency.findAll({ where: { isActive: true } }),
    CustomerBalance.findAll({
      include: [
        'currency',
        {
          association: 'customer',
          attributes: ['id', 'source'],
          where: { source: { [Op.ne]: 'card_reader' } },
          required: true,
        },
      ],
    }),
    Transaction.findAll({
      where: txWhere,
      include: transactionIncludes,
    }),
    Remittance.count({ where: mergeWhere({ state: 'در انتظار پرداخت' }, remittanceScope) }),
    Remittance.findAll({
      where: mergeWhere({ state: 'در انتظار پرداخت' }, remittanceScope),
      include: ['currency'],
    }),
    Remittance.findAll({
      where: mergeWhere({ state: { [Op.ne]: 'لغو شده' } }, remittanceScope),
      include: [
        { association: 'feeCurrency', attributes: ['id', 'code'], required: false },
        { association: 'currency', attributes: ['id', 'code'], required: false },
      ],
    }),
    buildRateToAfnMap(),
    getBaseCurrency().then((bc) => buildBuySellToBaseMap(bc.code)),
    Expense.findAll({
      where: mergeWhere({}, branchWhere(req.user)),
      include: ['currency'],
    }),
    getBaseCurrency(),
  ]);

  const baseCode = baseCurrency.code;

  const balanceByCode = {};
  for (const b of balances) {
    const code = b.currency?.code;
    if (!code) continue;
    balanceByCode[code] = (balanceByCode[code] || 0) + Number(b.amount || 0);
  }

  const currencyByCode = Object.fromEntries(
    currencies.map((c) => [c.code, c]),
  );

  // ارزهایی که خرید شده‌اند (ورود به صندوق در معامله خرید)
  const boughtCodes = new Set();
  for (const tx of transactions) {
    if (kindKey(tx.kind) !== 'buy') continue;
    const code = tx.fromCurrency?.code;
    if (code) boughtCodes.add(code);
  }

  const makeCurrencyCard = (code, name, symbol, total, displayCode = code) => ({
    code: displayCode,
    name,
    symbol: symbol || '',
    total: Number(total) || 0,
    unit: displayCode,
  });

  const currencyCards = [];
  const shown = new Set();

  // ۱) ارزهای اصلی همیشه (حتی موجودی صفر)
  for (const code of PRIMARY_CODES) {
    const cur = currencyByCode[code];
    currencyCards.push(makeCurrencyCard(
      code,
      cur?.name || code,
      cur?.symbol,
      balanceByCode[code] || 0,
    ));
    shown.add(code);
  }

  // ۲) تومن = جمع ریال/تومن
  let tomanTotal = 0;
  for (const [code, amount] of Object.entries(balanceByCode)) {
    if (isRialCode(code)) tomanTotal += toToman(amount, code);
  }
  currencyCards.push(makeCurrencyCard('TMN', 'تومن', 'تومان', tomanTotal, 'TMN'));
  shown.add('TMN');
  for (const code of RIAL_CODES) shown.add(code);

  // ۳) هر ارز دیگر که خرید شده یا موجودی دارد → کارت جدا
  const extraCodes = new Set([
    ...Object.keys(balanceByCode).filter((c) => (balanceByCode[c] || 0) !== 0),
    ...boughtCodes,
  ]);
  for (const code of shown) extraCodes.delete(code);

  const extras = [...extraCodes]
    .map((code) => {
      const cur = currencyByCode[code];
      return makeCurrencyCard(code, cur?.name || code, cur?.symbol, balanceByCode[code] || 0);
    })
    .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
  currencyCards.push(...extras);

  // سود/زیان معامله = اختلاف نرخ خرید/فروش + کمیشن
  const tradeTotals = sumTransactionProfits(transactions, buySellMap, rateMap, baseCode);
  let grossProfit = tradeTotals.grossProfit;
  let loss = tradeTotals.loss;

  // کمیشن حواله‌های غیرلغو‌شده
  for (const row of remittanceFeeRows) {
    const fee = Number(row.fee || 0);
    if (fee <= 0) continue;
    const code = row.feeCurrency?.code || row.currency?.code || baseCode;
    grossProfit += toBase(fee, code, rateMap, baseCode);
  }

  let expenses = 0;
  for (const row of expenseRows) {
    expenses += toBase(Number(row.amount || 0), row.currency?.code || baseCode, rateMap, baseCode);
  }

  const netProfit = grossProfit - expenses - loss;

  let receivables = 0;
  let payables = 0;
  for (const row of customerBalances) {
    const amount = Number(row.amount || 0);
    const code = row.currency?.code || baseCode;
    if (amount > 0) payables += toBase(amount, code, rateMap, baseCode);
    else if (amount < 0) receivables += toBase(Math.abs(amount), code, rateMap, baseCode);
  }

  let waitingRemittanceAmount = 0;
  for (const row of waitingRemittanceRows) {
    waitingRemittanceAmount += toBase(
      Number(row.amount || 0),
      row.currency?.code || baseCode,
      rateMap,
      baseCode,
    );
  }

  res.json({
    success: true,
    data: {
      scope: scopeMeta(req.user),
      baseCurrency,
      currencyCards,
      finance: {
        grossProfit,
        expenses,
        loss,
        netProfit,
        receivables,
        payables,
        waitingRemittances,
        waitingRemittanceAmount,
        unit: baseCode,
      },
    },
  });
}));

router.get('/reports', requirePermission('reports'), asyncHandler(async (req, res) => {
  const where = mergeWhere({}, branchWhere(req.user));
  if (req.query.dateFrom || req.query.dateTo) {
    where.createdAt = {};
    if (req.query.dateFrom) where.createdAt[Op.gte] = new Date(`${req.query.dateFrom}T00:00:00`);
    if (req.query.dateTo) where.createdAt[Op.lte] = new Date(`${req.query.dateTo}T23:59:59.999`);
  }

  const remittanceScope = remittanceWhere(req.user);
  const remittanceWhereDated = { ...mergeWhere({ state: { [Op.ne]: 'لغو شده' } }, remittanceScope) };
  if (req.query.dateFrom || req.query.dateTo) {
    remittanceWhereDated.createdAt = {};
    if (req.query.dateFrom) remittanceWhereDated.createdAt[Op.gte] = new Date(`${req.query.dateFrom}T00:00:00`);
    if (req.query.dateTo) remittanceWhereDated.createdAt[Op.lte] = new Date(`${req.query.dateTo}T23:59:59.999`);
  }

  const seedWhere = mergeWhere({ state: { [Op.ne]: 'برگشت داده شد' } }, branchWhere(req.user));

  const [transactions, seedTransactions, balances, customers, remittanceFeeRows, rateMap, buySellMap, baseCurrency] = await Promise.all([
    Transaction.findAll({ where, include: transactionIncludes, order: [['id', 'DESC']] }),
    Transaction.findAll({ where: seedWhere, include: transactionIncludes, order: [['createdAt', 'ASC']] }),
    CustomerBalance.findAll({ include: ['customer', 'currency'] }),
    Customer.count(),
    Remittance.findAll({
      where: remittanceWhereDated,
      include: [
        { association: 'feeCurrency', attributes: ['id', 'code'], required: false },
        { association: 'currency', attributes: ['id', 'code'], required: false },
      ],
    }),
    buildRateToAfnMap(),
    getBaseCurrency().then((bc) => buildBuySellToBaseMap(bc.code)),
    getBaseCurrency(),
  ]);

  const baseCode = baseCurrency.code;
  const byKind = {
    buy: [], sell: [], exchange: [], other: [],
  };
  for (const row of transactions) byKind[kindKey(row.kind)].push(row);

  const tradeTotals = sumTransactionProfits(transactions, buySellMap, rateMap, baseCode, {
    seedTransactions,
  });
  let totalProfit = tradeTotals.grossProfit;
  let totalLoss = tradeTotals.loss;
  for (const row of remittanceFeeRows) {
    const fee = Number(row.fee || 0);
    if (fee <= 0) continue;
    const code = row.feeCurrency?.code || row.currency?.code || baseCode;
    totalProfit += toBase(fee, code, rateMap, baseCode);
  }

  const accountRows = balances.map((b) => {
    const amount = Number(b.amount || 0);
    return {
      customer: b.customer,
      currency: b.currency,
      received: amount > 0 ? amount : 0,
      paid: amount < 0 ? Math.abs(amount) : 0,
      balance: amount,
    };
  });

  res.json({
    success: true,
    data: {
      scope: scopeMeta(req.user),
      baseCurrency,
      summary: {
        transactions: transactions.length,
        customers,
        totalProfit,
        totalLoss,
        buy: byKind.buy.length,
        sell: byKind.sell.length,
        exchange: byKind.exchange.length,
        debtors: accountRows.filter((a) => a.balance < 0).length,
        creditors: accountRows.filter((a) => a.balance > 0).length,
        unit: baseCode,
      },
      buyers: byKind.buy,
      sellers: byKind.sell,
      exchangers: byKind.exchange,
      debtors: accountRows.filter((a) => a.balance < 0),
      creditors: accountRows.filter((a) => a.balance > 0),
      transactions,
    },
  });
}));

router.get('/income-statement', requirePermission('reports'), asyncHandler(async (req, res) => {
  const txWhere = mergeWhere({ state: { [Op.ne]: 'برگشت داده شد' } }, branchWhere(req.user));
  if (req.query.dateFrom || req.query.dateTo) {
    txWhere.createdAt = {};
    if (req.query.dateFrom) txWhere.createdAt[Op.gte] = new Date(`${req.query.dateFrom}T00:00:00`);
    if (req.query.dateTo) txWhere.createdAt[Op.lte] = new Date(`${req.query.dateTo}T23:59:59.999`);
  }

  const remittanceScope = remittanceWhere(req.user);
  const remittanceWhereDated = {
    ...mergeWhere({ state: { [Op.ne]: 'لغو شده' } }, remittanceScope),
  };
  if (req.query.dateFrom || req.query.dateTo) {
    remittanceWhereDated.createdAt = {};
    if (req.query.dateFrom) remittanceWhereDated.createdAt[Op.gte] = new Date(`${req.query.dateFrom}T00:00:00`);
    if (req.query.dateTo) remittanceWhereDated.createdAt[Op.lte] = new Date(`${req.query.dateTo}T23:59:59.999`);
  }

  const expenseWhere = mergeWhere({}, branchWhere(req.user));
  if (req.query.dateFrom || req.query.dateTo) {
    expenseWhere.entryDate = {};
    if (req.query.dateFrom) expenseWhere.entryDate[Op.gte] = req.query.dateFrom;
    if (req.query.dateTo) expenseWhere.entryDate[Op.lte] = req.query.dateTo;
  }

  const seedTxWhere = mergeWhere({ state: { [Op.ne]: 'برگشت داده شد' } }, branchWhere(req.user));

  const [transactions, seedTransactions, remittanceFeeRows, expenseRows, rateMap, buySellMap, baseCurrency, cashboxBalances, currencies, customerBalances] = await Promise.all([
    Transaction.findAll({ where: txWhere, include: transactionIncludes, order: [['id', 'DESC']] }),
    Transaction.findAll({ where: seedTxWhere, include: transactionIncludes, order: [['createdAt', 'ASC']] }),
    Remittance.findAll({
      where: remittanceWhereDated,
      include: [
        { association: 'feeCurrency', attributes: ['id', 'code'], required: false },
        { association: 'currency', attributes: ['id', 'code'], required: false },
      ],
    }),
    Expense.findAll({ where: expenseWhere, include: ['currency'] }),
    buildRateToAfnMap(),
    getBaseCurrency().then((bc) => buildBuySellToBaseMap(bc.code)),
    getBaseCurrency(),
    CashboxBalance.findAll({
      include: [{ association: 'currency' }, cashboxInclude(req.user, { include: ['branch'] })],
    }),
    Currency.findAll({ where: { isActive: true } }),
    CustomerBalance.findAll({
      include: [
        'currency',
        {
          association: 'customer',
          attributes: ['id', 'source'],
          where: { source: { [Op.ne]: 'card_reader' } },
          required: true,
        },
      ],
    }),
  ]);

  const baseCode = baseCurrency.code;

  const tradeTotals = sumTransactionProfits(transactions, buySellMap, rateMap, baseCode, {
    seedTransactions,
  });
  let grossProfit = tradeTotals.grossProfit;
  let loss = tradeTotals.loss;

  const buyCount = transactions.filter((tx) => kindKey(tx.kind) === 'buy').length;
  const sellCount = transactions.filter((tx) => kindKey(tx.kind) === 'sell').length;
  const ratesConfigured = Object.keys(buySellMap).length > 0;

  // کمیشن حواله‌ها
  for (const row of remittanceFeeRows) {
    const fee = Number(row.fee || 0);
    if (fee <= 0) continue;
    const code = row.feeCurrency?.code || row.currency?.code || baseCode;
    grossProfit += toBase(fee, code, rateMap, baseCode);
  }

  let expenses = 0;
  for (const row of expenseRows) {
    expenses += toBase(Number(row.amount || 0), row.currency?.code || baseCode, rateMap, baseCode);
  }

  const netProfit = grossProfit - expenses - loss;

  const currencyPositions = buildCurrencyPositions({
    cashboxBalances,
    customerBalances,
    currencies,
    baseCode,
    netProfit,
  });

  res.json({
    success: true,
    data: {
      scope: scopeMeta(req.user),
      baseCurrency,
      statement: {
        grossProfit,
        expenses,
        loss,
        netProfit,
        unit: baseCode,
        transactionCount: transactions.length,
        buyCount,
        sellCount,
        ratesConfigured,
      },
      currencyPositions,
    },
  });
}));

export default router;
