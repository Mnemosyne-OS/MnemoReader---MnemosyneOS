import { bridge } from './bridge';
import { NOTES_CHANGED, notesKey, readBookNotes } from './annotations';
import { highlightColor } from './highlightColors';
import {
  NOTES_PART_SPINE,
  NOTES_SPINE,
  PART_LIMIT,
  type ReaderVaultTransport,
  type VaultRow,
} from './readerVault';
import type { Book } from './types';

/** A locale key and its vars, not a sentence: the panel translates it at
 *  render, so a status set before a language switch still follows it. The
 *  host's error text goes in `vars.error` as it came, untranslated. */
export type VaultNoteState = {
  phase: 'pending' | 'syncing' | 'synced' | 'error';
  key: string;
  vars?: Record<string, string>;
};
/** What this device last wrote for a book. An older copy found later with our
 *  marker but not in `ids` is simply cleaned up then: the journal never has to
 *  remember what it could not see. */
type Journal = Record<string, { ids: number[]; digest: string }>;
export const VAULT_NOTES_STATUS = 'mnemoreader:vault-notes-status';
export const VAULT_NOTES_RETRY = 'mnemoreader:vault-notes-retry';
const states = new Map<string, VaultNoteState>();
/** The last sync state of one book, or undefined when it has none to show. */
export const noteVaultState = (id: string) => states.get(id);
/** Every book whose last pass failed, for the app-wide notice. */
export const vaultNoteFailures = () => [...states.entries()].filter(([, s]) => s.phase === 'error');
const deletionKey = 'mnemoreader.notes-vault-deletions-v1';

const isIdList = (v: unknown): v is number[] =>
  Array.isArray(v) && v.every((id) => typeof id === 'number' && Number.isSafeInteger(id) && id > 0);

/**
 * Pending book deletions. An unreadable list is reset with a warning rather
 * than blocking every later deletion: what it held cannot be recovered, and the
 * notes it named stay in the vault (missing local state is never consent to
 * purge). The local notes of those books are already gone.
 */
function deletions(): string[] {
  const raw = localStorage.getItem(deletionKey);
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (Array.isArray(value) && value.every((id) => typeof id === 'string')) return value;
  } catch {
    // Reported just below, with the reset.
  }
  console.warn('[MnemoReader] pending note deletions were unreadable and have been reset');
  localStorage.removeItem(deletionKey);
  return [];
}
/** Queue a deleted book's vault copies for removal, then drop its local notes;
 *  if the notes cannot be dropped, the queue is rolled back and the book kept whole. */
export function removeBookNotes(bookId: string): void {
  const before = deletions();
  localStorage.setItem(deletionKey, JSON.stringify([...new Set([...before, bookId])]));
  try {
    localStorage.removeItem(notesKey(bookId));
  } catch (error) {
    localStorage.setItem(deletionKey, JSON.stringify(before));
    throw error;
  }
  window.dispatchEvent(new Event(NOTES_CHANGED));
}
const marker = (id: string) => `[MNEMOREADER-NOTES:v2:${encodeURIComponent(id)}]\n`;
/** v1 rows were written as SOCIAL_NODE by the first version of this sync; they
 *  are this book's notes too, and are replaced like any older copy. */
const ownsNotes = (content: string, id: string) =>
  content.startsWith(marker(id)) || content.startsWith(`[MNEMOREADER-NOTES:v1:${encodeURIComponent(id)}]\n`);
const journalKey = (vault: string) => `mnemoreader.notes-vault-v1:${vault}`;
function status(
  id: string,
  phase: VaultNoteState['phase'],
  key: string,
  vars?: Record<string, string>
): void {
  states.set(id, vars ? { phase, key, vars } : { phase, key });
  window.dispatchEvent(new Event(VAULT_NOTES_STATUS));
}
/** A note was saved locally: its book shows "sync pending" until the next pass. */
export function markVaultSyncPending(id: string): void {
  if (!id.startsWith('sample_'))
    status(id, 'pending', 'vault.pending');
}

/** The journal, or an empty one when it cannot be read: it is rebuilt from the
 *  markers of the rows in the vault, so losing it costs a rewrite, not notes. */
function readJournal(vault: string): Journal {
  const raw = localStorage.getItem(journalKey(vault));
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.values(value).every((entry) => {
        const e = entry as { ids?: unknown; digest?: unknown } | null;
        return !!e && isIdList(e.ids) && typeof e.digest === 'string';
      })
    )
      return value as Journal;
  } catch {
    // Reported just below, with the reset.
  }
  console.warn('[MnemoReader] notes sync history was unreadable and has been reset; it is rebuilt from the vault');
  localStorage.removeItem(journalKey(vault));
  return {};
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function header(book: Book, part: number, total: number): string {
  return (
    // No author line when the book has none: never a made-up "Unknown" (the catalogue omits it too).
    `${marker(book.id)}Book: ${clip(book.title, 200)}\n${book.author ? `Author: ${clip(book.author, 120)}\n` : ''}` +
    `MnemoReader notes, part ${part}/${total}. Quoted passages are the book's words, not the reader's views; ` +
    `comments, general notes and color meanings are the reader's own.\n`
  );
}

/** "Quoted passage" for "Quoted passage: ...", null for a line with no label. */
const labelOf = (line: string) => /^([A-Z][A-Za-z ]{2,30}):( |\n|$)/.exec(line)?.[1] ?? null;

/**
 * Cut a block too long for one part: line by line, then a line too long at a
 * space near the end. Every continuation says what it continues
 * ("Quoted passage (continued): ..."), so a part read alone still tells the
 * book's words from the reader's: a bare "(continued)" left a quote unlabelled.
 */
function pieces(block: string, budget: number): string[] {
  if (block.length <= budget) return [block];
  const blockLabel = labelOf(block) ?? 'Note';
  const out: string[] = [];
  for (const line of block.split('\n')) {
    if (!line.trim()) continue;
    const label = labelOf(line) ?? blockLabel;
    const lead = `${label} (continued): `;
    let rest = line;
    let first = true;
    while (rest.length > budget) {
      const room = first ? budget : budget - lead.length;
      let cut = rest.lastIndexOf(' ', room);
      if (cut < room / 2) cut = room;
      out.push((first ? '' : lead) + rest.slice(0, cut).trimEnd());
      rest = rest.slice(cut).trimStart();
      first = false;
    }
    if (rest) out.push((first ? '' : lead) + rest);
  }
  return out;
}

/**
 * Plain text for retrieval, one chronicle per part, each under PART_LIMIT with
 * its own provenance and an exact app-owned marker for reconciliation. A
 * highlight is never split across parts unless it alone is longer than one.
 */
export function bookNoteChunks(book: Book): string[] {
  const data = readBookNotes(book.id);
  const labels = Object.entries(data.colorLabels).filter(([, label]) => label.trim());
  if (!data.general.trim() && !data.notes.length && !labels.length) return [];
  const blocks: string[] = [];
  if (labels.length)
    blocks.push(
      [
        'Color key (reader-defined labels, not inferred themes):',
        ...labels.map(
          ([hex, label]) =>
            `${hex}: ${label}${data.hiddenColors.includes(hex) ? ' (hidden from color key)' : ''}`
        ),
      ].join('\n')
    );
  for (const a of [...data.notes].sort(
    (x, y) => x.startSentence - y.startSentence || x.startOffset - y.startOffset
  )) {
    const chapter = [...book.chapters].reverse().find((c) => c.sentenceStart <= a.startSentence);
    const color = highlightColor(a.color);
    blocks.push(
      [
        `Chapter: ${chapter?.title ?? 'Unknown chapter'}; sentence ${a.startSentence + 1}.`,
        `Highlight color: ${color}${data.colorLabels[color] ? ` — ${data.colorLabels[color]}` : ''}`,
        `Quoted passage: ${a.quote}`,
        `Reader comment: ${a.comment || '(none)'}`,
      ].join('\n')
    );
  }
  if (data.general.trim()) blocks.push(`General notes:\n${data.general}`);
  // Trailing spaces are trimmed by the host's chunker: send what it stores.
  const clean = blocks.map((b) => b.replace(/[ \t]+$/gm, '').trim()).filter(Boolean);
  // The widest header this book can have, so no part can pass the limit.
  const budget = PART_LIMIT - header(book, 999, 999).length;
  const parts: string[] = [];
  let current = '';
  for (const piece of clean.flatMap((b) => pieces(b, budget))) {
    if (current && current.length + 2 + piece.length > budget) {
      parts.push(current);
      current = piece;
    } else current = current ? `${current}\n\n${piece}` : piece;
  }
  if (current) parts.push(current);
  return parts.map((part, i) => `${header(book, i + 1, parts.length)}${part}`);
}

/** Part 1 counts as the book's notes on the tile; the rest are its parts. */
export const noteSpine = (index: number) => (index === 0 ? NOTES_SPINE : NOTES_PART_SPINE);

async function sha256(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Forget `ids`, all of them listed with this book's marker a moment ago.
 * Throws only when one of them is still listed afterwards: an id already gone
 * (another device forgot it) is the outcome asked for, not a failure.
 */
async function forgetOwned(
  api: ReaderVaultTransport,
  vault: string,
  bookId: string,
  ids: number[]
): Promise<void> {
  for (let i = 0; i < ids.length; i += 500) {
    const batch = ids.slice(i, i + 500);
    const result = await api.forget(batch);
    if (!result.success) throw new Error(result.error ?? 'Old vault notes could not be removed.');
    if (result.forgotten !== batch.length) {
      const { rows } = await api.list(vault);
      if (rows.some((row) => batch.includes(row.id) && ownsNotes(row.content, bookId)))
        throw new Error('Removal of outdated notes could not be confirmed.');
    }
  }
}

/** One serialized reconciliation pass. Never deletes catalogue/book-text records. */
export async function syncBookNotes(
  vault: string,
  books: Book[],
  api: ReaderVaultTransport = bridge.vault
): Promise<void> {
  if (!vault.startsWith('APP-')) throw new Error('Notes may only sync to the app sandbox.');
  const journal = readJournal(vault);
  const { rows, complete } = await api.list(vault);
  const current = new Map(books.filter((b) => !b.id.startsWith('sample_')).map((b) => [b.id, b]));
  const pendingDeletes = deletions();
  // Missing local state alone is NOT consent to purge remote notes (e.g. a new device).
  const ids = new Set([...current.keys(), ...pendingDeletes]);
  const persist = () => localStorage.setItem(journalKey(vault), JSON.stringify(journal));
  for (const bookId of ids) {
    try {
      const book = pendingDeletes.includes(bookId) ? undefined : current.get(bookId);
      const chunks = book ? bookNoteChunks(book) : [];
      const digest = await sha256(JSON.stringify(chunks));
      // 🚨 Only rows listed NOW with this book's marker are ours to forget. An
      // id from the journal alone may name another row after a sandbox purge.
      const owned: VaultRow[] = rows.filter((row) => ownsNotes(row.content, bookId));
      const ownedIds = owned.map((row) => row.id);
      const prior = journal[bookId];
      // A short listing shows every row: a journal id it lacks is gone.
      // A full one may simply not reach it, so the journal is trusted.
      const priorIds = complete ? (prior?.ids ?? []).filter((id) => ownedIds.includes(id)) : (prior?.ids ?? []);
      const unchanged =
        prior?.digest === digest &&
        priorIds.length === prior.ids.length &&
        ownedIds.every((id) => prior.ids.includes(id));
      if (unchanged) {
        if (book) status(bookId, 'synced', 'vault.synced');
        continue;
      }
      // A book with no notes, no copy listed and none journalled has nothing to
      // sync and nothing was removed: it gets no status at all, never "previous
      // copies have been removed" for copies that never existed.
      if (book && !chunks.length && !owned.length && !prior) {
        if (states.delete(bookId)) window.dispatchEvent(new Event(VAULT_NOTES_STATUS));
        continue;
      }
      status(bookId, 'syncing', 'vault.syncing');
      const nextIds: number[] = [];
      // Keep old records until all replacement parts are saved and journalled.
      for (const [i, content] of chunks.entries()) {
        const existing = owned.find((row) => row.content === content);
        const id = existing ? existing.id : await api.write(vault, content, noteSpine(i), `mnemoreader-notes:${bookId}`);
        nextIds.push(id);
        journal[bookId] = { ids: [...new Set([...priorIds, ...ownedIds, ...nextIds])], digest: '' };
        persist();
      }
      await forgetOwned(api, vault, bookId, ownedIds.filter((id) => !nextIds.includes(id)));
      // A deleted book's copies a full listing does not reach stay pending, to
      // be forgotten the pass they are seen: never forgotten unseen.
      const hidden = !book && !complete ? priorIds.filter((id) => !ownedIds.includes(id)) : [];
      if (book && chunks.length) journal[bookId] = { ids: nextIds, digest };
      else if (hidden.length) journal[bookId] = { ids: hidden, digest: '' };
      else delete journal[bookId];
      persist();
      if (hidden.length)
        console.warn(`[MnemoReader] ${hidden.length} note copies of a deleted book are past the vault listing; removed when seen`, bookId);
      else if (!book) {
        localStorage.setItem(
          deletionKey,
          JSON.stringify(deletions().filter((id) => id !== bookId))
        );
        states.delete(bookId);
        window.dispatchEvent(new Event(VAULT_NOTES_STATUS));
      }
      if (book) status(bookId, 'synced', chunks.length ? 'vault.synced' : 'vault.cleared');
    } catch (error) {
      console.warn('[MnemoReader] notes sync failed for a book', bookId, error);
      status(bookId, 'error', 'vault.failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/** A whole pass failed (no listing, no sandbox): every book that has notes, and
 *  every pending deletion, is marked. A book without notes has nothing pending. */
export function markVaultSyncError(books: Book[], error: unknown): void {
  const ids = new Set(books.filter((book) => localStorage.getItem(notesKey(book.id)) !== null).map((book) => book.id));
  for (const id of deletions()) ids.add(id);
  for (const id of ids)
    if (!id.startsWith('sample_'))
      status(id, 'error', 'vault.failedPending', {
        error: error instanceof Error ? error.message : String(error),
      });
}
