import { describe, expect, it } from 'vitest';
import { findNamed, nameWords, type Named } from './agentFind';

const book = (id: string, title: string, author?: string): Named<string> => ({ item: id, id, names: [title, ...(author ? [author] : [])], label: title });
const BOOKS = [book('b1', 'Dune', 'Frank Herbert'), book('b2', 'Les Misérables', 'Victor Hugo'), book('b3', 'Le Rouge et le Noir', 'Stendhal'), book('b4', 'Dune Messiah', 'Frank Herbert')];
const kind = { code: 'NO_BOOK', noun: 'book' };

describe('a book named the way a person says it', () => {
  it('folds case, accents, fillers and a plural', () => {
    expect(nameWords('le livre des MISÉRABLES')).toEqual(['miserable']);
    expect(nameWords('chapitre 3')).toEqual(['3']);
    expect(nameWords('Capítulo III')).toEqual(['iii']);
  });

  it('an id, the whole title, every word of it, or the author', () => {
    expect(findNamed(BOOKS, 'b3', kind)).toBe('b3');
    expect(findNamed(BOOKS, 'les misérables', kind)).toBe('b2');
    expect(findNamed(BOOKS, 'le rouge et le noir', kind)).toBe('b3');
    expect(findNamed(BOOKS, 'le livre de Victor Hugo', kind)).toBe('b2');
    // « Dune » is a whole title: it wins over « Dune Messiah ».
    expect(findNamed(BOOKS, 'Dune', kind)).toBe('b1');
  });

  it('several matches are refused with their names, never the first taken', () => {
    expect(() => findNamed(BOOKS, 'Herbert', kind)).toThrow('AMBIGUOUS: "Herbert" names several books: Dune, Dune Messiah; say which');
  });

  it('no match is refused with the names that exist', () => {
    expect(() => findNamed(BOOKS, 'Germinal', kind)).toThrow('NO_BOOK: no book named "Germinal"; books: Dune, Les Misérables, Le Rouge et le Noir, Dune Messiah');
    expect(() => findNamed(BOOKS, '', kind)).toThrow(/^BAD_ARG/);
    expect(() => findNamed([], 'Dune', kind)).toThrow('books: none');
  });
});
