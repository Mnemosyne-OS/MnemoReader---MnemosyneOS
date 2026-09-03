import type { Book } from '../lib/types';
import type { OcrProgress } from '../lib/bridge';
import { ocrLabel } from '../lib/ocrLabel';
import { useI18n } from '../i18n/useI18n';
import { IconBook, IconX } from './Icons';

function ProgressRing({ pct }: { pct: number }) {
  const r = 13;
  const c = 2 * Math.PI * r;
  const off = c * (1 - pct);
  return (
    <svg className="ring" width="34" height="34" viewBox="0 0 34 34">
      <circle className="ring-track" cx="17" cy="17" r={r} fill="none" strokeWidth="3" />
      <circle
        className="ring-fill" cx="17" cy="17" r={r} fill="none" strokeWidth="3"
        strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off}
        transform="rotate(-90 17 17)"
      />
      <text className="ring-label" x="17" y="20" textAnchor="middle">{Math.round(pct * 100)}</text>
    </svg>
  );
}

export function BookCard({ book, index, ocr, onOpen, onDelete }: {
  book: Book;
  index: number;
  /** Live OCR page counter for THIS book, while a scan is being read. Absent
   *  when there is nothing to count — an import with no OCR, or a step that
   *  cannot report. Never rendered as a 0. */
  ocr?: OcrProgress;
  onOpen: (b: Book) => void;
  onDelete: (b: Book) => void;
}) {
  const { t } = useI18n();
  const pct = book.sentenceCount > 1 ? book.progressSentence / (book.sentenceCount - 1) : 0;
  const busy = book.ingest === 'extracting' || book.ingest === 'chaptering' || book.ingest === 'vectorizing';
  const h = book.hue;
  const coverBg = `linear-gradient(150deg, hsl(${h} 62% 42%), hsl(${(h + 40) % 360} 55% 22%))`;

  return (
    <div
      className="card"
      style={{ animationDelay: `${Math.min(index * 40, 400)}ms` }}
      onClick={() => onOpen(book)}
      onContextMenu={(e) => { e.preventDefault(); onDelete(book); }}
      title={t('card.rightClick')}
    >
      <div className={`cover ${busy ? 'shimmer' : ''}`} style={{ background: coverBg }}>
        <div className="cover-spine" />
        <div className="cover-glyph"><IconBook size={20} /></div>
        <button
          className="card-del"
          title={t('card.remove')}
          onClick={(e) => { e.stopPropagation(); onDelete(book); }}
        >
          <IconX size={16} />
        </button>

        {busy && (
          <div className="badge"><span className="dot" />
            {book.ingest === 'extracting'
              ? ocrLabel(ocr, t)
              : book.ingest === 'vectorizing' ? t('card.vectorizing') : t('card.parsing')}
          </div>
        )}
        {book.ingest === 'archived' && <div className="badge archived">{t('card.ready')}</div>}
        {book.ingest === 'error' && (
          <div className="badge error" title={book.ingestError || t('card.importFailed')}>{t('card.failedRetry')}</div>
        )}

        <div className="cover-title">{book.title}</div>
        {book.author && <div className="cover-author">{book.author}</div>}
      </div>

      <div className="card-meta">
        <span className="card-meta-title">{book.chapters.length ? t('card.chapters', { n: book.chapters.length }) : t('card.noChapters')}</span>
        {pct > 0 && <ProgressRing pct={pct} />}
      </div>
    </div>
  );
}
