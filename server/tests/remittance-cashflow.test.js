import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const accountingSrc = readFileSync(join(root, 'src/services/accounting.js'), 'utf8');
const movementsSrc = readFileSync(join(root, 'src/routes/master-data.js'), 'utf8');
const remittancesUi = readFileSync(join(root, '../frontend/src/pages/RemittancesPage.jsx'), 'utf8');
const i18nSrc = readFileSync(join(root, '../frontend/src/i18n.js'), 'utf8');

test('create remittance: debit source and credit destination on register', () => {
  assert.match(accountingSrc, /async function applyRemittanceOpen/);
  assert.match(accountingSrc, /await debitRemittanceSource\(sourceCashboxId/);
  assert.match(accountingSrc, /await creditRemittanceSource\(destCashboxId/);
  const createBlock = accountingSrc.slice(
    accountingSrc.indexOf('export async function createRemittance'),
    accountingSrc.indexOf('export async function payRemittance'),
  );
  assert.match(createBlock, /await applyRemittanceOpen\(/);
  assert.match(createBlock, /state: 'ثبت شده'/);
  assert.doesNotMatch(createBlock, /await deliverRemittancePayment\(/);
  assert.doesNotMatch(createBlock, /receiveRemittanceAtDestination/);
});

test('pay remittance: reuses deliver helper for legacy pending rows', () => {
  const payBlock = accountingSrc.slice(
    accountingSrc.indexOf('export async function payRemittance'),
    accountingSrc.indexOf('export async function updateRemittance'),
  );
  assert.match(payBlock, /await deliverRemittancePayment\(/);
  assert.doesNotMatch(payBlock, /receiveRemittanceAtDestination/);
  assert.doesNotMatch(payBlock, /creditRemittanceSource\(/);
});

test('cashbox movements: out on source at create, in on dest at create, out on dest when paid', () => {
  assert.match(movementsSrc, /id: `rem-out-src-/);
  assert.match(movementsSrc, /sourceCashboxId: box\.id/);
  assert.match(movementsSrc, /destinationCashboxId: box\.id/);
  assert.match(movementsSrc, /source: 'remittance_in'/);
  assert.match(movementsSrc, /id: `rem-out-pay-/);
});

test('labels: from=pay, to=receive', () => {
  assert.match(i18nSrc, /sourceCashbox:'صندوق پرداخت'/);
  assert.match(i18nSrc, /destinationCashbox:'صندوق دریافت'/);
});

test('remittances page has no pay modal', () => {
  assert.doesNotMatch(remittancesUi, /payRemittance/);
  assert.doesNotMatch(remittancesUi, /secretNumber/);
});
