/**
 * The system voice list, which Chromium loads asynchronously and sometimes
 * never announces.
 *
 * Small enough to look trivial, and it is not: an empty list is the normal
 * state for the first few hundred milliseconds, so a reader that asked once at
 * mount would offer no voices at all on a cold start.
 */

export interface BrowserVoiceInfo { id: string; name: string; lang: string }

/** List installed browser (SAPI/system) voices. May be empty until the engine warms up. */
export function listBrowserVoices(): BrowserVoiceInfo[] {
  if (typeof speechSynthesis === 'undefined') return [];
  return speechSynthesis.getVoices().map(v => ({ id: v.voiceURI, name: v.name, lang: v.lang }));
}

/** Resolve once the browser voice list is populated (Chromium loads it async). */
export function warmBrowserVoices(): Promise<BrowserVoiceInfo[]> {
  return new Promise((resolve) => {
    if (typeof speechSynthesis === 'undefined') return resolve([]);
    const now = listBrowserVoices();
    if (now.length) return resolve(now);
    const handler = () => { speechSynthesis.onvoiceschanged = null; resolve(listBrowserVoices()); };
    speechSynthesis.onvoiceschanged = handler;
    // Fallback if the event never fires.
    setTimeout(() => resolve(listBrowserVoices()), 800);
  });
}
