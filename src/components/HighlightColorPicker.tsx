import {
  DEFAULT_HIGHLIGHT,
  HIGHLIGHT_PRESETS,
  highlightInk,
  normalizeHex,
  presetColorName,
} from '../lib/highlightColors';
import { useI18n } from '../i18n/useI18n';

export function HighlightColorPicker({
  value,
  onChange,
  labels = {},
}: {
  value: string;
  onChange: (value: string) => void;
  labels?: Record<string, string>;
}) {
  const { t } = useI18n();
  const normalized = normalizeHex(value);
  const color = normalized ?? DEFAULT_HIGHLIGHT;
  const options = [
    ...HIGHLIGHT_PRESETS,
    ...Object.keys(labels)
      .filter((hex) => !HIGHLIGHT_PRESETS.some((p) => p.hex === hex))
      .map((hex) => ({ name: hex, hex })),
  ];
  return (
    <fieldset className="highlight-colors">
      <legend>{t('colorPicker.legend')}</legend>
      <div className="highlight-swatches">
        {options.map((p) => {
          const name = presetColorName(p.hex, t);
          return (
            <button
              key={p.name}
              type="button"
              aria-label={
                labels[p.hex]
                  ? t('colorPicker.swatchAriaLabelled', { name, label: labels[p.hex] })
                  : t('colorPicker.swatchAria', { name })
              }
              title={labels[p.hex] ? `${name}: ${labels[p.hex]}` : name}
              aria-pressed={normalized === p.hex}
              style={{ backgroundColor: p.hex, color: highlightInk(p.hex) }}
              onClick={() => onChange(p.hex)}
            >
              {normalized === p.hex ? '✓' : ''}
              <span className="swatch-name">{name}</span>
            </button>
          );
        })}
      </div>
      <label>
        {t('colorPicker.hex')}
        <input
          type="text"
          value={value}
          maxLength={7}
          spellCheck={false}
          placeholder="#AABBCC"
          aria-invalid={!normalized}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
      {!normalized && (
        <p role="status">{t('colorPicker.hexInvalid')}</p>
      )}
      <span
        className="highlight-color-preview"
        style={{ backgroundColor: color, color: highlightInk(color) }}
      >
        {t('colorPicker.preview')}
      </span>
      {normalized && labels[normalized] && (
        <span className="highlight-label">{labels[normalized]}</span>
      )}
    </fieldset>
  );
}
