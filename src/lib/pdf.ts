/**
 * Text processing for extracted documents: sentence segmentation, chapter
 * detection, ingest chunking, and small cosmetic derivations (cover hue, title).
 *
 * Everything here is deterministic and dependency-free — the heavy PDF parsing
 * happens host-side (pdf-parse) and hands us plain text.
 */
import type { Chapter } from './types';

/** Grow each speech unit to about this many chars (fuller blocks = smoother, esp. at high speed). */
const TARGET_UNIT_CHARS = 120;
/** Never let a merged unit grow past this. */
const MAX_UNIT_CHARS = 480;

/**
 * Group consecutive sentences into fuller speech units (~TARGET_UNIT_CHARS), so the
 * voice engine gets fewer, bigger blocks — smoother playback (it's outrun by
 * synthesis less, especially at 1.25×–2×) and fewer failed micro-chunks. Word-level
 * karaoke still tracks within each unit.
 */
function mergeShortUnits(sentences: string[], offsets: number[]): { sentences: string[]; offsets: number[] } {
  const outS: string[] = [];
  const outO: number[] = [];
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i];
    const last = outS.length - 1;
    const prevLen = last >= 0 ? outS[last].length : 0;
    if (last >= 0 && prevLen < TARGET_UNIT_CHARS && prevLen + s.length + 1 <= MAX_UNIT_CHARS) {
      outS[last] = `${outS[last]} ${s}`; // keep filling the current unit (offset unchanged)
    } else {
      outS.push(s);
      outO.push(offsets[i]);
    }
  }
  return { sentences: outS, offsets: outO };
}

/** Split text into sentences, tracking the char offset where each one starts. */
export function splitSentences(text: string): { sentences: string[]; offsets: number[] } {
  const sentences: string[] = [];
  const offsets: number[] = [];
  // Soft line-wraps (a single newline inside a paragraph, common in EPUB/PDF text)
  // must become spaces, not breaks — otherwise the splitter below drops any wrapped
  // line that doesn't end in punctuation, losing most of the text. This is
  // length-preserving (1 char → 1 char) so recorded offsets stay valid; real
  // paragraph breaks (blank lines, \n\n+) are left intact.
  text = text.replace(/([^\n])\n(?!\n)/g, '$1 ');
  // Break on sentence-final punctuation OR a hard paragraph break. Keeps chunks
  // TTS-friendly (~one breath) while never losing a character's offset.
  const re = /[^.!?…\n]*(?:[.!?…]+|\n{2,}|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = m[0];
    if (m.index === re.lastIndex) { re.lastIndex++; continue; } // zero-width guard
    const trimmed = raw.trim();
    if (trimmed.length > 0) {
      // Record the offset of the first non-space character.
      const lead = raw.length - raw.trimStart().length;
      sentences.push(trimmed.replace(/\s+/g, ' '));
      offsets.push(m.index + lead);
    }
    if (raw.length === 0) break;
  }
  return mergeShortUnits(sentences, offsets);
}

// Keyword headings that must carry a number ("Chapitre 3", "Part IV") — otherwise
// common words like "part" match mid-sentence ("part un grand colonel…").
const HEADING_KW_NUM = new RegExp('^\\s*(chapter|chapitre|cap[ií]tulo|partie?|section|livre|book)\\b[\\s.:—–-]*[0-9IVXLC]+\\b', 'i');
// Keyword headings that stand alone (no number needed).
const HEADING_KW_SOLO = new RegExp('^\\s*(prologue|[ée]pilogue|epilogue|introduction|conclusion|avant-propos|pr[ée]face|annexe|appendix)\\b', 'i');

/** A keyword/numbered/roman-numeral standalone line reads as a chapter heading. */
function looksLikeHeading(line: string): boolean {
  const t = line.trim();
  if (t.length < 2 || t.length > 70) return false;
  if (HEADING_KW_NUM.test(t) || HEADING_KW_SOLO.test(t)) return true;
  // Roman numeral + a DASH separator: "I — Title", "XVIII — …". Dash (not period) so
  // "M. Nibor" (Monsieur, M = roman 1000) isn't mistaken for a chapter.
  if (/^[IVXLCM]{1,7}\s*[—–]\s+\S/.test(t)) return true;
  // Arabic numbered heading: "1. Title" / "12) Bar".
  if (/^[0-9]{1,3}[.)]\s+\S/.test(t)) return true;
  // NOTE: a "mostly uppercase line" rule used to live here but it misfired on
  // dialogue/signatures («NAPOLÉON.», «LEBLANC.») — dropped as too noisy.
  return false;
}

const slug = (s: string, i: number) => `ch_${i}_${s.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24)}`;

/**
 * Detect chapters from raw text. Falls back to evenly-sized sections when a
 * document has no discernible heading structure, so the chapter rail is never
 * empty on a long book.
 */
export function detectChapters(text: string, sentenceOffsets: number[]): Chapter[] {
  const found: { title: string; start: number }[] = [];
  const lineRe = /^.*$/gm;
  let lm: RegExpExecArray | null;
  let lastAccepted = -Infinity;
  while ((lm = lineRe.exec(text)) !== null) {
    const line = lm[0];
    if (lm.index === lineRe.lastIndex) lineRe.lastIndex++;
    if (!looksLikeHeading(line)) continue;
    // Space headings out a little so a numbered list doesn't shatter the book.
    if (lm.index - lastAccepted < 400) continue;
    found.push({ title: line.trim().replace(/\s+/g, ' '), start: lm.index });
    lastAccepted = lm.index;
  }

  // A chapter listed in an in-text table of contents repeats at the real chapter
  // start; keep the LATER occurrence (the actual body, not the TOC line).
  const byKey = new Map<string, { title: string; start: number }>();
  for (const f of found) byKey.set(f.title.toLowerCase(), f);
  const uniq = [...byKey.values()].sort((a, b) => a.start - b.start);

  const total = text.length;
  let marks: { title: string; start: number }[];
  if (uniq.length >= 2) {
    marks = uniq;
    if (marks[0].start > 600) marks.unshift({ title: 'Opening', start: 0 });
  } else {
    // No structure — carve ~2500-word sections.
    const words = text.split(/\s+/).length;
    const parts = Math.min(24, Math.max(1, Math.round(words / 2500)));
    if (parts <= 1) {
      marks = [{ title: 'Full text', start: 0 }];
    } else {
      marks = Array.from({ length: parts }, (_, i) => ({
        title: `Section ${i + 1}`,
        start: Math.floor((total * i) / parts),
      }));
    }
  }

  const nearestSentence = (offset: number): number => {
    // Binary search the first sentence at/after this char offset.
    let lo = 0, hi = sentenceOffsets.length - 1, ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (sentenceOffsets[mid] <= offset) { ans = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    return ans;
  };

  return marks.map((mk, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].start : total;
    return {
      id: slug(mk.title, i),
      title: mk.title,
      start: mk.start,
      end,
      sentenceStart: nearestSentence(mk.start),
    } satisfies Chapter;
  });
}

/**
 * Build chapters from explicit offset markers — a well-formatted EPUB's own table
 * of contents, which is far more reliable than heading-guessing. Each mark's char
 * offset is snapped to the nearest sentence.
 */
export function chaptersFromMarks(
  marks: { title: string; offset: number }[], totalChars: number, sentenceOffsets: number[],
): Chapter[] {
  const nearestSentence = (offset: number): number => {
    let lo = 0, hi = sentenceOffsets.length - 1, ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if ((sentenceOffsets[mid] ?? 0) <= offset) { ans = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    return ans;
  };
  const sorted = marks.filter(m => m.title.trim()).sort((a, b) => a.offset - b.offset);
  return sorted.map((mk, i) => ({
    id: slug(mk.title, i),
    title: mk.title,
    start: mk.offset,
    end: i + 1 < sorted.length ? (sorted[i + 1]?.offset ?? totalChars) : totalChars,
    sentenceStart: nearestSentence(mk.offset),
  } satisfies Chapter));
}

/** Chunk full text into <= maxBytes UTF-8 pieces on sentence boundaries, for vault ingest. */
export function chunkForIngest(sentences: string[], maxBytes = 45_000): string[] {
  const chunks: string[] = [];
  let buf = '';
  const size = (s: string) => new Blob([s]).size;
  for (const s of sentences) {
    if (buf && size(buf) + size(s) + 1 > maxBytes) { chunks.push(buf); buf = ''; }
    buf = buf ? `${buf} ${s}` : s;
  }
  if (buf) chunks.push(buf);
  return chunks;
}

/** Derive a stable accent hue (0-359) from a title, so covers are colourful but consistent. */
export function hueFromTitle(title: string): number {
  let h = 0;
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) >>> 0;
  return h % 360;
}

/** Best-effort title + author from a filename ("Author - Title.pdf" or "Title.pdf"). */
export function guessMeta(fileName: string): { title: string; author?: string } {
  const base = fileName.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim();
  const dash = base.split(/\s+[-–—]\s+/);
  if (dash.length === 2 && dash[0].length < 40) {
    return { author: dash[0].trim(), title: dash[1].trim() };
  }
  return { title: base };
}
