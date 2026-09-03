/**
 * @vitest-environment jsdom
 *
 * Two things are pinned here, and the second is the one that would ruin a
 * reading.
 *
 * 1. **Parity** — every locale carries every key the app asks for. A missing key
 *    is not a crash: it falls back to English inside an otherwise Russian
 *    screen, which nobody reports as a bug because it looks like a choice.
 *
 * 2. 🚨 **The interface language is not the book's language.** Someone runs
 *    Mnemosyne in Spanish and reads an English novel: the menus must be Spanish
 *    and the voice must be English, and NEITHER may be derived from the other.
 *    These live in two different modules for that reason — `i18n/useI18n` reads
 *    the shell, `lib/lang` reads the text — and this test exists so that a later
 *    "simplification" that joins them fails here instead of in someone's ears.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { LANGS, adoptHostLang, getLang, setLang, translate, dateLocale, type LangCode } from './useI18n';
import { detectLang, pickVoiceForLang } from '../lib/lang';
import { BROWSER_ENGINE, type LocalEngineInfo } from '../lib/types';

import en from './locales/en.json';
import fr from './locales/fr.json';
import es from './locales/es.json';
import de from './locales/de.json';
import pt from './locales/pt.json';
import ru from './locales/ru.json';
import zh from './locales/zh.json';

const BUNDLES: Record<LangCode, Record<string, unknown>> = { en, fr, es, de, pt, ru, zh };

/** Every leaf key as a dotted path. */
function keysOf(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k;
    return v && typeof v === 'object' && !Array.isArray(v)
      ? keysOf(v as Record<string, unknown>, path)
      : [path];
  });
}
/** The {{placeholders}} a string promises to fill. */
const placeholders = (s: string) => (s.match(/\{\{(\w+)\}\}/g) ?? []).sort();
function valueAt(bundle: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>(
    (cur, part) => (cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[part] : undefined),
    bundle,
  );
}

describe('locale parity', () => {
  const reference = keysOf(en).sort();

  it('ships the seven languages Mnemosyne OS ships', () => {
    expect([...LANGS].sort()).toEqual(Object.keys(BUNDLES).sort());
  });

  for (const lang of LANGS) {
    it(`${lang} has every key, and no key English does not`, () => {
      expect(keysOf(BUNDLES[lang]).sort()).toEqual(reference);
    });

    it(`${lang} keeps every placeholder — a dropped {{name}} is a blank in a sentence`, () => {
      for (const key of reference) {
        const source = valueAt(en, key);
        const target = valueAt(BUNDLES[lang], key);
        if (typeof source !== 'string' || typeof target !== 'string') continue;
        expect(placeholders(target), `${lang} · ${key}`).toEqual(placeholders(source));
      }
    });

    it(`${lang} translates — it is not a copy of English`, () => {
      if (lang === 'en') return;
      // Symbols and product names are legitimately identical; prose is not.
      const prose = reference.filter(k => {
        const v = valueAt(en, k);
        return typeof v === 'string' && v.length > 25;
      });
      const same = prose.filter(k => valueAt(BUNDLES[lang], k) === valueAt(en, k));
      expect(same, `${lang} left untranslated`).toEqual([]);
    });
  }
});

describe('adopting the shell language', () => {
  beforeEach(() => setLang('en'));

  it('takes a language the reader ships', () => {
    adoptHostLang('es');
    expect(getLang()).toBe('es');
    expect(translate('dock.play')).toBe('Reproducir');
  });

  it('IGNORES a locale it cannot speak, rather than falling back to English', () => {
    // 🚨 A Japanese shell must leave a French reader in French. Switching them
    // to English would be a regression they never asked for.
    adoptHostLang('fr');
    adoptHostLang('ja');
    expect(getLang()).toBe('fr');
    adoptHostLang(null);
    adoptHostLang(42);
    expect(getLang()).toBe('fr');
  });

  it('gives each language its own date locale', () => {
    expect(dateLocale('zh')).toBe('zh-CN');
    expect(dateLocale('pt')).toBe('pt-PT');
  });
});

describe('translate', () => {
  beforeEach(() => setLang('en'));

  it('fills placeholders', () => {
    expect(translate('reader.chapterOf', { n: 3, total: 12 })).toBe('Chapter 3 of 12');
  });

  it('falls back to English, then to the key — visibly wrong, never blank', () => {
    setLang('ru');
    expect(translate('an.absent.key')).toBe('an.absent.key');
  });

  it('leaves an unfilled placeholder visible instead of printing "undefined"', () => {
    expect(translate('reader.chapterOf', { n: 3 })).toContain('{{total}}');
  });
});

describe('🚨 the UI language and the book language are independent', () => {
  const CHATTERBOX: LocalEngineInfo = {
    id: 'chatterbox', name: 'Chatterbox', voiceIsLanguage: true, hasSpeed: true, chunkChars: 280,
    voices: [{ id: 'fr', label: 'Français' }, { id: 'en', label: 'English' }, { id: 'es', label: 'Español' }],
  };
  const SYSTEM = [
    { id: 'urn:fr', name: 'Julie', lang: 'fr-FR' },
    { id: 'urn:en', name: 'Zira', lang: 'en-US' },
    { id: 'urn:es', name: 'Helena', lang: 'es-ES' },
  ];
  const ENGLISH_BOOK = 'The old scholar was reading the letter that was on the desk of the house.';
  const FRENCH_BOOK = 'Le vieux savant relisait la lettre qui était sur le bureau de la maison.';

  it('reads an English book in English while the app is in Spanish', () => {
    // The scenario, exactly: app in Spanish, novel in English.
    adoptHostLang('es');
    expect(translate('dock.readingAloud')).toBe('Leyendo en voz alta');   // interface: Spanish
    const bookLang = detectLang(ENGLISH_BOOK);
    expect(bookLang).toBe('en');                                          // book: English
    expect(pickVoiceForLang('chatterbox', bookLang, { browser: SYSTEM, piperVoices: [], info: CHATTERBOX })).toBe('en');
    expect(pickVoiceForLang(BROWSER_ENGINE, bookLang, { browser: SYSTEM, piperVoices: [] })).toBe('urn:en');
  });

  it('gives the same book the same voice in all seven interface languages', () => {
    // Detection reads the TEXT. If the UI could reach it, this loop would drift.
    for (const lang of LANGS) {
      adoptHostLang(lang);
      expect(detectLang(FRENCH_BOOK), `book language under UI=${lang}`).toBe('fr');
      expect(
        pickVoiceForLang('chatterbox', detectLang(FRENCH_BOOK), { browser: SYSTEM, piperVoices: [], info: CHATTERBOX }),
        `voice under UI=${lang}`,
      ).toBe('fr');
    }
  });

  it('leaves the interface alone when the book changes language', () => {
    adoptHostLang('de');
    detectLang(ENGLISH_BOOK);
    detectLang(FRENCH_BOOK);
    expect(getLang()).toBe('de');
    expect(translate('dock.pause')).toBe('Pause');
  });
});
