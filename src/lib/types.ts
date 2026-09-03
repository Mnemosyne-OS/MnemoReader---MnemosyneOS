/** Shared domain types for MnemoReader. */

/** A detected chapter within a book. `start`/`end` are character offsets into the full text. */
export interface Chapter {
  id: string;
  title: string;
  /** Character offset of the chapter's first content character. */
  start: number;
  /** Character offset just past the chapter's last character. */
  end: number;
  /** Index of the first sentence belonging to this chapter. */
  sentenceStart: number;
}

/** Ingest / vectorization lifecycle of a book. */
export type IngestState = 'idle' | 'extracting' | 'chaptering' | 'vectorizing' | 'archived' | 'error';

/** A book in the library. Heavy `text`/`sentences` live only in the open reader, not in persisted metadata. */
export interface Book {
  id: string;
  title: string;
  author?: string;
  /** Absolute path on disk (host side). Kept so we can re-extract on open. */
  filePath: string;
  ext: string;
  /** Accent hue (0-360) derived from the title — drives the generated cover. */
  hue: number;
  addedAt: number;
  /** Total sentence count (for progress math). */
  sentenceCount: number;
  chapters: Chapter[];
  /** 0-based index of the last sentence the user reached. */
  progressSentence: number;
  ingest: IngestState;
  ingestError?: string;
  /** True once vectorized into the Library vault. */
  archived: boolean;
  truncated?: boolean;
}

/** The full loaded content of an open book (not persisted). */
export interface LoadedBook {
  bookId: string;
  text: string;
  sentences: string[];
  /** Char offset of the first character of each sentence, parallel to `sentences`. */
  sentenceOffsets: number[];
}

/**
 * A voice engine: `BROWSER_ENGINE` (Web Speech) or a host local engine id.
 *
 * 🚨 Deliberately NOT a union of engine names. It used to be
 * `'browser' | 'piper' | 'xtts'`, which meant every engine the host added after
 * MnemoReader shipped — Chatterbox, and whatever comes next — could not even be
 * NAMED here, let alone played. The host owns the list; the cartridge carries
 * ids it does not interpret and asks `LocalEngineInfo` what they mean.
 */
export type VoiceEngineId = string;

/** The system voice (Web Speech). Anything else is a host neural engine. */
export const BROWSER_ENGINE = 'browser';

/** True when playback goes through the host's neural TTS rather than Web Speech. */
export function isNeuralEngine(engine: VoiceEngineId): boolean {
  return engine !== BROWSER_ENGINE;
}

/**
 * What the host tells us about one installed local engine (from its own
 * registry — never a second copy of it over here).
 */
export interface LocalEngineInfo {
  id: string;
  /** Product name, shown as-is: a proper noun is never translated. */
  name: string;
  /** The engine's own voice list — language codes or downloaded voice ids. */
  voices: { id: string; label: string }[];
  /** True when a voice id IS a language code ('fr'), as XTTS/Chatterbox do. */
  voiceIsLanguage: boolean;
  /** The Speed control actually reaches this engine. */
  hasSpeed: boolean;
  /** …and the range where it does something. Null = draw no control at all:
   *  XTTS takes no pacing argument, and Chatterbox only ever SLOWS. */
  speedRange: { min: number; max: number } | null;
  /** Longest text this engine may be handed in one request (see splitForEngine). */
  chunkChars: number;
}

export interface ReaderSettings {
  engine: VoiceEngineId;
  /** Host voice id ("fr_FR-siwis-medium", "fr", …) or a browser voice URI. */
  voice: string;
  /** Playback rate multiplier (0.5 – 2). */
  rate: number;
  /** Reading font size in px. */
  fontSize: number;
  /** Sleep-timer minutes; 0 = off. */
  sleepMinutes: number;
  theme: 'night' | 'sepia' | 'paper';
}

export const DEFAULT_SETTINGS: ReaderSettings = {
  engine: BROWSER_ENGINE,
  voice: '',
  rate: 1,
  fontSize: 20,
  sleepMinutes: 0,
  theme: 'night',
};

/** Name of the vault MnemoReader archives books into. */
export const LIBRARY_VAULT = 'LIBRARY';
