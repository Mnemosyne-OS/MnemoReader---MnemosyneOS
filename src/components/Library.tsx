import { useMemo, useState } from 'react';
import { useI18n } from '../i18n/useI18n';
import type { Book } from '../lib/types';
import { BookCard } from './BookCard';
import type { OcrProgress } from '../lib/bridge';
import { IconBook, IconFolder, IconPlus, IconSparkle, IconLink } from './Icons';

interface LibraryProps {
  books: Book[];
  /** Live OCR page counters, by book id — only for imports being read right now. */
  ocr?: Record<string, OcrProgress>;
  onOpen: (b: Book) => void;
  onDelete: (b: Book) => void;
  onAddFile: () => void;
  onAddFolder: () => void;
  onAddUrl: (url: string) => void;
  onSample: () => void;
  onDropPaths: (paths: string[]) => void;
}

/** Compact "paste a link" field — Enter or the button submits an http(s) document URL. */
function LinkBar({ onAddUrl, autoFocus }: { onAddUrl: (url: string) => void; autoFocus?: boolean }) {
  const { t } = useI18n();
  const [url, setUrl] = useState('');
  const submit = () => { const u = url.trim(); if (u) { onAddUrl(u); setUrl(''); } };
  return (
    <div className="linkbar">
      <IconLink size={16} />
      <input
        type="url"
        value={url}
        autoFocus={autoFocus}
        placeholder={t('library.linkPlaceholder')}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
      />
      <button className="btn btn-primary" onClick={submit} disabled={!url.trim()}>{t('library.download')}</button>
    </div>
  );
}

export function Library({ books, ocr, onOpen, onDelete, onAddFile, onAddFolder, onAddUrl, onSample, onDropPaths }: LibraryProps) {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [drag, setDrag] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle
      ? books.filter(b => b.title.toLowerCase().includes(needle) || (b.author ?? '').toLowerCase().includes(needle))
      : books;
    return [...list].sort((a, b) => b.addedAt - a.addedAt);
  }, [books, q]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDrag(false);
    const paths: string[] = [];
    for (const f of Array.from(e.dataTransfer.files)) {
      // Electron exposes the absolute path on dropped File objects.
      const p = (f as File & { path?: string }).path;
      if (p) paths.push(p);
    }
    if (paths.length) onDropPaths(paths);
  };

  if (books.length === 0) {
    return (
      <div className="library">
        <div className="empty-wrap">
          <div className="empty-inner">
            <div className="empty-orb"><IconBook size={38} /></div>
            <h2 style={{ fontSize: 24, margin: '0 0 8px', letterSpacing: '-0.02em' }}>{t('library.emptyTitle')}</h2>
            <p style={{ color: 'var(--text-faint)', margin: '0 0 24px', lineHeight: 1.6 }}>
              Add a book in any format — EPUB, PDF, DOCX, RTF, TXT, HTML, Markdown — and MnemoReader
              will read it aloud, extracting the text, finding chapters, and vectorizing it into your
              Library vault. Most formats (EPUB, DOCX, TXT, HTML…) need no OCR.
            </p>
            <div
              className={`dropzone ${drag ? 'drag' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={handleDrop}
            >
              <div style={{ display: 'flex', justifyContent: 'center', gap: 10, color: 'var(--text-dim)' }}>
                <IconSparkle size={26} />
              </div>
              <h3>{t('library.dropTitle')}</h3>
              <p>{t('library.dropSub')}</p>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                <button className="btn btn-primary" onClick={onAddFile}><IconPlus size={16} /> {t('library.addBook')}</button>
                <button className="btn" onClick={onAddFolder}><IconFolder size={16} /> {t('library.importFolder')}</button>
              </div>
              <div style={{ marginTop: 14 }}><LinkBar onAddUrl={onAddUrl} /></div>
              <button className="btn btn-ghost" onClick={onSample} style={{ marginTop: 12 }}>
                <IconSparkle size={15} /> {t('library.sample')}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="library"
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={handleDrop}
    >
      <div className="library-head">
        <div>
          <div className="library-title">{t('library.title')}</div>
          <div className="library-count">{books.length} book{books.length !== 1 ? 's' : ''}</div>
        </div>
        <div className="library-actions">
          <div className="search">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('library.search')} />
          </div>
          <button className={`btn ${linkOpen ? 'on' : ''}`} onClick={() => setLinkOpen(v => !v)}><IconLink size={16} /> {t('library.link')}</button>
          <button className="btn" onClick={onAddFolder}><IconFolder size={16} /> {t('library.folder')}</button>
          <button className="btn btn-primary" onClick={onAddFile}><IconPlus size={16} /> {t('library.addBookShort')}</button>
        </div>
      </div>

      {linkOpen && <LinkBar onAddUrl={(u) => { onAddUrl(u); setLinkOpen(false); }} autoFocus />}

      <div className="grid">
        {filtered.map((b, i) => (
          <BookCard key={b.id} book={b} index={i} ocr={ocr?.[b.id]} onOpen={onOpen} onDelete={onDelete} />
        ))}
      </div>
    </div>
  );
}
