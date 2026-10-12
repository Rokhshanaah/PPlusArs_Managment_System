import { Op, QueryTypes } from 'sequelize';
import { SystemSetting } from '../models/index.js';
import { sequelize } from '../db/sequelize.js';

export const NUMBERING_START_KEY = 'numbering_start';

/**
 * Aliases that write into the same unique `number` column must share one counter.
 * (e.g. all journal_entries rows — JE/RV/ADJ/XFR/HVJ/…)
 */
const SHARED_SEQ = {
  RV: 'JE',
  ADJ: 'JE',
  XFR: 'JE',
  HVJ: 'JE',
  HVJF: 'JE',
  HVP: 'JE',
  HVU: 'JE',
  HVC: 'JE',
  EXJ: 'JE',
};

/** Table used to sync counter past existing numeric document numbers. */
const SEQ_TABLE = {
  TR: 'transactions',
  HV: 'remittances',
  JE: 'journal_entries',
  CL: 'customer_ledgers',
  EX: 'expenses',
};

function resolveSeqPrefix(prefix) {
  const raw = String(prefix || 'TR').toUpperCase();
  return SHARED_SEQ[raw] || raw;
}

/** Read configured start number for IDs / document counters (default 1). */
export async function getNumberingStart(transaction = null) {
  const opts = { where: { settingKey: NUMBERING_START_KEY } };
  if (transaction) opts.transaction = transaction;
  const row = await SystemSetting.findOne(opts);
  const n = Number.parseInt(String(row?.settingValue ?? '1'), 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

async function maxExistingNumericNumber(table, transaction = null) {
  if (!table) return 0;
  try {
    const rows = await sequelize.query(
      `SELECT MAX(CAST(\`number\` AS UNSIGNED)) AS max_num
       FROM \`${table}\`
       WHERE \`number\` REGEXP '^[0-9]+$'`,
      {
        type: QueryTypes.SELECT,
        ...(transaction ? { transaction } : {}),
      },
    );
    const n = Number.parseInt(String(rows?.[0]?.max_num ?? '0'), 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/**
 * Apply numbering start: store setting, raise doc counters if below start,
 * and set AUTO_INCREMENT on main tables (MySQL keeps max(id)+1 if higher).
 * Pass { force: true } after a full wipe to restart counters from start-1.
 */
export async function applyNumberingStart(startRaw, transaction = null, { force = false } = {}) {
  const start = Math.max(1, Number.parseInt(String(startRaw ?? '1'), 10) || 1);
  const t = transaction || null;
  const upsertOpts = t ? { transaction: t } : {};

  await SystemSetting.upsert(
    { settingKey: NUMBERING_START_KEY, settingValue: String(start) },
    upsertOpts,
  );

  const seqRows = await SystemSetting.findAll({
    where: { settingKey: { [Op.like]: 'doc_seq_%' } },
    ...(t ? { transaction: t } : {}),
  });
  const floor = start - 1;
  for (const row of seqRows) {
    const current = Number.parseInt(String(row.settingValue || '0'), 10);
    if (force || !Number.isFinite(current) || current < floor) {
      await row.update({ settingValue: String(floor) }, upsertOpts);
    }
  }

  const tables = [
    'customers',
    'transactions',
    'remittances',
    'journal_entries',
    'customer_ledgers',
    'customer_balances',
    'customer_account_entries',
    'cashbox_balances',
    'exchange_rates',
    'audit_logs',
    'card_reader_entries',
    'customer_messages',
    'whatsapp_messages',
    'accounts',
    'expenses',
  ];
  for (const table of tables) {
    try {
      await sequelize.query(
        `ALTER TABLE \`${table}\` AUTO_INCREMENT = ${start}`,
        t ? { transaction: t } : {},
      );
    } catch {
      /* table may not exist yet */
    }
  }

  return start;
}

/**
 * Sequential document number starting at numbering_start (per logical series).
 * Journal-related prefixes share one series so unique(number) never collides.
 */
export async function documentNumber(prefix = 'TR', transaction = null) {
  const start = await getNumberingStart(transaction);
  const seq = resolveSeqPrefix(prefix);
  const key = `doc_seq_${seq}`;
  const findOpts = {
    where: { settingKey: key },
    defaults: { settingValue: String(start - 1) },
  };
  if (transaction) findOpts.transaction = transaction;

  const [row] = await SystemSetting.findOrCreate(findOpts);
  if (transaction) {
    await row.reload({ transaction, lock: transaction.LOCK.UPDATE });
  }

  const current = Number.parseInt(String(row.settingValue ?? String(start - 1)), 10);
  const base = Number.isFinite(current) ? current : start - 1;
  const maxExisting = await maxExistingNumericNumber(SEQ_TABLE[seq], transaction);
  const value = Math.max(base + 1, start, maxExisting + 1);
  await row.update({ settingValue: String(value) }, transaction ? { transaction } : undefined);
  return String(value);
}
