/**
 * VoiceEngine — the reader's playback core. Two interchangeable backends behind
 * one Player API:
 *
 *   • 'browser'  — Web Speech API (speechSynthesis). Emits real word-boundary
 *     events, so karaoke highlighting is exact. Always available in Chromium.
 *   • any other id — the host's local neural TTS (Piper, XTTS, Chatterbox, …).
 *     Higher quality; returns raw PCM we play via Web Audio, scheduled on the
 *     audio clock for gapless unit-to-unit playback. Karaoke is time-interpolated
 *     across the unit's words.
 *
 * 🚨 The neural side is engine-AGNOSTIC on purpose. It used to branch on
 * `engine === 'xtts' ? 'xtts' : 'piper'`, which quietly rewrote every other
 * engine into Piper. The id is carried, never interpreted, and everything that
 * DIFFERS between engines — the chunk budget, the delivery, the pronunciation —
 * is the host's: one unit of text goes out, one buffer comes back.
 *
 * A generation counter invalidates in-flight callbacks whenever we stop, seek,
 * or switch engine, so a late onended/onboundary can never advance stale state.
 */
import { bridge } from '../bridge';
import { BROWSER_ENGINE, isNeuralEngine, type VoiceEngineId } from '../types';
import {
  REFILL_TRIGGER_SEC, LEAD_MIN_SEC,
  readStoredFactor, writeStoredFactor, leadTargetSec, speakTimeoutMs,
} from './leadPolicy';

export type PlayerState = 'idle' | 'playing' | 'paused' | 'buffering';

export interface PlayerHooks {
  /** Fired when a sentence starts. */
  onSentence?: (index: number) => void;
  /** Karaoke: the active word's char range *within* sentence `index`. */
  onWord?: (index: number, charStart: number, charEnd: number) => void;
  onState?: (state: PlayerState) => void;
  /** Reached the end of the book. */
  onEnd?: () => void;
  /** While a lead is being built: seconds ready out of seconds wanted. A silent
   *  wait of a minute is indistinguishable from a freeze — this is what makes it
   *  legible while it happens. */
  onLead?: (readySec: number, targetSec: number) => void;
  /** A unit could not be synthesized and was passed over — words the listener
   *  will never hear. Never silent: the reading jumps and the sense goes with it. */
  onSkipped?: (index: number, reason: string) => void;
  onError?: (message: string) => void;
}

interface WordSpan { start: number; end: number }
function tokenizeWords(s: string): WordSpan[] {
  const out: WordSpan[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) out.push({ start: m.index, end: m.index + m[0].length });
  return out;
}

/**
 * Read-ahead depth: how many upcoming sentences to synthesize in advance so
 * playback + the karaoke follow-along stay buffered. A reader-side parameter —
 * it does NOT change the host TTS engine. Bigger = smoother start and more time
 * to load the text-tracking; costs a little memory/CPU up front.
 */
const PREFETCH_LEAD = 3;

/** Schedule up to this many seconds of audio ahead on the Web Audio clock (gapless). */
const LOOKAHEAD_SEC = 12;

/** How long "playing, yet nothing scheduled and nothing in flight" may last
 *  before the pump is restarted. Generous on purpose: one Chatterbox unit
 *  measured 10-27 s of work, but one is always IN FLIGHT while it works — so
 *  this can only fire on a state that is going nowhere. */
const STALL_GRACE_MS = 8000;

/**
 * Ceiling on prepared audio held in memory, in seconds.
 *
 * ⚠️ A bound, not a target: mono 24 kHz Float32 is ~96 KB per second, so 15
 * minutes is ~86 MB sitting in the tab. Preparing a whole book would be several
 * gigabytes, which is why preparation is per CHAPTER and stops here rather than
 * growing until something else breaks.
 */
const PREPARED_MAX_SEC = 900;

/** How a preparation run ended — the caller says so, rather than guessing. */
export type PrepareOutcome = 'done' | 'stopped' | 'full' | 'failed';

export interface PrepareProgress {
  /** Units synthesized so far, out of the span asked for. */
  done: number;
  total: number;
  /** Seconds of audio ready to play without waiting for anything. */
  secondsReady: number;
}

/** Reject if a promise doesn't settle within `ms`. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`TTS_TIMEOUT after ${Math.round(ms / 1000)}s`)), ms);
    // Reject with an Error whatever came out: a caller that logs `err.message`
    // on a rejected string prints "undefined", which is how a real cause gets lost.
    p.then((v) => { clearTimeout(t); resolve(v); },
      (e: unknown) => { clearTimeout(t); reject(e instanceof Error ? e : new Error(String(e))); });
  });
}

export class ReaderPlayer {
  private sentences: string[] = [];
  private index = 0;
  private gen = 0;
  private _state: PlayerState = 'idle';

  private engine: VoiceEngineId;
  private voice: string;
  private rate: number;
  private hooks: PlayerHooks;

  // Host neural backend state.
  private audioCtx: AudioContext | null = null;
  private bufferCache = new Map<number, AudioBuffer>();
  private pending = new Map<number, Promise<AudioBuffer | null>>(); // in-flight fetches (dedup)
  private lookaheadSec = LOOKAHEAD_SEC; // how far ahead the pump fills (raised while refilling)
  private refilling = false;   // playback is stopped on purpose to rebuild a lead
  private preparing = false;   // a prepare() run is filling the cache ahead
  private prepareStop = false; // …and has been asked to stop
  private rafId = 0; // gapless-scheduler tracker rAF
  private keepAlive: ReturnType<typeof setInterval> | null = null; // Chromium speechSynthesis keep-alive
  // Gapless scheduler: neural chunks queued on the Web Audio clock, back-to-back.
  private scheduled: Array<{ index: number; startAt: number; endAt: number; src: AudioBufferSourceNode }> = [];
  private schedNext = 0;    // next unit index to schedule
  private schedNextAt = 0;  // ctx-clock time for the next chunk (0 = start ~now)
  private pumping = false;  // guard against concurrent schedule pumps
  private stalledAt = 0;    // when "playing but idle" began (watchdog)
  private lastAudible = -1; // currently-audible unit (drives onSentence)
  private curWords: WordSpan[] = []; // tokenized words of the audible unit (karaoke)

  constructor(engine: VoiceEngineId, voice: string, rate: number, hooks: PlayerHooks) {
    this.engine = engine;
    this.voice = voice;
    this.rate = rate;
    this.hooks = hooks;
  }

  get state(): PlayerState { return this._state; }
  get currentIndex(): number { return this.index; }

  private setState(s: PlayerState) { this._state = s; this.hooks.onState?.(s); }

  load(sentences: string[]) {
    this.stop();
    this.sentences = sentences;
    this.index = 0;
  }

  /** Play from a sentence index (defaults to the current position). */
  play(from?: number) {
    if (!this.sentences.length) return;
    if (typeof from === 'number') this.index = Math.max(0, Math.min(from, this.sentences.length - 1));
    this.gen++;
    this.setState('playing');
    if (this.engine === BROWSER_ENGINE) this.speakBrowser();
    else void this.startNeural();
  }

  pause() {
    // 🪤 'buffering' counts as playing here. A deliberate refill pause leaves the
    // player in that state for tens of seconds, and a pause() that ignored it
    // would make the button do nothing exactly when the user most wants it —
    // then toggle() would fall through to play() and restart the passage.
    if (this._state !== 'playing' && this._state !== 'buffering') return;
    if (this.engine === BROWSER_ENGINE) { try { speechSynthesis.pause(); } catch { /* noop */ } }
    else { void this.audioCtx?.suspend(); this.cancelRaf(); }
    this.setState('paused');
  }

  resume() {
    if (this._state !== 'paused') return;
    if (this.engine === BROWSER_ENGINE) { try { speechSynthesis.resume(); } catch { /* noop */ } this.setState('playing'); }
    else { void this.audioCtx?.resume().then(() => this.startNeuralTracker(this.gen)); this.setState('playing'); }
  }

  toggle() {
    if (this._state === 'playing' || this._state === 'buffering') this.pause();
    else if (this._state === 'paused') this.resume();
    else this.play();
  }

  /** Jump to a sentence; keeps playing if we were playing, else just repositions. */
  seek(index: number) {
    const wasPlaying = this._state === 'playing' || this._state === 'buffering';
    this.stopAudioOnly();
    this.index = Math.max(0, Math.min(index, this.sentences.length - 1));
    this.hooks.onSentence?.(this.index);
    if (wasPlaying) this.play(this.index);
  }

  stop() {
    this.stopAudioOnly();
    this.setState('idle');
  }

  setRate(rate: number) {
    this.rate = rate;
    // A neural engine bakes the pace into the synthesis, so cached + in-flight
    // buffers are now wrong — for EVERY such engine, not just Piper.
    if (isNeuralEngine(this.engine)) this.dropPrepared();
    if (this._state === 'playing') this.seek(this.index); // restart current sentence at new rate
  }

  /** Switch engine/voice. */
  setVoice(engine: VoiceEngineId, voice: string) {
    const wasPlaying = this._state === 'playing';
    this.stopAudioOnly();
    this.engine = engine;
    this.voice = voice;
    this.dropPrepared();
    if (wasPlaying) this.play(this.index);
  }

  /** Everything cached was spoken by the OLD engine/voice/pace — and a run still
   *  preparing would keep filling the cache with it. Both go together. */
  private dropPrepared() {
    this.prepareStop = true;
    this.bufferCache.clear();
    this.pending.clear();
  }

  /** Seconds of audio already synthesized and waiting, from `from` onwards. */
  preparedSeconds(from = this.index): number {
    let total = 0;
    for (const [i, buf] of this.bufferCache) if (i >= from) total += buf.duration;
    return total;
  }

  /** True while a preparation run is filling the cache. */
  get isPreparing(): boolean { return this.preparing; }

  /** Stop a preparation run; what is already prepared stays prepared. */
  stopPreparing() { this.prepareStop = true; }

  /**
   * Synthesize a whole span AHEAD of playback, so a chapter can be read with no
   * holes at all.
   *
   * 🚨 This is the only real answer to an engine slower than speech, and the
   * arithmetic says why: at a factor f > 1, playing A seconds without a hole
   * needs a lead of (f − 1) × A. At the 1.65× measured for Chatterbox, twenty
   * minutes of chapter needs about thirteen minutes of head start — no rolling
   * lookahead recovers that, because the deficit accumulates for as long as the
   * reading lasts. So it is paid ONCE, up front, visibly, instead of being spent
   * as a hole after every sentence.
   *
   * Playback may start at any time: the scheduler reads the same cache, so
   * whatever is ready plays immediately and preparation keeps running ahead.
   */
  async prepare(from: number, to: number, onProgress?: (p: PrepareProgress) => void): Promise<PrepareOutcome> {
    if (this.preparing) return 'stopped';
    const first = Math.max(0, Math.min(from, this.sentences.length - 1));
    const last = Math.max(first, Math.min(to, this.sentences.length));
    this.preparing = true;
    this.prepareStop = false;
    const total = last - first;
    let outcome: PrepareOutcome = 'done';
    try {
      for (let i = first; i < last; i++) {
        if (this.prepareStop) { outcome = 'stopped'; break; }
        if (this.preparedSeconds(first) >= PREPARED_MAX_SEC) { outcome = 'full'; break; }
        // 🚨 PLAYBACK COMES FIRST. The engine answers one request at a time, so
        // a preparation chunk queued ahead of the one being listened to makes the
        // reading wait for it — measured 2026-08-21: pressing Prepare mid-chapter
        // pushed the factor from 1.47× to 2.17× and opened "un gros blanc". The
        // help was competing with what it was helping. So preparation only ever
        // uses the room playback is not using: while the lead is short, it waits.
        await this.yieldToPlayback();
        if (this.prepareStop) { outcome = 'stopped'; break; }
        try {
          await this.fetchBuffer(i);
        } catch (err) {
          // One failed unit is skipped by the player too; a run that dies on the
          // first is a real failure and must say so rather than end quietly.
          console.warn('[voice] prepare failed on unit', i, err instanceof Error ? err.message : err);
          if (i === first) { outcome = 'failed'; break; }
        }
        onProgress?.({ done: i - first + 1, total, secondsReady: this.preparedSeconds(first) });
      }
    } finally {
      this.preparing = false;
      this.prepareStop = false;
    }
    return outcome;
  }

  dispose() {
    this.stopAudioOnly();
    if (this.keepAlive) { clearInterval(this.keepAlive); this.keepAlive = null; }
    if (this.audioCtx) { void this.audioCtx.close(); this.audioCtx = null; }
  }

  // ── internals ────────────────────────────────────────────────────────────

  private cancelRaf() { if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = 0; } }

  private stopAudioOnly() {
    this.gen++;
    this.cancelRaf();
    if (this.engine === BROWSER_ENGINE) { try { speechSynthesis.cancel(); } catch { /* noop */ } }
    for (const c of this.scheduled) { try { c.src.onended = null; c.src.stop(); } catch { /* already stopped */ } }
    this.scheduled = [];
    this.schedNext = 0; this.schedNextAt = 0; this.lastAudible = -1; this.pumping = false;
  }

  private advance(gen: number) {
    if (gen !== this.gen) return;
    if (this.index + 1 >= this.sentences.length) { this.setState('idle'); this.hooks.onEnd?.(); return; }
    this.index++;
    if (this.engine === BROWSER_ENGINE) this.speakBrowser();
    else void this.startNeural();
  }

  // ── browser (Web Speech) ──────────────────────────────────────────────────

  private speakBrowser() {
    if (typeof speechSynthesis === 'undefined') { this.hooks.onError?.('Web Speech unavailable'); this.setState('idle'); return; }
    const gen = this.gen;
    const i = this.index;
    const text = this.sentences[i];
    this.hooks.onSentence?.(i);

    const u = new SpeechSynthesisUtterance(text);
    u.rate = Math.max(0.5, Math.min(2, this.rate));
    const match = speechSynthesis.getVoices().find(v => v.voiceURI === this.voice || v.name === this.voice);
    if (match) u.voice = match;

    u.onboundary = (e: SpeechSynthesisEvent) => {
      if (gen !== this.gen) return;
      if (e.name && e.name !== 'word') return;
      const start = e.charIndex ?? 0;
      // charLength is not always present; approximate to the next whitespace.
      let end = start + (e.charLength ?? 0);
      if (!e.charLength) { const nxt = text.indexOf(' ', start); end = nxt === -1 ? text.length : nxt; }
      this.hooks.onWord?.(i, start, end);
    };
    // Chromium cuts long/idle utterances (~15s) and can drop the 'end' event —
    // a keep-alive prevents the freeze; a watchdog force-advances if 'end' never
    // fires, so reading never stalls silently on the system voice.
    this.startKeepAlive();
    const watchdog = setTimeout(() => {
      if (gen === this.gen && this._state === 'playing') this.advance(gen);
    }, (text.length * 100) / u.rate + 6000);
    u.onend = () => { clearTimeout(watchdog); this.advance(gen); };
    u.onerror = (ev: SpeechSynthesisErrorEvent) => {
      clearTimeout(watchdog);
      if (gen !== this.gen) return;
      if (ev.error === 'interrupted' || ev.error === 'canceled') return; // our own stop/seek
      this.hooks.onError?.(`Speech error: ${ev.error}`);
      this.advance(gen);
    };
    try { speechSynthesis.speak(u); } catch (err) { clearTimeout(watchdog); this.hooks.onError?.(String(err)); }
  }

  /** Keep Chromium's speechSynthesis from auto-pausing during long browser playback. */
  private startKeepAlive() {
    if (this.keepAlive) return;
    this.keepAlive = setInterval(() => {
      if (this._state === 'playing' && this.engine === BROWSER_ENGINE) {
        try { speechSynthesis.pause(); speechSynthesis.resume(); } catch { /* noop */ }
      }
    }, 12_000);
    (this.keepAlive as unknown as { unref?: () => void }).unref?.();
  }

  // ── host neural engine (Web Audio) ────────────────────────────────────────

  private ensureCtx(): AudioContext {
    if (!this.audioCtx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioCtx = new Ctor();
    }
    return this.audioCtx;
  }

  /** s16le PCM (base64) → mono samples. */
  private decodePcm(base64: string): Float32Array {
    const bin = atob(base64);
    const len = bin.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    const view = new DataView(bytes.buffer);
    const samples = Math.floor(len / 2);
    const out = new Float32Array(samples);
    for (let i = 0; i < samples; i++) out[i] = view.getInt16(i * 2, true) / 32768;
    return out;
  }

  /** Samples → a playable buffer (one unit = one scheduled chunk). */
  private toBuffer(samples: Float32Array, sampleRate: number): AudioBuffer {
    const buf = this.ensureCtx().createBuffer(1, Math.max(1, samples.length), sampleRate || 22050);
    buf.getChannelData(0).set(samples, 0);
    return buf;
  }

  private fetchBuffer(i: number): Promise<AudioBuffer | null> {
    if (i < 0 || i >= this.sentences.length) return Promise.resolve(null);
    const cached = this.bufferCache.get(i);
    if (cached) return Promise.resolve(cached);
    const existing = this.pending.get(i);
    if (existing) return existing; // dedup: prefetch + playback share one request
    const job = (async () => {
      // One unit, one request, one buffer. The host cuts it to the engine's
      // budget at clause boundaries and hands back the stitched audio — the
      // cartridge does not decide how its words are delivered. `next` lets the
      // host tell a sentence end from a seam its own budget cut.
      const text = this.sentences[i];
      const startedAt = performance.now();
      const res = await withTimeout(
        bridge.ttsSpeak(text, this.voice, this.rate, this.engine, this.sentences[i + 1]?.slice(0, 200)),
        speakTimeoutMs(this.engine, text.length),
      );
      if (!res?.success || !res.pcmBase64) throw new Error(res?.error || 'TTS_FAILED');
      const buf = this.toBuffer(this.decodePcm(res.pcmBase64), res.sampleRate ?? 22050);
      this.noteSpeed((performance.now() - startedAt) / 1000, buf.duration);
      this.bufferCache.set(i, buf);
      // Bound the cache so a long book doesn't grow unbounded. Only ever drop
      // what is BEHIND the playhead: everything ahead may have been prepared on
      // purpose, and discarding it would silently undo the wait the user paid.
      const keep = this.preparing ? this.bufferCache.size : PREFETCH_LEAD + 4;
      while (this.bufferCache.size > keep) {
        const oldest = [...this.bufferCache.keys()].find(k => k < this.index - 1);
        if (oldest === undefined) break;
        this.bufferCache.delete(oldest);
      }
      return buf;
    })();
    this.pending.set(i, job);
    job.then(() => this.pending.delete(i), () => this.pending.delete(i));
    return job;
  }

  private consecFail = 0;   // consecutive synth failures → fall back after a few

  // ── how fast this engine actually is, measured rather than assumed ────────
  private synthSec = 0;     // seconds spent synthesizing
  private audioSec = 0;     // seconds of audio obtained for them
  private measured = 0;     // units measured (a factor from one sample is noise)

  private noteSpeed(spent: number, produced: number) {
    if (produced <= 0) return;
    this.synthSec += spent;
    this.audioSec += produced;
    this.measured += 1;
    // Remembered every few units so the NEXT reading starts already knowing.
    if (this.measured >= 3 && this.measured % 3 === 0) {
      writeStoredFactor(this.engine, this.synthSec / this.audioSec);
    }
  }

  /**
   * Hold a preparation run back while the playhead is running short.
   *
   * Returns as soon as the reading has a comfortable lead again — or straight
   * away when nothing is playing, which is what Prepare was designed for.
   */
  private async yieldToPlayback(): Promise<void> {
    const comfortable = () => this._state !== 'playing'
      || this.queuedAhead() >= Math.max(REFILL_TRIGGER_SEC * 2, this.leadTargetSec() / 2);
    while (!comfortable() && !this.prepareStop) {
      await new Promise(r => setTimeout(r, 400));
    }
  }

  /** Seconds of audio still queued beyond the playhead. */
  private queuedAhead(): number {
    const ctx = this.audioCtx;
    if (!ctx || !this.schedNextAt) return 0;
    return Math.max(0, this.schedNextAt - ctx.currentTime);
  }

  /** How much lead this engine needs, from what it has proved it can do. */
  private leadTargetSec(): number {
    return leadTargetSec(this.realtimeFactor() ?? readStoredFactor(this.engine));
  }

  /**
   * Seconds of work per second of speech, or null while it is not yet known.
   *
   * 🚨 Above 1 the reader CANNOT keep up while playing: the deficit is
   * (f − 1) × A and it accumulates for as long as the reading lasts, so no
   * lookahead depth recovers it — only preparing ahead does. Null until three
   * units have been measured, because a factor read off one cold-start unit
   * would describe the model loading, not the engine.
   */
  realtimeFactor(): number | null {
    if (this.measured < 3 || this.audioSec <= 0) return null;
    return this.synthSec / this.audioSec;
  }

  /** Start gapless neural playback from this.index: schedule chunks on the audio clock. */
  private async startNeural() {
    const gen = this.gen;
    const ctx = this.ensureCtx();
    try { if (ctx.state === 'suspended') await ctx.resume(); } catch { /* noop */ }
    if (gen !== this.gen) return;
    this.schedNext = this.index;
    this.schedNextAt = 0;
    this.lastAudible = -1;
    if (!this.bufferCache.has(this.index)) this.setState('buffering');
    this.startNeuralTracker(gen);

    // 🚨 Pay the lead FIRST on an engine known to be slower than speech, rather
    // than start on one block and run dry a paragraph later. The wait is the
    // same silence either way — this way it lands in one piece, before the first
    // word, where it reads as preparation instead of as the reader breaking
    // down. Which engines need it is remembered from what this machine measured,
    // so Piper and XTTS never wait for a problem they do not have.
    if (this.leadTargetSec() > 0 && this.queuedAhead() < this.leadTargetSec()) {
      void this.refill(gen);
      // 🪤 refill() DECLINES when one is already marked in flight, and its
      // prologue runs synchronously — so this flag says whether it took charge.
      // Returning without checking left NOBODY pumping: the engine went quiet,
      // the state stayed 'playing', and the reading froze with no error anywhere.
      if (this.refilling) return;
    }
    void this.pumpSchedule(gen);
  }

  /**
   * Fill the schedule up to ~LOOKAHEAD_SEC of audio ahead, back-to-back on the
   * audio clock (so chunks play gaplessly). Fetches one unit at a time (retry once,
   * skip on repeated failure). Re-invoked by the tracker as playback advances.
   */
  private async pumpSchedule(gen: number) {
    if (this.pumping) return;
    this.pumping = true;
    try {
      const ctx = this.ensureCtx();
      while (gen === this.gen && this.schedNext < this.sentences.length) {
        const queuedUntil = this.schedNextAt || ctx.currentTime;
        if (queuedUntil > ctx.currentTime + this.lookaheadSec) break; // enough buffered ahead
        const idx = this.schedNext;
        let buf: AudioBuffer | null = null;
        // 🚨 Three attempts, not two, and a skip is REPORTED. A unit that fails
        // is a sentence the listener never hears: the reading jumps from the one
        // before it to the one after, and the passage stops making sense with
        // nothing on screen saying why. Most failures are transient (the GPU is
        // busy with the chunk that is playing), so the retry is worth more here
        // than anywhere else — and what survives all three is said out loud.
        for (let attempt = 0; attempt < 3 && buf === null; attempt++) {
          try { buf = await this.fetchBuffer(idx); }
          catch (err) {
            if (gen !== this.gen) return;
            if (attempt < 2) { this.pending.delete(idx); continue; }
            const why = err instanceof Error ? err.message : String(err);
            console.warn('[voice] unit failed after 3 attempts, skipping', idx, why);
            this.hooks.onSkipped?.(idx, why);
            if (++this.consecFail >= 3) { this.consecFail = 0; this.hooks.onError?.(why); return; }
            break; // skip this unit
          }
        }
        if (gen !== this.gen) return;
        this.schedNext = idx + 1;
        if (!buf) continue; // skipped
        this.consecFail = 0;
        // Never schedule in the past: if synthesis fell behind playback, start the next
        // chunk just ahead of 'now' (small gap) instead of stacking sources (overlap/garble).
        const startAt = this.schedNextAt === 0
          ? ctx.currentTime + 0.08
          : Math.max(this.schedNextAt, ctx.currentTime + 0.02);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(ctx.destination);
        try { src.start(startAt); } catch { continue; }
        this.scheduled.push({ index: idx, startAt, endAt: startAt + buf.duration, src });
        this.schedNextAt = startAt + buf.duration;
      }
    } finally {
      this.pumping = false;
    }
  }

  /**
   * Stop playback on purpose and rebuild a lead, then carry on.
   *
   * 🚨 This does not save a single second — the total silence in a chapter is
   * (f − 1) × its length whatever we do. It moves it. An engine at 1.33× with no
   * lead left inserts a gap after EVERY chunk, which turns prose into a list of
   * disconnected sentences and reads as a broken app; the same seconds spent as
   * one announced pause buy minutes of unbroken reading on either side.
   *
   * Suspending the context freezes the clock, so everything already scheduled
   * keeps its place and simply resumes — the same mechanism `pause()` uses.
   */
  private async refill(gen: number) {
    if (this.refilling || this.engine === BROWSER_ENGINE) return;
    this.refilling = true;
    const target = Math.max(LEAD_MIN_SEC, this.leadTargetSec());
    this.lookaheadSec = target;
    const ctx = this.ensureCtx();
    this.setState('buffering');
    try { await ctx.suspend(); } catch { /* already suspended */ }
    try {
      // The pump fills to lookaheadSec and returns; loop in case it was busy.
      for (let i = 0; i < 3; i++) {
        if (gen !== this.gen) return;
        await this.pumpSchedule(gen);
        if (this.schedNext >= this.sentences.length) break;
        if (this.queuedAhead() >= target) break;
      }
    } finally {
      this.lookaheadSec = LOOKAHEAD_SEC;
      this.refilling = false;
      // Only WE may end this pause: if the user hit pause or seeked meanwhile,
      // the state is no longer ours to change.
      if (gen === this.gen && this._state === 'buffering') {
        try { await ctx.resume(); } catch { /* nothing to resume */ }
        this.setState('playing');
      }
    }
  }

  /** rAF loop: map the audio clock → audible unit (onSentence) + word (onWord), keep the
   *  schedule topped up, and detect end. Absolute scheduling means pause = ctx.suspend(). */
  private startNeuralTracker(gen: number) {
    this.cancelRaf();
    const ctx = this.ensureCtx();
    const tick = () => {
      if (gen !== this.gen) return;
      const t = ctx.currentTime;
      // Once any audio is queued we're no longer buffering — don't hang on
      // "Synthesizing…" if the clock sits a hair outside a chunk's window.
      // (Unless we stopped on purpose to rebuild a lead: that IS buffering.)
      if (this.scheduled.length && this._state === 'buffering' && !this.refilling) this.setState('playing');

      // A lead being built: report it, so the wait shows its own progress.
      if (this.refilling) this.hooks.onLead?.(this.queuedAhead(), this.lookaheadSec);

      // 🚨 Watchdog. Measured 2026-08-21 from the host log: the engine answered
      // every request (1.5-2.1× realtime, no error), then the reader simply
      // stopped asking — 84 s of silence, the sidecar at 0.00 s of CPU, the dock
      // still showing "playing". Nothing scheduled, nothing in flight, and yet
      // playing, is a state that cannot make progress on its own. The CAUSE IS
      // STILL OPEN; this makes the reading recover instead of waiting for ever,
      // and it logs when it fires so the next occurrence leaves evidence.
      if (this._state === 'playing' && !this.refilling && !this.scheduled.length
        && !this.pending.size && this.schedNext < this.sentences.length) {
        if (!this.stalledAt) this.stalledAt = performance.now();
        else if (performance.now() - this.stalledAt > STALL_GRACE_MS) {
          console.warn('[voice] stalled: nothing scheduled, nothing in flight — restarting the pump');
          this.stalledAt = 0;
          this.pumping = false;   // a pump that never settled must not hold the door
          if (ctx.state === 'suspended') void ctx.resume();
          void this.pumpSchedule(gen);
        }
      } else {
        this.stalledAt = 0;
      }

      // Out of lead on an engine slower than speech: stop deliberately and
      // rebuild, rather than let every following chunk arrive late.
      if (this._state === 'playing' && !this.refilling && this.schedNext < this.sentences.length
        && (this.schedNextAt - t) < REFILL_TRIGGER_SEC && this.leadTargetSec() > 0) {
        void this.refill(gen);
      }
      const cur = this.scheduled.find(c => t >= c.startAt && t < c.endAt);
      if (cur) {
        if (this._state !== 'playing') this.setState('playing');
        if (cur.index !== this.lastAudible) {
          this.lastAudible = cur.index;
          this.index = cur.index;
          this.curWords = tokenizeWords(this.sentences[cur.index]);
          this.hooks.onSentence?.(cur.index);
        }
        if (this.curWords.length) {
          const frac = Math.min(1, (t - cur.startAt) / Math.max(0.001, cur.endAt - cur.startAt));
          const weights = this.curWords.map(w => w.end - w.start + 1);
          const totalW = weights.reduce((a, b) => a + b, 0);
          const targetW = frac * totalW;
          let acc = 0, wi = 0;
          for (; wi < weights.length; wi++) { acc += weights[wi]; if (acc >= targetW) break; }
          const w = this.curWords[Math.min(wi, this.curWords.length - 1)];
          this.hooks.onWord?.(cur.index, w.start, w.end);
        }
      }
      this.scheduled = this.scheduled.filter(c => c.endAt > t - 0.5); // prune finished
      if (this.schedNext >= this.sentences.length && this.scheduled.every(c => c.endAt <= t)) {
        this.setState('idle'); this.hooks.onEnd?.(); return;
      }
      void this.pumpSchedule(gen); // top up as playback advances
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }
}
