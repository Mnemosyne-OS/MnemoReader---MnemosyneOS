/**
 * The text pipeline, pinned.
 *
 * Every function here failed silently once. `splitSentences` dropped ~80 % of an
 * EPUB by treating soft line-wraps as boundaries and discarding any wrapped line
 * that did not end in punctuation — the book still opened, still read aloud, and
 * simply skipped most of itself. `detectChapters` built a rail out of «NAPOLÉON.»
 * while missing "I —". None of it raises; it just quietly returns less book. So
 * the assertions below are about CONSERVATION first and cleverness second.
 */
import { describe, it, expect } from 'vitest';
import { splitSentences, detectChapters, chunkForIngest, hueFromTitle, guessMeta } from './pdf';

/** Every word of the source, in order, ignoring how whitespace was normalised. */
const words = (s: string) => s.split(/\s+/).filter(Boolean);

describe('splitSentences', () => {
  it('keeps a hard-wrapped paragraph whole', () => {
    // 🚨 THE regression. EPUB and PDF text is soft-wrapped, so a sentence arrives
    // as several lines and only the last one ends in punctuation. Treating '\n'
    // as a boundary threw the rest away.
    const text = 'Le 18 mai 1859, Mr Renault porta lui-même à\nla poste la lettre suivante,\n'
      + 'qu il avait relue trois fois.';
    const { sentences } = splitSentences(text);
    expect(words(sentences.join(' '))).toEqual(words(text));
    expect(sentences.join(' ')).toContain('porta lui-même à la poste');
  });

  it('records offsets that point at the real text', () => {
    // The offsets are what the karaoke, the chapters and the paragraph grouping
    // are all built on: an offset that drifts silently mis-highlights every word.
    const text = 'Première phrase. Deuxième phrase !\n\nTroisième phrase ?';
    const { sentences, offsets } = splitSentences(text);
    expect(offsets).toHaveLength(sentences.length);
    for (let i = 0; i < sentences.length; i++) {
      const firstWord = sentences[i].split(' ')[0];
      expect(text.slice(offsets[i], offsets[i] + firstWord.length)).toBe(firstWord);
    }
    // Strictly increasing — a book is read forwards.
    for (let i = 1; i < offsets.length; i++) expect(offsets[i]).toBeGreaterThan(offsets[i - 1]);
  });

  it('loses nothing on ordinary prose, whatever the punctuation', () => {
    const text = 'Il partit. Elle resta ! Pourquoi ? Personne ne sut… La nuit tomba.';
    expect(words(splitSentences(text).sentences.join(' '))).toEqual(words(text));
  });

  it('returns nothing for nothing, rather than one empty unit', () => {
    expect(splitSentences('').sentences).toEqual([]);
    expect(splitSentences('   \n\n  ').sentences).toEqual([]);
  });
});

describe('detectChapters', () => {
  const build = (text: string) => {
    const { offsets } = splitSentences(text);
    return detectChapters(text, offsets);
  };

  /** A chapter's worth of prose — headings are only accepted 400+ chars apart. */
  const body = (n: number) => `${`Le ${n}ᵉ jour, il marcha longtemps sans rien dire à personne. `.repeat(12)}\n\n`;

  it('finds roman numerals followed by a dash, and not an abbreviated name', () => {
    // 🪤 The heuristic used to catch «NAPOLÉON.» and «LEBLANC.» and miss "I —".
    // The dash is what separates a chapter head from "M. Renault".
    const text = `I — Le départ\n${body(1)}II — Le retour\n${body(2)}`
      + `M. Renault ferma la porte. LEBLANC parla ensuite.\n${body(3)}`;
    const titles = build(text).map(c => c.title);
    expect(titles.some(t => t.startsWith('I —'))).toBe(true);
    expect(titles.some(t => t.startsWith('II —'))).toBe(true);
    expect(titles.some(t => t.includes('LEBLANC'))).toBe(false);
    expect(titles.some(t => t.includes('Renault'))).toBe(false);
  });

  it('refuses to shatter a book on a numbered list', () => {
    // The 400-character spacing rule, pinned: "1. …" through "6. …" inside one
    // paragraph is a list, not six chapters, and a rail of six one-line
    // "chapters" is worse than no rail at all.
    const text = `I — Le seul chapitre\n${body(1)}`
      + '1. Premièrement\n2. Deuxièmement\n3. Troisièmement\n4. Quatrièmement\n5. Cinquièmement\n';
    expect(build(text).length).toBeLessThanOrEqual(2);
  });

  it('covers the whole text with contiguous chapters', () => {
    // A gap between two chapters is text the rail can never reach.
    const text = 'I — Un\nPremière partie du livre.\n\nII — Deux\nDeuxième partie du livre.';
    const chapters = build(text);
    expect(chapters.length).toBeGreaterThan(0);
    expect(chapters[0].start).toBe(0);
    for (let i = 1; i < chapters.length; i++) {
      expect(chapters[i].start).toBe(chapters[i - 1].end);
    }
    expect(chapters[chapters.length - 1].end).toBe(text.length);
  });

  it('still returns one chapter for a book with no headings at all', () => {
    const chapters = build('Une histoire sans le moindre titre. Elle continue ainsi.');
    expect(chapters.length).toBeGreaterThanOrEqual(1);
    expect(chapters[0].sentenceStart).toBe(0);
  });
});

describe('chunkForIngest', () => {
  it('never exceeds the byte budget, counting BYTES and not characters', () => {
    // 🪤 Accented prose is not ASCII: 45 000 characters of French is well over
    // 45 000 bytes, and the host rejects on bytes.
    const sentences = Array.from({ length: 400 }, (_, i) => `Phrase accentuée numéro ${i} — éèêàçù.`);
    for (const chunk of chunkForIngest(sentences, 2000)) {
      expect(new Blob([chunk]).size).toBeLessThanOrEqual(2000);
    }
  });

  it('archives every sentence, in order', () => {
    const sentences = Array.from({ length: 50 }, (_, i) => `Phrase ${i}.`);
    expect(chunkForIngest(sentences, 200).join(' ')).toBe(sentences.join(' '));
  });

  it('keeps a single over-budget sentence rather than cutting it', () => {
    // Dropping it would be a paragraph missing from the vault, with nothing said.
    const huge = `${'mot '.repeat(600)}fin.`;
    expect(chunkForIngest([huge], 500).join(' ')).toBe(huge);
  });
});

describe('cosmetics', () => {
  it('gives one title one hue, always', () => {
    expect(hueFromTitle("L'homme à l'oreille cassée")).toBe(hueFromTitle("L'homme à l'oreille cassée"));
    expect(hueFromTitle('Autre titre')).toBeGreaterThanOrEqual(0);
    expect(hueFromTitle('Autre titre')).toBeLessThan(360);
  });

  it('reads "Author - Title" without inventing an author when there is none', () => {
    expect(guessMeta('Edmond About - Le Roi des montagnes.epub'))
      .toEqual({ title: 'Le Roi des montagnes', author: 'Edmond About' });
    // 🚨 An absent author must stay ABSENT, never become the filename.
    expect(guessMeta('notes-de-lecture.pdf').author).toBeUndefined();
  });
});
