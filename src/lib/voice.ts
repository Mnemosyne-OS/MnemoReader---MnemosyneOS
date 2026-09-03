/**
 * The reader's voice, in three files rather than one.
 *
 * This module stays the single import site for the rest of the app — `voice.ts`
 * is what every component asks for — while the pieces behind it are separable
 * and, where it matters, testable on their own:
 *
 *   • `voice/leadPolicy`    — the arithmetic of an engine slower than speech:
 *                             the measured factor, what it is worth remembering,
 *                             and how much audio to hold before reading on. Pure
 *                             functions, because these are the numbers the app
 *                             quotes to the user.
 *   • `voice/browserVoices` — the system voice list, which Chromium loads late.
 *   • `voice/player`        — ReaderPlayer: the two backends, the gapless
 *                             scheduler, preparation and the deliberate refill.
 *
 * It grew from 411 lines to 735 in a single day of voice work, which is the
 * point where a file stops being read and starts being scrolled.
 */
export { listBrowserVoices, warmBrowserVoices, type BrowserVoiceInfo } from './voice/browserVoices';
export { ReaderPlayer, type PlayerState, type PlayerHooks, type PrepareOutcome, type PrepareProgress } from './voice/player';
export { leadTargetSec, readStoredFactor, REFILL_MIN_FACTOR } from './voice/leadPolicy';
