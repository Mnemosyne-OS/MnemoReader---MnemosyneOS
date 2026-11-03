import { useEffect, useRef, useState } from 'react';
import { NOTES_CHANGED } from '../lib/annotations';
import { bridge, isFramed } from '../lib/bridge';
import {
  markVaultSyncError,
  markVaultSyncPending,
  noteVaultState,
  syncBookNotes,
  vaultNoteFailures,
  VAULT_NOTES_RETRY,
  VAULT_NOTES_STATUS,
} from '../lib/notesVaultSync';
import { withTimeout } from '../lib/readerVault';
import { serialized, syncLoop } from '../lib/syncLoop';
import type { Book } from '../lib/types';

/** One notes pass at a time for the whole app, whichever loop asks (syncLoop.ts serialized). */
const notesPass = serialized((vault: string, books: Book[]) => syncBookNotes(vault, books));

/**
 * Runs the notes sync when something changed (a note, a book's metadata, the
 * network back, Retry), never on a clock; a failing pass is retried with a
 * growing delay (syncLoop.ts).
 */
export function useNotesVaultSync(books: Book[], vault: string | null): void {
  const latest = useRef(books);
  latest.current = books;
  const bookMetadata = JSON.stringify(
    books.map(({ id, title, author, chapters }) => ({ id, title, author, chapters }))
  );
  useEffect(() => {
    if (!isFramed()) return;
    const loop = syncLoop(async () => {
      try {
        const targetVault = vault ?? (await withTimeout(bridge.ensureSandbox(), 'vault.sandbox.ensure')).vault;
        await notesPass(targetVault, latest.current);
      } catch (error) {
        markVaultSyncError(latest.current, error);
      }
      const failed = vaultNoteFailures();
      // Key + vars, not the translated text: the same failure must give the
      // same signature in any language, or the backoff would reset.
      return failed.length
        ? failed.map(([id, s]) => `${id}: ${s.key} ${JSON.stringify(s.vars ?? {})}`).join('; ')
        : null;
    }, 1200);
    const kick = (event?: Event) => {
      if (event instanceof CustomEvent && typeof event.detail?.bookId === 'string')
        markVaultSyncPending(event.detail.bookId);
      loop.kick();
    };
    kick();
    window.addEventListener(NOTES_CHANGED, kick);
    window.addEventListener(VAULT_NOTES_RETRY, kick);
    window.addEventListener('online', kick);
    return () => {
      loop.stop();
      window.removeEventListener(NOTES_CHANGED, kick);
      window.removeEventListener(VAULT_NOTES_RETRY, kick);
      window.removeEventListener('online', kick);
    };
  }, [vault]);
  useEffect(() => {
    window.dispatchEvent(new Event(NOTES_CHANGED));
  }, [bookMetadata]);
}

export function useBookVaultStatus(bookId: string) {
  const [state, setState] = useState(() => noteVaultState(bookId));
  useEffect(() => {
    const refresh = () => setState(noteVaultState(bookId));
    refresh();
    window.addEventListener(VAULT_NOTES_STATUS, refresh);
    return () => window.removeEventListener(VAULT_NOTES_STATUS, refresh);
  }, [bookId]);
  return state;
}
