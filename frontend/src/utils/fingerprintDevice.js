/** Simulated fingerprint capture pad (unique templates per enrollment). */

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(seed) {
  let h = 2166136261;
  const s = String(seed);
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Unique seed for each new fingerprint enrollment (never shared across people). */
export function newFingerprintSeed() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `fp-${crypto.randomUUID()}`;
  }
  return `fp-${Date.now()}-${Math.floor(Math.random() * 1e12)}`;
}

/**
 * Pad contact region — used only as a shortcut to find which enrolled
 * template to replay (each person still has a unique seed).
 */
export function fingerSeedFromPointerEvent(event, cols = 12, rows = 12) {
  const el = event?.currentTarget;
  if (!el || typeof el.getBoundingClientRect !== 'function') return null;
  const point = event.touches?.[0] || event.changedTouches?.[0] || event;
  if (point?.clientX == null || point?.clientY == null) return null;
  const rect = el.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const xRatio = Math.min(0.999, Math.max(0, (point.clientX - rect.left) / rect.width));
  const yRatio = Math.min(0.999, Math.max(0, (point.clientY - rect.top) / rect.height));
  const x = Math.min(cols - 1, Math.floor(xRatio * cols));
  const y = Math.min(rows - 1, Math.floor(yRatio * rows));
  return `pad-${x}-${y}`;
}

export function drawFingerprint(canvas, seed = Date.now()) {
  const ctx = canvas.getContext('2d');
  const size = canvas.width;
  const rnd = mulberry32(Number.parseInt(hashSeed(seed).slice(0, 8), 16) || 1);
  ctx.clearRect(0, 0, size, size);

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);

  ctx.save();
  ctx.beginPath();
  ctx.ellipse(size / 2, size / 2, size * 0.38, size * 0.46, 0, 0, Math.PI * 2);
  ctx.clip();

  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 2.8;
  ctx.lineCap = 'round';
  for (let i = 0; i < 18; i += 1) {
    const rx = size * (0.08 + i * 0.022);
    const ry = size * (0.1 + i * 0.026);
    ctx.beginPath();
    for (let a = 0; a <= Math.PI * 2; a += 0.08) {
      const jitter = (rnd() - 0.5) * 2.2;
      const x = size / 2 + Math.cos(a) * (rx + jitter);
      const y = size / 2 + Math.sin(a) * (ry + jitter * 0.8) + i * 0.4;
      if (a === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 2.2;
  for (let i = 0; i < 40; i += 1) {
    const x0 = size * (0.2 + rnd() * 0.6);
    const y0 = size * (0.18 + rnd() * 0.64);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(
      x0 + (rnd() - 0.5) * 28,
      y0 + (rnd() - 0.5) * 28,
      x0 + (rnd() - 0.5) * 36,
      y0 + 10 + rnd() * 24,
    );
    ctx.stroke();
  }
  ctx.restore();

  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 4.5;
  ctx.beginPath();
  ctx.ellipse(size / 2, size / 2, size * 0.38, size * 0.46, 0, 0, Math.PI * 2);
  ctx.stroke();
}

function dataUrlToFile(dataUrl, filename) {
  const [header, base64] = String(dataUrl).split(',');
  const mime = /data:([^;]+);/.exec(header)?.[1] || 'image/png';
  const binary = atob(base64 || '');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], filename, { type: mime });
}

export function captureFingerprintBlob(seed = Date.now()) {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 320;
  drawFingerprint(canvas, seed);
  const dataUrl = canvas.toDataURL('image/png');
  const filename = `fingerprint-${String(seed).slice(0, 40)}.png`;
  return new Promise((resolve) => {
    const finish = (blob) => {
      const file = blob && blob.size
        ? new File([blob], filename, { type: 'image/png' })
        : dataUrlToFile(dataUrl, filename);
      resolve({ file, dataUrl, seed: String(seed) });
    };
    try {
      canvas.toBlob((blob) => finish(blob), 'image/png');
    } catch {
      finish(null);
    }
  });
}
