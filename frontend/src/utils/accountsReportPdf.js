import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { dateTime, money } from './format.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sideLabel(side, labels) {
  if (side === 'creditor') return labels.creditor;
  if (side === 'debtor') return labels.debtor;
  if (side === 'both') return `${labels.creditor} / ${labels.debtor}`;
  return labels.settled;
}

function currencyTotalsHtml(title, rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) {
    return `<div class="block"><h3>${escapeHtml(title)}</h3><p class="muted">—</p></div>`;
  }
  return `
    <div class="block">
      <h3>${escapeHtml(title)}</h3>
      <ul>
        ${list.map((row) => `
          <li>
            <strong>${escapeHtml(row.code)}</strong>
            <span>${escapeHtml(money(row.amount))} ${escapeHtml(row.symbol || row.code)}</span>
          </li>
        `).join('')}
      </ul>
    </div>
  `;
}

function buildReportHtml({
  title,
  subtitle,
  rows,
  totals,
  side,
  labels,
}) {
  const receivable = totals?.receivableByCurrency || [];
  const payable = totals?.payableByCurrency || [];
  const showReceivable = !side || side === 'debtor';
  const showPayable = !side || side === 'creditor';

  const bodyRows = (rows || []).map((row) => {
    const balances = (row.openBalances || [])
      .filter((b) => b.side !== 'settled')
      .map((b) => `${b.code}: ${money(Math.abs(Number(b.amount || 0)))} (${sideLabel(b.side, labels)})`)
      .join(' · ')
      || (row.accountSide === 'settled' ? labels.settled : '—');
    return `
      <tr>
        <td>${escapeHtml(row.name)} <small>#${escapeHtml(row.id)}</small></td>
        <td>${escapeHtml(row.phone && row.phone !== 'بدون‌شماره' ? row.phone : '—')}</td>
        <td>${escapeHtml(balances)}</td>
        <td>${escapeHtml(sideLabel(row.accountSide, labels))}</td>
      </tr>
    `;
  }).join('');

  return `
    <div class="accounts-pdf-root" dir="rtl" lang="fa">
      <header>
        <h1>${escapeHtml(title)}</h1>
        ${subtitle ? `<p class="subtitle">${escapeHtml(subtitle)}</p>` : ''}
        <p class="meta">${escapeHtml(labels.generatedAt)}: ${escapeHtml(dateTime(new Date()))}</p>
      </header>
      <section class="totals">
        ${showReceivable ? currencyTotalsHtml(labels.receivableByCurrency, receivable) : ''}
        ${showPayable ? currencyTotalsHtml(labels.payableByCurrency, payable) : ''}
      </section>
      <table>
        <thead>
          <tr>
            <th>${escapeHtml(labels.customer)}</th>
            <th>${escapeHtml(labels.phone)}</th>
            <th>${escapeHtml(labels.currentBalance)}</th>
            <th>${escapeHtml(labels.accountSide)}</th>
          </tr>
        </thead>
        <tbody>
          ${bodyRows || `<tr><td colspan="4">${escapeHtml(labels.noData)}</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

const REPORT_STYLES = `
  html, body {
    margin: 0;
    padding: 0;
    background: #fff;
    direction: rtl;
    text-align: right;
    font-family: Vazirmatn, "Noto Naskh Arabic", Tahoma, sans-serif;
    letter-spacing: 0;
    word-spacing: 0;
    font-kerning: none;
    font-feature-settings: normal;
    font-variant-ligatures: none;
    -webkit-font-smoothing: antialiased;
  }
  .accounts-pdf-root {
    box-sizing: border-box;
    width: 900px;
    padding: 28px;
    background: #fff;
    color: #0f172a;
    font-family: Vazirmatn, "Noto Naskh Arabic", Tahoma, sans-serif;
    font-weight: 500;
    line-height: 1.7;
    letter-spacing: 0 !important;
    word-spacing: 0 !important;
    font-kerning: none;
    font-feature-settings: normal;
    direction: rtl;
    text-align: right;
  }
  .accounts-pdf-root *,
  .accounts-pdf-root *::before,
  .accounts-pdf-root *::after {
    font-family: inherit !important;
    letter-spacing: 0 !important;
    word-spacing: 0 !important;
    font-kerning: none !important;
    font-feature-settings: normal !important;
    box-sizing: border-box;
  }
  .accounts-pdf-root h1 {
    margin: 0 0 6px;
    font-size: 22px;
    font-weight: 800;
    color: #1d4ed8;
  }
  .accounts-pdf-root .subtitle,
  .accounts-pdf-root .meta,
  .accounts-pdf-root .muted {
    margin: 0;
    color: #64748b;
    font-size: 12px;
    font-weight: 500;
  }
  .accounts-pdf-root .meta { margin-top: 8px; margin-bottom: 18px; }
  .accounts-pdf-root .totals {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
    margin-bottom: 18px;
  }
  .accounts-pdf-root .totals:has(.block:only-child) {
    grid-template-columns: 1fr;
  }
  .accounts-pdf-root .block {
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    padding: 12px 14px;
    background: #f8fafc;
  }
  .accounts-pdf-root .block h3 {
    margin: 0 0 10px;
    font-size: 13px;
    font-weight: 700;
    color: #334155;
  }
  .accounts-pdf-root ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 8px;
  }
  .accounts-pdf-root li {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    font-size: 13px;
    font-weight: 700;
  }
  .accounts-pdf-root table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  .accounts-pdf-root th,
  .accounts-pdf-root td {
    border: 1px solid #e2e8f0;
    padding: 8px 10px;
    vertical-align: top;
    text-align: right;
  }
  .accounts-pdf-root th {
    background: #eff6ff;
    color: #1e40af;
    font-weight: 700;
  }
  .accounts-pdf-root small {
    display: block;
    color: #94a3b8;
    font-weight: 600;
    margin-top: 2px;
  }
`;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForWebfonts() {
  if (document.fonts?.ready) {
    try {
      await document.fonts.ready;
      await Promise.allSettled([
        document.fonts.load('500 16px Vazirmatn'),
        document.fonts.load('700 16px Vazirmatn'),
        document.fonts.load('800 22px Vazirmatn'),
        document.fonts.load('500 16px "Noto Naskh Arabic"'),
      ]);
    } catch {
      /* continue with fallbacks */
    }
  }
}

function canvasHasInk(canvas) {
  if (!canvas?.width || !canvas?.height) return false;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const stepX = Math.max(1, Math.floor(canvas.width / 24));
  const stepY = Math.max(1, Math.floor(canvas.height / 24));
  for (let y = 0; y < canvas.height; y += stepY) {
    for (let x = 0; x < canvas.width; x += stepX) {
      const [r, g, b, a] = ctx.getImageData(x, y, 1, 1).data;
      if (a > 20 && (r < 245 || g < 245 || b < 245)) return true;
    }
  }
  return false;
}

async function captureRoot(root) {
  const width = Math.max(root.scrollWidth, root.offsetWidth, 900);
  const height = Math.max(root.scrollHeight, root.offsetHeight, 1);
  return html2canvas(root, {
    backgroundColor: '#ffffff',
    scale: 2,
    useCORS: true,
    allowTaint: true,
    logging: false,
    letterRendering: false,
    foreignObjectRendering: false,
    width,
    height,
    windowWidth: width,
    windowHeight: height,
    onclone: (clonedDoc, clonedEl) => {
      clonedDoc.documentElement.dir = 'rtl';
      clonedDoc.body.style.margin = '0';
      clonedDoc.body.style.background = '#fff';
      clonedEl.style.position = 'static';
      clonedEl.style.left = 'auto';
      clonedEl.style.top = 'auto';
      clonedEl.style.opacity = '1';
      clonedEl.style.transform = 'none';
      clonedEl.style.fontFamily = 'Vazirmatn, "Noto Naskh Arabic", Tahoma, sans-serif';
      clonedEl.style.letterSpacing = '0px';
      clonedEl.querySelectorAll('*').forEach((node) => {
        node.style.letterSpacing = '0px';
        node.style.wordSpacing = '0px';
        node.style.fontFamily = 'Vazirmatn, "Noto Naskh Arabic", Tahoma, sans-serif';
        node.style.fontFeatureSettings = 'normal';
        node.style.fontKerning = 'none';
      });
    },
  });
}

function addCanvasPages(pdf, canvas) {
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 8;
  const usableWidth = pageWidth - margin * 2;
  const usableHeight = pageHeight - margin * 2;
  const imgWidth = usableWidth;
  const pageCanvasHeight = Math.max(1, Math.floor((usableHeight * canvas.width) / imgWidth));

  let rendered = 0;
  let pageIndex = 0;
  while (rendered < canvas.height) {
    const sliceHeight = Math.min(pageCanvasHeight, canvas.height - rendered);
    const pageCanvas = document.createElement('canvas');
    pageCanvas.width = canvas.width;
    pageCanvas.height = sliceHeight;
    const ctx = pageCanvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
    ctx.drawImage(
      canvas,
      0,
      rendered,
      canvas.width,
      sliceHeight,
      0,
      0,
      canvas.width,
      sliceHeight,
    );
    const imgData = pageCanvas.toDataURL('image/jpeg', 0.92);
    const sliceMm = (sliceHeight * imgWidth) / canvas.width;
    if (pageIndex > 0) pdf.addPage();
    pdf.addImage(imgData, 'JPEG', margin, margin, imgWidth, sliceMm);
    rendered += sliceHeight;
    pageIndex += 1;
  }
}

async function renderHtmlToPdf({ html, styles, selector, filename, width = 900 }) {
  await waitForWebfonts();

  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.dir = 'rtl';
  host.lang = 'fa';
  host.style.cssText = [
    'position:fixed',
    'top:0',
    'left:0',
    `width:${width}px`,
    'background:#fff',
    'z-index:2147483646',
    'opacity:1',
    'pointer-events:none',
    'letter-spacing:0',
    'word-spacing:0',
    'font-kerning:none',
    'font-feature-settings:normal',
    'font-family:Vazirmatn, "Noto Naskh Arabic", Tahoma, sans-serif',
  ].join(';');
  const style = document.createElement('style');
  style.textContent = styles;
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  host.append(style, wrap);
  document.body.appendChild(host);
  const root = host.querySelector(selector);
  void root?.offsetHeight;
  await wait(40);

  try {
    const canvas = await captureRoot(root);
    if (!canvasHasInk(canvas)) {
      throw new Error('empty-canvas');
    }
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    addCanvasPages(pdf, canvas);
    pdf.save(filename);
    return filename;
  } finally {
    host.remove();
  }
}

/**
 * Build a multi-page A4 PDF from the current accounts list + currency totals.
 */
export async function downloadAccountsReportPdf(options) {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return renderHtmlToPdf({
    html: buildReportHtml(options),
    styles: REPORT_STYLES,
    selector: '.accounts-pdf-root',
    filename: `accounts-report-${stamp}.pdf`,
  });
}

const LEDGER_STYLES = `
  .cashbox-pdf-root {
    box-sizing: border-box;
    width: 720px;
    padding: 22px;
    background: #fff;
    color: #0f172a;
    font-family: Vazirmatn, "Noto Naskh Arabic", Tahoma, sans-serif;
    letter-spacing: 0 !important;
    word-spacing: 0 !important;
    font-kerning: none;
    direction: rtl;
    text-align: right;
  }
  .cashbox-pdf-root *,
  .cashbox-pdf-root *::before,
  .cashbox-pdf-root *::after {
    font-family: inherit !important;
    letter-spacing: 0 !important;
    word-spacing: 0 !important;
    box-sizing: border-box;
  }
  .cashbox-pdf-root h1 {
    margin: 0 0 4px;
    font-size: 18px;
    font-weight: 800;
    color: #1d4ed8;
  }
  .cashbox-pdf-root .meta {
    margin: 0 0 14px;
    color: #64748b;
    font-size: 12px;
  }
  .cashbox-pdf-root .currency-block {
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 10px;
    margin-bottom: 10px;
    background: #f8fafc;
  }
  .cashbox-pdf-root .currency-block h3 {
    margin: 0 0 8px;
    font-size: 13px;
    color: #334155;
  }
  .cashbox-pdf-root .stats {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 6px;
  }
  .cashbox-pdf-root .stat {
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 7px 8px;
  }
  .cashbox-pdf-root .stat small {
    display: block;
    color: #64748b;
    font-size: 10px;
    font-weight: 800;
  }
  .cashbox-pdf-root .stat strong {
    font-size: 12px;
  }
  .cashbox-pdf-root .in { color: #15803d; }
  .cashbox-pdf-root .out { color: #b91c1c; }
  .cashbox-pdf-root table {
    width: 100%;
    border-collapse: collapse;
    font-size: 11px;
    margin-top: 8px;
  }
  .cashbox-pdf-root th,
  .cashbox-pdf-root td {
    border: 1px solid #e2e8f0;
    padding: 6px 7px;
    text-align: right;
    vertical-align: top;
  }
  .cashbox-pdf-root th {
    background: #eff6ff;
    color: #1e40af;
    font-weight: 700;
  }
`;

function buildCashboxLedgerHtml({
  title,
  periodLabel,
  generatedAt,
  summary,
  rows,
  labels,
}) {
  const summaryHtml = (summary || []).map((row) => `
    <div class="currency-block">
      <h3>${escapeHtml(row.code)}${row.symbol ? ` ${escapeHtml(row.symbol)}` : ''}</h3>
      <div class="stats">
        <div class="stat"><small>${escapeHtml(labels.opening)}</small><strong>${escapeHtml(money(row.opening))} ${escapeHtml(row.code)}</strong></div>
        <div class="stat"><small>${escapeHtml(labels.moneyIn)}</small><strong class="in">+${escapeHtml(money(row.totalIn))} ${escapeHtml(row.code)}</strong></div>
        <div class="stat"><small>${escapeHtml(labels.moneyOut)}</small><strong class="out">−${escapeHtml(money(row.totalOut))} ${escapeHtml(row.code)}</strong></div>
        <div class="stat"><small>${escapeHtml(labels.remaining)}</small><strong>${escapeHtml(money(row.remaining))} ${escapeHtml(row.code)}</strong></div>
      </div>
    </div>
  `).join('');

  const bodyRows = (rows || []).slice(0, 24).map((row) => `
    <tr>
      <td>${escapeHtml(row.sourceLabel || row.source || '—')}</td>
      <td>${escapeHtml(row.title || '—')}</td>
      <td class="${row.direction === 'in' ? 'in' : 'out'}">${row.direction === 'in' ? '+' : '−'}${escapeHtml(money(row.amount))} ${escapeHtml(row.currencyCode || '')}</td>
      <td>${escapeHtml(row.number || '—')}</td>
      <td>${escapeHtml(dateTime(row.at))}</td>
    </tr>
  `).join('');

  return `
    <div class="cashbox-pdf-root" dir="rtl" lang="fa">
      <h1>${escapeHtml(title)}</h1>
      <p class="meta">${escapeHtml(periodLabel)} · ${escapeHtml(labels.generatedAt)}: ${escapeHtml(generatedAt)}</p>
      ${summaryHtml || `<p class="meta">${escapeHtml(labels.noData)}</p>`}
      <table>
        <thead>
          <tr>
            <th>${escapeHtml(labels.source)}</th>
            <th>${escapeHtml(labels.person)}</th>
            <th>${escapeHtml(labels.amount)}</th>
            <th>${escapeHtml(labels.number)}</th>
            <th>${escapeHtml(labels.date)}</th>
          </tr>
        </thead>
        <tbody>
          ${bodyRows || `<tr><td colspan="5">${escapeHtml(labels.noData)}</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

export async function downloadCashboxLedgerPdf(options) {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return renderHtmlToPdf({
    html: buildCashboxLedgerHtml(options),
    styles: LEDGER_STYLES,
    selector: '.cashbox-pdf-root',
    filename: `cashbox-ledger-${stamp}.pdf`,
    width: 720,
  });
}
