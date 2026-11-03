/**
 * The agent's moves in MnemoReader (doc 149): each reaches the App's own
 * function, a name that matches two books is refused, and a long import
 * answers « started » instead of holding the call.
 */
import { describe, expect, it, vi } from 'vitest';
import { bookLine, currentChapter, findBook, findChapter, progressPercent, readerAgentHandlers, type ReaderAgentContext } from './agent';
import { readingProgress } from './progress';
import type { ReaderTransport } from './readerTransport';
import type { ReaderPlayer } from './voice';
import { DEFAULT_SETTINGS, type Book, type Chapter, type ReaderSettings } from './types';

const chapter = (title: string, sentenceStart: number): Chapter => ({ id: title, title, start: 0, end: 0, sentenceStart });
const book = (id: string, title: string, over: Partial<Book> = {}): Book => ({
  id, title, filePath: `C:/books/${id}.epub`, ext: 'epub', hue: 0, addedAt: 0,
  sentenceCount: 100, chapters: [chapter('One', 0), chapter('Two', 50)], progressSentence: 59,
  ingest: 'archived', archived: true, ...over,
});

function setup(over: Partial<ReaderAgentContext> = {}) {
  const ctx: ReaderAgentContext = {
    books: [book('bk_1', 'Dune'), book('bk_2', 'Emma'), book('bk_3', 'Emma'), book('bk_4', 'Broken', { ingest: 'error', ingestError: 'ENOENT' }), book('bk_5', 'Busy', { ingest: 'vectorizing', sentenceCount: 0 })],
    openId: null,
    importing: false,
    openBook: vi.fn(() => Promise.resolve(true)),
    closeBook: vi.fn(),
    importUrl: vi.fn(() => Promise.resolve()),
    framed: true,
    settings: { ...DEFAULT_SETTINGS },
    changeSettings: vi.fn(),
    savedSettings: () => null,
    reader: null,
    ...over,
  };
  return { ctx, h: readerAgentHandlers(() => ctx) };
}

describe('what an agent reads', () => {
  it('books lists the library with progress, and a book with no text has null progress, not 0', () => {
    const { h } = setup({ openId: 'bk_1' });
    const r = h.books();
    expect(r.total).toBe(5);
    expect(r.books[0]).toMatchObject({ id: 'bk_1', progressPercent: 60, open: true, chapters: 2 });
    expect(r.books.find((b) => b.id === 'bk_5')!.progressPercent).toBeNull();
    expect(bookLine(book('x', 'X', { ingestError: 'boom', ingest: 'error' }), null)).toMatchObject({ import: 'error', importError: 'boom' });
  });

  it('book gives the chapter reached and the titles', () => {
    const r = setup().h.book({ bookId: 'Dune' });
    expect(r).toMatchObject({ id: 'bk_1', currentChapter: 'Two', chapterTitles: ['One', 'Two'] });
    expect(currentChapter(book('y', 'Y', { chapters: [] }))).toBeNull();
    expect(progressPercent(book('z', 'Z', { progressSentence: 500 }))).toBe(100);
  });

  // The card said "✓ Finished, 100 %" while the agent read 13 % of the same book.
  it('says what the card says: a book marked finished is at 100 % and finished', () => {
    const marked = book('f', 'F', { sentenceCount: 100, progressSentence: 12, finishedAt: 1 });
    expect(progressPercent(marked)).toBe(Math.round(readingProgress(marked) * 100));
    expect(bookLine(marked, null)).toMatchObject({ progressPercent: 100, finished: true });
    expect(bookLine(book('g', 'G', { sentenceCount: 100, progressSentence: 12 }), null)).toMatchObject({ progressPercent: 12, finished: false });
  });

  it('a title naming two books is AMBIGUOUS, never the first; an unknown one lists the books', () => {
    const { h } = setup();
    expect(() => h.book({ bookId: 'Emma' })).toThrow('AMBIGUOUS: "Emma" names several books: Emma (bk_2), Emma (bk_3); say which');
    expect(() => h.book({ bookId: 'Nope' })).toThrow(/^NO_BOOK: no book named "Nope"; books: Dune, Emma \(bk_2\), Emma \(bk_3\), Broken, Busy/);
    expect(findBook([book('a', 'Dune')], 'dune').id).toBe('a');
    // The repair call says the label back, and it names one book.
    expect(h.book({ bookId: 'Emma (bk_3)' }).id).toBe('bk_3');
  });
});

describe('what an agent changes', () => {
  it("openBook calls the App's openBook and answers once it is open", async () => {
    const { ctx, h } = setup();
    expect(await h.openBook({ bookId: 'bk_2' })).toEqual({ bookId: 'bk_2', title: 'Emma', open: true });
    expect(ctx.openBook).toHaveBeenCalledWith(expect.objectContaining({ id: 'bk_2' }));
    // By the words a person says.
    expect(await h.openBook({ bookId: 'le livre Dune' })).toMatchObject({ bookId: 'bk_1' });
  });

  it('a book that did not open is said, never reported open', async () => {
    const { h } = setup({ openBook: () => Promise.resolve(false) });
    await expect(h.openBook({ bookId: 'bk_1' })).rejects.toThrow(/^OPEN_FAILED/);
  });

  it('a book still importing, or whose import failed, is refused by name and not retried', async () => {
    const { ctx, h } = setup();
    await expect(h.openBook({ bookId: 'bk_5' })).rejects.toThrow(/^NOT_READY.*vectorizing/);
    await expect(h.openBook({ bookId: 'bk_4' })).rejects.toThrow(/^IMPORT_FAILED.*ENOENT/);
    expect(ctx.openBook).not.toHaveBeenCalled();
  });

  it('closeBook goes back to the library, and says when it already is there', () => {
    const open = setup({ openId: 'bk_1' });
    expect(open.h.closeBook()).toEqual({ open: null });
    expect(open.ctx.closeBook).toHaveBeenCalledTimes(1);
    const shut = setup();
    expect(shut.h.closeBook()).toEqual({ open: null, already: true });
    expect(shut.ctx.closeBook).not.toHaveBeenCalled();
  });

  it('importUrl starts the import without waiting for it', () => {
    let finish: () => void = () => undefined;
    const { ctx, h } = setup({ importUrl: vi.fn(() => new Promise<void>((r) => { finish = r; })) });
    expect(h.importUrl({ url: 'https://example.org/book.epub' })).toEqual({ started: true, followWith: 'books' });
    expect(ctx.importUrl).toHaveBeenCalledWith('https://example.org/book.epub');
    finish();
  });

  it('importUrl refuses a non-web link, an import already running, and outside the shell', () => {
    const { ctx, h } = setup();
    expect(() => h.importUrl({ url: 'file:///C:/x.pdf' })).toThrow(/^BAD_ARG/);
    expect(() => setup({ importing: true }).h.importUrl({ url: 'https://a.b/c.pdf' })).toThrow(/^BUSY/);
    expect(() => setup({ framed: false }).h.importUrl({ url: 'https://a.b/c.pdf' })).toThrow(/^NOT_IN_SHELL/);
    expect(ctx.importUrl).not.toHaveBeenCalled();
  });
});

/** A stand-in for ReaderPlayer: the same moves the dock's buttons make, with their states. */
class FakePlayer {
  state: 'idle' | 'playing' | 'paused' | 'buffering' = 'idle';
  currentIndex = 0;
  constructor(private count: number, public stuck = false) {}
  toggle() { if (this.stuck) return; this.state = this.state === 'playing' ? 'paused' : 'playing'; }
  pause() { if (this.state === 'playing' || this.state === 'buffering') this.state = 'paused'; }
  seek(i: number) { if (!this.stuck) this.currentIndex = Math.max(0, Math.min(i, this.count - 1)); }
}

const SENTENCES = [
  'Preface sentence.', 'In the desert the spice flows.', 'The worm rises.',
  'Chapter one begins here.', 'The white whale is seen at dawn.', 'Night falls.',
  'Chapter two begins.', 'The white whale is gone.', 'The end.',
];
const novel = (over: Partial<Book> = {}) => book('bk_1', 'Dune', {
  author: 'Frank Herbert', sentenceCount: SENTENCES.length, progressSentence: 0,
  chapters: [chapter('Preface', 0), chapter('Chapter 1. The Desert', 3), chapter('Chapter 2. The Sea', 6)], ...over,
});

function reading(over: Partial<ReaderAgentContext> = {}, player = new FakePlayer(SENTENCES.length)) {
  const transport: ReaderTransport = {
    bookId: 'bk_1',
    player: player as unknown as ReaderPlayer,
    sentences: SENTENCES,
    voice: () => ({ engineLabel: 'Piper', speedRange: { min: 0.5, max: 2 }, sleepRemaining: null }),
  };
  const r = setup({ books: [novel(), book('bk_2', 'Emma'), book('bk_3', 'Emma')], openId: 'bk_1', reader: transport, ...over });
  return { ...r, player, transport };
}

describe('reading aloud by voice', () => {
  it('play starts the dock player, from a chapter named by its number or its words', async () => {
    const { h, player } = reading();
    expect(await h.play({})).toMatchObject({ state: 'playing', chapter: 'Preface' });
    player.state = 'idle';
    expect(await h.play({ chapter: '2' })).toMatchObject({ state: 'playing', chapter: 'Chapter 2. The Sea', sentence: 7 });
    expect(await h.play({ chapter: 'le désert' })).toMatchObject({ chapter: 'Chapter 1. The Desert' });
  });

  it('play with a book opens it first, and waits for its reader', async () => {
    const player = new FakePlayer(SENTENCES.length);
    const transport: ReaderTransport = { bookId: 'bk_1', player: player as unknown as ReaderPlayer, sentences: SENTENCES, voice: () => ({ engineLabel: 'x', speedRange: null, sleepRemaining: null }) };
    const ctx: ReaderAgentContext = { ...setup().ctx, books: [novel()] };
    ctx.openBook = vi.fn(() => {
      // The App switches now; the reader publishes its player a render later.
      ctx.openId = 'bk_1';
      setTimeout(() => { ctx.reader = transport; }, 60);
      return Promise.resolve(true);
    });
    const h = readerAgentHandlers(() => ctx);
    expect(await h.play({ book: 'Dune' })).toMatchObject({ bookId: 'bk_1', state: 'playing' });
    expect(ctx.openBook).toHaveBeenCalledTimes(1);
  });

  it('a reading that does not start is said, never reported', async () => {
    const { h } = reading({}, new FakePlayer(SENTENCES.length, true));
    await expect(h.play({})).rejects.toThrow(/^WRITE_FAILED/);
  });

  it('nothing open: refused with the books to name', async () => {
    const { h } = setup();
    await expect(h.pause()).rejects.toThrow(/^NO_OPEN_BOOK: .*books: Dune, Emma/);
  });

  it('a book named twice is refused, never the first opened', async () => {
    const { h, ctx } = reading({ openId: null });
    await expect(h.play({ book: 'Emma' })).rejects.toThrow(/^AMBIGUOUS: "Emma" names several books: Emma \(bk_2\), Emma \(bk_3\)/);
    expect(ctx.openBook).not.toHaveBeenCalled();
  });

  it('pause stops the reading, and says when it was not reading', async () => {
    const { h, player } = reading();
    expect(await h.pause()).toMatchObject({ already: true });
    player.state = 'playing';
    expect(await h.pause()).toMatchObject({ state: 'paused' });
  });

  it('goToChapter: next, previous, restart, and the last one is said', async () => {
    const { h, player } = reading();
    player.currentIndex = 4;
    expect(await h.goToChapter({ move: 'next' })).toMatchObject({ chapterNumber: 3, sentence: 7 });
    expect(await h.goToChapter({ move: 'previous' })).toMatchObject({ chapterNumber: 2, sentence: 4 });
    player.currentIndex = 5;
    expect(await h.goToChapter({ move: 'restart' })).toMatchObject({ sentence: 4 });
    player.currentIndex = 8;
    await expect(h.goToChapter({ move: 'next' })).rejects.toThrow(/^LAST_CHAPTER/);
    await expect(h.goToChapter({ chapter: '2', move: 'next' })).rejects.toThrow(/^BAD_ARG/);
    await expect(h.goToChapter({ chapter: 'chapter' })).rejects.toThrow(/^NO_CHAPTER: "chapter" names no chapter/);
    await expect(h.goToChapter({ chapter: '9' })).rejects.toThrow('NO_CHAPTER: "Dune" has 3 chapters, not 9');
  });

  it('a chapter number is the one the title carries, then the position; several are refused', () => {
    const b = novel({ chapters: [chapter('Preface', 0), chapter('III', 1), chapter('Part 3', 2), chapter('Two', 3)] });
    expect(() => findChapter(b, 'chapitre 3')).toThrow('AMBIGUOUS: "chapitre 3" names several chapters: III, Part 3; say which');
    expect(findChapter(b, '4')).toBe(3);
    expect(findChapter(novel(), 'chapitre 1')).toBe(1);
    expect(() => findChapter(novel({ chapters: [] }), '1')).toThrow(/^NO_CHAPTERS/);
  });

  it('goToPassage finds the one sentence, and refuses several with where they are', async () => {
    const { h } = reading();
    expect(await h.goToPassage({ words: 'the worm' })).toMatchObject({ sentence: 3 });
    await expect(h.goToPassage({ words: 'white whale' })).rejects.toThrow(/^AMBIGUOUS: "white whale" is in 2 places: Chapter 1\. The Desert: «The white whale is seen at dawn\.»; Chapter 2\. The Sea/);
    expect(await h.goToPassage({ words: 'white whale', chapter: '2' })).toMatchObject({ sentence: 8 });
    await expect(h.goToPassage({ words: 'spaceship' })).rejects.toThrow(/^NO_PASSAGE/);
  });

  it('goToPercent and skip move the dock player; a stuck player is said', async () => {
    const { h } = reading();
    expect(await h.goToPercent({ percent: 50 })).toMatchObject({ sentence: 5 });
    expect(await h.skip({ sentences: -2 })).toMatchObject({ sentence: 3 });
    expect(await h.skip({ sentences: 100 })).toMatchObject({ sentence: 9 });
    await expect(h.goToPercent({ percent: 120 })).rejects.toThrow(/^BAD_ARG/);
    await expect(reading({}, new FakePlayer(SENTENCES.length, true)).h.goToPercent({ percent: 100 })).rejects.toThrow(/^WRITE_FAILED/);
  });

  it('reading says where the reader is, and the library when nothing is open', () => {
    const { h, player } = reading();
    player.currentIndex = 4;
    expect(h.reading()).toMatchObject({ title: 'Dune', chapter: 'Chapter 1. The Desert', sentence: 5, text: 'The white whale is seen at dawn.', voice: 'Piper', speeds: [0.75, 1, 1.25, 1.5, 1.75, 2] });
    expect(setup().h.reading()).toMatchObject({ open: null, settings: { rate: 1 } });
  });
});

describe('reading settings by voice', () => {
  function withDisk(over: Partial<ReaderAgentContext> = {}, failing = false) {
    const r = reading(over);
    let disk: ReaderSettings = { ...r.ctx.settings };
    r.ctx.savedSettings = () => disk;
    r.ctx.changeSettings = vi.fn((patch: Partial<ReaderSettings>) => {
      r.ctx.settings = { ...r.ctx.settings, ...patch };
      if (!failing) disk = { ...disk, ...patch };
    });
    return r;
  }

  it('faster and slower step through the paces the voice takes; larger text; a theme; a sleep timer', async () => {
    const { h, ctx } = withDisk();
    expect(await h.setReading({ speed: 'faster' })).toMatchObject({ rate: 1.25 });
    expect(await h.setReading({ speed: 'slower' })).toMatchObject({ rate: 1 });
    expect(await h.setReading({ text: 'larger', theme: 'sepia', sleepMinutes: 15 })).toEqual({ rate: 1, theme: 'sepia', fontSize: 22, sleepMinutes: 15 });
    expect(ctx.changeSettings).toHaveBeenCalledTimes(3);
  });

  it('a voice with one pace, a pace out of range and an unknown theme are refused, nothing changed', async () => {
    const one = withDisk({ reader: { ...reading().transport, voice: () => ({ engineLabel: 'XTTS', speedRange: null, sleepRemaining: null }) } });
    await expect(one.h.setReading({ speed: 'faster' })).rejects.toThrow('NO_SPEED: XTTS reads at one speed');
    const { h, ctx } = withDisk();
    await expect(h.setReading({ rate: 3 })).rejects.toThrow(/^BAD_ARG: Piper reads from 0.5× to 2×/);
    await expect(h.setReading({ theme: 'pink' })).rejects.toThrow(/^BAD_ARG: theme/);
    await expect(h.setReading({})).rejects.toThrow(/^BAD_ARG/);
    expect(ctx.changeSettings).not.toHaveBeenCalled();
  });

  it('a change that never reaches the disk is WRITE_FAILED, never reported saved', async () => {
    vi.useFakeTimers();
    try {
      const { h } = withDisk({}, true);
      const done = h.setReading({ theme: 'paper' }).catch((e: Error) => e.message);
      await vi.advanceTimersByTimeAsync(3_000);
      expect(await done).toMatch(/^WRITE_FAILED/);
    } finally {
      vi.useRealTimers();
    }
  });
});
