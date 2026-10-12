import i18n from '../i18n.js';

/** Business timezone for exchange operations (Afghanistan). */
export const BUSINESS_TIMEZONE = 'Asia/Kabul';

function currentLang() {
  return (i18n.language || 'fa').split('-')[0];
}

/** Always Latin / English digits in all languages. */
function numberLocale() {
  return 'en-US';
}

/**
 * Calendar by UI language:
 * - Dari / Pashto → Shamsi (Persian)
 * - English → Gregorian (Miladi)
 */
function dateLocaleTag() {
  const lang = currentLang();
  if (lang === 'en') return 'en-US-u-nu-latn';
  return 'fa-AF-u-ca-persian-nu-latn';
}

export function usesShamsiCalendar() {
  return currentLang() !== 'en';
}

/**
 * Format amounts for display.
 * Default: whole numbers (no decimals).
 * Pass `digits` for rates (e.g. money(rate, 4)) — trailing zeros are still stripped.
 */
export const money = (value, digits) => {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return '0';

  const maxDigits = digits == null ? 0 : Math.max(0, Number(digits) || 0);
  const formatted = new Intl.NumberFormat(numberLocale(), {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDigits,
  }).format(n);

  if (maxDigits === 0) return formatted;
  // Drop trailing zeros: 1,250.5000 → 1,250.5 ; 1,250.00 → 1,250
  return formatted.replace(/(\.\d*?[1-9])0+$/u, '$1').replace(/\.0+$/u, '');
};

export const number = (value) =>
  new Intl.NumberFormat(numberLocale(), { maximumFractionDigits: 0 }).format(Number(value || 0));

/** Map Persian/Arabic digits to English so amount fields accept Dari/Pashto keyboards. */
export function normalizeAmountInput(raw) {
  const latin = String(raw ?? '')
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/٫/g, '.');
  const cleaned = latin.replace(/[^\d.]/g, '');
  const dot = cleaned.indexOf('.');
  if (dot === -1) return cleaned;
  return `${cleaned.slice(0, dot)}.${cleaned.slice(dot + 1).replace(/\./g, '')}`;
}

function toDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export const dateTime = (value) => {
  const date = toDate(value);
  if (!date) return '—';
  return new Intl.DateTimeFormat(dateLocaleTag(), {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

export const dateOnly = (value) => {
  const date = toDate(value);
  if (!date) return '—';
  return new Intl.DateTimeFormat(dateLocaleTag(), {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
};

/** Today's date in business timezone — Shamsi for fa/ps, Gregorian for en. */
export const todayLong = (when = new Date()) =>
  new Intl.DateTimeFormat(dateLocaleTag(), {
    timeZone: BUSINESS_TIMEZONE,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(when);

/** @deprecated use todayLong */
export const jalaliTodayLong = todayLong;

/** Calendar day key in Asia/Kabul (Gregorian ISO) — used to detect midnight rollover. */
export function businessDayKey(when = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(when);
}

export function downloadCsv(filename, rows) {
  if (!rows?.length) return;
  const headers = Object.keys(rows[0]);
  const esc = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`;
  const csv = '\uFEFF' + [
    headers.map(esc).join(','),
    ...rows.map((r) => headers.map((h) => esc(r[h])).join(',')),
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
