import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/legacy-data.json'), 'utf8'));
const ids = (rows) => new Set(rows.map((row) => Number(row.id)));

test('legacy export contains required accounting tables', () => {
  for (const key of ['currencies', 'branches', 'customers', 'cashboxes', 'cashbox_balances', 'exchange_rates', 'transactions', 'users']) {
    assert.ok(Array.isArray(data[key]), `${key} must be an array`);
  }
});

test('original administrator password remains compatible', async () => {
  const admin = data.users.find((user) => user.username === 'admin');
  assert.ok(admin);
  assert.equal(await bcrypt.compare('12345678', admin.password), true);
});

test('legacy foreign-key references are valid', () => {
  const currencyIds = ids(data.currencies);
  const branchIds = ids(data.branches);
  const cashboxIds = ids(data.cashboxes);
  const customerIds = ids(data.customers);

  for (const balance of data.cashbox_balances) {
    assert.ok(cashboxIds.has(Number(balance.cashbox_id)));
    assert.ok(currencyIds.has(Number(balance.currency_id)));
  }

  for (const transaction of data.transactions) {
    assert.ok(branchIds.has(Number(transaction.branch_id)));
    assert.ok(cashboxIds.has(Number(transaction.cashbox_id)));
    assert.ok(currencyIds.has(Number(transaction.from_currency_id)));
    assert.ok(currencyIds.has(Number(transaction.to_currency_id)));
    if (transaction.customer_id != null) assert.ok(customerIds.has(Number(transaction.customer_id)));
  }
});
