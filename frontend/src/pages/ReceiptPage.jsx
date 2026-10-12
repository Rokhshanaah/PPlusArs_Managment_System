import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Printer, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { api, messageOf } from '../api/client.js';
import { ErrorBox, Loading } from '../components/Common.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { dateTime, money } from '../utils/format.js';

import {
  localizeCompanyField,
  localizeNote,
  translateKind,
  translatePersonName,
  translatePlace,
} from '../utils/labels.js';

const PAPER_SIZES = ['6cm', '8cm'];
const PAPER_STORAGE_KEY = 'zarin_receipt_paper_size';
const STYLE_ELEMENT_ID = 'zarin-receipt-layout-styles';
const PRINT_FRAME_ID = 'zarin-receipt-print-frame';

const RECEIPT_FONT =
  'Tahoma, "Segoe UI", Arial, "Noto Naskh Arabic", "Vazirmatn", sans-serif';

const FONT_LINK =
  'https://fonts.googleapis.com/css2?family=Vazirmatn:wght@500;600;700;800;900&display=swap';

const GREEN = '#1d4ed8';
const GREEN_SOFT = '#eff6ff';
const GREEN_BORDER = '#1e40af';

/* فضای کوتاه پایین برای خروج کامل آخرین سطر از دهانه پرینتر */
const THERMAL_FEED_MM = 12;

/* تبدیل پیکسل CSS به میلی‌متر برای ساخت صفحه‌ای دقیقاً هم‌اندازه فیش */
const CSS_PIXELS_PER_MM = 96 / 25.4;
const PRINT_HEIGHT_BUFFER_MM = 3;

const PAGE_CONFIG = {
  '6cm': {
    paperWidthMm: 58,
    sideInsetMm: 2.5,
    /* XP حرارتی لبه چپ را بیشتر می‌بُرد */
    outerGapLeftMm: 6,
    outerGapRightMm: 4,
    width: '58mm',
  },

  '8cm': {
    paperWidthMm: 80,
    sideInsetMm: 2.5,
    outerGapLeftMm: 8,
    outerGapRightMm: 6,
    width: '80mm',
  },
};

function readPaperSize() {
  try {
    const saved = localStorage.getItem(PAPER_STORAGE_KEY);

    return PAPER_SIZES.includes(saved)
      ? saved
      : '8cm';
  } catch {
    return '8cm';
  }
}

function textValue(value) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return '—';
  }

  return String(value);
}

function escapeHtml(value) {
  return textValue(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function wait(milliseconds) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

function getReceiptCss(paperSize, printing = false) {
  const config =
    PAGE_CONFIG[paperSize] ||
    PAGE_CONFIG['8cm'];

  const is6cm = paperSize === '6cm';
  const sideInsetMm = config.sideInsetMm || 2.5;
  const outerGapLeftMm =
    config.outerGapLeftMm ||
    config.outerGapMm ||
    8;
  const outerGapRightMm =
    config.outerGapRightMm ||
    config.outerGapMm ||
    6;
  const paperPadding = `0 ${outerGapRightMm}mm 2mm ${outerGapLeftMm}mm`;

  const normalFontSize =
    is6cm ? '8px' : '11.5px';

  const smallFontSize =
    is6cm ? '7px' : '10px';

  const logoFontSize =
    is6cm ? '14px' : '18px';

  const titleFontSize =
    is6cm ? '11px' : '14px';

  /* وزن خیلی زیاد نقطه‌های حروف فارسی را در چاپ حرارتی محو می‌کند. */
  const bodyWeight = '700';
  const titleWeight = '800';

  return `
    @import url('${FONT_LINK}');

    html,
    body {
      margin: 0;
      padding: 0;
      direction: rtl;
      color: #000000;
      background: #ffffff;
      font-family: ${RECEIPT_FONT};
      font-weight: ${bodyWeight};
      font-feature-settings: "kern" 1;
      text-rendering: geometricPrecision;
      -webkit-font-smoothing: antialiased;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    *,
    *::before,
    *::after {
      box-sizing: border-box;
    }

    .receipt-page {
      width: 100%;
      direction: rtl;
      font-family: ${RECEIPT_FONT};
    }

    .receipt-actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px;
      margin-bottom: 14px;
    }

    .receipt-paper-picker {
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }

    .receipt-paper-picker select {
      min-width: 140px;
    }

    .receipt-paper {
      width: 100%;
      max-width: ${config.width};
      margin: 0 auto;
      padding: ${paperPadding} !important;
      direction: rtl;
      color: #000000;
      background: #ffffff;
      border: 0 !important;
      border-radius: 0;
      box-sizing: border-box !important;
      box-shadow: none;
      overflow: visible;
      font-family: ${RECEIPT_FONT};
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    /*
     * قاب بوردر کامل — داخل ناحیه امن چاپگر تا لبه چپ بریده نشود.
     */
    .receipt-frame {
      display: block;
      width: 100%;
      margin: 0;
      padding: 0 ${sideInsetMm}mm 2.5mm !important;
      direction: rtl;
      color: #000000;
      background: #ffffff;
      border: 0 !important;
      border-radius: ${printing ? '0' : '4px'};
      box-sizing: border-box !important;
      overflow: visible !important;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    /*
     * سربرگ
     */
    .receipt-brand {
      width: 100%;
      margin: 0;
      padding: 0 0 1mm;
      color: #000000;
      text-align: center;
      border: 0 !important;
      border-bottom: 0 !important;
      break-inside: avoid;
      page-break-inside: avoid;
    }

    .receipt-logo {
      width: 100%;
      margin: 0;
      color: #000000;
      text-align: center;
      font-family: ${RECEIPT_FONT};
      font-size: ${logoFontSize};
      font-weight: ${titleWeight};
      line-height: 1.25;
      letter-spacing: 0;
    }

    .receipt-company-slogan {
      width: 100%;
      margin: 0.4mm 0 0;
      color: #334155;
      text-align: center;
      font-size: ${smallFontSize};
      font-weight: ${bodyWeight};
      line-height: 1.3;
    }

    .receipt-main-title {
      display: block;
      width: 100%;
      margin: 1mm 0 1.5mm;
      color: #000000;
      text-align: center;
      font-size: ${titleFontSize};
      font-weight: ${titleWeight};
      line-height: 1.3;
    }

    /*
     * نمبر سند و تاریخ
     */
    .receipt-document-information {
      display: block;
      width: 100%;
      margin: 0 0 1.5mm;
      padding: 0;
      direction: rtl;
      color: #000000;
      border: 0 !important;
      break-inside: avoid;
      page-break-inside: avoid;
    }

    .receipt-document-header {
      display: grid;
      grid-template-columns:
        minmax(0, 1fr)
        minmax(0, 1.3fr);
      align-items: center;
      width: 100%;
      min-width: 0;
      gap: 1.5mm;
      margin: 0;
      padding: 0 0 0.8mm;
      direction: rtl;
      color: #000000;
      border: 0 !important;
      box-sizing: border-box;
    }

    /*
     * نمبر سند طرف راست
     */
    .receipt-document-number {
      display: flex;
      align-items: center;
      justify-content: flex-start;
      min-width: 0;
      gap: 1mm;
      margin: 0;
      padding: 0;
      direction: rtl;
      color: #000000;
      text-align: right;
      font-size: ${normalFontSize};
      font-weight: ${bodyWeight};
      line-height: 1.3;
      white-space: normal;
      border: 0 !important;
    }

    .receipt-document-number span,
    .receipt-document-number strong {
      color: #000000;
      font-weight: ${bodyWeight};
    }

    .receipt-document-number strong {
      direction: ltr;
      unicode-bidi: isolate;
    }

    /*
     * تاریخ طرف چپ و مقابل نمبر سند
     */
    .receipt-document-date {
      display: block;
      min-width: 0;
      width: 100%;
      margin: 0;
      padding: 0;
      direction: ltr;
      unicode-bidi: isolate;
      color: #000000;
      text-align: left;
      font-size: ${smallFontSize};
      font-weight: ${bodyWeight};
      line-height: 1.3;
      white-space: normal;
      overflow-wrap: anywhere;
      border: 0 !important;
    }

    /*
     * خط سبز زیر نمبر سند و تاریخ
     */
    .receipt-document-separator {
      display: block;
      width: 100%;
      height: 0;
      margin: 0;
      padding: 0;
      border: 0 !important;
      border-top: 2px solid ${GREEN} !important;
    }

    /*
     * جدول اصلی
     */
    .receipt-table {
      width: 100% !important;
      max-width: 100% !important;
      margin: 0 !important;
      direction: rtl;
      color: #000000;
      border: 1px solid ${GREEN_BORDER};
      border-collapse: separate;
      border-spacing: 0;
      table-layout: fixed;
      box-sizing: border-box !important;
      overflow: visible;
      font-family: ${RECEIPT_FONT};
      break-inside: auto;
      page-break-inside: auto;
    }

    .receipt-label-column {
      width: 40%;
    }

    .receipt-value-column {
      width: 60%;
    }

    .receipt-table tr {
      color: #000000;
      break-inside: auto;
      page-break-inside: auto;
    }

    .receipt-table th,
    .receipt-table td {
      min-width: 0;
      max-width: 100%;
      margin: 0;
      padding: ${
        is6cm
          ? '2px 2px'
          : '3px 3px'
      };
      color: #000000;
      background: #ffffff;
      border: 1px solid ${GREEN_BORDER};
      vertical-align: middle;
      text-align: right;
      white-space: normal;
      word-break: normal;
      overflow: hidden;
      overflow-wrap: anywhere;
      font-family: ${RECEIPT_FONT};
      font-size: ${normalFontSize};
      font-weight: ${bodyWeight};
      line-height: 1.3;
      opacity: 1;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    /*
     * ستون عنوان
     */
    .receipt-table th[scope='row'] {
      width: 40%;
      color: ${GREEN_BORDER};
      background: ${GREEN_SOFT};
      font-weight: ${titleWeight};
    }

    /*
     * ستون مقدار
     */
    .receipt-table td {
      width: 60%;
      color: #000000;
      background: #ffffff;
      font-weight: ${bodyWeight};
    }

    .receipt-cell-text {
      display: block;
      width: 100%;
      max-width: 100%;
      color: inherit;
      font-weight: inherit;
      line-height: 1.3;
      letter-spacing: 0;
      white-space: normal;
      overflow-wrap: anywhere;
    }

    .receipt-cell-ltr {
      direction: ltr;
      unicode-bidi: isolate;
      text-align: right;
    }

    /*
     * مبلغ‌های مهم
     */
    .receipt-row-highlight th,
    .receipt-row-highlight td {
      color: ${GREEN_BORDER};
      background: ${GREEN_SOFT};
      border-top: 1px solid ${GREEN_BORDER};
      border-bottom: 1px solid ${GREEN_BORDER};
      font-weight: ${titleWeight};
    }

    .receipt-row-highlight td {
      color: ${GREEN};
      font-size: ${
        is6cm ? '9px' : '12px'
      };
      font-weight: ${titleWeight};
    }

    .receipt-table-footer-cell {
      padding: ${
        is6cm
          ? '3px 2px'
          : '4px 3px'
      };
      color: #000000;
      background: #ffffff;
      text-align: center !important;
      font-size: ${smallFontSize};
      font-weight: ${bodyWeight};
      line-height: 1.3;
    }

    .receipt-signature-cell {
      height: 6mm;
      min-height: 6mm;
      color: #000000;
      background: #ffffff;
    }

    .receipt-contact-cell {
      direction: rtl;
      unicode-bidi: plaintext;
      color: ${GREEN_BORDER};
      background: ${GREEN_SOFT};
      text-align: center !important;
      font-weight: ${bodyWeight};
    }

    /*
     * فاصله خروج پایین داخل padding فیش است (نه بلوک جدا)
     */
    .receipt-print-root {
      display: block;
      width: 100%;
      margin: 0;
      padding: 0;
    }

    .receipt-feed {
      display: none !important;
    }

    .receipt-eject {
      display: ${printing ? 'block' : 'none'};
      width: 100%;
      height: ${THERMAL_FEED_MM}mm;
      min-height: ${THERMAL_FEED_MM}mm;
      margin: 0;
      padding: 0;
      background: #ffffff;
    }

    .receipt-cut-marker {
      display: none !important;
    }

    @media print {
      html,
      body {
        margin: 0 !important;
        padding: 0 !important;
        color: #000000 !important;
        background: #ffffff !important;
        overflow: visible !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }

      /*
       * نوشته‌ها مشکی و خوانا — وزن متوسط تا نقطه‌های حروف محو نشوند
       */
      .receipt-paper,
      .receipt-paper *,
      .receipt-frame,
      .receipt-frame *,
      .receipt-document-information,
      .receipt-document-information * {
        color: #000000 !important;
        opacity: 1 !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }

      .receipt-paper {
        border: 0 !important;
        filter: none !important;
        padding: ${paperPadding} !important;
        box-sizing: border-box !important;
        overflow: visible !important;
      }

      .receipt-eject {
        display: block !important;
        height: ${THERMAL_FEED_MM}mm !important;
        min-height: ${THERMAL_FEED_MM}mm !important;
      }

      .receipt-frame {
        border: 0 !important;
        padding: 0 ${sideInsetMm}mm 2.5mm !important;
        box-sizing: border-box !important;
        overflow: visible !important;
        filter: none !important;
      }

      .receipt-logo,
      .receipt-main-title {
        color: #000000 !important;
        font-weight: ${titleWeight} !important;
        text-shadow: none !important;
      }

      .receipt-company-slogan,
      .receipt-document-number,
      .receipt-document-date,
      .receipt-table th,
      .receipt-table td,
      .receipt-cell-text {
        color: #000000 !important;
        font-weight: ${bodyWeight} !important;
        text-shadow: none !important;
        line-height: 1.3 !important;
      }

      .receipt-table th[scope='row'],
      .receipt-row-highlight th,
      .receipt-row-highlight td {
        font-weight: ${titleWeight} !important;
      }

      /*
       * حذف تمام Borderهای اضافی سربرگ
       */
      .receipt-brand,
      .receipt-document-information,
      .receipt-document-header {
        border: 0 !important;
        border-top: 0 !important;
        border-bottom: 0 !important;
      }

      /*
       * در چاپ خط سبز به مشکی تبدیل می‌شود تا پررنگ باشد
       */
      .receipt-document-separator {
        border: 0 !important;
        border-top: 2px solid #000000 !important;
      }

      /*
       * جدول چاپی کاملاً مشکی و پررنگ
       */
      .receipt-table {
        width: 100% !important;
        max-width: 100% !important;
        border: 1px solid #000000 !important;
        border-left: 1px solid #000000 !important;
        border-collapse: separate !important;
        border-spacing: 0 !important;
        table-layout: fixed !important;
        overflow: visible !important;
        box-sizing: border-box !important;
      }

      .receipt-table th,
      .receipt-table td {
        color: #000000 !important;
        background: #ffffff !important;
        border: 1px solid #000000 !important;
        font-weight: ${bodyWeight} !important;
        overflow: visible !important;
        line-height: 1.3 !important;
      }

      .receipt-table th[scope='row'] {
        color: #000000 !important;
        background: #ffffff !important;
        font-weight: ${titleWeight} !important;
      }

      .receipt-row-highlight th,
      .receipt-row-highlight td {
        color: #000000 !important;
        background: #ffffff !important;
        border-top: 1px solid #000000 !important;
        border-bottom: 1px solid #000000 !important;
        font-weight: ${titleWeight} !important;
      }

      .receipt-table-footer-cell,
      .receipt-contact-cell {
        color: #000000 !important;
        background: #ffffff !important;
        font-weight: ${bodyWeight} !important;
      }

      .receipt-feed {
        display: none !important;
      }

      .receipt-cut-marker {
        display: none !important;
      }
    }
  `;
}

function installPageStyles(paperSize) {
  let style =
    document.getElementById(
      STYLE_ELEMENT_ID,
    );

  if (!style) {
    style =
      document.createElement('style');

    style.id = STYLE_ELEMENT_ID;

    document.head.appendChild(style);
  }

  style.textContent =
    getReceiptCss(paperSize, false);
}

function buildReceiptHtml({
  companyName,
  companySlogan,
  title,
  documentNumber,
  documentDate,
  rows,
  noteLabel,
  noteValue,
  receiptNote,
  signatureLabel,
  contactText,
}) {
  const rowsHtml = rows
    .map(
      (item) => `
        <tr class="${
          item.highlight
            ? 'receipt-row-highlight'
            : ''
        }">
          <th scope="row">
            <span class="receipt-cell-text">
              ${escapeHtml(item.label)}
            </span>
          </th>

          <td>
            <span class="receipt-cell-text ${
              item.ltr
                ? 'receipt-cell-ltr'
                : ''
            }">
              ${escapeHtml(item.value)}
            </span>
          </td>
        </tr>
      `,
    )
    .join('');

  const noteHtml = noteValue
    ? `
      <tr>
        <th scope="row">
          <span class="receipt-cell-text">
            ${escapeHtml(noteLabel)}
          </span>
        </th>

        <td>
          <span class="receipt-cell-text">
            ${escapeHtml(noteValue)}
          </span>
        </td>
      </tr>
    `
    : '';

  const receiptNoteHtml = receiptNote
    ? `
      <tr>
        <td
          colspan="2"
          class="receipt-table-footer-cell"
        >
          <span class="receipt-cell-text">
            ${escapeHtml(receiptNote)}
          </span>
        </td>
      </tr>
    `
    : '';

  const contactHtml = contactText
    ? `
      <tr>
        <td
          colspan="2"
          class="receipt-table-footer-cell receipt-contact-cell"
        >
          <span class="receipt-cell-text">
            ${escapeHtml(contactText)}
          </span>
        </td>
      </tr>
    `
    : '';

  return `
    <div class="receipt-print-root">
    <article class="receipt-paper">
      <div class="receipt-frame">
      <header class="receipt-brand">
        <div class="receipt-logo">
          ${escapeHtml(companyName)}
        </div>

        ${
          companySlogan
            ? `
              <p class="receipt-company-slogan">
                ${escapeHtml(companySlogan)}
              </p>
            `
            : ''
        }

        <div class="receipt-main-title">
          ${escapeHtml(title)}
        </div>
      </header>

      <section class="receipt-document-information">
        <div class="receipt-document-header">
          <div class="receipt-document-number">
            <span>نمبر سند:</span>

            <strong>
              ${escapeHtml(documentNumber)}
            </strong>
          </div>

          <div class="receipt-document-date">
            ${escapeHtml(documentDate)}
          </div>
        </div>

        <div class="receipt-document-separator"></div>
      </section>

      <table class="receipt-table">
        <colgroup>
          <col class="receipt-label-column" />
          <col class="receipt-value-column" />
        </colgroup>

        <tbody>
          ${rowsHtml}
          ${noteHtml}
          ${receiptNoteHtml}

          <tr>
            <th scope="row">
              <span class="receipt-cell-text">
                ${escapeHtml(signatureLabel)}
              </span>
            </th>

            <td class="receipt-signature-cell">
              &nbsp;
            </td>
          </tr>

          ${contactHtml}
        </tbody>
      </table>
      <div class="receipt-eject" aria-hidden="true"></div>
      </div>
    </article>

    <div
      class="receipt-feed"
      aria-hidden="true"
    ></div>
    </div>
  `;
}

export default function ReceiptPage() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const { show } = useToast();
  const { hasPermission } = useAuth();

  const navigate = useNavigate();
  const paperRef = useRef(null);
  const printingRef = useRef(false);

  const [row, setRow] =
    useState(null);

  const [settings, setSettings] =
    useState({});

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState('');

  const [paperSize, setPaperSize] =
    useState(readPaperSize);

  const load = async () => {
    setLoading(true);

    try {
      const [
        transactionResponse,
        settingsResponse,
      ] = await Promise.all([
        api.get(`/transactions/${id}`),

        api
          .get('/settings')
          .catch(() => ({
            data: {
              data: {},
            },
          })),
      ]);

      setRow(
        transactionResponse.data.data,
      );

      setSettings(
        settingsResponse.data.data || {},
      );

      setError('');
    } catch (requestError) {
      setError(
        messageOf(requestError),
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [id]);

  useEffect(() => {
    try {
      localStorage.setItem(
        PAPER_STORAGE_KEY,
        paperSize,
      );
    } catch {
      // LocalStorage در دسترس نیست
    }

    installPageStyles(paperSize);

    document.documentElement.setAttribute(
      'data-receipt-paper',
      paperSize,
    );

    return () => {
      document.documentElement.removeAttribute(
        'data-receipt-paper',
      );
    };
  }, [paperSize]);

  const reverse = async () => {
    const confirmed =
      window.confirm(
        `${t('reverse')}?`,
      );

    if (!confirmed) {
      return;
    }

    try {
      await api.post(
        `/transactions/${id}/reverse`,
      );

      show(t('success'));

      await load();
    } catch (requestError) {
      show(
        messageOf(requestError),
        'error',
      );
    }
  };

  /*
   * نمبر سند و تاریخ خارج از جدول هستند.
   */
  const tableRows = useMemo(() => {
    if (!row) {
      return [];
    }

    return [
      {
        id: 'customer',
        label: t('customer'),
        value: textValue(
          translatePersonName(
            t,
            row.customer?.name,
          ),
        ),
      },

      {
        id: 'branch',
        label: t('branch'),
        value: textValue(
          translatePlace(
            t,
            row.branch?.name,
          ),
        ),
      },

      {
        id: 'kind',
        label: t('transactionType'),
        value: textValue(
          translateKind(
            t,
            row.kind,
          ),
        ),
      },

      {
        id: 'received',
        label: t('received'),
        value: `${money(
          row.fromAmount,
        )} ${
          row.fromCurrency?.code || ''
        }`.trim(),
        ltr: true,
        highlight: true,
      },

      {
        id: 'paid',
        label: t('paid'),
        value: `${money(
          row.toAmount,
        )} ${
          row.toCurrency?.code || ''
        }`.trim(),
        ltr: true,
        highlight: true,
      },
    ];
  }, [row, t, i18n.language]);

  const getReceiptValues = () => {
    const companyName = textValue(
      localizeCompanyField(
        t,
        'company_name',
        settings.company_name,
      ),
    );

    const companySlogan =
      localizeCompanyField(
        t,
        'company_slogan',
        settings.company_slogan,
      ) || '';

    const receiptNote =
      localizeCompanyField(
        t,
        'receipt_note',
        settings.receipt_note,
      ) || '';

    const companyAddress =
      localizeCompanyField(
        t,
        'company_address',
        settings.company_address,
      ) || '';

    const companyPhone =
      settings.company_phone || '';

    const contactText = [
      companyPhone,
      companyAddress,
    ]
      .filter(Boolean)
      .join(' • ');

    const noteValue =
      row?.note
        ? textValue(
            localizeNote(
              t,
              row.note,
            ),
          )
        : '';

    return {
      companyName,
      companySlogan,
      receiptNote,
      contactText,
      noteValue,
    };
  };

  const handlePrint = async () => {
    if (!row || printingRef.current) {
      return;
    }

    printingRef.current = true;

    try {
    const config =
      PAGE_CONFIG[paperSize] ||
      PAGE_CONFIG['8cm'];

    document
      .getElementById(
        PRINT_FRAME_ID,
      )
      ?.remove();

    const {
      companyName,
      companySlogan,
      receiptNote,
      contactText,
      noteValue,
    } = getReceiptValues();

    const receiptHtml =
      buildReceiptHtml({
        companyName,
        companySlogan,

        title: t(
          'transactionReceipt',
        ),

        documentNumber:
          textValue(row.number),

        documentDate:
          textValue(
            dateTime(row.createdAt),
          ),

        rows: tableRows,

        noteLabel: t('note'),
        noteValue,
        receiptNote,

        signatureLabel:
          t('signature'),

        contactText,
      });

    const language =
      document.documentElement.lang ||
      i18n.language ||
      'fa';

    const paperWidthMm =
      config.paperWidthMm;

    const sideInsetMm =
      config.sideInsetMm || 2.5;

    const outerGapLeftMm =
      config.outerGapLeftMm ||
      config.outerGapMm ||
      8;

    const outerGapRightMm =
      config.outerGapRightMm ||
      config.outerGapMm ||
      6;

    const paperPadding = `0 ${outerGapRightMm}mm 2mm ${outerGapLeftMm}mm`;

    const iframe =
      document.createElement(
        'iframe',
      );

    iframe.id =
      PRINT_FRAME_ID;

    iframe.setAttribute(
      'aria-hidden',
      'true',
    );

    iframe.style.cssText = `
      position: fixed;
      left: -12000px;
      top: 0;
      width: ${paperWidthMm}mm;
      height: 1px;
      border: 0;
      opacity: 0;
      pointer-events: none;
    `;

    document.body.appendChild(
      iframe,
    );

    const printWindow =
      iframe.contentWindow;

    const printDocument =
      iframe.contentDocument ||
      printWindow?.document;

    if (
      !printWindow ||
      !printDocument
    ) {
      iframe.remove();
      printingRef.current = false;

      show(
        t('error'),
        'error',
      );

      return;
    }

    printDocument.open();

    printDocument.write(`
      <!doctype html>

      <html
        lang="${language}"
        dir="rtl"
        data-receipt-paper="${paperSize}"
      >
        <head>
          <meta charset="utf-8" />

          <meta
            name="viewport"
            content="width=device-width, initial-scale=1"
          />

          <title>
            ${escapeHtml(
              t('transactionReceipt'),
            )}
          </title>

          <style id="thermal-print-style">
            ${getReceiptCss(
              paperSize,
              true,
            )}

            html,
            body {
              width: ${paperWidthMm}mm !important;
              min-width: ${paperWidthMm}mm !important;
              max-width: ${paperWidthMm}mm !important;

              height: auto !important;
              min-height: 0 !important;

              margin: 0 !important;
              padding: 0 !important;
              padding-top: 0 !important;
              margin-top: 0 !important;

              color: #000000 !important;
              background: #ffffff !important;

              overflow: visible !important;
              box-sizing: border-box !important;
              direction: rtl !important;

              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }

            .receipt-print-root {
              display: block !important;
              width: 100% !important;
              margin: 0 !important;
              padding: 0 !important;
            }

            .receipt-paper,
            .receipt-feed {
              width: 100% !important;
              min-width: 0 !important;
              max-width: 100% !important;
              margin: 0 !important;
              margin-top: 0 !important;
            }

            /*
             * فاصله امن چاپگر — چپ بیشتر چون XP لبه چپ را می‌بُرد.
             */
            .receipt-paper {
              padding: ${paperPadding} !important;
              padding-top: 0 !important;
              color: #000000 !important;
              background: #ffffff !important;
              border: 0 !important;
              border-radius: 0 !important;
              box-shadow: none !important;
              overflow: visible !important;
              filter: none !important;
              box-sizing: border-box !important;
            }

            .receipt-eject {
              display: block !important;
              width: 100% !important;
              height: ${THERMAL_FEED_MM}mm !important;
              min-height: ${THERMAL_FEED_MM}mm !important;
              margin: 0 !important;
              padding: 0 !important;
              background: #ffffff !important;
            }

            .receipt-feed,
            .receipt-cut-marker {
              display: none !important;
            }

            .receipt-frame {
              width: 100% !important;
              margin: 0 !important;
              margin-top: 0 !important;
              padding: 0 ${sideInsetMm}mm 2.5mm !important;
              padding-top: 0 !important;
              color: #000000 !important;
              background: #ffffff !important;
              border: 0 !important;
              border-radius: 0 !important;
              box-sizing: border-box !important;
              overflow: visible !important;
              filter: none !important;
            }

            .receipt-brand {
              margin-top: 0 !important;
              padding-top: 0 !important;
            }

            .receipt-logo {
              margin-top: 0 !important;
              padding-top: 0 !important;
            }

            .receipt-brand,
            .receipt-main-title,
            .receipt-document-information,
            .receipt-table {
              width: 100% !important;
              max-width: 100% !important;
              margin-left: 0 !important;
              margin-right: 0 !important;
              box-sizing: border-box !important;
            }

            .receipt-table th,
            .receipt-table td {
              padding-left: 4px !important;
              padding-right: 4px !important;
            }

            /*
             * نوشته‌ها مشکی و واضح — بدون وزن خیلی زیاد تا نقطه‌ها بمانند.
             */
            .receipt-paper,
            .receipt-paper *,
            .receipt-document-information,
            .receipt-document-information * {
              color: #000000 !important;
              opacity: 1 !important;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }

            .receipt-logo,
            .receipt-main-title {
              color: #000000 !important;
              font-weight: 800 !important;
              text-shadow: none !important;
            }

            .receipt-company-slogan,
            .receipt-document-number,
            .receipt-document-date,
            .receipt-table th,
            .receipt-table td,
            .receipt-cell-text {
              color: #000000 !important;
              font-weight: 700 !important;
              text-shadow: none !important;
              line-height: 1.3 !important;
            }

            /*
             * حذف Borderهای اضافی بالای فیش.
             */
            .receipt-brand,
            .receipt-document-information,
            .receipt-document-header {
              border: 0 !important;
              border-top: 0 !important;
              border-bottom: 0 !important;
            }

            /*
             * خط زیر نمبر سند و تاریخ در چاپ مشکی است.
             */
            .receipt-document-separator {
              border: 0 !important;
              border-top: 2px solid #000000 !important;
            }

            /*
             * Border بیرونی جدول.
             */
            .receipt-table {
              width: 100% !important;
              max-width: 100% !important;

              border: 1px solid #000000 !important;
              border-left: 1px solid #000000 !important;
              border-collapse: separate !important;
              border-spacing: 0 !important;
              table-layout: fixed !important;
              overflow: visible !important;
              box-sizing: border-box !important;
            }

            /*
             * Border تمام خانه‌ها.
             */
            .receipt-table th,
            .receipt-table td {
              color: #000000 !important;
              background: #ffffff !important;

              border-top: 1px solid #000000 !important;
              border-right: 1px solid #000000 !important;
              border-bottom: 1px solid #000000 !important;
              border-left: 1px solid #000000 !important;

              font-weight: 700 !important;
              overflow: visible !important;
            }

            .receipt-table th[scope='row'] {
              color: #000000 !important;
              background: #ffffff !important;
              font-weight: 800 !important;
            }

            .receipt-row-highlight th,
            .receipt-row-highlight td {
              color: #000000 !important;
              background: #ffffff !important;

              border-top: 1px solid #000000 !important;
              border-bottom: 1px solid #000000 !important;

              font-weight: 800 !important;
            }

            .receipt-table-footer-cell,
            .receipt-contact-cell {
              color: #000000 !important;
              background: #ffffff !important;
              font-weight: 700 !important;
            }

            .receipt-feed {
              display: none !important;
            }

            .receipt-cut-marker {
              display: none !important;
            }
          </style>
        </head>

        <body>
          ${receiptHtml}
        </body>
      </html>
    `);

    printDocument.close();

    try {
      if (
        printDocument.fonts?.ready
      ) {
        await printDocument.fonts.ready;
      }
    } catch {
      // استفاده از Tahoma
    }

    await wait(500);

    /*
     * فقط ارتفاع محتوای فیش را اندازه بگیر — نه ارتفاع iframe/body
     * (قبلاً ارتفاع ۴۰۰۰px باعث چاپ چندصفحه‌ای / کاغذ زیاد می‌شد)
     */
    const printRoot =
      printDocument.querySelector(
        '.receipt-print-root',
      );

    const paperEl =
      printDocument.querySelector(
        '.receipt-paper',
      );

    const measuredHeightPx =
      Math.max(
        paperEl?.scrollHeight || 0,
        paperEl?.offsetHeight || 0,
        printRoot?.scrollHeight || 0,
        printRoot?.offsetHeight || 0,
      );

    const pageHeightMm = Math.min(
      320,
      Math.max(
        40,
        Math.ceil(
          measuredHeightPx /
            CSS_PIXELS_PER_MM,
        ) +
          PRINT_HEIGHT_BUFFER_MM,
      ),
    );

    iframe.style.height = `${Math.ceil(measuredHeightPx) + 40}px`;

    const printStyle =
      printDocument.getElementById(
        'thermal-print-style',
      );

    if (printStyle) {
      printStyle.textContent = `
        @page {
          size: ${paperWidthMm}mm ${pageHeightMm}mm;
          margin: 0 !important;
        }

        html,
        body {
          width: ${paperWidthMm}mm !important;
          height: auto !important;
          min-height: 0 !important;
          max-height: none !important;
          margin: 0 !important;
          padding: 0 !important;
          overflow: visible !important;
        }

        .receipt-print-root,
        .receipt-paper {
          width: ${paperWidthMm}mm !important;
          height: auto !important;
          page-break-after: avoid !important;
          page-break-inside: avoid !important;
          break-after: avoid !important;
          break-inside: avoid-page !important;
        }

        .receipt-eject {
          display: block !important;
          height: ${THERMAL_FEED_MM}mm !important;
          min-height: ${THERMAL_FEED_MM}mm !important;
          page-break-before: avoid !important;
          break-before: avoid !important;
        }

        .receipt-feed,
        .receipt-cut-marker {
          display: none !important;
        }

        .receipt-frame,
        .receipt-table {
          page-break-inside: avoid !important;
          break-inside: avoid-page !important;
        }

        ${getReceiptCss(paperSize, true)}

        .receipt-eject {
          display: block !important;
          height: ${THERMAL_FEED_MM}mm !important;
          min-height: ${THERMAL_FEED_MM}mm !important;
        }
      `;
    }

    await wait(300);

    let removed = false;

    const cleanup = () => {
      if (removed) {
        return;
      }

      removed = true;
      printingRef.current = false;

      window.setTimeout(() => {
        iframe.remove();
      }, 1500);
    };

    printWindow.onafterprint =
      cleanup;

    printWindow.focus();
    printWindow.print();

    window.setTimeout(
      cleanup,
      15000,
    );
    } catch {
      printingRef.current = false;
      show(t('error'), 'error');
    }
  };

  if (loading) {
    return <Loading />;
  }

  if (error) {
    return (
      <ErrorBox
        message={error}
      />
    );
  }

  if (!row) {
    return (
      <ErrorBox
        message={t('notFound')}
      />
    );
  }

  const {
    companyName,
    companySlogan,
    receiptNote,
    contactText,
  } = getReceiptValues();

  return (
    <div className="receipt-page">
      <div className="receipt-actions no-print">
        <button
          type="button"
          className="btn soft"
          onClick={() =>
            navigate(-1)
          }
        >
          <ArrowLeft size={17} />
          {t('back')}
        </button>

        <label className="receipt-paper-picker">
          <span>
            {t('paperSize')}
          </span>

          <select
            value={paperSize}
            onChange={(event) => {
              setPaperSize(
                event.target.value,
              );
            }}
          >
            <option value="6cm">
              {t('paper6cm')}
            </option>

            <option value="8cm">
              {t('paper8cm')}
            </option>
          </select>
        </label>

        <button
          type="button"
          className="btn soft"
          onClick={handlePrint}
        >
          <Printer size={17} />
          {t('print')}
        </button>

        {hasPermission('reports') &&
          row.state !==
            'برگشت داده شد' && (
            <button
              type="button"
              className="btn danger"
              onClick={reverse}
            >
              <RotateCcw size={17} />
              {t('reverse')}
            </button>
          )}
      </div>

      <article
        ref={paperRef}
        className={`receipt-paper receipt-size-${paperSize}`}
        aria-label={t(
          'transactionReceipt',
        )}
      >
        <div className="receipt-frame">
        <header className="receipt-brand">
          <div className="receipt-logo">
            {companyName}
          </div>

          {companySlogan ? (
            <p className="receipt-company-slogan">
              {companySlogan}
            </p>
          ) : null}

          <div className="receipt-main-title">
            {t(
              'transactionReceipt',
            )}
          </div>
        </header>

        <section className="receipt-document-information">
          <div className="receipt-document-header">
            <div className="receipt-document-number">
              <span>
                نمبر سند:
              </span>

              <strong>
                {textValue(
                  row.number,
                )}
              </strong>
            </div>

            <div className="receipt-document-date">
              {textValue(
                dateTime(
                  row.createdAt,
                ),
              )}
            </div>
          </div>

          <div className="receipt-document-separator" />
        </section>

        <table className="receipt-table">
          <colgroup>
            <col className="receipt-label-column" />
            <col className="receipt-value-column" />
          </colgroup>

          <tbody>
            {tableRows.map(
              (item) => (
                <tr
                  key={item.id}
                  className={
                    item.highlight
                      ? 'receipt-row-highlight'
                      : undefined
                  }
                >
                  <th scope="row">
                    <span className="receipt-cell-text">
                      {item.label}
                    </span>
                  </th>

                  <td>
                    <span
                      className={`receipt-cell-text ${
                        item.ltr
                          ? 'receipt-cell-ltr'
                          : ''
                      }`.trim()}
                    >
                      {item.value}
                    </span>
                  </td>
                </tr>
              ),
            )}

            {row.note ? (
              <tr>
                <th scope="row">
                  <span className="receipt-cell-text">
                    {t('note')}
                  </span>
                </th>

                <td>
                  <span className="receipt-cell-text">
                    {textValue(
                      localizeNote(
                        t,
                        row.note,
                      ),
                    )}
                  </span>
                </td>
              </tr>
            ) : null}

            {receiptNote ? (
              <tr>
                <td
                  colSpan={2}
                  className="receipt-table-footer-cell"
                >
                  <span className="receipt-cell-text">
                    {receiptNote}
                  </span>
                </td>
              </tr>
            ) : null}

            <tr>
              <th scope="row">
                <span className="receipt-cell-text">
                  {t('signature')}
                </span>
              </th>

              <td className="receipt-signature-cell">
                &nbsp;
              </td>
            </tr>

            {contactText ? (
              <tr>
                <td
                  colSpan={2}
                  className="receipt-table-footer-cell receipt-contact-cell"
                >
                  <span className="receipt-cell-text">
                    {contactText}
                  </span>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        </div>
      </article>
    </div>
  );
}