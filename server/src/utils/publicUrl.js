import { SystemSetting } from '../models/index.js';
import { env } from '../config/env.js';

function normalizeBaseUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return `${url.protocol}//${url.host}`;
  } catch {
    return '';
  }
}

function isLocalHostUrl(base) {
  try {
    const host = new URL(base).hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local');
  } catch {
    return true;
  }
}

/** Prefer configured online public URL over localhost for customer share links. */
export async function resolvePublicAppUrl() {
  const setting = await SystemSetting.findOne({ where: { settingKey: 'public_app_url' } });
  const fromSetting = normalizeBaseUrl(setting?.settingValue);
  if (fromSetting) return fromSetting;

  const fromEnv = normalizeBaseUrl(process.env.PUBLIC_APP_URL || '');
  if (fromEnv) return fromEnv;

  const clients = String(env.clientUrl || '')
    .split(',')
    .map((v) => normalizeBaseUrl(v))
    .filter(Boolean);

  const online = clients.find((u) => !isLocalHostUrl(u));
  if (online) return online;

  return clients[0] || '';
}

export async function buildCustomerViewUrl(viewPath) {
  const path = String(viewPath || '').startsWith('/') ? String(viewPath) : `/${viewPath || ''}`;
  const base = await resolvePublicAppUrl();
  if (!base) return path;
  return `${base}${path}`;
}
