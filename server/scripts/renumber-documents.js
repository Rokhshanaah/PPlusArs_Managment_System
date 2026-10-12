/**
 * Renumber sequential document numbers to 1, 2, 3… (oldest first)
 * and reset counters so new docs continue after the last.
 */
import { sequelize } from '../src/db/sequelize.js';
import {
  SystemSetting,
  Transaction,
  Remittance,
  JournalEntry,
  CustomerLedger,
} from '../src/models/index.js';

async function renumberModel(Model, settingKey, label) {
  const rows = await Model.findAll({
    order: [['createdAt', 'ASC'], ['id', 'ASC']],
    attributes: ['id', 'number'],
  });

  await sequelize.transaction(async (t) => {
    for (const row of rows) {
      await row.update({ number: `__tmp_${settingKey}_${row.id}` }, { transaction: t });
    }
    let n = 0;
    for (const row of rows) {
      n += 1;
      await row.update({ number: String(n) }, { transaction: t });
    }
    const [setting] = await SystemSetting.findOrCreate({
      where: { settingKey },
      defaults: { settingValue: String(n) },
      transaction: t,
    });
    await setting.update({ settingValue: String(n) }, { transaction: t });
    console.log(`${label}: renumbered ${n}. Next will be ${n + 1}.`);
  });
}

await sequelize.authenticate();

await renumberModel(Transaction, 'doc_seq_TR', 'Transactions');
await renumberModel(Remittance, 'doc_seq_HV', 'Remittances');
await renumberModel(JournalEntry, 'doc_seq_JE', 'Journal entries');
await renumberModel(CustomerLedger, 'doc_seq_CL', 'Customer ledgers');

// Align other known counters with max used if any remain.
for (const key of ['doc_seq_RV', 'doc_seq_CV', 'doc_seq_ADJ', 'doc_seq_XFR', 'doc_seq_HVJ', 'doc_seq_HVJF', 'doc_seq_HVP', 'doc_seq_HVU', 'doc_seq_HVC']) {
  const [setting] = await SystemSetting.findOrCreate({
    where: { settingKey: key },
    defaults: { settingValue: '0' },
  });
  // Keep existing high-water if already higher; otherwise leave as-is.
  void setting;
}

await sequelize.close();
console.log('Done.');
