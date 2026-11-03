import type { Annotation } from './annotations';
import { matchesPassage } from './annotations';
import { highlightColor } from './highlightColors';
import type { Book, LoadedBook } from './types';
import { translate } from '../i18n/useI18n';

export interface BookSearchResult {
  id: string;
  kind: 'passage' | 'note' | 'general';
  title: string;
  snippet: string;
  sentence?: number;
  noteId?: string;
}
/**
 * The text folded to lower case, with where each folded unit came from.
 *
 * 🚨 Lowering can change the LENGTH of a string ("İ" becomes "i̇", two units),
 * so an index found in `text.toLocaleLowerCase()` is not an index in `text`:
 * every "İ" before a hit pushed it one place further, far enough to name the
 * next sentence. Folding one code point at a time keeps the way back, and the
 * needle is folded the same way so the two always agree.
 */
function fold(text: string): { folded: string; origin: number[] } {
  let folded = '';
  const origin: number[] = [];
  let at = 0;
  for (const ch of text) {
    // Alone, "Σ" lowers to "σ" even where a whole word would give the final
    // "ς": both are read as "σ", in the text and in the needle.
    const low = ch.toLocaleLowerCase().replace('ς', 'σ');
    folded += low;
    for (let k = 0; k < low.length; k++) origin.push(at);
    at += ch.length;
  }
  origin.push(at);
  return { folded, origin };
}
const foldNeedle = (query: string) => fold(query.trim()).folded;

/**
 * The open book folded once, not at every keystroke: folding a 1.2 MB text
 * took 190 to 590 ms, in the render, for each letter typed (logic review,
 * probe P5). One book is searched at a time, so one entry is enough.
 */
let bookFold: { text: string; folded: string; origin: number[] } | null = null;
export function foldBook(text: string): { folded: string; origin: number[] } {
  if (bookFold?.text !== text) bookFold = { text, ...fold(text) };
  return bookFold;
}

function snippet(text: string, needle: string): string {
  const { folded, origin } = fold(text);
  const hit = folded.indexOf(needle);
  const start = Math.max(0, (hit < 0 ? 0 : origin[hit]) - 65);
  return `${start ? '…' : ''}${text.slice(start, start + 240)}${text.length > start + 240 ? '…' : ''}`;
}
export function searchBook(
  book: Book,
  loaded: LoadedBook,
  notes: Annotation[],
  general: string,
  labels: Record<string, string>,
  query: string,
  scope: 'all' | 'book' | 'notes' = 'all'
): BookSearchResult[] {
  const needle = foldNeedle(query);
  if (!needle) return [];
  const results: BookSearchResult[] = [];
  const chapter = (sentence: number) =>
    [...book.chapters].reverse().find((c) => c.sentenceStart <= sentence)?.title ?? book.title;
  if (scope !== 'book') {
    for (const note of notes) {
      const theme = labels[highlightColor(note.color)] ?? '';
      const text = [note.quote, note.comment, theme].filter(Boolean).join('\n');
      if (fold(text).folded.includes(needle))
        results.push({
          id: `note:${note.id}`,
          kind: 'note',
          title: `${translate('search.resultNote', { chapter: chapter(note.startSentence) })}${theme ? ` · ${theme}` : ''}`,
          snippet: snippet(text, needle),
          noteId: note.id,
          ...(matchesPassage(loaded, note) ? { sentence: note.startSentence } : {}),
        });
    }
    if (fold(general).folded.includes(needle))
      results.push({
        id: 'general',
        kind: 'general',
        title: translate('notes.general'),
        snippet: snippet(general, needle),
      });
  }
  if (scope !== 'notes') {
    // Search the full source rather than individual sentences, so phrases can
    // cross sentence boundaries. Binary search maps hits back to reader positions.
    let from = 0;
    const { folded: source, origin } = foldBook(loaded.text);
    const seen = new Set<number>();
    while (from < source.length) {
      const foldedHit = source.indexOf(needle, from);
      if (foldedHit < 0) break;
      // Back to an index in the text itself, which sentenceOffsets counts in.
      const hit = origin[foldedHit];
      const hitEnd = origin[foldedHit + needle.length];
      let low = 0;
      let high = loaded.sentenceOffsets.length - 1;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (loaded.sentenceOffsets[mid] <= hit) low = mid;
        else high = mid - 1;
      }
      if (loaded.sentences.length && !seen.has(low)) {
        seen.add(low);
        results.push({
          id: `passage:${low}`,
          kind: 'passage',
          title: translate('search.resultPassage', { chapter: chapter(low) }),
          sentence: low,
          snippet: snippet(
            loaded.text.slice(Math.max(0, hit - 65), hitEnd + 175),
            needle
          ),
        });
      }
      from = foldedHit + Math.max(1, needle.length);
    }
  }
  return results;
}
