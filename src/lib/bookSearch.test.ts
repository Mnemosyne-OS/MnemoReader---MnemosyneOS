import { expect, it } from 'vitest';
import { foldBook, searchBook } from './bookSearch';
import type { Book } from './types';
import type { Annotation } from './annotations';

const book: Book = {
  id: 'book',
  title: 'Test',
  filePath: '',
  ext: 'txt',
  hue: 0,
  addedAt: 0,
  sentenceCount: 2,
  chapters: [
    { id: 'one', title: 'First chapter', start: 0, end: 12, sentenceStart: 0 },
    { id: 'two', title: 'Second chapter', start: 13, end: 30, sentenceStart: 1 },
  ],
  progressSentence: 0,
  ingest: 'idle',
  archived: false,
};
const loaded = {
  bookId: book.id,
  text: 'Hello world. Next friendship.',
  sentences: ['Hello world.', 'Next friendship.'],
  sentenceOffsets: [0, 13],
};
const notes: Annotation[] = [
  {
    id: 'note',
    startSentence: 0,
    startOffset: 0,
    endSentence: 0,
    endOffset: 5,
    quote: 'Hello',
    comment: 'This matters to me',
    color: '#123456',
    createdAt: 1,
  },
];

it('finds case-insensitive passages in later chapters and phrases spanning sentences', () => {
  expect(searchBook(book, loaded, [], '', {}, 'FRIENDSHIP', 'book')[0]).toMatchObject({
    sentence: 1,
    title: 'Passage · Second chapter',
  });
  expect(searchBook(book, loaded, [], '', {}, 'world. Next', 'book')[0].sentence).toBe(0);
});
it('searches comments, general notes, and user-defined theme labels', () => {
  expect(searchBook(book, loaded, notes, '', {}, 'matters', 'notes')[0].noteId).toBe('note');
  expect(
    searchBook(book, loaded, notes, '', { '#123456': 'Belonging' }, 'belonging', 'notes')[0].noteId
  ).toBe('note');
  expect(
    searchBook(book, loaded, notes, 'Thinking about friendship', {}, 'friendship', 'notes')[0].kind
  ).toBe('general');
});
it('respects scope and does not invent a location for stale saved quotes', () => {
  expect(searchBook(book, loaded, notes, '', {}, 'matters', 'book')).toEqual([]);
  expect(
    searchBook(
      book,
      loaded,
      [{ ...notes[0], quote: 'Changed quote' }],
      '',
      {},
      'Changed',
      'notes'
    )[0].sentence
  ).toBeUndefined();
  expect(searchBook(book, loaded, notes, '', {}, '   ')).toEqual([]);
});

// 🚨 "İ" lowers to two units: an index in the lowered text drifts one place
// per "İ" before it, far enough here to name the next sentence.
it('finds the right sentence and snippet after letters that lengthen when lowered', () => {
  const text = 'İİİİİİİİİİ ab. Next one.';
  const turkish = { bookId: book.id, text, sentences: ['İİİİİİİİİİ ab.', 'Next one.'], sentenceOffsets: [0, 15] };
  const [hit] = searchBook(book, turkish, [], '', {}, 'ab', 'book');
  expect(hit.sentence).toBe(0);
  expect(hit.snippet).toContain('ab.');
  expect(searchBook(book, turkish, [], '', {}, 'İİ ab', 'book')).toHaveLength(1);
});

it('matches a final sigma typed either way', () => {
  const greek = { bookId: book.id, text: 'ΟΔΟΣ ΔΥΟ.', sentences: ['ΟΔΟΣ ΔΥΟ.'], sentenceOffsets: [0] };
  expect(searchBook(book, greek, [], '', {}, 'οδος', 'book')).toHaveLength(1);
  expect(searchBook(book, greek, [], '', {}, 'οδοσ', 'book')).toHaveLength(1);
});

it('centres a notes snippet on the match after letters that lengthen when lowered', () => {
  const general = `${'İ'.repeat(100)} needle ${'x'.repeat(300)}`;
  const [hit] = searchBook(book, loaded, [], general, {}, 'needle', 'notes');
  expect(hit.snippet).toContain('needle');
});

it('folds the open book once, not at every search', () => {
  const first = foldBook(loaded.text);
  searchBook(book, loaded, [], '', {}, 'hel', 'book');
  searchBook(book, loaded, [], '', {}, 'hell', 'book');
  expect(foldBook(loaded.text)).toBe(first);
  expect(foldBook('Another book.')).not.toBe(first);
});
