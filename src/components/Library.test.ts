// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { Library } from './Library';
import type { Book } from '../lib/types';
import { setLang } from '../i18n/useI18n';

const base: Book = {
  id: 'base',
  title: 'Unstarted',
  filePath: '',
  ext: 'txt',
  hue: 30,
  addedAt: 1,
  sentenceCount: 11,
  chapters: [],
  progressSentence: 0,
  ingest: 'archived',
  archived: true,
};
const books = [
  { ...base, id: 'finished', title: 'Completed', finishedAt: 100, addedAt: 100 },
  { ...base, id: 'half', title: 'Halfway', progressSentence: 5, addedAt: 10 },
  base,
];
let host: HTMLDivElement;
let root: Root;
const onOpen = vi.fn();
const onToggleFinished = vi.fn();
function mount(list = books) {
  act(() =>
    root.render(
      createElement(Library, {
        books: list,
        onOpen,
        onToggleFinished,
        onDelete: vi.fn(),
        onAddFile: vi.fn(),
        onAddFolder: vi.fn(),
        onAddUrl: vi.fn(),
        onSample: vi.fn(),
        onDropPaths: vi.fn(),
      })
    )
  );
}
// The labels these tests find are the English ones.
beforeEach(() => {
  setLang('en');
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  onOpen.mockClear();
  onToggleFinished.mockClear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it('puts completed books last and shows explicit percentages, including zero and finished', () => {
  mount();
  expect([...host.querySelectorAll('.cover-title')].map((el) => el.textContent)).toEqual([
    'Halfway',
    'Unstarted',
    'Completed',
  ]);
  expect([...host.querySelectorAll('.book-progress-label')].map((el) => el.textContent)).toEqual([
    '50% complete',
    '0% complete',
    '100% complete',
  ]);
  expect(host.textContent).toContain('✓ Finished');
});

it('persists the hide/show finished filter across reopening the library', () => {
  mount();
  const select = host.querySelector('select')!;
  act(() => {
    select.value = 'active';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect([...host.querySelectorAll('.cover-title')].map((el) => el.textContent)).toEqual([
    'Halfway',
    'Unstarted',
  ]);
  act(() => {
    select.value = 'finished';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  act(() => root.unmount());
  root = createRoot(host);
  mount();
  expect(host.querySelector('select')!.value).toBe('finished');
  expect([...host.querySelectorAll('.cover-title')].map((el) => el.textContent)).toEqual([
    'Completed',
  ]);
});

it('lets users change finished status without opening the book and clamps progress', () => {
  mount([{ ...base, progressSentence: 999 }]);
  expect(host.querySelector('.book-progress-label')!.textContent).toBe('100% complete');
  act(() => host.querySelector<HTMLButtonElement>('.book-completion-toggle')!.click());
  expect(onToggleFinished).toHaveBeenCalledWith(expect.objectContaining({ id: base.id }));
  expect(onOpen).not.toHaveBeenCalled();
});
