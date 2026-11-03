// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BookNotes } from './BookNotes';
import {
  readAnnotations,
  readBookNotes,
  writeAnnotations,
  writeGeneralNote,
} from '../lib/annotations';
import type { Book } from '../lib/types';
import { setLang } from '../i18n/useI18n';

let root: Root;
let host: HTMLDivElement;
const book: Book = {
  id: 'test-book',
  title: 'Test book',
  filePath: '',
  ext: 'txt',
  hue: 0,
  addedAt: 0,
  sentenceCount: 2,
  chapters: [{ id: 'c', title: 'Chapter 1', start: 0, end: 24, sentenceStart: 0 }],
  progressSentence: 0,
  ingest: 'idle',
  archived: false,
};
const loaded = {
  bookId: book.id,
  text: 'Hello world. Next words.',
  sentences: ['Hello world.', 'Next words.'],
  sentenceOffsets: [0, 13],
};
const jump = vi.fn();
function mount(readerBook: Book = book) {
  act(() =>
    root.render(
      createElement(BookNotes, {
        book: readerBook,
        loaded,
        onJump: jump,
        children: (render) =>
          createElement(
            'p',
            null,
            ...loaded.sentences.map((text, i) =>
              createElement(
                'span',
                { key: i, 'data-sentence': i },
                render(text, i, i === 0 ? { start: 6, end: 11 } : null),
                ' '
              )
            )
          ),
      })
    )
  );
}
function click(label: string) {
  const button = [...host.querySelectorAll('button')].find((b) => b.textContent === label);
  expect(button, label).toBeTruthy();
  act(() => button!.click());
}
function typeGeneral(value: string) {
  const input = host.querySelector<HTMLTextAreaElement>('textarea')!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
      input,
      value
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
// The labels these tests find are the English ones.
beforeEach(() => {
  setLang('en');
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  jump.mockClear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('shows only populated chapters and preserves front-matter highlights outside the chapter list', () => {
  writeAnnotations(book.id, [
    {
      id: 'front',
      startSentence: 0,
      startOffset: 0,
      endSentence: 0,
      endOffset: 5,
      quote: 'Hello',
      comment: 'Keep this',
      createdAt: 1,
    },
  ]);
  mount({
    ...book,
    author: 'Writer',
    chapters: [
      { ...book.chapters[0], title: 'Test book' },
      { ...book.chapters[0], id: 'author', title: 'Writer', sentenceStart: 1 },
      { ...book.chapters[0], id: 'empty', title: 'Chapter 1', sentenceStart: 2 },
    ],
  });
  click('Book notes (1)');
  expect([...host.querySelectorAll('.notes-chapter summary')].map((el) => el.textContent)).toEqual([
    'Other saved passages (1)',
  ]);
  expect(host.textContent).toContain('Keep this');
  click('Remove highlight');
  expect(host.querySelectorAll('.notes-chapter')).toHaveLength(0);
});

it('autosaves general notes without any highlights and restores them on reopening', () => {
  mount();
  click('Book notes (0)');
  typeGeneral('My thoughts\nWithout a highlight.');
  expect(readBookNotes(book.id).general).toBe('My thoughts\nWithout a highlight.');
  expect(readAnnotations(book.id)).toEqual([]);
  act(() => root.unmount());
  root = createRoot(host);
  mount();
  click('Book notes (0)');
  expect(host.querySelector('textarea')!.value).toBe('My thoughts\nWithout a highlight.');
});

it('reports corrupt saved notes and never writes over them', () => {
  localStorage.setItem('mnemoreader.notes.test-book', '{broken');
  mount();
  click('Book notes (0)');
  expect(host.textContent).toContain('Saved notes could not be read');
  typeGeneral('Typed over a broken store');
  expect(localStorage.getItem('mnemoreader.notes.test-book')).toBe('{broken');
});

// Tony, 2026-11-03: a green check when the change is taken into account,
// instead of a greyed button that looked like it did nothing.
it('shows a green check once general notes are saved, and the save button only while they are not', () => {
  mount();
  click('Book notes (0)');
  const saveButton = () => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Save notes');
  typeGeneral('Saved at once');
  expect(host.querySelector('.notes-saved svg')).toBeTruthy();
  expect(saveButton()).toBeUndefined();
  const failing = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('Full', 'QuotaExceededError');
  });
  typeGeneral('Not saved');
  expect(host.querySelector('.notes-saved')).toBeNull();
  expect(saveButton()).toBeTruthy();
  failing.mockRestore();
  click('Save notes');
  expect(host.querySelector('.notes-saved svg')).toBeTruthy();
});

it('retains an unsaved general-note draft and lets the user retry after storage failure', () => {
  writeGeneralNote(book.id, 'Original');
  mount();
  click('Book notes (0)');
  const failing = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('Full', 'QuotaExceededError');
  });
  typeGeneral('New thoughts');
  expect(host.querySelector('textarea')!.value).toBe('New thoughts');
  expect(readBookNotes(book.id).general).toBe('Original');
  expect(host.querySelector('[role="alert"]')!.textContent).toContain('could not be saved');
  failing.mockRestore();
  click('Save notes');
  expect(readBookNotes(book.id).general).toBe('New thoughts');
});

it('captures across nested spoken words and sentences, saves, restores, and jumps back', () => {
  mount();
  const start = host.querySelector('.kw')!.firstChild!;
  const end = host.querySelector('[data-sentence="1"]')!.firstChild!;
  const range = document.createRange();
  range.setStart(start, 0);
  range.setEnd(end, 4);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  act(() => {
    start.parentElement!.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  click('Save highlight');
  expect(readAnnotations(book.id)[0].quote).toBe('world. Next');
  expect(host.querySelectorAll('mark').length).toBeGreaterThan(0);
  expect(host.querySelector('mark .kw')?.textContent).toBe('world');
  act(() => root.unmount());
  root = createRoot(host);
  mount();
  click('Book notes (1)');
  click('Chapter 1');
  expect(jump).toHaveBeenCalledWith(0);
  click('Book notes (1)');
  click('Remove highlight');
  expect(readAnnotations(book.id)).toEqual([]);
  expect(host.querySelectorAll('mark').length).toBe(0);
});

it('keeps saved notes intact when a removal cannot be persisted', () => {
  const note = {
    id: 'a',
    startSentence: 0,
    startOffset: 0,
    endSentence: 0,
    endOffset: 5,
    quote: 'Hello',
    comment: '',
    createdAt: 1,
  };
  writeAnnotations(book.id, [note]);
  mount();
  click('Book notes (1)');
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('Full', 'QuotaExceededError');
  });
  click('Remove highlight');
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('could not be saved');
  expect(readAnnotations(book.id)).toEqual([note]);
  expect(host.querySelector('mark')?.textContent).toBe('Hello');
});

it('keeps the highlight editor open with its draft when the save fails, and closes it once saved', () => {
  writeAnnotations(book.id, [
    { id: 'e', startSentence: 0, startOffset: 0, endSentence: 0, endOffset: 5, quote: 'Hello', comment: 'Before', createdAt: 1 },
  ]);
  mount();
  click('Book notes (1)');
  click('Edit highlight');
  const box = () => host.querySelector<HTMLTextAreaElement>('.book-note-entry textarea');
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(box()!, 'After');
    box()!.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const failing = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('Full', 'QuotaExceededError');
  });
  click('Save changes');
  expect(box()?.value).toBe('After');
  expect([...host.querySelectorAll('button')].some((b) => b.textContent === 'Save changes')).toBe(true);
  expect(readAnnotations(book.id)[0].comment).toBe('Before');
  failing.mockRestore();
  click('Save changes');
  expect(readAnnotations(book.id)[0].comment).toBe('After');
  expect([...host.querySelectorAll('button')].some((b) => b.textContent === 'Save changes')).toBe(false);
});

it('edits an existing highlight with a rainbow preset and a validated custom hex color', () => {
  writeAnnotations(book.id, [
    {
      id: 'color',
      startSentence: 0,
      startOffset: 0,
      endSentence: 0,
      endOffset: 5,
      quote: 'Hello',
      comment: 'Keep this',
      createdAt: 1,
    },
  ]);
  mount();
  click('Book notes (1)');
  click('Edit highlight');
  const blue = host.querySelector<HTMLButtonElement>('[aria-label="Blue highlight"]')!;
  act(() => blue.click());
  click('Save changes');
  expect(readAnnotations(book.id)[0].color).toBe('#8ab4f8');
  click('Edit highlight');
  const input = host.querySelector<HTMLInputElement>(
    '.highlight-colors input[placeholder="#AABBCC"]'
  )!;
  const type = (value: string) =>
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  type('#XYZ');
  expect(
    [...host.querySelectorAll('button')].find((b) => b.textContent === 'Save changes')!.disabled
  ).toBe(true);
  type('#000');
  click('Save changes');
  expect(readAnnotations(book.id)[0]).toMatchObject({ color: '#000000', comment: 'Keep this' });
  expect(host.querySelector('mark')!.style.backgroundColor).toBe('rgb(0, 0, 0)');
  expect(host.querySelector('mark')!.style.color).toBe('rgb(255, 255, 255)');
  act(() => root.unmount());
  root = createRoot(host);
  mount();
  expect(host.querySelector('mark')!.style.backgroundColor).toBe('rgb(0, 0, 0)');
});

it('keeps a saved quote after text changes without highlighting the wrong passage', () => {
  writeAnnotations(book.id, [
    {
      id: 'old',
      startSentence: 0,
      startOffset: 0,
      endSentence: 0,
      endOffset: 5,
      quote: 'Other',
      comment: 'Preserved',
      createdAt: 1,
    },
  ]);
  mount();
  click('Book notes (1)');
  expect(host.textContent).toContain('Preserved');
  expect(host.textContent).toContain('Book text has changed');
  expect(host.querySelector('mark')).toBeNull();
  expect(host.querySelector<HTMLButtonElement>('.note-location')!.disabled).toBe(true);
});

function typeLabel(name: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(`input[aria-label="${name} color label"]`)!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

it('removes, restores, and adds custom colors without removing highlighted passages', () => {
  writeAnnotations(book.id, [
    {
      id: 'a',
      startSentence: 0,
      startOffset: 0,
      endSentence: 0,
      endOffset: 5,
      quote: 'Hello',
      comment: '',
      color: '#f28b82',
      createdAt: 1,
    },
  ]);
  mount();
  click('Book notes (1)');
  typeLabel('Red', 'Important');
  const remove = host.querySelector<HTMLButtonElement>('[aria-label="Remove Red from color key"]')!;
  act(() => remove.click());
  expect(host.querySelector('[aria-label="Red color label"]')).toBeNull();
  expect(readBookNotes(book.id).hiddenColors).toContain('#f28b82');
  expect(host.querySelector('mark')).not.toBeNull();
  act(() => root.unmount());
  root = createRoot(host);
  mount();
  click('Book notes (1)');
  expect(host.querySelector('[aria-label="Red color label"]')).toBeNull();
  const select = host.querySelector('select')!;
  act(() => {
    select.value = '#f28b82';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  click('Add color');
  expect(host.querySelector<HTMLInputElement>('[aria-label="Red color label"]')!.value).toBe(
    'Important'
  );
  const custom = host.querySelector<HTMLInputElement>('.color-key-add input')!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(custom, '#123');
    custom.dispatchEvent(new Event('input', { bubbles: true }));
  });
  click('Add custom color');
  expect(host.querySelector<HTMLInputElement>('[aria-label="#112233 color label"]')!.value).toBe(
    ''
  );
  expect(readAnnotations(book.id)).toHaveLength(1);
});

it('starts color labels blank, includes custom used colors, and restores labels in the picker', () => {
  writeAnnotations(book.id, [
    {
      id: 'a',
      startSentence: 0,
      startOffset: 0,
      endSentence: 0,
      endOffset: 5,
      quote: 'Hello',
      comment: '',
      color: '#123456',
      createdAt: 1,
    },
  ]);
  mount();
  click('Book notes (1)');
  const inputs = [...host.querySelectorAll<HTMLInputElement>('.color-key-row input')];
  expect(inputs).toHaveLength(8);
  expect(inputs.every((input) => input.value === '')).toBe(true);
  typeLabel('Yellow', 'Funny');
  typeLabel('#123456', 'Questions');
  expect(readBookNotes(book.id).colorLabels).toEqual({
    '#eed16a': 'Funny',
    '#123456': 'Questions',
  });
  act(() => root.unmount());
  root = createRoot(host);
  mount();
  click('Book notes (1)');
  expect(host.querySelector<HTMLInputElement>('[aria-label="Yellow color label"]')!.value).toBe(
    'Funny'
  );
  click('Edit highlight');
  expect(host.querySelector('[title="Yellow: Funny"]')).not.toBeNull();
  expect(host.querySelector('.highlight-label')!.textContent).toBe('Questions');
});

it('keeps an unsaved color label for retry when storage fails', () => {
  mount();
  click('Book notes (0)');
  const failing = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('Full', 'QuotaExceededError');
  });
  typeLabel('Red', 'My label');
  expect(readBookNotes(book.id).colorLabels).toEqual({});
  expect(host.querySelector<HTMLInputElement>('[aria-label="Red color label"]')!.value).toBe(
    'My label'
  );
  expect(host.querySelector('[role="alert"]')!.textContent).toContain('could not be saved');
  failing.mockRestore();
  click('Save color key');
  expect(readBookNotes(book.id).colorLabels['#f28b82']).toBe('My label');
});

it('opens closed notes at the clicked highlight entry, including later passages', () => {
  const scroll = vi.fn();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: scroll,
  });
  try {
    writeAnnotations(book.id, [
      {
        id: 'first',
        startSentence: 0,
        startOffset: 0,
        endSentence: 0,
        endOffset: 5,
        quote: 'Hello',
        comment: 'First note',
        createdAt: 1,
      },
      {
        id: 'second',
        startSentence: 1,
        startOffset: 0,
        endSentence: 1,
        endOffset: 4,
        quote: 'Next',
        comment: 'Target note',
        createdAt: 2,
      },
    ]);
    mount({
      ...book,
      chapters: [
        book.chapters[0],
        { id: 'chapter-2', title: 'Chapter 2', start: 13, end: 24, sentenceStart: 1 },
      ],
    });
    window.getSelection()?.removeAllRanges();
    expect(host.querySelector('aside')).toBeNull();
    const marks = host.querySelectorAll<HTMLElement>('mark');
    act(() => marks[1].click());
    expect(host.querySelector('aside')).not.toBeNull();
    expect(host.querySelector('.targeted-note')!.textContent).toContain('Target note');
    expect(host.querySelectorAll('.notes-chapter')).toHaveLength(2);
    expect(host.querySelector('.targeted-note')!.closest('details')!.open).toBe(true);
    expect(host.querySelector<HTMLDetailsElement>('.notes-chapter')!.open).toBe(false);
    expect(document.activeElement).toBe(host.querySelector('.targeted-note'));
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' });
    click('Close notes');
    act(() => {
      marks[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(host.querySelector('.targeted-note')!.textContent).toContain('First note');
    expect(host.querySelector('.targeted-note')!.closest('details')!.open).toBe(true);
  } finally {
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  }
});

it('allows selecting highlighted text without opening the notes panel', () => {
  writeAnnotations(book.id, [
    {
      id: 'a',
      startSentence: 0,
      startOffset: 0,
      endSentence: 0,
      endOffset: 5,
      quote: 'Hello',
      comment: '',
      createdAt: 1,
    },
  ]);
  mount();
  const mark = host.querySelector<HTMLElement>('mark')!;
  const range = document.createRange();
  range.selectNodeContents(mark);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  act(() => mark.click());
  expect(host.querySelector('aside')).toBeNull();
  selection.removeAllRanges();
});
