import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../i18n/useI18n';
import { bridge } from '../lib/bridge';
import { IconChevron, IconX } from './Icons';

/** Side-by-side viewer of the original PDF: renders one page at a time host-side
 *  (pypdfium2) so scanned-vs-OCR quality can be compared without loading the whole
 *  (possibly huge) file into the sandboxed iframe. */
export function PdfCompare({ filePath, onClose }: { filePath: string; onClose: () => void }) {
  const { t } = useI18n();
  const [page, setPage] = useState(0);
  const [pages, setPages] = useState(0);
  const [img, setImg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (p: number) => {
    setLoading(true); setError(null);
    try {
      const res = await bridge.renderPage(filePath, p);
      if (!res?.success || !res.data?.image) throw new Error(res?.error || t('pdf.renderFailed'));
      setImg(`data:image/jpeg;base64,${res.data.image}`);
      setPages(res.data.pages);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setImg(null);
    } finally {
      setLoading(false);
    }
  }, [filePath, t]);

  useEffect(() => { void load(page); }, [page, load]);

  const go = (d: number) => setPage(p => Math.max(0, Math.min(p + d, (pages || 1) - 1)));

  return (
    <div className="pdf-pane">
      <div className="pdf-pane-head">
        <span className="pdf-pane-title">{t('pdf.original')}</span>
        <div className="pdf-pane-nav">
          <button className="icon-btn sm" onClick={() => go(-1)} disabled={loading || page <= 0} title={t('pdf.previousPage')}>
            <IconChevron size={16} className="flip" />
          </button>
          <span className="pdf-pane-count">{pages ? `${page + 1} / ${pages}` : '…'}</span>
          <button className="icon-btn sm" onClick={() => go(1)} disabled={loading || (pages > 0 && page >= pages - 1)} title={t('pdf.nextPage')}>
            <IconChevron size={16} />
          </button>
        </div>
        <button className="icon-btn sm" onClick={onClose} title={t('pdf.close')}><IconX size={16} /></button>
      </div>
      <div className="pdf-pane-body">
        {loading && <div className="pdf-pane-msg"><span className="pdf-spin" /> {t('pdf.rendering')}</div>}
        {error && !loading && <div className="pdf-pane-msg err">{error}</div>}
        {img && !error && <img src={img} alt={t('pdf.pageAlt', { n: page + 1 })} className="pdf-page-img" />}
      </div>
    </div>
  );
}
