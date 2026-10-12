/** Resolve uploaded media path against API origin when needed. */
export function mediaUrl(pathValue) {
  if (!pathValue) return null;
  const value = String(pathValue).trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value) || value.startsWith('data:') || value.startsWith('blob:')) {
    return value;
  }

  const normalized = value.startsWith('/') ? value : `/${value}`;
  const apiBase = import.meta.env.VITE_API_URL || '';

  // In Vite dev, `/uploads` is proxied. In production with separate API host, prefix origin.
  if (apiBase) {
    try {
      const origin = String(apiBase).replace(/\/api\/?$/i, '');
      const apiHost = new URL(origin, window.location.origin).host;
      if (apiHost !== window.location.host) {
        return `${origin}${normalized}`;
      }
    } catch {
      /* fall through to same-origin path */
    }
  }

  return normalized;
}
