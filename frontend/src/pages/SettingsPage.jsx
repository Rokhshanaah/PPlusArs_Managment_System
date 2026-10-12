import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Navigate } from 'react-router-dom';
import {
  AlertTriangle,
  Building2,
  CreditCard,
  DatabaseBackup,
  FileText,
  ListChecks,
  Lock,
  MessageCircle,
  RotateCcw,
  Save,
  Send,
  Settings2,
  Wallet,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api, messageOf } from '../api/client.js';
import { ErrorBox, Field, Loading, PageHeader } from '../components/Common.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useBranchFilter } from '../context/BranchFilterContext.jsx';
import { localizeValue, translatePlace } from '../utils/labels.js';
import { parseAppPlan, APP_PLAN_IDS } from '../utils/appPlans.js';

function latinDigits(value) {
  return String(value || '')
    .replace(/[۰-۹]/g, (ch) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(ch)))
    .replace(/[٠-٩]/g, (ch) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(ch)));
}

const DEFAULT_WHATSAPP_TEMPLATE = [
  'PPlus.Arz',
  '[عنوان رسید]',
  'نام مشتری : [نام مشتری]',
  'تاریخ [تاریخ]',
  '[بدهی قبلی] [مبلغ قبلی] [ارز]',
  '[نوع مبلغ] : [مبلغ] [ارز]',
  'الباقی حساب [الباقی] [حروف] [ارز]',
].join('\n');

/** Convert old {{code}} tokens to readable Persian labels for the settings box. */
function toFriendlyWhatsappTemplate(raw) {
  let text = String(raw || '').trim();
  if (!text) return DEFAULT_WHATSAPP_TEMPLATE;
  const map = [
    ['{{company}}', 'PPlus.Arz'],
    ['{{title}}', '[عنوان رسید]'],
    ['{{customer}}', '[نام مشتری]'],
    ['{{date}}', '[تاریخ]'],
    ['{{previous_label}}', '[بدهی قبلی]'],
    ['{{previous}}', '[مبلغ قبلی]'],
    ['{{movement_label}}', '[نوع مبلغ]'],
    ['{{amount}}', '[مبلغ]'],
    ['{{remaining}}', '[الباقی]'],
    ['{{remaining_words}}', '[حروف]'],
    ['{{currency}}', '[ارز]'],
  ];
  for (const [from, to] of map) text = text.split(from).join(to);
  return text;
}

function SettingsPanel({ icon: Icon, title, hint, children }) {
  return (
    <section className="panel settings-category">
      <header className="settings-category-head">
        <div className="settings-category-icon">
          <Icon size={18} />
        </div>
        <div>
          <h3>{title}</h3>
          {hint ? <p>{hint}</p> : null}
        </div>
      </header>
      <div className="form-grid settings-category-body">
        {children}
      </div>
    </section>
  );
}

function OnOffField({ label, value, onChange, t }) {
  return (
    <Field label={label}>
      <select value={value || 'خاموش'} onChange={(e) => onChange(e.target.value)}>
        <option value="روشن">{t('on')}</option>
        <option value="خاموش">{t('off')}</option>
      </select>
    </Field>
  );
}

export default function SettingsPage() {
  const { t } = useTranslation();
  const { show } = useToast();
  const { isSuperAdmin } = useAuth();
  const {
    branches,
    selectedBranchId,
    setSelectedBranchId,
  } = useBranchFilter();
  const [form, setForm] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [backingUpJson, setBackingUpJson] = useState(false);
  const [telegramSending, setTelegramSending] = useState(false);
  const [telegramChatLoading, setTelegramChatLoading] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [resetMode, setResetMode] = useState('full');
  const [resetCategories, setResetCategories] = useState([]);
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('company');
  const [planPin, setPlanPin] = useState('');
  const [planPinConfirm, setPlanPinConfirm] = useState('');
  const [planPinError, setPlanPinError] = useState('');
  const [planLockRegistered, setPlanLockRegistered] = useState(false);
  const [planSaving, setPlanSaving] = useState(false);
  const [planChanging, setPlanChanging] = useState(false);
  const [planChangeCurrent, setPlanChangeCurrent] = useState('');
  const [planChangeNew, setPlanChangeNew] = useState('');
  const [planChangeConfirm, setPlanChangeConfirm] = useState('');
  const [planChangeError, setPlanChangeError] = useState('');
  const [draftPlan, setDraftPlan] = useState('premium');

  const categoryLabel = (key) => t(`resetCat_${key}`, { defaultValue: key });

  const selectedPlan = parseAppPlan(form.app_plan);

  const tabs = useMemo(() => {
    const list = [
      { id: 'company', label: t('companySettings'), icon: Building2 },
    ];
    if (isSuperAdmin) {
      list.push({ id: 'appMenus', label: t('appPlan'), icon: ListChecks });
    }
    list.push({ id: 'receipts', label: t('settingsReceipts'), icon: FileText });
    if (selectedPlan.features.cardReader) {
      list.push({ id: 'cardReader', label: t('cardReader'), icon: CreditCard });
    }
    list.push(
      { id: 'cashboxes', label: t('cashboxes'), icon: Wallet },
      { id: 'security', label: t('settingsSecurity'), icon: Lock },
      { id: 'system', label: t('settingsSystem'), icon: Settings2 },
    );
    if (selectedPlan.features.whatsapp) {
      list.push({ id: 'whatsapp', label: t('whatsappSettings'), icon: MessageCircle });
    }
    list.push({ id: 'data', label: t('dataTools'), icon: DatabaseBackup });
    if (isSuperAdmin && selectedPlan.features.branches) {
      list.unshift({ id: 'branches', label: t('branches'), icon: Building2 });
    }
    return list;
  }, [t, isSuperAdmin, selectedPlan.features.cardReader, selectedPlan.features.whatsapp, selectedPlan.features.branches]);

  useEffect(() => {
    if (!tabs.some((tab) => tab.id === activeTab)) {
      setActiveTab(tabs[0]?.id || 'company');
    }
  }, [tabs, activeTab]);

  useEffect(() => {
    if (!isSuperAdmin) {
      setLoading(false);
      return;
    }
    api.get('/settings')
      .then(({ data }) => {
        const next = data.data || {};
        next.whatsapp_message_template = toFriendlyWhatsappTemplate(next.whatsapp_message_template);
        if (!next.whatsapp_send_mode) next.whatsapp_send_mode = 'simple';
        if (next.print_card_reader_photo == null) next.print_card_reader_photo = 'خاموش';
        if (next.print_card_reader_fingerprint == null) next.print_card_reader_fingerprint = 'خاموش';
        if (next.trade_show_rate_field == null) next.trade_show_rate_field = 'خاموش';
        if (next.app_plan == null) next.app_plan = 'premium';
        if (next.telegram_backup_enabled == null) next.telegram_backup_enabled = 'خاموش';
        setDraftPlan(parseAppPlan(next.app_plan).id);
        setPlanLockRegistered(Boolean(next.plan_lock_registered));
        setPlanPin('');
        setPlanPinConfirm('');
        setPlanPinError('');
        setForm(next);
      })
      .catch((e) => setError(messageOf(e)))
      .finally(() => setLoading(false));
  }, [isSuperAdmin]);

  const setValue = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...form };
      if (!String(payload.whatsapp_access_token || '').trim()) {
        delete payload.whatsapp_access_token;
      } else {
        payload.whatsapp_access_token = String(payload.whatsapp_access_token)
          .replace(/^["'\s]+|["'\s]+$/g, '')
          .replace(/\s+/g, '')
          .trim();
      }
      if (!String(payload.whatsapp_message_template || '').trim()) {
        payload.whatsapp_message_template = DEFAULT_WHATSAPP_TEMPLATE;
      } else {
        payload.whatsapp_message_template = toFriendlyWhatsappTemplate(payload.whatsapp_message_template);
      }
      delete payload.app_plan;
      delete payload.app_enabled_menus;
      delete payload.app_plan_pin;
      delete payload.app_plan_lock_hash;
      delete payload.plan_lock_registered;
      delete payload.telegram_bot_token_set;
      delete payload.telegram_backup_last_date;
      if (!String(payload.telegram_bot_token || '').trim()) {
        delete payload.telegram_bot_token;
      }
      await api.put('/settings', payload);
      show(t('success'));
      const { data } = await api.get('/settings');
      const next = data.data || {};
      next.whatsapp_message_template = toFriendlyWhatsappTemplate(next.whatsapp_message_template);
      if (next.print_card_reader_photo == null) next.print_card_reader_photo = 'خاموش';
      if (next.print_card_reader_fingerprint == null) next.print_card_reader_fingerprint = 'خاموش';
      if (next.trade_show_rate_field == null) next.trade_show_rate_field = 'خاموش';
      if (next.app_plan == null) next.app_plan = 'premium';
      if (next.telegram_backup_enabled == null) next.telegram_backup_enabled = 'خاموش';
      setPlanLockRegistered(Boolean(next.plan_lock_registered));
      setForm(next);
      window.dispatchEvent(new CustomEvent('zarin:settings:changed'));
    } catch (err) {
      show(messageOf(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  const resolveTelegramChat = async () => {
    setTelegramChatLoading(true);
    try {
      const token = String(form.telegram_bot_token || '').trim();
      const { data } = await api.post('/settings/telegram/chat-id', token ? { token } : {});
      const chatId = data?.data?.chatId || '';
      if (chatId) setValue('telegram_chat_id', chatId);
      show(data.message || t('telegramChatFound'));
    } catch (err) {
      show(messageOf(err), 'error');
    } finally {
      setTelegramChatLoading(false);
    }
  };

  const sendTelegramBackup = async () => {
    setTelegramSending(true);
    try {
      const payload = {};
      const token = String(form.telegram_bot_token || '').trim();
      const chatId = String(form.telegram_chat_id || '').trim();
      if (token) payload.token = token;
      if (chatId) payload.chat_id = chatId;
      const { data } = await api.post('/system/backup/telegram', payload);
      show(data.message || t('telegramBackupSent'));
    } catch (err) {
      show(messageOf(err), 'error');
    } finally {
      setTelegramSending(false);
    }
  };

  const downloadBackup = async (format = 'sql') => {
    const setBusy = format === 'json' ? setBackingUpJson : setBackingUp;
    setBusy(true);
    try {
      const response = await api.get('/system/backup', {
        params: { format },
        responseType: format === 'sql' ? 'blob' : 'json',
      });
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      let blob;
      let filename;
      if (format === 'sql') {
        blob = new Blob([response.data], { type: 'application/sql;charset=utf-8' });
        filename = `pplus-arz-backup-${stamp}.sql`;
      } else {
        blob = new Blob([JSON.stringify(response.data?.data || response.data, null, 2)], {
          type: 'application/json;charset=utf-8',
        });
        filename = `pplus-arz-backup-${stamp}.json`;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      show(t('backupSuccess'));
    } catch (err) {
      show(messageOf(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const openResetModal = async () => {
    setResetError('');
    setConfirmText('');
    setResetMode('full');
    setSelectedCategories([]);
    setResetOpen(true);
    setCategoriesLoading(true);
    try {
      const { data } = await api.get('/system/reset-categories');
      const list = data.data || [];
      setResetCategories(list);
      setSelectedCategories(list.map((c) => c.key));
    } catch (err) {
      setResetError(messageOf(err));
    } finally {
      setCategoriesLoading(false);
    }
  };

  const toggleCategory = (key) => {
    setSelectedCategories((prev) => (
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    ));
  };

  const runReset = async () => {
    if (confirmText.trim().toUpperCase() !== 'RESET') {
      setResetError(t('resetConfirmHint'));
      return;
    }
    if (resetMode === 'selective' && selectedCategories.length === 0) {
      setResetError(t('resetSelectAtLeastOne'));
      return;
    }
    setResetBusy(true);
    setResetError('');
    try {
      const payload = { confirm: 'RESET', mode: resetMode };
      if (resetMode === 'selective') payload.categories = selectedCategories;
      const { data } = await api.post('/system/reset', payload);
      setResetOpen(false);
      setConfirmText('');
      show(data.message || t('resetSuccess'));
    } catch (err) {
      setResetError(messageOf(err));
    } finally {
      setResetBusy(false);
    }
  };

  const registerAdminLock = async () => {
    setPlanSaving(true);
    setPlanPinError('');
    try {
      if (latinDigits(planPin).trim() !== latinDigits(planPinConfirm).trim()) {
        setPlanPinError(t('appPlanPasswordMismatch'));
        show(t('appPlanPasswordMismatch'), 'error');
        return;
      }
      await api.post('/settings/plan-lock', { password: planPin, confirm: planPinConfirm });
      setPlanLockRegistered(true);
      setPlanPin('');
      setPlanPinConfirm('');
      show(t('appPlanPasswordRegistered'));
    } catch (err) {
      const msg = messageOf(err);
      setPlanPinError(msg);
      show(msg, 'error');
    } finally {
      setPlanSaving(false);
    }
  };

  const savePlan = async () => {
    setPlanSaving(true);
    setPlanPinError('');
    try {
      const planId = parseAppPlan(draftPlan).id;
      await api.put('/settings/plan', { password: planPin, app_plan: planId });
      setValue('app_plan', planId);
      setPlanPin('');
      show(t('success'));
      window.dispatchEvent(new CustomEvent('zarin:settings:changed'));
    } catch (err) {
      const msg = messageOf(err);
      setPlanPinError(msg);
      show(msg, 'error');
    } finally {
      setPlanSaving(false);
    }
  };

  const changeAdminLock = async () => {
    setPlanChanging(true);
    setPlanChangeError('');
    try {
      if (latinDigits(planChangeNew).trim() !== latinDigits(planChangeConfirm).trim()) {
        setPlanChangeError(t('appPlanPasswordMismatch'));
        show(t('appPlanPasswordMismatch'), 'error');
        return;
      }
      await api.put('/settings/plan-lock', {
        current: planChangeCurrent,
        password: planChangeNew,
        confirm: planChangeConfirm,
      });
      setPlanChangeCurrent('');
      setPlanChangeNew('');
      setPlanChangeConfirm('');
      show(t('appPlanPasswordChanged'));
    } catch (err) {
      const msg = messageOf(err);
      setPlanChangeError(msg);
      show(msg, 'error');
    } finally {
      setPlanChanging(false);
    }
  };

  if (!isSuperAdmin) return <Navigate to="/" replace />;
  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} />;

  const showSave = activeTab !== 'data' && activeTab !== 'branches' && activeTab !== 'appMenus';

  return (
    <>
      <PageHeader title={t('settings')} />

      <div className="settings-tabs" role="tablist" aria-label={t('settings')}>
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={activeTab === id}
            className={activeTab === id ? 'active' : ''}
            onClick={() => setActiveTab(id)}
          >
            <Icon size={16} />
            <span>{label}</span>
          </button>
        ))}
      </div>

      <form className="settings-page-form" onSubmit={submit}>
        {activeTab === 'branches' && isSuperAdmin ? (
          <SettingsPanel icon={Building2} title={t('branches')} hint={t('branchFilterHint')}>
            <Field label={t('selectBranch')}>
              <select
                value={selectedBranchId || ''}
                onChange={(e) => setSelectedBranchId(e.target.value || null)}
              >
                <option value="">{t('allBranches')}</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {translatePlace(t, branch.name) || localizeValue(t, branch.name)}
                  </option>
                ))}
              </select>
            </Field>
          </SettingsPanel>
        ) : null}

        {activeTab === 'company' ? (
          <SettingsPanel icon={Building2} title={t('companySettings')} hint={t('settingsCompanyHint')}>
            {[
              ['company_name', 'companyName'],
              ['company_slogan', 'companySlogan'],
              ['company_phone', 'companyPhone'],
              ['company_email', 'companyEmail'],
              ['company_whatsapp', 'companyWhatsapp'],
              ['company_address', 'companyAddress'],
              ['public_app_url', 'publicAppUrl'],
            ].map(([key, label]) => (
              <Field
                key={key}
                label={t(label)}
                className={key === 'company_address' || key === 'public_app_url' ? 'full' : ''}
              >
                <input
                  value={form[key] || ''}
                  onChange={(e) => setValue(key, e.target.value)}
                  placeholder={key === 'public_app_url' ? 'https://hesab.example.com' : undefined}
                />
                {key === 'public_app_url' ? (
                  <small className="field-hint">{t('publicAppUrlHint')}</small>
                ) : null}
              </Field>
            ))}
          </SettingsPanel>
        ) : null}

        {activeTab === 'receipts' ? (
          <SettingsPanel icon={FileText} title={t('settingsReceipts')} hint={t('settingsReceiptsHint')}>
            <Field label={t('receiptNote')} className="full">
              <textarea rows="4" value={form.receipt_note || ''} onChange={(e) => setValue('receipt_note', e.target.value)} />
            </Field>
            <Field label={t('receiptCopies')}>
              <input
                type="number"
                min="0"
                value={form.receipt_copies ?? ''}
                onChange={(e) => setValue('receipt_copies', e.target.value)}
              />
            </Field>
            <Field label={t('defaultFee')}>
              <input
                type="number"
                min="0"
                step="any"
                value={form.default_fee ?? ''}
                onChange={(e) => setValue('default_fee', e.target.value)}
              />
            </Field>
            <Field label={t('largeTransactionLimit')}>
              <input
                type="number"
                min="0"
                value={form.large_transaction_limit ?? ''}
                onChange={(e) => setValue('large_transaction_limit', e.target.value)}
              />
            </Field>
            <OnOffField
              t={t}
              label={t('showProfitOnReceipt')}
              value={form.show_profit_on_receipt}
              onChange={(v) => setValue('show_profit_on_receipt', v)}
            />
            <OnOffField
              t={t}
              label={t('autoPrintReceipt')}
              value={form.auto_print_receipt}
              onChange={(v) => setValue('auto_print_receipt', v)}
            />
          </SettingsPanel>
        ) : null}

        {activeTab === 'cardReader' ? (
          <SettingsPanel icon={CreditCard} title={t('cardReader')} hint={t('cardReaderPrintSettingsHint')}>
            {[
              ['print_card_reader_photo', 'printCardReaderPhoto'],
              ['print_card_reader_fingerprint', 'printCardReaderFingerprint'],
            ].map(([key, label]) => (
              <label key={key} className="settings-check-row">
                <input
                  type="checkbox"
                  checked={form[key] === 'روشن'}
                  onChange={(e) => setValue(key, e.target.checked ? 'روشن' : 'خاموش')}
                />
                <span>{t(label)}</span>
              </label>
            ))}
          </SettingsPanel>
        ) : null}

        {activeTab === 'cashboxes' ? (
          <SettingsPanel icon={Wallet} title={t('cashboxes')} hint={t('settingsCashboxesHint')}>
            <label className="settings-check-row">
              <input
                type="checkbox"
                checked={form.allow_negative_cashbox === 'روشن'}
                onChange={(e) => setValue('allow_negative_cashbox', e.target.checked ? 'روشن' : 'خاموش')}
              />
              <span>{t('allowNegativeCashbox')}</span>
            </label>
          </SettingsPanel>
        ) : null}

        {activeTab === 'security' ? (
          <SettingsPanel icon={Lock} title={t('settingsSecurity')} hint={t('settingsSecurityHint')}>
            <Field label={t('sessionTimeoutMinutes')}>
              <input
                type="number"
                min="0"
                value={form.session_timeout_minutes ?? ''}
                onChange={(e) => setValue('session_timeout_minutes', e.target.value)}
              />
            </Field>
            <Field label={t('numberingStart')}>
              <input
                type="number"
                min="1"
                value={form.numbering_start ?? '1'}
                onChange={(e) => setValue('numbering_start', e.target.value)}
              />
              <small className="field-hint">{t('numberingStartHint')}</small>
            </Field>
            <OnOffField
              t={t}
              label={t('managerApproval')}
              value={form.manager_approval}
              onChange={(v) => setValue('manager_approval', v)}
            />
          </SettingsPanel>
        ) : null}

        {activeTab === 'system' ? (
          <SettingsPanel icon={Settings2} title={t('settingsSystem')} hint={t('settingsSystemHint')}>
            <OnOffField
              t={t}
              label={t('dailyBackup')}
              value={form.daily_backup}
              onChange={(v) => setValue('daily_backup', v)}
            />
            <OnOffField
              t={t}
              label={t('telegramBackupEnabled')}
              value={form.telegram_backup_enabled}
              onChange={(v) => setValue('telegram_backup_enabled', v)}
            />
            <Field label={t('telegramBotToken')} className="full">
              <input
                type="password"
                dir="ltr"
                value={form.telegram_bot_token || ''}
                onChange={(e) => setValue('telegram_bot_token', e.target.value)}
                autoComplete="off"
                placeholder={form.telegram_bot_token_set ? t('telegramTokenSaved') : t('telegramTokenPlaceholder')}
              />
              <small className="field-hint">{t('telegramBotTokenHint')}</small>
            </Field>
            <Field label={t('telegramChatId')} className="full">
              <input
                dir="ltr"
                value={form.telegram_chat_id || ''}
                onChange={(e) => setValue('telegram_chat_id', latinDigits(e.target.value))}
                autoComplete="off"
                placeholder="-1001234567890"
              />
              <small className="field-hint">{t('telegramChatIdHint')}</small>
            </Field>
            <div className="full form-actions">
              <button
                type="button"
                className="btn soft"
                disabled={telegramChatLoading}
                onClick={resolveTelegramChat}
              >
                {telegramChatLoading ? t('loading') : t('telegramFetchChat')}
              </button>
            </div>
            <label className="settings-check-row full">
              <input
                type="checkbox"
                checked={form.trade_show_rate_field !== 'خاموش'}
                onChange={(e) => setValue('trade_show_rate_field', e.target.checked ? 'روشن' : 'خاموش')}
              />
              <span>{t('tradeShowRateField')}</span>
            </label>
            <p className="full field-hint">{t('tradeShowRateFieldHint')}</p>
          </SettingsPanel>
        ) : null}

        {activeTab === 'whatsapp' ? (
          <SettingsPanel icon={MessageCircle} title={t('whatsappSettings')} hint={t('whatsappSettingsHint')}>
            {[
              ['whatsapp_enabled', 'whatsappEnabled'],
              ['whatsapp_notify_transactions', 'whatsappNotifyTransactions'],
              ['whatsapp_notify_ledger', 'whatsappNotifyLedger'],
              ['whatsapp_notify_remittances', 'whatsappNotifyRemittances'],
              ['whatsapp_notify_convert', 'whatsappNotifyConvert'],
            ].map(([key, label]) => (
              <OnOffField
                key={key}
                t={t}
                label={t(label)}
                value={form[key]}
                onChange={(v) => setValue(key, v)}
              />
            ))}
            <Field label={t('whatsappSendMode')}>
              <select
                value={form.whatsapp_send_mode || 'simple'}
                onChange={(e) => setValue('whatsapp_send_mode', e.target.value)}
              >
                <option value="simple">{t('whatsappModeSimple')}</option>
                <option value="meta">{t('whatsappModeMeta')}</option>
              </select>
            </Field>
            <Field label={t('whatsappDefaultCountryCode')}>
              <input
                value={form.whatsapp_default_country_code || ''}
                onChange={(e) => setValue('whatsapp_default_country_code', e.target.value)}
                autoComplete="off"
              />
            </Field>
            <Field label={t('whatsappMessageTemplate')} className="full">
              <textarea
                rows="10"
                value={form.whatsapp_message_template || DEFAULT_WHATSAPP_TEMPLATE}
                onChange={(e) => setValue('whatsapp_message_template', e.target.value)}
                spellCheck={false}
                dir="rtl"
              />
            </Field>
            <p className="full settings-danger-text">{t('whatsappMessageTemplateHint')}</p>
            <div className="form-actions full">
              <button
                type="button"
                className="btn soft"
                onClick={() => setValue('whatsapp_message_template', DEFAULT_WHATSAPP_TEMPLATE)}
              >
                {t('whatsappMessageTemplateReset')}
              </button>
            </div>

            {(form.whatsapp_send_mode || 'simple') === 'meta' ? (
              <>
                {[
                  ['whatsapp_phone_number_id', 'whatsappPhoneNumberId'],
                  ['whatsapp_access_token', 'whatsappAccessToken'],
                  ['whatsapp_api_version', 'whatsappApiVersion'],
                  ['whatsapp_webhook_verify_token', 'whatsappWebhookVerifyToken'],
                  ['whatsapp_template_name', 'whatsappTemplateName'],
                  ['whatsapp_template_lang', 'whatsappTemplateLang'],
                ].map(([key, label]) => (
                  <Field
                    key={key}
                    label={t(label)}
                    className={key === 'whatsapp_access_token' ? 'full' : ''}
                  >
                    <input
                      type="text"
                      value={form[key] || ''}
                      onChange={(e) => setValue(key, e.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={key === 'whatsapp_access_token' ? t('whatsappTokenPlaceholder') : undefined}
                    />
                  </Field>
                ))}
                <p className="full settings-danger-text">
                  {t('whatsappWebhookUrl')}: <code>/api/webhooks/whatsapp</code>
                </p>
              </>
            ) : null}
          </SettingsPanel>
        ) : null}

        {activeTab === 'appMenus' && isSuperAdmin ? (
          <SettingsPanel
            icon={ListChecks}
            title={t('appPlan')}
            hint={planLockRegistered ? t('appPlanLockedHint') : t('appPlanRegisterHint')}
          >
            {!planLockRegistered ? (
              <>
                <Field label={t('appPlanAdminPassword')} className="full">
                  <input
                    type="password"
                    dir="ltr"
                    value={planPin}
                    onChange={(e) => {
                      setPlanPinError('');
                      setPlanPin(latinDigits(e.target.value));
                    }}
                    autoComplete="new-password"
                  />
                </Field>
                <Field label={t('appPlanAdminPasswordConfirm')} className="full">
                  <input
                    type="password"
                    dir="ltr"
                    value={planPinConfirm}
                    onChange={(e) => {
                      setPlanPinError('');
                      setPlanPinConfirm(latinDigits(e.target.value));
                    }}
                    autoComplete="new-password"
                  />
                </Field>
                {planPinError ? <p className="full settings-danger-text">{planPinError}</p> : null}
                <div className="full form-actions">
                  <button
                    type="button"
                    className="btn primary"
                    disabled={planSaving || !planPin.trim() || !planPinConfirm.trim()}
                    onClick={registerAdminLock}
                  >
                    {planSaving ? t('loading') : t('appPlanRegister')}
                  </button>
                </div>
              </>
            ) : (
              <>
                <Field label={t('appPlanAdminPassword')} className="full">
                  <input
                    type="password"
                    dir="ltr"
                    value={planPin}
                    onChange={(e) => {
                      setPlanPinError('');
                      setPlanPin(latinDigits(e.target.value));
                    }}
                    autoComplete="off"
                  />
                </Field>
                {planPinError ? <p className="full settings-danger-text">{planPinError}</p> : null}
                <div className="full plan-grid">
                  {APP_PLAN_IDS.map((id) => (
                    <label key={id} className={`plan-card ${draftPlan === id ? 'active' : ''}`}>
                      <input
                        type="radio"
                        name="draft_app_plan"
                        value={id}
                        checked={draftPlan === id}
                        onChange={() => setDraftPlan(id)}
                      />
                      <div>
                        <h4>{t(`appPlan_${id}`)}</h4>
                        <p>{t(`appPlanHint_${id}`)}</p>
                      </div>
                    </label>
                  ))}
                </div>
                <div className="full form-actions">
                  <button
                    type="button"
                    className="btn primary"
                    disabled={planSaving || !planPin.trim()}
                    onClick={savePlan}
                  >
                    {planSaving ? t('loading') : t('appPlanSave')}
                  </button>
                </div>
                <div className="full">
                  <h4>{t('appPlanChangePassword')}</h4>
                  <p className="settings-danger-text">{t('appPlanChangePasswordHint')}</p>
                </div>
                <Field label={t('appPlanCurrentPassword')} className="full">
                  <input
                    type="password"
                    dir="ltr"
                    value={planChangeCurrent}
                    onChange={(e) => {
                      setPlanChangeError('');
                      setPlanChangeCurrent(latinDigits(e.target.value));
                    }}
                    autoComplete="off"
                  />
                </Field>
                <Field label={t('appPlanNewPassword')} className="full">
                  <input
                    type="password"
                    dir="ltr"
                    value={planChangeNew}
                    onChange={(e) => {
                      setPlanChangeError('');
                      setPlanChangeNew(latinDigits(e.target.value));
                    }}
                    autoComplete="new-password"
                  />
                </Field>
                <Field label={t('appPlanAdminPasswordConfirm')} className="full">
                  <input
                    type="password"
                    dir="ltr"
                    value={planChangeConfirm}
                    onChange={(e) => {
                      setPlanChangeError('');
                      setPlanChangeConfirm(latinDigits(e.target.value));
                    }}
                    autoComplete="new-password"
                  />
                </Field>
                {planChangeError ? <p className="full settings-danger-text">{planChangeError}</p> : null}
                <div className="full form-actions">
                  <button
                    type="button"
                    className="btn soft"
                    disabled={planChanging || !planChangeCurrent.trim() || !planChangeNew.trim() || !planChangeConfirm.trim()}
                    onClick={changeAdminLock}
                  >
                    {planChanging ? t('loading') : t('appPlanChangePassword')}
                  </button>
                </div>
              </>
            )}
          </SettingsPanel>
        ) : null}

        {activeTab === 'data' ? (
          <div className="panel settings-danger-zone" style={{ marginTop: 0 }}>
            <h3>{t('dataTools')}</h3>
            <p className="settings-danger-text">{t('dataToolsHint')}</p>
            <div className="settings-tools-actions">
              <button type="button" className="btn primary" disabled={backingUp || backingUpJson} onClick={() => downloadBackup('sql')}>
                <DatabaseBackup size={18} />
                {backingUp ? t('loading') : t('downloadBackupSql')}
              </button>
              <button type="button" className="btn soft" disabled={backingUp || backingUpJson} onClick={() => downloadBackup('json')}>
                <DatabaseBackup size={18} />
                {backingUpJson ? t('loading') : t('downloadBackupJson')}
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={telegramSending || backingUp || backingUpJson}
                onClick={sendTelegramBackup}
              >
                <Send size={18} />
                {telegramSending ? t('loading') : t('telegramSendBackup')}
              </button>
              <button type="button" className="btn danger" onClick={openResetModal}>
                <RotateCcw size={18} />
                {t('resetSystem')}
              </button>
            </div>
          </div>
        ) : null}

        {showSave ? (
          <div className="settings-save-bar">
            <button className="btn primary large" disabled={saving} type="submit">
              <Save size={18} />
              {saving ? t('loading') : t('saveSettings')}
            </button>
          </div>
        ) : null}
      </form>

      {resetOpen && createPortal(
        <div
          className="modal-backdrop"
          onMouseDown={(e) => e.target === e.currentTarget && !resetBusy && setResetOpen(false)}
        >
          <div className="modal-card confirm-delete-card reset-system-card" role="dialog" aria-modal="true">
            <div className="modal-head">
              <h3>{t('resetSystem')}</h3>
              <button
                type="button"
                className="icon-btn"
                onClick={() => !resetBusy && setResetOpen(false)}
                aria-label={t('close')}
              >
                <X size={20} />
              </button>
            </div>
            <div className="modal-body confirm-delete-body reset-system-body">
              <div className="confirm-delete-icon">
                <AlertTriangle size={28} />
              </div>
              <p className="confirm-delete-text">{t('resetSystemConfirm')}</p>
              <p className="confirm-delete-hint">{t('resetKeepUsers')}</p>

              <div className="reset-mode-switch" role="group" aria-label={t('resetMode')}>
                <button
                  type="button"
                  className={resetMode === 'full' ? 'active' : ''}
                  disabled={resetBusy}
                  onClick={() => setResetMode('full')}
                >
                  {t('resetModeFull')}
                </button>
                <button
                  type="button"
                  className={resetMode === 'selective' ? 'active' : ''}
                  disabled={resetBusy}
                  onClick={() => setResetMode('selective')}
                >
                  {t('resetModeSelective')}
                </button>
              </div>

              {resetMode === 'full' ? (
                <p className="confirm-delete-hint">{t('resetModeFullHint')}</p>
              ) : (
                <div className="reset-category-list">
                  <div className="reset-category-toolbar">
                    <span>{t('resetSelectItems')}</span>
                    <div className="reset-category-toolbar-actions">
                      <button
                        type="button"
                        className="btn soft"
                        disabled={resetBusy || categoriesLoading}
                        onClick={() => setSelectedCategories(resetCategories.map((c) => c.key))}
                      >
                        {t('selectAll')}
                      </button>
                      <button
                        type="button"
                        className="btn soft"
                        disabled={resetBusy || categoriesLoading}
                        onClick={() => setSelectedCategories([])}
                      >
                        {t('clearAll')}
                      </button>
                    </div>
                  </div>
                  {categoriesLoading ? (
                    <p className="confirm-delete-hint">{t('loading')}</p>
                  ) : (
                    resetCategories.map((cat) => (
                      <label key={cat.key} className="settings-check-row reset-category-row">
                        <input
                          type="checkbox"
                          checked={selectedCategories.includes(cat.key)}
                          disabled={resetBusy}
                          onChange={() => toggleCategory(cat.key)}
                        />
                        <span className="reset-category-label">{categoryLabel(cat.key)}</span>
                        <span className="reset-category-count">{cat.count}</span>
                      </label>
                    ))
                  )}
                </div>
              )}

              <Field label={t('resetTypeReset')}>
                <input
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder="RESET"
                  disabled={resetBusy}
                  autoComplete="off"
                />
              </Field>
              {resetError ? <div className="alert error">{resetError}</div> : null}
              <div className="form-actions confirm-delete-actions">
                <button type="button" className="btn soft" onClick={() => setResetOpen(false)} disabled={resetBusy}>
                  {t('cancel')}
                </button>
                <button type="button" className="btn danger" onClick={runReset} disabled={resetBusy}>
                  <RotateCcw size={16} />
                  {resetBusy ? t('loading') : t('resetSystem')}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.getElementById('modal-root'),
      )}
    </>
  );
}
