import mysql from 'mysql2/promise';
import { env } from '../config/env.js';

const safeDatabaseName = (value) => {
  if (!/^[a-zA-Z0-9_]+$/.test(value)) {
    throw new Error('DB_NAME may contain only letters, numbers and underscores.');
  }
  return value;
};

export async function ensureDatabaseExists() {
  const connection = await mysql.createConnection({
    host: env.dbHost,
    port: env.dbPort,
    user: env.dbUser,
    password: env.dbPassword,
    charset: 'utf8mb4',
  });

  try {
    const databaseName = safeDatabaseName(env.dbName);
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
  } finally {
    await connection.end();
  }
}
