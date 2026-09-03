/**
 * Lightweight language detection (fr / es / en) + voice matching, so the reader
 * speaks a document in its own language instead of a fixed model.
 */
import type { BrowserVoiceInfo } from './voice';
import { BROWSER_ENGINE, type LocalEngineInfo, type VoiceEngineId } from './types';

export type Lang = 'fr' | 'es' | 'en';

const STOP: Record<Lang, string[]> = {
  es: ['que', 'de', 'la', 'el', 'los', 'las', 'una', 'por', 'con', 'para', 'está', 'más', 'como', 'pero', 'del', 'su', 'al', 'lo', 'es', 'en', 'un', 'no', 'ha', 'este'],
  fr: ['le', 'la', 'les', 'des', 'une', 'est', 'et', 'dans', 'pour', 'que', 'qui', 'pas', 'sur', 'avec', 'ce', 'au', 'du', 'en', 'un', 'ne', 'se', 'plus', 'être', 'cette'],
  en: ['the', 'and', 'of', 'to', 'in', 'is', 'that', 'for', 'with', 'as', 'are', 'be', 'this', 'it', 'on', 'by', 'an', 'or', 'from', 'at', 'was', 'not', 'have', 'which'],
};

/** Detect the dominant language of a text via stopword frequency + Spanish punctuation. */
export function detectLang(text: string): Lang {
  const sample = text.slice(0, 6000).toLowerCase();
  const words = sample.replace(/[^a-záéíóúñüàâçèéêëîïôùû\s]/gi, ' ').split(/\s+/);
  const score: Record<Lang, number> = { es: 0, fr: 0, en: 0 };
  const sets: Record<Lang, Set<string>> = { es: new Set(STOP.es), fr: new Set(STOP.fr), en: new Set(STOP.en) };
  for (const w of words) {
    if (sets.es.has(w)) score.es++;
    if (sets.fr.has(w)) score.fr++;
    if (sets.en.has(w)) score.en++;
  }
  if (/[¿¡ñ]/.test(sample)) score.es += 12; // strong Spanish signal
  return (['es', 'fr', 'en'] as Lang[]).reduce((best, l) => (score[l] > score[best] ? l : best), 'en');
}

/**
 * Best voice for a language on the active engine, among what is actually there.
 *
 * The engine's OWN descriptor decides how a voice id is shaped — the cartridge
 * no longer keeps a list of engine names:
 *  - `voiceIsLanguage` (XTTS, Chatterbox, …) — the id IS the language code, so
 *    we hand back `lang` when that engine declares it, and null when it does not
 *    (a language the model would reject by name).
 *  - otherwise (Piper) — an installed voice file whose locale prefix matches.
 *  - browser — a system voice whose BCP-47 lang starts with the code.
 *
 * Returns null when nothing matches; the caller keeps the current/seeded voice.
 */
export function pickVoiceForLang(
  engine: VoiceEngineId,
  lang: Lang,
  opts: { browser: BrowserVoiceInfo[]; piperVoices: string[]; info?: LocalEngineInfo | null },
): string | null {
  if (engine === BROWSER_ENGINE) {
    const match = opts.browser.find(v => v.lang.toLowerCase().startsWith(lang));
    return match?.id ?? null;
  }
  if (opts.info?.voiceIsLanguage) {
    return opts.info.voices.some(v => v.id === lang) ? lang : null;
  }
  // Voice FILES (Piper): only an INSTALLED one. The registry also lists voices
  // that were never downloaded, and naming one of those fails the synthesis and
  // drops the reader to the system voice — worse than reading in the wrong accent.
  const pref = lang === 'es' ? 'es_' : lang === 'en' ? 'en_' : 'fr_';
  return opts.piperVoices.find(v => v.toLowerCase().startsWith(pref)) ?? null;
}

/**
 * The language a voice will actually SPEAK, read from its id — or null when the
 * id does not say.
 *
 * 🚨 null means "cannot be named", never "none". It is what decides whether the
 * reader can tell the user *which* accent it is falling back to, or only that it
 * is falling back — and naming a language we merely guessed would be worse than
 * saying nothing.
 *   • system voice — its BCP-47 tag ("fr-FR" → fr)
 *   • cloning engine — the voice IS the language ("fr")
 *   • Piper — the id opens with its locale ("fr_FR-siwis-medium")
 */
export function languageOfVoice(
  engine: VoiceEngineId,
  voiceId: string,
  browser: BrowserVoiceInfo[],
): Lang | null {
  const code = engine === BROWSER_ENGINE
    ? browser.find(v => v.id === voiceId)?.lang.slice(0, 2).toLowerCase()
    : voiceId.slice(0, 2).toLowerCase();
  return (['fr', 'es', 'en'] as const).find(c => c === code) ?? null;
}
