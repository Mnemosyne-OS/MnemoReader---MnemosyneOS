import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HIGHLIGHT,
  HIGHLIGHT_PRESETS,
  highlightColor,
  highlightInk,
  normalizeHex,
} from './highlightColors';

describe('highlight colors', () => {
  it('accepts shorthand and full hex, rejecting invalid input and CSS values', () => {
    expect(normalizeHex(' #AbC ')).toBe('#aabbcc');
    expect(normalizeHex('A1B2C3')).toBe('#a1b2c3');
    for (const invalid of ['', '#12', '#GGGGGG', 'red', 'url(example)', '#12345678'])
      expect(normalizeHex(invalid)).toBeNull();
  });
  it('keeps legacy highlights yellow and chooses contrasting text for custom colors', () => {
    expect(highlightColor()).toBe(DEFAULT_HIGHLIGHT);
    expect(highlightColor('invalid')).toBe(DEFAULT_HIGHLIGHT);
    expect(highlightInk('#000000')).toBe('#ffffff');
    expect(highlightInk('#ffffff')).toBe('#000000');
    expect(HIGHLIGHT_PRESETS).toHaveLength(7);
  });
});
