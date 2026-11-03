/**
 * A fake of the host behind `social.ingest` / `social.query` /
 * `vault.sandbox.forget`, modelling the three behaviours that made the first
 * notes sync say "synced" without writing (readerVault.ts). Each is copied from
 * the host, not imagined:
 *
 *  - near-dedup: social spines are fingerprinted on the first 1000 normalized
 *    characters and a match returns the OLD id (core-engine dev-vault.ts,
 *    SOCIAL_SPINE_TYPES + computeContentFingerprint, plain-text branch);
 *  - PromptShield: SOCIAL_NODE / SOCIAL_CONTACT content matching one of its
 *    block patterns is refused (pulse-router.ts SHIELDED_SPINES,
 *    core-engine security/prompt-shield.ts);
 *  - re-chunk: with no inline vector the content is cut by SemanticChunker at
 *    2000 characters and only the first id comes back (dev-vault.ts ingest);
 *  - exact SHA-256 dedup returns the existing row for identical content;
 *  - the listing is the newest `limit` rows (queryRecentChronicles).
 *
 * Tests only; nothing in the app imports it.
 */
import { vi } from 'vitest';
import { readerVaultTransport } from '../lib/readerVault';

export interface FakeRow {
  id: number;
  content: string;
  spine: string;
}

const SOCIAL_SPINE_TYPES = new Set(['SOCIAL_NODE', 'SOCIAL_POST', 'SOCIAL_COMMENT', 'SOCIAL_SAVED']);
const SHIELDED_SPINES = new Set(['SOCIAL_NODE', 'SOCIAL_CONTACT']);
// Two of the shield's real block patterns.
const SHIELD_BLOCKS = [/you\s+are\s+now/i, /ignore\s+(all\s+)?(previous\s+)?instructions/i];

const fingerprint = (content: string) => content.toLowerCase().trim().replace(/\s+/g, ' ').slice(0, 1000);

/** SemanticChunker.chunk(content, 2000) for prose: lines are gathered until
 *  the piece reaches 2000 characters, each piece trimmed. */
function rechunk(content: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (const line of content.split('\n')) {
    cur += `${line}\n`;
    if (cur.length >= 2000) {
      out.push(cur.trim());
      cur = '';
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function fakeVaultHost() {
  const host = {
    rows: [] as FakeRow[],
    nextId: 1,
    /** No inline vector: the host re-chunks (an embedder down or timed out). */
    embedFails: false,
    /** What `vault.sandbox.forget` answers instead of forgetting, once (or a
     *  function of the ids that does both). */
    forgetAnswer: null as unknown,
    /** The next `social.ingest` rejects with this, once. */
    failNextIngest: null as Error | null,
  };
  const store = (content: string, spine: string) => {
    const id = host.nextId++;
    host.rows.push({ id, content, spine });
    return id;
  };
  const invoke = vi.fn(async (action: string, payload: unknown): Promise<unknown> => {
    // The host answers on a later turn, as the postMessage bridge does.
    await Promise.resolve();
    const p = payload as { vault?: string; content?: string; spineType?: string; limit?: number; ids?: number[] };
    if (action === 'social.ingest') {
      if (host.failNextIngest) {
        const err = host.failNextIngest;
        host.failNextIngest = null;
        throw err;
      }
      const content = p.content ?? '';
      const spine = p.spineType ?? 'SOCIAL_NODE';
      // The bridge turns a { success: false } envelope into a rejection.
      if (SHIELDED_SPINES.has(spine) && SHIELD_BLOCKS.some((re) => re.test(content)))
        throw new Error('PROMPT_INJECTION_DETECTED');
      const same = host.rows.find((r) => r.content === content);
      if (same) return { chronicleId: String(same.id) };
      if (SOCIAL_SPINE_TYPES.has(spine)) {
        const near = host.rows.find((r) => SOCIAL_SPINE_TYPES.has(r.spine) && fingerprint(r.content) === fingerprint(content));
        if (near) return { chronicleId: String(near.id) };
      }
      const pieces = host.embedFails ? rechunk(content) : [content];
      const ids = pieces.map((piece) => store(piece, spine));
      return { chronicleId: String(ids[0]) };
    }
    if (action === 'social.query') {
      const limit = Math.min(p.limit ?? 50, 200);
      return {
        chronicles: [...host.rows]
          .sort((a, b) => b.id - a.id)
          .slice(0, limit)
          .map((r) => ({ id: r.id, spineType: r.spine, content: r.content })),
      };
    }
    if (action === 'vault.sandbox.forget') {
      if (host.forgetAnswer !== null) {
        const answer = host.forgetAnswer;
        host.forgetAnswer = null;
        return typeof answer === 'function' ? (answer as (ids: number[]) => unknown)(p.ids ?? []) : answer;
      }
      const before = host.rows.length;
      host.rows = host.rows.filter((r) => !(p.ids ?? []).includes(r.id));
      return { success: true, forgotten: before - host.rows.length };
    }
    throw new Error(`unexpected action ${action}`);
  });
  return { host, invoke, api: readerVaultTransport(invoke) };
}
