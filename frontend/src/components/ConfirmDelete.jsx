import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { messageOf } from '../api/client.js';

const API_ERROR_KEYS = [
  ['گردش مالی دارد و حذف آن مجاز نیست', 'cannotDeleteHasActivity'],
  ['گردش مالی دارد و حذف نمی‌شود', 'cannotDeleteHasActivity'],
  ['صندوق دارد و حذف نمی‌شود', 'cannotDeleteHasCashboxes'],
  ['حساب مدیر اصلی حذف نمی‌شود', 'cannotDeleteAdmin'],
  ['حساب خود را حذف نمی‌توانید', 'cannotDeleteSelf'],
  ['پیدا نشد', 'notFound'],
  ['قبلاً برگشت', 'alreadyReversed'],
  ['موجودی ارز دریافتی برای برگشت', 'cannotReverseInsufficient'],
  ['فقط حواله در انتظار', 'cannotEditPaidRemittance'],
  ['حواله پرداخت‌شده قابل', 'cannotDeletePaidRemittance'],
  ['قبلاً لغو', 'alreadyCancelled'],
];

export function translateApiError(t, error) {
  const raw = messageOf(error);
  for (const [needle, key] of API_ERROR_KEYS) {
    if (String(raw).includes(needle)) return t(key);
  }
  return raw === 'خطا رخ داد.' ? t('error') : raw;
}

export function ConfirmDelete({
  open,
  title,
  itemLabel,
  message,
  confirmLabel,
  error,
  busy = false,
  onClose,
  onConfirm,
}) {
  const { t } = useTranslation();
  if (!open) return null;

  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal-card confirm-delete-card" role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>{title || t('delete')}</h3>
          <button type="button" className="icon-btn" onClick={onClose} disabled={busy} aria-label={t('close')}>
            <X size={20} />
          </button>
        </div>
        <div className="modal-body confirm-delete-body">
          <div className="confirm-delete-icon">
            <AlertTriangle size={28} />
          </div>
          <p className="confirm-delete-text">
            {message || t('confirmDelete')}
            {itemLabel ? <strong> {itemLabel}</strong> : null}
          </p>
          <p className="confirm-delete-hint">{t('deleteBlockedHint')}</p>
          {error ? <div className="alert error">{error}</div> : null}
          <div className="form-actions confirm-delete-actions">
            <button type="button" className="btn soft" onClick={onClose} disabled={busy}>
              {t('cancel')}
            </button>
            <button type="button" className="btn danger" onClick={onConfirm} disabled={busy}>
              <Trash2 size={16} />
              {busy ? t('loading') : (confirmLabel || t('delete'))}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.getElementById('modal-root'),
  );
}

/** Shared delete confirm flow with circulation-safe API handling. */
export function useDeleteConfirm({ onDeleted, translateLabel, title, message, confirmLabel } = {}) {
  const { t } = useTranslation();
  const [target, setTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const askDelete = useCallback((row, deleteRequest) => {
    setError('');
    setTarget({ row, deleteRequest });
  }, []);

  const close = useCallback(() => {
    if (busy) return;
    setTarget(null);
    setError('');
  }, [busy]);

  const confirm = useCallback(async () => {
    if (!target?.deleteRequest) return;
    setBusy(true);
    setError('');
    try {
      await target.deleteRequest(target.row);
      setTarget(null);
      onDeleted?.(target.row);
    } catch (e) {
      setError(translateApiError(t, e));
    } finally {
      setBusy(false);
    }
  }, [target, onDeleted, t]);

  const itemLabel = target?.row && translateLabel
    ? translateLabel(target.row)
    : (target?.row?.name || target?.row?.number || '');

  const dialog = (
    <ConfirmDelete
      open={Boolean(target)}
      title={title}
      message={message}
      confirmLabel={confirmLabel}
      itemLabel={itemLabel}
      error={error}
      busy={busy}
      onClose={close}
      onConfirm={confirm}
    />
  );

  return { askDelete, dialog };
}
