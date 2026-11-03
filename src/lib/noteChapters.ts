import type { Annotation } from './annotations';
import type { Book } from './types';

export const OTHER_PASSAGES = '__unassigned';

export interface NoteChapter {
  id: string;
  title: string;
  notes: Annotation[];
}

export function chapterForNote(book: Book, note: Annotation) {
  return [...book.chapters]
    .reverse()
    .find((chapter) => chapter.sentenceStart <= note.startSentence);
}

function headingKey(text: string): string {
  return text
    .trim()
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function isMetadataHeading(book: Book, title: string): boolean {
  const metadata = [book.title, book.author ?? '', 'Title', 'Title page', 'Author'];
  return metadata.some((value) => value.trim() && headingKey(value) === headingKey(title));
}

export function noteChapterKey(book: Book, note: Annotation): string {
  const chapter = chapterForNote(book, note);
  return chapter && !isMetadataHeading(book, chapter.title) ? chapter.id : OTHER_PASSAGES;
}

/** Front-matter highlights stay accessible without making title/author chapter headings. */
export function groupNotesByChapter(book: Book, notes: Annotation[]): NoteChapter[] {
  const sorted = [...notes].sort(
    (a, b) =>
      a.startSentence - b.startSentence ||
      a.startOffset - b.startOffset ||
      a.createdAt - b.createdAt
  );
  const groups: NoteChapter[] = book.chapters.map((chapter) => ({
    id: chapter.id,
    title: chapter.title,
    notes: [],
  }));
  const byId = new Map(groups.map((group) => [group.id, group]));
  const other: NoteChapter = { id: OTHER_PASSAGES, title: 'Other saved passages', notes: [] };
  for (const note of sorted) {
    (byId.get(noteChapterKey(book, note)) ?? other).notes.push(note);
  }
  return [...groups, other].filter((group) => group.notes.length > 0);
}
