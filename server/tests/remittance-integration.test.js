import test from 'node:test';
import assert from 'node:assert/strict';
import 'dotenv/config';
import { sequelize } from '../src/db/sequelize.js';
import { CashboxBalance } from '../src/models/index.js';
import { createRemittance } from '../src/services/accounting.js';

const ctx = { req: {}, user: { name: 'test', id: 1 } };

async function bal(cashboxId, currencyId) {
  const row = await CashboxBalance.findOne({ where: { cashboxId, currencyId } });
  return Number(row?.amount || 0);
}

test('remittance flow: source down and destination up on create', async () => {
  await sequelize.authenticate();

  const [branches] = await sequelize.query('SELECT id FROM branches WHERE is_active = 1 ORDER BY id LIMIT 2');
  const [cashboxes] = await sequelize.query(
  `SELECT id, branch_id FROM cashboxes WHERE is_active = 1 ORDER BY id`,
  );
  const [currencies] = await sequelize.query('SELECT id FROM currencies WHERE is_active = 1 ORDER BY id LIMIT 1');
  if (branches.length < 2 || cashboxes.length < 2 || !currencies.length) {
    console.log('skip: need 2 branches, 2 cashboxes, 1 currency');
    return;
  }

  const fromBranch = branches[0].id;
  const toBranch = branches[1].id;
  const source = cashboxes.find((c) => Number(c.branch_id) === Number(fromBranch))?.id
    || cashboxes[0].id;
  const dest = cashboxes.find((c) => Number(c.branch_id) === Number(toBranch))?.id
    || cashboxes[1].id;
  const currencyId = currencies[0].id;
  const amount = 500;

  const beforeSrc = await bal(source, currencyId);
  const beforeDest = await bal(dest, currencyId);

  const rem = await createRemittance({
    fromBranchId: fromBranch,
    toBranchId: toBranch,
    sourceCashboxId: source,
    destinationCashboxId: dest,
    currencyId,
    amount,
    fee: 0,
    receiverName: 'تست یکپارچه',
  }, ctx);

  const afterCreateSrc = await bal(source, currencyId);
  const afterCreateDest = await bal(dest, currencyId);

  assert.equal(afterCreateSrc, beforeSrc - amount, 'source should decrease on create');
  assert.equal(afterCreateDest, beforeDest + amount, 'destination should increase on create');
  assert.equal(rem.state, 'ثبت شده', 'remittance should be registered on create');

  await sequelize.query('DELETE FROM remittances WHERE id = ?', { replacements: [rem.id] });
  await sequelize.query(
    'UPDATE cashbox_balances SET amount = ? WHERE cashbox_id = ? AND currency_id = ?',
    { replacements: [beforeSrc, source, currencyId] },
  );
  await sequelize.query(
    'UPDATE cashbox_balances SET amount = ? WHERE cashbox_id = ? AND currency_id = ?',
    { replacements: [beforeDest, dest, currencyId] },
  );
});
