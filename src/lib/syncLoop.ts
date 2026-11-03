/**
 * syncLoop.ts — when the catalogue and notes sync run, and when they wait.
 *
 * A pass runs when something changed (`kick`): a note saved, a book's
 * metadata, the network back, the Retry button. A pass that succeeds is NOT
 * followed by another one a minute later: the first version polled
 * `social.query` every 60 s for as long as the cartridge stayed open, and kept
 * retrying the same refusal every minute forever.
 *
 * A pass that fails is retried after 1, 2, 4, 8 then every 10 minutes while it
 * fails the SAME way. A different failure, or any kick, starts again at 1 min:
 * something changed, so the next try may well succeed.
 *
 * Passes never overlap: a kick during a pass runs one more pass after it.
 */
export const RETRY_FIRST_MS = 60_000;
export const RETRY_MAX_MS = 600_000;

export interface SyncLoop {
  /**
   * Something changed: run a pass after `delayMs` (default `debounceMs`) and
   * forget the backoff. A later kick re-arms the wait, except that a longer one
   * never delays a pass a shorter kick already asked for: typing in the
   * general notes must not hold back a highlight saved just before.
   */
  kick(delayMs?: number): void;
  /** Cancel every timer; a pass in flight finishes, nothing follows it. */
  stop(): void;
}

/**
 * @param pass One pass. Resolves to null on success, or to a short text saying
 *             what failed: two passes failing with the same text back off.
 */
export function syncLoop(pass: () => Promise<string | null>, debounceMs: number): SyncLoop {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  /** A kick that came during a pass: the delay the next pass waits, or null. */
  let dirty: number | null = null;
  /** The timer armed is a prompt one (a kick at `debounceMs` or less). */
  let prompt = false;
  let stopped = false;
  let failures = 0;
  let lastFailure: string | null = null;

  const arm = (ms: number, isPrompt = false) => {
    clearTimeout(timer);
    prompt = isPrompt;
    timer = setTimeout(() => {
      prompt = false;
      void runNow();
    }, ms);
  };

  async function runNow(): Promise<void> {
    // Only a timer calls this, and none is armed while a pass runs (a kick
    // then only marks it dirty), so passes cannot overlap.
    if (stopped) return;
    running = true;
    let failure: string | null;
    try {
      failure = await pass();
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    } finally {
      running = false;
    }
    if (stopped) return;
    if (dirty !== null) {
      const wait = dirty;
      dirty = null;
      arm(wait, wait <= debounceMs);
      return;
    }
    if (failure === null) {
      failures = 0;
      lastFailure = null;
      return;
    }
    if (failure !== lastFailure) failures = 0;
    lastFailure = failure;
    const wait = Math.min(RETRY_FIRST_MS * 2 ** failures, RETRY_MAX_MS);
    failures++;
    console.warn(`[MnemoReader] vault sync will retry in ${Math.round(wait / 1000)} s:`, failure);
    arm(wait);
  }

  return {
    kick(delayMs?: number) {
      if (stopped) return;
      // The next failure then differs from the last one: back to 1 minute.
      lastFailure = null;
      const wait = delayMs ?? debounceMs;
      const isPrompt = wait <= debounceMs;
      if (running) dirty = dirty === null ? wait : Math.min(dirty, wait);
      else if (!(prompt && !isPrompt)) arm(wait, isPrompt);
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}

/**
 * Runs `fn` after every earlier call has settled, across loops: the notes hook
 * starts a loop before the sandbox's name is known and another once it is, and
 * a pass of the first could still be writing when the second began (logic
 * review). One queue per wrapped function, so two passes never share the
 * journal at once.
 */
export function serialized<A extends unknown[], T>(fn: (...args: A) => Promise<T>): (...args: A) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return (...args) => {
    const go = () => fn(...args);
    const run = tail.then(go, go);
    tail = run.catch(() => undefined);
    return run;
  };
}
