import { randomBytes } from 'crypto';
import { Op, QueryTypes } from 'sequelize';
import { sequelize } from '../db/sequelize.js';
import { Customer } from '../models/index.js';

export const GENERAL_CUSTOMER_NAME = 'مشتری عمومی';
export const GENERAL_CUSTOMER_PHONE = '0000000000';

/** Sort: newest customers first (highest id at the top). */
export const CUSTOMER_LIST_ORDER = [
  ['id', 'DESC'],
];

export function isGeneralCustomer(row) {
  if (!row) return false;
  if (row.isSystem) return true;
  return String(row.name || '').trim() === GENERAL_CUSTOMER_NAME;
}

const CUSTOMER_FK_UPDATES = [
  { table: 'customer_ledgers', column: 'customer_id' },
  { table: 'customer_balances', column: 'customer_id' },
  { table: 'customer_account_entries', column: 'customer_id' },
  { table: 'transactions', column: 'customer_id' },
  { table: 'remittances', column: 'sender_id' },
  { table: 'whatsapp_messages', column: 'customer_id' },
  { table: 'customer_messages', column: 'customer_id' },
  { table: 'card_reader_entries', column: 'customer_id' },
];

async function tableExists(table, transaction) {
  const rows = await sequelize.query(
    `SELECT 1 AS ok FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table
     LIMIT 1`,
    {
      replacements: { table },
      type: QueryTypes.SELECT,
      ...(transaction ? { transaction } : {}),
    },
  );
  return rows.length > 0;
}

async function remapCustomerFk(oldId, newId, transaction) {
  for (const { table, column } of CUSTOMER_FK_UPDATES) {
    if (!(await tableExists(table, transaction))) continue;
    await sequelize.query(
      `UPDATE \`${table}\` SET \`${column}\` = :newId WHERE \`${column}\` = :oldId`,
      {
        replacements: { oldId, newId },
        transaction,
      },
    );
  }
}

/**
 * Make «مشتری عمومی» = #1 and renumber everyone else 2, 3, 4… by creation order.
 */
export async function ensureSequentialCustomerIds(dbTransaction = null) {
  const quickRows = await Customer.findAll({
    attributes: ['id', 'isSystem', 'name', 'createdAt'],
    order: [
      ['isSystem', 'DESC'],
      ['createdAt', 'ASC'],
      ['id', 'ASC'],
    ],
    ...(dbTransaction ? { transaction: dbTransaction } : {}),
  });

  if (!quickRows.length) return { changed: false, count: 0 };

  const general = quickRows.find((r) => r.isSystem)
    || quickRows.find((r) => String(r.name || '').trim() === GENERAL_CUSTOMER_NAME)
    || null;

  const ordered = [];
  if (general) ordered.push(general);
  for (const row of quickRows) {
    if (general && Number(row.id) === Number(general.id)) continue;
    ordered.push(row);
  }

  const mapping = ordered.map((row, index) => ({
    oldId: Number(row.id),
    newId: index + 1,
  }));

  const needsChange = mapping.some((m) => m.oldId !== m.newId);
  if (!needsChange) {
    const maxId = mapping.length;
    try {
      await sequelize.query(
        `ALTER TABLE \`customers\` AUTO_INCREMENT = ${maxId + 1}`,
        dbTransaction ? { transaction: dbTransaction } : {},
      );
    } catch {
      /* ignore auto-increment adjust failures */
    }
    return { changed: false, count: mapping.length };
  }

  const run = async (transaction) => {
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 0', { transaction });

    const TEMP = 1_000_000;
    for (const { oldId } of mapping) {
      const tempId = TEMP + oldId;
      await sequelize.query(
        'UPDATE `customers` SET `id` = :tempId WHERE `id` = :oldId',
        { replacements: { tempId, oldId }, transaction },
      );
      await remapCustomerFk(oldId, tempId, transaction);
    }

    for (const { oldId, newId } of mapping) {
      const tempId = TEMP + oldId;
      await sequelize.query(
        'UPDATE `customers` SET `id` = :newId WHERE `id` = :tempId',
        { replacements: { newId, tempId }, transaction },
      );
      await remapCustomerFk(tempId, newId, transaction);
    }

    const maxId = mapping.length;
    await sequelize.query(
      `ALTER TABLE \`customers\` AUTO_INCREMENT = ${maxId + 1}`,
      { transaction },
    );
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 1', { transaction });
    return { changed: true, count: mapping.length };
  };

  if (dbTransaction) return run(dbTransaction);
  return sequelize.transaction(run);
}

/**
 * Ensure default «مشتری عمومی» always exists as customer #1.
 */
export async function ensureDefaultCustomer(dbTransaction = null) {
  const opts = dbTransaction ? { transaction: dbTransaction } : {};

  let row = await Customer.findOne({
    where: { isSystem: true },
    ...opts,
  });

  if (!row) {
    row = await Customer.findOne({
      where: { name: GENERAL_CUSTOMER_NAME },
      ...opts,
    });
  }

  if (!row) {
    row = await Customer.findOne({
      where: { phone: GENERAL_CUSTOMER_PHONE },
      ...opts,
    });
  }

  const patch = {
    name: GENERAL_CUSTOMER_NAME,
    phone: row?.phone || GENERAL_CUSTOMER_PHONE,
    trustLevel: 'عادی',
    state: 'تأیید شده',
    isSystem: true,
    source: 'manual',
    documentType: row?.documentType || 'سیستمی',
    documentNumber: row?.documentNumber || 'GENERAL',
  };

  if (row) {
    await row.update(patch, opts);
    if (!row.viewToken) {
      await row.update({ viewToken: randomBytes(24).toString('hex') }, opts);
    }
  } else {
    const createData = {
      ...patch,
      source: 'manual',
      fatherName: null,
      address: null,
      viewToken: randomBytes(24).toString('hex'),
    };
    // Prefer id=1 when the table is empty / slot free
    const taken = await Customer.findByPk(1, opts);
    if (!taken) createData.id = 1;
    row = await Customer.create(createData, opts);
  }

  await ensureSequentialCustomerIds(dbTransaction);
  return Customer.findByPk(1, opts) || row;
}

export async function findGeneralCustomerId(dbTransaction = null) {
  const opts = dbTransaction ? { transaction: dbTransaction } : {};
  const row = await Customer.findOne({
    where: {
      [Op.or]: [
        { isSystem: true },
        { name: GENERAL_CUSTOMER_NAME },
      ],
    },
    attributes: ['id'],
    ...opts,
  });
  return row?.id || null;
}
