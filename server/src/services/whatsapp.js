import Decimal from 'decimal.js';
import { Op } from 'sequelize';
import {
  Customer, CustomerBalance, Currency, Remittance, SystemSetting, Transaction, WhatsappMessage,
} from '../models/index.js';

const D = (value) => new Decimal(value || 0);
const STATUS = {
  pending: 'در انتظار ارسال',
  sent: 'ارسال‌شده',
  delivered: 'تحویل‌شده',
  read: 'خوانده‌شده',
  failed: 'ناموفق',
};

const MAX_ATTEMPTS = 5;
const RETRY_MINUTES = [1, 5, 15, 60, 180];

async function loadSettings() {
  const rows = await SystemSetting.findAll();
  return Object.fromEntries(rows.map((r) => [r.settingKey, r.settingValue]));
}

function isOn(value) {
  return String(value || '').trim() === 'روشن';
}

function sendMode(settings) {
  const mode = String(settings.whatsapp_send_mode || 'simple').trim().toLowerCase();
  return mode === 'meta' ? 'meta' : 'simple';
}

export function normalizeWhatsappPhone(raw, defaultCountryCode = '93') {
  let digits = String(raw || '').replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  digits = digits.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0') && defaultCountryCode) {
    digits = `${defaultCountryCode}${digits.slice(1)}`;
  }
  return digits;
}

function toPersianDigits(value) {
  return String(value ?? '').replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
}

function formatAmount(value) {
  const raw = D(value || 0).toFixed(6).replace(/\.?0+$/, '');
  return toPersianDigits(raw || '0');
}

function shortDocNo(number) {
  const raw = String(number || '').trim();
  if (!raw) return '—';
  if (raw.length <= 16) return raw;
  const parts = raw.split('-');
  if (parts.length >= 2) return `${parts[0]}-${parts[parts.length - 1]}`;
  return raw.slice(-10);
}

/** Gregorian Date → jalali d/m/yyyy like ۳۱/۴/۱۴۰۵ */
function toJalaliDateLabel(input = new Date()) {
  const date = input instanceof Date ? input : new Date(input);
  let gy = date.getFullYear();
  let gm = date.getMonth() + 1;
  let gd = date.getDate();
  const gdm = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  let jy = gy <= 1600 ? 0 : 979;
  gy -= gy <= 1600 ? 621 : 1600;
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days = 365 * gy + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100)
    + Math.floor((gy2 + 399) / 400) - 80 + gd + gdm[gm - 1];
  jy += 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    jy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  const jm = days < 186 ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
  return toPersianDigits(`${jd}/${jm}/${jy}`);
}

function amountToPersianWords(value) {
  const ones = ['', 'یک', 'دو', 'سه', 'چهار', 'پنج', 'شش', 'هفت', 'هشت', 'نه'];
  const teens = ['ده', 'یازده', 'دوازده', 'سیزده', 'چهارده', 'پانزده', 'شانزده', 'هفده', 'هجده', 'نوزده'];
  const tens = ['', '', 'بیست', 'سی', 'چهل', 'پنجاه', 'شصت', 'هفتاد', 'هشتاد', 'نود'];
  const hundreds = ['', 'صد', 'دویست', 'سیصد', 'چهارصد', 'پانصد', 'ششصد', 'هفتصد', 'هشتصد', 'نهصد'];
  const scales = ['', 'هزار', 'میلیون', 'میلیارد', 'تریلیون'];

  const joinParts = (parts) => parts.filter(Boolean).join(' و ');

  const underThousand = (n) => {
    const parts = [];
    const h = Math.floor(n / 100);
    const rem = n % 100;
    if (h) parts.push(hundreds[h]);
    if (rem >= 10 && rem <= 19) parts.push(teens[rem - 10]);
    else {
      const t = Math.floor(rem / 10);
      const o = rem % 10;
      if (t) parts.push(tens[t]);
      if (o) parts.push(ones[o]);
    }
    return joinParts(parts);
  };

  let num = Math.floor(Math.abs(Number(value) || 0));
  if (!Number.isFinite(num)) return 'صفر';
  if (num === 0) return 'صفر';

  const chunks = [];
  let scale = 0;
  while (num > 0 && scale < scales.length) {
    const chunk = num % 1000;
    if (chunk) {
      const words = underThousand(chunk);
      const withScale = scales[scale] ? `${words} ${scales[scale]}`.trim() : words;
      chunks.unshift(withScale);
    }
    num = Math.floor(num / 1000);
    scale += 1;
  }
  return joinParts(chunks) || 'صفر';
}

function previousBalanceLabel(signedAmount) {
  const bal = D(signedAmount || 0);
  if (bal.gt(0)) return 'طلب قبلی';
  return 'بدهی قبلی';
}

const PLACEHOLDER_ALIASES = {
  company: ['{{company}}', '[نام صرافی]'],
  title: ['{{title}}', '[عنوان رسید]'],
  customer: ['{{customer}}', '[نام مشتری]'],
  date: ['{{date}}', '[تاریخ]'],
  previous_label: ['{{previous_label}}', '[بدهی قبلی]'],
  previous: ['{{previous}}', '[مبلغ قبلی]'],
  movement_label: ['{{movement_label}}', '[نوع مبلغ]'],
  amount: ['{{amount}}', '[مبلغ]'],
  remaining: ['{{remaining}}', '[الباقی]'],
  remaining_words: ['{{remaining_words}}', '[حروف]'],
  currency: ['{{currency}}', '[ارز]'],
};

const DEFAULT_WHATSAPP_TEMPLATE = [
  'PPlus.Arz',
  '[عنوان رسید]',
  'نام مشتری : [نام مشتری]',
  'تاریخ [تاریخ]',
  '[بدهی قبلی] [مبلغ قبلی] [ارز]',
  '[نوع مبلغ] : [مبلغ] [ارز]',
  'الباقی حساب [الباقی] [حروف] [ارز]',
].join('\n');

export function getDefaultWhatsappTemplate() {
  return DEFAULT_WHATSAPP_TEMPLATE;
}

function applyWhatsappTemplate(template, vars) {
  let out = String(template || DEFAULT_WHATSAPP_TEMPLATE);
  for (const [key, value] of Object.entries(vars)) {
    const tokens = PLACEHOLDER_ALIASES[key] || [`{{${key}}}`];
    const text = String(value ?? '');
    for (const token of tokens) {
      out = out.split(token).join(text);
    }
  }
  // strip any leftover machine tokens
  out = out.replace(/\{\{[a-z0-9_]+\}\}/gi, '');
  for (const tokens of Object.values(PLACEHOLDER_ALIASES)) {
    for (const token of tokens) {
      if (token.startsWith('[')) out = out.split(token).join('');
    }
  }
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Receipt-style WhatsApp body matching shop format.
 * Editable via settings key whatsapp_message_template.
 */
function buildCustomerReceiptMessage({
  company,
  title,
  customerName,
  when,
  previousBalance,
  movementAmount,
  movementLabel,
  remainingBalance,
  currencyLabel,
  template,
}) {
  const cur = currencyLabel || '';
  const prev = D(previousBalance || 0);
  const remain = D(remainingBalance || 0);
  const remainWords = amountToPersianWords(remain.abs().toDecimalPlaces(0).toNumber());
  return applyWhatsappTemplate(template, {
    company: company || 'PPlus.Arz',
    title: title || '',
    customer: customerName || '—',
    date: toJalaliDateLabel(when),
    previous_label: previousBalanceLabel(prev),
    previous: formatAmount(prev.abs()),
    movement_label: movementLabel || 'مبلغ',
    amount: formatAmount(movementAmount),
    remaining: formatAmount(remain.abs()),
    remaining_words: remainWords,
    currency: cur,
  });
}

function buildWaMeLink(phone, body) {
  return `https://wa.me/${phone}?text=${encodeURIComponent(body)}`;
}

async function companySign(settings) {
  const name = String(settings.company_name || 'PPlus.Arz').trim() || 'PPlus.Arz';
  if (/^صرافی(\s|$)/.test(name)) return name;
  return `صرافی ${name}`;
}

async function getCustomerBalanceAmount(customerId, currencyId) {
  if (!customerId || !currencyId) return D(0);
  const row = await CustomerBalance.findOne({ where: { customerId, currencyId } });
  return D(row?.amount || 0);
}

/** Prefer dedicated WhatsApp number; fall back to contact phone for older customers. */
export function customerNotifyPhone(customer) {
  if (!customer) return '';
  const wa = String(customer.whatsappPhone || customer.whatsapp_phone || '').trim();
  if (wa && wa !== 'بدون‌شماره') return wa;
  const phone = String(customer.phone || '').trim();
  if (phone && phone !== 'بدون‌شماره') return phone;
  return '';
}

/**
 * Queue + deliver notification.
 * simple mode: builds wa.me link (frontend opens WhatsApp) — no Meta token needed.
 * meta mode: Cloud API queue.
 */
export async function enqueueWhatsappMessage(payload) {
  const { loadAppPlan } = await import('../utils/appPlans.js');
  const plan = await loadAppPlan();
  if (!plan.features.whatsapp) return null;
  const settings = await loadSettings();
  if (!isOn(settings.whatsapp_enabled)) return null;

  const phone = normalizeWhatsappPhone(payload.phone, settings.whatsapp_default_country_code || '93');
  if (!phone || phone.length < 8) return null;

  const mode = sendMode(settings);
  const link = buildWaMeLink(phone, payload.body);

  if (mode === 'simple') {
    const row = await WhatsappMessage.create({
      customerId: payload.customerId || null,
      customerName: payload.customerName || null,
      phone,
      eventType: payload.eventType,
      referenceType: payload.referenceType || null,
      referenceId: payload.referenceId || null,
      documentNumber: shortDocNo(payload.documentNumber),
      body: payload.body,
      status: STATUS.sent,
      providerMessageId: link.slice(0, 120),
      sentAt: new Date(),
      attempts: 1,
      errorMessage: null,
    });
    return { id: row.id, phone, body: payload.body, link, mode: 'simple' };
  }

  const row = await WhatsappMessage.create({
    customerId: payload.customerId || null,
    customerName: payload.customerName || null,
    phone,
    eventType: payload.eventType,
    referenceType: payload.referenceType || null,
    referenceId: payload.referenceId || null,
    documentNumber: shortDocNo(payload.documentNumber),
    body: payload.body,
    status: STATUS.pending,
    nextAttemptAt: new Date(),
    attempts: 0,
  });

  setImmediate(() => {
    processWhatsappQueue({ limit: 10 }).catch((err) => {
      console.error('[whatsapp] immediate send failed:', err?.message || err);
    });
  });

  return { id: row.id, phone, body: payload.body, link, mode: 'meta' };
}

export async function notifyMoneyTransaction(transactionRow) {
  const settings = await loadSettings();
  if (!isOn(settings.whatsapp_enabled) || !isOn(settings.whatsapp_notify_transactions)) return null;
  if (!transactionRow?.customerId) return null;

  const row = transactionRow.customer
    ? transactionRow
    : await Transaction.findByPk(transactionRow.id, {
      include: ['customer', 'fromCurrency', 'toCurrency'],
    });
  const customer = row.customer;
  const notifyPhone = customerNotifyPhone(customer);
  if (!notifyPhone) return null;

  const kind = String(row.kind || '');
  const fromLabel = row.fromCurrency?.name || row.fromCurrency?.code || '';
  const remaining = await getCustomerBalanceAmount(customer.id, row.fromCurrencyId);
  const company = await companySign(settings);

  let title = 'رسید معامله';
  if (kind.includes('خرید')) title = 'رسید خرید';
  else if (kind.includes('فروش')) title = 'رسید فروش';
  else if (kind.includes('تبدیل')) title = 'رسید تبدیل';

  const body = buildCustomerReceiptMessage({
    company,
    title,
    customerName: customer.name,
    when: row.createdAt || new Date(),
    previousBalance: remaining,
    movementAmount: row.fromAmount,
    movementLabel: 'رسیده',
    remainingBalance: remaining,
    currencyLabel: fromLabel,
    template: settings.whatsapp_message_template,
  });

  return enqueueWhatsappMessage({
    customerId: customer.id,
    customerName: customer.name,
    phone: notifyPhone,
    eventType: 'transaction',
    referenceType: 'transaction',
    referenceId: row.id,
    documentNumber: row.number,
    body,
  });
}

export async function notifyLedgerEntry(entry, customer, currency, settlement = null) {
  const settings = await loadSettings();
  if (!isOn(settings.whatsapp_enabled) || !isOn(settings.whatsapp_notify_ledger)) return null;
  const notifyPhone = customerNotifyPhone(customer);
  if (!notifyPhone) return null;

  const currencyLabel = currency?.name || currency?.code || '';
  const remaining = await getCustomerBalanceAmount(customer.id, currency?.id || entry.currencyId);
  const amount = D(entry.amount || 0);
  let previous = remaining;
  let title = 'رسید حساب';
  let movementLabel = 'مبلغ';

  if (settlement?.settleCurrency) {
    const settleName = settlement.settleCurrency.name || settlement.settleCurrency.code || 'ارز';
    const payName = settlement.payCurrency?.name || settlement.payCurrency?.code || '';
    previous = remaining.plus(amount);
    title = 'رسید پرداخت';
    movementLabel = `کسر از حساب ${settleName}`;
    const company = await companySign(settings);
    let body = buildCustomerReceiptMessage({
      company,
      title,
      customerName: customer.name,
      when: entry.createdAt || new Date(),
      previousBalance: previous,
      movementAmount: amount,
      movementLabel,
      remainingBalance: remaining,
      currencyLabel: settleName,
      template: settings.whatsapp_message_template,
    });
    if (settlement.payAmount && payName) {
      body += `\nنقدی پرداخت‌شده : ${formatAmount(settlement.payAmount)} ${payName}`;
    }
    return enqueueWhatsappMessage({
      customerId: customer.id,
      customerName: customer.name,
      phone: notifyPhone,
      eventType: 'ledger_paid_settle',
      referenceType: 'customer_ledger',
      referenceId: entry.id,
      documentNumber: entry.number,
      body,
    });
  }

  if (entry.type === 'received') {
    // received increases balance → previous = remaining - amount
    previous = remaining.minus(amount);
    title = 'رسید دریافت';
    movementLabel = 'رسیده';
  } else if (entry.type === 'paid') {
    previous = remaining.plus(amount);
    title = 'رسید پرداخت';
    movementLabel = 'پرداخت';
  } else if (entry.type === 'opening') {
    previous = D(0);
    title = 'موجودی اول دوره';
    movementLabel = 'ثبت';
  }

  const company = await companySign(settings);
  const body = buildCustomerReceiptMessage({
    company,
    title,
    customerName: customer.name,
    when: entry.createdAt || new Date(),
    previousBalance: previous,
    movementAmount: amount,
    movementLabel,
    remainingBalance: remaining,
    currencyLabel,
    template: settings.whatsapp_message_template,
  });

  return enqueueWhatsappMessage({
    customerId: customer.id,
    customerName: customer.name,
    phone: notifyPhone,
    eventType: entry.type === 'paid' ? 'ledger_paid' : 'ledger_received',
    referenceType: 'customer_ledger',
    referenceId: entry.id,
    documentNumber: entry.number,
    body,
  });
}

export async function notifyBalanceConvert(result) {
  const settings = await loadSettings();
  if (!isOn(settings.whatsapp_enabled) || !isOn(settings.whatsapp_notify_convert)) return null;
  const customer = result?.customer || await Customer.findByPk(result.outEntry?.customerId);
  const notifyPhone = customerNotifyPhone(customer);
  if (!notifyPhone) return null;

  const toLabel = result.toCurrency?.name || result.toCurrency?.code || '';
  const remaining = await getCustomerBalanceAmount(customer.id, result.toCurrency?.id);
  const previous = remaining.minus(D(result.toAmount || 0));
  const company = await companySign(settings);
  const number = result.number || result.outEntry?.number;

  const body = buildCustomerReceiptMessage({
    company,
    title: 'رسید تبدیل ارز',
    customerName: customer.name,
    when: new Date(),
    previousBalance: previous,
    movementAmount: result.toAmount,
    movementLabel: 'رسیده',
    remainingBalance: remaining,
    currencyLabel: toLabel,
    template: settings.whatsapp_message_template,
  });

  return enqueueWhatsappMessage({
    customerId: customer.id,
    customerName: customer.name,
    phone: notifyPhone,
    eventType: 'balance_convert',
    referenceType: 'customer_ledger',
    referenceId: result.outEntry?.id,
    documentNumber: number,
    body,
  });
}

export async function notifyRemittance(remittance, eventType = 'remittance_created') {
  const settings = await loadSettings();
  if (!isOn(settings.whatsapp_enabled) || !isOn(settings.whatsapp_notify_remittances)) return null;

  const row = remittance.currency
    ? remittance
    : await Remittance.findByPk(remittance.id, { include: ['sender', 'currency', 'fromBranch', 'toBranch'] });

  const currencyLabel = row.currency?.name || row.currency?.code || '';
  const company = await companySign(settings);
  const links = [];

  let title = 'رسید حواله';
  if (eventType === 'remittance_paid') title = 'پرداخت حواله';
  else if (eventType === 'remittance_cancelled') title = 'لغو حواله';

  const targets = [];
  const senderPhone = customerNotifyPhone(row.sender);
  if (senderPhone) {
    targets.push({
      customerId: row.sender.id,
      customerName: row.sender.name,
      phone: senderPhone,
    });
  }
  if (row.receiverPhone) {
    targets.push({
      customerId: null,
      customerName: row.receiverName,
      phone: row.receiverPhone,
    });
  }

  for (const target of targets) {
    const remaining = target.customerId
      ? await getCustomerBalanceAmount(target.customerId, row.currencyId)
      : D(0);

    const body = buildCustomerReceiptMessage({
      company,
      title,
      customerName: target.customerName,
      when: row.createdAt || new Date(),
      previousBalance: remaining,
      movementAmount: row.amount,
      movementLabel: 'مبلغ حواله',
      remainingBalance: remaining,
      currencyLabel,
      template: settings.whatsapp_message_template,
    });

    const wa = await enqueueWhatsappMessage({
      customerId: target.customerId,
      customerName: target.customerName,
      phone: target.phone,
      eventType,
      referenceType: 'remittance',
      referenceId: row.id,
      documentNumber: row.number,
      body,
    });
    if (wa) links.push(wa);
  }

  return links[0] || null;
}

export async function queueNotifyMoneyTransaction(row) {
  try {
    return await notifyMoneyTransaction(row);
  } catch (err) {
    console.error('[whatsapp] enqueue failed:', err?.message || err);
    return null;
  }
}
export async function queueNotifyLedgerEntry(entry, customer, currency, settlement = null) {
  try {
    return await notifyLedgerEntry(entry, customer, currency, settlement);
  } catch (err) {
    console.error('[whatsapp] enqueue failed:', err?.message || err);
    return null;
  }
}

const LEDGER_COPY = {
  fa: {
    dir: 'rtl',
    exchangePrefix: 'صرافی',
    title: 'گردش حساب مشتری',
    customer: 'مشتری',
    code: 'کد',
    date: 'تاریخ',
    currentBalance: 'مانده فعلی',
    noBalance: 'بدون مانده',
    activity: 'گردش {code}',
    type: 'نوع',
    doc: 'سند',
    amount: 'مبلغ',
    balance: 'مانده',
    note: 'یادداشت',
    noActivity: 'بدون گردش',
    omitted: '… {n} سطر قدیمی‌تر حذف شد',
    truncated: 'برای مشاهده کامل به حساب مشتری مراجعه کنید.',
    respect: 'با احترام',
    sides: { creditor: 'طلبکار', debtor: 'قرضدار', settled: 'تسویه' },
    types: {
      opening_creditor: 'موجودی اول (طلبکار)',
      opening_debtor: 'موجودی اول (قرضدار)',
      received: 'رسید',
      paid: 'برد',
      transfer_out: 'حواله خروجی',
      transfer_in: 'حواله ورودی',
      convert_out: 'تبدیل خروجی',
      convert_in: 'تبدیل ورودی',
    },
  },
  ps: {
    dir: 'rtl',
    exchangePrefix: 'صرافي',
    title: 'د حساب گردش',
    customer: 'پېرودونکی',
    code: 'کوډ',
    date: 'نېټه',
    currentBalance: 'اوسنی پاتې شونی',
    noBalance: 'پاتې شونی نشته',
    activity: 'د {code} گردش',
    type: 'ډول',
    doc: 'سند',
    amount: 'مبلغ',
    balance: 'پاتې',
    note: 'یادښت',
    noActivity: 'گردش نشته',
    omitted: '… {n} پخوانۍ کرښې لرې شوې',
    truncated: 'د بشپړ لید لپاره حساب ته مراجعه وکړئ.',
    respect: 'په درناوي',
    sides: { creditor: 'طلبکار', debtor: 'پوروړی', settled: 'تصفیه' },
    types: {
      opening_creditor: 'د پیل بیلانس (طلبکار)',
      opening_debtor: 'د پیل بیلانس (پوروړی)',
      received: 'ترلاسه',
      paid: 'ورکړه',
      transfer_out: 'صادره حواله',
      transfer_in: 'راتلونکې حواله',
      convert_out: 'تبدیل (وتل)',
      convert_in: 'تبدیل (راتګ)',
    },
  },
  en: {
    dir: 'ltr',
    exchangePrefix: '',
    title: 'Customer ledger',
    customer: 'Customer',
    code: 'ID',
    date: 'Date',
    currentBalance: 'Current balance',
    noBalance: 'No balance',
    activity: '{code} activity',
    type: 'Type',
    doc: 'Doc',
    amount: 'Amount',
    balance: 'Balance',
    note: 'Note',
    noActivity: 'No activity',
    omitted: '… {n} older rows omitted',
    truncated: 'See the customer account for the full statement.',
    respect: 'With respect',
    sides: { creditor: 'creditor', debtor: 'debtor', settled: 'settled' },
    types: {
      opening_creditor: 'Opening (creditor)',
      opening_debtor: 'Opening (debtor)',
      received: 'Receipt',
      paid: 'Payment',
      transfer_out: 'Hawala sent',
      transfer_in: 'Hawala received',
      convert_out: 'Convert (out)',
      convert_in: 'Convert (in)',
    },
  },
};

const RLM = '\u200F';
const LEDGER_DIVIDER = '━━━━━━━━━━━━';

export function resolveLedgerLang(raw) {
  const s = String(raw || '').toLowerCase().split(/[-_]/)[0];
  return s === 'ps' || s === 'en' ? s : 'fa';
}

function ledgerCopy(lang) {
  return LEDGER_COPY[resolveLedgerLang(lang)] || LEDGER_COPY.fa;
}

function line(text, lang) {
  return resolveLedgerLang(lang) === 'en' ? String(text) : `${RLM}${text}`;
}

function toLatinDigits(value) {
  return String(value ?? '')
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}

function formatLedgerDigits(value) {
  return toLatinDigits(value);
}

function formatLedgerMoney(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return '0';
  const raw = D(n).toFixed(6).replace(/\.?0+$/, '');
  const [intPart, frac] = raw.split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac ? `${grouped}.${frac}` : grouped;
}

function formatLedgerDate(input, lang) {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return '—';
  if (resolveLedgerLang(lang) === 'en') {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kabul',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(date);
  }
  return toLatinDigits(toJalaliDateLabel(date));
}

function ledgerSideLabel(side, copy) {
  return copy.sides[side] || copy.sides.settled;
}

function ledgerTypeLabel(row, copy) {
  return copy.types[row?.typeKey] || copy.types[row?.type] || row?.type || '—';
}

function entryMark(index) {
  return `${index}.`;
}

function companyTitle(settings, copy, lang) {
  let name = String(settings.company_name || 'PPlus.Arz').trim() || 'PPlus.Arz';
  name = name.replace(/^صراف[يی]\s+/u, '');
  if (resolveLedgerLang(lang) === 'en' || !copy.exchangePrefix) return name;
  return `${copy.exchangePrefix} ${name}`;
}

function normalizeLedgerNote(value) {
  return String(value || '')
    .replace(/دوره/g, '')
    .replace(/[()[\]|\-–—.,،]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function extraLedgerNote(note, typeKey, typeFallback) {
  const raw = String(note || '').trim();
  if (!raw) return '';
  const a = normalizeLedgerNote(raw);
  const variants = [];
  for (const copy of Object.values(LEDGER_COPY)) {
    if (typeKey && copy.types[typeKey]) variants.push(copy.types[typeKey]);
  }
  if (typeFallback) variants.push(typeFallback);
  for (const label of variants) {
    const b = normalizeLedgerNote(label);
    if (b && a === b) return '';
  }
  return raw.slice(0, 80);
}

function formatLedgerEntryLines(row, index, symbol, copy, lang) {
  const typeLabel = ledgerTypeLabel(row, copy);
  const move = row.credit
    ? `+${formatLedgerMoney(row.credit)}`
    : row.debit
      ? `-${formatLedgerMoney(row.debit)}`
      : formatLedgerMoney(0);
  const run = `${formatLedgerMoney(Math.abs(Number(row.runningBalance || 0)))} ${ledgerSideLabel(row.runningSide, copy)}`;
  const date = formatLedgerDate(row.createdAt || new Date(), lang);
  const docRaw = String(row.number || '').trim();
  const docNo = docRaw && docRaw !== '—' ? formatLedgerDigits(docRaw) : '';
  const note = extraLedgerNote(row.note, row.typeKey || row.type, typeLabel);
  const lines = [line(`*${entryMark(index)}  ${date}*`, lang)];
  lines.push(line(`• ${copy.type}: ${typeLabel}`, lang));
  if (docNo) lines.push(line(`• ${copy.doc}: ${docNo}`, lang));
  lines.push(line(`• ${copy.amount}: *${move} ${symbol}*`, lang));
  lines.push(line(`• ${copy.balance}: *${run}*`, lang));
  if (note) lines.push(line(`• ${copy.note}: ${note}`, lang));
  return lines;
}

function formatCurrencySection(group, copy, lang, keepLast = null) {
  const code = group.currency?.code || '—';
  const symbol = group.currency?.symbol || code;
  const entries = Array.isArray(group.entries) ? group.entries : [];
  const keep = keepLast == null ? entries : entries.slice(-keepLast);
  const omitted = Math.max(0, entries.length - keep.length);
  const heading = copy.activity.replace('{code}', code);
  const lines = ['', LEDGER_DIVIDER, line(`*${heading}*`, lang), ''];
  if (omitted > 0) {
    lines.push(line(copy.omitted.replace('{n}', formatLedgerDigits(omitted, lang)), lang));
  }
  if (!keep.length) {
    lines.push(line(copy.noActivity, lang));
    return lines;
  }
  keep.forEach((row, i) => {
    if (i > 0) lines.push('');
    lines.push(...formatLedgerEntryLines(row, omitted + i + 1, symbol, copy, lang));
  });
  return lines;
}

/** Build full customer ledger WhatsApp text (truncated if too long for wa.me). */
export function buildLedgerStatementWhatsappBody(statement, settings = {}, lang) {
  const locale = resolveLedgerLang(lang || settings.language || settings.lang);
  const copy = ledgerCopy(locale);
  const companyLine = companyTitle(settings, copy, locale);
  const customer = statement?.customer || {};
  const customerName = String(customer.name || '—').trim() || '—';
  const groups = Array.isArray(statement?.currencyGroups) ? statement.currencyGroups : [];
  const maxChars = 3500;
  const customerId = customer.id ? formatLedgerDigits(customer.id, locale) : '';

  const header = [
    line(`*${companyLine}*`, locale),
    line(`_${copy.title}_`, locale),
    '',
    line(`• ${copy.customer}: *${customerName}*`, locale),
  ];
  if (customerId) header.push(line(`• ${copy.code}: *${customerId}*`, locale));
  header.push(line(`• ${copy.date}: *${formatLedgerDate(new Date(), locale)}*`, locale));
  header.push('');
  header.push(LEDGER_DIVIDER);
  header.push(line(`*${copy.currentBalance}*`, locale));

  if (!groups.length) {
    header.push(line(`• ${copy.noBalance}`, locale));
  } else {
    for (const group of groups) {
      const code = group.currency?.code || '—';
      const bal = Number(group.currentBalance || 0);
      header.push(line(
        `• *${code}*   ${formatLedgerMoney(Math.abs(bal), locale)}   ${ledgerSideLabel(group.currentSide, copy)}`,
        locale,
      ));
    }
  }

  const footer = ['', line(`_${copy.respect}_`, locale)];
  const joinBody = (sections) => `${header.join('\n')}\n${sections.join('\n')}\n${footer.join('\n')}`.trim();
  let body = joinBody(groups.map((group) => formatCurrencySection(group, copy, locale).join('\n')));
  if (body.length <= maxChars) return body;

  body = `${joinBody(groups.map((group) => formatCurrencySection(group, copy, locale, 18).join('\n')))}\n\n${line(copy.truncated, locale)}`.trim();
  if (body.length > maxChars) {
    body = `${body.slice(0, maxChars - 20)}\n…`;
  }
  return body;
}

export async function notifyLedgerStatement(statement, lang) {
  const settings = await loadSettings();
  const customer = statement?.customer;
  const phone = customerNotifyPhone(customer);
  if (!phone) return null;

  const body = buildLedgerStatementWhatsappBody(statement, settings, lang);
  return enqueueWhatsappMessage({
    customerId: customer?.id || null,
    customerName: customer?.name || null,
    phone,
    eventType: 'ledger_statement',
    referenceType: 'customer_ledger',
    referenceId: customer?.id || null,
    documentNumber: customer?.id ? `LDG-${customer.id}` : 'LDG',
    body,
  });
}

export async function queueNotifyLedgerStatement(statement, lang) {
  try {
    return await notifyLedgerStatement(statement, lang);
  } catch (err) {
    console.error('[whatsapp] ledger statement enqueue failed:', err?.message || err);
    return null;
  }
}

export async function queueNotifyBalanceConvert(result) {
  try {
    return await notifyBalanceConvert(result);
  } catch (err) {
    console.error('[whatsapp] enqueue failed:', err?.message || err);
    return null;
  }
}
export async function queueNotifyRemittance(row, eventType) {
  try {
    return await notifyRemittance(row, eventType);
  } catch (err) {
    console.error('[whatsapp] enqueue failed:', err?.message || err);
    return null;
  }
}

async function sendViaMetaCloudApi(message, settings) {
  const phoneNumberId = String(settings.whatsapp_phone_number_id || '').trim();
  const token = String(settings.whatsapp_access_token || '')
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .replace(/[\r\n\t]+/g, '')
    .trim();
  const version = String(settings.whatsapp_api_version || 'v21.0').trim();
  if (!phoneNumberId || !token) {
    throw new Error('WhatsApp API credentials are not configured.');
  }

  const url = `https://graph.facebook.com/${version}/${phoneNumberId}/messages`;
  const templateName = String(settings.whatsapp_template_name || '').trim();
  const templateLang = String(settings.whatsapp_template_lang || 'fa').trim();

  let payload;
  if (templateName) {
    payload = {
      messaging_product: 'whatsapp',
      to: message.phone,
      type: 'template',
      template: {
        name: templateName,
        language: { code: templateLang },
        components: [
          {
            type: 'body',
            parameters: [{ type: 'text', text: message.body.slice(0, 1024) }],
          },
        ],
      },
    };
  } else {
    payload = {
      messaging_product: 'whatsapp',
      to: message.phone,
      type: 'text',
      text: { preview_url: false, body: message.body },
    };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    let errText = json?.error?.message || JSON.stringify(json) || `HTTP ${res.status}`;
    if (/cannot parse access token/i.test(errText)) {
      errText = 'Access Token خراب است. حالت ارسال را روی «ساده» بگذارید یا توکن Meta را درست کنید.';
    }
    throw new Error(errText);
  }
  return json?.messages?.[0]?.id || null;
}

export async function applyWhatsappStatusUpdate({ providerMessageId, status, timestamp } = {}) {
  if (!providerMessageId || !status) return null;
  const row = await WhatsappMessage.findOne({ where: { providerMessageId } });
  if (!row) return null;

  const key = String(status).toLowerCase();
  const at = timestamp ? new Date(Number(timestamp) * 1000) : new Date();
  if (key === 'sent') {
    row.status = STATUS.sent;
    row.sentAt = row.sentAt || at;
  } else if (key === 'delivered') {
    row.status = STATUS.delivered;
    row.deliveredAt = at;
  } else if (key === 'read') {
    row.status = STATUS.read;
    row.readAt = at;
  } else if (key === 'failed') {
    row.status = STATUS.failed;
    row.failedAt = at;
  } else {
    return row;
  }
  await row.save();
  return row;
}

export async function processWhatsappQueue({ limit = 20 } = {}) {
  const settings = await loadSettings();
  if (!isOn(settings.whatsapp_enabled)) {
    return { processed: 0, skipped: true, reason: 'whatsapp_disabled' };
  }
  if (sendMode(settings) === 'simple') {
    return { processed: 0, skipped: true, reason: 'simple_mode' };
  }
  const tokenOk = String(settings.whatsapp_access_token || '').trim();
  const phoneIdOk = String(settings.whatsapp_phone_number_id || '').trim();
  if (!phoneIdOk || !tokenOk) {
    await WhatsappMessage.update(
      { errorMessage: 'برای حالت Meta باید Phone Number ID و Access Token پر باشد. یا حالت ارسال را «ساده» کنید.' },
      { where: { status: STATUS.pending } },
    );
    return { processed: 0, skipped: true, reason: 'missing_credentials' };
  }

  const now = new Date();
  const rows = await WhatsappMessage.findAll({
    where: {
      status: STATUS.pending,
      [Op.or]: [
        { nextAttemptAt: null },
        { nextAttemptAt: { [Op.lte]: now } },
      ],
    },
    order: [['id', 'ASC']],
    limit,
  });

  let processed = 0;
  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    processed += 1;
    row.attempts = Number(row.attempts || 0) + 1;
    try {
      const providerId = await sendViaMetaCloudApi(row, settings);
      row.status = STATUS.sent;
      row.providerMessageId = providerId;
      row.sentAt = new Date();
      row.errorMessage = null;
      row.nextAttemptAt = null;
      await row.save();
      sent += 1;
    } catch (err) {
      const msg = err?.message || String(err);
      row.errorMessage = msg.slice(0, 2000);
      if (row.attempts >= MAX_ATTEMPTS) {
        row.status = STATUS.failed;
        row.failedAt = new Date();
        row.nextAttemptAt = null;
        failed += 1;
      } else {
        const delayMin = RETRY_MINUTES[Math.min(row.attempts - 1, RETRY_MINUTES.length - 1)];
        row.nextAttemptAt = new Date(Date.now() + delayMin * 60_000);
        row.status = STATUS.pending;
      }
      await row.save();
      console.error(`[whatsapp] send failed #${row.id}:`, msg);
    }
  }
  return { processed, sent, failed };
}

export async function retryPendingWhatsappMessages() {
  const settings = await loadSettings();
  if (sendMode(settings) === 'simple') {
    return { processed: 0, skipped: true, reason: 'simple_mode' };
  }
  await WhatsappMessage.update(
    {
      nextAttemptAt: new Date(),
      errorMessage: null,
      attempts: 0,
      status: STATUS.pending,
    },
    { where: { status: { [Op.in]: [STATUS.pending, STATUS.failed] } } },
  );
  return processWhatsappQueue({ limit: 50 });
}

export function startWhatsappWorker({ intervalMs = 15000 } = {}) {
  const tick = () => {
    processWhatsappQueue().catch((err) => {
      console.error('[whatsapp] worker error:', err?.message || err);
    });
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}

export const WHATSAPP_STATUS = STATUS;
