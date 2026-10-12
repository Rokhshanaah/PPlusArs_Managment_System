import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import 'dotenv/config';
import { sequelize } from '../src/db/sequelize.js';
import { Customer, CustomerBalance, Currency } from '../src/models/index.js';
import { transferCustomerBetweenCustomers } from '../src/services/accounting.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const accountingSrc = readFileSync(join(root, 'src/services/accounting.js'), 'utf8');
const routesSrc = readFileSync(join(root, 'src/routes/master-data.js'), 'utf8');
const remittancesUi = readFileSync(join(root, '../frontend/src/pages/RemittancesPage.jsx'), 'utf8');

const ctx = { req: {}, user: { name: 'test', id: 1 } };

async function customerBalance(customerId, currencyId) {
  const row = await CustomerBalance.findOne({ where: { customerId, currencyId } });
  return Number(row?.amount || 0);
}

test('person-to-person hawala credits sender and debits receiver', () => {
  assert.match(accountingSrc, /Sender \(فرستنده\) → balance up \(طلبکار\)/);
  assert.match(accountingSrc, /fromBalance\.amount = fixed\(D\(fromBalance\.amount\)\.plus\(totalSenderCredit\)\)/);
  assert.match(accountingSrc, /toBalance\.amount = fixed\(D\(toBalance\.amount\)\.minus\(amount\)\)/);
});

test('person-to-person transfer uses transfer ledger types without cashbox', () => {
  assert.match(accountingSrc, /export async function transferCustomerBetweenCustomers/);
  assert.match(accountingSrc, /type: 'transfer_out'/);
  assert.match(accountingSrc, /type: 'transfer_in'/);
  assert.match(accountingSrc, /cashboxId: null/);
});

test('person_to_cashbox uses received and cashbox_to_person uses paid', () => {
  assert.match(routesSrc, /person_to_cashbox[\s\S]*?type: 'received'/);
  assert.match(routesSrc, /cashbox_to_person[\s\S]*?type: 'paid'/);
});

test('customer transfer API route exists', () => {
  assert.match(routesSrc, /router\.post\('\/customer-transfers'/);
  assert.match(routesSrc, /transferCustomerBetweenCustomers/);
  assert.match(routesSrc, /person_to_person/);
});

test('remittances list includes account transfer rows helper', () => {
  assert.match(accountingSrc, /export async function listAccountTransferRows/);
});

test('customer transfer edit and delete routes exist', () => {
  assert.match(routesSrc, /router\.put\('\/customer-transfers\/:id'/);
  assert.match(routesSrc, /router\.delete\('\/customer-transfers\/:id'/);
  assert.match(routesSrc, /deleteAccountTransfer/);
  assert.match(routesSrc, /updateAccountTransfer/);
});

test('remittances page uses customer transfer endpoint for top form', () => {
  assert.match(remittancesUi, /\/customer-transfers/);
  assert.match(remittancesUi, /person_to_person/);
  assert.match(remittancesUi, /p2pTransferHint/);
  assert.match(remittancesUi, /rowKind === 'account_transfer'/);
  assert.match(remittancesUi, /customer-transfers/);
  assert.match(remittancesUi, /openEditAccountTransfer/);
  assert.match(remittancesUi, /deleteRemittanceRow/);
  assert.doesNotMatch(remittancesUi, /submitTransfer[\s\S]*?api\.post\('\/remittances'/);
});

test('public customer scenario: 5000 receipt + 6000 hawala sent = 11000 creditor', async () => {
  await sequelize.authenticate();
  const customers = await Customer.findAll({ limit: 2, order: [['id', 'ASC']] });
  const currency = await Currency.findOne({ where: { isActive: true }, order: [['id', 'ASC']] });
  if (customers.length < 2 || !currency) {
    console.log('skip: need 2 customers and 1 currency');
    return;
  }

  const sender = customers[0];
  const receiver = customers[1];
  const currencyId = currency.id;
  const opening = 5000;
  const amount = 6000;

  await CustomerBalance.destroy({ where: { customerId: [sender.id, receiver.id], currencyId } });
  await CustomerBalance.bulkCreate([
    { customerId: sender.id, currencyId, amount: opening },
    { customerId: receiver.id, currencyId, amount: 0 },
  ]);

  await transferCustomerBetweenCustomers({
    fromCustomerId: sender.id,
    toCustomerId: receiver.id,
    currencyId,
    amount,
    fee: 0,
    note: 'hawala sender creditor scenario',
  }, ctx);

  const senderBalance = await customerBalance(sender.id, currencyId);
  const receiverBalance = await customerBalance(receiver.id, currencyId);

  assert.equal(senderBalance, opening + amount, 'sender should gain hawala amount on top of receipt balance');
  assert.equal(receiverBalance, -amount, 'receiver should become debtor for transfer amount');
});
