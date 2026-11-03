/**
 * readerTransport — the open reader's player, reachable from the agent door
 * (doc 149). The player lives in Reader (a screen mounted on the person's
 * board, which must gain no hook), and the agent handlers live with the App.
 * Reader publishes its player from the effect that creates it and withdraws
 * it in that effect's cleanup, so this holds exactly the reader on screen.
 *
 * Module state on purpose: a store with no React in it adds no hook anywhere.
 *
 * @module lib/readerTransport
 */
import type { ReaderPlayer } from './voice';

export interface ReaderTransport {
  /** The book this reader shows. */
  bookId: string;
  /** The reader's own player: the same object the dock's buttons drive. */
  player: ReaderPlayer;
  /** The book's sentences, as the reader splits them. */
  sentences: readonly string[];
  /** What the dock knows of the voice right now: its name and the paces it really takes (null = none). */
  voice: () => { engineLabel: string; speedRange: { min: number; max: number } | null; sleepRemaining: number | null };
}

let current: ReaderTransport | null = null;

/** Reader, once its player exists. */
export function publishReaderTransport(t: ReaderTransport): void {
  current = t;
}

/** Reader's cleanup: only the transport it published (a remount may already have replaced it). */
export function withdrawReaderTransport(player: ReaderPlayer): void {
  if (current?.player === player) current = null;
}

/** The reader on screen, or null on the library. */
export function readerTransport(): ReaderTransport | null {
  return current;
}
