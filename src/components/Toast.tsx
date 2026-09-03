import { useI18n } from '../i18n/useI18n';
import { IconX } from './Icons';

export interface ToastMsg { id: number; kind: 'info' | 'ok' | 'err'; text: string }

/**
 * What the reader has to say, and how long it stays.
 *
 * 🚨 A problem does NOT expire. Confirmations may — "the whole book was read" is
 * disposable — but an error or a notice is the only trace of something that went
 * wrong, and a listener who looked away for five seconds lost it for good. That
 * happened: "j'ai eu un message, pas eu le temps de lire". A message that
 * disappears before it is read never existed, which is the same failure as never
 * showing it.
 *
 * So `err` and `info` wait for the human; `ok` still fades. Each carries its own
 * dismissal, and a stack of several carries one for all of them — the point is
 * that leaving is the READER's decision, not a timer's.
 */
export function Toasts({ items, onDismiss, onDismissAll }: {
  items: ToastMsg[];
  onDismiss: (id: number) => void;
  onDismissAll: () => void;
}) {
  const { t } = useI18n();
  if (!items.length) return null;
  // Only the ones that wait for a human are worth a "clear all".
  const waiting = items.filter(i => i.kind !== 'ok').length;
  return (
    <div className="toasts">
      {waiting > 1 && (
        <button className="toast-clear" onClick={onDismissAll}>{t('toast.dismissAll', { n: waiting })}</button>
      )}
      {items.map(item => (
        <div key={item.id} className={`toast ${item.kind === 'err' ? 'err' : item.kind === 'ok' ? 'ok' : ''}`}>
          <span className="toast-text">{item.text}</span>
          {item.kind !== 'ok' && (
            <button
              className="toast-close"
              title={t('toast.dismiss')}
              aria-label={t('toast.dismiss')}
              onClick={() => onDismiss(item.id)}
            >
              <IconX size={14} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
