import { initializeDatabase } from '../src/db/init.js';
import { sequelize } from '../src/db/sequelize.js';

try {
  await initializeDatabase();
  console.log('MySQL database, tables and initial records are ready.');
  console.log('Default login: admin / 12345678');
} catch (error) {
  console.error('\nDatabase setup failed.');
  console.error('Make sure MySQL is running and check server/.env.');
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await sequelize.close().catch(() => {});
}
