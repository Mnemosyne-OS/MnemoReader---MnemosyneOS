// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useBookVaultStatus } from './useNotesVaultSync';
import { markVaultSyncError, markVaultSyncPending } from '../lib/notesVaultSync';
import { notesKey } from '../lib/annotations';
import type { Book } from '../lib/types';

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

// The status line of a book's notes panel shows THAT book's state, never
// another book's failure (logic review, M30).
it("shows a book's own sync state, not another book's failure", () => {
  const host = document.createElement('div');
  const root = createRoot(host);
  function Status({ id }: { id: string }) {
    return createElement('span', null, useBookVaultStatus(id)?.key ?? 'none');
  }
  markVaultSyncPending('mine');
  localStorage.setItem(notesKey('other'), JSON.stringify({ notes: [], general: 'x' }));
  act(() => root.render(createElement(Status, { id: 'mine' })));
  act(() => markVaultSyncError([{ id: 'other' } as Book], new Error('offline')));
  expect(host.textContent).toBe('vault.pending');
  act(() => root.unmount());
});
