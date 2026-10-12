import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Op } from 'sequelize';
import { allPermissions, initializeDatabase } from '../src/db/init.js';
import { sequelize } from '../src/db/sequelize.js';
import { Currency, User, models } from '../src/models/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(process.argv[2] || path.join(__dirname, '../data/legacy-data.json'));
const force = process.argv.includes('--force');
const data = JSON.parse(await fs.readFile(source, 'utf8'));
const tableMap = [
  ['currencies', 'Currency'], ['branches', 'Branch'], ['customers', 'Customer'],
  ['cashboxes', 'Cashbox'], ['cashbox_balances', 'CashboxBalance'],
  ['exchange_rates', 'ExchangeRate'], ['transactions', 'Transaction'],
  ['remittances', 'Remittance'], ['accounts', 'Account'],
  ['journal_entries', 'JournalEntry'], ['audit_logs', 'AuditLog'],
  ['users', 'User'], ['system_settings', 'SystemSetting'],
  ['customer_ledgers', 'CustomerLedger'], ['customer_balances', 'CustomerBalance'],
  ['customer_account_entries', 'CustomerAccountEntry'],
];
const camel = (value) => value.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());

await initializeDatabase();
await sequelize.query('SET FOREIGN_KEY_CHECKS = 0');
try {
  for (const [table, modelName] of tableMap) {
    const Model = models[modelName];
    const rows = data[table] || [];
    if (!rows.length) continue;

    const current = await Model.unscoped().count();
    if (current && !force) {
      console.log(`Skip ${table}: ${current} target row(s), use --force to replace.`);
      continue;
    }
    if (force && current) {
      await Model.unscoped().destroy({ where: {}, truncate: true, force: true });
    }

    const attributes = Model.getAttributes();
    const payload = rows.map((row) => {
      const mapped = Object.fromEntries(
        Object.entries(row)
          .map(([key, rawValue]) => {
            const targetKey = camel(key);
            let value = rawValue;
            if (targetKey === 'permissions' && typeof value === 'string') {
              try { value = JSON.parse(value); } catch { value = []; }
            }
            return [targetKey, value];
          })
          .filter(([key]) => attributes[key]),
      );
      // The old database may predate the permissions migration. Laravel's migration
      // granted all existing staff the original full permission set.
      if (modelName === 'User' && !Array.isArray(mapped.permissions)) {
        mapped.permissions = [...allPermissions];
      }
      return mapped;
    });

    await Model.unscoped().bulkCreate(payload, { validate: false });
    console.log(`Imported ${payload.length} row(s) into ${table}`);
  }

  // A base currency is required by reports and future approval/accounting rules.
  if (await Currency.count({ where: { isBase: true } }) === 0) {
    const base = await Currency.findOne({
      where: { [Op.or]: [{ code: 'AFN' }, { isActive: true }] },
      order: [['code', 'ASC']],
    });
    if (base) await base.update({ isBase: true, isActive: true });
  }

  // Repair any users that came from a database where the permissions column was empty.
  const usersWithoutPermissions = await User.unscoped().findAll({ where: { permissions: null } });
  for (const user of usersWithoutPermissions) {
    await user.update({ permissions: [...allPermissions] });
  }
} finally {
  await sequelize.query('SET FOREIGN_KEY_CHECKS = 1');
  await sequelize.close();
}
