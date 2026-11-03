import type { Book } from './types';

/**
 * How far a book is read, from 0 to 1: the last sentence reached counts as the
 * end, and a book the person marked finished is read to the end whatever its
 * position. One function for the card and the agent door, so both say the same.
 */
export function readingProgress(b: Pick<Book, 'finishedAt' | 'sentenceCount' | 'progressSentence'>): number {
  if (b.finishedAt) return 1;
  if (b.sentenceCount <= 1) return 0;
  return Math.max(0, Math.min(1, b.progressSentence / (b.sentenceCount - 1)));
}
