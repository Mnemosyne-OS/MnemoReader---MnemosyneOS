/**
 * How much audio to have in hand before reading on — the arithmetic of a slow
 * engine, kept apart from the player that applies it.
 *
 * 🚨 The one fact everything here follows from: the total silence in a chapter
 * is fixed by the engine. At a factor f, reading A seconds costs (f − 1) × A of
 * waiting, and no buffer depth, chunk size or lookahead changes that sum — the
 * deficit accumulates for as long as the reading lasts. Only its DISTRIBUTION is
 * ours: a hole after every sentence, which shreds the prose and reads as a
 * broken app, or a wait taken deliberately, in one piece, with minutes of
 * unbroken reading after it. A book is not a conversation: it can be made to
 * wait, it cannot be made unintelligible.
 *
 * Pure on purpose. These are the numbers quoted to the user ("1.3× — about a
 * minute of waiting for two and a half minutes of reading"), so they are the
 * ones a test can hold to account.
 */
import type { VoiceEngineId } from '../types';

/**
 * Below this much audio still queued, an engine slower than speech has run out
 * of lead and the next chunk WILL arrive late.
 */
export const REFILL_TRIGGER_SEC = 1.5;

/** Under this factor the engine outruns speech and never drains — nothing to do. */
export const REFILL_MIN_FACTOR = 1.05;

/** How much reading one lead should cover… */
export const LEAD_HORIZON_SEC = 300;
/** …and the longest wait allowed to buy it. */
export const LEAD_MAX_WAIT_SEC = 60;
/** Never bother for less than this: the wait would cost more than the holes. */
export const LEAD_MIN_SEC = 8;

/** Where a measured factor is remembered, per engine. */
export const FACTOR_KEY = 'mnemoreader.ttsFactor';

/**
 * The factor measured on THIS machine last time, per engine.
 *
 * 🚨 Why it is persisted: the first play of a session cannot know whether the
 * engine keeps up — the factor needs a few units to mean anything — so without a
 * memory the reader must either make everyone wait (wrong for Piper and XTTS,
 * which outrun speech) or discover the problem the hard way, every single time,
 * by running out of lead mid-paragraph. Remembering what this machine already
 * proved lets the FIRST play pay the lead up front, which is the whole point.
 */
export function readStoredFactor(engine: string): number | null {
  try {
    const all = JSON.parse(localStorage.getItem(FACTOR_KEY) || '{}') as Record<string, number>;
    const v = Number(all[engine]);
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch { return null; }
}

export function writeStoredFactor(engine: string, factor: number): void {
  try {
    const all = JSON.parse(localStorage.getItem(FACTOR_KEY) || '{}') as Record<string, number>;
    all[engine] = Number(factor.toFixed(3));
    localStorage.setItem(FACTOR_KEY, JSON.stringify(all));
  } catch { /* a full or blocked storage must never stop a reading */ }
}

/**
 * Seconds of audio to build before playing on, from the engine's measured speed.
 *
 * `lead = (f − 1) × HORIZON`, capped so the wait itself never exceeds MAX_WAIT.
 * At 1.3×: 90 s of audio would cover five minutes of reading, the cap brings it
 * to ~46 s of audio bought with ~60 s of waiting — about two and a half minutes
 * straight through.
 *
 * Returns 0 for an unknown factor and for anything at or under REFILL_MIN_FACTOR:
 * Piper and XTTS outrun speech, and must never be made to wait for a problem
 * they do not have.
 */
export function leadTargetSec(factor: number | null): number {
  if (factor === null || factor <= REFILL_MIN_FACTOR) return 0;
  const covers = (factor - 1) * LEAD_HORIZON_SEC;   // enough for HORIZON of reading
  const affordable = LEAD_MAX_WAIT_SEC / factor;    // …without waiting longer than MAX_WAIT
  return Math.max(LEAD_MIN_SEC, Math.min(covers, affordable));
}

/** Piper is a per-sentence C++ process: if it has not answered by now, it is stuck. */
export const PIPER_TIMEOUT_MS = 15_000;

/**
 * How long one neural request may take before we call it stuck.
 *
 * 🚨 This was a flat 15 s for every engine, which is BELOW the healthy runtime of
 * a cloning engine: a 280-character chunk is ~19 s of audio, and Chatterbox
 * measured 1.65× realtime on a 4050 — around 31 s of work, aborted at 15 s,
 * three times in a row, and the reader concluded "neural voice unavailable" and
 * spoke with the system voice. A timeout tuned to the fastest engine reads, from
 * the outside, exactly like the slow engine being broken.
 */
export function speakTimeoutMs(engine: VoiceEngineId, chars: number): number {
  if (engine === 'piper') return PIPER_TIMEOUT_MS;
  return Math.min(120_000, Math.max(30_000, chars * 300));
}
