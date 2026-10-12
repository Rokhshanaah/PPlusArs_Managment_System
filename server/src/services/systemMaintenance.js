import { Op } from 'sequelize';
import { sequelize } from '../db/sequelize.js';
import {
  Account, AuditLog, Branch, Cashbox, CashboxBalance, Currency, Customer,
  CustomerAccountEntry, CustomerBalance, CustomerLedger, CustomerMessage,
  CardReaderEntry, ExchangeRate, Expense, JournalEntry, Remittance, SystemSetting,
  Transaction, User, WhatsappMessage,
} from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { writeAudit } from '../utils/audit.js';
import { applyNumberingStart, NUMBERING_START_KEY } from '../utils/ids.js';
import { ensureDefaultCustomer } from '../utils/defaultCustomer.js';

const BACKUP_MODELS = {
  currencies: Currency,
  branches: Branch,
  cashboxes: Cashbox,
  cashboxBalances: CashboxBalance,
  customers: Customer,
  customerBalances: CustomerBalance,
  customerLedgers: CustomerLedger,
  customerAccountEntries: CustomerAccountEntry,
  exchangeRates: ExchangeRate,
  transactions: Transaction,
  remittances: Remittance,
  accounts: Account,
  journalEntries: JournalEntry,
  expenses: Expense,
  auditLogs: AuditLog,
  systemSettings: SystemSetting,
  whatsappMessages: WhatsappMessage,
  cardReaderEntries: CardReaderEntry,
  customerMessages: CustomerMessage,
  users: User,
};

/** Selectable wipe groups (users & currencies are never included). */
export const RESET_CATEGORIES = [
  {
    key: 'customers',
    models: [
      CustomerLedger, CustomerBalance, CustomerAccountEntry,
      CustomerMessage, Customer,
    ],
  },
  { key: 'transactions', models: [Transaction] },
  { key: 'remittances', models: [Remittance] },
  { key: 'expenses', models: [Expense] },
  { key: 'journalEntries', models: [JournalEntry] },
  { key: 'accounts', models: [Account] },
  { key: 'cardReader', models: [CardReaderEntry] },
  { key: 'cashboxBalances', models: [CashboxBalance] },
  { key: 'exchangeRates', models: [ExchangeRate] },
  { key: 'whatsappMessages', models: [WhatsappMessage] },
  { key: 'auditLogs', models: [AuditLog] },
  { key: 'cashboxes', models: [CashboxBalance, Cashbox] },
  { key: 'branches', models: [CashboxBalance, Cashbox, Branch] },
  { key: 'systemSettings', models: [SystemSetting] },
];

const FULL_WIPE_ORDER = [
  Expense,
  CustomerLedger, CustomerBalance, CustomerAccountEntry, CustomerMessage,
  CardReaderEntry, Customer,
  Transaction, Remittance, JournalEntry, Account,
  CashboxBalance, ExchangeRate, AuditLog, WhatsappMessage,
  Cashbox, Branch, SystemSetting,
];

const NUMBERING_KEYS = new Set([
  'customers', 'transactions', 'remittances', 'expenses', 'journalEntries',
]);

function assertCanReset(user) {
  if (user?.role !== 'مدیر کل' && user?.username !== 'admin') {
    throw new AppError('فقط مدیر کل می‌تواند سامانه را ریست کند.', 403, 'FORBIDDEN');
  }
}

async function countCategory(models) {
  let total = 0;
  const seen = new Set();
  for (const model of models) {
    if (seen.has(model)) continue;
    seen.add(model);
    total += await model.count();
  }
  return total;
}

export async function listResetCategories() {
  const categories = [];
  for (const cat of RESET_CATEGORIES) {
    categories.push({
      key: cat.key,
      count: await countCategory(cat.models),
    });
  }
  return categories;
}

async function destroyModels(models, dbTransaction) {
  const seen = new Set();
  for (const model of models) {
    if (seen.has(model)) continue;
    seen.add(model);
    await model.destroy({ where: {}, force: true, transaction: dbTransaction });
  }
}

async function ensureDefaultBranch(dbTransaction) {
  if ((await Branch.count({ transaction: dbTransaction })) > 0) return;
  const branch = await Branch.create({
    name: 'شعبه مرکزی', city: 'کابل', address: 'افغانستان', isActive: true,
  }, { transaction: dbTransaction });
  await Cashbox.create({
    branchId: branch.id, name: 'صندوق مرکزی', keeperName: 'مدیر', isActive: true,
  }, { transaction: dbTransaction });
}

async function resetNumbering(dbTransaction) {
  const startRow = await SystemSetting.findOne({
    where: { settingKey: NUMBERING_START_KEY },
    transaction: dbTransaction,
  });
  const start = startRow?.settingValue || '1';
  await applyNumberingStart(start, dbTransaction, { force: true });
}

export async function buildSystemBackup() {
  const tables = {};
  for (const [key, model] of Object.entries(BACKUP_MODELS)) {
    if (key === 'users') {
      const users = await User.unscoped().findAll({ raw: true });
      tables.users = users.map(({ password, ...rest }) => ({
        ...rest,
        password: undefined,
        hasPassword: Boolean(password),
      }));
    } else {
      tables[key] = await model.findAll({ raw: true });
    }
  }
  return {
    app: 'pplus-arz',
    version: 1,
    exportedAt: new Date().toISOString(),
    tables,
  };
}

function sqlEscape(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 'NULL';
    return String(value);
  }
  if (value instanceof Date) {
    const iso = value.toISOString().slice(0, 19).replace('T', ' ');
    return `'${iso}'`;
  }
  if (Buffer.isBuffer(value)) {
    return `X'${value.toString('hex')}'`;
  }
  if (typeof value === 'object') {
    const json = JSON.stringify(value).replace(/\\/g, '\\\\').replace(/'/g, "''");
    return `'${json}'`;
  }
  const text = String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\u0000/g, '')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/'/g, "''");
  return `'${text}'`;
}

function rowToInsert(tableName, row) {
  const entries = Object.entries(row).filter(([, v]) => v !== undefined);
  if (!entries.length) return null;
  const cols = entries.map(([k]) => `\`${k}\``).join(', ');
  const vals = entries.map(([, v]) => sqlEscape(v)).join(', ');
  return `INSERT INTO \`${tableName}\` (${cols}) VALUES (${vals});`;
}

/** Full MySQL-compatible SQL dump of all app tables (for restore via mysql/phpMyAdmin). */
export async function buildSystemSqlBackup() {
  const stamp = new Date().toISOString();
  const lines = [
    '-- PPlus.Arz SQL Backup',
    `-- Exported at: ${stamp}`,
    '-- Import with: mysql -u USER -p DATABASE < this-file.sql',
    'SET NAMES utf8mb4;',
    'SET FOREIGN_KEY_CHECKS = 0;',
    'SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";',
    '',
  ];

  for (const [key, model] of Object.entries(BACKUP_MODELS)) {
    const tableName = model.getTableName();
    const rows = key === 'users'
      ? await User.unscoped().findAll({ raw: true })
      : await model.findAll({ raw: true });

    lines.push(`-- ----------------------------`);
    lines.push(`-- Table: ${tableName} (${rows.length} rows)`);
    lines.push(`-- ----------------------------`);
    lines.push(`DELETE FROM \`${tableName}\`;`);

    for (const row of rows) {
      const insert = rowToInsert(tableName, row);
      if (insert) lines.push(insert);
    }
    lines.push('');
  }

  lines.push('SET FOREIGN_KEY_CHECKS = 1;');
  lines.push('-- End of backup');
  return lines.join('\n');
}

/**
 * Wipe system data.
 * @param {{ req, user, mode?: 'full'|'selective', categories?: string[] }} context
 * - full: delete everything except users
 * - selective: delete only chosen categories (users never deleted)
 */
export async function resetSystemData(context) {
  assertCanReset(context.user);

  const mode = context.mode === 'selective' ? 'selective' : 'full';
  let selectedKeys = [];

  if (mode === 'selective') {
    const requested = Array.isArray(context.categories) ? context.categories : [];
    const valid = new Set(RESET_CATEGORIES.map((c) => c.key));
    selectedKeys = [...new Set(requested.filter((k) => valid.has(k)))];
    if (!selectedKeys.length) {
      throw new AppError('حداقل یک مورد برای حذف انتخاب کنید.', 400, 'VALIDATION');
    }
  } else {
    selectedKeys = RESET_CATEGORIES.map((c) => c.key);
  }

  const selectedSet = new Set(selectedKeys);
  const clearedBranchOrCashbox = selectedSet.has('branches') || selectedSet.has('cashboxes');

  await sequelize.transaction(async (dbTransaction) => {
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 0', { transaction: dbTransaction });

    if (mode === 'full') {
      await destroyModels(FULL_WIPE_ORDER, dbTransaction);
    } else {
      const toClear = [];
      for (const cat of RESET_CATEGORIES) {
        if (selectedSet.has(cat.key)) toClear.push(...cat.models);
      }
      await destroyModels(toClear, dbTransaction);
    }

    if (clearedBranchOrCashbox || mode === 'full') {
      await User.update(
        { branchId: null },
        { where: { branchId: { [Op.ne]: null } }, transaction: dbTransaction },
      );
      await ensureDefaultBranch(dbTransaction);
    }

    // Always re-create default general customer after wipe / missing
    await ensureDefaultCustomer(dbTransaction);

    if (mode === 'full' || selectedKeys.some((k) => NUMBERING_KEYS.has(k))) {
      await resetNumbering(dbTransaction);
    }

    await sequelize.query('SET FOREIGN_KEY_CHECKS = 1', { transaction: dbTransaction });

    const action = mode === 'full'
      ? 'ریست کامل اطلاعات سامانه انجام شد'
      : `ریست انتخابی سامانه انجام شد: ${selectedKeys.join(', ')}`;

    await writeAudit({
      req: context.req,
      user: context.user,
      action,
      transaction: dbTransaction,
    });
  });

  return { ok: true, mode, categories: selectedKeys };
}
