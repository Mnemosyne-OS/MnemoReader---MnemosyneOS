import type { LoadedBook } from './types';
import { normalizeHex } from './highlightColors';

export interface Annotation {
  id: string;
  startSentence: number;
  startOffset: number;
  endSentence: number;
  endOffset: number;
  quote: string;
  comment: string;
  /** Missing on older highlights; those keep their original yellow. */
  color?: string;
  createdAt: number;
}

export const notesKey = (bookId: string) => `mnemoreader.notes.${bookId}`;
export const NOTES_CHANGED = 'mnemoreader:notes-changed';
function changed(bookId: string): void {
  window.dispatchEvent(new CustomEvent(NOTES_CHANGED, { detail: { bookId } }));
}

export function passage(
  loaded: LoadedBook,
  a: Pick<Annotation, 'startSentence' | 'startOffset' | 'endSentence' | 'endOffset'>
): string {
  const { sentences } = loaded;
  if (
    ![a.startSentence, a.endSentence, a.startOffset, a.endOffset].every(Number.isInteger) ||
    a.startSentence < 0 ||
    a.endSentence < a.startSentence ||
    a.endSentence >= sentences.length ||
    a.startOffset < 0 ||
    a.endOffset < 0 ||
    a.startOffset > sentences[a.startSentence].length ||
    a.endOffset > sentences[a.endSentence].length ||
    (a.startSentence === a.endSentence && a.endOffset <= a.startOffset)
  )
    return '';
  return sentences
    .slice(a.startSentence, a.endSentence + 1)
    .map((s, i) =>
      s.slice(
        i === 0 ? a.startOffset : 0,
        a.startSentence + i === a.endSentence ? a.endOffset : s.length
      )
    )
    .join(' ')
    .trim();
}

export function matchesPassage(loaded: LoadedBook, a: Annotation): boolean {
  return a.quote.length > 0 && passage(loaded, a) === a.quote;
}

export function readBookNotes(bookId: string): {
  notes: Annotation[];
  general: string;
  colorLabels: Record<string, string>;
  hiddenColors: string[];
} {
  const raw = localStorage.getItem(notesKey(bookId));
  if (!raw) return { notes: [], general: '', colorLabels: {}, hiddenColors: [] };
  const data: unknown = JSON.parse(raw);
  // Older releases stored just the highlights array. Preserve it on upgrade.
  const record = data as {
    notes?: unknown;
    general?: unknown;
    colorLabels?: unknown;
    hiddenColors?: unknown;
  } | null;
  const notes: unknown = Array.isArray(data) ? data : record?.notes;
  const general: unknown = Array.isArray(data) ? '' : record?.general;
  const labels: unknown = Array.isArray(data) ? {} : (record?.colorLabels ?? {});
  const hidden: unknown = Array.isArray(data) ? [] : (record?.hiddenColors ?? []);
  if (
    !Array.isArray(hidden) ||
    !hidden.every((hex: unknown) => typeof hex === 'string' && normalizeHex(hex) === hex)
  )
    throw new Error('Saved color list could not be read.');
  if (
    typeof labels !== 'object' ||
    labels === null ||
    Array.isArray(labels) ||
    !Object.entries(labels).every(
      ([hex, label]) => normalizeHex(hex) === hex && typeof label === 'string'
    )
  ) {
    throw new Error('Saved color labels could not be read.');
  }
  if (
    typeof general !== 'string' ||
    !Array.isArray(notes) ||
    !notes.every((a: unknown) => {
      if (typeof a !== 'object' || a === null) return false;
      const v = a as Record<string, unknown>;
      return (
        typeof v.id === 'string' &&
        typeof v.quote === 'string' &&
        typeof v.comment === 'string' &&
        (v.color === undefined || typeof v.color === 'string') &&
        typeof v.createdAt === 'number' &&
        Number.isFinite(v.createdAt) &&
        ['startSentence', 'endSentence', 'startOffset', 'endOffset'].every((k) =>
          Number.isInteger(v[k])
        )
      );
    })
  )
    throw new Error('Saved notes could not be read.');
  return {
    notes: notes as Annotation[],
    general,
    colorLabels: labels as Record<string, string>,
    hiddenColors: hidden as string[],
  };
}

export function readAnnotations(bookId: string): Annotation[] {
  return readBookNotes(bookId).notes;
}

export function writeAnnotations(bookId: string, notes: Annotation[]): void {
  // Persist before reporting success; a full/blocked store must never look saved.
  const existing = readBookNotes(bookId);
  localStorage.setItem(notesKey(bookId), JSON.stringify({ ...existing, notes }));
  changed(bookId);
}

export function writeGeneralNote(bookId: string, general: string): void {
  const existing = readBookNotes(bookId);
  localStorage.setItem(notesKey(bookId), JSON.stringify({ ...existing, general }));
  changed(bookId);
}

export function writeColorLabels(bookId: string, colorLabels: Record<string, string>): void {
  writeColorKey(bookId, colorLabels, readBookNotes(bookId).hiddenColors);
}

export function writeColorKey(
  bookId: string,
  colorLabels: Record<string, string>,
  hiddenColors: string[]
): void {
  if (
    !Object.entries(colorLabels).every(
      ([hex, label]) => normalizeHex(hex) === hex && typeof label === 'string'
    )
  ) {
    throw new Error('Invalid color key.');
  }
  const existing = readBookNotes(bookId);
  if (!hiddenColors.every((hex) => normalizeHex(hex) === hex))
    throw new Error('Invalid hidden color.');
  localStorage.setItem(
    notesKey(bookId),
    JSON.stringify({ ...existing, colorLabels, hiddenColors })
  );
  changed(bookId);
}
