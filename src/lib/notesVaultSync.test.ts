// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { notesKey, writeAnnotations, writeGeneralNote, writeColorLabels, type Annotation } from './annotations';
import { bookNoteChunks, markVaultSyncError, noteVaultState, removeBookNotes, syncBookNotes } from './notesVaultSync';
import { NOTES_PART_SPINE, NOTES_SPINE, PART_LIMIT } from './readerVault';
import { fakeVaultHost } from '../test/fakeVaultHost';
import en from '../i18n/locales/en.json';
import type { Book } from './types';

const book: Book = {
  id: 'book-one',
  title: 'My book',
  author: 'An author',
  filePath: '',
  ext: 'txt',
  hue: 0,
  addedAt: 0,
  sentenceCount: 2,
  chapters: [{ id: 'chapter', title: 'Chapter One', start: 0, end: 100, sentenceStart: 0 }],
  progressSentence: 0,
  ingest: 'idle',
  archived: true,
};
const vault = 'APP-MNEMO-READER';
const CATALOGUE = 'Book catalogue entry — must stay';
let fake: ReturnType<typeof fakeVaultHost>;
const notes = () => fake.host.rows.filter((r) => r.content.startsWith('[MNEMOREADER-NOTES:'));
const ingests = () => fake.invoke.mock.calls.filter(([action]) => action === 'social.ingest');

const highlight = (i: number, comment: string, quote = `Quote number ${i}`): Annotation => ({
  id: `h${i}`,
  startSentence: 0,
  startOffset: i,
  endSentence: 0,
  endOffset: i + 1,
  quote,
  comment,
  createdAt: i,
});

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('crypto', webcrypto);
  fake = fakeVaultHost();
  fake.host.rows.push({ id: 1, content: CATALOGUE, spine: 'READER_BOOK' });
  fake.host.nextId = 2;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('exports book/chapter provenance, quotes, comments, general notes, and color meanings', async () => {
  writeAnnotations(book.id, [{ ...highlight(0, 'My response', 'Quote'), color: '#123456' }]);
  writeGeneralNote(book.id, 'My independent note');
  writeColorLabels(book.id, { '#123456': 'Questions' });
  await syncBookNotes(vault, [book], fake.api);
  const text = notes()[0].content;
  for (const value of ['My book', 'An author', 'Chapter One', 'Quote', 'My response', 'My independent note', 'Questions'])
    expect(text).toContain(value);
  expect(text).toContain("Quoted passages are the book's words, not the reader's views");
  expect(text).toContain('reader-defined labels, not inferred themes');
  expect(noteVaultState(book.id)?.phase).toBe('synced');
  await syncBookNotes(vault, [book], fake.api);
  expect(ingests()).toHaveLength(1);
});

// A book never annotated used to show "previous copies have been removed" on
// every pass, and the failure banner counted it as pending notes.
it('gives a book that never had notes no status, and no failure banner', async () => {
  await syncBookNotes(vault, [book], fake.api);
  await syncBookNotes(vault, [book], fake.api);
  expect(noteVaultState(book.id)).toBeUndefined();
  expect(fake.invoke.mock.calls.filter(([a]) => a !== 'social.query')).toHaveLength(0);
  markVaultSyncError([book], new Error('NO_SANDBOX'));
  expect(noteVaultState(book.id)).toBeUndefined();
  writeGeneralNote(book.id, 'Now it has one');
  markVaultSyncError([book], new Error('NO_SANDBOX'));
  expect(noteVaultState(book.id)?.phase).toBe('error');
});

it('says previous copies were removed only when some were', async () => {
  writeGeneralNote(book.id, 'Soon cleared');
  await syncBookNotes(vault, [book], fake.api);
  writeGeneralNote(book.id, '');
  await syncBookNotes(vault, [book], fake.api);
  expect(noteVaultState(book.id)?.key).toBe('vault.cleared');
});

it('replaces edits, removes cleared notes, and keeps unrelated catalogue records', async () => {
  writeGeneralNote(book.id, 'Old thoughts');
  await syncBookNotes(vault, [book], fake.api);
  writeGeneralNote(book.id, 'New thoughts');
  await syncBookNotes(vault, [book], fake.api);
  expect(notes()).toHaveLength(1);
  expect(notes()[0].content).toContain('New thoughts');
  expect(notes()[0].content).not.toContain('Old thoughts');
  writeGeneralNote(book.id, '');
  await syncBookNotes(vault, [book], fake.api);
  expect(fake.host.rows.map((r) => r.content)).toEqual([CATALOGUE]);
});

// 🚨 The host near-deduplicates social spines on their first 1000 characters
// and answers the OLD id: under SOCIAL_NODE this edit was never stored while
// the screen said "synced".
it('stores an edit made past the first 1000 characters, under the app own spine', async () => {
  const many = Array.from({ length: 8 }, (_, i) => highlight(i, `Comment ${i}`));
  writeAnnotations(book.id, many);
  await syncBookNotes(vault, [book], fake.api);
  const before = notes()[0].content;
  expect(before.indexOf('Comment 7')).toBeGreaterThan(1000);
  writeAnnotations(book.id, [...many.slice(0, 7), highlight(7, 'Comment 7, changed my mind')]);
  await syncBookNotes(vault, [book], fake.api);
  expect(notes().map((r) => r.content).join('\n')).toContain('Comment 7, changed my mind');
  expect(notes().map((r) => r.content).join('\n')).not.toContain('Comment 7\n');
  expect(new Set(ingests().map(([, p]) => (p as { spineType: string }).spineType))).toEqual(new Set([NOTES_SPINE]));
  expect(noteVaultState(book.id)?.phase).toBe('synced');
});

// 🚨 SOCIAL_NODE goes through the PromptShield, which refuses ordinary prose.
it('stores a quoted passage the PromptShield would refuse', async () => {
  writeAnnotations(book.id, [highlight(0, 'Chilling line', 'You are now the keeper of the lantern.')]);
  await syncBookNotes(vault, [book], fake.api);
  expect(noteVaultState(book.id)?.phase).toBe('synced');
  expect(notes()[0].content).toContain('You are now the keeper of the lantern.');
});

// 🚨 With no inline vector the host re-chunks at 2000 characters and returns the
// first id only: the other pieces lack our marker and could never be forgotten.
it('writes parts the host never re-chunks, so a deleted book leaves nothing behind', async () => {
  fake.host.embedFails = true;
  writeAnnotations(book.id, Array.from({ length: 40 }, (_, i) => highlight(i, `A long comment ${i} `.repeat(12))));
  writeGeneralNote(book.id, 'G'.repeat(5000));
  const chunks = bookNoteChunks(book);
  expect(chunks.length).toBeGreaterThan(5);
  for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(PART_LIMIT);
  await syncBookNotes(vault, [book], fake.api);
  expect(fake.host.rows.filter((r) => r.content !== CATALOGUE).every((r) => r.content.startsWith('[MNEMOREADER-NOTES:v2:'))).toBe(true);
  expect(notes()).toHaveLength(chunks.length);
  expect(notes().filter((r) => r.spine === NOTES_SPINE)).toHaveLength(1);
  expect(notes().filter((r) => r.spine === NOTES_PART_SPINE)).toHaveLength(chunks.length - 1);
  removeBookNotes(book.id);
  await syncBookNotes(vault, [], fake.api);
  expect(fake.host.rows.map((r) => r.content)).toEqual([CATALOGUE]);
});

it('keeps a highlight whole in one part unless it alone is longer than a part', () => {
  writeAnnotations(book.id, Array.from({ length: 30 }, (_, i) => highlight(i, `Comment ${i} `.repeat(10))));
  const chunks = bookNoteChunks(book);
  for (let i = 0; i < 30; i++) {
    const holding = chunks.filter((c) => c.includes(`Quoted passage: Quote number ${i}\n`));
    expect(holding).toHaveLength(1);
    expect(holding[0]).toContain(`Reader comment: ${`Comment ${i} `.repeat(10).trim()}`);
  }
  writeGeneralNote(book.id, 'word '.repeat(1000));
  const long = bookNoteChunks(book).filter((c) => c.includes('word word'));
  expect(long.length).toBeGreaterThan(2);
  expect(long.slice(1).every((c) => c.includes('General notes (continued): word'))).toBe(true);
});

// A part read alone must still tell the book's words from the reader's: the
// rest of a long quote used to start with a bare "(continued)".
it('labels the continuation of a long quote and of a long comment', () => {
  writeAnnotations(book.id, [highlight(0, 'mine '.repeat(500), 'theirs '.repeat(500))]);
  const chunks = bookNoteChunks(book);
  const quoteParts = chunks.filter((c) => c.includes('theirs'));
  const commentParts = chunks.filter((c) => c.includes('mine'));
  expect(quoteParts.length).toBeGreaterThan(1);
  expect(commentParts.length).toBeGreaterThan(1);
  for (const part of quoteParts) expect(part).toMatch(/(Quoted passage|Quoted passage \(continued\)): theirs/);
  for (const part of commentParts) expect(part).toMatch(/(Reader comment|Reader comment \(continued\)): mine/);
  for (const part of chunks) expect(part.length).toBeLessThanOrEqual(PART_LIMIT);
});

it('writes no author line for a book without one, never a made-up name', () => {
  writeGeneralNote(book.id, 'A note');
  expect(bookNoteChunks({ ...book, author: undefined })[0]).not.toMatch(/Author:/);
  expect(bookNoteChunks(book)[0]).toContain('Author: An author');
});

// The state carries a key, translated at render: a message frozen in the
// language of the moment would survive a live language switch.
it('reports every sync state as a key of the locale files, the host error as a var', async () => {
  const keyOf = (k: string) => k.split('.').reduce<unknown>((o, part) => (o as Record<string, unknown>)?.[part], en);
  const seen: string[] = [];
  window.addEventListener('mnemoreader:vault-notes-status', () => {
    const s = noteVaultState(book.id);
    if (s) seen.push(s.key);
  });
  writeGeneralNote(book.id, 'Keyed');
  await syncBookNotes(vault, [book], fake.api);
  writeGeneralNote(book.id, 'Keyed again');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  fake.host.failNextIngest = new Error('HOST_SAID_NO');
  await syncBookNotes(vault, [book], fake.api);
  expect(seen).toEqual(expect.arrayContaining(['vault.syncing', 'vault.synced', 'vault.failed']));
  for (const key of seen) expect(typeof keyOf(key)).toBe('string');
  expect(noteVaultState(book.id)?.vars?.error).toContain('HOST_SAID_NO');
});

it('retains the old remote version and local notes when a replacement fails, then retries', async () => {
  writeGeneralNote(book.id, 'Original');
  await syncBookNotes(vault, [book], fake.api);
  writeGeneralNote(book.id, 'Edited');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  fake.host.failNextIngest = new Error('Permission denied');
  await syncBookNotes(vault, [book], fake.api);
  expect(notes()[0].content).toContain('Original');
  expect(localStorage.getItem(notesKey(book.id))).toContain('Edited');
  expect(noteVaultState(book.id)?.phase).toBe('error');
  await syncBookNotes(vault, [book], fake.api);
  expect(notes()).toHaveLength(1);
  expect(notes()[0].content).toContain('Edited');
});

it('queues confirmed book deletion and does not treat missing local books as consent to purge', async () => {
  writeGeneralNote(book.id, 'Keep until removed');
  await syncBookNotes(vault, [book], fake.api);
  await syncBookNotes(vault, [], fake.api);
  expect(notes()).toHaveLength(1);
  removeBookNotes(book.id);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  fake.host.forgetAnswer = { success: false, error: 'Host unavailable' };
  await syncBookNotes(vault, [], fake.api);
  expect(notes()).toHaveLength(1);
  expect(noteVaultState(book.id)?.phase).toBe('error');
  await syncBookNotes(vault, [], fake.api);
  expect(notes()).toHaveLength(0);
  expect(localStorage.getItem(notesKey(book.id))).toBeNull();
});

it('recovers a remote write after losing sync history without duplicating it', async () => {
  writeGeneralNote(book.id, 'Recover this');
  await syncBookNotes(vault, [book], fake.api);
  localStorage.removeItem(`mnemoreader.notes-vault-v1:${vault}`);
  await syncBookNotes(vault, [book], fake.api);
  expect(ingests()).toHaveLength(1);
  expect(notes()).toHaveLength(1);
});

// 🚨 After a sandbox purge the ids start again: a journal id can name another row.
it('never forgets an id the listing does not show with this book marker', async () => {
  writeGeneralNote(book.id, 'Before the purge');
  await syncBookNotes(vault, [book], fake.api);
  const oldId = notes()[0].id;
  fake.host.rows = [{ id: oldId, content: 'Another book entry that took the id', spine: 'READER_BOOK' }];
  fake.host.nextId = oldId + 1;
  writeGeneralNote(book.id, 'After the purge');
  await syncBookNotes(vault, [book], fake.api);
  expect(fake.host.rows.find((r) => r.id === oldId)?.content).toBe('Another book entry that took the id');
  expect(notes()[0].content).toContain('After the purge');
  expect(fake.invoke.mock.calls.some(([action, p]) => action === 'vault.sandbox.forget' && (p as { ids: number[] }).ids.includes(oldId))).toBe(false);
});

// 🚨 A full listing (200 rows) used to make an already-missing id throw on every pass.
it('does not fail when an old copy is already gone and the listing is full', async () => {
  writeGeneralNote(book.id, 'First');
  await syncBookNotes(vault, [book], fake.api);
  for (let i = 0; i < 250; i++) fake.host.rows.push({ id: fake.host.nextId++, content: `Other ${i}`, spine: 'READER_BOOK' });
  fake.host.rows = fake.host.rows.filter((r) => !r.content.startsWith('[MNEMOREADER-NOTES:'));
  writeGeneralNote(book.id, 'Second');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  await syncBookNotes(vault, [book], fake.api);
  expect(noteVaultState(book.id)?.phase).toBe('synced');
  expect(notes()[0].content).toContain('Second');
  // Seen again later with our marker: forgotten then.
  await syncBookNotes(vault, [book], fake.api);
  expect(noteVaultState(book.id)?.phase).toBe('synced');
});

it('accepts a forget that finds a copy already gone, even with a full listing', async () => {
  writeGeneralNote(book.id, 'First');
  await syncBookNotes(vault, [book], fake.api);
  // 199 newer rows: the listing is full (200) and still reaches the first copy.
  for (let i = 0; i < 199; i++) fake.host.rows.push({ id: fake.host.nextId++, content: `Other ${i}`, spine: 'READER_BOOK' });
  writeGeneralNote(book.id, 'Second');
  // Another device forgot the old copy between our listing and our forget.
  fake.host.forgetAnswer = (ids: number[]) => {
    fake.host.rows = fake.host.rows.filter((r) => !ids.includes(r.id));
    return { success: true, forgotten: 0 };
  };
  await syncBookNotes(vault, [book], fake.api);
  expect(noteVaultState(book.id)?.phase).toBe('synced');
  expect(notes().map((r) => r.content.includes('Second'))).toEqual([true]);
});

it('forgets an old copy once a full listing shows it again', async () => {
  writeGeneralNote(book.id, 'First');
  await syncBookNotes(vault, [book], fake.api);
  const first = notes()[0];
  // 250 newer rows push the first copy out of the 200-row listing.
  for (let i = 0; i < 250; i++) fake.host.rows.push({ id: fake.host.nextId++, content: `Other ${i}`, spine: 'READER_BOOK' });
  writeGeneralNote(book.id, 'Second');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  await syncBookNotes(vault, [book], fake.api);
  expect(fake.host.rows).toContainEqual(first);
  // The other rows go: the old copy is listed again, with our marker.
  fake.host.rows = fake.host.rows.filter((r) => !r.content.startsWith('Other'));
  await syncBookNotes(vault, [book], fake.api);
  expect(notes().map((r) => r.content.includes('Second'))).toEqual([true]);
});

it('keeps a deletion pending while a full listing does not reach its copies', async () => {
  writeGeneralNote(book.id, 'To delete');
  await syncBookNotes(vault, [book], fake.api);
  const copy = notes()[0];
  for (let i = 0; i < 250; i++) fake.host.rows.push({ id: fake.host.nextId++, content: `Other ${i}`, spine: 'READER_BOOK' });
  removeBookNotes(book.id);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  await syncBookNotes(vault, [], fake.api);
  expect(fake.host.rows).toContainEqual(copy);
  expect(localStorage.getItem('mnemoreader.notes-vault-deletions-v1')).toContain(book.id);
  fake.host.rows = fake.host.rows.filter((r) => !r.content.startsWith('Other'));
  await syncBookNotes(vault, [], fake.api);
  expect(notes()).toHaveLength(0);
  expect(localStorage.getItem('mnemoreader.notes-vault-deletions-v1')).toBe('[]');
});

it('resets an unreadable sync journal or deletion list with a warning instead of blocking', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  writeGeneralNote(book.id, 'Kept');
  localStorage.setItem(`mnemoreader.notes-vault-v1:${vault}`, '{not json');
  localStorage.setItem('mnemoreader.notes-vault-deletions-v1', '"one"');
  await syncBookNotes(vault, [book], fake.api);
  expect(noteVaultState(book.id)?.phase).toBe('synced');
  expect(() => removeBookNotes(book.id)).not.toThrow();
  await syncBookNotes(vault, [], fake.api);
  expect(notes()).toHaveLength(0);
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('reset'));
});

it('protects remote notes when the local notes cannot be read', async () => {
  writeGeneralNote(book.id, 'Remote copy');
  await syncBookNotes(vault, [book], fake.api);
  localStorage.setItem(notesKey(book.id), '{broken');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  await syncBookNotes(vault, [book], fake.api);
  expect(noteVaultState(book.id)?.phase).toBe('error');
  expect(notes()[0].content).toContain('Remote copy');
});

it('replaces the notes a first version wrote under SOCIAL_NODE with a v1 marker', async () => {
  fake.host.rows.push({ id: fake.host.nextId++, content: `[MNEMOREADER-NOTES:v1:${book.id}]\nOld format`, spine: 'SOCIAL_NODE' });
  writeGeneralNote(book.id, 'New format');
  await syncBookNotes(vault, [book], fake.api);
  expect(notes()).toHaveLength(1);
  expect(notes()[0].spine).toBe(NOTES_SPINE);
});

it('rebuilds purged vault entries, excludes demo books, and refuses other vaults', async () => {
  writeGeneralNote(book.id, 'Restore');
  await syncBookNotes(vault, [book], fake.api);
  fake.host.rows = fake.host.rows.filter((r) => r.content === CATALOGUE);
  // The demo book HAS notes (its id is stable so its highlights survive a
  // reopening): the filter itself must keep them out of the vault.
  writeGeneralNote('sample_demo', 'Demo thoughts');
  await syncBookNotes(vault, [book, { ...book, id: 'sample_demo' }], fake.api);
  expect(fake.host.rows.some((r) => r.content.includes('sample_demo') || r.content.includes('Demo thoughts'))).toBe(false);
  expect(notes()).toHaveLength(1);
  expect(ingests()).toHaveLength(2);
  await expect(syncBookNotes('LIBRARY', [book], fake.api)).rejects.toThrow('sandbox');
});

it('rolls the deletion queue back when the local notes cannot be removed, so the book stays whole', () => {
  writeGeneralNote(book.id, 'Kept');
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
    throw new DOMException('Blocked', 'SecurityError');
  });
  expect(() => removeBookNotes(book.id)).toThrow();
  expect(JSON.parse(localStorage.getItem('mnemoreader.notes-vault-deletions-v1') ?? '[]')).toEqual([]);
  expect(localStorage.getItem(notesKey(book.id))).toContain('Kept');
});
