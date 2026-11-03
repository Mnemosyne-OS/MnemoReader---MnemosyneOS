/**
 * orbPause — the reading stops while the orb listens or speaks, and starts
 * again after (field 2026-10-13: sound playing in a cartridge reached the
 * orb's microphone and Whisper turned it into words nobody said).
 *
 * Paused rather than lowered: a voice reading a book under the orb's voice is
 * two people talking at once, and a lowered voice still reaches the mic as
 * words, which music does less.
 *
 * Rules:
 *  - only a reading THIS module paused is resumed: a book the person paused
 *    themselves stays paused;
 *  - if the person moved the reading during the pause (another sentence, or
 *    the reader closed), nothing is resumed: their gesture wins;
 *  - the state can arrive twice (the host repeats it at every turn): only the
 *    first `true` pauses, only the first `false` resumes.
 *
 * Module state reached through readerTransport, so Reader gains no hook.
 *
 * @module lib/orbPause
 */
import { readerTransport } from './readerTransport';
import type { ReaderPlayer } from './voice';

let paused: { player: ReaderPlayer; index: number } | null = null;

export function handleOrbState(active: boolean): void {
  const t = readerTransport();
  if (active) {
    if (paused || !t) return;
    const st = t.player.state;
    if (st !== 'playing' && st !== 'buffering') return;
    t.player.pause();
    paused = { player: t.player, index: t.player.currentIndex };
    return;
  }
  const was = paused;
  paused = null;
  if (!was || !t || t.player !== was.player) return;
  if (was.player.state !== 'paused' || was.player.currentIndex !== was.index) return;
  was.player.resume();
}

/** Tests only. */
export function __resetOrbPauseForTests(): void {
  paused = null;
}
