// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { catalogueContent, removeBookCatalogue, syncCatalogue } from './catalogueSync';
import { BOOK_SPINE } from './readerVault';
import { fakeVaultHost } from '../test/fakeVaultHost';
import type { Book } from './types';

const book = {
  id: 'example',
  title: 'Example novel',
  author: 'Example author',
  ext: 'epub',
  chapters: [{ id: 'c' }],
  sentenceCount: 7589,
} as Book;
let fake: ReturnType<typeof fakeVaultHost>;
const ids = () => fake.host.rows.map((row) => row.id);
const ingests = () => fake.invoke.mock.calls.filter(([action]) => action === 'social.ingest');
const legacy = (n: string) => `Book: Example novel. Author: Example author. Format: EPUB, ${n}.`;

beforeEach(() => {
  localStorage.clear();
  fake = fakeVaultHost();
  fake.host.rows = [
    { id: 1, content: legacy('0 chapters, 0 sentences'), spine: 'SOCIAL_CONTACT' },
    { id: 2, content: legacy('61 chapters, 7589 sentences'), spine: 'SOCIAL_CONTACT' },
    { id: 3, content: `${legacy('61 chapters, 7589 sentences')} `, spine: 'SOCIAL_CONTACT' },
    { id: 4, content: '[MNEMOREADER-NOTES:v2:example]\nMy highlight and comment', spine: 'READER_NOTES' },
    { id: 5, content: 'Unrelated memory', spine: 'READER_BOOK' },
  ];
  fake.host.nextId = 10;
});
afterEach(() => vi.restoreAllMocks());

it('replaces the legacy catalogue snapshots with one and preserves notes and unrelated entries', async () => {
  await syncCatalogue('APP-READER', [book], fake.api);
  expect(ids()).toEqual([4, 5, 10]);
  expect(fake.host.rows.find((r) => r.id === 10)).toEqual({ id: 10, content: catalogueContent(book), spine: BOOK_SPINE });
  await syncCatalogue('APP-READER', [book], fake.api);
  expect(ingests()).toHaveLength(1);
  await syncCatalogue('APP-READER', [{ ...book, sentenceCount: 8000 }], fake.api);
  expect(ids()).toEqual([4, 5, 11]);
});

it('keeps previous records when the replacement cannot be saved', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  fake.host.failNextIngest = new Error('offline');
  await expect(syncCatalogue('APP-READER', [book], fake.api)).rejects.toThrow('offline');
  expect(fake.host.rows).toHaveLength(5);
  expect(fake.invoke.mock.calls.some(([action]) => action === 'vault.sandbox.forget')).toBe(false);
});

it('does not delete ambiguous reversed names or records belonging to another book', async () => {
  // The per-book rule alone: the one-time legacy cleanup is tested below.
  localStorage.setItem('mnemoreader.catalogue-legacy-cleaned-v1:APP-READER', 'done');
  fake.host.rows.push(
    { id: 6, content: 'Book: Example author. Author: Example novel. Format: EPUB, 1 chapters, 7589 sentences.', spine: 'SOCIAL_CONTACT' },
    { id: 7, content: '[MNEMOREADER-BOOK:v2:another-book]\nBook: Example novel.', spine: 'READER_BOOK' },
  );
  await syncCatalogue('APP-READER', [book], fake.api);
  expect(ids()).toEqual([3, 4, 5, 6, 7, 10]);
});

it('retries a failed cleanup without another write, and survives a lost or unreadable journal', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  fake.host.forgetAnswer = { success: false, forgotten: 0 };
  await expect(syncCatalogue('APP-READER', [book], fake.api)).rejects.toThrow('cleanup');
  localStorage.setItem('mnemoreader.catalogue-v3:APP-READER', '{not json');
  await syncCatalogue('APP-READER', [book], fake.api);
  expect(ingests()).toHaveLength(1);
  expect(ids()).toEqual([4, 5, 10]);
});

// 🚨 SOCIAL_CONTACT goes through the PromptShield: this is a real book title.
it('stores a title the PromptShield would refuse', async () => {
  const title = { ...book, id: 'dumb', title: 'You Are Now Less Dumb' };
  await syncCatalogue('APP-READER', [title], fake.api);
  expect(fake.host.rows.some((r) => r.content === catalogueContent(title) && r.spine === BOOK_SPINE)).toBe(true);
});

it('replaces a v1 row of the first version of this sync', async () => {
  fake.host.rows = [{ id: 1, content: '[MNEMOREADER-BOOK:v1:example]\nBook: Example novel.', spine: 'SOCIAL_CONTACT' }];
  await syncCatalogue('APP-READER', [book], fake.api);
  expect(fake.host.rows).toEqual([{ id: 10, content: catalogueContent(book), spine: BOOK_SPINE }]);
});

it('one book failing does not stop the others', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  fake.host.failNextIngest = new Error('offline');
  const other = { ...book, id: 'other', title: 'Other novel' };
  await expect(syncCatalogue('APP-READER', [book, other], fake.api)).rejects.toThrow('1 book');
  expect(fake.host.rows.some((r) => r.content === catalogueContent(other))).toBe(true);
});

// The host embeds before it deduplicates: writing a row the listing no longer
// reaches would pay an embedding per book per pass.
it('does not write again a book a full listing no longer shows', async () => {
  await syncCatalogue('APP-READER', [book], fake.api);
  for (let i = 0; i < 250; i++) fake.host.rows.push({ id: fake.host.nextId++, content: `Other ${i}`, spine: 'READER_BOOK' });
  await syncCatalogue('APP-READER', [book], fake.api);
  expect(ingests()).toHaveLength(1);
});

it('never forgets a journal id the listing does not show with this book marker', async () => {
  await syncCatalogue('APP-READER', [book], fake.api);
  fake.host.rows = [{ id: 10, content: 'Someone else after a purge', spine: 'READER_BOOK' }];
  fake.host.nextId = 11;
  await syncCatalogue('APP-READER', [{ ...book, sentenceCount: 1 }], fake.api);
  expect(fake.host.rows.find((r) => r.id === 10)?.content).toBe('Someone else after a purge');
});

// Tony's choice, 2026-11-03: the untagged legacy rows (18 in his sandbox, two
// with title and author swapped) go once, since no screen can review them.
it('forgets the untagged legacy rows once, on a complete listing, and nothing else', async () => {
  fake.host.rows.push(
    { id: 6, content: 'Book: Example author. Author: Example novel. Format: EPUB, 1 chapters, 7589 sentences.', spine: 'SOCIAL_CONTACT' },
    { id: 7, content: '[MNEMOREADER-BOOK:v2:another-book]\nBook: Another.', spine: 'READER_BOOK' },
    { id: 8, content: 'Book: Gone book. Format: PDF, 0 chapters, 0 sentences.', spine: 'SOCIAL_CONTACT' },
  );
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  await syncCatalogue('APP-READER', [book], fake.api);
  expect(ids()).toEqual([4, 5, 7, 10]);
  // Once: a legacy-shaped row appearing later is left alone.
  fake.host.rows.push({ id: 11, content: 'Book: Late. Format: TXT, 1 chapters, 2 sentences.', spine: 'SOCIAL_CONTACT' });
  await syncCatalogue('APP-READER', [book], fake.api);
  expect(ids()).toContain(11);
});

it('does not clean legacy rows on a full listing, nor after a book failed', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  fake.host.rows.push({ id: 8, content: 'Book: Gone book. Format: PDF, 0 chapters, 0 sentences.', spine: 'SOCIAL_CONTACT' });
  for (let i = 0; i < 250; i++) fake.host.rows.push({ id: 100 + i, content: `Other ${i}`, spine: 'READER_BOOK' });
  await syncCatalogue('APP-READER', [book], fake.api);
  expect(ids()).toContain(8);
  expect(localStorage.getItem('mnemoreader.catalogue-legacy-cleaned-v1:APP-READER')).toBeNull();
  fake.host.rows = fake.host.rows.filter((r) => !r.content.startsWith('Other'));
  fake.host.failNextIngest = new Error('offline');
  await expect(syncCatalogue('APP-READER', [{ ...book, sentenceCount: 1 }], fake.api)).rejects.toThrow('offline');
  expect(ids()).toContain(8);
});

it('forgets the row of a book deleted on purpose, never of one merely missing', async () => {
  await syncCatalogue('APP-READER', [book], fake.api);
  const mine = fake.host.rows.find((r) => r.content === catalogueContent(book))!;
  await syncCatalogue('APP-READER', [], fake.api);
  expect(fake.host.rows).toContainEqual(mine);
  removeBookCatalogue(book);
  await syncCatalogue('APP-READER', [], fake.api);
  expect(fake.host.rows).not.toContainEqual(mine);
  expect(localStorage.getItem('mnemoreader.catalogue-deletions-v1')).toBe('[]');
});

it('keeps a book queued for removal but still in the library (a delete that did not complete)', async () => {
  await syncCatalogue('APP-READER', [book], fake.api);
  removeBookCatalogue(book);
  await syncCatalogue('APP-READER', [book], fake.api);
  expect(fake.host.rows.some((r) => r.content === catalogueContent(book))).toBe(true);
});
