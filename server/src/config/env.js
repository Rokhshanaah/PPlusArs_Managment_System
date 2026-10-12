import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const numberFromEnv = (name, fallback) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a valid number.`);
  return value;
};

export const env = Object.freeze({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: numberFromEnv('PORT', 5000),
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  publicAppUrl: process.env.PUBLIC_APP_URL || '',
  jwtSecret: process.env.JWT_SECRET || 'dev-only-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
  appPlanPin: process.env.APP_PLAN_PIN || '123456',
  dbHost: process.env.DB_HOST || '127.0.0.1',
  dbPort: numberFromEnv('DB_PORT', 3306),
  dbName: process.env.DB_NAME || 'zarin_hesab',
  dbUser: process.env.DB_USER || 'root',
  dbPassword: process.env.DB_PASSWORD || '',
  dbLogging: String(process.env.DB_LOGGING || 'false').toLowerCase() === 'true',
});
