import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePaidAmount } from '../src/services/calculation.js';

test('multiplies foreign currency by rate', () => {
  assert.equal(calculatePaidAmount({ fromCode: 'USD', toCode: 'AFN', fromAmount: 10, rate: 70, fee: 0 }), '700');
});

test('divides AFN by rate for foreign payout', () => {
  assert.equal(calculatePaidAmount({ fromCode: 'AFN', toCode: 'USD', fromAmount: 700, rate: 70, fee: 0 }), '10');
});

test('subtracts fee from payout', () => {
  assert.equal(calculatePaidAmount({ fromCode: 'USD', toCode: 'AFN', fromAmount: 10, rate: 70, fee: 5 }), '695');
});
