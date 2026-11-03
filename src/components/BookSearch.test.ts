// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, expect, it, vi } from 'vitest';
import { BookSearch } from './BookSearch';
import { setLang } from '../i18n/useI18n';

// The labels these tests find are the English ones.
beforeEach(() => setLang('en'));
import type { Book } from '../lib/types';

it('opens search, filters results, and sends the selected destination before closing', () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const onSelect = vi.fn();
  const book: Book = {
    id: 'one',
    title: 'Book One',
    filePath: '',
    ext: 'txt',
    hue: 0,
    addedAt: 0,
    sentenceCount: 1,
    chapters: [],
    progressSentence: 0,
    ingest: 'idle',
    archived: false,
  };
  try {
    act(() =>
      root.render(
        createElement(BookSearch, {
          book,
          loaded: {
            bookId: book.id,
            text: 'Friendship matters.',
            sentences: ['Friendship matters.'],
            sentenceOffsets: [0],
          },
          notes: [],
          general: 'Friendship in this book',
          labels: {},
          onSelect,
        })
      )
    );
    act(() => host.querySelector('button')!.click());
    const input = host.querySelector('input')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        input,
        'friendship'
      );
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(host.querySelectorAll('.book-search-result')).toHaveLength(2);
    const scope = host.querySelector('select')!;
    act(() => {
      scope.value = 'notes';
      scope.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(host.querySelectorAll('.book-search-result')).toHaveLength(1);
    act(() => host.querySelector<HTMLButtonElement>('.book-search-result')!.click());
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ kind: 'general' }));
    expect(host.querySelector('section')).toBeNull();
  } finally {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
