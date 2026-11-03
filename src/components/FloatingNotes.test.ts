// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, expect, it, vi } from 'vitest';
import { FloatingNotes } from './FloatingNotes';
import { setLang } from '../i18n/useI18n';

// The labels these tests find are the English ones.
beforeEach(() => setLang('en'));

it('moves with keyboard controls, stays on screen, and leaves note content intact', () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('innerWidth', 1000);
  vi.stubGlobal('innerHeight', 800);
  const rect = vi
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockReturnValue({
      width: 440,
      height: 680,
      left: 544,
      top: 72,
      right: 984,
      bottom: 752,
      x: 544,
      y: 72,
      toJSON: () => ({}),
    });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    act(() =>
      root.render(
        createElement(FloatingNotes, { title: 'Book', onClose: () => {}, children: 'Saved notes' })
      )
    );
    const panel = host.querySelector('aside')!;
    const handle = host.querySelector('button')!;
    const press = (key: string) =>
      act(() => {
        handle.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      });
    press('ArrowLeft');
    expect(panel.style.left).toBe('528px');
    for (let i = 0; i < 50; i++) press('ArrowUp');
    expect(panel.style.top).toBe('8px');
    press('Home');
    expect(panel.style.left).toBe('544px');
    expect(panel.style.top).toBe('72px');
    const resize = host.querySelector<HTMLButtonElement>('[aria-label="Resize book notes"]')!;
    const resizeKey = (key: string) =>
      act(() => {
        resize.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      });
    resizeKey('ArrowLeft');
    expect(panel.style.width).toBe('424px');
    resizeKey('ArrowUp');
    expect(panel.style.height).toBe('664px');
    for (let i = 0; i < 50; i++) {
      resizeKey('ArrowLeft');
      resizeKey('ArrowUp');
    }
    expect(panel.style.width).toBe('280px');
    expect(panel.style.height).toBe('240px');
    expect(panel.style.left).toBe('544px');
    vi.stubGlobal('innerWidth', 500);
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(panel.style.left).toBe('52px');
    expect(host.textContent).toContain('Saved notes');
  } finally {
    act(() => root.unmount());
    host.remove();
    rect.mockRestore();
    vi.unstubAllGlobals();
  }
});
