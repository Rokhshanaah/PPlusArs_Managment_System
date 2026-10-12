import { QueryTypes } from 'sequelize';
import { randomBytes } from 'crypto';
import { sequelize } from './sequelize.js';

async function columnExists(table, column) {
  const rows = await sequelize.query(
    `SELECT 1 AS ok FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table AND COLUMN_NAME = :column
     LIMIT 1`,
    { replacements: { table, column }, type: QueryTypes.SELECT },
  );
  return rows.length > 0;
}

async function addColumn(table, column, definition) {
  if (await columnExists(table, column)) return;
  await sequelize.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
}

/** Repair legacy tables that predate newer model fields, then backfill journal. */
export async function ensureSchema() {
  await addColumn('remittances', 'source_cashbox_id', 'INT UNSIGNED NULL AFTER `currency_id`');
  await addColumn('remittances', 'destination_cashbox_id', 'INT UNSIGNED NULL AFTER `source_cashbox_id`');
  await addColumn('remittances', 'paid_at', 'DATETIME NULL AFTER `note`');
  await addColumn('remittances', 'cancelled_at', 'DATETIME NULL AFTER `paid_at`');
  await addColumn('remittances', 'fee_currency_id', 'INT UNSIGNED NULL AFTER `fee`');
  await addColumn('customers', 'view_token', 'VARCHAR(64) NULL UNIQUE AFTER `state`');
  await addColumn('customers', 'is_system', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER `state`');
  await addColumn('customers', 'source', "VARCHAR(30) NOT NULL DEFAULT 'manual' AFTER `is_system`");
  await addColumn('customers', 'whatsapp_phone', 'VARCHAR(30) NULL AFTER `phone`');
  await addColumn('customers', 'avatar_url', 'VARCHAR(255) NULL AFTER `whatsapp_phone`');
  await addColumn('customers', 'fingerprint_url', 'VARCHAR(255) NULL AFTER `avatar_url`');
  await addColumn('customers', 'fingerprint_hash', 'VARCHAR(64) NULL AFTER `fingerprint_url`');
  await addColumn('customers', 'fingerprint_seed', 'VARCHAR(80) NULL AFTER `fingerprint_hash`');
  await addColumn('customers', 'fingerprint_template', 'LONGTEXT NULL AFTER `fingerprint_seed`');
  await addColumn('customers', 'fingerprint_format', "VARCHAR(32) NOT NULL DEFAULT 'ZK10' AFTER `fingerprint_template`");
  await addColumn('users', 'avatar_url', 'VARCHAR(255) NULL AFTER `phone`');

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS \`card_reader_entries\` (
      \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
      \`customer_id\` INT UNSIGNED NULL,
      \`customer_name\` VARCHAR(160) NULL,
      \`phone\` VARCHAR(40) NULL,
      \`document_number\` VARCHAR(80) NULL,
      \`card_number\` VARCHAR(80) NULL,
      \`bank_name\` VARCHAR(120) NULL,
      \`card_holder_name\` VARCHAR(160) NULL,
      \`photo_url\` VARCHAR(255) NULL,
      \`fingerprint_url\` VARCHAR(255) NULL,
      \`fingerprint_hash\` VARCHAR(64) NULL,
      \`fingerprint_confirmed\` TINYINT(1) NOT NULL DEFAULT 0,
      \`kind\` VARCHAR(30) NOT NULL DEFAULT 'deposit',
      \`amount\` DECIMAL(22,6) NULL,
      \`fee\` DECIMAL(22,6) NOT NULL DEFAULT 0,
      \`currency_id\` INT UNSIGNED NULL,
      \`cashbox_id\` INT UNSIGNED NULL,
      \`ledger_entry_id\` INT UNSIGNED NULL,
      \`note\` TEXT NULL,
      \`created_by_name\` VARCHAR(120) NULL,
      \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`),
      KEY \`idx_card_reader_customer\` (\`customer_id\`),
      KEY \`idx_card_reader_created\` (\`created_at\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await addColumn('card_reader_entries', 'customer_name', 'VARCHAR(160) NULL AFTER `customer_id`');
  await addColumn('card_reader_entries', 'phone', 'VARCHAR(40) NULL AFTER `customer_name`');
  await addColumn('card_reader_entries', 'document_number', 'VARCHAR(80) NULL AFTER `phone`');
  await addColumn('card_reader_entries', 'card_number', 'VARCHAR(80) NULL AFTER `document_number`');
  await addColumn('card_reader_entries', 'bank_name', 'VARCHAR(120) NULL AFTER `card_number`');
  await addColumn('card_reader_entries', 'card_holder_name', 'VARCHAR(160) NULL AFTER `bank_name`');
  await addColumn('card_reader_entries', 'photo_url', 'VARCHAR(255) NULL AFTER `card_holder_name`');
  await addColumn('card_reader_entries', 'fingerprint_url', 'VARCHAR(255) NULL AFTER `photo_url`');
  await addColumn('card_reader_entries', 'fingerprint_hash', 'VARCHAR(64) NULL AFTER `fingerprint_url`');
  await addColumn('card_reader_entries', 'fingerprint_template', 'LONGTEXT NULL AFTER `fingerprint_hash`');
  await addColumn('card_reader_entries', 'fingerprint_format', "VARCHAR(32) NOT NULL DEFAULT 'ZK10' AFTER `fingerprint_template`");
  await addColumn('card_reader_entries', 'fingerprint_confirmed', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER `fingerprint_format`');
  await addColumn('card_reader_entries', 'fee', 'DECIMAL(22,6) NOT NULL DEFAULT 0 AFTER `amount`');
  await addColumn('card_reader_entries', 'cashbox_id', 'INT UNSIGNED NULL AFTER `currency_id`');
  await addColumn('card_reader_entries', 'ledger_entry_id', 'INT UNSIGNED NULL AFTER `cashbox_id`');
  try {
    await sequelize.query('ALTER TABLE `card_reader_entries` MODIFY COLUMN `customer_id` INT UNSIGNED NULL');
  } catch {
    /* already nullable or table missing */
  }

  // Mark walk-in card-reader customers separately from manually registered ones.
  await sequelize.query(`
    UPDATE customers c
    INNER JOIN (
      SELECT DISTINCT customer_id
      FROM card_reader_entries
      WHERE customer_id IS NOT NULL
    ) e ON e.customer_id = c.id
    SET c.source = 'card_reader'
    WHERE c.is_system = 0
      AND (c.whatsapp_phone IS NULL OR c.whatsapp_phone = '')
      AND (c.source IS NULL OR c.source = '' OR c.source = 'manual')
  `);

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS \`expenses\` (
      \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
      \`number\` VARCHAR(80) NOT NULL,
      \`branch_id\` INT UNSIGNED NULL,
      \`cashbox_id\` INT UNSIGNED NOT NULL,
      \`currency_id\` INT UNSIGNED NOT NULL,
      \`amount\` DECIMAL(22,6) NOT NULL,
      \`category\` VARCHAR(120) NOT NULL DEFAULT 'عمومی',
      \`description\` VARCHAR(255) NOT NULL,
      \`note\` TEXT NULL,
      \`entry_date\` DATE NOT NULL,
      \`journal_entry_id\` INT UNSIGNED NULL,
      \`created_by_name\` VARCHAR(120) NULL,
      \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`),
      UNIQUE KEY \`uniq_expenses_number\` (\`number\`),
      KEY \`idx_expenses_cashbox\` (\`cashbox_id\`),
      KEY \`idx_expenses_entry_date\` (\`entry_date\`),
      KEY \`idx_expenses_branch\` (\`branch_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS \`customer_messages\` (
      \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
      \`customer_id\` INT UNSIGNED NOT NULL,
      \`body\` TEXT NOT NULL,
      \`sender\` VARCHAR(20) NOT NULL DEFAULT 'customer',
      \`read_at\` DATETIME NULL,
      \`read_by_user_id\` INT UNSIGNED NULL,
      \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`),
      KEY \`idx_customer_messages_customer\` (\`customer_id\`),
      KEY \`idx_customer_messages_unread\` (\`read_at\`, \`created_at\`),
      CONSTRAINT \`fk_customer_messages_customer\`
        FOREIGN KEY (\`customer_id\`) REFERENCES \`customers\` (\`id\`)
        ON UPDATE CASCADE ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await sequelize.query(`
    UPDATE remittances
    SET fee_currency_id = currency_id
    WHERE fee_currency_id IS NULL
  `);

  // Backfill public view tokens for existing customers.
  const missingTokens = await sequelize.query(
    `SELECT id FROM customers WHERE view_token IS NULL OR view_token = ''`,
    { type: QueryTypes.SELECT },
  );
  for (const row of missingTokens) {
    await sequelize.query(
      `UPDATE customers SET view_token = :token WHERE id = :id`,
      { replacements: { id: row.id, token: randomBytes(24).toString('hex') } },
    );
  }

  // Link remittances to a cashbox of the sending branch when missing.
  await sequelize.query(`
    UPDATE remittances r
    LEFT JOIN cashboxes src ON src.branch_id = r.from_branch_id
    SET r.source_cashbox_id = src.id
    WHERE r.source_cashbox_id IS NULL AND src.id IS NOT NULL
  `);

  await sequelize.query(`
    UPDATE remittances r
    LEFT JOIN cashboxes dst ON dst.branch_id = r.to_branch_id
    SET r.destination_cashbox_id = dst.id
    WHERE r.state = 'پرداخت شده' AND r.destination_cashbox_id IS NULL AND dst.id IS NOT NULL
  `);

  await sequelize.query(`
    UPDATE remittances
    SET secret_number = LPAD(FLOOR(100000 + RAND() * 900000), 6, '0')
    WHERE secret_number IS NULL OR secret_number = '' OR CHAR_LENGTH(secret_number) < 6
  `);

  const [{ journalCount }] = await sequelize.query(
    'SELECT COUNT(*) AS journalCount FROM journal_entries',
    { type: QueryTypes.SELECT },
  );

  if (Number(journalCount) === 0) {
    await sequelize.query(`
      INSERT INTO journal_entries
        (number, entry_date, description, debit_account, credit_account, currency_id, amount, branch_id, created_by_name, created_at, updated_at)
      SELECT
        CONCAT('JE-BF-', t.id),
        DATE(COALESCE(t.created_at, NOW())),
        CONCAT('ثبت ', t.kind, ' شماره ', t.number),
        CONCAT('صندوق ', COALESCE(fc.code, t.from_currency_id)),
        CONCAT('صندوق ', COALESCE(tc.code, t.to_currency_id)),
        t.from_currency_id,
        t.from_amount,
        t.branch_id,
        'سامانه',
        COALESCE(t.created_at, NOW()),
        COALESCE(t.updated_at, t.created_at, NOW())
      FROM transactions t
      LEFT JOIN currencies fc ON fc.id = t.from_currency_id
      LEFT JOIN currencies tc ON tc.id = t.to_currency_id
      ORDER BY t.id ASC
    `);

    await sequelize.query(`
      INSERT INTO journal_entries
        (number, entry_date, description, debit_account, credit_account, currency_id, amount, branch_id, created_by_name, created_at, updated_at)
      SELECT
        CONCAT('HVJ-BF-', r.id),
        DATE(COALESCE(r.created_at, NOW())),
        CONCAT('دریافت حواله ', r.number),
        CONCAT('صندوق ', COALESCE(c.code, r.currency_id)),
        'حواله‌های پرداختنی',
        r.currency_id,
        (r.amount + COALESCE(r.fee, 0)),
        r.from_branch_id,
        'سامانه',
        COALESCE(r.created_at, NOW()),
        COALESCE(r.updated_at, r.created_at, NOW())
      FROM remittances r
      LEFT JOIN currencies c ON c.id = r.currency_id
      ORDER BY r.id ASC
    `);

    await sequelize.query(`
      INSERT INTO journal_entries
        (number, entry_date, description, debit_account, credit_account, currency_id, amount, branch_id, created_by_name, created_at, updated_at)
      SELECT
        CONCAT('HVP-BF-', r.id),
        DATE(COALESCE(r.paid_at, r.updated_at, r.created_at, NOW())),
        CONCAT('پرداخت حواله ', r.number),
        'حواله‌های پرداختنی',
        'صندوق پرداخت',
        r.currency_id,
        r.amount,
        r.to_branch_id,
        'سامانه',
        COALESCE(r.paid_at, r.updated_at, r.created_at, NOW()),
        COALESCE(r.updated_at, r.paid_at, r.created_at, NOW())
      FROM remittances r
      WHERE r.state = 'پرداخت شده'
      ORDER BY r.id ASC
    `);
  }
}
