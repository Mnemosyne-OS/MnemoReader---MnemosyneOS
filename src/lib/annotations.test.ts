// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NOTES_CHANGED,
  notesSettled,
  matchesPassage,
  notesKey,
  passage,
  readAnnotations,
  readBookNotes,
  writeAnnotations,
  writeGeneralNote,
  writeColorLabels,
  writeColorKey,
  type Annotation,
} from './annotations';

const loaded = {
  bookId: 'one',
  text: 'First sentence. Second sentence.',
  sentences: ['First sentence.', 'Second sentence.'],
  sentenceOffsets: [0, 16],
};
const note: Annotation = {
  id: 'a',
  startSentence: 0,
  startOffset: 6,
  endSentence: 1,
  endOffset: 6,
  quote: 'sentence. Second',
  comment: 'My thought',
  createdAt: 1,
};

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('saved book annotations', () => {
  it('persists removed colors per book without losing highlights or labels', () => {
    writeAnnotations('one', [note]);
    writeColorKey('one', { '#eed16a': 'Funny' }, ['#eed16a']);
    writeGeneralNote('one', 'Thoughts');
    expect(readBookNotes('one').hiddenColors).toEqual(['#eed16a']);
    expect(readAnnotations('one')).toEqual([note]);
    expect(readBookNotes('two').hiddenColors).toEqual([]);
    writeColorLabels('one', { '#eed16a': 'Edited' });
    expect(readBookNotes('one').hiddenColors).toEqual(['#eed16a']);
    writeColorKey('one', readBookNotes('one').colorLabels, []);
    expect(readBookNotes('one').colorLabels['#eed16a']).toBe('Edited');
  });
  it('upgrades existing highlights and preserves independent notes through edits and removals', () => {
    localStorage.setItem(notesKey('one'), JSON.stringify([note]));
    expect(readBookNotes('one')).toEqual({
      notes: [note],
      general: '',
      colorLabels: {},
      hiddenColors: [],
    });
    writeGeneralNote('one', 'My independent thoughts\nAnother line.');
    expect(readAnnotations('one')).toEqual([note]);
    expect(readBookNotes('two').general).toBe('');
    writeAnnotations('one', []);
    expect(readBookNotes('one')).toEqual({
      notes: [],
      general: 'My independent thoughts\nAnother line.',
      colorLabels: {},
      hiddenColors: [],
    });
    writeGeneralNote('one', '');
    expect(readBookNotes('one').general).toBe('');
  });
  it('keeps each book’s color meanings separate and preserves them through other note edits', () => {
    writeAnnotations('one', [note]);
    writeGeneralNote('one', 'Thoughts');
    writeColorLabels('one', { '#eed16a': 'Funny', '#123456': 'My custom meaning' });
    writeColorLabels('two', { '#eed16a': 'Questions' });
    writeAnnotations('one', []);
    writeGeneralNote('one', 'Edited');
    expect(readBookNotes('one').colorLabels).toEqual({
      '#eed16a': 'Funny',
      '#123456': 'My custom meaning',
    });
    expect(readBookNotes('two').colorLabels['#eed16a']).toBe('Questions');
    expect(() => writeColorLabels('one', { invalid: 'Bad' })).toThrow();
    writeColorLabels('one', { '#eed16a': '' });
    expect(readBookNotes('one').colorLabels['#eed16a']).toBe('');
  });
  it('anchors a selection spanning sentences and rejects changed text', () => {
    expect(passage(loaded, note)).toBe(note.quote);
    expect(matchesPassage(loaded, note)).toBe(true);
    expect(matchesPassage({ ...loaded, sentences: ['Changed.', 'Second sentence.'] }, note)).toBe(
      false
    );
    expect(passage(loaded, { ...note, startSentence: -1 })).toBe('');
    expect(passage(loaded, { ...note, endOffset: 200 })).toBe('');
  });
  it('restores comments, isolates books, and persists edits and removal', () => {
    writeAnnotations('one', [note]);
    expect(readAnnotations('one')).toEqual([note]);
    expect(readAnnotations('two')).toEqual([]);
    writeAnnotations('one', [{ ...note, comment: 'Edited' }]);
    expect(readAnnotations('one')[0].comment).toBe('Edited');
    writeAnnotations('one', []);
    expect(readAnnotations('one')).toEqual([]);
  });
  it('reports corrupt or unavailable storage instead of silently losing notes', () => {
    localStorage.setItem(notesKey('one'), '{broken');
    expect(() => readAnnotations('one')).toThrow();
    localStorage.setItem(notesKey('one'), JSON.stringify([{ quote: 'incomplete' }]));
    expect(() => readAnnotations('one')).toThrow();
    localStorage.clear();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Full', 'QuotaExceededError');
    });
    expect(() => writeAnnotations('one', [note])).toThrow();
  });
});

// Corrupt saved notes are reported, never replaced by an empty version: each
// writer reads before it writes and refuses what it cannot read.
describe('corrupt saved notes are never overwritten', () => {
  it.each([
    ['writeAnnotations', () => writeAnnotations('bad', [])],
    ['writeGeneralNote', () => writeGeneralNote('bad', 'over it')],
    ['writeColorKey', () => writeColorKey('bad', {}, [])],
  ])('%s refuses and leaves the stored text as it was', (_name, write) => {
    localStorage.setItem(notesKey('bad'), '{broken');
    expect(write).toThrow();
    expect(localStorage.getItem(notesKey('bad'))).toBe('{broken');
  });
});

it('marks a general-notes save as typing, and leaving the field as settled', () => {
  const seen: unknown[] = [];
  const on = (e: Event) => seen.push((e as CustomEvent).detail);
  window.addEventListener(NOTES_CHANGED, on);
  writeGeneralNote('typed', 'a');
  notesSettled('typed');
  writeAnnotations('typed', []);
  window.removeEventListener(NOTES_CHANGED, on);
  expect(seen).toEqual([{ bookId: 'typed', typing: true }, { bookId: 'typed' }, { bookId: 'typed' }]);
});
