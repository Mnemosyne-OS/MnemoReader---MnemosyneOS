import { bridge } from './bridge';
import { BOOK_SPINE, type ReaderVaultTransport } from './readerVault';
import type { Book } from './types';

const marker = (id: string) => `[MNEMOREADER-BOOK:v2:${encodeURIComponent(id)}]\n`;
/** v1 rows were written as SOCIAL_CONTACT, which the host's PromptShield reads:
 *  a real title like "You Are Now Less Dumb" was refused on every pass. They
 *  are replaced by a READER_BOOK row like any older copy. */
const tagged = (content: string, id: string) =>
  content.startsWith(marker(id)) || content.startsWith(`[MNEMOREADER-BOOK:v1:${encodeURIComponent(id)}]\n`);

export function catalogueContent(book: Book): string {
  return `${marker(book.id)}Book: ${book.title}. ${book.author ? `Author: ${book.author}. ` : ''}Format: ${book.ext.toUpperCase()}, ${book.chapters.length} chapters, ${book.sentenceCount} sentences.`;
}

function legacyMatch(content: string, book: Book): boolean {
  // Untagged legacy rows lack a book ID. Only accept an exact metadata match;
  // reversed or otherwise ambiguous names require an explicit user correction.
  const prefix = `Book: ${book.title}. ${book.author ? `Author: ${book.author}. ` : ''}Format: ${book.ext.toUpperCase()}, `;
  return (
    content.startsWith(prefix) &&
    /^\d+ chapters, \d+ sentences\.$/.test(content.slice(prefix.length))
  );
}

/** The id-only journal of the first version of this sync, replaced below. */
const legacyJournalKey = (vault: string) => `mnemoreader.catalogue-ids-v2:${vault}`;
const journalKey = (vault: string) => `mnemoreader.catalogue-v3:${vault}`;

/**
 * Books the person deleted, whose catalogue row is still to be forgotten. Each
 * keeps what the legacy match needs (an untagged row names its book by title,
 * author and format). Like the notes, a deletion is an explicit queue: a book
 * merely missing from this device's library is never consent to forget it.
 */
const deletionKey = 'mnemoreader.catalogue-deletions-v1';
type PendingDeletion = Pick<Book, 'id' | 'title' | 'author' | 'ext'>;
function pendingDeletions(): PendingDeletion[] {
  const raw = localStorage.getItem(deletionKey);
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (Array.isArray(value) && value.every((d: Partial<PendingDeletion> | null) =>
      !!d && typeof d.id === 'string' && typeof d.title === 'string' && typeof d.ext === 'string'))
      return value as PendingDeletion[];
  } catch {
    // Reported just below, with the reset.
  }
  console.warn('[MnemoReader] pending catalogue deletions were unreadable and have been reset');
  localStorage.removeItem(deletionKey);
  return [];
}

/**
 * The untagged rows the first versions of the catalogue wrote, one per book and
 * per extraction snapshot ("0 chapters" then the real count), several with
 * title and author swapped. No book id says whose they are, so they are matched
 * by their exact shape only, never by a guess.
 */
const LEGACY_SHAPE = /^Book: .+\. (?:Author: .+\. )?Format: [A-Z0-9]+, \d+ chapters, \d+ sentences\.\s*$/s;
const legacyCleanedKey = (vault: string) => `mnemoreader.catalogue-legacy-cleaned-v1:${vault}`;

/**
 * Forget, once per vault, every untagged legacy catalogue row (Tony's choice,
 * 2026-11-03: 18 such rows sat in his sandbox, two with reversed names, and no
 * screen could review them). Only on a complete listing, so no row is left
 * unseen, and only rows of the exact legacy shape: never a tagged row, a note
 * or anything else. The current books have their tagged rows already.
 */
async function cleanLegacyOnce(vault: string, rows: { id: number; content: string }[], complete: boolean, api: ReaderVaultTransport): Promise<void> {
  if (!complete || localStorage.getItem(legacyCleanedKey(vault))) return;
  const legacy = rows.filter((row) => LEGACY_SHAPE.test(row.content)).map((row) => row.id);
  if (legacy.length) {
    const result = await api.forget(legacy);
    if (!result.success) throw new Error(result.error ?? 'Legacy catalogue cleanup could not be confirmed.');
    if (result.forgotten !== legacy.length) {
      const check = (await api.list(vault)).rows;
      if (check.some((row) => legacy.includes(row.id) && LEGACY_SHAPE.test(row.content)))
        throw new Error('Legacy catalogue cleanup could not be confirmed.');
    }
    console.warn(`[MnemoReader] ${legacy.length} untagged legacy catalogue row(s) forgotten, once`);
  }
  localStorage.setItem(legacyCleanedKey(vault), new Date().toISOString());
}

/** The person confirmed deleting this book: its catalogue row goes at the next pass. */
export function removeBookCatalogue(book: Book): void {
  const queue = pendingDeletions().filter((d) => d.id !== book.id);
  queue.push({ id: book.id, title: book.title, ext: book.ext, ...(book.author ? { author: book.author } : {}) });
  localStorage.setItem(deletionKey, JSON.stringify(queue));
}
type Journal = Record<string, { id: number; content: string }>;

/**
 * What was last written per book. Read only when the listing is full and may
 * not reach the row: the host embeds before it deduplicates, so writing again
 * "to be sure" would pay an embedding per book per pass. An unreadable journal
 * is reset with a warning; it costs one rewrite at most.
 */
function readJournal(vault: string): Journal {
  const raw = localStorage.getItem(journalKey(vault));
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.values(value).every((e: { id?: unknown; content?: unknown } | null) =>
        !!e && typeof e.id === 'number' && Number.isSafeInteger(e.id) && e.id > 0 && typeof e.content === 'string')
    )
      return value as Journal;
  } catch {
    // Reported just below, with the reset.
  }
  console.warn('[MnemoReader] catalogue sync history was unreadable and has been reset');
  localStorage.removeItem(journalKey(vault));
  return {};
}

/**
 * Save the replacement first. Only delete this book's tagged or exact legacy
 * catalogue records that the listing shows now: an id from the journal alone
 * may name another row after a sandbox purge. One book failing does not stop
 * the others; the pass then rejects with how many failed, so the caller retries.
 */
export async function syncCatalogue(
  vault: string,
  books: Book[],
  api: ReaderVaultTransport = bridge.vault
): Promise<void> {
  if (!vault.startsWith('APP-')) throw new Error('Catalogue sync requires the reader sandbox.');
  localStorage.removeItem(legacyJournalKey(vault));
  const journal = readJournal(vault);
  const persist = () => localStorage.setItem(journalKey(vault), JSON.stringify(journal));
  const { rows, complete } = await api.list(vault);
  const failures: string[] = [];
  for (const book of books.filter((b) => !b.id.startsWith('sample_'))) {
    try {
      const content = catalogueContent(book);
      const owned = rows.filter((row) => tagged(row.content, book.id) || legacyMatch(row.content, book));
      const known = journal[book.id];
      const id =
        owned.find((row) => row.content === content)?.id ??
        (!complete && known?.content === content ? known.id : undefined) ??
        (await api.write(vault, content, BOOK_SPINE, `mnemoreader-book:${book.id}`));
      journal[book.id] = { id, content };
      persist();
      const stale = owned.map((row) => row.id).filter((old) => old !== id);
      if (stale.length) {
        const result = await api.forget(stale);
        if (!result.success)
          throw new Error(result.error ?? 'Catalogue cleanup could not be confirmed; retry will preserve the current record.');
        if (result.forgotten !== stale.length) {
          const check = (await api.list(vault)).rows;
          if (check.some((row) => stale.includes(row.id) && (tagged(row.content, book.id) || legacyMatch(row.content, book))))
            throw new Error('Catalogue cleanup could not be confirmed; retry will preserve the current record.');
        }
      }
    } catch (error) {
      console.warn('[MnemoReader] catalogue sync failed for a book', book.id, error);
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  // Deleted books: their rows the listing shows go; one a full listing does not
  // reach stays queued, never forgotten unseen. A queued book that is back in
  // the library (a delete that did not complete) leaves the queue untouched.
  const stillPending: PendingDeletion[] = [];
  for (const gone of pendingDeletions()) {
    if (books.some((b) => b.id === gone.id)) continue;
    try {
      const meta = gone as Book;
      const owned = rows.filter((row) => tagged(row.content, gone.id) || legacyMatch(row.content, meta)).map((row) => row.id);
      if (owned.length) {
        const result = await api.forget(owned);
        if (!result.success) throw new Error(result.error ?? 'Catalogue removal could not be confirmed.');
        if (result.forgotten !== owned.length) {
          const check = (await api.list(vault)).rows;
          if (check.some((row) => owned.includes(row.id) && (tagged(row.content, gone.id) || legacyMatch(row.content, meta))))
            throw new Error('Catalogue removal could not be confirmed.');
        }
      }
      const known = journal[gone.id];
      if (!complete && known && !owned.includes(known.id)) stillPending.push(gone);
      else delete journal[gone.id];
    } catch (error) {
      console.warn('[MnemoReader] catalogue removal failed for a deleted book', gone.id, error);
      failures.push(error instanceof Error ? error.message : String(error));
      stillPending.push(gone);
    }
  }
  localStorage.setItem(deletionKey, JSON.stringify(stillPending));
  // 🚨 Only after a pass where every book got its tagged row: a book whose
  // replacement failed still has nothing but its legacy row, and cleaning it
  // would leave the book with no catalogue entry at all.
  if (!failures.length) try {
    const fresh = await api.list(vault);
    await cleanLegacyOnce(vault, fresh.rows, fresh.complete, api);
  } catch (error) {
    console.warn('[MnemoReader] legacy catalogue cleanup failed; retried at the next pass', error);
    failures.push(error instanceof Error ? error.message : String(error));
  }
  // A book no longer in the library, and not waiting for its removal, needs no
  // memory of what was written for it.
  for (const id of Object.keys(journal))
    if (!books.some((b) => b.id === id) && !stillPending.some((d) => d.id === id)) delete journal[id];
  persist();
  if (failures.length)
    throw new Error(`Catalogue sync failed for ${failures.length} book(s): ${failures[0]}`);
}
