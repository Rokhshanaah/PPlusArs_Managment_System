/** Normalize a share path like `/c/abc`. */
export function normalizeViewPath(viewPath) {
  const path = String(viewPath || '').trim();
  if (!path) return '';
  return path.startsWith('/') ? path : `/${path}`;
}

function stripTrailingSlash(url) {
  return String(url || '').replace(/\/$/, '');
}

export function isLocalShareUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

/** Always-local link (current browser origin). */
export function buildLocalPortalUrl(viewPath) {
  const path = normalizeViewPath(viewPath);
  if (!path) return '';
  return `${stripTrailingSlash(window.location.origin)}${path}`;
}

/** Online/public link from server viewUrl, settings, or env. */
export function buildOnlinePortalUrl(viewPath, absoluteFromServer = '') {
  const path = normalizeViewPath(viewPath);
  if (absoluteFromServer && /^https?:\/\//i.test(absoluteFromServer)) {
    const absolute = stripTrailingSlash(absoluteFromServer);
    if (!isLocalShareUrl(absolute)) return absolute;
  }

  const envBase = stripTrailingSlash(String(import.meta.env.VITE_PUBLIC_APP_URL || '').trim());
  if (envBase && path) return `${envBase}${path}`;

  return '';
}

/** Both links for the share modal. */
export function buildPortalLinkPair(viewPath, absoluteFromServer = '') {
  const path = normalizeViewPath(viewPath);
  const local = buildLocalPortalUrl(path);
  let online = buildOnlinePortalUrl(path, absoluteFromServer);
  if (online && online === local) online = '';
  return { path, local, online };
}

/** @deprecated prefer buildOnlinePortalUrl / buildLocalPortalUrl */
export function buildPortalUrl(viewPath, absoluteFromServer = '') {
  return buildOnlinePortalUrl(viewPath, absoluteFromServer)
    || buildLocalPortalUrl(viewPath);
}
