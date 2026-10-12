/**
 * One-time: renumber money transactions to short sequential ids 1, 2, 3…
 * and set doc_seq_TR so new deals continue after the last.
 */
import { sequelize } from '../src/db/sequelize.js';
import { SystemSetting, Transaction } from '../src/models/index.js';

await sequelize.authenticate();

const rows = await Transaction.findAll({
  order: [['createdAt', 'ASC'], ['id', 'ASC']],
  attributes: ['id', 'number'],
});

await sequelize.transaction(async (t) => {
  // Temp unique values to avoid unique collisions while renaming
  for (const row of rows) {
    await row.update({ number: `__tmp_${row.id}` }, { transaction: t });
  }
  let n = 0;
  for (const row of rows) {
    n += 1;
    await row.update({ number: String(n) }, { transaction: t });
  }
  const [setting] = await SystemSetting.findOrCreate({
    where: { settingKey: 'doc_seq_TR' },
    defaults: { settingValue: String(n) },
    transaction: t,
  });
  await setting.update({ settingValue: String(n) }, { transaction: t });
  console.log(`Renumbered ${n} transactions. Next TR will be ${n + 1}.`);
});

await sequelize.close();
