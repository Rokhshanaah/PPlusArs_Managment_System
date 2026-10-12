import Decimal from 'decimal.js';
import { Op } from 'sequelize';
import { sequelize } from '../db/sequelize.js';
import {
  Branch, Cashbox, CashboxBalance, Currency, Customer, CustomerBalance, CustomerLedger,
  ExchangeRate, Expense, JournalEntry, Remittance, SystemSetting, Transaction,
} from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { documentNumber } from '../utils/ids.js';
import { writeAudit } from '../utils/audit.js';
import { calculatePaidAmount, deriveRateFromAmounts } from './calculation.js';
import { buildBuySellToBaseMap, buildRateToAfnMap, getBaseCurrency } from '../utils/currencyConvert.js';
import { computeTransactionProfitInBase, advanceRunningRates, seedRunningFromMap } from '../utils/tradeProfit.js';

const D = (value) => new Decimal(value || 0);
const fixed = (value, places = 6) => D(value).toDecimalPlaces(places).toString();
const kindMap = { buy: 'خرید پول', sell: 'فروش پول', exchange: 'تبدیل پول' };
const kindFromStored = (kind) => {
  const value = String(kind || '');
  if (value === 'buy' || value.includes('خرید')) return 'buy';
  if (value === 'sell' || value.includes('فروش')) return 'sell';
  if (value === 'exchange' || value.includes('تبدیل')) return 'exchange';
  return null;
};

async function computeStoredProfit(payload, kindLabel, fromCurrency, toCurrency, toAmount, rate, dbTransaction, excludeId = null) {
  const baseCurrency = await getBaseCurrency();
  const where = { state: { [Op.ne]: 'برگشت داده شد' } };
  if (excludeId) where.id = { [Op.ne]: excludeId };
  const [rateMap, buySellMap, priorTransactions] = await Promise.all([
    buildRateToAfnMap(),
    buildBuySellToBaseMap(baseCurrency.code),
    Transaction.findAll({
      where,
      include: transactionIncludes,
      order: [['createdAt', 'ASC']],
      transaction: dbTransaction,
    }),
  ]);
  const running = seedRunningFromMap(buySellMap);
  for (const prior of priorTransactions) {
    advanceRunningRates(prior, running, baseCurrency.code);
  }
  const profitPreview = computeTransactionProfitInBase({
    kind: kindLabel,
    fromCurrency,
    toCurrency,
    fromAmount: fixed(payload.fromAmount),
    toAmount,
    rate,
    fee: fixed(payload.fee || 0),
    state: 'تکمیل شده',
  }, buySellMap, rateMap, baseCurrency.code, running);
  return profitPreview.profit > 0
    ? profitPreview.profit
    : (profitPreview.loss > 0 ? -profitPreview.loss : 0);
}

let negativeCashboxCache = { at: 0, value: false };

export function clearNegativeCashboxCache() {
  negativeCashboxCache = { at: 0, value: false };
}

/** Reads settings.allow_negative_cashbox (روشن/خاموش). Cached briefly for hot paths. */
export async function isNegativeCashboxAllowed() {
  const now = Date.now();
  if (now - negativeCashboxCache.at < 3000) return negativeCashboxCache.value;
  const row = await SystemSetting.findOne({ where: { settingKey: 'allow_negative_cashbox' } });
  const raw = String(row?.settingValue || '').trim().toLowerCase();
  const on = raw === 'روشن' || raw === '1' || raw === 'true' || raw === 'on' || raw === 'yes';
  negativeCashboxCache = { at: now, value: on };
  return on;
}

async function assertEnoughCashbox(balanceAmount, needAmount, message) {
  if (D(balanceAmount).lt(needAmount) && !(await isNegativeCashboxAllowed())) {
    throw new AppError(message);
  }
}

/** Inverse of calculatePaidAmount: how much settle currency covers a cash payout. */
function calculateSettleFromAmount({ settleCode, payCode, payAmount, rate, fee = 0 }) {
  const amount = D(payAmount);
  const r = D(rate);
  const f = D(fee || 0);
  if (amount.lte(0) || r.lte(0) || f.lt(0)) {
    throw new AppError('مقدار و نرخ باید بیشتر از صفر باشد.');
  }
  const settle = String(settleCode).toUpperCase() === 'AFN' && String(payCode).toUpperCase() !== 'AFN'
    ? amount.plus(f).mul(r)
    : amount.plus(f).div(r);
  if (settle.lte(0)) throw new AppError('مقدار کسر از حساب معتبر نیست.');
  return settle.toDecimalPlaces(6);
}

async function getBalance(cashboxId, currencyId, transaction, lock = true) {
  let balance;
  try {
    const [row] = await CashboxBalance.findOrCreate({
      where: { cashboxId, currencyId },
      defaults: { amount: 0 },
      transaction,
    });
    balance = row;
  } catch (err) {
    if (err.name !== 'SequelizeUniqueConstraintError') throw err;
    balance = await CashboxBalance.findOne({
      where: { cashboxId, currencyId },
      transaction,
    });
    if (!balance) throw err;
  }
  if (lock) {
    await balance.reload({ transaction, lock: transaction.LOCK.UPDATE });
  }
  return balance;
}

async function getLockedBalancePair(cashboxId, firstCurrencyId, secondCurrencyId, transaction) {
  const ids = [Number(firstCurrencyId), Number(secondCurrencyId)].sort((a, b) => a - b);
  const balances = new Map();
  for (const currencyId of ids) {
    balances.set(currencyId, await getBalance(cashboxId, currencyId, transaction));
  }
  return {
    first: balances.get(Number(firstCurrencyId)),
    second: balances.get(Number(secondCurrencyId)),
  };
}

export async function calculateTransaction({ fromCurrencyId, toCurrencyId, fromAmount, rate, fee = 0 }) {
  const [fromCurrency, toCurrency] = await Promise.all([
    Currency.findByPk(fromCurrencyId), Currency.findByPk(toCurrencyId),
  ]);
  if (!fromCurrency || !toCurrency) throw new AppError('ارز انتخاب‌شده پیدا نشد.', 404);
  const toAmount = calculatePaidAmount({ fromCode: fromCurrency.code, toCode: toCurrency.code, fromAmount, rate, fee });
  return { fromCurrency, toCurrency, toAmount };
}

/** Resolve payout amount and stored rate from either rate or direct toAmount. */
export async function prepareTransactionAmounts(payload) {
  const [fromCurrency, toCurrency] = await Promise.all([
    Currency.findByPk(payload.fromCurrencyId),
    Currency.findByPk(payload.toCurrencyId),
  ]);
  if (!fromCurrency || !toCurrency) throw new AppError('ارز انتخاب‌شده پیدا نشد.', 404);

  const explicitTo = payload.toAmount != null && Number(payload.toAmount) > 0;
  const hasRate = payload.rate != null && Number(payload.rate) > 0;

  if (explicitTo && !hasRate) {
    const fee = Number(payload.fee || 0);
    const rate = deriveRateFromAmounts({
      fromCode: fromCurrency.code,
      toCode: toCurrency.code,
      fromAmount: payload.fromAmount,
      toAmount: payload.toAmount,
      fee,
    });
    return {
      fromCurrency,
      toCurrency,
      toAmount: fixed(payload.toAmount),
      rate: fixed(rate, 8),
    };
  }

  if (!hasRate) throw new AppError('نرخ یا مبلغ پرداختی را وارد کنید.');
  const calc = await calculateTransaction(payload);
  return {
    fromCurrency: calc.fromCurrency,
    toCurrency: calc.toCurrency,
    toAmount: calc.toAmount,
    rate: fixed(payload.rate, 8),
  };
}

export async function findRate({ fromCurrencyId, toCurrencyId, branchId, kind = 'sell' }) {
  const branchScope = branchId ? [{ branchId }, { branchId: null }] : [{ branchId: null }];
  const rate = await ExchangeRate.findOne({
    where: {
      fromCurrencyId, toCurrencyId, isActive: true,
      [Op.or]: branchScope,
    },
    order: [['branchId', 'DESC'], ['id', 'DESC']],
  });
  if (!rate) return null;
  return kind === 'buy' ? rate.buyRate : kind === 'sell' ? rate.sellRate : (rate.specialRate || rate.sellRate);
}

export async function createMoneyTransaction(payload, context) {
  const result = await sequelize.transaction(async (dbTransaction) => {
    const [branch, cashbox, customer] = await Promise.all([
      Branch.findByPk(payload.branchId, { transaction: dbTransaction }),
      Cashbox.findByPk(payload.cashboxId, { transaction: dbTransaction }),
      payload.customerId ? Customer.findByPk(payload.customerId, { transaction: dbTransaction }) : null,
    ]);
    if (!branch || !branch.isActive) throw new AppError('شعبه انتخاب‌شده فعال نیست.');
    if (!cashbox || !cashbox.isActive || Number(cashbox.branchId) !== Number(branch.id)) {
      throw new AppError('صندوق انتخاب‌شده مربوط به این شعبه نیست یا غیرفعال است.');
    }
    if (payload.customerId && !customer) throw new AppError('مشتری انتخاب‌شده پیدا نشد.');
    if (Number(payload.fromCurrencyId) === Number(payload.toCurrencyId)) throw new AppError('ارز دریافتی و پرداختی نباید یکسان باشد.');

    const { fromCurrency, toCurrency, toAmount, rate } = await prepareTransactionAmounts(payload);
    const kindLabel = kindMap[payload.kind] || payload.kind;
    const storedProfit = await computeStoredProfit(
      payload, kindLabel, fromCurrency, toCurrency, toAmount, rate, dbTransaction,
    );

    const { first: receiveBalance, second: payBalance } = await getLockedBalancePair(
      payload.cashboxId, payload.fromCurrencyId, payload.toCurrencyId, dbTransaction,
    );
    if (D(payBalance.amount).lt(toAmount)) {
      await assertEnoughCashbox(
        payBalance.amount,
        toAmount,
        `موجودی صندوق کافی نیست. موجودی ${toCurrency.code}: ${fixed(payBalance.amount)}`,
      );
    }

    receiveBalance.amount = fixed(D(receiveBalance.amount).plus(payload.fromAmount));
    payBalance.amount = fixed(D(payBalance.amount).minus(toAmount));
    await receiveBalance.save({ transaction: dbTransaction });
    await payBalance.save({ transaction: dbTransaction });

    const transactionRow = await Transaction.create({
      number: await documentNumber('TR', dbTransaction),
      kind: kindLabel,
      customerId: payload.customerId || null,
      branchId: payload.branchId,
      cashboxId: payload.cashboxId,
      fromCurrencyId: payload.fromCurrencyId,
      toCurrencyId: payload.toCurrencyId,
      fromAmount: fixed(payload.fromAmount),
      toAmount,
      rate,
      fee: fixed(payload.fee || 0),
      profit: fixed(storedProfit),
      state: 'تکمیل شده',
      note: payload.note || `${kindMap[payload.kind] || payload.kind}: دریافت ${fixed(payload.fromAmount)} ${fromCurrency.code} و پرداخت ${toAmount} ${toCurrency.code}`,
    }, { transaction: dbTransaction });

    await JournalEntry.create({
      number: await documentNumber('JE', dbTransaction),
      entryDate: new Date().toISOString().slice(0, 10),
      description: `ثبت ${transactionRow.kind} شماره ${transactionRow.number}`,
      debitAccount: `صندوق ${fromCurrency.code}`,
      creditAccount: `صندوق ${toCurrency.code}`,
      currencyId: payload.fromCurrencyId,
      amount: fixed(payload.fromAmount),
      branchId: payload.branchId,
      createdByName: context.user.name,
    }, { transaction: dbTransaction });
    await writeAudit({ req: context.req, user: context.user, action: `معامله ${transactionRow.number} ثبت شد`, transaction: dbTransaction });
    return transactionRow;
  });
  const full = await Transaction.findByPk(result.id, { include: transactionIncludes });
  const { queueNotifyMoneyTransaction } = await import('./whatsapp.js');
  const whatsapp = await queueNotifyMoneyTransaction(full);
  const data = full.toJSON();
  data.whatsapp = whatsapp;
  return data;
}

export async function reverseMoneyTransaction(id, context) {
  return sequelize.transaction(async (dbTransaction) => {
    const row = await Transaction.findByPk(id, { transaction: dbTransaction, lock: dbTransaction.LOCK.UPDATE });
    if (!row) throw new AppError('معامله پیدا نشد.', 404);
    if (row.state === 'برگشت داده شد') throw new AppError('این معامله قبلاً برگشت داده شده است.');
    const { first: received, second: paid } = await getLockedBalancePair(
      row.cashboxId, row.fromCurrencyId, row.toCurrencyId, dbTransaction,
    );
    if (D(received.amount).lt(row.fromAmount)) throw new AppError('موجودی ارز دریافتی برای برگشت معامله کافی نیست.');
    received.amount = fixed(D(received.amount).minus(row.fromAmount));
    paid.amount = fixed(D(paid.amount).plus(row.toAmount));
    await Promise.all([received.save({ transaction: dbTransaction }), paid.save({ transaction: dbTransaction })]);
    row.state = 'برگشت داده شد';
    row.profit = 0;
    row.note = `${row.note || ''}\nمعامله در ${new Date().toISOString()} برگشت داده شد.`.trim();
    await row.save({ transaction: dbTransaction });
    await JournalEntry.create({
      number: await documentNumber('JE', dbTransaction), entryDate: new Date().toISOString().slice(0,10),
      description: `برگشت معامله ${row.number}`, debitAccount: 'برگشت صندوق پرداختی', creditAccount: 'برگشت صندوق دریافتی',
      currencyId: row.toCurrencyId, amount: row.toAmount, branchId: row.branchId, createdByName: context.user.name,
    }, { transaction: dbTransaction });
    await writeAudit({ req: context.req, user: context.user, action: `معامله ${row.number} برگشت داده شد`, transaction: dbTransaction });
    return row;
  });
}

export async function updateMoneyTransaction(id, payload, context) {
  const result = await sequelize.transaction(async (dbTransaction) => {
    const row = await Transaction.findByPk(id, { transaction: dbTransaction, lock: dbTransaction.LOCK.UPDATE });
    if (!row) throw new AppError('معامله پیدا نشد.', 404);
    if (row.state === 'برگشت داده شد') throw new AppError('معامله برگشت‌داده‌شده قابل ویرایش نیست.');

    const englishKind = kindFromStored(row.kind);
    if (englishKind !== 'buy' && englishKind !== 'sell') {
      throw new AppError('فقط معاملات خرید و فروش قابل ویرایش هستند.');
    }
    if (payload.kind && payload.kind !== englishKind) {
      throw new AppError('نوع معامله را نمی‌توان تغییر داد.');
    }

    const [branch, cashbox, customer] = await Promise.all([
      Branch.findByPk(payload.branchId, { transaction: dbTransaction }),
      Cashbox.findByPk(payload.cashboxId, { transaction: dbTransaction }),
      payload.customerId ? Customer.findByPk(payload.customerId, { transaction: dbTransaction }) : null,
    ]);
    if (!branch || !branch.isActive) throw new AppError('شعبه انتخاب‌شده فعال نیست.');
    if (!cashbox || !cashbox.isActive || Number(cashbox.branchId) !== Number(branch.id)) {
      throw new AppError('صندوق انتخاب‌شده مربوط به این شعبه نیست یا غیرفعال است.');
    }
    if (payload.customerId && !customer) throw new AppError('مشتری انتخاب‌شده پیدا نشد.');
    if (Number(payload.fromCurrencyId) === Number(payload.toCurrencyId)) {
      throw new AppError('ارز دریافتی و پرداختی نباید یکسان باشد.');
    }

    const { first: oldReceived, second: oldPaid } = await getLockedBalancePair(
      row.cashboxId, row.fromCurrencyId, row.toCurrencyId, dbTransaction,
    );
    if (D(oldReceived.amount).lt(row.fromAmount)) {
      throw new AppError('موجودی ارز دریافتی برای اصلاح معامله کافی نیست.');
    }
    oldReceived.amount = fixed(D(oldReceived.amount).minus(row.fromAmount));
    oldPaid.amount = fixed(D(oldPaid.amount).plus(row.toAmount));
    await Promise.all([
      oldReceived.save({ transaction: dbTransaction }),
      oldPaid.save({ transaction: dbTransaction }),
    ]);

    const { fromCurrency, toCurrency, toAmount, rate } = await prepareTransactionAmounts(payload);
    const kindLabel = kindMap[englishKind];
    const storedProfit = await computeStoredProfit(
      payload, kindLabel, fromCurrency, toCurrency, toAmount, rate, dbTransaction, row.id,
    );

    const { first: receiveBalance, second: payBalance } = await getLockedBalancePair(
      payload.cashboxId, payload.fromCurrencyId, payload.toCurrencyId, dbTransaction,
    );
    if (D(payBalance.amount).lt(toAmount)) {
      await assertEnoughCashbox(
        payBalance.amount,
        toAmount,
        `موجودی صندوق کافی نیست. موجودی ${toCurrency.code}: ${fixed(payBalance.amount)}`,
      );
    }
    receiveBalance.amount = fixed(D(receiveBalance.amount).plus(payload.fromAmount));
    payBalance.amount = fixed(D(payBalance.amount).minus(toAmount));
    await Promise.all([
      receiveBalance.save({ transaction: dbTransaction }),
      payBalance.save({ transaction: dbTransaction }),
    ]);

    row.customerId = payload.customerId || null;
    row.branchId = payload.branchId;
    row.cashboxId = payload.cashboxId;
    row.fromCurrencyId = payload.fromCurrencyId;
    row.toCurrencyId = payload.toCurrencyId;
    row.fromAmount = fixed(payload.fromAmount);
    row.toAmount = toAmount;
    row.rate = rate;
    row.fee = fixed(payload.fee || 0);
    row.profit = fixed(storedProfit);
    row.note = payload.note != null && String(payload.note).trim()
      ? String(payload.note).trim()
      : `${kindLabel}: دریافت ${fixed(payload.fromAmount)} ${fromCurrency.code} و پرداخت ${toAmount} ${toCurrency.code}`;
    await row.save({ transaction: dbTransaction });

    await JournalEntry.create({
      number: await documentNumber('JE', dbTransaction),
      entryDate: new Date().toISOString().slice(0, 10),
      description: `اصلاح معامله ${row.number}`,
      debitAccount: `صندوق ${fromCurrency.code}`,
      creditAccount: `صندوق ${toCurrency.code}`,
      currencyId: payload.fromCurrencyId,
      amount: fixed(payload.fromAmount),
      branchId: payload.branchId,
      createdByName: context.user.name,
    }, { transaction: dbTransaction });
    await writeAudit({
      req: context.req,
      user: context.user,
      action: `معامله ${row.number} ویرایش شد`,
      transaction: dbTransaction,
    });
    return row;
  });

  return Transaction.findByPk(result.id, { include: transactionIncludes });
}

export async function deleteMoneyTransaction(id, context) {
  return sequelize.transaction(async (dbTransaction) => {
    const row = await Transaction.findByPk(id, { transaction: dbTransaction, lock: dbTransaction.LOCK.UPDATE });
    if (!row) throw new AppError('معامله پیدا نشد.', 404);

    const englishKind = kindFromStored(row.kind);
    if (englishKind !== 'buy' && englishKind !== 'sell') {
      throw new AppError('فقط معاملات خرید و فروش قابل حذف هستند.');
    }

    if (row.state !== 'برگشت داده شد') {
      const { first: received, second: paid } = await getLockedBalancePair(
        row.cashboxId, row.fromCurrencyId, row.toCurrencyId, dbTransaction,
      );
      if (D(received.amount).lt(row.fromAmount)) {
        throw new AppError('موجودی ارز دریافتی برای حذف معامله کافی نیست.');
      }
      received.amount = fixed(D(received.amount).minus(row.fromAmount));
      paid.amount = fixed(D(paid.amount).plus(row.toAmount));
      await Promise.all([
        received.save({ transaction: dbTransaction }),
        paid.save({ transaction: dbTransaction }),
      ]);
      await JournalEntry.create({
        number: await documentNumber('JE', dbTransaction),
        entryDate: new Date().toISOString().slice(0, 10),
        description: `حذف معامله ${row.number}`,
        debitAccount: 'برگشت صندوق پرداختی',
        creditAccount: 'برگشت صندوق دریافتی',
        currencyId: row.toCurrencyId,
        amount: row.toAmount,
        branchId: row.branchId,
        createdByName: context.user.name,
      }, { transaction: dbTransaction });
    }

    const number = row.number;
    const deletedId = Number(row.id);
    await row.destroy({ transaction: dbTransaction });
    await writeAudit({
      req: context.req,
      user: context.user,
      action: `معامله ${number} حذف شد`,
      transaction: dbTransaction,
    });
    return { id: deletedId, number };
  });
}

export async function createCustomerLedgerEntry(customerId, payload, context) {
  return sequelize.transaction(async (dbTransaction) => {
    const [customer, currency] = await Promise.all([
      Customer.findByPk(customerId, { transaction: dbTransaction }),
      Currency.findByPk(payload.currencyId, { transaction: dbTransaction }),
    ]);
    if (!customer || !currency) throw new AppError('مشتری یا ارز پیدا نشد.', 404);
    const amount = D(payload.amount);
    if (amount.lte(0)) throw new AppError('مقدار باید بیشتر از صفر باشد.');

    const settleFromCurrencyId = payload.settleFromCurrencyId
      ? Number(payload.settleFromCurrencyId)
      : null;
    const crossSettle = payload.type === 'paid'
      && settleFromCurrencyId
      && settleFromCurrencyId !== Number(payload.currencyId);

    if (crossSettle) {
      const settleCurrency = await Currency.findByPk(settleFromCurrencyId, { transaction: dbTransaction });
      if (!settleCurrency) throw new AppError('ارز حساب کسر پیدا نشد.', 404);
      const rate = D(payload.rate);
      if (rate.lte(0)) throw new AppError('برای کسر از حساب ارز دیگر، نرخ الزامی است.');

      if (!payload.cashboxId) throw new AppError('برای پرداخت، انتخاب صندوق ضروری است.');
      const cashbox = await Cashbox.findByPk(payload.cashboxId, { transaction: dbTransaction });
      if (!cashbox || !cashbox.isActive) throw new AppError('صندوق انتخاب‌شده فعال نیست.');

      const cashBalance = await getBalance(payload.cashboxId, payload.currencyId, dbTransaction);
      await assertEnoughCashbox(
        cashBalance.amount,
        amount,
        `موجودی صندوق ${currency.code} کافی نیست.`,
      );
      cashBalance.amount = fixed(D(cashBalance.amount).minus(amount));
      await cashBalance.save({ transaction: dbTransaction });

      const settleAmount = calculateSettleFromAmount({
        settleCode: settleCurrency.code,
        payCode: currency.code,
        payAmount: amount,
        rate,
        fee: payload.fee || 0,
      });

      const [settleBalance] = await CustomerBalance.findOrCreate({
        where: { customerId, currencyId: settleFromCurrencyId },
        defaults: { amount: 0 },
        transaction: dbTransaction,
      });
      await settleBalance.reload({ transaction: dbTransaction, lock: dbTransaction.LOCK.UPDATE });
      const available = D(settleBalance.amount);
      if (available.lte(0)) {
        throw new AppError(`مشتری موجودی طلبکار ${settleCurrency.code} ندارد.`);
      }
      if (available.lt(settleAmount)) {
        throw new AppError(
          `موجودی حساب ${settleCurrency.code} کافی نیست. موجودی: ${fixed(available)} — لازم: ${fixed(settleAmount)}`,
        );
      }
      settleBalance.amount = fixed(available.minus(settleAmount));
      await settleBalance.save({ transaction: dbTransaction });

      const settleLabel = settleCurrency.name || settleCurrency.code;
      const payLabel = currency.name || currency.code;
      const note = payload.note
        || `پرداخت نقدی ${fixed(amount)} ${payLabel} — کسر از حساب ${settleLabel}`;

      const entry = await CustomerLedger.create({
        customerId,
        cashboxId: payload.cashboxId,
        currencyId: settleFromCurrencyId,
        type: 'paid',
        amount: fixed(settleAmount),
        number: await documentNumber('CL', dbTransaction),
        // ZH_PAY marks cashbox currency/amount (may differ from ledger currency on cross-settle)
        note: `${note} | نرخ: ${fixed(rate, 8)} | نقدی: ${fixed(amount)} ${currency.code} | ZH_PAY:${fixed(amount)}:${currency.id}`,
      }, { transaction: dbTransaction });

      await writeAudit({
        req: context.req,
        user: context.user,
        action: `پرداخت از حساب ${settleCurrency.code} مشتری ${customer.name}: نقدی ${fixed(amount)} ${currency.code} ← کسر ${fixed(settleAmount)} ${settleCurrency.code}`,
        transaction: dbTransaction,
      });

      return {
        entry,
        customer,
        currency: settleCurrency,
        settlement: {
          payCurrency: currency,
          payAmount: fixed(amount),
          settleCurrency,
          settleAmount: fixed(settleAmount),
          rate: fixed(rate, 8),
        },
      };
    }

    let cashbox = null;
    if (payload.type === 'opening') {
      const previousEntries = await CustomerLedger.count({ where: { customerId, currencyId: payload.currencyId }, transaction: dbTransaction });
      if (previousEntries > 0) throw new AppError('موجودی اول دوره فقط پیش از شروع گردش حساب ثبت می‌شود.');
      // Opening is account-only — no cashbox movement required.
    }
    const openingSide = payload.side === 'debtor' ? 'debtor' : 'creditor';
    if (payload.type !== 'opening') {
      if (!payload.cashboxId) throw new AppError('برای رسید یا پرداخت، انتخاب صندوق ضروری است.');
    }
    if (payload.cashboxId && payload.type !== 'opening') {
      cashbox = await Cashbox.findByPk(payload.cashboxId, { transaction: dbTransaction });
      if (!cashbox || !cashbox.isActive) throw new AppError('صندوق انتخاب‌شده فعال نیست.');
      const cashBalance = await getBalance(payload.cashboxId, payload.currencyId, dbTransaction);
      if (payload.type === 'received') {
        cashBalance.amount = fixed(D(cashBalance.amount).plus(amount));
      } else if (payload.type === 'paid') {
        await assertEnoughCashbox(
          cashBalance.amount,
          amount,
          `موجودی صندوق ${currency.code} کافی نیست.`,
        );
        cashBalance.amount = fixed(D(cashBalance.amount).minus(amount));
      } else throw new AppError('نوع عملیات حساب مشتری معتبر نیست.');
      await cashBalance.save({ transaction: dbTransaction });
    }
    const note = payload.note
      || (payload.type === 'opening'
        ? `موجودی اول دوره (${openingSide === 'debtor' ? 'قرضدار' : 'طلبکار'})`
        : null);
    // ZH_CB0 = cashbox-only (no customer account balance) — used by card-reader settle
    const entryNote = payload.skipCustomerBalance
      ? `${note || ''}${note ? ' | ' : ''}ZH_CB0`.trim()
      : note;
    const entry = await CustomerLedger.create({
      customerId,
      cashboxId: payload.type === 'opening' ? null : (payload.cashboxId || null),
      currencyId: payload.currencyId,
      type: payload.type, amount: fixed(amount), number: await documentNumber('CL', dbTransaction), note: entryNote,
    }, { transaction: dbTransaction });
    if (!payload.skipCustomerBalance) {
      const [balance] = await CustomerBalance.findOrCreate({
        where: { customerId, currencyId: payload.currencyId }, defaults: { amount: 0 }, transaction: dbTransaction,
      });
      if (payload.type === 'opening') {
        balance.amount = openingSide === 'debtor' ? fixed(amount.neg()) : fixed(amount);
      } else if (payload.type === 'received') balance.amount = fixed(D(balance.amount).plus(amount));
      else {
        // allowNegativeCustomerBalance: card-reader withdrawal may go below zero
        if (!payload.allowNegativeCustomerBalance && D(balance.amount).lt(amount)) {
          throw new AppError(
            `موجودی حساب مشتری کافی نیست. موجودی ${currency.code}: ${fixed(balance.amount)}`,
          );
        }
        balance.amount = fixed(D(balance.amount).minus(amount));
      }
      await balance.save({ transaction: dbTransaction });
    }
    await writeAudit({
      req: context.req,
      user: context.user,
      action: payload.skipCustomerBalance
        ? `کارت‌خوان (بدون حساب مشتری) ${customer.name}: ${payload.type} ${fixed(amount)} ${currency.code}`
        : `حساب مشتری ${customer.name}: ${payload.type} ${fixed(amount)} ${currency.code}`,
      transaction: dbTransaction,
    });
    return { entry, customer, currency };
  }).then(async (result) => {
    if (payload.skipNotify) {
      const data = result.entry.toJSON ? result.entry.toJSON() : result.entry;
      return { ...data, settlement: result.settlement || null, whatsapp: null };
    }
    const { queueNotifyLedgerEntry } = await import('./whatsapp.js');
    const whatsapp = await queueNotifyLedgerEntry(
      result.entry,
      result.customer,
      result.currency,
      result.settlement || null,
    );
    const data = result.entry.toJSON ? result.entry.toJSON() : result.entry;
    return { ...data, settlement: result.settlement || null, whatsapp };
  });
}

/** Parse cashbox pay side for cross-currency settle notes (ledger currency ≠ cash currency). */
function parseCrossSettleCashPay(note = '') {
  const text = String(note || '');
  const tagged = text.match(/\|\s*ZH_PAY:([\d.]+):(\d+)/);
  if (tagged) {
    return { amount: Number(tagged[1]), currencyId: Number(tagged[2]) };
  }
  const legacy = text.match(/\|\s*نقدی:\s*([\d.]+)\s+([A-Za-z]+)/);
  if (legacy) {
    return { amount: Number(legacy[1]), currencyCode: String(legacy[2]).toUpperCase() };
  }
  return null;
}

/** Reverse and delete a customer ledger entry (received / paid / opening). */
export async function deleteCustomerLedgerEntry(entryId, context) {
  return sequelize.transaction(async (dbTransaction) => {
    const entry = await CustomerLedger.findByPk(entryId, {
      include: ['customer', 'currency'],
      transaction: dbTransaction,
      lock: dbTransaction.LOCK.UPDATE,
    });
    if (!entry) throw new AppError('رکورد حساب پیدا نشد.', 404);
    const amount = D(entry.amount);
    const type = entry.type;

    if (entry.cashboxId && (type === 'received' || type === 'paid')) {
      const crossPay = type === 'paid' ? parseCrossSettleCashPay(entry.note) : null;
      let cashCurrencyId = entry.currencyId;
      let cashAmount = amount;
      if (crossPay) {
        cashAmount = D(crossPay.amount);
        if (crossPay.currencyId) {
          cashCurrencyId = crossPay.currencyId;
        } else if (crossPay.currencyCode) {
          const payCurrency = await Currency.findOne({
            where: { code: crossPay.currencyCode },
            transaction: dbTransaction,
          });
          if (!payCurrency) throw new AppError('ارز نقدی تسویه برای برگشت پیدا نشد.');
          cashCurrencyId = payCurrency.id;
        }
      }
      const cashBalance = await getBalance(entry.cashboxId, cashCurrencyId, dbTransaction);
      if (type === 'received') {
        await assertEnoughCashbox(
          cashBalance.amount,
          cashAmount,
          'موجودی صندوق برای برگشت رسید کافی نیست.',
        );
        cashBalance.amount = fixed(D(cashBalance.amount).minus(cashAmount));
      } else {
        cashBalance.amount = fixed(D(cashBalance.amount).plus(cashAmount));
      }
      await cashBalance.save({ transaction: dbTransaction });
    }

    const [balance] = await CustomerBalance.findOrCreate({
      where: { customerId: entry.customerId, currencyId: entry.currencyId },
      defaults: { amount: 0 },
      transaction: dbTransaction,
    });
    await balance.reload({ transaction: dbTransaction, lock: dbTransaction.LOCK.UPDATE });
    // Card-reader cashbox-only entries must not touch customer account on reverse either
    const skipCustomerBalance = /\bZH_CB0\b/.test(String(entry.note || ''))
      || Boolean(context?.skipCustomerBalance);
    if (!skipCustomerBalance) {
      if (type === 'received' || type === 'opening') {
        // opening creditor increased balance; opening debtor decreased — reverse both as received-like if amount stored positive with type
        if (type === 'opening' && D(balance.amount).lt(0)) {
          balance.amount = fixed(D(balance.amount).plus(amount));
        } else {
          balance.amount = fixed(D(balance.amount).minus(amount));
        }
      } else if (type === 'paid') {
        balance.amount = fixed(D(balance.amount).plus(amount));
      } else if (type === 'transfer_out') {
        balance.amount = fixed(D(balance.amount).minus(amount));
      } else if (type === 'transfer_in') {
        balance.amount = fixed(D(balance.amount).plus(amount));
      }
      await balance.save({ transaction: dbTransaction });
    }

    const customerName = entry.customer?.name || entry.customerId;
    await entry.destroy({ transaction: dbTransaction });
    await writeAudit({
      req: context.req,
      user: context.user,
      action: `حذف سند حساب مشتری ${customerName}: ${type} ${fixed(amount)}`,
      transaction: dbTransaction,
    });
    return { id: entryId };
  });
}

/**
 * Replace opening balances when the customer has no other ledger activity.
 * Pass [] to clear all openings.
 */
export async function replaceCustomerOpeningBalances(customerId, openingBalances = [], context = {}) {
  const entries = await CustomerLedger.findAll({
    where: { customerId },
    attributes: ['id', 'type'],
  });
  if (entries.some((e) => e.type !== 'opening')) {
    throw new AppError('چون این مشتری گردش حساب دارد، موجودی اول دوره قابل ویرایش نیست.', 409);
  }

  for (const entry of entries) {
    await deleteCustomerLedgerEntry(entry.id, context);
  }
  await CustomerBalance.destroy({ where: { customerId } });

  const rows = Array.isArray(openingBalances) ? openingBalances : [];
  for (const entry of rows) {
    const amount = Number(entry.amount || 0);
    if (!(amount > 0) || !entry.currencyId) continue;
    const side = entry.side === 'debtor' ? 'debtor' : 'creditor';
    await createCustomerLedgerEntry(customerId, {
      type: 'opening',
      currencyId: entry.currencyId,
      amount,
      side,
      note: `موجودی اول دوره (${side === 'debtor' ? 'قرضدار' : 'طلبکار'})`,
    }, context);
  }
}

/** True when every ledger row is type=opening (or there are none). */
export async function customerHasOnlyOpeningLedger(customerId) {
  const entries = await CustomerLedger.findAll({
    where: { customerId },
    attributes: ['type'],
  });
  return entries.every((e) => e.type === 'opening');
}

function openingSideFromNote(note) {
  const text = String(note || '');
  if (text.includes('قرضدار')) return 'debtor';
  if (text.includes('طلبکار')) return 'creditor';
  return 'creditor';
}

function ledgerBalanceEffect(entry) {
  const amount = Number(entry.amount || 0);
  const type = entry.type;
  if (type === 'opening') {
    return openingSideFromNote(entry.note) === 'debtor' ? -amount : amount;
  }
  if (type === 'received' || type === 'convert_in') return amount;
  if (type === 'paid' || type === 'convert_out') return -amount;
  if (type === 'transfer_out') return amount + parseSameCurrencyTransferFee(entry.note);
  if (type === 'transfer_in') return -amount;
  return 0;
}

function ledgerTypeKey(entry) {
  if (entry.type === 'opening') {
    return openingSideFromNote(entry.note) === 'debtor' ? 'opening_debtor' : 'opening_creditor';
  }
  return entry.type;
}

function cleanLedgerNote(note) {
  if (!note) return '';
  return String(note).replace(/\s*\|\s*ZH_FEE:[\d.]+/g, '').trim();
}

function runningSideOf(amount) {
  const value = D(amount);
  if (value.gt(0)) return 'creditor';
  if (value.lt(0)) return 'debtor';
  return 'settled';
}

function enrichLedgerRow(entry, running) {
  const effect = ledgerBalanceEffect(entry);
  const nextRunning = running.plus(effect);
  const effectNum = Number(fixed(effect));
  const displayAmount = Math.abs(effectNum);
  return {
    id: entry.id,
    number: entry.number,
    type: entry.type,
    typeKey: ledgerTypeKey(entry),
    amount: entry.amount,
    credit: effectNum > 0 ? fixed(displayAmount) : null,
    debit: effectNum < 0 ? fixed(displayAmount) : null,
    balanceEffect: fixed(effect),
    runningBalance: fixed(nextRunning),
    runningSide: runningSideOf(nextRunning),
    note: cleanLedgerNote(entry.note),
    rawNote: entry.note,
    isOpening: entry.type === 'opening',
    openingSide: entry.type === 'opening' ? openingSideFromNote(entry.note) : null,
    createdAt: entry.createdAt,
    currency: entry.currency,
    cashbox: entry.cashbox,
    currencyId: entry.currencyId,
    _running: nextRunning,
  };
}

/** Full customer ledger statement grouped by currency with running balances. */
export async function buildCustomerLedgerStatement(customerId, options = {}) {
  const customer = await Customer.findByPk(customerId);
  if (!customer) throw new AppError('مشتری پیدا نشد.', 404);

  const query = {
    where: { customerId },
    include: ['currency', 'cashbox'],
    order: [['id', 'ASC']],
  };
  if (options.limit) query.limit = options.limit;

  const [entries, balances] = await Promise.all([
    CustomerLedger.findAll(query),
    CustomerBalance.findAll({
      where: { customerId },
      include: ['currency'],
      order: [['currencyId', 'ASC']],
    }),
  ]);

  const byCurrency = new Map();
  for (const entry of entries) {
    if (!byCurrency.has(entry.currencyId)) byCurrency.set(entry.currencyId, []);
    byCurrency.get(entry.currencyId).push(entry);
  }
  for (const balance of balances) {
    if (!byCurrency.has(balance.currencyId)) byCurrency.set(balance.currencyId, []);
  }

  const currencyGroups = [];
  const allEntries = [];

  for (const currencyId of [...byCurrency.keys()].sort((a, b) => a - b)) {
    const rows = byCurrency.get(currencyId) || [];
    let running = D(0);
    const enrichedRows = rows.map((entry) => {
      const row = enrichLedgerRow(entry, running);
      running = row._running;
      delete row._running;
      allEntries.push(row);
      return row;
    });

    const balanceRow = balances.find((b) => b.currencyId === currencyId);
    const currentBalance = balanceRow ? balanceRow.amount : '0';
    const openingRow = enrichedRows.find((r) => r.isOpening);

    currencyGroups.push({
      currencyId,
      currency: balanceRow?.currency || rows[0]?.currency || null,
      currentBalance,
      currentSide: runningSideOf(currentBalance),
      openingBalance: openingRow ? openingRow.runningBalance : null,
      openingSide: openingRow?.openingSide || null,
      entries: enrichedRows,
      entryCount: enrichedRows.length,
    });
  }

  return { customer, balances, entries: allEntries, currencyGroups };
}

/** Convert customer account balance between currencies without touching cashbox. */
export async function convertCustomerBalance(customerId, payload, context) {
  return sequelize.transaction(async (dbTransaction) => {
    const [customer, fromCurrency, toCurrency] = await Promise.all([
      Customer.findByPk(customerId, { transaction: dbTransaction }),
      Currency.findByPk(payload.fromCurrencyId, { transaction: dbTransaction }),
      Currency.findByPk(payload.toCurrencyId, { transaction: dbTransaction }),
    ]);
    if (!customer) throw new AppError('مشتری پیدا نشد.', 404);
    if (!fromCurrency || !toCurrency) throw new AppError('ارز انتخاب‌شده پیدا نشد.', 404);
    if (Number(payload.fromCurrencyId) === Number(payload.toCurrencyId)) {
      throw new AppError('ارز مبدأ و مقصد نباید یکسان باشد.');
    }

    const { toAmount } = await calculateTransaction(payload);
    const fromAmount = D(payload.fromAmount);
    if (fromAmount.lte(0)) throw new AppError('مقدار باید بیشتر از صفر باشد.');

    const currencyIds = [Number(payload.fromCurrencyId), Number(payload.toCurrencyId)].sort((a, b) => a - b);
    const balanceMap = new Map();
    for (const currencyId of currencyIds) {
      const [row] = await CustomerBalance.findOrCreate({
        where: { customerId, currencyId },
        defaults: { amount: 0 },
        transaction: dbTransaction,
      });
      await row.reload({ transaction: dbTransaction, lock: dbTransaction.LOCK.UPDATE });
      balanceMap.set(currencyId, row);
    }

    const fromBalance = balanceMap.get(Number(payload.fromCurrencyId));
    const toBalance = balanceMap.get(Number(payload.toCurrencyId));
    const available = D(fromBalance.amount);
    if (available.lte(0)) {
      throw new AppError(`مشتری موجودی ${fromCurrency.code} قابل تبدیل ندارد.`);
    }
    if (available.lt(fromAmount)) {
      throw new AppError(`موجودی حساب مشتری کافی نیست. موجودی ${fromCurrency.code}: ${fixed(available)}`);
    }

    fromBalance.amount = fixed(available.minus(fromAmount));
    toBalance.amount = fixed(D(toBalance.amount).plus(toAmount));
    await fromBalance.save({ transaction: dbTransaction });
    await toBalance.save({ transaction: dbTransaction });

    const doc = await documentNumber('CV', dbTransaction);
    const noteBase = payload.note
      || `تبدیل حساب مشتری از ${fromCurrency.code} به ${toCurrency.code}`;
    const outEntry = await CustomerLedger.create({
      customerId,
      cashboxId: null,
      currencyId: payload.fromCurrencyId,
      type: 'convert_out',
      amount: fixed(fromAmount),
      number: `${doc}-OUT`,
      note: noteBase,
    }, { transaction: dbTransaction });
    const inEntry = await CustomerLedger.create({
      customerId,
      cashboxId: null,
      currencyId: payload.toCurrencyId,
      type: 'convert_in',
      amount: fixed(toAmount),
      number: `${doc}-IN`,
      note: `${noteBase} | نرخ: ${fixed(payload.rate, 8)} | فیس: ${fixed(payload.fee || 0)}`,
    }, { transaction: dbTransaction });

    await writeAudit({
      req: context.req,
      user: context.user,
      action: `تبدیل موجودی مشتری ${customer.name}: ${fixed(fromAmount)} ${fromCurrency.code} → ${toAmount} ${toCurrency.code}`,
      transaction: dbTransaction,
    });

    return {
      number: doc,
      fromAmount: fixed(fromAmount),
      toAmount,
      fromCurrency,
      toCurrency,
      customer,
      outEntry,
      inEntry,
      balances: [fromBalance, toBalance],
    };
  }).then(async (result) => {
    const { queueNotifyBalanceConvert } = await import('./whatsapp.js');
    const whatsapp = await queueNotifyBalanceConvert(result);
    return { ...result, whatsapp };
  });
}

async function lockCustomerBalance(customerId, currencyId, dbTransaction) {
  const [row] = await CustomerBalance.findOrCreate({
    where: { customerId, currencyId },
    defaults: { amount: 0 },
    transaction: dbTransaction,
  });
  await row.reload({ transaction: dbTransaction, lock: dbTransaction.LOCK.UPDATE });
  return row;
}

/** Move balance from one customer account to another (no cashbox). */
export async function transferCustomerBetweenCustomers(payload, context) {
  return sequelize.transaction(async (dbTransaction) => {
    const fromCustomerId = Number(payload.fromCustomerId);
    const toCustomerId = Number(payload.toCustomerId);
    const currencyId = Number(payload.currencyId);
    const feeCurrencyId = Number(payload.feeCurrencyId || currencyId);
    const amount = D(payload.amount);
    const fee = D(payload.fee || 0);

    if (fromCustomerId === toCustomerId) {
      throw new AppError('فرستنده و گیرنده نباید یکسان باشند.');
    }
    if (amount.lte(0)) throw new AppError('مقدار باید بیشتر از صفر باشد.');
    if (fee.lt(0)) throw new AppError('کمیشن معتبر نیست.');

    const [fromCustomer, toCustomer, currency, feeCurrency] = await Promise.all([
      Customer.findByPk(fromCustomerId, { transaction: dbTransaction }),
      Customer.findByPk(toCustomerId, { transaction: dbTransaction }),
      Currency.findByPk(currencyId, { transaction: dbTransaction }),
      Currency.findByPk(feeCurrencyId, { transaction: dbTransaction }),
    ]);
    if (!fromCustomer || !toCustomer) throw new AppError('مشتری پیدا نشد.', 404);
    if (!currency || !feeCurrency) throw new AppError('ارز پیدا نشد.', 404);

    const fromBalance = await lockCustomerBalance(fromCustomerId, currencyId, dbTransaction);
    const totalSenderCredit = feeCurrencyId === currencyId ? amount.plus(fee) : amount;

    // Hawala person-to-person (same as legacy sarafi convention):
    // Sender (فرستنده) → balance up (طلبکار); receiver (گیرنده) → balance down (قرضدار).
    // Example: 5000 receipt + 6000 hawala sent → 5000 + 6000 = 11000 creditor.
    fromBalance.amount = fixed(D(fromBalance.amount).plus(totalSenderCredit));
    await fromBalance.save({ transaction: dbTransaction });

    const toBalance = await lockCustomerBalance(toCustomerId, currencyId, dbTransaction);
    toBalance.amount = fixed(D(toBalance.amount).minus(amount));
    await toBalance.save({ transaction: dbTransaction });

    const doc = await documentNumber('CT', dbTransaction);
    const noteBase = payload.note?.trim()
      || `انتقال از ${fromCustomer.name} به ${toCustomer.name}`;
    const sameCurrencyFeeTag = fee.gt(0) && feeCurrencyId === currencyId
      ? ` | ZH_FEE:${fixed(fee)}`
      : '';

    const outEntry = await CustomerLedger.create({
      customerId: fromCustomerId,
      cashboxId: null,
      currencyId,
      type: 'transfer_out',
      amount: fixed(amount),
      number: `${doc}-OUT`,
      note: `${noteBase} → ${toCustomer.name}${sameCurrencyFeeTag}`,
    }, { transaction: dbTransaction });

    const inEntry = await CustomerLedger.create({
      customerId: toCustomerId,
      cashboxId: null,
      currencyId,
      type: 'transfer_in',
      amount: fixed(amount),
      number: `${doc}-IN`,
      note: `${noteBase} ← ${fromCustomer.name}`,
    }, { transaction: dbTransaction });

    let feeEntry = null;
    if (fee.gt(0) && feeCurrencyId !== currencyId) {
      const feeBalance = await lockCustomerBalance(fromCustomerId, feeCurrencyId, dbTransaction);
      feeBalance.amount = fixed(D(feeBalance.amount).minus(fee));
      await feeBalance.save({ transaction: dbTransaction });
      feeEntry = await CustomerLedger.create({
        customerId: fromCustomerId,
        cashboxId: null,
        currencyId: feeCurrencyId,
        type: 'paid',
        amount: fixed(fee),
        number: `${doc}-FEE`,
        note: `کمیشن انتقال ${doc}`,
      }, { transaction: dbTransaction });
    }

    await writeAudit({
      req: context.req,
      user: context.user,
      action: `انتقال حساب ${fromCustomer.name} → ${toCustomer.name}: ${fixed(amount)} ${currency.code}${fee.gt(0) ? ` + کمیشن ${fixed(fee)} ${feeCurrency.code}` : ''}`,
      transaction: dbTransaction,
    });

    return {
      number: doc,
      fromCustomer,
      toCustomer,
      currency,
      feeCurrency,
      amount: fixed(amount),
      fee: fixed(fee),
      outEntry,
      inEntry,
      feeEntry,
    };
  }).then(async (result) => {
    const { queueNotifyLedgerEntry } = await import('./whatsapp.js');
    const [whatsappOut, whatsappIn] = await Promise.all([
      queueNotifyLedgerEntry(result.outEntry, result.fromCustomer, result.currency),
      queueNotifyLedgerEntry(result.inEntry, result.toCustomer, result.currency),
    ]);
    return { ...result, whatsapp: whatsappOut || whatsappIn };
  });
}

export async function addCashboxOpeningBalance(cashboxId, currencyId, amount, context) {
  return sequelize.transaction(async (dbTransaction) => {
    const [cashbox, currency] = await Promise.all([
      Cashbox.findByPk(cashboxId, { transaction: dbTransaction }),
      Currency.findByPk(currencyId, { transaction: dbTransaction }),
    ]);
    if (!cashbox || !currency) throw new AppError('صندوق یا ارز پیدا نشد.', 404);
    const delta = D(amount);
    if (!delta.abs().gt(0)) throw new AppError('مبلغ موجودی اول دوره باید بیشتر از صفر باشد.');
    const balance = await getBalance(cashboxId, currencyId, dbTransaction);
    const oldAmount = D(balance.amount);
    const newAmount = fixed(oldAmount.plus(delta));
    if (D(newAmount).lt(0) && !(await isNegativeCashboxAllowed())) {
      throw new AppError('موجودی صندوق منفی نمی‌شود.');
    }
    balance.amount = newAmount;
    await balance.save({ transaction: dbTransaction });
    await JournalEntry.create({
      number: await documentNumber('JE', dbTransaction), entryDate: new Date().toISOString().slice(0, 10), description: `موجودی اول دوره ${cashbox.name}`,
      debitAccount: delta.gte(0) ? `صندوق ${currency.code}` : 'حساب اصلاح موجودی',
      creditAccount: delta.gte(0) ? 'حساب اصلاح موجودی' : `صندوق ${currency.code}`,
      currencyId, amount: fixed(delta.abs()), branchId: cashbox.branchId, createdByName: context.user.name,
    }, { transaction: dbTransaction });
    await writeAudit({
      req: context.req,
      user: context.user,
      action: `موجودی اول دوره ${cashbox.name} ${currency.code}: ${fixed(delta)} اضافه شد (از ${oldAmount} به ${newAmount})`,
      transaction: dbTransaction,
    });
    return balance;
  });
}

/** Move money from one cashbox to another (same currency). */
export async function transferCashboxBalance(payload, context) {
  return sequelize.transaction(async (dbTransaction) => {
    const fromId = Number(payload.fromCashboxId);
    const toId = Number(payload.toCashboxId);
    const currencyId = Number(payload.currencyId);
    const amount = D(payload.amount);
    if (fromId === toId) throw new AppError('صندوق مبدأ و مقصد نباید یکسان باشد.');
    if (!(amount.gt(0))) throw new AppError('مقدار انتقال باید بیشتر از صفر باشد.');

    const [fromBox, toBox, currency] = await Promise.all([
      Cashbox.findByPk(fromId, { transaction: dbTransaction }),
      Cashbox.findByPk(toId, { transaction: dbTransaction }),
      Currency.findByPk(currencyId, { transaction: dbTransaction }),
    ]);
    if (!fromBox || !toBox) throw new AppError('صندوق پیدا نشد.', 404);
    if (!fromBox.isActive || !toBox.isActive) throw new AppError('هر دو صندوق باید فعال باشند.');
    if (!currency) throw new AppError('ارز پیدا نشد.', 404);

    const fromBal = await getBalance(fromId, currencyId, dbTransaction);
    if (D(fromBal.amount).lt(amount)) {
      await assertEnoughCashbox(
        fromBal.amount,
        amount,
        `موجودی صندوق مبدأ ${currency.code} کافی نیست.`,
      );
    }
    const toBal = await getBalance(toId, currencyId, dbTransaction);

    fromBal.amount = fixed(D(fromBal.amount).minus(amount));
    toBal.amount = fixed(D(toBal.amount).plus(amount));
    await fromBal.save({ transaction: dbTransaction });
    await toBal.save({ transaction: dbTransaction });

    const note = payload.note
      ? String(payload.note).trim()
      : `انتقال از ${fromBox.name} به ${toBox.name}`;

    await JournalEntry.create({
      number: await documentNumber('JE', dbTransaction),
      entryDate: new Date().toISOString().slice(0, 10),
      description: note,
      debitAccount: `صندوق ${toBox.name} (${currency.code})`,
      creditAccount: `صندوق ${fromBox.name} (${currency.code})`,
      currencyId,
      amount: fixed(amount),
      branchId: fromBox.branchId,
      createdByName: context.user.name,
    }, { transaction: dbTransaction });

    await writeAudit({
      req: context.req,
      user: context.user,
      action: `انتقال ${fixed(amount)} ${currency.code} از صندوق ${fromBox.name} به ${toBox.name}`,
      transaction: dbTransaction,
    });

    return {
      fromCashbox: fromBox,
      toCashbox: toBox,
      currency,
      amount: fixed(amount),
      fromBalance: fromBal.amount,
      toBalance: toBal.amount,
    };
  });
}

async function creditRemittanceSource(cashboxId, currencyId, amount, feeCurrencyId, fee, dbTransaction) {
  const feeCurId = Number(feeCurrencyId || currencyId);
  const amt = D(amount);
  const feeAmt = D(fee || 0);
  if (feeCurId === Number(currencyId)) {
    const balance = await getBalance(cashboxId, currencyId, dbTransaction);
    balance.amount = fixed(D(balance.amount).plus(amt).plus(feeAmt));
    await balance.save({ transaction: dbTransaction });
    return;
  }
  const balance = await getBalance(cashboxId, currencyId, dbTransaction);
  balance.amount = fixed(D(balance.amount).plus(amt));
  await balance.save({ transaction: dbTransaction });
  if (feeAmt.gt(0)) {
    const feeBal = await getBalance(cashboxId, feeCurId, dbTransaction);
    feeBal.amount = fixed(D(feeBal.amount).plus(feeAmt));
    await feeBal.save({ transaction: dbTransaction });
  }
}

async function debitRemittanceSource(cashboxId, currencyId, amount, feeCurrencyId, fee, dbTransaction) {
  const feeCurId = Number(feeCurrencyId || currencyId);
  const amt = D(amount);
  const feeAmt = D(fee || 0);
  if (feeCurId === Number(currencyId)) {
    const total = amt.plus(feeAmt);
    const balance = await getBalance(cashboxId, currencyId, dbTransaction);
    if (D(balance.amount).lt(total)) {
      await assertEnoughCashbox(balance.amount, total, 'موجودی صندوق کافی نیست.');
    }
    balance.amount = fixed(D(balance.amount).minus(total));
    await balance.save({ transaction: dbTransaction });
    return;
  }
  const balance = await getBalance(cashboxId, currencyId, dbTransaction);
  await assertEnoughCashbox(balance.amount, amt, 'موجودی صندوق کافی نیست.');
  balance.amount = fixed(D(balance.amount).minus(amt));
  await balance.save({ transaction: dbTransaction });
  if (feeAmt.gt(0)) {
    const feeBal = await getBalance(cashboxId, feeCurId, dbTransaction);
    await assertEnoughCashbox(feeBal.amount, feeAmt, 'موجودی صندوق برای کمیشن کافی نیست.');
    feeBal.amount = fixed(D(feeBal.amount).minus(feeAmt));
    await feeBal.save({ transaction: dbTransaction });
  }
}

/**
 * مدل قطعی حواله:
 * - ثبت: از صندوق پرداخت مبدأ کم → به صندوق دریافت مقصد اضافه (بدون مرحله جداگانه رمز)
 * - کمیشن در مبدأ می‌ماند
 * - پرداخت با رمز (اختیاری/قدیمی): از صندوق دریافت مقصد به گیرنده کم می‌شود
 */
async function applyRemittanceOpen(sourceCashboxId, destCashboxId, currencyId, amount, feeCurrencyId, fee, dbTransaction) {
  if (!destCashboxId) throw new AppError('صندوق دریافت شعبه مقصد را انتخاب کنید.');
  await debitRemittanceSource(sourceCashboxId, currencyId, amount, currencyId, 0, dbTransaction);
  await creditRemittanceSource(destCashboxId, currencyId, amount, currencyId, 0, dbTransaction);
  const feeAmt = D(fee || 0);
  if (feeAmt.gt(0)) {
    const feeCur = feeCurrencyId || currencyId;
    await creditRemittanceSource(sourceCashboxId, feeCur, 0, feeCur, feeAmt, dbTransaction);
  }
}

async function reverseRemittanceOpen(sourceCashboxId, destCashboxId, currencyId, amount, feeCurrencyId, fee, dbTransaction) {
  if (!destCashboxId) throw new AppError('صندوق دریافت مقصد مشخص نیست.');
  await debitRemittanceSource(destCashboxId, currencyId, amount, currencyId, 0, dbTransaction);
  await creditRemittanceSource(sourceCashboxId, currencyId, amount, currencyId, 0, dbTransaction);
  const feeAmt = D(fee || 0);
  if (feeAmt.gt(0)) {
    const feeCur = feeCurrencyId || currencyId;
    await debitRemittanceSource(sourceCashboxId, feeCur, 0, feeCur, feeAmt, dbTransaction);
  }
}

async function deliverRemittancePayment(remittance, cashbox, context, dbTransaction) {
  if (!cashbox || Number(cashbox.branchId) !== Number(remittance.toBranchId)) {
    throw new AppError('صندوق دریافت مربوط به شعبه مقصد نیست.');
  }
  const balance = await getBalance(cashbox.id, remittance.currencyId, dbTransaction);
  await assertEnoughCashbox(
    balance.amount,
    remittance.amount,
    'موجودی صندوق دریافت شعبه مقصد کافی نیست.',
  );
  // تحویل به گیرنده از صندوق دریافت مقصد (پولی که موقع ثبت وارد شده)
  balance.amount = fixed(D(balance.amount).minus(remittance.amount));
  await balance.save({ transaction: dbTransaction });
  await remittance.update({
    state: 'پرداخت شده',
    destinationCashboxId: cashbox.id,
    paidAt: new Date(),
  }, { transaction: dbTransaction });
  await JournalEntry.create({
    number: await documentNumber('JE', dbTransaction), entryDate: new Date().toISOString().slice(0, 10),
    description: `پرداخت حواله ${remittance.number}`,
    debitAccount: 'حواله‌های پرداختنی', creditAccount: 'صندوق دریافت',
    currencyId: remittance.currencyId,
    amount: fixed(remittance.amount), branchId: remittance.toBranchId, createdByName: context.user.name,
  }, { transaction: dbTransaction });
}

export async function createRemittance(payload, context) {
  return sequelize.transaction(async (dbTransaction) => {
    const feeCurrencyId = payload.feeCurrencyId || payload.currencyId;
    const [fromBranch, toBranch, sourceCashbox, destCashbox, currency, feeCurrency] = await Promise.all([
      Branch.findByPk(payload.fromBranchId, { transaction: dbTransaction }),
      Branch.findByPk(payload.toBranchId, { transaction: dbTransaction }),
      Cashbox.findByPk(payload.sourceCashboxId, { transaction: dbTransaction }),
      payload.destinationCashboxId
        ? Cashbox.findByPk(payload.destinationCashboxId, { transaction: dbTransaction })
        : Promise.resolve(null),
      Currency.findByPk(payload.currencyId, { transaction: dbTransaction }),
      Currency.findByPk(feeCurrencyId, { transaction: dbTransaction }),
    ]);
    if (!fromBranch || !toBranch || !sourceCashbox || !currency || !feeCurrency) throw new AppError('معلومات حواله کامل نیست.');
    if (Number(fromBranch.id) === Number(toBranch.id)) throw new AppError('شعبه فرستنده و گیرنده نباید یکی باشد.');
    if (Number(sourceCashbox.branchId) !== Number(fromBranch.id)) throw new AppError('صندوق پرداخت مربوط به شعبه مبدأ نیست.');
    if (!destCashbox) throw new AppError('صندوق دریافت شعبه مقصد را انتخاب کنید.');
    if (Number(destCashbox.branchId) !== Number(toBranch.id)) throw new AppError('صندوق دریافت مربوط به شعبه مقصد نیست.');

    const amount = D(payload.amount);
    const fee = D(payload.fee || 0);
    if (amount.lte(0) || fee.lt(0)) throw new AppError('مقدار حواله یا کمیشن معتبر نیست.');

    // از صندوق مبدأ کم → به صندوق مقصد اضافه
    await applyRemittanceOpen(
      sourceCashbox.id,
      destCashbox.id,
      currency.id,
      amount,
      feeCurrency.id,
      fee,
      dbTransaction,
    );

    const remittance = await Remittance.create({
      number: await documentNumber('HV', dbTransaction), senderId: payload.senderId || null, receiverName: payload.receiverName,
      receiverPhone: payload.receiverPhone || null, fromBranchId: fromBranch.id, toBranchId: toBranch.id,
      currencyId: currency.id, sourceCashboxId: sourceCashbox.id,
      destinationCashboxId: destCashbox.id,
      amount: fixed(amount), fee: fixed(fee),
      feeCurrencyId: feeCurrency.id,
      secretNumber: String(Math.floor(100000 + Math.random() * 900000)),
      state: 'ثبت شده',
      note: payload.note || null,
    }, { transaction: dbTransaction });
    await JournalEntry.create({
      number: await documentNumber('JE', dbTransaction), entryDate: new Date().toISOString().slice(0,10),
      description: `انتقال حواله ${remittance.number} از مبدأ به مقصد`,
      debitAccount: 'صندوق دریافت مقصد', creditAccount: 'صندوق پرداخت مبدأ',
      currencyId: currency.id, amount: fixed(amount), branchId: fromBranch.id, createdByName: context.user.name,
    }, { transaction: dbTransaction });
    if (fee.gt(0)) {
      await JournalEntry.create({
        number: await documentNumber('JE', dbTransaction), entryDate: new Date().toISOString().slice(0, 10),
        description: `کمیشن حواله ${remittance.number}`,
        debitAccount: `صندوق ${feeCurrency.code}`, creditAccount: 'درآمد کمیشن حواله',
        currencyId: feeCurrency.id, amount: fixed(fee), branchId: fromBranch.id, createdByName: context.user.name,
      }, { transaction: dbTransaction });
    }
    await writeAudit({
      req: context.req,
      user: context.user,
      action: `حواله ${remittance.number} ثبت شد`,
      transaction: dbTransaction,
    });
    return remittance;
  }).then(async (remittance) => {
    const full = await Remittance.findByPk(remittance.id, {
      include: ['sender', 'currency', 'fromBranch', 'toBranch'],
    });
    const { queueNotifyRemittance } = await import('./whatsapp.js');
    const whatsapp = await queueNotifyRemittance(full, 'remittance_created');
    const data = full.toJSON();
    data.whatsapp = whatsapp;
    return data;
  });
}

export async function payRemittance(id, payload, context) {
  return sequelize.transaction(async (dbTransaction) => {
    const remittance = await Remittance.findByPk(id, { transaction: dbTransaction, lock: dbTransaction.LOCK.UPDATE });
    if (!remittance) throw new AppError('حواله پیدا نشد.', 404);
    if (remittance.state === 'پرداخت شده') throw new AppError('این حواله قبلاً پرداخت شده است.');
    if (remittance.state === 'لغو شده') throw new AppError('حواله لغو شده قابل پرداخت نیست.');
    if (String(payload.secretNumber) !== String(remittance.secretNumber)) throw new AppError('نمبر رمز حواله درست نیست.');
    const cashboxId = payload.destinationCashboxId || remittance.destinationCashboxId;
    const cashbox = await Cashbox.findByPk(cashboxId, { transaction: dbTransaction });
    await deliverRemittancePayment(remittance, cashbox, context, dbTransaction);
    await writeAudit({ req: context.req, user: context.user, action: `حواله ${remittance.number} پرداخت شد`, transaction: dbTransaction });
    return remittance;
  }).then(async (remittance) => {
    const full = await Remittance.findByPk(remittance.id, {
      include: ['sender', 'currency', 'fromBranch', 'toBranch'],
    });
    const { queueNotifyRemittance } = await import('./whatsapp.js');
    const whatsapp = await queueNotifyRemittance(full, 'remittance_paid');
    const data = full.toJSON();
    data.whatsapp = whatsapp;
    return data;
  });
}

export async function updateRemittance(id, payload, context) {
  return sequelize.transaction(async (dbTransaction) => {
    const remittance = await Remittance.findByPk(id, { transaction: dbTransaction, lock: dbTransaction.LOCK.UPDATE });
    if (!remittance) throw new AppError('حواله پیدا نشد.', 404);
    if (remittance.state !== 'در انتظار پرداخت') throw new AppError('فقط حواله در انتظار پرداخت قابل اصلاح است.');

    const feeCurrencyId = payload.feeCurrencyId || payload.currencyId;
    const [fromBranch, toBranch, sourceCashbox, destCashbox, currency, feeCurrency] = await Promise.all([
      Branch.findByPk(payload.fromBranchId, { transaction: dbTransaction }),
      Branch.findByPk(payload.toBranchId, { transaction: dbTransaction }),
      Cashbox.findByPk(payload.sourceCashboxId, { transaction: dbTransaction }),
      payload.destinationCashboxId
        ? Cashbox.findByPk(payload.destinationCashboxId, { transaction: dbTransaction })
        : Promise.resolve(null),
      Currency.findByPk(payload.currencyId, { transaction: dbTransaction }),
      Currency.findByPk(feeCurrencyId, { transaction: dbTransaction }),
    ]);
    if (!fromBranch || !toBranch || !sourceCashbox || !currency || !feeCurrency) throw new AppError('معلومات حواله کامل نیست.');
    if (Number(fromBranch.id) === Number(toBranch.id)) throw new AppError('شعبه فرستنده و گیرنده نباید یکی باشد.');
    if (Number(sourceCashbox.branchId) !== Number(fromBranch.id)) throw new AppError('صندوق پرداخت مربوط به شعبه مبدأ نیست.');
    if (!destCashbox) throw new AppError('صندوق دریافت شعبه مقصد را انتخاب کنید.');
    if (Number(destCashbox.branchId) !== Number(toBranch.id)) throw new AppError('صندوق دریافت مربوط به شعبه مقصد نیست.');

    const nextAmount = D(payload.amount);
    const nextFee = D(payload.fee || 0);
    if (nextAmount.lte(0) || nextFee.lt(0)) throw new AppError('مقدار حواله یا کمیشن معتبر نیست.');

    await reverseRemittanceOpen(
      remittance.sourceCashboxId,
      remittance.destinationCashboxId,
      remittance.currencyId,
      remittance.amount,
      remittance.feeCurrencyId || remittance.currencyId,
      remittance.fee,
      dbTransaction,
    );
    await applyRemittanceOpen(
      sourceCashbox.id,
      destCashbox.id,
      currency.id,
      nextAmount,
      feeCurrency.id,
      nextFee,
      dbTransaction,
    );

    await remittance.update({
      senderId: payload.senderId || null,
      receiverName: payload.receiverName,
      receiverPhone: payload.receiverPhone || null,
      fromBranchId: fromBranch.id,
      toBranchId: toBranch.id,
      currencyId: currency.id,
      sourceCashboxId: sourceCashbox.id,
      destinationCashboxId: destCashbox.id,
      amount: fixed(nextAmount),
      fee: fixed(nextFee),
      feeCurrencyId: feeCurrency.id,
      note: payload.note || null,
    }, { transaction: dbTransaction });

    await JournalEntry.create({
      number: await documentNumber('JE', dbTransaction), entryDate: new Date().toISOString().slice(0, 10),
      description: `اصلاح حواله ${remittance.number}`,
      debitAccount: 'صندوق دریافت مقصد', creditAccount: 'صندوق پرداخت مبدأ',
      currencyId: currency.id, amount: fixed(nextAmount), branchId: fromBranch.id, createdByName: context.user.name,
    }, { transaction: dbTransaction });
    await writeAudit({ req: context.req, user: context.user, action: `حواله ${remittance.number} اصلاح شد`, transaction: dbTransaction });
    return remittance;
  });
}

function remittanceLifecycle(row) {
  const state = String(row?.state || '');
  if (row?.cancelledAt || state.includes('لغو') || /cancel/i.test(state)) return 'cancelled';
  if (row?.paidAt || state.includes('پرداخت شده') || state.includes('پرداخت‌شده') || /paid/i.test(state)) {
    return 'paid';
  }
  if (state.includes('ثبت شده') || /registered/i.test(state)) return 'registered';
  return 'pending';
}

export async function cancelRemittance(id, context) {
  return sequelize.transaction(async (dbTransaction) => {
    const remittance = await Remittance.findByPk(id, {
      transaction: dbTransaction,
      lock: dbTransaction.LOCK.UPDATE,
      include: ['sender', 'currency', 'fromBranch', 'toBranch'],
    });
    if (!remittance) throw new AppError('حواله پیدا نشد.', 404);

    const snapshot = remittance.toJSON();
    const life = remittanceLifecycle(remittance);

    if (life !== 'cancelled') {
      if (life === 'paid') {
        if (!remittance.destinationCashboxId) {
          throw new AppError('صندوق دریافت مقصد مشخص نیست و لغو ممکن نیست.');
        }
        const destBal = await getBalance(remittance.destinationCashboxId, remittance.currencyId, dbTransaction);
        destBal.amount = fixed(D(destBal.amount).plus(remittance.amount));
        await destBal.save({ transaction: dbTransaction });
        await JournalEntry.create({
          number: await documentNumber('JE', dbTransaction), entryDate: new Date().toISOString().slice(0, 10),
          description: `برگشت پرداخت حواله ${remittance.number}`,
          debitAccount: 'صندوق دریافت', creditAccount: 'حواله‌های پرداختنی',
          currencyId: remittance.currencyId, amount: remittance.amount,
          branchId: remittance.toBranchId, createdByName: context.user.name,
        }, { transaction: dbTransaction });
      }

      await reverseRemittanceOpen(
        remittance.sourceCashboxId,
        remittance.destinationCashboxId,
        remittance.currencyId,
        remittance.amount,
        remittance.feeCurrencyId || remittance.currencyId,
        remittance.fee,
        dbTransaction,
      );

      await JournalEntry.create({
        number: await documentNumber('JE', dbTransaction), entryDate: new Date().toISOString().slice(0, 10),
        description: `لغو و حذف حواله ${remittance.number}`,
        debitAccount: 'حواله‌های پرداختنی', creditAccount: 'صندوق برگشت حواله',
        currencyId: remittance.currencyId, amount: fixed(remittance.amount),
        branchId: remittance.fromBranchId, createdByName: context.user.name,
      }, { transaction: dbTransaction });
    }

    await writeAudit({
      req: context.req,
      user: context.user,
      action: `حواله ${remittance.number} لغو و حذف شد`,
      transaction: dbTransaction,
    });
    await remittance.destroy({ transaction: dbTransaction });
    return snapshot;
  }).then(async (snapshot) => {
    const { queueNotifyRemittance } = await import('./whatsapp.js');
    const whatsapp = await queueNotifyRemittance(snapshot, 'remittance_cancelled');
    return { ...snapshot, whatsapp };
  });
}

export async function createExpense(payload, context) {
  return sequelize.transaction(async (dbTransaction) => {
    const amount = D(payload.amount);
    if (amount.lte(0)) throw new AppError('مبلغ هزینه باید بیشتر از صفر باشد.');

    const cashbox = await Cashbox.findByPk(payload.cashboxId, { transaction: dbTransaction });
    if (!cashbox || !cashbox.isActive) throw new AppError('صندوق انتخاب‌شده فعال نیست.');

    const currency = await Currency.findByPk(payload.currencyId, { transaction: dbTransaction });
    if (!currency || !currency.isActive) throw new AppError('ارز انتخاب‌شده فعال نیست.');

    const balance = await getBalance(cashbox.id, currency.id, dbTransaction);
    await assertEnoughCashbox(
      balance.amount,
      amount,
      `موجودی صندوق ${currency.code} کافی نیست.`,
    );

    balance.amount = fixed(D(balance.amount).minus(amount));
    await balance.save({ transaction: dbTransaction });

    const number = await documentNumber('EX', dbTransaction);
    const category = String(payload.category || 'عمومی').trim() || 'عمومی';
    const description = String(payload.description || category).trim() || category;
    const entryDate = payload.entryDate || new Date().toISOString().slice(0, 10);

    const journal = await JournalEntry.create({
      number: await documentNumber('JE', dbTransaction),
      entryDate,
      description: `هزینه: ${description}`,
      debitAccount: `هزینه — ${category}`,
      creditAccount: `صندوق ${currency.code}`,
      currencyId: currency.id,
      amount: fixed(amount),
      branchId: cashbox.branchId,
      createdByName: context.user?.name,
    }, { transaction: dbTransaction });

    const expense = await Expense.create({
      number,
      branchId: cashbox.branchId,
      cashboxId: cashbox.id,
      currencyId: currency.id,
      amount: fixed(amount),
      category,
      description,
      note: payload.note || null,
      entryDate,
      journalEntryId: journal.id,
      createdByName: context.user?.name,
    }, { transaction: dbTransaction });

    await writeAudit({
      req: context.req,
      user: context.user,
      action: `هزینه ${number} از صندوق ${cashbox.name} ثبت شد`,
      transaction: dbTransaction,
    });

    return expense;
  }).then((expense) => Expense.findByPk(expense.id, {
    include: ['cashbox', 'currency', 'branch'],
  }));
}

export async function deleteExpense(id, context) {
  return sequelize.transaction(async (dbTransaction) => {
    const expense = await Expense.findByPk(id, {
      transaction: dbTransaction,
      lock: dbTransaction.LOCK.UPDATE,
    });
    if (!expense) throw new AppError('هزینه پیدا نشد.', 404);

    const balance = await getBalance(expense.cashboxId, expense.currencyId, dbTransaction);
    balance.amount = fixed(D(balance.amount).plus(expense.amount));
    await balance.save({ transaction: dbTransaction });

    if (expense.journalEntryId) {
      const journal = await JournalEntry.findByPk(expense.journalEntryId, { transaction: dbTransaction });
      if (journal) await journal.destroy({ transaction: dbTransaction });
    }

    const number = expense.number;
    await expense.destroy({ transaction: dbTransaction });

    await writeAudit({
      req: context.req,
      user: context.user,
      action: `هزینه ${number} حذف و به صندوق برگشت داده شد`,
      transaction: dbTransaction,
    });

    return { id: Number(id), number };
  });
}

const CASHBOX_TRANSFER_NOTES = {
  person_to_cashbox: 'انتقال از مشتری به صندوق',
  cashbox_to_person: 'انتقال از صندوق به مشتری',
};

/** Account-level hawala rows (person-to-person / person-cashbox) for remittance list. */
export async function listAccountTransferRows(search = '') {
  const q = String(search || '').trim().toLowerCase();

  const [outRows, cashboxRows, currencies] = await Promise.all([
    CustomerLedger.findAll({
      where: { type: 'transfer_out' },
      include: [
        { association: 'customer', attributes: ['id', 'name', 'phone'] },
        { association: 'currency' },
      ],
      order: [['id', 'DESC']],
    }),
    CustomerLedger.findAll({
      where: {
        [Op.or]: [
          { type: 'received', note: { [Op.like]: `%${CASHBOX_TRANSFER_NOTES.person_to_cashbox}%` } },
          { type: 'paid', note: { [Op.like]: `%${CASHBOX_TRANSFER_NOTES.cashbox_to_person}%` } },
        ],
      },
      include: [
        { association: 'customer', attributes: ['id', 'name', 'phone'] },
        { association: 'currency' },
        { association: 'cashbox', include: [{ association: 'branch', attributes: ['id', 'name'] }] },
      ],
      order: [['id', 'DESC']],
    }),
    Currency.findAll({ attributes: ['id', 'code', 'name', 'symbol'] }),
  ]);

  const currencyById = new Map(currencies.map((c) => [c.id, c]));
  const inNumbers = outRows.map((row) => String(row.number).replace(/-OUT$/, '-IN'));
  const feeNumbers = outRows.map((row) => String(row.number).replace(/-OUT$/, '-FEE'));
  const relatedNumbers = [...inNumbers, ...feeNumbers].filter(Boolean);

  const relatedEntries = relatedNumbers.length
    ? await CustomerLedger.findAll({
      where: { number: { [Op.in]: relatedNumbers } },
      include: [{ association: 'customer', attributes: ['id', 'name', 'phone'] }],
    })
    : [];
  const relatedByNumber = new Map(relatedEntries.map((row) => [row.number, row]));

  const matches = (row) => {
    if (!q) return true;
    const hay = [
      row.number,
      row.sender?.name,
      row.receiverName,
      row.note,
      row.cashbox?.name,
    ].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q);
  };

  const rows = [];

  for (const out of outRows) {
    const baseNumber = String(out.number).replace(/-OUT$/, '');
    const inEntry = relatedByNumber.get(`${baseNumber}-IN`);
    const feeEntry = relatedByNumber.get(`${baseNumber}-FEE`);
    const sameCurrencyFee = parseSameCurrencyTransferFee(out.note);
    const listedFee = feeEntry ? Number(feeEntry.amount || 0) : sameCurrencyFee;
    const row = {
      id: `ct-${out.id}`,
      ledgerId: out.id,
      rowKind: 'account_transfer',
      direction: 'person_to_person',
      number: baseNumber,
      sender: out.customer || null,
      receiverName: inEntry?.customer?.name || '—',
      receiverCustomer: inEntry?.customer || null,
      fromCustomerId: out.customerId,
      toCustomerId: inEntry?.customerId || null,
      amount: Number(out.amount || 0),
      fee: listedFee,
      feeCurrencyId: feeEntry?.currencyId || out.currencyId,
      feeCurrency: feeEntry ? (currencyById.get(feeEntry.currencyId) || out.currency) : out.currency,
      currency: out.currency,
      currencyId: out.currencyId,
      cashbox: null,
      cashboxId: null,
      state: 'ثبت شده',
      note: out.note || null,
      createdAt: out.createdAt,
    };
    if (matches(row)) rows.push(row);
  }

  for (const entry of cashboxRows) {
    const toCashbox = entry.type === 'received';
    const row = {
      id: `ct-${entry.id}`,
      ledgerId: entry.id,
      rowKind: 'account_transfer',
      direction: toCashbox ? 'person_to_cashbox' : 'cashbox_to_person',
      number: entry.number,
      sender: toCashbox ? (entry.customer || null) : null,
      receiverName: toCashbox ? (entry.cashbox?.name || '—') : (entry.customer?.name || '—'),
      receiverCustomer: toCashbox ? null : (entry.customer || null),
      fromCustomerId: toCashbox ? entry.customerId : null,
      toCustomerId: toCashbox ? null : entry.customerId,
      amount: Number(entry.amount || 0),
      fee: 0,
      feeCurrencyId: entry.currencyId,
      feeCurrency: entry.currency,
      currency: entry.currency,
      currencyId: entry.currencyId,
      cashbox: entry.cashbox || null,
      cashboxId: entry.cashboxId,
      state: 'ثبت شده',
      note: entry.note || null,
      createdAt: entry.createdAt,
    };
    if (matches(row)) rows.push(row);
  }

  return rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function parseSameCurrencyTransferFee(note = '') {
  const match = String(note || '').match(/\|\s*ZH_FEE:([\d.]+)/);
  return match ? Number(match[1]) : 0;
}

function isCashboxAccountTransfer(entry) {
  const note = String(entry?.note || '');
  return (entry.type === 'received' && note.includes(CASHBOX_TRANSFER_NOTES.person_to_cashbox))
    || (entry.type === 'paid' && note.includes(CASHBOX_TRANSFER_NOTES.cashbox_to_person));
}

async function resolveP2pTransferEntries(ledgerId, dbTransaction) {
  const outEntry = await CustomerLedger.findByPk(ledgerId, {
    transaction: dbTransaction,
    lock: dbTransaction.LOCK.UPDATE,
  });
  if (!outEntry || outEntry.type !== 'transfer_out') {
    throw new AppError('حواله شخص به شخص پیدا نشد.', 404);
  }
  const baseNumber = String(outEntry.number).replace(/-OUT$/, '');
  const [inEntry, feeEntry] = await Promise.all([
    CustomerLedger.findOne({
      where: { number: `${baseNumber}-IN` },
      transaction: dbTransaction,
      lock: dbTransaction.LOCK.UPDATE,
    }),
    CustomerLedger.findOne({
      where: { number: `${baseNumber}-FEE` },
      transaction: dbTransaction,
      lock: dbTransaction.LOCK.UPDATE,
    }),
  ]);
  return { outEntry, inEntry, feeEntry, baseNumber };
}

/** Delete account hawala (person-to-person or person/cashbox). */
export async function deleteAccountTransfer(ledgerId, context) {
  const entry = await CustomerLedger.findByPk(ledgerId);
  if (!entry) throw new AppError('حواله پیدا نشد.', 404);

  if (isCashboxAccountTransfer(entry)) {
    await deleteCustomerLedgerEntry(ledgerId, context);
    return { id: ledgerId, number: entry.number };
  }

  if (entry.type !== 'transfer_out') {
    throw new AppError('این رکورد حواله حساب نیست.', 400);
  }

  return sequelize.transaction(async (dbTransaction) => {
    const { outEntry, inEntry, feeEntry } = await resolveP2pTransferEntries(ledgerId, dbTransaction);
    const amount = D(outEntry.amount);
    const sameCurrencyFee = D(parseSameCurrencyTransferFee(outEntry.note));

    const fromBalance = await lockCustomerBalance(outEntry.customerId, outEntry.currencyId, dbTransaction);
    fromBalance.amount = fixed(D(fromBalance.amount).minus(amount.plus(sameCurrencyFee)));
    await fromBalance.save({ transaction: dbTransaction });

    if (inEntry) {
      const toBalance = await lockCustomerBalance(inEntry.customerId, inEntry.currencyId, dbTransaction);
      toBalance.amount = fixed(D(toBalance.amount).plus(inEntry.amount));
      await toBalance.save({ transaction: dbTransaction });
      await inEntry.destroy({ transaction: dbTransaction });
    }

    if (feeEntry) {
      const feeBalance = await lockCustomerBalance(feeEntry.customerId, feeEntry.currencyId, dbTransaction);
      feeBalance.amount = fixed(D(feeBalance.amount).plus(feeEntry.amount));
      await feeBalance.save({ transaction: dbTransaction });
      await feeEntry.destroy({ transaction: dbTransaction });
    }

    await outEntry.destroy({ transaction: dbTransaction });
    await writeAudit({
      req: context.req,
      user: context.user,
      action: `حذف حواله حساب ${String(outEntry.number).replace(/-OUT$/, '')}`,
      transaction: dbTransaction,
    });
    return { id: ledgerId, number: String(outEntry.number).replace(/-OUT$/, '') };
  });
}

/** Replace an account hawala with new values. */
export async function updateAccountTransfer(ledgerId, payload, context) {
  const existing = await CustomerLedger.findByPk(ledgerId);
  if (!existing) throw new AppError('حواله پیدا نشد.', 404);

  await deleteAccountTransfer(ledgerId, context);

  if (payload.direction === 'person_to_person') {
    return transferCustomerBetweenCustomers({
      fromCustomerId: payload.fromCustomerId,
      toCustomerId: payload.toCustomerId,
      currencyId: payload.currencyId,
      amount: payload.amount,
      fee: payload.fee,
      feeCurrencyId: payload.feeCurrencyId || payload.currencyId,
      note: payload.note,
    }, context);
  }

  if (payload.direction === 'person_to_cashbox') {
    return createCustomerLedgerEntry(payload.fromCustomerId, {
      type: 'received',
      cashboxId: payload.cashboxId,
      currencyId: payload.currencyId,
      amount: payload.amount,
      note: payload.note || CASHBOX_TRANSFER_NOTES.person_to_cashbox,
    }, context);
  }

  return createCustomerLedgerEntry(payload.toCustomerId, {
    type: 'paid',
    cashboxId: payload.cashboxId,
    currencyId: payload.currencyId,
    amount: payload.amount,
    note: payload.note || CASHBOX_TRANSFER_NOTES.cashbox_to_person,
  }, context);
}

export const transactionIncludes = [
  { association: 'customer' }, { association: 'branch' }, { association: 'cashbox' },
  { association: 'fromCurrency' }, { association: 'toCurrency' },
];
