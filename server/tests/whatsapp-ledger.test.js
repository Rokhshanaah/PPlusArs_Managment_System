import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLedgerStatementWhatsappBody } from '../src/services/whatsapp.js';

const sample = {
  customer: { id: 7, name: 'سارا' },
  currencyGroups: [{
    currentBalance: 10000,
    currentSide: 'creditor',
    currency: { code: 'AFN', symbol: '؋' },
    entries: [{
      typeKey: 'opening_creditor',
      type: 'موجودی اول دوره',
      number: '1',
      credit: 10000,
      debit: 0,
      runningBalance: 10000,
      runningSide: 'creditor',
      note: 'موجودی اول دوره (طلبکار)',
      createdAt: new Date('2026-09-15T10:00:00Z'),
    }],
  }],
};

test('Dari ledger WhatsApp message is labeled and multi-line', () => {
  const body = buildLedgerStatementWhatsappBody(sample, { company_name: 'زرین‌حساب' }, 'fa');
  assert.match(body, /صرافی زرین‌حساب/);
  assert.match(body, /گردش حساب مشتری/);
  assert.match(body, /مشتری:/);
  assert.match(body, /مانده فعلی/);
  assert.match(body, /طلبکار/);
  assert.match(body, /موجودی اول \(طلبکار\)/);
  assert.match(body, /10,000/);
  assert.match(body, /\*7\*/);
  assert.match(body, /با احترام/);
  assert.equal(body.includes(' | '), false);
  assert.equal(body.includes('موجودی اول دوره'), false);
  assert.equal(body.includes('۱۰'), false);
});

test('Pashto ledger WhatsApp message uses Pashto labels', () => {
  const body = buildLedgerStatementWhatsappBody(sample, { company_name: 'زرین‌حساب' }, 'ps');
  assert.match(body, /صرافي زرین‌حساب/);
  assert.match(body, /د حساب گردش/);
  assert.match(body, /پېرودونکی:/);
  assert.match(body, /اوسنی پاتې شونی/);
  assert.match(body, /د پیل بیلانس \(طلبکار\)/);
  assert.match(body, /10,000/);
  assert.match(body, /په درناوي/);
  assert.equal(body.includes('گردش حساب مشتری'), false);
  assert.equal(body.includes('۱۰'), false);
});

test('English ledger WhatsApp message uses English labels and Latin digits', () => {
  const body = buildLedgerStatementWhatsappBody(sample, { company_name: 'زرین‌حساب' }, 'en');
  assert.match(body, /Customer ledger/);
  assert.match(body, /Customer:/);
  assert.match(body, /Current balance/);
  assert.match(body, /creditor/);
  assert.match(body, /Opening \(creditor\)/);
  assert.match(body, /10,000/);
  assert.match(body, /With respect/);
  assert.equal(body.includes('مانده فعلی'), false);
  assert.equal(body.includes('۱۰٬۰۰۰'), false);
});
