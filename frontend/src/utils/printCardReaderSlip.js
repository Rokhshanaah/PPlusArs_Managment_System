import { dateTime, money } from './format.js';
import { mediaUrl } from './mediaUrl.js';

const RECEIPT_FONT =
  'Tahoma, "Segoe UI", Arial, "Noto Naskh Arabic", "Vazirmatn", sans-serif';

/** فضای خروج پایین تا آخرین سطر از دهانه پرینتر کامل بیرون بیاید */
const THERMAL_FEED_MM = 18;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function textOrDash(value) {
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

function rowHtml(label, value, { ltr = false, strong = false } = {}) {
  const val = escapeHtml(textOrDash(value));
  return `
    <tr>
      <th scope="row"><span class="cell">${escapeHtml(label)}</span></th>
      <td class="${ltr ? 'ltr' : ''} ${strong ? 'highlight' : ''}">
        <span class="cell">${strong ? `<strong>${val}</strong>` : val}</span>
      </td>
    </tr>
  `;
}

function optionalRow(label, value, opts) {
  if (value === null || value === undefined || value === '') return '';
  return rowHtml(label, value, opts);
}

function isSettingOn(value) {
  const s = String(value ?? '').trim().toLowerCase();
  return s === 'روشن' || s === 'on' || s === '1' || s === 'true' || s === 'yes';
}

/** بارگذاری تصویر به‌صورت blob تا canvas بدون مشکل CORS کار کند */
async function loadImage(src) {
  if (!src) return null;

  const withTimeout = (promise, ms = 4000) => Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('image timeout')), ms)),
  ]);

  const fromBlobUrl = (objectUrl) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ img, objectUrl });
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('image load failed'));
    };
    img.src = objectUrl;
  });

  try {
    const res = await withTimeout(fetch(src, { credentials: 'same-origin' }));
    if (!res.ok) throw new Error(`fetch ${res.status}`);
    const blob = await withTimeout(res.blob());
    return await withTimeout(fromBlobUrl(URL.createObjectURL(blob)));
  } catch {
    try {
      return await withTimeout(new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve({ img, objectUrl: null });
        img.onerror = () => reject(new Error('image load failed'));
        img.src = src;
      }));
    } catch {
      return null;
    }
  }
}

/**
 * عکس: خاکستری با جزئیات صورت
 * اثر انگشت: خطوط تیره روی سفید
 */
async function toThermalInkDataUrl(src, { fingerprint = false, size = 200 } = {}) {
  if (!src) return '';
  let objectUrl = null;
  try {
    const loaded = await loadImage(src);
    if (!loaded?.img) return '';
    const { img } = loaded;
    objectUrl = loaded.objectUrl;

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);

    const scale = fingerprint
      ? Math.min(size / img.width, size / img.height) * 0.92
      : Math.max(size / img.width, size / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);

    const imageData = ctx.getImageData(0, 0, size, size);
    const { data } = imageData;

    if (fingerprint) {
      for (let i = 0; i < data.length; i += 4) {
        const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        let v = (gray - 128) * 2.2 + 100;
        if (v < 0) v = 0;
        if (v > 255) v = 255;
        const ink = v < 210 ? 0 : 255;
        data[i] = ink;
        data[i + 1] = ink;
        data[i + 2] = ink;
        data[i + 3] = 255;
      }
    } else {
      for (let i = 0; i < data.length; i += 4) {
        const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        let v = (gray - 128) * 1.55 + 85;
        if (v < 0) v = 0;
        if (v > 255) v = 255;
        let ink;
        if (v < 110) ink = 0;
        else if (v < 160) ink = 20;
        else if (v < 205) ink = 55;
        else ink = 255;
        data[i] = ink;
        data[i + 1] = ink;
        data[i + 2] = ink;
        data[i + 3] = 255;
      }
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL('image/png');
  } catch {
    return src;
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

/**
 * چاپ فیش حرارتی ۸ سانتی‌متری برای تراکنش کارت‌خوان
 * عکس / اثر انگشت فقط اگر در تنظیمات روشن باشند
 */
export async function printCardReaderSlip({
  entry,
  labels,
  company = {},
}) {
  if (!entry) return false;

  const printPhoto = isSettingOn(company.print_card_reader_photo);
  const printFinger = isSettingOn(company.print_card_reader_fingerprint);

  const currency = entry.currency?.code || '';
  const photoSrc = printPhoto ? mediaUrl(entry.photoUrl || entry.customer?.avatarUrl) : '';
  const fingerSrc = printFinger ? mediaUrl(entry.fingerprintUrl) : '';
  const [photo, finger] = await Promise.all([
    printPhoto ? toThermalInkDataUrl(photoSrc, { fingerprint: false, size: 220 }) : Promise.resolve(''),
    printFinger ? toThermalInkDataUrl(fingerSrc, { fingerprint: true, size: 220 }) : Promise.resolve(''),
  ]);

  const title = labels.title || 'کارت‌خوان';
  const companyName = company.company_name || company.companyName || 'PPlus.Arz';
  const companySlogan = company.company_slogan || company.companySlogan || '';
  const companyPhone = company.company_phone || company.companyPhone || '';
  const companyAddress = company.company_address || company.companyAddress || '';
  const receiptNote = company.receipt_note || company.receiptNote || '';
  const contact = [companyPhone, companyAddress].filter(Boolean).join(' • ');
  const docNumber = entry.id ? String(entry.id).padStart(6, '0') : '—';

  const feeNum = Number(entry.fee || 0);
  const fieldRows = [
    rowHtml(labels.name, entry.customerName || entry.customer?.name),
    optionalRow(labels.phone, entry.phone || entry.customer?.phone),
    optionalRow(labels.documentNumber, entry.documentNumber || entry.customer?.documentNumber),
    optionalRow(labels.cardNumber, entry.cardNumber, { ltr: true }),
    optionalRow(labels.bankName, entry.bankName),
    optionalRow(labels.cardHolderName, entry.cardHolderName),
    rowHtml(labels.operation, labels.operationValue),
    rowHtml(labels.amount, `${money(entry.amount)} ${currency}`.trim(), { ltr: true, strong: true }),
    feeNum > 0
      ? rowHtml(labels.fee, `${money(feeNum)} ${currency}`.trim(), { ltr: true })
      : '',
  ].join('');

  const noteHtml = entry.note
    ? `<div class="note-row"><strong>${escapeHtml(labels.note)}:</strong> ${escapeHtml(entry.note)}</div>`
    : '';

  const photosHtml = (photo || finger) ? `
    <div class="photos">
      ${photo ? `
        <div class="photo-box">
          <img class="face" src="${photo}" alt=""/>
          <div class="cap">${escapeHtml(labels.photoCap || '')}</div>
        </div>` : ''}
      ${finger ? `
        <div class="photo-box">
          <img class="finger" src="${finger}" alt=""/>
          <div class="cap">${escapeHtml(labels.fingerCap || '')}</div>
        </div>` : ''}
    </div>
  ` : '';

  const html = `<!doctype html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    @page {
      size: 80mm auto;
      margin: 0;
    }
    html, body {
      margin: 0;
      padding: 0;
      width: 80mm;
      max-width: 80mm;
      min-height: 0;
      height: auto;
      overflow: visible;
      direction: rtl;
      color: #000;
      background: #fff;
      font-family: ${RECEIPT_FONT};
      font-weight: 700;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    * { box-sizing: border-box; }
    .slip {
      width: 80mm;
      max-width: 80mm;
      margin: 0 auto;
      padding: 0 5mm 0 7mm;
      overflow: visible;
    }
    .frame {
      width: 100%;
      padding: 0 1.5mm 1mm;
      overflow: visible;
    }
    .brand {
      text-align: center;
      margin-bottom: 2px;
    }
    .logo {
      font-size: 13px;
      font-weight: 800;
      line-height: 1.2;
      color: #000;
    }
    .slogan {
      margin: 1px 0 0;
      font-size: 9px;
      font-weight: 700;
      color: #000;
    }
    .main-title {
      margin-top: 3px;
      font-size: 11px;
      font-weight: 800;
      border-top: 1px solid #000;
      border-bottom: 1px solid #000;
      padding: 3px 0;
      color: #000;
    }
    .meta {
      display: flex;
      justify-content: space-between;
      gap: 4px;
      font-size: 9px;
      margin: 3px 0 4px;
      color: #000;
    }
    .photos {
      display: flex;
      justify-content: center;
      align-items: stretch;
      gap: 8px;
      margin: 0 0 6px;
      padding: 5px 4px 4px;
      border: 1.5px solid #000;
    }
    .photo-box {
      flex: 1;
      text-align: center;
      max-width: 48%;
    }
    .photo-box img {
      display: block;
      width: 58px;
      height: 58px;
      margin: 0 auto;
      border: 1.5px solid #000;
      background: #fff;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    .photo-box img.face {
      object-fit: cover;
      object-position: center top;
    }
    .photo-box img.finger {
      object-fit: contain;
      padding: 2px;
    }
    .photo-box .cap {
      margin-top: 2px;
      font-size: 8px;
      font-weight: 800;
      color: #000;
      line-height: 1.15;
    }
    table.fields {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: 10px;
      line-height: 1.25;
      color: #000;
      border: 1.5px solid #000;
    }
    table.fields th,
    table.fields td {
      padding: 2.5px 3px;
      border-bottom: 1px solid #000;
      vertical-align: middle;
      word-break: break-word;
      color: #000;
    }
    table.fields tr:last-child th,
    table.fields tr:last-child td {
      border-bottom: 0;
    }
    table.fields th {
      width: 36%;
      text-align: right;
      font-weight: 700;
      border-left: 1px solid #000;
    }
    table.fields td {
      width: 64%;
      text-align: left;
      font-weight: 700;
    }
    td.ltr, .ltr .cell {
      direction: ltr;
      unicode-bidi: plaintext;
      text-align: left;
    }
    td.highlight strong {
      font-size: 11px;
      font-weight: 800;
      color: #000;
    }
    .cell { display: inline-block; max-width: 100%; }
    .note-row {
      margin-top: 4px;
      font-size: 9px;
      color: #000;
      font-weight: 700;
      line-height: 1.3;
    }
    .footer-note, .contact, .sign {
      margin-top: 4px;
      font-size: 9px;
      text-align: center;
      line-height: 1.3;
      color: #000;
    }
    .sign {
      margin-top: 8px;
      border-top: 1px solid #000;
      padding-top: 4px;
      min-height: 16px;
      font-weight: 800;
    }
    .eject {
      display: block;
      width: 100%;
      height: ${THERMAL_FEED_MM}mm;
      min-height: ${THERMAL_FEED_MM}mm;
      margin: 0;
      padding: 0;
      background: #fff;
    }
    @media print {
      html, body {
        width: 80mm !important;
        max-width: 80mm !important;
        height: auto !important;
        overflow: visible !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      .slip, .frame, .eject { overflow: visible !important; }
      .slip {
        width: 80mm !important;
        max-width: 80mm !important;
      }
      .photos,
      table.fields,
      .photo-box img {
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      table.fields {
        border: 1.5px solid #000 !important;
      }
      table.fields th,
      table.fields td {
        border-bottom: 1px solid #000 !important;
      }
      table.fields th {
        border-left: 1px solid #000 !important;
      }
      table.fields tr:last-child th,
      table.fields tr:last-child td {
        border-bottom: 0 !important;
      }
      .photo-box img {
        filter: none !important;
      }
      .eject {
        display: block !important;
        height: ${THERMAL_FEED_MM}mm !important;
        min-height: ${THERMAL_FEED_MM}mm !important;
      }
    }
  </style>
</head>
<body>
  <div class="slip">
    <div class="frame">
      <header class="brand">
        <div class="logo">${escapeHtml(companyName)}</div>
        ${companySlogan ? `<p class="slogan">${escapeHtml(companySlogan)}</p>` : ''}
        <div class="main-title">${escapeHtml(title)}</div>
      </header>

      <div class="meta">
        <span>${escapeHtml(labels.documentNo)}: <strong>${escapeHtml(docNumber)}</strong></span>
        <span>${escapeHtml(dateTime(entry.createdAt || new Date()))}</span>
      </div>

      ${photosHtml}

      <table class="fields">
        <tbody>
          ${fieldRows}
        </tbody>
      </table>

      ${noteHtml}
      ${receiptNote ? `<div class="footer-note">${escapeHtml(receiptNote)}</div>` : ''}
      ${contact ? `<div class="contact">${escapeHtml(contact)}</div>` : ''}
      <div class="sign">${escapeHtml(labels.signature)}</div>
    </div>
    <div class="eject" aria-hidden="true"></div>
  </div>
  <script>
    window.onload = function () {
      var imgs = Array.prototype.slice.call(document.images || []);
      var pending = imgs.length;
      var printed = false;
      function go() {
        if (printed) return;
        printed = true;
        setTimeout(function () {
          window.focus();
          window.print();
        }, 250);
      }
      if (!pending) { go(); return; }
      imgs.forEach(function (img) {
        if (img.complete && img.naturalWidth) {
          pending -= 1;
          if (!pending) go();
        } else {
          img.onload = img.onerror = function () {
            pending -= 1;
            if (!pending) go();
          };
        }
      });
      setTimeout(go, 3000);
    };
  </script>
</body>
</html>`;

  const win = window.open('', '_blank', 'width=360,height=720');
  if (!win) return false;
  win.document.open();
  win.document.write(html);
  win.document.close();
  return true;
}
