import { useEffect, useRef, useState } from 'react';
import {
  CreditCard, Fingerprint, Link2, Pencil, Printer, Trash2, CheckCircle2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api, messageOf } from '../api/client.js';
import {
  ErrorBox,
  Field,
  Loading,
  Modal,
  PageHeader,
  Pagination,
  SearchBox,
  Table,
} from '../components/Common.jsx';
import DateInput from '../components/DateInput.jsx';
import UserAvatar from '../components/UserAvatar.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useDeleteConfirm } from '../components/ConfirmDelete.jsx';
import { dateTime, money } from '../utils/format.js';
import { localizeCurrency, translatePlace } from '../utils/labels.js';
import { mediaUrl } from '../utils/mediaUrl.js';
import { captureFingerprintBlob, newFingerprintSeed, fingerSeedFromPointerEvent } from '../utils/fingerprintDevice.js';
import { printCardReaderSlip } from '../utils/printCardReaderSlip.js';
import {
  zkHealth,
  zkSyncTemplates,
  zkIdentify,
  zkEnroll,
  zkFingerprintImageToFile,
} from '../utils/zktecoDevice.js';

const FP_DEVICE_KEY = 'zarin-fp-device-enrollments-v7';
const FP_LAST_SEED_KEY = 'zarin-fp-last-seed-v7';
const PAD_COLS = 3;
const PAD_ROWS = 3;

const emptyForm = {
  customerId: '',
  customerName: '',
  phone: '',
  documentNumber: '',
  cardNumber: '',
  bankName: '',
  cardHolderName: '',
  kind: 'withdrawal',
  amount: '', // مبلغ کارت (جمع کارت‌های من در برداشت)
  currencyId: '', // ارز کارت
  cashAmount: '', // مبلغ نقد به مشتری (فقط برداشت)
  cashCurrencyId: '', // ارز نقد
  fee: '',
  receiveCashboxId: '', // کارت من (واریز)
  payCashboxId: '', // صندوق نقد
  cardTransfers: [{ cashboxId: '', amount: '' }], // برداشت: چند کارت من
  note: '',
  fingerprintConfirmed: false,
};

function loadDeviceEnrollments() {
  try {
    const raw = localStorage.getItem(FP_DEVICE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return [];
    // Drop empty templates that caused blank "identified" popups
    return list.filter((x) => x?.seed && (x.customerId || String(x.customerName || '').trim()));
  } catch {
    return [];
  }
}

function getLastFingerprintSeed() {
  try {
    return localStorage.getItem(FP_LAST_SEED_KEY) || '';
  } catch {
    return '';
  }
}

function setLastFingerprintSeed(seed) {
  try {
    if (seed) localStorage.setItem(FP_LAST_SEED_KEY, String(seed));
  } catch {
    /* ignore */
  }
}

function saveDeviceEnrollment(entry) {
  if (!entry?.seed) return;
  const claimedSlots = new Set(
    (Array.isArray(entry.slots) ? entry.slots : (entry.slot ? [entry.slot] : [])).filter(Boolean),
  );
  // One pad spot = one fingerprint only (never shared across customers)
  let list = loadDeviceEnrollments().map((x) => {
    if (String(x.seed) === String(entry.seed)) return x;
    if (!claimedSlots.size) return x;
    const slots = (x.slots || []).filter((s) => !claimedSlots.has(s));
    return { ...x, slots, slot: slots.includes(x.slot) ? x.slot : (slots[0] || null) };
  }).filter((x) => {
    if (String(x.seed) === String(entry.seed)) return false;
    if (entry.customerId && x.customerId && String(x.customerId) === String(entry.customerId)) return false;
    return true;
  });
  const slots = [...claimedSlots];
  list.unshift({ ...entry, slots, slot: entry.slot || slots[0] || null });
  localStorage.setItem(FP_DEVICE_KEY, JSON.stringify(list.slice(0, 200)));
  setLastFingerprintSeed(entry.seed);
}

function findLocalEnrollment(seed) {
  if (!seed) return null;
  return loadDeviceEnrollments().find((x) => String(x.seed) === String(seed)) || null;
}

function findLocalByCustomerOrCard({ customerId, cardNumber } = {}) {
  const list = loadDeviceEnrollments();
  if (customerId) {
    const byCustomer = list.find((x) => x.customerId && String(x.customerId) === String(customerId));
    if (byCustomer) return byCustomer;
  }
  if (cardNumber) {
    const byCard = list.find((x) => x.cardNumber && String(x.cardNumber) === String(cardNumber).trim());
    if (byCard) return byCard;
  }
  return null;
}

/** Exact pad zone → exactly one enrolled fingerprint (never a list of people). */
function findLocalBySlot(slot) {
  if (!slot) return null;
  const matches = loadDeviceEnrollments().filter((x) => Array.isArray(x.slots) && x.slots.includes(slot) && x.seed);
  return matches.length === 1 ? matches[0] : null;
}

function syncEnrollmentFromIdentity(identity, extra = {}) {
  if (!identity?.fingerprintSeed && !extra.seed) return;
  const seed = identity.fingerprintSeed || extra.seed;
  const existing = findLocalEnrollment(seed) || findLocalByCustomerOrCard({
    customerId: identity.customerId,
    cardNumber: identity.cardNumber,
  });
  const slots = [
    ...new Set([
      ...(existing?.slots || []),
      ...(Array.isArray(extra.slots) ? extra.slots : []),
      extra.slot,
    ].filter(Boolean)),
  ];
  saveDeviceEnrollment({
    seed,
    slots,
    slot: extra.slot || existing?.slot || slots[0] || null,
    customerId: identity.customerId || existing?.customerId || null,
    customerName: identity.customerName || existing?.customerName || '',
    phone: identity.phone || existing?.phone || '',
    documentNumber: identity.documentNumber || existing?.documentNumber || '',
    cardNumber: identity.cardNumber || existing?.cardNumber || '',
    bankName: identity.bankName || existing?.bankName || '',
    cardHolderName: identity.cardHolderName || existing?.cardHolderName || '',
    photoUrl: (() => {
      const p = identity.photoUrl || existing?.photoUrl || null;
      const f = identity.fingerprintUrl || existing?.fingerprintUrl || null;
      return p && p !== f ? p : null;
    })(),
    fingerprintUrl: identity.fingerprintUrl || existing?.fingerprintUrl || null,
    balances: identity.balances || existing?.balances || [],
  });
}

/** Pick next free pad slot so rematch works after refresh without showing all customers. */
function allocatePadSlot(preferred = null) {
  const used = new Set();
  for (const e of loadDeviceEnrollments()) {
    for (const s of e.slots || []) used.add(s);
  }
  if (preferred && !used.has(preferred)) return preferred;
  for (let y = 0; y < PAD_ROWS; y += 1) {
    for (let x = 0; x < PAD_COLS; x += 1) {
      const slot = `pad-${x}-${y}`;
      if (!used.has(slot)) return slot;
    }
  }
  return preferred || 'pad-0-0';
}

function isRealCustomerIdentity(identity) {
  if (!identity) return false;
  if (identity.customerId) return true;
  const name = String(identity.customerName || '').trim();
  return Boolean(name);
}

function Thumb({ url, alt, className = '' }) {
  const src = mediaUrl(url);
  if (!src) return <span className="muted-hint">—</span>;
  return (
    <a href={src} target="_blank" rel="noreferrer" className={`card-reader-thumb ${className}`}>
      <img src={src} alt={alt || ''} />
    </a>
  );
}

function kindLabel(t, kind) {
  if (kind === 'withdrawal') return t('cardWithdrawal');
  if (kind === 'deposit') return t('cardDeposit');
  return t('cardNote');
}

export default function CardReaderPage() {
  const { t } = useTranslation();
  const { show } = useToast();
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [lookups, setLookups] = useState({ currencies: [], cashboxes: [], customers: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ dateFrom: '', dateTo: '' });
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState('');
  const [fingerFile, setFingerFile] = useState(null);
  const [fingerPreview, setFingerPreview] = useState('');
  const [fingerSeed, setFingerSeed] = useState('');
  const [fingerStatus, setFingerStatus] = useState('idle');
  const [identifiedName, setIdentifiedName] = useState('');
  const [deviceConnected, setDeviceConnected] = useState(false);
  const [deviceBusy, setDeviceBusy] = useState(false);
  const [lastReceipt, setLastReceipt] = useState(null);
  const [companySettings, setCompanySettings] = useState({});
  const [matchedIdentity, setMatchedIdentity] = useState(null);
  const [identifiedProfile, setIdentifiedProfile] = useState(null);
  const [cardBalances, setCardBalances] = useState([]);
  const [cardLookupBusy, setCardLookupBusy] = useState(false);
  const [lastPadSlot, setLastPadSlot] = useState('');
  const [realFingerprintTemplate, setRealFingerprintTemplate] = useState('');
  const [realFingerprintFormat, setRealFingerprintFormat] = useState('ZK10');
  const fingerHoldRef = useRef({
    active: false,
    timer: null,
    mode: 'identify',
    completing: false,
    startedAt: 0,
    padSlot: '',
  });
  // Survives React state timing so submit always has the latest scan
  const fingerCaptureRef = useRef({ file: null, seed: '', padSlot: '', template: '', format: 'ZK10' });
  const cardLookupTimerRef = useRef(null);
  const FINGER_HOLD_MS = 280;

  const withTimeout = (promise, ms = 4000) => Promise.race([
    promise,
    new Promise((_, reject) => {
      const err = new Error('timeout');
      err.code = 'TIMEOUT';
      setTimeout(() => reject(err), ms);
    }),
  ]);

  const { askDelete, dialog: deleteDialog } = useDeleteConfirm({
    onDeleted: () => {
      show(t('success'));
      load({ syncFingerprints: false });
    },
    translateLabel: (row) => row.customerName || row.customer?.name || `#${row.id}`,
  });

  const revokeIfBlob = (url) => {
    if (url && url.startsWith('blob:')) URL.revokeObjectURL(url);
  };

  const clearMediaPick = () => {
    revokeIfBlob(photoPreview);
    revokeIfBlob(fingerPreview);
    setPhotoFile(null);
    setPhotoPreview('');
    setFingerFile(null);
    setFingerPreview('');
    setFingerSeed('');
    fingerCaptureRef.current = { file: null, seed: '', padSlot: fingerCaptureRef.current.padSlot || '' };
    setFingerStatus('idle');
    setIdentifiedName('');
    setMatchedIdentity(null);
    setIdentifiedProfile(null);
    setCardBalances([]);
    setRealFingerprintTemplate('');
    setRealFingerprintFormat('ZK10');
  };

  const commitFingerCapture = (file, seed, preview, padSlot = '') => {
    fingerCaptureRef.current = {
      file: file || null,
      seed: seed ? String(seed) : '',
      padSlot: padSlot || fingerCaptureRef.current.padSlot || '',
    };
    if (preview != null) setFingerPreview(preview);
    setFingerFile(file || null);
    setFingerSeed(seed ? String(seed) : '');
    if (padSlot) setLastPadSlot(padSlot);
  };

  const resetForm = () => {
    clearMediaPick();
    setEditing(null);
    setForm({ ...emptyForm });
  };


  const syncRealFingerprintTemplates = async () => {
    try {
      const health = await zkHealth();
      if (!health?.ok) {
        setDeviceConnected(false);
        return false;
      }

      setDeviceConnected(true);

      const { data: enr } = await api.get('/card-reader/fingerprint-enrollments');
      const remote = Array.isArray(enr.data) ? enr.data : [];
      await zkSyncTemplates(remote);
      return true;
    } catch {
      setDeviceConnected(false);
      return false;
    }
  };

  const load = async ({ syncFingerprints = false, soft = false } = {}) => {
    if (!soft) setLoading(true);
    try {
      const [listRes, lookupsRes, settingsRes] = await Promise.all([
        api.get('/card-reader', {
          params: {
            search,
            page,
            limit: 20,
            dateFrom: filters.dateFrom || undefined,
            dateTo: filters.dateTo || undefined,
          },
        }),
        api.get('/lookups'),
        api.get('/settings').catch(() => null),
      ]);
      setRows(listRes.data.data.rows || []);
      setPagination(listRes.data.data.pagination);
      setLookups(lookupsRes.data.data);
      if (settingsRes?.data?.data) setCompanySettings(settingsRes.data.data);
      setError('');

      // Heavy fingerprint sync only on first open — never on every save (that froze the UI)
      if (syncFingerprints) {
        try {
          const { data: enr } = await api.get('/card-reader/fingerprint-enrollments');
          const remote = Array.isArray(enr.data) ? enr.data : [];
          const merged = [];
          const seen = new Set();
          const usedSlots = new Set();

          const takeFreeSlot = (preferred) => {
            if (preferred && !usedSlots.has(preferred)) {
              usedSlots.add(preferred);
              return preferred;
            }
            for (let y = 0; y < PAD_ROWS; y += 1) {
              for (let x = 0; x < PAD_COLS; x += 1) {
                const slot = `pad-${x}-${y}`;
                if (!usedSlots.has(slot)) {
                  usedSlots.add(slot);
                  return slot;
                }
              }
            }
            const fallback = preferred || `pad-0-0`;
            usedSlots.add(fallback);
            return fallback;
          };

          for (const id of remote) {
            const seed = id?.fingerprintSeed || id?.seed;
            if (!seed || seen.has(String(seed))) continue;
            if (!id.customerId && !String(id.customerName || '').trim()) continue;
            seen.add(String(seed));
            const existing = findLocalEnrollment(seed);
            const kept = (Array.isArray(existing?.slots) ? existing.slots : []).filter(Boolean);
            kept.forEach((s) => usedSlots.add(s));
            const slots = kept.length ? kept : [takeFreeSlot(existing?.slot || null)];
            merged.push({
              seed,
              slots,
              slot: existing?.slot && slots.includes(existing.slot) ? existing.slot : slots[0],
              customerId: id.customerId || existing?.customerId || null,
              customerName: id.customerName || existing?.customerName || '',
              phone: id.phone || existing?.phone || '',
              documentNumber: id.documentNumber || existing?.documentNumber || '',
              cardNumber: id.cardNumber || existing?.cardNumber || '',
              bankName: id.bankName || existing?.bankName || '',
              cardHolderName: id.cardHolderName || existing?.cardHolderName || '',
              photoUrl: (() => {
                const p = id.photoUrl || existing?.photoUrl || null;
                const f = id.fingerprintUrl || existing?.fingerprintUrl || null;
                return p && p !== f ? p : null;
              })(),
              fingerprintUrl: id.fingerprintUrl || existing?.fingerprintUrl || null,
              fingerprintHash: id.fingerprintHash || existing?.fingerprintHash || null,
              balances: id.balances || existing?.balances || [],
            });
          }
          for (const local of loadDeviceEnrollments()) {
            if (!local?.seed || seen.has(String(local.seed))) continue;
            if (!local.customerId && !String(local.customerName || '').trim()) continue;
            const kept = (local.slots || []).filter(Boolean);
            kept.forEach((s) => usedSlots.add(s));
            const slots = kept.length ? kept : [takeFreeSlot(local.slot || null)];
            merged.push({ ...local, slots, slot: slots.includes(local.slot) ? local.slot : slots[0] });
          }
          localStorage.setItem(FP_DEVICE_KEY, JSON.stringify(merged.slice(0, 200)));
          // Also load real ZKTeco templates into the local matcher.
          syncRealFingerprintTemplates().catch(() => {});
        } catch {
          /* local enrollments only */
        }
      }
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => load({ syncFingerprints: true }), 200);
    return () => clearTimeout(timer);
  }, [search, page, filters.dateFrom, filters.dateTo]);

  useEffect(() => {
    let timer = null;
    const h = () => {
      if (timer) clearTimeout(timer);
      // Debounce socket reloads so save → emit → reload does not freeze the page
      timer = setTimeout(() => load({ syncFingerprints: false, soft: true }), 400);
    };
    window.addEventListener('zarin:card-reader:changed', h);
    window.addEventListener('zarin:balances:changed', h);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener('zarin:card-reader:changed', h);
      window.removeEventListener('zarin:balances:changed', h);
    };
  }, [search, page, filters]);

  useEffect(() => () => {
    revokeIfBlob(photoPreview);
    revokeIfBlob(fingerPreview);
  }, [photoPreview, fingerPreview]);

  const openEdit = (r) => {
    clearMediaPick();
    setEditing(r);
    const boxId = r.cashboxId ? String(r.cashboxId) : '';
    const receiveId = r.receiveCashboxId ? String(r.receiveCashboxId) : boxId;
    const payId = r.payCashboxId ? String(r.payCashboxId) : boxId;
    const transfers = Array.isArray(r.cardTransfers) && r.cardTransfers.length
      ? r.cardTransfers.map((row) => ({
        cashboxId: row.cashboxId ? String(row.cashboxId) : '',
        amount: row.amount != null ? String(row.amount) : '',
      }))
      : [{ cashboxId: receiveId, amount: r.amount != null ? String(r.amount) : '' }];
    setForm({
      customerId: r.customerId ? String(r.customerId) : '',
      customerName: r.customerName || r.customer?.name || '',
      phone: r.phone || r.customer?.phone || '',
      documentNumber: r.documentNumber || r.customer?.documentNumber || '',
      cardNumber: r.cardNumber || '',
      bankName: r.bankName || '',
      cardHolderName: r.cardHolderName || '',
      kind: r.kind === 'withdrawal' ? 'withdrawal' : 'deposit',
      amount: r.amount != null ? String(r.amount) : '',
      fee: r.fee != null ? String(r.fee) : '',
      currencyId: r.currencyId ? String(r.currencyId) : '',
      cashAmount: r.cashAmount != null ? String(r.cashAmount) : '',
      cashCurrencyId: r.cashCurrencyId ? String(r.cashCurrencyId) : '',
      receiveCashboxId: receiveId,
      payCashboxId: payId,
      cardTransfers: transfers,
      note: r.note || '',
      fingerprintConfirmed: Boolean(r.fingerprintConfirmed),
    });
    setPhotoPreview(r.photoUrl || r.customer?.avatarUrl || '');
    setFingerPreview(r.fingerprintUrl || '');
    setFingerSeed(r.fingerprintSeed || r.customer?.fingerprintSeed || '');
    setFingerStatus(r.fingerprintConfirmed ? 'matched' : 'idle');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const onPhotoChange = (e) => {
    const file = e.target.files?.[0] || null;
    setPhotoFile(file);
    revokeIfBlob(photoPreview);
    setPhotoPreview(file ? URL.createObjectURL(file) : (editing?.photoUrl || ''));
  };

  const openMatchedPopup = (identity, extras = {}) => {
    if (!isRealCustomerIdentity(identity)) {
      setMatchedIdentity(null);
      setIdentifiedProfile(null);
      return;
    }
    const fingerprintUrl = identity.fingerprintUrl || extras.fingerprintUrl || null;
    const rawPhoto = identity.photoUrl || extras.photoUrl || null;
    // Never put fingerprint image into the customer photo slot
    const photoUrl = rawPhoto && rawPhoto !== fingerprintUrl ? rawPhoto : null;
    const profile = {
      customerId: identity.customerId || null,
      customerName: identity.customerName || '',
      phone: identity.phone || '',
      documentNumber: identity.documentNumber || '',
      cardNumber: identity.cardNumber || '',
      bankName: identity.bankName || '',
      cardHolderName: identity.cardHolderName || '',
      photoUrl,
      fingerprintUrl,
      balances: identity.balances || extras.balances || [],
    };
    setIdentifiedProfile(profile);
    if (extras.autoOpen === false) {
      setMatchedIdentity(null);
    } else {
      setMatchedIdentity(profile);
    }
    setCardBalances(profile.balances || []);
    setForm((f) => ({
      ...f,
      customerId: profile.customerId ? String(profile.customerId) : '',
      customerName: profile.customerName || '',
      phone: profile.phone || '',
      documentNumber: profile.documentNumber || '',
      cardNumber: profile.cardNumber || f.cardNumber || '',
      bankName: profile.bankName || '',
      cardHolderName: profile.cardHolderName || '',
      fingerprintConfirmed: true,
    }));
    if (photoUrl) {
      revokeIfBlob(photoPreview);
      setPhotoPreview(photoUrl);
      setPhotoFile(null);
    } else {
      // Keep photo empty — do not show fingerprint as face photo
      revokeIfBlob(photoPreview);
      setPhotoPreview('');
      setPhotoFile(null);
    }
    setIdentifiedName(profile.customerName || '');
    setFingerStatus('matched');
  };

  const lookupCardNumber = async (rawCard, { openProfile = true, silent = false } = {}) => {
    const cardNumber = String(rawCard || '').trim();
    if (cardNumber.length < 4) {
      setCardBalances([]);
      if (openProfile) setMatchedIdentity(null);
      return null;
    }

    setCardLookupBusy(true);
    try {
      const { data: res } = await api.get('/card-reader/lookup-card', { params: { cardNumber } });
      const payload = res.data || {};
      if (payload.matched && payload.identity) {
        const id = payload.identity;
        const profile = {
          ...id,
          cardNumber: id.cardNumber || cardNumber,
          balances: id.balances || payload.balances || [],
        };

        setForm((f) => ({
          ...f,
          customerId: profile.customerId ? String(profile.customerId) : f.customerId,
          customerName: profile.customerName || '',
          phone: profile.phone || '',
          documentNumber: profile.documentNumber || '',
          cardNumber,
          bankName: profile.bankName || '',
          cardHolderName: profile.cardHolderName || '',
        }));
        setCardBalances(profile.balances || []);
        setIdentifiedName(profile.customerName || '');

        const safePhoto = profile.photoUrl && profile.photoUrl !== profile.fingerprintUrl
          ? profile.photoUrl
          : null;
        if (safePhoto) {
          revokeIfBlob(photoPreview);
          setPhotoPreview(safePhoto);
          setPhotoFile(null);
        }

        if (profile.fingerprintSeed) {
          syncEnrollmentFromIdentity(profile, { seed: profile.fingerprintSeed });
        }

        if (openProfile) openMatchedPopup(profile, { balances: profile.balances });
        if (!silent) show(res.message || t('cardLookupFound', { name: profile.customerName || cardNumber }));
        return profile;
      }

      setCardBalances([]);
      if (openProfile) setMatchedIdentity(null);
      if (!silent) show(t('cardLookupNotFound') || 'برای این شماره کارت معلوماتی پیدا نشد.', 'error');
      return null;
    } catch (err) {
      setCardBalances([]);
      if (openProfile) setMatchedIdentity(null);
      if (!silent) show(messageOf(err), 'error');
      return null;
    } finally {
      setCardLookupBusy(false);
    }
  };

  const scheduleCardLookup = (value) => {
    if (cardLookupTimerRef.current) clearTimeout(cardLookupTimerRef.current);
    const cardNumber = String(value || '').trim();
    if (cardNumber.length < 4) {
      setCardBalances([]);
      return;
    }
    cardLookupTimerRef.current = setTimeout(() => {
      lookupCardNumber(cardNumber, { openProfile: true, silent: true });
    }, 500);
  };

  const enrichIdentityFromServer = async (identity, extras = {}) => {
    if (!identity) return null;
    let profile = { ...identity };

    if (identity.fingerprintSeed || extras.seed) {
      try {
        const { data: res } = await api.post('/card-reader/identify-by-seed', {
          seed: identity.fingerprintSeed || extras.seed,
        });
        if (res.data?.matched && res.data.identity) {
          profile = { ...profile, ...res.data.identity };
        }
      } catch {
        /* keep local */
      }
    }

    if ((!profile.balances || !profile.balances.length) && profile.cardNumber) {
      try {
        const { data: res } = await api.get('/card-reader/lookup-card', {
          params: { cardNumber: profile.cardNumber },
        });
        if (res.data?.identity) {
          profile = {
            ...profile,
            ...res.data.identity,
            balances: res.data.identity.balances || res.data.balances || profile.balances,
          };
        }
      } catch {
        /* keep local */
      }
    }

    openMatchedPopup(profile, extras);
    if (isRealCustomerIdentity(profile)) {
      syncEnrollmentFromIdentity(profile, { seed: profile.fingerprintSeed || extras.seed, slot: extras.slot });
    }
    return profile;
  };

  const identifyFingerprint = async (file, seed, scanPreview = '', padSlot = '') => {
    setFingerStatus('scanning');
    try {
      if (seed) {
        try {
          const { data: res } = await withTimeout(
            api.post('/card-reader/identify-by-seed', { seed }, { timeout: 4000 }),
            4000,
          );
          if (res.data?.matched && isRealCustomerIdentity(res.data.identity)) {
            const identity = {
              ...res.data.identity,
              fingerprintSeed: res.data.identity.fingerprintSeed || seed,
            };
            openMatchedPopup(identity, {
              fingerprintUrl: identity.fingerprintUrl || scanPreview,
              photoUrl: identity.photoUrl,
              balances: identity.balances,
            });
            syncEnrollmentFromIdentity(identity, { seed, slot: padSlot });
            show(res.message || t('fingerprintAlreadyRegistered', { name: identity.customerName }) || t('fingerprintMatched', { name: identity.customerName }));
            return true;
          }
        } catch {
          /* fall through */
        }
      }

      // Brand-new seed almost never matches by hash — skip slow upload unless seed looks enrolled
      const maybeLocal = findLocalEnrollment(seed);
      if (maybeLocal || (seed && !String(seed).startsWith('fp-'))) {
        const body = new FormData();
        body.append('fingerprint', file);
        const { data: res } = await withTimeout(
          api.post('/card-reader/identify-fingerprint', body, { timeout: 4000 }),
          4000,
        );
        const payload = res.data || {};
        if (payload.matched && isRealCustomerIdentity(payload.identity)) {
          const identity = {
            ...payload.identity,
            fingerprintSeed: payload.identity.fingerprintSeed || seed,
          };
          openMatchedPopup(identity, {
            fingerprintUrl: identity.fingerprintUrl || scanPreview,
            photoUrl: identity.photoUrl,
            balances: identity.balances,
          });
          syncEnrollmentFromIdentity(identity, { seed, slot: padSlot });
          show(res.message || t('fingerprintAlreadyRegistered', { name: identity.customerName }) || t('fingerprintMatched', { name: identity.customerName }));
          return true;
        }
      }

      if (isRealCustomerIdentity(maybeLocal)) {
        openMatchedPopup(maybeLocal, {
          fingerprintUrl: maybeLocal.fingerprintUrl || scanPreview,
          photoUrl: maybeLocal.photoUrl,
        });
        show(t('fingerprintAlreadyRegistered', { name: maybeLocal.customerName }) || t('fingerprintMatched', { name: maybeLocal.customerName }));
        return true;
      }

      setIdentifiedName('');
      setMatchedIdentity(null);
      setForm((f) => ({ ...f, fingerprintConfirmed: true }));
      setFingerStatus('new');
      show(t('fingerprintNotRecognized') || t('fingerprintAutoConfirmed'));
      return false;
    } catch (err) {
      const local = findLocalEnrollment(seed);
      if (isRealCustomerIdentity(local)) {
        openMatchedPopup(local, {
          fingerprintUrl: local.fingerprintUrl || scanPreview,
          photoUrl: local.photoUrl,
        });
        show(t('fingerprintAlreadyRegistered', { name: local.customerName }) || t('fingerprintMatched', { name: local.customerName }));
        return true;
      }
      setMatchedIdentity(null);
      setForm((f) => ({ ...f, fingerprintConfirmed: true }));
      setFingerStatus('new');
      if (err?.code === 'TIMEOUT') {
        show(t('fingerprintNotRecognized') || t('fingerprintAutoConfirmed'));
      } else {
        show(messageOf(err), 'error');
      }
      return false;
    }
  };

  const connectDevice = async () => {
    setDeviceBusy(true);
    try {
      const health = await zkHealth();
      if (!health?.ok) {
        throw new Error(
          health?.message
          || 'ZK4500 شناسایی نشد. Driver و ZKTecoBridge را بررسی کنید.',
        );
      }

      await syncRealFingerprintTemplates();
      setDeviceConnected(true);
      show(`ZK4500 متصل است${health.deviceName ? ` — ${health.deviceName}` : ''}`);
    } catch (err) {
      setDeviceConnected(false);
      show(err?.message || 'اتصال به ZK4500 ناموفق بود.', 'error');
    } finally {
      setDeviceBusy(false);
    }
  };

  const applyKnownFingerprint = async (known, padSlot = '') => {
    const seed = known?.seed || known?.fingerprintSeed;
    if (!seed || !isRealCustomerIdentity(known)) return false;

    const captured = await captureFingerprintBlob(seed);
    if (!captured?.file) throw new Error(t('fingerprintNotDetected'));
    revokeIfBlob(fingerPreview);
    commitFingerCapture(captured.file, seed, known.fingerprintUrl || captured.dataUrl, padSlot || known.slot || '');
    setForm((f) => ({ ...f, fingerprintConfirmed: true }));
    setFingerStatus('matched');
    setLastFingerprintSeed(seed);

    // Show registered customer immediately (do not wait on slow network)
    openMatchedPopup(known, {
      fingerprintUrl: known.fingerprintUrl || captured.dataUrl,
      photoUrl: known.photoUrl && known.photoUrl !== known.fingerprintUrl ? known.photoUrl : null,
      balances: known.balances,
    });
    show(
      t('fingerprintAlreadyRegistered', { name: known.customerName || '—' })
        || `این اثر انگشت قبلاً برای ${known.customerName || 'این شخص'} ثبت شده است.`,
    );

    const bindSlot = padSlot || known.slot || known.slots?.[0] || null;
    if (bindSlot) {
      syncEnrollmentFromIdentity(known, { seed, slot: bindSlot, slots: [bindSlot] });
    }

    // Enrich from server in background (short timeout)
    withTimeout(
      api.post('/card-reader/identify-by-seed', { seed }, { timeout: 4000 }),
      4000,
    ).then(({ data: res }) => {
      if (res.data?.matched && isRealCustomerIdentity(res.data.identity)) {
        const profile = {
          ...known,
          ...res.data.identity,
          fingerprintSeed: res.data.identity.fingerprintSeed || seed,
          seed,
        };
        openMatchedPopup(profile, {
          fingerprintUrl: profile.fingerprintUrl || known.fingerprintUrl || captured.dataUrl,
          photoUrl: profile.photoUrl && profile.photoUrl !== profile.fingerprintUrl ? profile.photoUrl : null,
          balances: profile.balances,
        });
        syncEnrollmentFromIdentity(profile, {
          seed,
          slot: bindSlot,
          slots: bindSlot ? [bindSlot] : [],
        });
      }
    }).catch(() => { /* keep local popup */ });

    return true;
  };

  /**
   * Rematch registered fingerprint:
   * - same pad zone bound at enrollment
   * - or card number typed first
   * - or exactly one enrolled customer (re-bind this pad for next time)
   */
  const resolveKnownFingerprint = (padSlot) => {
    if (padSlot) {
      const bySlot = findLocalBySlot(padSlot);
      if (isRealCustomerIdentity(bySlot) && bySlot.seed) return bySlot;
    }

    const card = String(form.cardNumber || '').trim();
    const nameEmpty = !String(form.customerName || '').trim();
    if (nameEmpty && card.length >= 4) {
      const byCard = findLocalByCustomerOrCard({ cardNumber: card });
      if (isRealCustomerIdentity(byCard) && byCard.seed) return byCard;
    }

    const enrolled = loadDeviceEnrollments().filter(
      (e) => isRealCustomerIdentity(e) && e.seed,
    );
    if (enrolled.length === 1) return enrolled[0];
    return null;
  };

  const cancelFingerHold = ({ asError = false } = {}) => {
    const hold = fingerHoldRef.current;
    if (hold.completing) return;
    if (hold.timer) {
      clearTimeout(hold.timer);
      hold.timer = null;
    }
    if (!hold.active) return;
    hold.active = false;
    setDeviceBusy(false);
    setFingerStatus('idle');
    if (asError) {
      show(t('fingerprintNotDetected'), 'error');
    }
  };

  const loadFullIdentifiedProfile = async (identity) => {
    if (!identity) return null;
    let profile = { ...identity };

    try {
      const { data: enr } = await api.get('/card-reader/fingerprint-enrollments');
      const list = Array.isArray(enr?.data) ? enr.data : [];
      const customerId = String(profile.customerId || '');
      const cardNumber = String(profile.cardNumber || '').trim();
      const found = list.find((item) => (
        (customerId && String(item?.customerId || '') === customerId)
        || (cardNumber && String(item?.cardNumber || '').trim() === cardNumber)
      ));
      if (found) profile = { ...profile, ...found };
    } catch {
      // Bridge identity already contains the synced profile; keep it if API refresh fails.
    }

    if (profile.cardNumber) {
      try {
        const { data: lookup } = await api.get('/card-reader/lookup-card', {
          params: { cardNumber: profile.cardNumber },
        });
        if (lookup?.data?.identity) {
          profile = {
            ...profile,
            ...lookup.data.identity,
            balances: lookup.data.identity.balances || lookup.data.balances || profile.balances || [],
          };
        }
      } catch {
        // Keep the profile already returned by fingerprint enrollment sync.
      }
    }

    return profile;
  };

  const persistFingerprintScanImage = async (customerId, dataUrl) => {
    if (!customerId || !dataUrl) return null;
    const file = zkFingerprintImageToFile(dataUrl);
    if (!file) return null;

    try {
      const body = new FormData();
      body.append('fingerprint', file);
      const { data: res } = await api.post(`/card-reader/customer/${customerId}/fingerprint-image`, body);
      return res?.data?.identity || null;
    } catch {
      // The live scan can still be displayed even if persistence fails.
      return null;
    }
  };

  const completeFingerprintScan = async (_padSlot, { forceNew = false } = {}) => {
    const hold = fingerHoldRef.current;
    if (hold.completing) return;

    hold.completing = true;
    hold.active = false;

    if (hold.timer) {
      clearTimeout(hold.timer);
      hold.timer = null;
    }

    setDeviceBusy(true);
    setFingerStatus('scanning');

    try {
      const health = await zkHealth();
      if (!health?.ok) {
        throw new Error(
          health?.message
          || 'دستگاه ZK4500 آماده نیست. Driver، SDK و ZKTecoBridge را بررسی کنید.',
        );
      }

      setDeviceConnected(true);

      // Always synchronize current database templates before an identify/enroll.
      await syncRealFingerprintTemplates();

      if (forceNew) {
        const result = await zkEnroll();

        if (result?.duplicate && result?.identity) {
          const matchedTemplate = result.identity.fingerprintTemplate || '';
          const matchedFormat = result.identity.fingerprintFormat || 'ZK10';
          setRealFingerprintTemplate(matchedTemplate);
          setRealFingerprintFormat(matchedFormat);

          openMatchedPopup(result.identity, {
            fingerprintUrl: result.fingerprintImage || result.identity.fingerprintUrl,
            photoUrl: result.identity.photoUrl,
            balances: result.identity.balances || [],
            autoOpen: false,
          });

          if (result.fingerprintImage) {
            const file = zkFingerprintImageToFile(result.fingerprintImage);
            setFingerPreview(result.fingerprintImage);
            setFingerFile(file);
            fingerCaptureRef.current = {
              file: file || null,
              seed: '',
              padSlot: fingerCaptureRef.current.padSlot || '',
              template: matchedTemplate,
              format: matchedFormat,
            };
          } else {
            fingerCaptureRef.current = {
              ...fingerCaptureRef.current,
              template: matchedTemplate,
              format: matchedFormat,
            };
          }

          setFingerStatus('matched');
          setIdentifiedName(result.identity.customerName || '');
          setForm((f) => ({ ...f, fingerprintConfirmed: true }));
          show(`این اثر انگشت قبلاً ثبت است: ${result.identity.customerName || ''}`);
          return;
        }

        if (!result?.template) {
          throw new Error('Template واقعی اثر انگشت از ZK4500 دریافت نشد.');
        }

        const fingerprintImage = result.fingerprintImage || '';
        const fingerprintFile = zkFingerprintImageToFile(fingerprintImage);

        setRealFingerprintTemplate(result.template);
        setRealFingerprintFormat(result.format || 'ZK10');
        setMatchedIdentity(null);
        setIdentifiedProfile(null);
        setIdentifiedName('');
        setForm((f) => ({ ...f, fingerprintConfirmed: true }));
        setFingerStatus('new');
        setFingerPreview(fingerprintImage);
        setFingerFile(fingerprintFile);

        // The old synthetic seed is intentionally not used for real biometric matching.
        setFingerSeed('');
        fingerCaptureRef.current = {
          file: fingerprintFile,
          seed: '',
          padSlot: '',
          template: result.template,
          format: result.format || 'ZK10',
        };

        show('اثر انگشت واقعی ZK4500 آماده ثبت است. حالا معلومات شخص را ذخیره کنید.');
        return;
      }

      const result = await zkIdentify();

      if (result?.matched && result?.identity) {
        let identity = await loadFullIdentifiedProfile(result.identity) || result.identity;
        const liveFingerprintImage = result.fingerprintImage || '';

        // Always keep the current real ZK4500 scan available for the profile popup.
        // If this customer does not yet have a stored fingerprint image, persist it once.
        if (identity.customerId && liveFingerprintImage && !identity.fingerprintUrl) {
          const persisted = await persistFingerprintScanImage(identity.customerId, liveFingerprintImage);
          if (persisted) identity = { ...identity, ...persisted };
        }

        const fingerprintImage = liveFingerprintImage || identity.fingerprintUrl || '';
        const popupIdentity = {
          ...identity,
          fingerprintUrl: identity.fingerprintUrl || fingerprintImage,
        };

        openMatchedPopup(popupIdentity, {
          fingerprintUrl: fingerprintImage,
          photoUrl: popupIdentity.photoUrl,
          balances: popupIdentity.balances || [],
          autoOpen: false,
        });

        // Keep enrolled ZK10 template so withdrawal/deposit submit does not fail
        // with "template required" after a successful identify match.
        const matchedTemplate = popupIdentity.fingerprintTemplate
          || result.identity?.fingerprintTemplate
          || '';
        const matchedFormat = popupIdentity.fingerprintFormat
          || result.identity?.fingerprintFormat
          || 'ZK10';
        setRealFingerprintTemplate(matchedTemplate);
        setRealFingerprintFormat(matchedFormat);
        setIdentifiedName(popupIdentity.customerName || '');
        setForm((f) => ({ ...f, fingerprintConfirmed: true }));
        setFingerStatus('matched');

        const liveFile = liveFingerprintImage
          ? zkFingerprintImageToFile(liveFingerprintImage)
          : null;
        if (liveFile) {
          setFingerPreview(liveFingerprintImage);
          setFingerFile(liveFile);
          fingerCaptureRef.current = {
            file: liveFile,
            seed: '',
            padSlot: fingerCaptureRef.current.padSlot || '',
            template: matchedTemplate,
            format: matchedFormat,
          };
        } else {
          if (fingerprintImage) setFingerPreview(fingerprintImage);
          fingerCaptureRef.current = {
            ...fingerCaptureRef.current,
            template: matchedTemplate,
            format: matchedFormat,
          };
        }

        show(`اثر انگشت قبلاً ثبت است: ${popupIdentity.customerName || ''}`);
        return;
      }

      setMatchedIdentity(null);
      setIdentifiedProfile(null);
      setIdentifiedName('');
      setRealFingerprintTemplate('');
      setForm((f) => ({ ...f, fingerprintConfirmed: false }));
      setFingerStatus('new');
      show(
        'این اثر انگشت ثبت نشده است. برای ثبت، دکمه «اثر انگشت شخص جدید» را بزنید.',
        'error',
      );
    } catch (err) {
      const errorMessage = err?.message || messageOf(err) || 'خطا در ZK4500';
      const bridgeUnavailable = /سرویس محلی ZKTeco|Failed to fetch|ECONNREFUSED|در دسترس نیست/i.test(errorMessage);
      if (bridgeUnavailable) setDeviceConnected(false);
      setFingerStatus('idle');
      setForm((f) => ({ ...f, fingerprintConfirmed: false }));
      show(errorMessage, 'error');
    } finally {
      hold.completing = false;
      setDeviceBusy(false);
    }
  };

  const beginFingerHold = (event, mode = 'identify') => {
    event.preventDefault();
    const hold = fingerHoldRef.current;
    if (deviceBusy || hold.completing || hold.active) return;

    if (!deviceConnected) setDeviceConnected(true);

    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      /* ignore */
    }

    const padSlot = fingerSeedFromPointerEvent(event, PAD_COLS, PAD_ROWS) || '';
    setLastPadSlot(padSlot);
    fingerCaptureRef.current.padSlot = padSlot;
    setFingerStatus('waiting');

    hold.active = true;
    hold.mode = mode;
    hold.padSlot = padSlot;
    hold.startedAt = Date.now();
    hold.timer = setTimeout(() => {
      if (!hold.active) return;
      completeFingerprintScan(hold.padSlot || '', { forceNew: hold.mode === 'new' });
    }, FINGER_HOLD_MS);
  };

  const endFingerHold = () => {
    const hold = fingerHoldRef.current;
    if (hold.completing) return;
    if (!hold.active) return;
    // Any real press on the pad = finger detected → complete scan (do not cancel)
    completeFingerprintScan(hold.padSlot || '', { forceNew: hold.mode === 'new' });
  };

  useEffect(() => () => {
    if (fingerHoldRef.current.timer) clearTimeout(fingerHoldRef.current.timer);
    if (cardLookupTimerRef.current) clearTimeout(cardLookupTimerRef.current);
  }, []);

  const enrollNewFingerprint = (event) => {
    beginFingerHold(event, 'new');
  };

  const readCard = async () => {
    if (!deviceConnected) {
      show(t('cardReaderNotConnected'), 'error');
      return;
    }
    setDeviceBusy(true);
    try {
      await new Promise((r) => setTimeout(r, 500));
      show(t('cardReaderReadyManual'));
    } finally {
      setDeviceBusy(false);
    }
  };

  const printReceipt = async (entry = lastReceipt) => {
    if (!entry) {
      show(t('cardReaderPrintEmpty'), 'error');
      return;
    }
    try {
      const ok = await printCardReaderSlip({
        entry,
        company: companySettings,
        labels: {
          title: `${t('cardReader')} — ${kindLabel(t, entry.kind)}`,
          name: t('name'),
          phone: t('phone'),
          documentNumber: t('tazkiraNumber'),
          cardNumber: t('cardNumber'),
          bankName: t('bankName'),
          cardHolderName: t('cardHolderName'),
          operation: t('operationType'),
          operationValue: kindLabel(t, entry.kind),
          amount: t('amount'),
          fee: t('fee'),
          note: t('note'),
          documentNo: t('number'),
          signature: t('signature'),
          photoCap: t('customerPhoto'),
          fingerCap: t('fingerprint'),
        },
      });
      if (!ok) show(t('error'), 'error');
    } catch {
      show(t('error'), 'error');
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.kind) {
      show(t('operationTypeRequired') || 'نوع عملیات را انتخاب کنید.', 'error');
      return;
    }
    // برداشت: کارت مشتری→چند کارت من + نقد از صندوق به مشتری
    // واریز: فقط کارت من→کارت مشتری
    let cardAmountValue = Number(form.amount);
    let receiveCashboxId = form.receiveCashboxId;
    let cardTransfersPayload = [];

    if (form.kind === 'withdrawal') {
      const selectedRows = (form.cardTransfers || []).filter((row) => Number(row.cashboxId) > 0);
      if (!selectedRows.length) {
        show(t('selectMyCardsWithAmount') || 'حداقل یک کارت من را انتخاب کنید.', 'error');
        return;
      }
      const missingAmount = selectedRows.filter((row) => !(Number(row.amount) > 0));
      if (missingAmount.length) {
        show(
          t('eachMyCardNeedsAmount')
            || 'برای هر کارت انتخاب‌شده باید مبلغ جدا بنویسید؛ وگرنه همه پول به یک کارت می‌رود.',
          'error',
        );
        return;
      }

      const transfers = selectedRows.map((row) => ({
        cashboxId: Number(row.cashboxId),
        amount: Number(row.amount),
      }));

      const ids = transfers.map((row) => row.cashboxId);
      if (new Set(ids).size !== ids.length) {
        show(t('duplicateMyCard') || 'هر کارت من را فقط یک‌بار انتخاب کنید.', 'error');
        return;
      }
      cardTransfersPayload = transfers;
      cardAmountValue = transfers.reduce((sum, row) => sum + row.amount, 0);
      receiveCashboxId = String(transfers[0].cashboxId);
    } else if (!receiveCashboxId) {
      show(t('selectMyCardCashbox') || 'صندوق کارت من را انتخاب کنید.', 'error');
      return;
    }

    if (form.kind === 'withdrawal' && !form.payCashboxId) {
      show(t('selectPayCashbox') || 'صندوق پرداخت نقد را انتخاب کنید.', 'error');
      return;
    }
    const cashboxId = receiveCashboxId;
    if (!form.currencyId) {
      show(t('selectCardCurrency') || 'ارز مبلغ کارت را انتخاب کنید.', 'error');
      return;
    }
    if (!(cardAmountValue > 0)) {
      show(t('amountCardRequired') || 'مبلغ کارت را وارد کنید.', 'error');
      return;
    }
    if (form.kind === 'withdrawal') {
      if (!form.cashCurrencyId) {
        show(t('selectCashCurrency') || 'ارز پرداخت نقد را انتخاب کنید.', 'error');
        return;
      }
      if (!form.cashAmount || Number(form.cashAmount) <= 0) {
        show(t('amountPaidRequired') || 'مبلغ پرداخت نقد به مشتری را وارد کنید.', 'error');
        return;
      }
    }
    if (!editing) {
      if (!form.fingerprintConfirmed) {
        show(t('fingerprintScanRequired'), 'error');
        return;
      }
    } else if (!form.fingerprintConfirmed && !fingerPreview) {
      show(t('fingerprintRequired'), 'error');
      return;
    }
    setSaving(true);
    try {
      const uploadFinger = fingerCaptureRef.current.file || fingerFile;
      const uploadSeed = '';
      const uploadTemplate = realFingerprintTemplate || fingerCaptureRef.current.template || '';
      const uploadFormat = realFingerprintFormat || fingerCaptureRef.current.format || 'ZK10';
      if (
        !editing
        && (
          !form.fingerprintConfirmed
          || (!uploadTemplate && !(form.customerId && fingerStatus === 'matched'))
        )
      ) {
        show(
          'برای شخص جدید باید اثر انگشت واقعی ZK4500 را ثبت کنید.',
          'error',
        );
        setSaving(false);
        return;
      }

      const body = new FormData();
      if (form.customerId) body.append('customerId', form.customerId);
      body.append('customerName', form.customerName.trim());
      body.append('phone', form.phone.trim());
      body.append('documentNumber', form.documentNumber.trim());
      body.append('cardNumber', form.cardNumber.trim());
      body.append('bankName', form.bankName.trim());
      body.append('cardHolderName', form.cardHolderName.trim());
      body.append('kind', form.kind);
      body.append('amount', String(cardAmountValue));
      body.append('fee', form.fee || '0');
      body.append('currencyId', form.currencyId);
      if (form.kind === 'withdrawal') {
        body.append('cashAmount', form.cashAmount);
        body.append('cashCurrencyId', form.cashCurrencyId);
        body.append('cardTransfers', JSON.stringify(cardTransfersPayload));
        body.append('cardTransferCount', String(cardTransfersPayload.length));
        cardTransfersPayload.forEach((row, index) => {
          body.append(`cardTransfer_${index}_cashboxId`, String(row.cashboxId));
          body.append(`cardTransfer_${index}_amount`, String(row.amount));
        });
      }
      body.append('cashboxId', cashboxId);
      if (receiveCashboxId) body.append('receiveCashboxId', receiveCashboxId);
      if (form.kind === 'withdrawal' && form.payCashboxId) {
        body.append('payCashboxId', form.payCashboxId);
      }
      if (form.note) body.append('note', form.note);
      body.append('fingerprintConfirmed', '1');
      if (uploadSeed) body.append('fingerprintSeed', uploadSeed);
      if (uploadTemplate) {
        body.append('fingerprintTemplate', uploadTemplate);
        body.append('fingerprintFormat', uploadFormat);
      }
      if (photoFile) body.append('photo', photoFile);
      if (uploadFinger) body.append('fingerprint', uploadFinger);

      const res = editing
        ? await api.put(`/card-reader/${editing.id}`, body)
        : await api.post('/card-reader', body);
      const saved = res.data?.data;
      const identity = saved?.identity;
      const enrolledSeed = identity?.fingerprintSeed || uploadSeed || fingerCaptureRef.current.seed || fingerSeed;
      if (enrolledSeed) {
        const bindSlot = lastPadSlot || fingerCaptureRef.current.padSlot || allocatePadSlot(null);
        saveDeviceEnrollment({
          seed: enrolledSeed,
          slot: bindSlot,
          slots: [bindSlot],
          customerId: saved?.customerId || identity?.customerId || form.customerId || null,
          customerName: saved?.customerName || form.customerName,
          phone: saved?.phone || form.phone,
          documentNumber: saved?.documentNumber || form.documentNumber,
          cardNumber: saved?.cardNumber || form.cardNumber,
          bankName: saved?.bankName || form.bankName,
          cardHolderName: saved?.cardHolderName || form.cardHolderName,
          photoUrl: (() => {
            const p = saved?.photoUrl || identity?.photoUrl || null;
            const f = saved?.fingerprintUrl || identity?.fingerprintUrl || null;
            if (p && photoPreview && p === photoPreview && fingerPreview && photoPreview === fingerPreview) return null;
            return p && p !== f ? p : null;
          })(),
          fingerprintUrl: saved?.fingerprintUrl || null,
          balances: identity?.balances || cardBalances,
        });
        setLastFingerprintSeed(enrolledSeed);
        fingerCaptureRef.current.padSlot = bindSlot;
      }
      setLastReceipt(saved || null);
      show(res.data?.message || t('success'));
      resetForm();
      // Soft refresh + refresh fingerprint map so next identify works
      load({ syncFingerprints: true, soft: true }).catch(() => {});
      syncRealFingerprintTemplates().catch(() => {});
      // Auto-print in background; never block the save button
      if (saved && !editing) {
        setTimeout(() => {
          printReceipt(saved).catch(() => {});
        }, 300);
      }
    } catch (err) {
      show(messageOf(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    {
      key: 'photo',
      label: t('photo'),
      render: (r) => (
        <UserAvatar
          name={r.customerName || r.customer?.name}
          avatarUrl={r.photoUrl || r.customer?.avatarUrl}
          className="large"
        />
      ),
    },
    {
      key: 'customerName',
      label: t('customerName'),
      render: (r) => <strong>{r.customerName || r.customer?.name || '—'}</strong>,
    },
    {
      key: 'cardNumber',
      label: t('cardNumber'),
      render: (r) => r.cardNumber || '—',
    },
    {
      key: 'amount',
      label: t('amount'),
      render: (r) => (
        <div className="card-reader-cashbox-pair">
          <div>
            <small>{t('cardAmountShort') || 'کارت'}:</small>{' '}
            {r.amount != null ? `${money(r.amount)} ${r.currency?.code || ''}`.trim() : '—'}
          </div>
          {r.kind === 'withdrawal' && r.cashAmount != null ? (
            <div>
              <small>{t('cashAmountShort') || 'نقد'}:</small>{' '}
              {`${money(r.cashAmount)} ${r.cashCurrency?.code || ''}`.trim()}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      key: 'cashbox',
      label: t('cashbox'),
      render: (r) => (
        <div className="card-reader-cashbox-pair">
          {Array.isArray(r.cardTransfers) && r.cardTransfers.length > 1 ? (
            r.cardTransfers.map((split) => (
              <div key={`${r.id}-${split.cashboxId}-${split.amount}`}>
                <small>{t('myCardCashbox') || 'کارت من'}:</small>{' '}
                {translatePlace(t, split.cashbox?.name) || `#${split.cashboxId}`}
                {' — '}
                {money(split.amount)}
              </div>
            ))
          ) : (
            <div><small>{t('myCardCashbox') || 'کارت من'}:</small> {translatePlace(t, r.receiveCashbox?.name) || '—'}</div>
          )}
          {r.kind === 'withdrawal' ? (
            <div><small>{t('payCashbox')}:</small> {translatePlace(t, r.payCashbox?.name) || '—'}</div>
          ) : null}
        </div>
      ),
    },
    {
      key: 'fingerprint',
      label: t('fingerprint'),
      render: (r) => (
        <div className="row-actions">
          {r.fingerprintConfirmed ? <CheckCircle2 size={16} color="#15803d" /> : null}
          <Thumb url={r.fingerprintUrl} alt={t('fingerprint')} className="finger" />
        </div>
      ),
    },
    {
      key: 'kind',
      label: t('type'),
      render: (r) => kindLabel(t, r.kind),
    },
    {
      key: 'date',
      label: t('date'),
      render: (r) => dateTime(r.createdAt),
    },
    {
      key: 'actions',
      label: t('actions'),
      render: (r) => (
        <div className="row-actions">
          <button type="button" className="icon-btn" title={t('print')} onClick={() => printReceipt(r)}>
            <Printer size={17} />
          </button>
          <button type="button" className="icon-btn" onClick={() => openEdit(r)}>
            <Pencil size={17} />
          </button>
          <button
            type="button"
            className="icon-btn danger"
            onClick={() => askDelete(r, (row) => api.delete(`/card-reader/${row.id}`))}
          >
            <Trash2 size={17} />
          </button>
        </div>
      ),
    },
  ];

  const fingerHint = {
    idle: t('fingerprintPlaceHint'),
    waiting: t('fingerprintHoldHint'),
    scanning: t('fingerprintScanning'),
    matched: t('fingerprintMatched', { name: identifiedName || '—' }),
    new: t('fingerprintAutoConfirmed'),
  }[fingerStatus];

  return (
    <>
      <PageHeader
        title={t('cardReader')}
        subtitle={t('cardReaderCashboxHint')}
        actions={(
          <span className={`device-status ${deviceConnected ? 'on' : 'off'}`}>
            {deviceConnected ? t('cardReaderOnline') : t('cardReaderOffline')}
          </span>
        )}
      />

      <form className="panel card-reader-form" onSubmit={submit}>
        <div className="card-reader-layout">
          <div className="card-reader-main">
            <section className="card-reader-section card-reader-identify biometric-console">
              <div className="biometric-console-head">
                <div>
                  <span className="biometric-eyebrow">ZKTeco ZK4500</span>
                  <h3>{t('identifyCustomer')}</h3>
                  <p className="muted-hint biometric-subtitle">
                    اثر انگشت واقعی از دستگاه خوانده می‌شود و با Templateهای ثبت‌شده مقایسه می‌گردد.
                  </p>
                </div>
                <span className={`device-status ${deviceConnected ? 'on' : 'off'}`}>
                  <span className="device-status-dot" />
                  {deviceConnected ? 'ZK4500 متصل' : 'ZK4500 قطع'}
                </span>
              </div>

              <div className={`biometric-scan-card ${fingerStatus}`}>
                <div className="biometric-preview-shell">
                  <div className="fingerprint-pad-preview biometric-preview">
                    {fingerPreview ? (
                      <img src={mediaUrl(fingerPreview) || fingerPreview} alt={t('fingerprint')} />
                    ) : (
                      <Fingerprint size={82} strokeWidth={1.2} />
                    )}
                  </div>
                  <span className="biometric-live-label">
                    {fingerStatus === 'scanning' ? 'در حال اسکن...' : 'سنسور واقعی'}
                  </span>
                </div>

                <div className="biometric-content">
                  <div>
                    <p className="fingerprint-status biometric-status-title">{fingerHint}</p>
                    <p className="muted-hint biometric-instruction">
                      برای شناسایی، دکمه «شناسایی اثر انگشت» را بزنید و انگشت را کامل روی سنسور قرار دهید.
                    </p>
                  </div>

                  {form.fingerprintConfirmed && (fingerStatus === 'matched' || fingerStatus === 'new') ? (
                    <span className="fingerprint-auto-ok">
                      <CheckCircle2 size={16} />
                      {fingerStatus === 'matched' ? 'اثر انگشت شناسایی شد' : 'Template واقعی آماده ثبت است'}
                    </span>
                  ) : null}

                  {fingerStatus === 'matched' && identifiedProfile ? (
                    <button
                      type="button"
                      className="btn primary biometric-profile-open-btn"
                      onClick={() => setMatchedIdentity(identifiedProfile)}
                    >
                      <Fingerprint size={18} />
                      پروفایل شخص شناسایی‌شده
                    </button>
                  ) : null}

                  <div className="biometric-actions">
                    <button
                      type="button"
                      className="btn primary biometric-primary-btn"
                      disabled={deviceBusy}
                      onClick={() => completeFingerprintScan('', { forceNew: false })}
                    >
                      <Fingerprint size={18} />
                      {deviceBusy && fingerStatus === 'scanning' ? 'در حال خواندن...' : 'شناسایی اثر انگشت'}
                    </button>
                    <button
                      type="button"
                      className="btn soft biometric-enroll-btn"
                      disabled={deviceBusy}
                      onClick={() => completeFingerprintScan('', { forceNew: true })}
                    >
                      <Fingerprint size={18} />
                      ثبت اثر انگشت شخص جدید
                    </button>
                    {!deviceConnected ? (
                      <button
                        type="button"
                        className="btn soft biometric-connect-btn"
                        disabled={deviceBusy}
                        onClick={connectDevice}
                      >
                        <Link2 size={17} />
                        اتصال ZK4500
                      </button>
                    ) : null}
                  </div>

                  <div className="biometric-note">
                    <strong>ثبت جدید:</strong>
                    <span>سیستم چند نمونه از همان انگشت می‌گیرد تا Template دقیق ZKFinger ساخته شود.</span>
                  </div>
                </div>
              </div>

            </section>

            <section className="card-reader-section">
              <h3>{t('customerInfo')}</h3>
              <div className="form-grid">
                <Field label={t('name')}>
                  <input
                    required
                    value={form.customerName}
                    onChange={(e) => setForm({ ...form, customerName: e.target.value })}
                    autoComplete="off"
                  />
                </Field>
                <Field label={t('phone')}>
                  <input
                    required
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    autoComplete="off"
                  />
                </Field>
                <Field label={t('tazkiraNumber')}>
                  <input
                    required
                    value={form.documentNumber}
                    onChange={(e) => setForm({ ...form, documentNumber: e.target.value })}
                    autoComplete="off"
                  />
                </Field>
              </div>
            </section>

            <section className="card-reader-section">
              <h3>{t('cardInfo')}</h3>
              <div className="form-grid">
                <Field label={t('cardNumber')}>
                  <input
                    required
                    value={form.cardNumber}
                    onChange={(e) => {
                      const cardNumber = e.target.value;
                      setForm((f) => ({ ...f, cardNumber }));
                      scheduleCardLookup(cardNumber);
                    }}
                    onBlur={(e) => lookupCardNumber(e.target.value, { openProfile: true, silent: true })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        lookupCardNumber(e.currentTarget.value, { openProfile: true, silent: false });
                      }
                    }}
                    autoComplete="off"
                    className="ltr"
                  />
                  <div className="field-inline-actions" style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center' }}>
                    {cardLookupBusy ? <span className="field-hint">{t('loading')}</span> : null}
                    <button
                      type="button"
                      className="btn soft"
                      disabled={cardLookupBusy || String(form.cardNumber || '').trim().length < 4}
                      onClick={() => lookupCardNumber(form.cardNumber, { openProfile: true, silent: false })}
                    >
                      {t('showCustomerInfo') || 'نمایش تمام معلومات'}
                    </button>
                  </div>
                </Field>
                <Field label={t('bankName')}>
                  <input
                    value={form.bankName}
                    onChange={(e) => setForm({ ...form, bankName: e.target.value })}
                    autoComplete="off"
                  />
                </Field>
                <Field label={t('cardHolderName')}>
                  <input
                    value={form.cardHolderName}
                    onChange={(e) => setForm({ ...form, cardHolderName: e.target.value })}
                    autoComplete="off"
                  />
                </Field>
                {cardBalances.length ? (
                  <div className="full card-reader-balance-box">
                    <strong>{t('cardCustomerBalance')}</strong>
                    <div className="summary-chips">
                      {cardBalances.map((b) => (
                        <span key={`${b.currencyId}-${b.currency?.code || ''}`} className="badge info">
                          {b.currency?.code || '—'}: {money(b.amount)}
                        </span>
                      ))}
                    </div>
                    <p className="muted-hint">{t('cardBalanceCashboxHint')}</p>
                  </div>
                ) : null}
              </div>
            </section>

            <section className="card-reader-section">
              <h3>{t('operationType')}</h3>
              <p className="muted-hint" style={{ marginTop: 0 }}>{t('cardBalanceCashboxHint')}</p>
              <div className="card-reader-ops">
                <label className={`op-chip ${form.kind === 'withdrawal' ? 'active' : ''}`}>
                  <input
                    type="radio"
                    name="kind"
                    checked={form.kind === 'withdrawal'}
                    onChange={() => setForm({ ...form, kind: 'withdrawal' })}
                  />
                  {t('cardWithdrawal')}
                </label>
                <label className={`op-chip ${form.kind === 'deposit' ? 'active' : ''}`}>
                  <input
                    type="radio"
                    name="kind"
                    checked={form.kind === 'deposit'}
                    onChange={() => setForm({
                      ...form,
                      kind: 'deposit',
                      cashAmount: '',
                      cashCurrencyId: '',
                      payCashboxId: '',
                      cardTransfers: [{ cashboxId: '', amount: '' }],
                    })}
                  />
                  {t('cardDeposit')}
                </label>
              </div>
              <div className="form-grid" style={{ marginTop: 12 }}>
                {form.kind === 'deposit' ? (
                  <Field
                    className="full"
                    label={t('amountFromMyCard') || 'پول از کارت من به کارت مشتری'}
                  >
                    <div className="card-reader-amount-currency">
                      <input
                        required
                        type="number"
                        min="0"
                        step="any"
                        value={form.amount}
                        onChange={(e) => setForm({ ...form, amount: e.target.value })}
                        placeholder="0"
                      />
                      <select
                        required
                        value={form.currencyId}
                        onChange={(e) => setForm({ ...form, currencyId: e.target.value })}
                        aria-label={t('currency')}
                      >
                        <option value="">{t('selectCurrency')}</option>
                        {(lookups.currencies || []).map((c) => (
                          <option key={c.id} value={c.id}>{localizeCurrency(t, c)}</option>
                        ))}
                      </select>
                    </div>
                  </Field>
                ) : (
                  <>
                    <Field
                      className="full"
                      label={t('amountFromCustomerCard') || 'پول از کارت مشتری به کارت‌های من'}
                    >
                      <div className="card-reader-amount-currency">
                        <input
                          required
                          type="number"
                          min="0"
                          step="any"
                          value={form.amount}
                          onChange={(e) => {
                            const amount = e.target.value;
                            const transfers = [...(form.cardTransfers?.length
                              ? form.cardTransfers
                              : [{ cashboxId: '', amount: '' }])];
                            // فقط وقتی یک کارت داریم مبلغ را روی همان ردیف می‌گذاریم
                            if (transfers.length === 1) {
                              transfers[0] = { ...transfers[0], amount };
                            }
                            setForm({ ...form, amount, cardTransfers: transfers });
                          }}
                          placeholder="0"
                        />
                        <select
                          required
                          value={form.currencyId}
                          onChange={(e) => setForm({ ...form, currencyId: e.target.value })}
                          aria-label={t('currency')}
                        >
                          <option value="">{t('selectCurrency')}</option>
                          {(lookups.currencies || []).map((c) => (
                            <option key={c.id} value={c.id}>{localizeCurrency(t, c)}</option>
                          ))}
                        </select>
                      </div>
                    </Field>

                    <Field className="full" label={t('myCardCashbox') || 'کارت من'}>
                      <div className="card-transfer-list">
                        {(form.cardTransfers || [{ cashboxId: '', amount: '' }]).map((row, index) => (
                          <div key={`card-transfer-${index}`} className="card-transfer-row">
                            <select
                              required
                              value={row.cashboxId}
                              onChange={(e) => {
                                const next = [...(form.cardTransfers || [])];
                                next[index] = { ...next[index], cashboxId: e.target.value };
                                setForm({ ...form, cardTransfers: next });
                              }}
                            >
                              <option value="">{t('selectMyCardCashbox') || t('selectReceiveCashbox')}</option>
                              {(lookups.cashboxes || []).map((c) => (
                                <option key={c.id} value={c.id}>{translatePlace(t, c.name)}</option>
                              ))}
                            </select>
                            <input
                              required
                              type="number"
                              min="0"
                              step="any"
                              value={row.amount}
                              placeholder={t('amount') || 'مبلغ'}
                              onChange={(e) => {
                                const next = [...(form.cardTransfers || [])];
                                next[index] = { ...next[index], amount: e.target.value };
                                const sum = next.reduce((s, r) => s + (Number(r.amount) || 0), 0);
                                setForm({
                                  ...form,
                                  cardTransfers: next,
                                  amount: sum > 0 ? String(sum) : '',
                                });
                              }}
                            />
                            <button
                              type="button"
                              className="btn soft"
                              disabled={(form.cardTransfers || []).length <= 1}
                              onClick={() => {
                                const next = (form.cardTransfers || []).filter((_, i) => i !== index);
                                const rows = next.length ? next : [{ cashboxId: '', amount: '' }];
                                const sum = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
                                setForm({
                                  ...form,
                                  cardTransfers: rows,
                                  amount: sum > 0 ? String(sum) : form.amount,
                                });
                              }}
                            >
                              {t('delete') || 'حذف'}
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          className="btn soft"
                          onClick={() => {
                            const current = form.cardTransfers || [{ cashboxId: '', amount: '' }];
                            // با چندکارته شدن، مبلغ‌ها را خالی کن تا کاربر برای هر کارت جدا بنویسد
                            const cleared = current.map((row) => ({ ...row, amount: '' }));
                            setForm({
                              ...form,
                              cardTransfers: [...cleared, { cashboxId: '', amount: '' }],
                            });
                          }}
                        >
                          {t('addMyCardRow') || 'افزودن کارت من'}
                        </button>
                        <p className="muted-hint" style={{ margin: 0 }}>
                          {t('cardTransfersHint')
                            || 'برای هر کارت من حتماً مبلغ جدا بنویسید. اگر مبلغ ننویسید همه پول به یک کارت می‌رود.'}
                        </p>
                      </div>
                    </Field>
                  </>
                )}

                {form.kind === 'withdrawal' ? (
                  <Field
                    className="full"
                    label={t('amountPaidToCustomer') || 'پول نقد از صندوق به مشتری'}
                  >
                    <div className="card-reader-amount-currency">
                      <input
                        required
                        type="number"
                        min="0"
                        step="any"
                        value={form.cashAmount}
                        onChange={(e) => setForm({ ...form, cashAmount: e.target.value })}
                        placeholder="0"
                      />
                      <select
                        required
                        value={form.cashCurrencyId}
                        onChange={(e) => setForm({ ...form, cashCurrencyId: e.target.value })}
                        aria-label={t('currency')}
                      >
                        <option value="">{t('selectCurrency')}</option>
                        {(lookups.currencies || []).map((c) => (
                          <option key={c.id} value={c.id}>{localizeCurrency(t, c)}</option>
                        ))}
                      </select>
                    </div>
                  </Field>
                ) : null}

                <Field label={t('fee')}>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={form.fee}
                    onChange={(e) => setForm({ ...form, fee: e.target.value })}
                  />
                </Field>

                {form.kind === 'deposit' ? (
                  <Field label={t('myCardCashbox') || 'کارت من'}>
                    <select
                      required
                      value={form.receiveCashboxId}
                      onChange={(e) => setForm({ ...form, receiveCashboxId: e.target.value })}
                    >
                      <option value="">{t('selectMyCardCashbox') || t('selectReceiveCashbox')}</option>
                      {(lookups.cashboxes || []).map((c) => (
                        <option key={c.id} value={c.id}>{translatePlace(t, c.name)}</option>
                      ))}
                    </select>
                  </Field>
                ) : null}

                {form.kind === 'withdrawal' ? (
                  <Field label={t('payCashbox') || 'صندوق پرداخت نقد'}>
                    <select
                      required
                      value={form.payCashboxId}
                      onChange={(e) => setForm({ ...form, payCashboxId: e.target.value })}
                    >
                      <option value="">{t('selectPayCashbox')}</option>
                      {(lookups.cashboxes || []).map((c) => (
                        <option key={c.id} value={c.id}>{translatePlace(t, c.name)}</option>
                      ))}
                    </select>
                  </Field>
                ) : null}

                <Field label={t('note')} className="full">
                  <input
                    value={form.note}
                    onChange={(e) => setForm({ ...form, note: e.target.value })}
                    placeholder={t('description')}
                    autoComplete="off"
                  />
                </Field>
              </div>
            </section>

            <div className="card-reader-actions">
              <button type="button" className="btn soft" disabled={deviceBusy || deviceConnected} onClick={connectDevice}>
                <Link2 size={17} />
                {t('connectCardReader')}
              </button>
              <button type="button" className="btn soft" disabled={deviceBusy} onClick={readCard}>
                <CreditCard size={17} />
                {t('readCard')}
              </button>
              <button className="btn primary" disabled={saving}>
                <CheckCircle2 size={17} />
                {saving ? t('loading') : (editing ? t('update') : t('confirmTransaction'))}
              </button>
              <button type="button" className="btn soft" onClick={() => printReceipt(lastReceipt)}>
                <Printer size={17} />
                {t('printReceipt')}
              </button>
              {editing ? (
                <button type="button" className="btn soft" onClick={resetForm}>
                  {t('cancel')}
                </button>
              ) : null}
            </div>
          </div>

          <aside className="card-reader-photo-panel">
            <h3>{t('customerPhoto')}</h3>
            <div className="card-reader-photo-box">
              <UserAvatar
                name={form.customerName || t('photo')}
                avatarUrl={photoPreview}
                className="xlarge"
              />
            </div>
            <Field label={t('customerPhotoOptional') || t('photo')}>
              <input
                type="file"
                accept="image/*"
                onChange={onPhotoChange}
              />
            </Field>
            <small>{t('profilePhotoHint')}</small>
            {identifiedName ? (
              <div className="card-reader-customer-preview" style={{ marginTop: 12 }}>
                <div>
                  <strong>{t('fingerprintIdentified')}</strong>
                  <p>{identifiedName}</p>
                </div>
                <button
                  type="button"
                  className="btn soft"
                  onClick={async () => {
                    const known = findLocalByCustomerOrCard({
                      customerId: form.customerId,
                      cardNumber: form.cardNumber,
                    });
                    if (known) {
                      await enrichIdentityFromServer(known, { seed: known.seed || known.fingerprintSeed });
                      return;
                    }
                    if (form.cardNumber) {
                      await lookupCardNumber(form.cardNumber, { openProfile: true, silent: false });
                    }
                  }}
                >
                  {t('showCustomerInfo') || 'نمایش تمام معلومات'}
                </button>
              </div>
            ) : null}
          </aside>
        </div>
      </form>

      <div className="panel">
        <div className="form-grid inline report-filters" style={{ marginBottom: 12 }}>
          <Field label={t('dateFrom')}>
            <DateInput
              value={filters.dateFrom}
              onChange={(dateFrom) => {
                setPage(1);
                setFilters((f) => ({ ...f, dateFrom }));
              }}
            />
          </Field>
          <Field label={t('dateTo')}>
            <DateInput
              value={filters.dateTo}
              onChange={(dateTo) => {
                setPage(1);
                setFilters((f) => ({ ...f, dateTo }));
              }}
            />
          </Field>
        </div>
        <SearchBox
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          onRefresh={() => load({ syncFingerprints: false })}
        />
        {loading ? <Loading /> : error ? <ErrorBox message={error} /> : (
          <>
            <Table rows={rows} columns={columns} />
            <Pagination pagination={pagination} onPage={setPage} />
          </>
        )}
      </div>
      {deleteDialog}

      <Modal
        open={Boolean(matchedIdentity)}
        onClose={() => setMatchedIdentity(null)}
        title={t('fingerprintProfileTitle')}
        wide
      >
        {matchedIdentity ? (
          <div className="fp-identity-profile">
            <p className="fp-identity-hint">{t('fingerprintProfileHint')}</p>
            <div className="fp-identity-media">
              <div className="fp-identity-photo">
                <UserAvatar
                  name={matchedIdentity.customerName}
                  avatarUrl={matchedIdentity.photoUrl}
                  className="xlarge"
                />
                <span>{t('customerPhoto')}</span>
              </div>
              <div className="fp-identity-finger">
                {matchedIdentity.fingerprintUrl || fingerPreview ? (
                  <img
                    src={fingerPreview || mediaUrl(matchedIdentity.fingerprintUrl) || matchedIdentity.fingerprintUrl}
                    alt={t('fingerprint')}
                  />
                ) : (
                  <Fingerprint size={72} strokeWidth={1.3} />
                )}
                <span>{t('fingerprint')}</span>
              </div>
            </div>
            <div className="fp-identity-grid">
              <div><small>{t('name')}</small><strong>{matchedIdentity.customerName || '—'}</strong></div>
              <div><small>{t('phone')}</small><strong>{matchedIdentity.phone || '—'}</strong></div>
              <div><small>{t('tazkiraNumber')}</small><strong>{matchedIdentity.documentNumber || '—'}</strong></div>
              <div><small>{t('cardNumber')}</small><strong className="ltr">{matchedIdentity.cardNumber || '—'}</strong></div>
              <div><small>{t('bankName')}</small><strong>{matchedIdentity.bankName || '—'}</strong></div>
              <div><small>{t('cardHolderName')}</small><strong>{matchedIdentity.cardHolderName || '—'}</strong></div>
            </div>
            {(matchedIdentity.balances || []).length ? (
              <div className="card-reader-balance-box" style={{ marginTop: 12 }}>
                <strong>{t('cardCustomerBalance')}</strong>
                <div className="summary-chips">
                  {matchedIdentity.balances.map((b) => (
                    <span key={`${b.currencyId}-${b.currency?.code || ''}`} className="badge info">
                      {b.currency?.code || '—'}: {money(b.amount)}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="form-actions fp-identity-actions">
              <button type="button" className="btn primary" onClick={() => setMatchedIdentity(null)}>
                بستن
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
