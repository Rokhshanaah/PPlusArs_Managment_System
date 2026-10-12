import { dateTime } from './format.js';
import {
  currentLang,
  hasArabicScript,
  localizeCountry as localizeCountryBase,
  localizeCurrency as localizeCurrencyBase,
  localizePersonName as localizePersonNameBase,
  transliterateFa,
} from './localeDisplay.js';

export { currentLang, hasArabicScript, transliterateFa } from './localeDisplay.js';

/** Normalize Persian/Arabic letter variants so DB strings match. */
export function normalizeFa(value) {
  return String(value || '')
    .trim()
    .replace(/\u064A/g, '\u06CC') // ي -> ی
    .replace(/\u0643/g, '\u06A9') // ك -> ک
    .replace(/\u200C/g, '')
    .replace(/\s+/g, ' ');
}

const VALUE_KEYS = {
  // money kinds
  'خرید پول': 'buy',
  'فروش پول': 'sell',
  'تبدیل پول': 'exchange',
  buy: 'buy',
  sell: 'sell',
  exchange: 'exchange',

  // transaction / remittance states
  'تکمیل شده': 'completed',
  'برگشت داده شد': 'reversed',
  'پرداخت شده': 'paidStatus',
  'ثبت شده': 'registeredStatus',
  'در انتظار پرداخت': 'pendingPayment',
  'لغو شده': 'cancelled',

  // whatsapp queue statuses
  'در انتظار ارسال': 'waPending',
  'ارسال‌شده': 'waSent',
  'تحویل‌شده': 'waDelivered',
  'خوانده‌شده': 'waRead',
  ناموفق: 'waFailed',

  // customer states
  'تأیید شده': 'approved',
  'تائید شده': 'approved',
  'در انتظار بررسی': 'pending',
  'رد شده': 'rejected',
  غیرفعال: 'inactive',
  فعال: 'active',

  // trust levels
  عادی: 'normal',
  خوب: 'good',
  ویژه: 'vip',
  پرخطر: 'highRisk',

  // roles
  'مدیر کل': 'roleAdmin',
  'مدیر شعبه': 'roleBranchManager',
  'صندوق‌دار': 'roleCashier',
  حسابدار: 'roleAccountant',
  'مسئول بررسی': 'roleReviewer',

  // document types
  تذکره: 'docIdCard',
  پاسپورت: 'docPassport',
  'جواز رانندگی': 'docDriverLicense',
  'سند دیگر': 'docOther',

  // places / defaults
  'شعبه مرکزی': 'centralBranch',
  مرکزی: 'centralCashbox',
  'صندوق مرکزی': 'centralCashbox',
  'صندوق اول': 'cashboxOne',
  'صندوق کابل': 'kabulCashbox',
  افغانستان: 'afghanistan',
  کابل: 'kabul',
  هرات: 'herat',
  جبریل: 'jebrail',

  // ledger types (english + legacy dari)
  opening: 'opening',
  received: 'received',
  paid: 'paid',
  convert_out: 'convertOut',
  convert_in: 'convertIn',
  transfer_out: 'transferOut',
  transfer_in: 'transferIn',
  'رسید شده': 'received',
  'برد شده': 'paid',
  'موجودی اول دوره': 'opening',
  'اول دوره': 'opening',
  'خروج تبدیل': 'convertOut',
  'ورود تبدیل': 'convertIn',

  // common person names (display only)
  نواب: 'nameNawab',
  احمد: 'nameAhmad',
  کامران: 'nameKamran',
  حامد: 'nameHamed',
  بیاتی: 'nameBayati',
  طاهر: 'nameTaher',
  مدیر: 'roleCashier',

  // currencies (name → i18n key; English prefers ISO via localizeCurrency)
  افغانی: 'currencyAFN',
  'دالر امریکا': 'currencyUSD',
  'دالر آمریکا': 'currencyUSD',
  تومن: 'currencyTMN',
  تومان: 'currencyTMN',
  'کلدار پاکستان': 'currencyPKR',
  یورو: 'currencyEUR',
  'پوند برتانیا': 'currencyGBP',
  'ریال ایران': 'currencyIRR',
};

const defaultReceiptNotes = new Set([
  'رسید بدون مهر و امضا اعتبار ندارد.',
  'رسید بدون مهر و امضا اعتبار ندارد',
]);

const defaultSlogans = new Set([
  'بخش مدیریتی صرافی چند پولی',
  'د څو اسعارو صرافۍ مدیریتي برخه',
  'Multi-currency exchange management',
]);

const defaultAddresses = new Set(['افغانستان', 'Afghanistan']);

function lookupKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (VALUE_KEYS[raw]) return VALUE_KEYS[raw];
  const normalized = normalizeFa(raw);
  if (VALUE_KEYS[normalized]) return VALUE_KEYS[normalized];
  return null;
}

/** Translate any known DB enum / seed label. Unknown values stay as-is (e.g. person names). */
export function localizeValue(t, value) {
  if (value == null || value === '') return '—';
  const key = lookupKey(value);
  if (key) return t(key);
  const raw = String(value);
  if (currentLang() === 'en' && hasArabicScript(raw)) return transliterateFa(raw) || raw;
  return raw;
}

export function localizeCurrency(t, currency) {
  return localizeCurrencyBase(t, currency);
}

export function localizeCountry(t, country) {
  return localizeCountryBase(t, country);
}

export function translateKind(t, kind) {
  return localizeValue(t, kind);
}

export function translateState(t, state) {
  return localizeValue(t, state);
}

export function translateRole(t, role) {
  return localizeValue(t, role);
}

export function translatePlace(t, name) {
  return localizeValue(t, name);
}

export function translateTrustLevel(t, level) {
  return localizeValue(t, level);
}

export function translateDocumentType(t, type) {
  return localizeValue(t, type);
}

/** Display name: if seed admin name equals a role label, show translated role/title. */
export function translatePersonName(t, name) {
  return localizePersonNameBase(t, name, localizeValue);
}

export function localizeCompanyField(t, key, value) {
  const text = String(value || '').trim();
  if (key === 'company_slogan' && (!text || defaultSlogans.has(text))) return t('systemSlogan');
  if (
    key === 'company_name'
    && (
      !text
      || text === 'PPlus.Arz'
      || text === 'زرین‌حساب'
      || text === 'زرین حساب'
      || text === 'Zarin Hesab'
      || text === 'صرافی زرین حساب'
    )
  ) return t('systemName');
  if (key === 'receipt_note' && (!text || defaultReceiptNotes.has(text))) return t('defaultReceiptNote');
  if (key === 'company_address' && (!text || defaultAddresses.has(text))) return t('afghanistan');
  if (key === 'company_address') return localizeValue(t, text);
  return text || '—';
}

export function localizeNote(t, note) {
  if (!note) return '';
  let text = String(note);

  text = text.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, (match) => dateTime(match));
  text = text.replace(/\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?Z?/g, (match) => dateTime(match));

  text = text.replace(
    /تبدیل حساب مشتری از\s+(\S+)\s+به\s+(\S+)/g,
    (_, from, to) => `${t('customerAccountConvertFrom')} ${from} ${t('to')} ${to}`,
  );
  text = text.replace(/معامله در\s*/g, `${t('transactionAt')} `);
  text = text.replace(/برگشت داده شد\.?/g, t('reversed'));
  text = text.replace(/ثبت\s+خرید پول/g, t('buy'));
  text = text.replace(/ثبت\s+فروش پول/g, t('sell'));
  text = text.replace(/ثبت\s+تبدیل پول/g, t('exchange'));
  text = text.replace(/خرید پول/g, t('buy'));
  text = text.replace(/فروش پول/g, t('sell'));
  text = text.replace(/تبدیل پول/g, t('exchange'));
  text = text.replace(/\|\s*نرخ:/g, `| ${t('rate')}:`);
  text = text.replace(/\|\s*فیس:/g, `| ${t('fee')}:`);
  text = text.replace(/\|\s*کمیشن:/g, `| ${t('fee')}:`);
  text = text.replace(/شماره\s+/g, `${t('number')} `);
  text = text.replace(/دریافت حواله/g, t('remittanceReceived'));
  text = text.replace(/پرداخت حواله/g, t('remittancePaid'));
  text = text.replace(/:\s*دریافت\s+/g, `: ${t('noteReceived')} `);
  text = text.replace(/\s+و پرداخت\s+/g, ` ${t('noteAndPaid')} `);
  text = text.replace(/\bدریافت\b/g, t('noteReceived'));
  text = text.replace(/\bپرداخت\b/g, t('notePaid'));
  text = text.replace(/موجودی اول دوره\s*\(طلبکار\)/g, `${t('opening')} (${t('creditor')})`);
  text = text.replace(/موجودی اول دوره\s*\(قرضدار\)/g, `${t('opening')} (${t('debtor')})`);
  text = text.replace(/موجودی اول دوره/g, t('opening'));
  text = text.replace(/طلبکار/g, t('creditor'));
  text = text.replace(/قرضدار/g, t('debtor'));
  text = text.replace(/برگشت صندوق پرداختی/g, t('reversePayCashbox'));
  text = text.replace(/برگشت صندوق دریافتی/g, t('reverseReceiveCashbox'));
  text = text.replace(/برگشت معامله/g, t('reverse'));
  text = text.replace(/حواله‌های پرداختنی/g, t('payableRemittances'));
  text = text.replace(/درآمد کمیشن حواله/g, t('remittanceFeeIncome'));
  text = text.replace(/حساب اصلاح موجودی/g, t('balanceAdjustmentAccount'));
  text = text.replace(/صندوق برگشت حواله/g, t('remittanceReverseCashbox'));
  text = text.replace(/صندوق پرداخت/g, t('payCashboxAccount'));
  text = text.replace(/صندوق\s+/g, `${t('cashbox')} `);
  text = text.replace(/روشن/g, t('on'));
  text = text.replace(/خاموش/g, t('off'));

  if (currentLang() === 'en' && hasArabicScript(text)) {
    // Last resort: transliterate any leftover Dari fragments (keep digits/codes).
    text = text.replace(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\u200C]+/g, (chunk) => transliterateFa(chunk) || chunk);
  }

  return text;
}

function localizeEmbeddedName(t, name) {
  return translatePersonName(t, name);
}

/** Translate stored audit-log action strings (Dari templates from the API). */
export function localizeAuditAction(t, action) {
  if (!action) return '—';
  let text = String(action).trim();

  const exact = {
    'وارد سامانه شد': 'auditLoggedIn',
    'از سامانه بیرون شد': 'auditLoggedOut',
    'تلاش ناکام برای ورود': 'auditLoginFailed',
    'تنظیمات سامانه اصلاح شد': 'auditSettingsUpdated',
    'ریست کامل اطلاعات سامانه انجام شد': 'auditSystemReset',
  };
  if (exact[text]) return t(exact[text]);
  if (text.startsWith('ریست انتخابی سامانه انجام شد')) return t('auditSystemReset');

  const patterns = [
    [/^مشتری نو ثبت شد:\s*(.+)$/, 'auditCustomerCreated'],
    [/^معلومات مشتری اصلاح شد:\s*(.+)$/, 'auditCustomerUpdated'],
    [/^مشتری حذف شد:\s*(.+)$/, 'auditCustomerDeleted'],
    [/^شعبه ثبت شد:\s*(.+)$/, 'auditBranchCreated'],
    [/^شعبه اصلاح شد:\s*(.+)$/, 'auditBranchUpdated'],
    [/^صندوق ثبت شد:\s*(.+)$/, 'auditCashboxCreated'],
    [/^صندوق اصلاح شد:\s*(.+)$/, 'auditCashboxUpdated'],
    [/^ارز ثبت شد:\s*(.+)$/, 'auditCurrencyCreated'],
    [/^کارمند نو ساخته شد:\s*(.+)$/, 'auditStaffCreated'],
    [/^کارمند اصلاح شد:\s*(.+)$/, 'auditStaffUpdated'],
  ];

  for (const [re, key] of patterns) {
    const m = text.match(re);
    if (m) return `${t(key)}: ${localizeEmbeddedName(t, m[1])}`;
  }

  let m = text.match(/^معامله\s+(\S+)\s+ثبت شد$/);
  if (m) return t('auditTxCreated', { number: m[1] });

  m = text.match(/^معامله\s+(\S+)\s+برگشت داده شد$/);
  if (m) return t('auditTxReversed', { number: m[1] });

  m = text.match(/^حواله\s+(\S+)\s+ثبت شد$/);
  if (m) return t('auditRemittanceCreated', { number: m[1] });

  m = text.match(/^حواله\s+(\S+)\s+پرداخت شد$/);
  if (m) return t('auditRemittancePaid', { number: m[1] });

  m = text.match(/^حواله\s+(\S+)\s+اصلاح شد$/);
  if (m) return t('auditRemittanceUpdated', { number: m[1] });

  m = text.match(/^حواله\s+(\S+)\s+لغو شد$/);
  if (m) return t('auditRemittanceCancelled', { number: m[1] });

  m = text.match(/^نرخ\s+(\S+)\s+ثبت شد$/);
  if (m) return t('auditRateCreated', { pair: m[1] });

  m = text.match(/^حساب مشتری\s+(.+?):\s*(.+)$/);
  if (m) return t('auditCustomerAccount', { name: localizeEmbeddedName(t, m[1]), detail: localizeNote(t, m[2]) });

  m = text.match(/^تبدیل موجودی مشتری\s+(.+?):\s*(.+)$/);
  if (m) return t('auditBalanceConvert', { name: localizeEmbeddedName(t, m[1]), detail: m[2] });

  m = text.match(/^موجودی\s+(.+?)\s+(\S+)\s+از\s+(.+?)\s+به\s+(.+?)\s+تغییر کرد$/);
  if (m) {
    return t('auditCashboxBalanceChanged', {
      cashbox: localizeValue(t, m[1]),
      code: m[2],
      from: m[3],
      to: m[4],
    });
  }

  return localizeNote(t, text);
}

export const ROLE_OPTIONS = [
  ['مدیر کل', 'roleAdmin'],
  ['مدیر شعبه', 'roleBranchManager'],
  ['صندوق‌دار', 'roleCashier'],
  ['حسابدار', 'roleAccountant'],
  ['مسئول بررسی', 'roleReviewer'],
];

export const TRUST_OPTIONS = [
  ['عادی', 'normal'],
  ['خوب', 'good'],
  ['ویژه', 'vip'],
  ['پرخطر', 'highRisk'],
];

export const CUSTOMER_STATE_OPTIONS = [
  ['تأیید شده', 'approved'],
  ['در انتظار بررسی', 'pending'],
  ['رد شده', 'rejected'],
  ['غیرفعال', 'inactive'],
];

export const DOCUMENT_TYPE_OPTIONS = [
  ['تذکره', 'docIdCard'],
  ['پاسپورت', 'docPassport'],
  ['جواز رانندگی', 'docDriverLicense'],
  ['سند دیگر', 'docOther'],
];

export function isSuperAdmin(role) {
  return normalizeFa(role) === 'مدیر کل';
}
