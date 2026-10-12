import { ensureSchema } from '../src/db/ensureSchema.js';
import { sequelize } from '../src/db/sequelize.js';

await sequelize.authenticate();
await ensureSchema();
const [cols] = await sequelize.query('SHOW COLUMNS FROM remittances');
console.log('remittance columns:', cols.map((c) => c.Field).join(', '));
const [{ j }] = await sequelize.query('SELECT COUNT(*) AS j FROM journal_entries');
console.log('journal count:', j);
const [[{ c }]] = await sequelize.query('SELECT COUNT(*) AS c FROM remittances');
console.log('remittances count:', c);
await sequelize.close();
