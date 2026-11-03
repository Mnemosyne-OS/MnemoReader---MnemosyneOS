import { useEffect, useRef, useState } from 'react';
import { bridge, isFramed } from '../lib/bridge';
import type { Book } from '../lib/types';
import { syncCatalogue } from '../lib/catalogueSync';
import { VAULT_NOTES_RETRY } from '../lib/notesVaultSync';
import { BOOK_SPINE, NOTES_SPINE, withTimeout } from '../lib/readerVault';
import { syncLoop, type SyncLoop } from '../lib/syncLoop';
import { translate } from '../i18n/useI18n';

/**
 * The app's own walled-off vault, and one chronicle per book inside it.
 *
 * This is the ONLY part of MnemoReader that writes about the library rather than
 * about a book being read, which is why it lives apart: the catalogue is a
 * side-effect of owning books, not a step of opening one. Nothing in the reading
 * path depends on it, and a host that refuses it changes nothing on screen.
 *
 * Returns the vault's name once it exists, for anything that wants to name it.
 */
export function useSandboxCatalogue(books: Book[]): string | null {
  const latestBooks = useRef(books);
  latestBooks.current = books;
  // Name of this app's walled-off sandbox vault (`APP-MNEMO-READER`) once ensured.
  const [sandboxVault, setSandboxVault] = useState<string | null>(null);

  // ── App sandbox vault (doc 58) ─────────────────────────────────────────────
  // Ensure the walled-off `APP-MNEMO-READER` vault at boot, then declare its
  // Vault Pad tile. The vault starts isolated (no federated RAG / neural map /
  // Dream State) until the human unlocks permanence from the host — so giving
  // Mnemosyne "the memory of the books" is the human's gated choice.
  useEffect(() => {
    if (!isFramed()) return;
    let cancelled = false;
    void (async () => {
      try {
        const sb = await withTimeout(bridge.ensureSandbox(), 'vault.sandbox.ensure');
        if (cancelled || !sb?.vault) return;
        setSandboxVault(sb.vault);
        await withTimeout(bridge.describeVaultTile({
          icon: '📚',
          // Labels in the language of the moment: a later language switch does not redescribe the tile.
          metrics: [
            { label: translate('tile.books'), spine: BOOK_SPINE },
            // Part 1 of each book's notes only: one per annotated book, not per stored part.
            { label: translate('tile.annotated'), spine: NOTES_SPINE },
          ],
        }), 'vault.sandbox.describeTile');
      } catch (err) {
        console.warn('[MnemoReader] sandbox vault ensure failed', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Only catalogue metadata changes schedule writes; playback progress does not.
  const signature = JSON.stringify(
    books.map(({ id, title, author, ext, chapters, sentenceCount }) => ({
      id,
      title,
      author,
      ext,
      chapters: chapters.length,
      sentenceCount,
    }))
  );
  // Passes never overlap, so a metadata change cannot race an older write; a
  // failing pass is retried with a growing delay, never polled (syncLoop.ts).
  // The network coming back and the notes' Retry button try again at once.
  const loop = useRef<SyncLoop | null>(null);
  useEffect(() => {
    if (!sandboxVault) return;
    const l = syncLoop(async () => {
      await syncCatalogue(sandboxVault, latestBooks.current);
      return null;
    }, 0);
    loop.current = l;
    const kick = () => l.kick();
    window.addEventListener('online', kick);
    window.addEventListener(VAULT_NOTES_RETRY, kick);
    return () => {
      l.stop();
      loop.current = null;
      window.removeEventListener('online', kick);
      window.removeEventListener(VAULT_NOTES_RETRY, kick);
    };
  }, [sandboxVault]);
  useEffect(() => {
    loop.current?.kick();
  }, [sandboxVault, signature]);

  return sandboxVault;
}
