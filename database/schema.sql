SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE DATABASE IF NOT EXISTS `zarin_hesab`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
USE `zarin_hesab`;

CREATE TABLE IF NOT EXISTS `currencies` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(120) NOT NULL,
  `code` VARCHAR(10) NOT NULL,
  `country` VARCHAR(120) NULL,
  `symbol` VARCHAR(20) NULL,
  `sign` VARCHAR(20) NULL,
  `decimal_places` TINYINT UNSIGNED NOT NULL DEFAULT 2,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `is_base` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_currencies_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `branches` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(120) NOT NULL,
  `city` VARCHAR(120) NOT NULL,
  `address` VARCHAR(255) NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `customers` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(120) NOT NULL,
  `father_name` VARCHAR(120) NULL,
  `phone` VARCHAR(30) NOT NULL,
  `avatar_url` VARCHAR(255) NULL,
  `address` VARCHAR(255) NULL,
  `document_type` VARCHAR(80) NULL,
  `document_number` VARCHAR(80) NULL,
  `trust_level` VARCHAR(50) NOT NULL DEFAULT 'عادی',
  `state` VARCHAR(50) NOT NULL DEFAULT 'تأیید شده',
  `view_token` VARCHAR(64) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_customers_view_token` (`view_token`),
  KEY `idx_customers_phone` (`phone`),
  KEY `idx_customers_document` (`document_number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `cashboxes` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `branch_id` INT UNSIGNED NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `keeper_name` VARCHAR(120) NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_cashboxes_branch` (`branch_id`),
  CONSTRAINT `fk_cashboxes_branch` FOREIGN KEY (`branch_id`) REFERENCES `branches` (`id`) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `cashbox_balances` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `cashbox_id` INT UNSIGNED NOT NULL,
  `currency_id` INT UNSIGNED NOT NULL,
  `amount` DECIMAL(22,6) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cashbox_currency` (`cashbox_id`,`currency_id`),
  KEY `idx_cashbox_balances_currency` (`currency_id`),
  CONSTRAINT `fk_cashbox_balances_cashbox` FOREIGN KEY (`cashbox_id`) REFERENCES `cashboxes` (`id`) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT `fk_cashbox_balances_currency` FOREIGN KEY (`currency_id`) REFERENCES `currencies` (`id`) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `exchange_rates` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `from_currency_id` INT UNSIGNED NOT NULL,
  `to_currency_id` INT UNSIGNED NOT NULL,
  `buy_rate` DECIMAL(22,8) NOT NULL,
  `sell_rate` DECIMAL(22,8) NOT NULL,
  `special_rate` DECIMAL(22,8) NULL,
  `branch_id` INT UNSIGNED NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_rates_pair` (`from_currency_id`,`to_currency_id`),
  KEY `idx_rates_branch` (`branch_id`),
  CONSTRAINT `fk_rates_from_currency` FOREIGN KEY (`from_currency_id`) REFERENCES `currencies` (`id`) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT `fk_rates_to_currency` FOREIGN KEY (`to_currency_id`) REFERENCES `currencies` (`id`) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT `fk_rates_branch` FOREIGN KEY (`branch_id`) REFERENCES `branches` (`id`) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `accounts` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(120) NOT NULL,
  `kind` VARCHAR(80) NOT NULL,
  `owner_name` VARCHAR(120) NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `transactions` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `number` VARCHAR(80) NOT NULL,
  `kind` VARCHAR(80) NOT NULL,
  `customer_id` INT UNSIGNED NULL,
  `branch_id` INT UNSIGNED NOT NULL,
  `cashbox_id` INT UNSIGNED NOT NULL,
  `from_currency_id` INT UNSIGNED NOT NULL,
  `to_currency_id` INT UNSIGNED NOT NULL,
  `from_amount` DECIMAL(22,6) NOT NULL,
  `to_amount` DECIMAL(22,6) NOT NULL,
  `rate` DECIMAL(22,8) NOT NULL,
  `fee` DECIMAL(22,6) NOT NULL DEFAULT 0,
  `profit` DECIMAL(22,6) NOT NULL DEFAULT 0,
  `state` VARCHAR(50) NOT NULL DEFAULT 'تکمیل شده',
  `note` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_transactions_number` (`number`),
  KEY `idx_transactions_created` (`created_at`),
  KEY `idx_transactions_customer` (`customer_id`),
  KEY `idx_transactions_branch` (`branch_id`),
  KEY `idx_transactions_cashbox` (`cashbox_id`),
  CONSTRAINT `fk_transactions_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT `fk_transactions_branch` FOREIGN KEY (`branch_id`) REFERENCES `branches` (`id`) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT `fk_transactions_cashbox` FOREIGN KEY (`cashbox_id`) REFERENCES `cashboxes` (`id`) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT `fk_transactions_from_currency` FOREIGN KEY (`from_currency_id`) REFERENCES `currencies` (`id`) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT `fk_transactions_to_currency` FOREIGN KEY (`to_currency_id`) REFERENCES `currencies` (`id`) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `remittances` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `number` VARCHAR(80) NOT NULL,
  `sender_id` INT UNSIGNED NULL,
  `receiver_name` VARCHAR(120) NOT NULL,
  `receiver_phone` VARCHAR(30) NULL,
  `from_branch_id` INT UNSIGNED NOT NULL,
  `to_branch_id` INT UNSIGNED NOT NULL,
  `currency_id` INT UNSIGNED NOT NULL,
  `source_cashbox_id` INT UNSIGNED NULL,
  `destination_cashbox_id` INT UNSIGNED NULL,
  `amount` DECIMAL(22,6) NOT NULL,
  `fee` DECIMAL(22,6) NOT NULL DEFAULT 0,
  `secret_number` VARCHAR(30) NOT NULL,
  `state` VARCHAR(50) NOT NULL DEFAULT 'در انتظار پرداخت',
  `note` TEXT NULL,
  `paid_at` DATETIME NULL,
  `cancelled_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_remittances_number` (`number`),
  KEY `idx_remittances_state` (`state`),
  CONSTRAINT `fk_remittances_sender` FOREIGN KEY (`sender_id`) REFERENCES `customers` (`id`) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT `fk_remittances_from_branch` FOREIGN KEY (`from_branch_id`) REFERENCES `branches` (`id`) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT `fk_remittances_to_branch` FOREIGN KEY (`to_branch_id`) REFERENCES `branches` (`id`) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT `fk_remittances_currency` FOREIGN KEY (`currency_id`) REFERENCES `currencies` (`id`) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT `fk_remittances_source_cashbox` FOREIGN KEY (`source_cashbox_id`) REFERENCES `cashboxes` (`id`) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT `fk_remittances_destination_cashbox` FOREIGN KEY (`destination_cashbox_id`) REFERENCES `cashboxes` (`id`) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `journal_entries` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `number` VARCHAR(80) NOT NULL,
  `entry_date` DATE NOT NULL,
  `description` VARCHAR(255) NOT NULL,
  `debit_account` VARCHAR(120) NOT NULL,
  `credit_account` VARCHAR(120) NOT NULL,
  `currency_id` INT UNSIGNED NOT NULL,
  `amount` DECIMAL(22,6) NOT NULL,
  `branch_id` INT UNSIGNED NULL,
  `created_by_name` VARCHAR(120) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_journal_number` (`number`),
  KEY `idx_journal_entry_date` (`entry_date`),
  CONSTRAINT `fk_journal_currency` FOREIGN KEY (`currency_id`) REFERENCES `currencies` (`id`) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT `fk_journal_branch` FOREIGN KEY (`branch_id`) REFERENCES `branches` (`id`) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `users` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(120) NOT NULL,
  `phone` VARCHAR(30) NULL,
  `avatar_url` VARCHAR(255) NULL,
  `username` VARCHAR(80) NOT NULL,
  `password` VARCHAR(255) NOT NULL,
  `role` VARCHAR(80) NOT NULL DEFAULT 'صندوق‌دار',
  `permissions` JSON NULL,
  `branch_id` INT UNSIGNED NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `last_seen_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_username` (`username`),
  CONSTRAINT `fk_users_branch` FOREIGN KEY (`branch_id`) REFERENCES `branches` (`id`) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `customer_messages` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `customer_id` INT UNSIGNED NOT NULL,
  `body` TEXT NOT NULL,
  `sender` VARCHAR(20) NOT NULL DEFAULT 'customer',
  `read_at` DATETIME NULL,
  `read_by_user_id` INT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_customer_messages_customer` (`customer_id`),
  KEY `idx_customer_messages_unread` (`read_at`, `created_at`),
  CONSTRAINT `fk_customer_messages_customer`
    FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `system_settings` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `setting_key` VARCHAR(120) NOT NULL,
  `setting_value` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_system_settings_key` (`setting_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `audit_logs` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `person` VARCHAR(120) NULL,
  `action` VARCHAR(255) NOT NULL,
  `ip_address` VARCHAR(80) NULL,
  `device` VARCHAR(500) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_audit_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `customer_ledgers` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `customer_id` INT UNSIGNED NOT NULL,
  `currency_id` INT UNSIGNED NOT NULL,
  `cashbox_id` INT UNSIGNED NULL,
  `type` VARCHAR(30) NOT NULL,
  `amount` DECIMAL(22,6) NOT NULL,
  `number` VARCHAR(80) NOT NULL,
  `note` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_customer_ledgers_customer` (`customer_id`),
  KEY `idx_customer_ledgers_currency` (`currency_id`),
  CONSTRAINT `fk_customer_ledgers_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT `fk_customer_ledgers_currency` FOREIGN KEY (`currency_id`) REFERENCES `currencies` (`id`) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT `fk_customer_ledgers_cashbox` FOREIGN KEY (`cashbox_id`) REFERENCES `cashboxes` (`id`) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `card_reader_entries` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `customer_id` INT UNSIGNED NOT NULL,
  `kind` VARCHAR(30) NOT NULL DEFAULT 'note',
  `amount` DECIMAL(22,6) NULL,
  `currency_id` INT UNSIGNED NULL,
  `note` TEXT NULL,
  `created_by_name` VARCHAR(120) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_card_reader_customer` (`customer_id`),
  KEY `idx_card_reader_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `customer_balances` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `customer_id` INT UNSIGNED NOT NULL,
  `currency_id` INT UNSIGNED NOT NULL,
  `amount` DECIMAL(22,6) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_customer_balance` (`customer_id`,`currency_id`),
  CONSTRAINT `fk_customer_balances_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT `fk_customer_balances_currency` FOREIGN KEY (`currency_id`) REFERENCES `currencies` (`id`) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `customer_account_entries` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `customer_id` INT UNSIGNED NOT NULL,
  `currency_id` INT UNSIGNED NOT NULL,
  `type` VARCHAR(30) NOT NULL,
  `amount` DECIMAL(18,2) NOT NULL,
  `number` VARCHAR(80) NULL,
  `note` TEXT NULL,
  `entry_date` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_customer_account_entries_customer` (`customer_id`),
  CONSTRAINT `fk_customer_account_entries_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT `fk_customer_account_entries_currency` FOREIGN KEY (`currency_id`) REFERENCES `currencies` (`id`) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
