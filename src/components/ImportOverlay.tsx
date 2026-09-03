import { IconX } from './Icons';
import { useI18n } from '../i18n/useI18n';

export type ImportPhase = 'downloading' | 'extracting' | 'vectorizing' | 'error';
export interface ImportJob {
  phase: ImportPhase;
  label: string;
  /** Live counter under the label (e.g. the OCR page being read). Absent when
   *  the step has nothing countable to show — never a stand-in 0. */
  detail?: string;
  error?: string;
}

const INF_PATH = 'M12 12c-2-2.67-4-4-6-4a4 4 0 1 0 0 8c2 0 4-1.33 6-4Zm0 0c2 2.67 4 4 6 4a4 4 0 0 0 0-8c-2 0-4 1.33-6 4Z';

/**
 * Full-screen ∞ loader for URL imports (download → extract → archive), with a
 * visible error state so a failed link never dead-ends silently.
 *
 * It is not a lock. `onBackground` sends it away while the import keeps running —
 * a scanned book can take an hour, and nothing about that work needs the screen.
 * The library card carries the same counter, so dismissing loses no information.
 */
export function ImportOverlay(
  { job, onClose, onBackground }: { job: ImportJob; onClose: () => void; onBackground?: () => void },
) {
  const { t } = useI18n();
  const isError = job.phase === 'error';
  const dismiss = isError ? onClose : onBackground;
  return (
    <div className="import-overlay" onClick={dismiss}>
      <div className="import-card" onClick={(e) => e.stopPropagation()}>
        {isError ? (
          <>
            <div className="import-x-badge"><IconX size={26} /></div>
            <div className="import-title">{job.label}</div>
            {job.error && <div className="import-msg">{job.error}</div>}
            <button className="btn btn-primary" onClick={onClose}>{t('import.close')}</button>
          </>
        ) : (
          <>
            <svg className="inf-loader" viewBox="0 0 24 24" width="66" height="38" aria-hidden="true">
              <path className="inf-bg" d={INF_PATH} />
              <path className="inf-trace" pathLength={100} d={INF_PATH} />
            </svg>
            <div className="import-label">{job.label}</div>
            {job.detail && <div className="import-detail">{job.detail}</div>}
            {onBackground && (
              <button className="btn btn-ghost import-bg" onClick={onBackground}>
                {t('import.background')}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
