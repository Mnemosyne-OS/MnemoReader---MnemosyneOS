import { useEffect, useState } from 'react';
import { bridge, isFramed } from '../lib/bridge';
import type { Book } from '../lib/types';

/** Stable DJB2 hash — keys the per-vault idempotency map for catalogue sync. */
const hashString = (s: string): string => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

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
        const sb = await bridge.ensureSandbox();
        if (cancelled || !sb?.vault) return;
        setSandboxVault(sb.vault);
        await bridge.describeVaultTile({
          icon: '📚',
          metrics: [
            { label: 'Livres', spine: 'SOCIAL_CONTACT' },
            { label: 'Notes', spine: 'SOCIAL_NODE' },
          ],
        });
      } catch (err) {
        console.warn('[MnemoReader] sandbox vault ensure failed', err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Catalogue sync — one SOCIAL_CONTACT chronicle per book so the tile shows an
  // exact book count. Idempotent: a per-vault localStorage hash map skips books
  // whose catalogue line is unchanged (the host also dedups by SHA-256).
  useEffect(() => {
    if (!sandboxVault?.startsWith('APP-') || books.length === 0) return;
    let cancelled = false;
    void (async () => {
      const key = `mnemoreader_synced_v1:${sandboxVault}`;
      let synced: Record<string, string> = {};
      try { synced = JSON.parse(localStorage.getItem(key) || '{}'); } catch { synced = {}; }
      let pushed = 0;
      for (const b of books) {
        if (b.id.startsWith('sample_')) continue; // ephemeral demo book
        const parts = [`Book: ${b.title}.`];
        if (b.author) parts.push(`Author: ${b.author}.`);
        parts.push(`Format: ${b.ext.toUpperCase()}, ${b.chapters.length} chapters, ${b.sentenceCount} sentences.`);
        const content = parts.join(' ');
        const h = hashString(content);
        if (synced[b.id] === h) continue;
        try {
          await bridge.socialIngest(sandboxVault, content, 'SOCIAL_CONTACT');
          if (cancelled) return;
          synced[b.id] = h;
          pushed++;
        } catch (err) {
          console.warn(`[MnemoReader] catalogue sync failed for "${b.title}"`, err);
        }
      }
      if (pushed > 0 && !cancelled) {
        // A full or blocked storage costs the dedup, not the catalogue: the books
        // were ingested, so the failure must be visible rather than thrown away.
        try { localStorage.setItem(key, JSON.stringify(synced)); }
        catch (err) { console.warn('[MnemoReader] could not persist the catalogue hashes', err); }
        console.log(`[MnemoReader] ${pushed} book(s) catalogued into ${sandboxVault}`);
      }
    })();
    return () => { cancelled = true; };
  }, [sandboxVault, books]);


  return sandboxVault;
}
