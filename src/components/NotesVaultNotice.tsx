import { useEffect, useState } from 'react';
import { isFramed } from '../lib/bridge';
import { VAULT_NOTES_RETRY, VAULT_NOTES_STATUS, vaultNoteFailures } from '../lib/notesVaultSync';
import { useI18n } from '../i18n/useI18n';

export function NotesVaultNotice() {
  const { t } = useI18n();
  const [failures, setFailures] = useState(vaultNoteFailures);
  useEffect(() => {
    const refresh = () => setFailures(vaultNoteFailures());
    window.addEventListener(VAULT_NOTES_STATUS, refresh);
    return () => window.removeEventListener(VAULT_NOTES_STATUS, refresh);
  }, []);
  if (!isFramed() || !failures.length) return null;
  return (
    <div className="vault-sync-notice" role="alert">
      <span>{t('vault.notice')}</span>
      <button className="chip" onClick={() => window.dispatchEvent(new Event(VAULT_NOTES_RETRY))}>
        {t('vault.retryNotes')}
      </button>
    </div>
  );
}
