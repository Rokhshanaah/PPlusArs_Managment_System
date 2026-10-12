import Decimal from 'decimal.js';
import { AppError } from '../utils/AppError.js';
export function calculatePaidAmount({fromCode,toCode,fromAmount,rate,fee=0}){const amount=new Decimal(fromAmount||0),r=new Decimal(rate||0),f=new Decimal(fee||0);if(amount.lte(0)||r.lte(0)||f.lt(0))throw new AppError('مقدار و نرخ باید بیشتر از صفر باشد.');const paid=String(fromCode).toUpperCase()==='AFN'&&String(toCode).toUpperCase()!=='AFN'?amount.div(r).minus(f):amount.mul(r).minus(f);if(paid.lte(0))throw new AppError('مبلغ نهایی پرداختی باید بیشتر از صفر باشد.');return paid.toDecimalPlaces(6).toString();}

/** Derive stored rate when user enters payout amount directly (no rate field). */
export function deriveRateFromAmounts({ fromCode, toCode, fromAmount, toAmount, fee = 0 }) {
  const amount = new Decimal(fromAmount || 0);
  const paid = new Decimal(toAmount || 0);
  const f = new Decimal(fee || 0);
  if (amount.lte(0) || paid.lte(0) || f.lt(0)) {
    throw new AppError('مقدار دریافتی و پرداختی باید بیشتر از صفر باشد.');
  }
  const fromAfn = String(fromCode).toUpperCase() === 'AFN';
  const toForeign = String(toCode).toUpperCase() !== 'AFN';
  const rate = fromAfn && toForeign
    ? amount.div(paid.plus(f))
    : paid.plus(f).div(amount);
  if (rate.lte(0)) throw new AppError('نرخ محاسبه‌شده معتبر نیست.');
  return rate.toDecimalPlaces(8).toString();
}
