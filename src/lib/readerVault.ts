/**
 * readerVault.ts — the one door MnemoReader's catalogue and notes sync take
 * into the app's own sandbox vault (`APP-MNEMO-READER`, doc 58).
 *
 * Three host behaviours decide the shape of everything written here. None of
 * them is visible from the cartridge, and each one makes a sync say "synced"
 * while nothing was written:
 *
 *  1. 🚨 **Social spines are near-deduplicated.** For `SOCIAL_NODE` and the
 *     other social spines the host fingerprints only the first 1000 normalized
 *     characters and, on a match, returns the id of the OLD row
 *     (core-engine `dev-vault.ts`, SOCIAL_SPINE_TYPES). An edit past that
 *     window is never stored.
 *  2. 🚨 **`SOCIAL_NODE` and `SOCIAL_CONTACT` go through the PromptShield.**
 *     A quoted passage holding an ordinary phrase like "you are now" is refused
 *     (`PROMPT_INJECTION_DETECTED`), and `<script>` is rewritten in storage.
 *     A book is quoted text, not a scraped feed.
 *
 *     Both are avoided the way the host intends: an app may store its own
 *     UPPER_SNAKE spine in its own sandbox (`socialHandlers.ts`,
 *     resolveSpineType). It takes the DOCUMENT path: exact SHA-256 dedup only,
 *     no near-dedup, no shield. Hence the three spines below.
 *  3. 🚨 **The host re-chunks at 2000 characters when inline embedding fails**
 *     and returns only the FIRST id. The other pieces carry no marker of ours
 *     and could never be found again to be replaced or forgotten, so every
 *     chronicle written here stays under {@link PART_LIMIT}.
 *
 * Every host call has a 15 s deadline (CLAUDE rule 9); the SDK's own default
 * is 300 s, long enough for a stuck sync to look like a working one.
 */

/** One catalogue chronicle per book (the "Books" tile metric). */
export const BOOK_SPINE = 'READER_BOOK';
/** The first part of a book's notes: one per annotated book, so the tile
 *  counts books with notes rather than storage parts. */
export const NOTES_SPINE = 'READER_NOTES';
/** Every following part of the same notes. */
export const NOTES_PART_SPINE = 'READER_NOTES_PART';

/** Under the host's 2000-character re-chunk, with room for the newline it adds. */
export const PART_LIMIT = 1800;
/** `social.query` lists at most this many rows, newest first (socialHandlers.ts).
 *  A listing that long may not show every row: absence proves nothing. */
export const LIST_LIMIT = 200;
/** The deadline of every host call (CLAUDE rule 9), against the SDK's 300 s. */
export const HOST_CALL_MS = 15_000;

export interface VaultRow {
  id: number;
  content: string;
}

export interface ForgetResult {
  success: boolean;
  forgotten?: number;
  error?: string;
}

export interface ReaderVaultTransport {
  /** The newest rows of the vault, at most {@link LIST_LIMIT}. Rows the host
   *  returns malformed are left out with a warning, never acted upon. */
  list(vault: string): Promise<{ rows: VaultRow[]; complete: boolean }>;
  /** Store one chronicle and return its id. */
  write(vault: string, content: string, spineType: string, sourceRef: string): Promise<number>;
  /** Forget rows of this app's own sandbox (the host binds the app id). */
  forget(ids: number[]): Promise<ForgetResult>;
}

/** The SDK's `invoke`, or a fake of the host in tests. */
export type VaultInvoke = (action: string, payload: unknown) => Promise<unknown>;

/** `p`, or a `TIMEOUT: <label>` rejection after `ms`; the timer is cleared either way. */
export function withTimeout<T>(p: Promise<T>, label: string, ms: number = HOST_CALL_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`TIMEOUT: ${label}`)), ms);
  });
  return Promise.race([p, deadline]).finally(() => clearTimeout(timer));
}

/** A positive safe integer id, from a number or a digit string; null otherwise. */
export function rowId(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** The sandbox door built on `invoke` (the SDK's in the app, a fake host in tests). */
export function readerVaultTransport(invoke: VaultInvoke): ReaderVaultTransport {
  return {
    async list(vault) {
      const answer = await withTimeout(invoke('social.query', { vault, limit: LIST_LIMIT }), 'social.query');
      const raw = (answer as { chronicles?: unknown } | null)?.chronicles;
      if (!Array.isArray(raw)) throw new Error('The vault returned an unreadable list.');
      const rows: VaultRow[] = [];
      for (const r of raw as { id?: unknown; content?: unknown }[]) {
        const id = rowId(r?.id);
        if (id === null || typeof r?.content !== 'string') {
          console.warn('[MnemoReader] vault row left out: unreadable id or content', r?.id);
          continue;
        }
        rows.push({ id, content: r.content });
      }
      return { rows, complete: raw.length < LIST_LIMIT };
    },
    async write(vault, content, spineType, sourceRef) {
      const answer = await withTimeout(invoke('social.ingest', { vault, content, spineType, sourceRef }), 'social.ingest');
      const id = rowId((answer as { chronicleId?: unknown } | null)?.chronicleId);
      // Without an id the row could never be replaced or forgotten: stop here.
      if (id === null) throw new Error('The vault returned no entry ID.');
      return id;
    },
    async forget(ids) {
      const answer = (await withTimeout(invoke('vault.sandbox.forget', { ids }), 'vault.sandbox.forget')) as
        | { success?: unknown; forgotten?: unknown; error?: unknown }
        | null;
      // The host answers its envelope and does not reject on a refusal: read it.
      return {
        success: answer?.success === true,
        ...(typeof answer?.forgotten === 'number' ? { forgotten: answer.forgotten } : {}),
        ...(typeof answer?.error === 'string' ? { error: answer.error } : {}),
      };
    },
  };
}
