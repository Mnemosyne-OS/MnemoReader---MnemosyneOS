import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocalStorage } from './lib/useLocalStorage';
import { useI18n } from './i18n/useI18n';
import { useSandboxCatalogue } from './hooks/useSandboxCatalogue';
import { bridge, isFramed } from './lib/bridge';
import {
  type Book, type LoadedBook, type ReaderSettings, DEFAULT_SETTINGS, LIBRARY_VAULT,
} from './lib/types';
import { splitSentences, detectChapters, chaptersFromMarks, chunkForIngest, hueFromTitle, guessMeta } from './lib/pdf';
import { ensureLibraryVault } from './lib/vaults';
import { SAMPLE_TITLE, SAMPLE_AUTHOR, SAMPLE_TEXT } from './lib/sample';
import { Library } from './components/Library';
import { Reader } from './components/Reader';
import { Toasts, type ToastMsg } from './components/Toast';
import { ImportOverlay, type ImportJob } from './components/ImportOverlay';
import type { OcrProgress } from './lib/bridge';
import { ocrDetail } from './lib/ocrLabel';
import { ConfirmDelete } from './components/ConfirmDelete';
import { IconBook } from './components/Icons';
import { saveText, loadText, deleteText } from './lib/textStore';

/**
 * How a long import reports itself: the phase, plus the OCR page counter when
 * the host is reading a scan. `undefined` progress is not zero — it means this
 * step simply has nothing countable to show.
 */
type PhaseReporter = (p: ImportJob['phase'], ocr?: OcrProgress) => void;

const SUPPORTED = ['epub', 'pdf', 'docx', 'rtf', 'txt', 'md', 'markdown', 'rst', 'csv', 'htm', 'html', 'org'];
const basename = (p: string) => p.split(/[\\/]/).pop() || p;
const extOf = (p: string) => { const b = basename(p); const i = b.lastIndexOf('.'); return i >= 0 ? b.slice(i + 1).toLowerCase() : ''; };
const newId = () => `bk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

export default function App() {
  const { t } = useI18n();
  const [books, setBooks] = useLocalStorage<Book[]>('books', []);
  /**
   * Live OCR page counters by book id. Deliberately NOT part of `books`: that
   * array is persisted, so a counter there would survive a reload as a stale
   * number, and every page would rewrite the whole library to localStorage.
   */
  const [ocrByBook, setOcrByBook] = useState<Record<string, OcrProgress>>({});
  /** True while the user has sent the current import to the background. */
  const backgrounded = useRef(false);
  const [settings, setSettings] = useLocalStorage<ReaderSettings>('settings', DEFAULT_SETTINGS);
  const [reader, setReader] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const [importJob, setImportJob] = useState<ImportJob | null>(null);
  // Book awaiting deletion confirmation (the validation modal).
  const [confirmDelete, setConfirmDelete] = useState<Book | null>(null);
  // Bumped after a Deep-OCR re-extract to remount the reader with the fresh text.
  const [reloadNonce, setReloadNonce] = useState(0);

  // The app's own vault + one chronicle per book, entirely to the side of reading.
  useSandboxCatalogue(books);

  const loadedCache = useRef<Map<string, LoadedBook>>(new Map());
  const toastId = useRef(0);

  /**
   * 🚨 Only a CONFIRMATION expires. An error or a notice is the single trace of
   * something that went wrong, and it waits for the human — "j'ai eu un message,
   * pas eu le temps de lire" is the same loss as never having shown it.
   */
  const notify = useCallback((kind: ToastMsg['kind'], text: string) => {
    const id = ++toastId.current;
    setToasts(t => [...t, { id, kind, text }]);
    if (kind === 'ok') setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4600);
  }, [setToasts]);

  const dismissToast = useCallback((id: number) => setToasts(t => t.filter(x => x.id !== id)), []);
  // Clearing all keeps a confirmation still fading on its own timer: it is not
  // what the button is for, and removing it would fight a timeout for nothing.
  const dismissAllToasts = useCallback(() => setToasts(t => t.filter(x => x.kind === 'ok')), []);

  // On load: drop ephemeral demo books (their in-memory text is gone) and reset
  // any stale busy states left over from a previous session (never resumes ingest).
  useEffect(() => {
    setBooks(prev => {
      const cleaned = prev
        .filter(b => !b.id.startsWith('sample_'))
        // Annotated rather than asserted: the return type is what narrows
        // 'archived' | 'idle' to IngestState, where a cast would only have hidden
        // the widening to string.
        .map((b): Book => (['extracting', 'chaptering', 'vectorizing'].includes(b.ingest)
          ? { ...b, ingest: b.archived ? 'archived' : 'idle' } : b));
      return cleaned.length === prev.length && cleaned.every((b, i) => b === prev[i]) ? prev : cleaned;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Load the built-in demo text so the reader + voice can be tried without the host. */
  const loadSample = useCallback(() => {
    const id = `sample_${Date.now().toString(36)}`;
    const { sentences, offsets } = splitSentences(SAMPLE_TEXT);
    const chapters = detectChapters(SAMPLE_TEXT, offsets);
    loadedCache.current.set(id, { bookId: id, text: SAMPLE_TEXT, sentences, sentenceOffsets: offsets });
    const book: Book = {
      id, title: SAMPLE_TITLE, author: SAMPLE_AUTHOR, filePath: '', ext: 'txt',
      hue: hueFromTitle(SAMPLE_TITLE), addedAt: Date.now(),
      sentenceCount: sentences.length, chapters, progressSentence: 0,
      ingest: 'archived', archived: false,
    };
    setBooks(prev => [book, ...prev]);
    setReader(id);
  }, [setBooks]);

  const patchBook = useCallback((id: string, patch: Partial<Book>) => {
    setBooks(prev => prev.map(b => (b.id === id ? { ...b, ...patch } : b)));
  }, [setBooks]);

  /**
   * Extract → chapter → vectorize into an existing book row (also used for retry).
   * Reports each phase via `onPhase` (drives the URL-import overlay) and returns a
   * result so callers can react — while always setting the card state + toast itself.
   */
  /** Drop a book's live counter — the read is over, one way or the other. */
  const clearOcr = useCallback((id: string) => {
    setOcrByBook(m => {
      if (!(id in m)) return m;
      const next = { ...m }; delete next[id]; return next;
    });
  }, []);

  const processInto = useCallback(async (
    id: string, filePath: string, title: string, onPhase?: PhaseReporter, forceOcr = false,
  ): Promise<{ ok: boolean; error?: string }> => {
    patchBook(id, { ingest: 'extracting', ingestError: undefined });
    onPhase?.('extracting');
    try {
      const res = await bridge.extractDocument(filePath, forceOcr, (ocr) => {
        setOcrByBook(m => ({ ...m, [id]: ocr }));
        onPhase?.('extracting', ocr);
      });
      clearOcr(id);
      if (!res?.success || !res.data) throw new Error(res?.error || 'Extraction failed (host returned no data)');
      const text = res.data.text;
      if (!text.trim()) throw new Error('No readable text found — this looks like a scanned/image PDF the host could not OCR.');

      const { sentences, offsets } = splitSentences(text);
      // Prefer the document's own table of contents (EPUB) when it's rich enough;
      // a sparse/2-entry Gutenberg TOC falls back to heading detection.
      const chapters = (res.data.chapters?.length ?? 0) >= 3
        ? chaptersFromMarks(res.data.chapters!, text.length, offsets)
        : detectChapters(text, offsets);
      loadedCache.current.set(id, { bookId: id, text, sentences, sentenceOffsets: offsets });
      // Durable copy: the book must stay readable even if the source file is
      // later moved or deleted (a library outlives its sources).
      await saveText(id, text);
      patchBook(id, {
        sentenceCount: sentences.length, chapters, truncated: res.data.truncated, ingest: 'vectorizing',
      });
      onPhase?.('vectorizing');

      // Vectorize + archive into the Library vault (SHA-256 dedup host-side). Best-effort —
      // a book stays fully readable even if the vault archive fails.
      await ensureLibraryVault();
      const chunks = chunkForIngest(sentences);
      let archived = 0;
      for (const c of chunks) {
        try { await bridge.ingest(LIBRARY_VAULT, c, id); archived++; }
        catch (err) { console.warn('[MnemoReader] ingest chunk failed', err); }
      }
      patchBook(id, { ingest: 'archived', archived: archived > 0 });
      notify('ok', t('toast.importedOne', { title, n: chapters.length }));
      return { ok: true };
    } catch (err) {
      let msg = err instanceof Error ? err.message : String(err);
      // A missing source file deserves a human explanation, not a raw errno.
      clearOcr(id);
      if (/ENOENT/i.test(msg)) msg = t('toast.sourceGone', { path: filePath });
      console.error('[MnemoReader] ingest failed for', filePath, '→', msg, err);
      patchBook(id, { ingest: 'error', ingestError: msg });
      notify('err', t('toast.importFailed', { title, error: msg }));
      return { ok: false, error: msg };
    }
  }, [clearOcr, notify, patchBook, t]);

  /** Full ingest pipeline for one file on disk (creates the book row, then processes).
   *  Returns the book id + result, or null when the file is rejected before processing. */
  const ingestPath = useCallback(async (
    filePath: string, onPhase?: PhaseReporter,
  ): Promise<{ id: string; title: string; ok: boolean; error?: string } | null> => {
    const ext = extOf(filePath);
    if (!SUPPORTED.includes(ext)) { notify('err', t('toast.unsupported', { ext })); return null; }
    if (!isFramed()) { notify('err', t('toast.needHostImport')); return null; }
    const dup = books.find(b => b.filePath === filePath);
    if (dup) { notify('info', t('toast.duplicate')); return { id: dup.id, title: dup.title, ok: true }; }

    const meta = guessMeta(basename(filePath));
    const id = newId();
    const book: Book = {
      id, title: meta.title, author: meta.author, filePath, ext,
      hue: hueFromTitle(meta.title), addedAt: Date.now(),
      sentenceCount: 0, chapters: [], progressSentence: 0,
      ingest: 'extracting', archived: false,
    };
    setBooks(prev => [book, ...prev]);
    const r = await processInto(id, filePath, meta.title, onPhase);
    return { id, title: meta.title, ok: r.ok, error: r.error };
  }, [books, notify, processInto, setBooks, t]);

  const addFile = useCallback(async () => {
    try {
      const path = await bridge.selectFile(SUPPORTED);
      if (path) await ingestPath(path);
    } catch (err) { notify('err', err instanceof Error ? err.message : String(err)); }
  }, [ingestPath, notify]);

  const addFolder = useCallback(async () => {
    try {
      const dir = await bridge.selectFolder();
      if (!dir) return;
      const res = await bridge.readDir(dir);
      if (!res?.success || !res.files) { notify('err', res?.error || t('toast.folderUnreadable')); return; }
      const targets = res.files.filter(f => !f.isDirectory && SUPPORTED.includes(extOf(f.name)));
      if (!targets.length) { notify('info', t('toast.folderEmpty')); return; }
      notify('info', targets.length === 1 ? t('toast.importingOne') : t('toast.importingMany', { n: targets.length }));
      for (const f of targets) await ingestPath(f.path);
    } catch (err) { notify('err', err instanceof Error ? err.message : String(err)); }
  }, [ingestPath, notify, t]);

  /** Download a document from a pasted link, then run the normal import pipeline —
   *  with a full ∞ overlay through every phase and a visible error state on failure. */
  const addUrl = useCallback(async (rawUrl: string) => {
    const url = rawUrl.trim();
    if (!/^https?:\/\//i.test(url)) { notify('err', t('toast.badLink')); return; }
    if (!isFramed()) { notify('err', t('toast.needHostDownload')); return; }

    const PHASE_LABEL: Record<ImportJob['phase'], string> = {
      downloading: t('import.downloading'),
      extracting: t('import.extracting'),
      vectorizing: t('import.vectorizing'),
      error: t('import.failed'),
    };
    backgrounded.current = false;
    setImportJob({ phase: 'downloading', label: PHASE_LABEL.downloading });
    try {
      const res = await bridge.downloadUrl(url);
      if (!res?.success || !res.data?.path) throw new Error(res?.error || t('toast.linkFailed'));

      const out = await ingestPath(res.data.path, (p, ocr) => setImportJob({
        phase: p, label: PHASE_LABEL[p], detail: ocr ? ocrDetail(ocr, t) : undefined,
      }));
      if (!out) { setImportJob(null); return; }             // rejected pre-processing (toast shown)
      if (!out.ok) { setImportJob({ phase: 'error', label: PHASE_LABEL.error, error: out.error }); return; }

      setImportJob(null);
      // Auto-open only if the user is still watching. Yanking someone out of
      // whatever they went off to do is the opposite of "in the background".
      if (backgrounded.current) notify('ok', t('toast.importedBackground', { title: out.title }));
      else setReader(out.id);
    } catch (err) {
      setImportJob({ phase: 'error', label: t('import.downloadFailed'), error: err instanceof Error ? err.message : String(err) });
    }
  }, [ingestPath, notify, t]);

  /** Re-extract the current book with a proper OCR pass (ignores a poor embedded text
   *  layer), then remount the reader on the fresh text. Slow but high-quality. */
  const deepOcr = useCallback(async (book: Book) => {
    if (!isFramed()) { notify('err', t('toast.needHostOcr')); return; }
    backgrounded.current = false;
    setImportJob({ phase: 'extracting', label: t('import.deepOcr') });
    const r = await processInto(book.id, book.filePath, book.title,
      (p, ocr) => setImportJob({
        phase: p,
        label: p === 'extracting' ? t('import.deepOcr') : t('import.vectorizing'),
        detail: ocr ? ocrDetail(ocr, t) : undefined,
      }),
      true);
    if (!r.ok) { setImportJob({ phase: 'error', label: t('import.deepOcrFailed'), error: r.error }); return; }
    setImportJob(null);
    if (backgrounded.current) notify('ok', t('toast.importedBackground', { title: book.title }));
    setReloadNonce(n => n + 1); // remount the reader with the re-OCR'd text
  }, [notify, processInto, t]);

  const openBook = useCallback(async (book: Book) => {
    // A failed book: tapping it retries the import rather than dead-ending.
    if (book.ingest === 'error') { notify('info', t('toast.retrying', { title: book.title })); await processInto(book.id, book.filePath, book.title); return; }
    if (loadedCache.current.has(book.id)) { setReader(book.id); return; }

    // Durable cache first: a cached book opens instantly and stays readable even
    // when the source file has since been moved or deleted.
    const cachedText = await loadText(book.id);
    if (cachedText) {
      const { sentences, offsets } = splitSentences(cachedText);
      loadedCache.current.set(book.id, { bookId: book.id, text: cachedText, sentences, sentenceOffsets: offsets });
      if (!book.chapters.length || book.sentenceCount !== sentences.length) {
        patchBook(book.id, { chapters: detectChapters(cachedText, offsets), sentenceCount: sentences.length });
      }
      setReader(book.id);
      return;
    }

    // No cache (imported before the durable cache existed) → extract from the
    // source file, and backfill the cache so this book is durable from now on.
    if (!isFramed()) { notify('err', t('toast.needHostOpen')); return; }
    notify('info', t('toast.opening', { title: book.title }));
    try {
      const res = await bridge.extractDocument(book.filePath);
      if (!res?.success || !res.data) throw new Error(res?.error || 'Extraction failed');
      const { sentences, offsets } = splitSentences(res.data.text);
      loadedCache.current.set(book.id, { bookId: book.id, text: res.data.text, sentences, sentenceOffsets: offsets });
      await saveText(book.id, res.data.text);
      if (!book.chapters.length || book.sentenceCount !== sentences.length) {
        const chapters = (res.data.chapters?.length ?? 0) >= 3
          ? chaptersFromMarks(res.data.chapters!, res.data.text.length, offsets)
          : detectChapters(res.data.text, offsets);
        patchBook(book.id, { chapters, sentenceCount: sentences.length });
      }
      setReader(book.id);
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      notify('err', /ENOENT/i.test(raw)
        ? t('toast.fileMoved', { title: book.title })
        : t('toast.openFailed', { title: book.title, error: raw }));
    }
  }, [notify, patchBook, processInto, t]);

  // Right-click asks for confirmation (the sandboxed iframe blocks window.confirm(),
  // so a dedicated modal states exactly what gets deleted and what stays).
  const requestDelete = useCallback((book: Book) => { setConfirmDelete(book); }, []);

  const deleteBook = useCallback((book: Book) => {
    setConfirmDelete(null);
    loadedCache.current.delete(book.id);
    void deleteText(book.id);                      // erase the durable local copy
    setBooks(prev => prev.filter(b => b.id !== book.id));
    if (reader === book.id) setReader(null);
    notify('info', t('toast.removed', { title: book.title }));
  }, [reader, setBooks, notify, t]);

  const activeBook = reader ? books.find(b => b.id === reader) : null;
  const activeLoaded = reader ? loadedCache.current.get(reader) : null;

  return (
    <div className="app">
      {activeBook && activeLoaded ? (
        <Reader
          key={`${activeBook.id}:${reloadNonce}`}
          book={activeBook}
          loaded={activeLoaded}
          settings={settings}
          onChange={(patch) => setSettings(s => ({ ...s, ...patch }))}
          onProgress={(i) => { if (activeBook.progressSentence !== i) patchBook(activeBook.id, { progressSentence: i }); }}
          onBack={() => setReader(null)}
          onDeepOcr={() => deepOcr(activeBook)}
          notify={notify}
        />
      ) : (
        <>
          <div className="topbar">
            <div className="brand">
              <div className="brand-mark"><IconBook size={22} /></div>
              <div>
                <div className="brand-name">Mnemo<b>Reader</b></div>
                <div className="brand-sub">{t('app.tagline')}</div>
              </div>
            </div>
            <div className="topbar-spacer" />
            {!isFramed() && <span className="brand-sub">{t('app.standalone')}</span>}
          </div>
          <Library
            books={books}
            ocr={ocrByBook}
            onOpen={openBook}
            onDelete={requestDelete}
            onAddFile={addFile}
            onAddFolder={addFolder}
            onAddUrl={addUrl}
            onSample={loadSample}
            onDropPaths={(paths) => { void (async () => { for (const p of paths) await ingestPath(p); })(); }}
          />
        </>
      )}
      {importJob && (
        <ImportOverlay
          job={importJob}
          onClose={() => setImportJob(null)}
          onBackground={() => { backgrounded.current = true; setImportJob(null); }}
        />
      )}
      {confirmDelete && <ConfirmDelete book={confirmDelete} onCancel={() => setConfirmDelete(null)} onConfirm={deleteBook} />}
      <Toasts items={toasts} onDismiss={dismissToast} onDismissAll={dismissAllToasts} />
    </div>
  );
}
