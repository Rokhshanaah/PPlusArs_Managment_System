
function normalizeBridgeIdentity(identity) {
  if (!identity) return null;
  return {
    customerId: identity.customerId ?? identity.CustomerId ?? null,
    customerName: identity.customerName ?? identity.CustomerName ?? '',
    phone: identity.phone ?? identity.Phone ?? '',
    documentNumber: identity.documentNumber ?? identity.DocumentNumber ?? '',
    cardNumber: identity.cardNumber ?? identity.CardNumber ?? '',
    bankName: identity.bankName ?? identity.BankName ?? '',
    cardHolderName: identity.cardHolderName ?? identity.CardHolderName ?? '',
    photoUrl: identity.photoUrl ?? identity.PhotoUrl ?? null,
    fingerprintUrl: identity.fingerprintUrl ?? identity.FingerprintUrl ?? null,
    balances: identity.balances ?? identity.Balances ?? [],
    fingerprintTemplate: identity.fingerprintTemplate ?? identity.FingerprintTemplate ?? '',
    fingerprintFormat: identity.fingerprintFormat ?? identity.FingerprintFormat ?? 'ZK10',
    fid: identity.fid ?? identity.Fid ?? null,
  };
}

function normalizeBridgeResult(result) {
  if (!result || typeof result !== 'object') return result;
  return {
    ...result,
    identity: normalizeBridgeIdentity(result.identity ?? result.Identity),
    fingerprintImage: result.fingerprintImage ?? result.FingerprintImage ?? '',
    template: result.template ?? result.Template,
    format: result.format ?? result.Format,
    duplicate: result.duplicate ?? result.Duplicate ?? false,
    matched: result.matched ?? result.Matched ?? false,
    score: result.score ?? result.Score ?? 0,
  };
}

const BRIDGE_URL = (
  import.meta.env.VITE_ZKTECO_BRIDGE_URL
  || 'http://127.0.0.1:18181'
).replace(/\/+$/, '');

async function request(path, options = {}, timeout = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(`${BRIDGE_URL}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok || data?.ok === false) {
      throw new Error(data?.message || `ZKTeco bridge error (${response.status})`);
    }

    return data;
  } catch (error) {
    if (
      error?.name === 'AbortError'
      || /failed to fetch/i.test(String(error?.message || ''))
    ) {
      throw new Error(
        'سرویس محلی ZKTeco در دسترس نیست. فایل ZKTecoBridge.exe را روی همین کمپیوتر اجرا کنید.',
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function zkHealth() {
  return request('/health', { method: 'GET' }, 3500);
}

export async function zkSyncTemplates(enrollments = []) {
  const clean = (Array.isArray(enrollments) ? enrollments : [])
    .filter((item) => item?.fingerprintTemplate)
    .map((item) => ({
      customerId: item.customerId || item.id || null,
      customerName: item.customerName || '',
      phone: item.phone || '',
      documentNumber: item.documentNumber || '',
      cardNumber: item.cardNumber || '',
      bankName: item.bankName || '',
      cardHolderName: item.cardHolderName || '',
      photoUrl: item.photoUrl || null,
      fingerprintUrl: item.fingerprintUrl || null,
      balances: item.balances || [],
      fingerprintTemplate: item.fingerprintTemplate,
      fingerprintFormat: item.fingerprintFormat || 'ZK10',
    }));

  return request('/templates/sync', {
    method: 'POST',
    body: JSON.stringify({ enrollments: clean }),
  }, 15000);
}

export async function zkIdentify() {
  const result = await request('/scan-identify', {
    method: 'POST',
    body: JSON.stringify({ timeoutMs: 15000 }),
  }, 22000);
  return normalizeBridgeResult(result);
}

export async function zkEnroll() {
  const result = await request('/scan-enroll', {
    method: 'POST',
    body: JSON.stringify({ timeoutMs: 15000 }),
  }, 60000);
  return normalizeBridgeResult(result);
}

export function zkFingerprintImageToFile(dataUrl) {
  if (!dataUrl || !String(dataUrl).startsWith('data:')) return null;

  const [header, payload] = String(dataUrl).split(',');
  const mime = /data:([^;]+);base64/i.exec(header || '')?.[1] || 'image/png';
  if (!payload) return null;

  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  const extension = mime.includes('jpeg') ? 'jpg' : 'png';
  return new File(
    [bytes],
    `zkteco-fingerprint-${Date.now()}.${extension}`,
    { type: mime },
  );
}

export { BRIDGE_URL as ZKTECO_BRIDGE_URL };
