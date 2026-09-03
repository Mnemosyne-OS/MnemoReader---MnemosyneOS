/**
 * Speaking a book in its own language.
 *
 * The failure this guards against is not a crash: it is a French novel read in
 * English, or a voice id the engine has never heard of, which fails the
 * synthesis and drops the whole reading to the system voice. Both are silent.
 */
import { describe, it, expect } from 'vitest';
import { detectLang, pickVoiceForLang, languageOfVoice } from './lang';
import { BROWSER_ENGINE, type LocalEngineInfo } from './types';

const CHATTERBOX: LocalEngineInfo = {
  id: 'chatterbox', name: 'Chatterbox', voiceIsLanguage: true, hasSpeed: true, chunkChars: 280,
  voices: [{ id: 'fr', label: 'Français' }, { id: 'en', label: 'English' }],
};
const PIPER: LocalEngineInfo = {
  id: 'piper', name: 'Piper', voiceIsLanguage: false, hasSpeed: true, chunkChars: 600,
  voices: [
    { id: 'fr_FR-siwis-medium', label: 'Siwis' },
    { id: 'es_MX-claude-high', label: 'Claude' },
  ],
};
const SYSTEM_VOICES = [
  { id: 'urn:fr', name: 'Julie', lang: 'fr-FR' },
  { id: 'urn:en', name: 'Zira', lang: 'en-US' },
];

describe('detectLang', () => {
  it('reads French, Spanish and English prose', () => {
    expect(detectLang('Le vieux savant relisait la lettre qui était sur le bureau de la maison.')).toBe('fr');
    expect(detectLang('El viejo sabio releía la carta que estaba en el escritorio de la casa.')).toBe('es');
    expect(detectLang('The old scholar was reading the letter that was on the desk of the house.')).toBe('en');
  });

  it('takes Spanish punctuation as the strong signal it is', () => {
    expect(detectLang('¿Quién está ahí? ¡Nadie!')).toBe('es');
  });

  it('answers something for a text in none of the three', () => {
    // A German book must still be READ — with whatever voice we have — rather
    // than land on an empty voice id and fail the synthesis.
    expect(['fr', 'es', 'en']).toContain(detectLang('Der alte Gelehrte las den Brief noch einmal.'));
  });
});

describe('pickVoiceForLang', () => {
  it('gives a cloning engine the language code it speaks in', () => {
    expect(pickVoiceForLang('chatterbox', 'fr', { browser: [], piperVoices: [], info: CHATTERBOX })).toBe('fr');
  });

  it('returns null rather than a language the engine would reject by name', () => {
    // 🚨 Chatterbox rejects an unknown language_id outright. Null means "keep the
    // configured voice", which reads the book in the wrong accent — audibly odd,
    // but it READS. A rejected id is silence and a fall back to the system voice.
    expect(pickVoiceForLang('chatterbox', 'es', { browser: [], piperVoices: [], info: CHATTERBOX })).toBeNull();
  });

  it('only ever names a Piper voice that is actually INSTALLED', () => {
    // 🪤 The registry also lists voices nobody downloaded. Naming one of those
    // fails the synthesis — worse than reading in the wrong accent.
    expect(pickVoiceForLang('piper', 'fr', {
      browser: [], piperVoices: ['fr_FR-siwis-medium', 'en_US-amy-medium'], info: PIPER,
    })).toBe('fr_FR-siwis-medium');

    expect(pickVoiceForLang('piper', 'es', {
      browser: [], piperVoices: ['fr_FR-siwis-medium'], info: PIPER,   // es_MX listed, NOT installed
    })).toBeNull();
  });

  it('matches a system voice on its BCP-47 prefix', () => {
    expect(pickVoiceForLang(BROWSER_ENGINE, 'fr', { browser: SYSTEM_VOICES, piperVoices: [] })).toBe('urn:fr');
    expect(pickVoiceForLang(BROWSER_ENGINE, 'es', { browser: SYSTEM_VOICES, piperVoices: [] })).toBeNull();
  });

  it('survives an engine the host never described', () => {
    // An id from a newer host than this cartridge: unknown shape, so no guess.
    expect(pickVoiceForLang('an-engine-from-the-future', 'fr', {
      browser: SYSTEM_VOICES, piperVoices: [], info: null,
    })).toBeNull();
  });
});

describe('languageOfVoice — what will speak instead', () => {
  it('reads a system voice from its BCP-47 tag', () => {
    expect(languageOfVoice(BROWSER_ENGINE, 'urn:fr', SYSTEM_VOICES)).toBe('fr');
    expect(languageOfVoice(BROWSER_ENGINE, 'urn:en', SYSTEM_VOICES)).toBe('en');
  });

  it('reads a cloning engine from the voice itself, and Piper from its locale', () => {
    expect(languageOfVoice('chatterbox', 'es', [])).toBe('es');
    expect(languageOfVoice('piper', 'fr_FR-siwis-medium', [])).toBe('fr');
  });

  it('answers null when the id does not say — never a guess', () => {
    // 🚨 null is "cannot be named", not "none". Naming a language we inferred
    // from nothing would be worse than admitting we do not know: the message
    // exists to tell the truth about a fallback, not to sound complete.
    expect(languageOfVoice(BROWSER_ENGINE, '', SYSTEM_VOICES)).toBeNull();
    expect(languageOfVoice(BROWSER_ENGINE, 'urn:unknown', SYSTEM_VOICES)).toBeNull();
    expect(languageOfVoice('xtts', '', [])).toBeNull();
    expect(languageOfVoice('piper', 'de_DE-thorsten-medium', [])).toBeNull();  // real voice, language we do not name
  });
});
