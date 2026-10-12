import { SystemSetting } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { buildSystemSqlBackup } from './systemMaintenance.js';

const TOKEN_KEY = 'telegram_bot_token';
const CHAT_KEY = 'telegram_chat_id';
const ENABLED_KEY = 'telegram_backup_enabled';
const LAST_DATE_KEY = 'telegram_backup_last_date';
const MAX_BYTES = 48 * 1024 * 1024;

function isOn(value) {
  return String(value || '').trim() === 'روشن';
}

function normalizeToken(value) {
  return String(value || '').replace(/^["'\s]+|["'\s]+$/g, '').replace(/\s+/g, '').trim();
}

function normalizeChatId(value) {
  return String(value || '')
    .replace(/[۰-۹]/g, (ch) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(ch)))
    .replace(/[٠-٩]/g, (ch) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(ch)))
    .trim();
}

function todayKabul() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kabul' });
}

async function loadMap() {
  const rows = await SystemSetting.findAll({
    where: { settingKey: [TOKEN_KEY, CHAT_KEY, ENABLED_KEY, LAST_DATE_KEY, 'company_name', 'daily_backup'] },
  });
  return Object.fromEntries(rows.map((row) => [row.settingKey, row.settingValue]));
}

export async function readTelegramBackupSettings() {
  const data = await loadMap();
  return {
    token: normalizeToken(data[TOKEN_KEY]),
    chatId: normalizeChatId(data[CHAT_KEY]),
    enabled: isOn(data[ENABLED_KEY]),
    dailyBackup: isOn(data.daily_backup),
    lastDate: String(data[LAST_DATE_KEY] || '').trim(),
    companyName: String(data.company_name || 'PPlus.Arz').trim() || 'PPlus.Arz',
  };
}

function apiUrl(token, method) {
  return `https://api.telegram.org/bot${token}/${method}`;
}

async function telegramJson(token, method, body) {
  let response;
  try {
    response = await fetch(apiUrl(token, method), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AppError('وصل شدن به تلگرام ممکن نشد. اینترنت را بررسی کنید.', 502, 'TELEGRAM_UNREACHABLE');
  }
  const data = await response.json().catch(() => ({}));
  if (!data?.ok) {
    throw new AppError(data?.description || 'تلگرام درخواست را رد کرد.', 400, 'TELEGRAM_ERROR');
  }
  return data.result;
}

export async function resolveTelegramChat(tokenRaw) {
  const settings = await readTelegramBackupSettings();
  const token = normalizeToken(tokenRaw) || settings.token;
  if (!token) throw new AppError('اول توکن ربات تلگرام را وارد کنید.', 400, 'TELEGRAM_TOKEN_MISSING');
  const result = await telegramJson(token, 'getUpdates', { limit: 50, timeout: 0 });
  const updates = Array.isArray(result) ? result : [];
  for (let i = updates.length - 1; i >= 0; i -= 1) {
    const item = updates[i];
    const chat = item?.message?.chat || item?.channel_post?.chat || item?.my_chat_member?.chat;
    if (chat?.id == null) continue;
    const title = chat.title
      || chat.username
      || [chat.first_name, chat.last_name].filter(Boolean).join(' ')
      || String(chat.id);
    return { chatId: String(chat.id), title };
  }
  throw new AppError('چتی پیدا نشد. اول به ربات یک پیام بزنید، بعد دوباره امتحان کنید.', 404, 'TELEGRAM_CHAT_MISSING');
}

export async function sendTelegramBackup({ token: tokenRaw, chatId: chatIdRaw } = {}) {
  const settings = await readTelegramBackupSettings();
  const token = normalizeToken(tokenRaw) || settings.token;
  const chatId = normalizeChatId(chatIdRaw) || settings.chatId;
  if (!token) throw new AppError('توکن ربات تلگرام ثبت نشده است.', 400, 'TELEGRAM_TOKEN_MISSING');
  if (!chatId) throw new AppError('آیدی چت تلگرام ثبت نشده است.', 400, 'TELEGRAM_CHAT_MISSING');

  const sql = await buildSystemSqlBackup();
  const bytes = Buffer.byteLength(sql, 'utf8');
  if (bytes > MAX_BYTES) {
    throw new AppError('حجم بک‌آپ برای تلگرام زیاد است.', 413, 'TELEGRAM_FILE_TOO_LARGE');
  }

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const filename = `pplus-arz-backup-${stamp}.sql`;
  const form = new FormData();
  form.append('chat_id', chatId);
  form.append('caption', `${settings.companyName}\nبک‌آپ SQL\n${stamp}`);
  form.append('document', new Blob([sql], { type: 'application/sql' }), filename);

  let response;
  try {
    response = await fetch(apiUrl(token, 'sendDocument'), { method: 'POST', body: form });
  } catch {
    throw new AppError('وصل شدن به تلگرام ممکن نشد. اینترنت را بررسی کنید.', 502, 'TELEGRAM_UNREACHABLE');
  }
  const data = await response.json().catch(() => ({}));
  if (!data?.ok) {
    throw new AppError(data?.description || 'ارسال فایل به تلگرام ناکام شد.', 400, 'TELEGRAM_ERROR');
  }
  await SystemSetting.upsert({ settingKey: LAST_DATE_KEY, settingValue: todayKabul() });
  return { filename, bytes };
}

export async function maybeSendDailyTelegramBackup() {
  const settings = await readTelegramBackupSettings();
  if (!settings.enabled) return { skipped: true, reason: 'disabled' };
  if (!settings.token || !settings.chatId) return { skipped: true, reason: 'missing-config' };
  const today = todayKabul();
  if (settings.lastDate === today) return { skipped: true, reason: 'already-sent' };
  return sendTelegramBackup();
}

export function startTelegramBackupWorker({ intervalMs = 30 * 60 * 1000 } = {}) {
  const tick = () => {
    maybeSendDailyTelegramBackup().catch((error) => {
      console.error('[telegram-backup]', error?.message || error);
    });
  };
  tick();
  return setInterval(tick, intervalMs);
}
