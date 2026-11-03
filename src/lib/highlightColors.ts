/** The seven swatches of the picker. These are the reader's DATA (a saved
 *  highlight keeps its hex), not interface colors, so they are not CSS variables. */
export const HIGHLIGHT_PRESETS = [
  { name: 'Red', hex: '#f28b82' },
  { name: 'Orange', hex: '#fbbc75' },
  { name: 'Yellow', hex: '#eed16a' },
  { name: 'Green', hex: '#a8dab5' },
  { name: 'Blue', hex: '#8ab4f8' },
  { name: 'Indigo', hex: '#a8a0ed' },
  { name: 'Violet', hex: '#d7aefb' },
] as const;
/** The color of a highlight saved before colors existed: the Yellow preset
 *  (styles.css mirrors it as --highlight-yellow). */
export const DEFAULT_HIGHLIGHT: string = HIGHLIGHT_PRESETS[2].hex;

/** A preset's name in the interface language (`color.<name>` key); a custom
 *  color has no name, so it is shown as its hex. `name` above stays English:
 *  it is the key, never the label. */
export function presetColorName(hex: string, t: (key: string) => string): string {
  const preset = HIGHLIGHT_PRESETS.find((p) => p.hex === hex);
  return preset ? t(`color.${preset.name.toLowerCase()}`) : hex;
}

/** `#abc` or `abc` → `#aabbcc`, lower case; null for anything that is not a 3- or 6-digit hex. */
export function normalizeHex(value: string): string | null {
  const hex = value.trim().replace(/^#/, '');
  if (!/^(?:[\da-f]{3}|[\da-f]{6})$/i.test(hex)) return null;
  return '#' + (hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex).toLowerCase();
}

/** The color a highlight is painted with: its own, or the default for an old or broken value. */
export function highlightColor(value?: string): string {
  return normalizeHex(value ?? '') ?? DEFAULT_HIGHLIGHT;
}

/** Choose the higher-contrast text color, including for very dark custom colors.
 *  Pure black or white on purpose: the ink is computed against a color the
 *  reader chose, by the WCAG contrast formula, so no theme variable can stand in. */
export function highlightInk(background: string): string {
  const hex = highlightColor(background).slice(1);
  const rgb = [0, 2, 4].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const luminance = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? '#000000' : '#ffffff';
}
