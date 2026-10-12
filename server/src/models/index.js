import { DataTypes } from 'sequelize';
import { sequelize } from '../db/sequelize.js';

const base = { timestamps: true, underscored: true, freezeTableName: true };
const money = (precision = 22, scale = 6) => DataTypes.DECIMAL(precision, scale);

export const Currency = sequelize.define('Currency', {
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  name: { type: DataTypes.STRING(120), allowNull: false },
  code: { type: DataTypes.STRING(10), allowNull: false, unique: true },
  country: DataTypes.STRING(120),
  symbol: DataTypes.STRING(20),
  sign: DataTypes.STRING(20),
  decimalPlaces: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false, defaultValue: 2, field: 'decimal_places' },
  isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'is_active' },
  isBase: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'is_base' },
}, { ...base, tableName: 'currencies' });

export const Branch = sequelize.define('Branch', {
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  name: { type: DataTypes.STRING(120), allowNull: false },
  city: { type: DataTypes.STRING(120), allowNull: false },
  address: DataTypes.STRING(255),
  isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'is_active' },
}, { ...base, tableName: 'branches' });

export const Customer = sequelize.define('Customer', {
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  name: { type: DataTypes.STRING(120), allowNull: false },
  fatherName: { type: DataTypes.STRING(120), field: 'father_name' },
  phone: { type: DataTypes.STRING(30), allowNull: false },
  whatsappPhone: { type: DataTypes.STRING(30), allowNull: true, field: 'whatsapp_phone' },
  avatarUrl: { type: DataTypes.STRING(255), field: 'avatar_url' },
  fingerprintUrl: { type: DataTypes.STRING(255), field: 'fingerprint_url' },
  fingerprintHash: { type: DataTypes.STRING(64), field: 'fingerprint_hash' },
  fingerprintSeed: { type: DataTypes.STRING(80), field: 'fingerprint_seed' },
  fingerprintTemplate: { type: DataTypes.TEXT('long'), field: 'fingerprint_template' },
  fingerprintFormat: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'ZK10', field: 'fingerprint_format' },
  address: DataTypes.STRING(255),
  documentType: { type: DataTypes.STRING(80), field: 'document_type' },
  documentNumber: { type: DataTypes.STRING(80), field: 'document_number' },
  trustLevel: { type: DataTypes.STRING(50), allowNull: false, defaultValue: 'عادی', field: 'trust_level' },
  state: { type: DataTypes.STRING(50), allowNull: false, defaultValue: 'تأیید شده' },
  isSystem: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'is_system' },
  source: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'manual' },
  viewToken: { type: DataTypes.STRING(64), allowNull: true, unique: true, field: 'view_token' },
}, { ...base, tableName: 'customers' });

export const Cashbox = sequelize.define('Cashbox', {
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  branchId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: 'branch_id' },
  name: { type: DataTypes.STRING(120), allowNull: false },
  keeperName: { type: DataTypes.STRING(120), field: 'keeper_name' },
  isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'is_active' },
}, { ...base, tableName: 'cashboxes' });

export const CashboxBalance = sequelize.define('CashboxBalance', {
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  cashboxId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: 'cashbox_id' },
  currencyId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: 'currency_id' },
  amount: { type: money(), allowNull: false, defaultValue: 0 },
}, { ...base, tableName: 'cashbox_balances', indexes: [{ unique: true, fields: ['cashbox_id', 'currency_id'] }] });

export const ExchangeRate = sequelize.define('ExchangeRate', {
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  fromCurrencyId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: 'from_currency_id' },
  toCurrencyId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: 'to_currency_id' },
  buyRate: { type: money(22, 8), allowNull: false, field: 'buy_rate' },
  sellRate: { type: money(22, 8), allowNull: false, field: 'sell_rate' },
  specialRate: { type: money(22, 8), field: 'special_rate' },
  branchId: { type: DataTypes.INTEGER.UNSIGNED, field: 'branch_id' },
  isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'is_active' },
}, { ...base, tableName: 'exchange_rates' });

export const Transaction = sequelize.define('Transaction', {
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  number: { type: DataTypes.STRING(80), allowNull: false, unique: true },
  kind: { type: DataTypes.STRING(80), allowNull: false },
  customerId: { type: DataTypes.INTEGER.UNSIGNED, field: 'customer_id' },
  branchId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: 'branch_id' },
  cashboxId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: 'cashbox_id' },
  fromCurrencyId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: 'from_currency_id' },
  toCurrencyId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: 'to_currency_id' },
  fromAmount: { type: money(), allowNull: false, field: 'from_amount' },
  toAmount: { type: money(), allowNull: false, field: 'to_amount' },
  rate: { type: money(22, 8), allowNull: false },
  fee: { type: money(), allowNull: false, defaultValue: 0 },
  profit: { type: money(), allowNull: false, defaultValue: 0 },
  state: { type: DataTypes.STRING(50), allowNull: false, defaultValue: 'تکمیل شده' },
  note: DataTypes.TEXT,
}, { ...base, tableName: 'transactions' });

export const Remittance = sequelize.define('Remittance', {
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  number: { type: DataTypes.STRING(80), allowNull: false, unique: true },
  senderId: { type: DataTypes.INTEGER.UNSIGNED, field: 'sender_id' },
  receiverName: { type: DataTypes.STRING(120), allowNull: false, field: 'receiver_name' },
  receiverPhone: { type: DataTypes.STRING(30), field: 'receiver_phone' },
  fromBranchId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: 'from_branch_id' },
  toBranchId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: 'to_branch_id' },
  currencyId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: 'currency_id' },
  sourceCashboxId: { type: DataTypes.INTEGER.UNSIGNED, field: 'source_cashbox_id' },
  destinationCashboxId: { type: DataTypes.INTEGER.UNSIGNED, field: 'destination_cashbox_id' },
  amount: { type: money(), allowNull: false },
  fee: { type: money(), allowNull: false, defaultValue: 0 },
  feeCurrencyId: { type: DataTypes.INTEGER.UNSIGNED, field: 'fee_currency_id' },
  secretNumber: { type: DataTypes.STRING(30), allowNull: false, field: 'secret_number' },
  state: { type: DataTypes.STRING(50), allowNull: false, defaultValue: 'در انتظار پرداخت' },
  note: DataTypes.TEXT,
  paidAt: { type: DataTypes.DATE, field: 'paid_at' },
  cancelledAt: { type: DataTypes.DATE, field: 'cancelled_at' },
}, { ...base, tableName: 'remittances' });

export const Account = sequelize.define('Account', {
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  name: { type: DataTypes.STRING(120), allowNull: false },
  kind: { type: DataTypes.STRING(80), allowNull: false },
  ownerName: { type: DataTypes.STRING(120), field: 'owner_name' },
  isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'is_active' },
}, { ...base, tableName: 'accounts' });

export const JournalEntry = sequelize.define('JournalEntry', {
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  number: { type: DataTypes.STRING(80), allowNull: false, unique: true },
  entryDate: { type: DataTypes.DATEONLY, allowNull: false, field: 'entry_date' },
  description: { type: DataTypes.STRING(255), allowNull: false },
  debitAccount: { type: DataTypes.STRING(120), allowNull: false, field: 'debit_account' },
  creditAccount: { type: DataTypes.STRING(120), allowNull: false, field: 'credit_account' },
  currencyId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: 'currency_id' },
  amount: { type: money(), allowNull: false },
  branchId: { type: DataTypes.INTEGER.UNSIGNED, field: 'branch_id' },
  createdByName: { type: DataTypes.STRING(120), field: 'created_by_name' },
}, { ...base, tableName: 'journal_entries' });

export const AuditLog = sequelize.define('AuditLog', {
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  person: DataTypes.STRING(120),
  action: { type: DataTypes.STRING(255), allowNull: false },
  ipAddress: { type: DataTypes.STRING(80), field: 'ip_address' },
  device: DataTypes.STRING(500),
  createdAt: { type: DataTypes.DATE, field: 'created_at' },
}, { timestamps: false, underscored: true, freezeTableName: true, tableName: 'audit_logs' });

export const User = sequelize.define('User', {
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  name: { type: DataTypes.STRING(120), allowNull: false },
  phone: DataTypes.STRING(30),
  avatarUrl: { type: DataTypes.STRING(255), field: 'avatar_url' },
  username: { type: DataTypes.STRING(80), allowNull: false, unique: true },
  password: { type: DataTypes.STRING(255), allowNull: false },
  role: { type: DataTypes.STRING(80), allowNull: false, defaultValue: 'صندوق‌دار' },
  permissions: {
    type: DataTypes.JSON,
    allowNull: true,
    get() {
      const raw = this.getDataValue('permissions');
      if (Array.isArray(raw)) return raw;
      if (typeof raw === 'string' && raw.trim()) {
        try {
          const parsed = JSON.parse(raw);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      }
      return [];
    },
    set(value) {
      if (Array.isArray(value)) this.setDataValue('permissions', value);
      else if (typeof value === 'string' && value.trim()) {
        try {
          const parsed = JSON.parse(value);
          this.setDataValue('permissions', Array.isArray(parsed) ? parsed : []);
        } catch {
          this.setDataValue('permissions', []);
        }
      } else this.setDataValue('permissions', []);
    },
  },
  branchId: { type: DataTypes.INTEGER.UNSIGNED, field: 'branch_id' },
  isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'is_active' },
  lastSeenAt: { type: DataTypes.DATE, field: 'last_seen_at' },
}, { ...base, tableName: 'users', defaultScope: { attributes: { exclude: ['password'] } }, scopes: { withPassword: { attributes: {} } } });

export const SystemSetting = sequelize.define('SystemSetting', {
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  settingKey: { type: DataTypes.STRING(120), allowNull: false, unique: true, field: 'setting_key' },
  settingValue: { type: DataTypes.TEXT, field: 'setting_value' },
}, { ...base, tableName: 'system_settings' });

export const CustomerMessage = sequelize.define('CustomerMessage', {
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  customerId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: 'customer_id' },
  body: { type: DataTypes.TEXT, allowNull: false },
  sender: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'customer' },
  readAt: { type: DataTypes.DATE, field: 'read_at' },
  readByUserId: { type: DataTypes.INTEGER.UNSIGNED, field: 'read_by_user_id' },
}, { ...base, tableName: 'customer_messages' });

export const WhatsappMessage = sequelize.define('WhatsappMessage', {
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  customerId: { type: DataTypes.INTEGER.UNSIGNED, field: 'customer_id' },
  customerName: { type: DataTypes.STRING(120), field: 'customer_name' },
  phone: { type: DataTypes.STRING(30), allowNull: false },
  eventType: { type: DataTypes.STRING(60), allowNull: false, field: 'event_type' },
  referenceType: { type: DataTypes.STRING(60), field: 'reference_type' },
  referenceId: { type: DataTypes.INTEGER.UNSIGNED, field: 'reference_id' },
  documentNumber: { type: DataTypes.STRING(80), field: 'document_number' },
  body: { type: DataTypes.TEXT, allowNull: false },
  status: {
    type: DataTypes.STRING(40),
    allowNull: false,
    defaultValue: 'در انتظار ارسال',
  },
  providerMessageId: { type: DataTypes.STRING(120), field: 'provider_message_id' },
  errorMessage: { type: DataTypes.TEXT, field: 'error_message' },
  attempts: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
  nextAttemptAt: { type: DataTypes.DATE, field: 'next_attempt_at' },
  sentAt: { type: DataTypes.DATE, field: 'sent_at' },
  deliveredAt: { type: DataTypes.DATE, field: 'delivered_at' },
  readAt: { type: DataTypes.DATE, field: 'read_at' },
  failedAt: { type: DataTypes.DATE, field: 'failed_at' },
}, { ...base, tableName: 'whatsapp_messages' });

export const CustomerLedger = sequelize.define('CustomerLedger', {
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  customerId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: 'customer_id' },
  currencyId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: 'currency_id' },
  cashboxId: { type: DataTypes.INTEGER.UNSIGNED, field: 'cashbox_id' },
  type: { type: DataTypes.STRING(30), allowNull: false },
  amount: { type: money(), allowNull: false },
  number: { type: DataTypes.STRING(80), allowNull: false },
  note: DataTypes.TEXT,
}, { ...base, tableName: 'customer_ledgers' });

export const CustomerBalance = sequelize.define('CustomerBalance', {
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  customerId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: 'customer_id' },
  currencyId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: 'currency_id' },
  amount: { type: money(22, 6), allowNull: false, defaultValue: 0 },
}, { ...base, tableName: 'customer_balances', indexes: [{ unique: true, fields: ['customer_id', 'currency_id'] }] });

export const CustomerAccountEntry = sequelize.define('CustomerAccountEntry', {
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  customerId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: 'customer_id' },
  currencyId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: 'currency_id' },
  type: { type: DataTypes.STRING(30), allowNull: false },
  amount: { type: money(18, 2), allowNull: false },
  number: DataTypes.STRING(80),
  note: DataTypes.TEXT,
  entryDate: { type: DataTypes.DATE, field: 'entry_date' },
}, { ...base, tableName: 'customer_account_entries' });

Branch.hasMany(Cashbox, { foreignKey: 'branchId', as: 'cashboxes' });
Cashbox.belongsTo(Branch, { foreignKey: 'branchId', as: 'branch' });
Cashbox.hasMany(CashboxBalance, { foreignKey: 'cashboxId', as: 'balances' });
CashboxBalance.belongsTo(Cashbox, { foreignKey: 'cashboxId', as: 'cashbox' });
CashboxBalance.belongsTo(Currency, { foreignKey: 'currencyId', as: 'currency' });
ExchangeRate.belongsTo(Currency, { foreignKey: 'fromCurrencyId', as: 'fromCurrency' });
ExchangeRate.belongsTo(Currency, { foreignKey: 'toCurrencyId', as: 'toCurrency' });
ExchangeRate.belongsTo(Branch, { foreignKey: 'branchId', as: 'branch' });
Transaction.belongsTo(Customer, { foreignKey: 'customerId', as: 'customer' });
Transaction.belongsTo(Branch, { foreignKey: 'branchId', as: 'branch' });
Transaction.belongsTo(Cashbox, { foreignKey: 'cashboxId', as: 'cashbox' });
Transaction.belongsTo(Currency, { foreignKey: 'fromCurrencyId', as: 'fromCurrency' });
Transaction.belongsTo(Currency, { foreignKey: 'toCurrencyId', as: 'toCurrency' });
Remittance.belongsTo(Customer, { foreignKey: 'senderId', as: 'sender' });
Remittance.belongsTo(Branch, { foreignKey: 'fromBranchId', as: 'fromBranch' });
Remittance.belongsTo(Branch, { foreignKey: 'toBranchId', as: 'toBranch' });
Remittance.belongsTo(Currency, { foreignKey: 'currencyId', as: 'currency' });
Remittance.belongsTo(Currency, { foreignKey: 'feeCurrencyId', as: 'feeCurrency' });
Remittance.belongsTo(Cashbox, { foreignKey: 'sourceCashboxId', as: 'sourceCashbox' });
Remittance.belongsTo(Cashbox, { foreignKey: 'destinationCashboxId', as: 'destinationCashbox' });
JournalEntry.belongsTo(Currency, { foreignKey: 'currencyId', as: 'currency' });
JournalEntry.belongsTo(Branch, { foreignKey: 'branchId', as: 'branch' });
User.belongsTo(Branch, { foreignKey: 'branchId', as: 'branch' });
Customer.hasMany(CustomerLedger, { foreignKey: 'customerId', as: 'ledgerEntries' });
CustomerLedger.belongsTo(Customer, { foreignKey: 'customerId', as: 'customer' });
CustomerLedger.belongsTo(Currency, { foreignKey: 'currencyId', as: 'currency' });
CustomerLedger.belongsTo(Cashbox, { foreignKey: 'cashboxId', as: 'cashbox' });
CustomerBalance.belongsTo(Customer, { foreignKey: 'customerId', as: 'customer' });
CustomerBalance.belongsTo(Currency, { foreignKey: 'currencyId', as: 'currency' });
CustomerAccountEntry.belongsTo(Customer, { foreignKey: 'customerId', as: 'customer' });
CustomerAccountEntry.belongsTo(Currency, { foreignKey: 'currencyId', as: 'currency' });
WhatsappMessage.belongsTo(Customer, { foreignKey: 'customerId', as: 'customer' });
Customer.hasMany(WhatsappMessage, { foreignKey: 'customerId', as: 'whatsappMessages' });
CustomerMessage.belongsTo(Customer, { foreignKey: 'customerId', as: 'customer' });
Customer.hasMany(CustomerMessage, { foreignKey: 'customerId', as: 'messages' });
CustomerMessage.belongsTo(User, { foreignKey: 'readByUserId', as: 'readBy' });

export const CardReaderEntry = sequelize.define('CardReaderEntry', {
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  customerId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, field: 'customer_id' },
  customerName: { type: DataTypes.STRING(160), field: 'customer_name' },
  phone: { type: DataTypes.STRING(40) },
  documentNumber: { type: DataTypes.STRING(80), field: 'document_number' },
  cardNumber: { type: DataTypes.STRING(80), field: 'card_number' },
  bankName: { type: DataTypes.STRING(120), field: 'bank_name' },
  cardHolderName: { type: DataTypes.STRING(160), field: 'card_holder_name' },
  photoUrl: { type: DataTypes.STRING(255), field: 'photo_url' },
  fingerprintUrl: { type: DataTypes.STRING(255), field: 'fingerprint_url' },
  fingerprintHash: { type: DataTypes.STRING(64), field: 'fingerprint_hash' },
  fingerprintTemplate: { type: DataTypes.TEXT('long'), field: 'fingerprint_template' },
  fingerprintFormat: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'ZK10', field: 'fingerprint_format' },
  fingerprintConfirmed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'fingerprint_confirmed' },
  kind: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'deposit' }, // deposit | withdrawal | note
  amount: { type: money(), allowNull: true },
  fee: { type: money(), allowNull: false, defaultValue: 0 },
  currencyId: { type: DataTypes.INTEGER.UNSIGNED, field: 'currency_id' },
  cashboxId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, field: 'cashbox_id' },
  ledgerEntryId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, field: 'ledger_entry_id' },
  note: DataTypes.TEXT,
  createdByName: { type: DataTypes.STRING(120), field: 'created_by_name' },
}, { ...base, tableName: 'card_reader_entries' });

CardReaderEntry.belongsTo(Customer, { foreignKey: 'customerId', as: 'customer', constraints: false });
Customer.hasMany(CardReaderEntry, { foreignKey: 'customerId', as: 'cardReaderEntries', constraints: false });
CardReaderEntry.belongsTo(Currency, { foreignKey: 'currencyId', as: 'currency', constraints: false });
CardReaderEntry.belongsTo(Cashbox, { foreignKey: 'cashboxId', as: 'cashbox', constraints: false });

export const Expense = sequelize.define('Expense', {
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  number: { type: DataTypes.STRING(80), allowNull: false, unique: true },
  branchId: { type: DataTypes.INTEGER.UNSIGNED, field: 'branch_id' },
  cashboxId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: 'cashbox_id' },
  currencyId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: 'currency_id' },
  amount: { type: money(), allowNull: false },
  category: { type: DataTypes.STRING(120), allowNull: false, defaultValue: 'عمومی' },
  description: { type: DataTypes.STRING(255), allowNull: false },
  note: DataTypes.TEXT,
  entryDate: { type: DataTypes.DATEONLY, allowNull: false, field: 'entry_date' },
  journalEntryId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, field: 'journal_entry_id' },
  createdByName: { type: DataTypes.STRING(120), field: 'created_by_name' },
}, { ...base, tableName: 'expenses' });

Expense.belongsTo(Cashbox, { foreignKey: 'cashboxId', as: 'cashbox', constraints: false });
Expense.belongsTo(Currency, { foreignKey: 'currencyId', as: 'currency', constraints: false });
Expense.belongsTo(Branch, { foreignKey: 'branchId', as: 'branch', constraints: false });
Expense.belongsTo(JournalEntry, { foreignKey: 'journalEntryId', as: 'journalEntry', constraints: false });
Cashbox.hasMany(Expense, { foreignKey: 'cashboxId', as: 'expenses', constraints: false });

export const models = {
  Currency, Branch, Customer, Cashbox, CashboxBalance, ExchangeRate, Transaction,
  Remittance, Account, JournalEntry, AuditLog, User, SystemSetting, CustomerLedger,
  CustomerBalance, CustomerAccountEntry, WhatsappMessage, CustomerMessage, CardReaderEntry,
  Expense,
};
