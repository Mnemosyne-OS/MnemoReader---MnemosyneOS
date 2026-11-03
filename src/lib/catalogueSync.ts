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
  // A book no longer in the library needs no memory of what was written for it.
  for (const id of Object.keys(journal)) if (!books.some((b) => b.id === id)) delete journal[id];
  persist();
  if (failures.length)
    throw new Error(`Catalogue sync failed for ${failures.length} book(s): ${failures[0]}`);
}
