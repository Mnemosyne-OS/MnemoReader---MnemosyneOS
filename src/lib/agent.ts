/**
 * agent.ts — what an agent may do in MnemoReader (doc 149), declared in
 * `mnemo-plugin.json` › agentActions and served by ReaderAgentActions while
 * the window is open.
 *
 * Each move is the App's own function behind a button: `openBook` (a tap on a
 * cover), `closeBook` (the back arrow), `importUrl` (the link field), and the
 * reading moves drive the open reader's own player (the dock's play, pause,
 * chapter and skip buttons, its speed and sleep menus, the A-/A+ and theme
 * chips), so the person sees and hears it happen.
 *
 * 🚨 The orb plans a spoken sentence in ONE model call and never reads the
 *    library first: a book and a chapter are taken by the words a person says
 *    (lib/agentFind), an id still works, and several matches are refused with
 *    their names (AMBIGUOUS), never the first taken.
 *
 * Deleting a book is NOT exposed: the person confirms it in a modal that says
 * what goes and what stays. Deep OCR (minutes of work on the person's machine),
 * the file and folder pickers and the PDF side-by-side stay with the person too.
 */
import { readingProgress } from './progress';
import type { Book, ReaderSettings } from './types';
import { findNamed, nameWords, type Named } from './agentFind';
import type { ReaderTransport } from './readerTransport';
import { BROWSER_SPEED_RANGE, FONT_MAX, FONT_MIN, FONT_STEP, SPEEDS } from './readingSteps';

export interface ReaderAgentContext {
  books: readonly Book[];
  /** Id of the book open in the reader, or null on the library. */
  openId: string | null;
  /** An import is running: its overlay is up, or a book is still extracting / vectorizing (sent to the background). */
  importing: boolean;
  /** The App's openBook: true once the book is in the reader. */
  openBook: (book: Book) => Promise<boolean>;
  closeBook: () => void;
  /** The App's addUrl (download, extract, archive). Resolves at the end. */
  importUrl: (url: string) => Promise<void>;
  /** Inside the shell: imports and the host extraction need it. */
  framed: boolean;
  /** The reader's settings as the App holds them. */
  settings: ReaderSettings;
  /** The App's setSettings, as the dock and the chips call it. */
  changeSettings: (patch: Partial<ReaderSettings>) => void;
  /** The settings as saved on disk (localStorage), or null when unreadable: a change is answered once it is THERE. */
  savedSettings: () => ReaderSettings | null;
  /** The open reader's player (lib/readerTransport), or null on the library. */
  reader: ReaderTransport | null;
}

/** Chapters listed on one book card; the rest is counted. */
export const CHAPTERS_MAX = 200;

export const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * Whole-number percentage read so far, or null when the book has no text yet.
 * The same number the library card shows (readingProgress): an assistant that
 * said "13 %" of a book the screen calls finished would contradict the screen.
 */
export function progressPercent(b: Book): number | null {
  if (b.sentenceCount <= 0) return null;
  return Math.round(readingProgress(b) * 100);
}

/** The chapter that holds the sentence reached, or null. */
export function currentChapter(b: Book): string | null {
  let found: string | null = null;
  for (const c of b.chapters) if (c.sentenceStart <= b.progressSentence) found = c.title;
  return found;
}

export function bookLine(b: Book, openId: string | null) {
  return {
    id: b.id,
    title: b.title,
    ...(b.author ? { author: b.author } : {}),
    format: b.ext,
    chapters: b.chapters.length,
    progressPercent: progressPercent(b),
    finished: !!b.finishedAt,
    import: b.ingest,
    ...(b.ingestError ? { importError: b.ingestError } : {}),
    inMemory: b.archived,
    ...(b.truncated ? { truncated: true } : {}),
    open: b.id === openId,
  };
}

/**
 * The book an agent named: by id, or by the words of its title or author
 * (« Dune », « le livre de Herbert »). Two books with one title are listed with
 * their ids, so the repair call can say which.
 */
export function findBook(books: readonly Book[], ref: string): Book {
  const twice = new Set(books.filter((b, i) => books.findIndex((o) => o.title === b.title) !== i).map((b) => b.title));
  const entries: Array<Named<Book>> = books.map((b) => ({
    item: b,
    id: b.id,
    // The id among the names: a repair call that says back « Emma (bk_2) » finds bk_2.
    names: [b.title, ...(b.author ? [b.author] : []), b.id],
    label: twice.has(b.title) ? `${b.title} (${b.id})` : b.title,
  }));
  return findNamed(entries, ref, { code: 'NO_BOOK', noun: 'book' });
}

/** Index of the chapter that holds sentence `i` (0 when the book has none). */
export function chapterIndexAt(b: Book, i: number): number {
  let found = 0;
  b.chapters.forEach((c, ci) => { if (c.sentenceStart <= i) found = ci; });
  return found;
}

const ROMAN: Array<[number, string]> = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
function roman(n: number): string {
  let out = '';
  for (const [v, r] of ROMAN) while (n >= v) { out += r; n -= v; }
  return out;
}

/**
 * The chapter an agent named, as an index. A number (« 3 », « chapitre 3 »)
 * is the chapter whose title carries it (« Chapter 3 », « III »): a preface
 * shifts positions, so the title wins; else it is the 3rd chapter. Words are
 * matched on the titles.
 */
export function findChapter(b: Book, ref: string): number {
  if (!b.chapters.length) throw new Error(`NO_CHAPTERS: "${b.title}" has no chapters; use goToPassage or goToPercent`);
  const asked = nameWords(ref);
  if (asked.length === 1 && /^\d{1,4}$/.test(asked[0])) {
    const n = Number(asked[0]);
    const tokens = new Set([String(n), ...nameWords(roman(n))]);
    const carry = b.chapters.map((_, ci) => ci).filter((ci) => nameWords(b.chapters[ci].title).some((w) => tokens.has(w)));
    if (carry.length === 1) return carry[0];
    if (carry.length > 1) throw new Error(`AMBIGUOUS: "${ref}" names several chapters: ${carry.slice(0, 12).map((ci) => b.chapters[ci].title).join(', ')}; say which`);
    if (n >= 1 && n <= b.chapters.length) return n - 1;
    throw new Error(`NO_CHAPTER: "${b.title}" has ${b.chapters.length} chapters, not ${n}`);
  }
  const entries: Array<Named<number>> = b.chapters.map((c, ci) => ({ item: ci, id: c.id, names: [c.title], label: c.title }));
  return findNamed(entries, ref, { code: 'NO_CHAPTER', noun: 'chapter' });
}

const SNIPPET = 70;
const snippet = (s: string) => (s.length > SNIPPET ? `${s.slice(0, SNIPPET)}…` : s);

/**
 * The one sentence holding every word of `words`, inside `range` (a chapter)
 * or the whole book. Several places are refused with where they are, so the
 * repair call can add words or the chapter.
 */
export function findPassage(b: Book, sentences: readonly string[], words: string, range?: { from: number; to: number; chapter: string }): number {
  const asked = nameWords(words);
  if (!asked.length) throw new Error('BAD_ARG: say a few words of the passage');
  const from = range?.from ?? 0;
  const to = Math.min(range?.to ?? sentences.length, sentences.length);
  const hits: number[] = [];
  for (let i = from; i < to; i++) {
    const have = new Set(nameWords(sentences[i]));
    if (asked.every((w) => have.has(w))) hits.push(i);
  }
  if (hits.length === 1) return hits[0];
  const inChapter = range ? ` in "${range.chapter}"` : '';
  if (!hits.length) throw new Error(`NO_PASSAGE: no sentence of "${b.title}"${inChapter} holds "${words}"; say other words`);
  const places = hits.slice(0, 6).map((i) => `${b.chapters[chapterIndexAt(b, i)]?.title ?? b.title}: «${snippet(sentences[i])}»`);
  throw new Error(`AMBIGUOUS: "${words}" is in ${hits.length} places${inChapter}: ${places.join('; ')}${hits.length > 6 ? '; …' : ''}; say more words or the chapter`);
}

const BUSY_STATES: readonly Book['ingest'][] = ['extracting', 'chaptering', 'vectorizing'];

/** How long a book just opened may take to show its reader (rule 9: every wait has an end). */
export const READER_READY_MS = 5_000;
/** How long a settings change may take to reach the disk. */
export const SAVE_MS = 2_000;
const POLL_MS = 50;

async function until<T>(probe: () => T | null, ms: number): Promise<T | null> {
  const end = Date.now() + ms;
  for (;;) {
    const v = probe();
    if (v !== null) return v;
    if (Date.now() >= end) return null;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

const playing = (t: ReaderTransport) => t.player.state === 'playing' || t.player.state === 'buffering';

const titles = (books: readonly Book[]) => {
  const all = books.map((b) => b.title);
  return all.length > 12 ? `${all.slice(0, 12).join(', ')} (+${all.length - 12})` : all.join(', ') || 'none';
};

function refuseUnopenable(b: Book): void {
  if (BUSY_STATES.includes(b.ingest)) throw new Error(`NOT_READY: "${b.title}" is still being imported (${b.ingest}); call books to see when it is done`);
  // A tap on a failed book retries the import: that is the person's gesture, not the agent's.
  if (b.ingest === 'error') throw new Error(`IMPORT_FAILED: "${b.title}" could not be imported (${b.ingestError ?? 'no reason given'}); the person can retry it from the library`);
}

/**
 * The reader to act on: the book named (opened first when it is not the one
 * on screen, as a tap on its cover does), or the one open. Waits for the
 * reader: openBook answers once the App switched, its player comes a render later.
 */
async function readerFor(get: () => ReaderAgentContext, bookRef: string): Promise<{ book: Book; t: ReaderTransport }> {
  const ctx = get();
  const on = (id: string) => {
    const c = get();
    const t = c.reader;
    const b = c.books.find((x) => x.id === id);
    return t && b && t.bookId === id && c.openId === id ? { book: b, t } : null;
  };
  if (!bookRef) {
    const open = ctx.openId ? on(ctx.openId) : null;
    if (open) return open;
    throw new Error(`NO_OPEN_BOOK: no book is open; name the book; books: ${titles(ctx.books)}`);
  }
  const b = findBook(ctx.books, bookRef);
  if (ctx.openId !== b.id) {
    refuseUnopenable(b);
    if (!(await ctx.openBook(b))) throw new Error(`OPEN_FAILED: "${b.title}" could not be opened; the reason is on the person's screen`);
  }
  const ready = await until(() => on(b.id), READER_READY_MS);
  if (!ready) throw new Error(`WRITE_FAILED: "${b.title}" did not show its reader in ${READER_READY_MS / 1000} s`);
  return ready;
}

/** Move the reader to a sentence, as the dock's seek does; answered once the player is there. */
function seekTo(t: ReaderTransport, i: number): void {
  const to = Math.max(0, Math.min(i, t.sentences.length - 1));
  t.player.seek(to);
  if (t.player.currentIndex !== to) throw new Error(`WRITE_FAILED: the reader did not move to sentence ${to + 1}`);
}

function where(b: Book, t: ReaderTransport) {
  const i = t.player.currentIndex;
  const ci = chapterIndexAt(b, i);
  return {
    bookId: b.id,
    title: b.title,
    ...(b.chapters.length ? { chapter: b.chapters[ci].title, chapterNumber: ci + 1, chapters: b.chapters.length } : {}),
    sentence: i + 1,
    sentences: t.sentences.length,
    percent: t.sentences.length > 1 ? Math.round((i / (t.sentences.length - 1)) * 100) : 0,
    state: t.player.state,
  };
}

const settingsLine = (s: ReaderSettings) => ({ rate: s.rate, theme: s.theme, fontSize: s.fontSize, sleepMinutes: s.sleepMinutes });
const THEMES: readonly ReaderSettings['theme'][] = ['night', 'sepia', 'paper'];

export function readerAgentHandlers(get: () => ReaderAgentContext) {
  return {
    // agent-actions:begin
    books: () => {
      const { books, openId } = get();
      return { total: books.length, open: openId, books: books.map((b) => bookLine(b, openId)) };
    },

    book: (args: Record<string, unknown>) => {
      const { books, openId } = get();
      const b = findBook(books, str(args.bookId));
      return {
        ...bookLine(b, openId),
        currentChapter: currentChapter(b),
        chapterTitles: b.chapters.slice(0, CHAPTERS_MAX).map((c) => c.title),
        ...(b.chapters.length > CHAPTERS_MAX ? { chaptersNotShown: b.chapters.length - CHAPTERS_MAX } : {}),
      };
    },

    openBook: async (args: Record<string, unknown>) => {
      const ctx = get();
      const b = findBook(ctx.books, str(args.bookId));
      refuseUnopenable(b);
      if (!(await ctx.openBook(b))) throw new Error(`OPEN_FAILED: "${b.title}" could not be opened; the reason is on the person's screen`);
      return { bookId: b.id, title: b.title, open: true };
    },

    closeBook: () => {
      const ctx = get();
      if (ctx.openId === null) return { open: null, already: true };
      ctx.closeBook();
      return { open: null };
    },

    importUrl: (args: Record<string, unknown>) => {
      const ctx = get();
      const url = str(args.url);
      if (!/^https?:\/\//i.test(url)) throw new Error('BAD_ARG: url must start with http:// or https://');
      if (!ctx.framed) throw new Error('NOT_IN_SHELL: imports need Mnemosyne OS around the reader');
      if (ctx.importing) throw new Error('BUSY: another link is being imported; call books to see it finish');
      // A download, an extraction and an archive can run for minutes: started, never awaited.
      void ctx.importUrl(url).catch((err: unknown) => console.warn('[MnemoReader] agent import failed:', err instanceof Error ? err.message : err));
      return { started: true, followWith: 'books' };
    },

    reading: () => {
      const ctx = get();
      const t = ctx.reader;
      const b = t && ctx.openId === t.bookId ? ctx.books.find((x) => x.id === t.bookId) : undefined;
      if (!t || !b) return { open: null, settings: settingsLine(ctx.settings) };
      const v = t.voice();
      const range = v.speedRange;
      return {
        ...where(b, t),
        text: snippet(t.sentences[t.player.currentIndex] ?? ''),
        voice: v.engineLabel,
        speeds: range ? SPEEDS.filter((x) => x >= range.min && x <= range.max) : [],
        sleepMinutesLeft: v.sleepRemaining,
        settings: settingsLine(ctx.settings),
      };
    },

    play: async (args: Record<string, unknown>) => {
      const { book, t } = await readerFor(get, str(args.book));
      const chapter = str(args.chapter);
      if (chapter) seekTo(t, book.chapters[findChapter(book, chapter)].sentenceStart);
      // A seek keeps a reading going; otherwise the dock's play button (it resumes a pause).
      if (!playing(t)) t.player.toggle();
      if (!playing(t)) throw new Error(`WRITE_FAILED: the reading of "${book.title}" did not start`);
      return where(book, t);
    },

    pause: async () => {
      const { book, t } = await readerFor(get, '');
      if (!playing(t)) return { ...where(book, t), already: true };
      t.player.pause();
      if (t.player.state !== 'paused') throw new Error(`WRITE_FAILED: the reading of "${book.title}" did not pause`);
      return where(book, t);
    },

    goToChapter: async (args: Record<string, unknown>) => {
      const chapter = str(args.chapter);
      const move = str(args.move);
      if (!chapter === !move) throw new Error('BAD_ARG: give chapter (its number or words of its title) or move (next, previous, restart), one of the two');
      const { book, t } = await readerFor(get, str(args.book));
      let ci: number;
      if (chapter) ci = findChapter(book, chapter);
      else {
        if (!book.chapters.length) throw new Error(`NO_CHAPTERS: "${book.title}" has no chapters; use goToPassage or goToPercent`);
        const now = chapterIndexAt(book, t.player.currentIndex);
        if (move === 'next') {
          if (now + 1 >= book.chapters.length) throw new Error(`LAST_CHAPTER: "${book.chapters[now].title}" is the last chapter of "${book.title}"`);
          ci = now + 1;
        } else if (move === 'previous') ci = Math.max(0, now - 1);
        else ci = now;
      }
      seekTo(t, book.chapters[ci].sentenceStart);
      return where(book, t);
    },

    goToPassage: async (args: Record<string, unknown>) => {
      const words = str(args.words);
      const { book, t } = await readerFor(get, str(args.book));
      const chapter = str(args.chapter);
      let range: { from: number; to: number; chapter: string } | undefined;
      if (chapter) {
        const ci = findChapter(book, chapter);
        range = { from: book.chapters[ci].sentenceStart, to: book.chapters[ci + 1]?.sentenceStart ?? t.sentences.length, chapter: book.chapters[ci].title };
      }
      seekTo(t, findPassage(book, t.sentences, words, range));
      return { ...where(book, t), text: snippet(t.sentences[t.player.currentIndex] ?? '') };
    },

    goToPercent: async (args: Record<string, unknown>) => {
      const pct = typeof args.percent === 'number' ? args.percent : NaN;
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new Error('BAD_ARG: percent is a number from 0 to 100');
      const { book, t } = await readerFor(get, str(args.book));
      seekTo(t, Math.round((pct / 100) * (t.sentences.length - 1)));
      return where(book, t);
    },

    skip: async (args: Record<string, unknown>) => {
      const n = typeof args.sentences === 'number' ? Math.trunc(args.sentences) : NaN;
      if (!Number.isFinite(n) || n === 0) throw new Error('BAD_ARG: sentences is a whole number, negative to go back');
      const { book, t } = await readerFor(get, '');
      seekTo(t, t.player.currentIndex + n);
      return where(book, t);
    },

    setReading: async (args: Record<string, unknown>) => {
      const ctx = get();
      const patch: Partial<ReaderSettings> = {};
      const t = ctx.reader && ctx.openId === ctx.reader.bookId ? ctx.reader : null;
      const v = t?.voice();
      // The paces the dock would offer: the open reader's engine, else the system voice's.
      const range = v ? v.speedRange : BROWSER_SPEED_RANGE;
      const voiceName = v?.engineLabel ?? 'the system voice';
      if (args.rate !== undefined || args.speed !== undefined) {
        if (!range) throw new Error(`NO_SPEED: ${voiceName} reads at one speed`);
        if (typeof args.rate === 'number') {
          if (args.rate < range.min || args.rate > range.max) throw new Error(`BAD_ARG: ${voiceName} reads from ${range.min}× to ${range.max}×`);
          patch.rate = Math.round(args.rate * 100) / 100;
        } else {
          const steps = SPEEDS.filter((x) => x >= range.min && x <= range.max);
          const cur = ctx.settings.rate;
          const faster = args.speed === 'faster';
          const next = faster ? steps.find((x) => x > cur) : [...steps].reverse().find((x) => x < cur);
          if (next === undefined) throw new Error(`BAD_ARG: ${voiceName} is already at its ${faster ? 'fastest' : 'slowest'} pace (${cur}×)`);
          patch.rate = next;
        }
      }
      if (args.theme !== undefined) {
        const theme = str(args.theme) as ReaderSettings['theme'];
        if (!THEMES.includes(theme)) throw new Error(`BAD_ARG: theme is ${THEMES.join(', ')}`);
        patch.theme = theme;
      }
      if (typeof args.fontSize === 'number') patch.fontSize = Math.max(FONT_MIN, Math.min(FONT_MAX, Math.round(args.fontSize)));
      else if (args.text === 'larger' || args.text === 'smaller') {
        patch.fontSize = Math.max(FONT_MIN, Math.min(FONT_MAX, ctx.settings.fontSize + (args.text === 'larger' ? FONT_STEP : -FONT_STEP)));
      }
      if (typeof args.sleepMinutes === 'number') patch.sleepMinutes = Math.max(0, Math.round(args.sleepMinutes));
      const keys = Object.keys(patch) as Array<keyof ReaderSettings>;
      if (!keys.length) throw new Error('BAD_ARG: give rate or speed, theme, fontSize or text, or sleepMinutes');
      ctx.changeSettings(patch);
      const saved = await until(() => {
        const s = get().savedSettings();
        return s && keys.every((k) => s[k] === patch[k]) ? s : null;
      }, SAVE_MS);
      if (!saved) throw new Error('WRITE_FAILED: the reading settings were not saved');
      return settingsLine(saved);
    },
    // agent-actions:end
  };
}
