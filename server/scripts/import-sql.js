import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { env } from '../src/config/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.resolve(__dirname, '../../database/zarin_hesab_full.sql');
const sql = await fs.readFile(sqlPath, 'utf8');

const connection = await mysql.createConnection({
  host: env.dbHost,
  port: env.dbPort,
  user: env.dbUser,
  password: env.dbPassword,
  charset: 'utf8mb4',
  multipleStatements: true,
});

try {
  await connection.query(sql);
  console.log('Full MySQL schema and existing data imported successfully.');
  console.log('Default login: admin / 12345678');
} catch (error) {
  console.error('SQL import failed:', error.message);
  process.exitCode = 1;
} finally {
  await connection.end();
}
