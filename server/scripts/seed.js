import { initializeDatabase } from '../src/db/init.js';
import { sequelize } from '../src/db/sequelize.js';
await initializeDatabase();
console.log('Database initialized and seed data verified.');
await sequelize.close();
