// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BookNotes } from './BookNotes';
import { writeGeneralNote } from '../lib/annotations';
import { markVaultSyncError, VAULT_NOTES_RETRY } from '../lib/notesVaultSync';
import { setLang, translate } from '../i18n/useI18n';
import type { Book } from '../lib/types';

// Inside the host, where the vault status and its retry are shown.
vi.mock('../lib/bridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/bridge')>()),
  isFramed: () => true,
}));

const book: Book = {
  id: 'framed-book', title: 'Framed', filePath: '', ext: 'txt', hue: 0, addedAt: 0, sentenceCount: 1,
  chapters: [{ id: 'c', title: 'One', start: 0, end: 5, sentenceStart: 0 }],
  progressSentence: 0, ingest: 'idle', archived: false,
};
const loaded = { bookId: book.id, text: 'Hello.', sentences: ['Hello.'], sentenceOffsets: [0] };
let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  setLang('en');
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const retry = () => [...host.querySelectorAll('button')].find((b) => b.textContent === translate('notes.retryVault'));

// Tony, in the app: the retry sat under "saved in the vault" and a click did
// nothing visible. It now appears only when a sync failed, and then it retries.
it('offers the retry only after a failed sync, and the retry asks for a pass', () => {
  writeGeneralNote(book.id, 'A note');
  act(() => root.render(createElement(BookNotes, { book, loaded, onJump: () => {}, children: () => null })));
  act(() => [...host.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Book notes'))!.click());
  expect(retry()).toBeUndefined();
  act(() => markVaultSyncError([book], new Error('offline')));
  expect(retry()).toBeDefined();
  const asked = vi.fn();
  window.addEventListener(VAULT_NOTES_RETRY, asked);
  act(() => retry()!.click());
  window.removeEventListener(VAULT_NOTES_RETRY, asked);
  expect(asked).toHaveBeenCalledTimes(1);
});
