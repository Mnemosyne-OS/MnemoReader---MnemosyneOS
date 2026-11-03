import { useState } from 'react';
import {
  HIGHLIGHT_PRESETS,
  highlightColor,
  normalizeHex,
  presetColorName,
} from '../lib/highlightColors';
import { useI18n } from '../i18n/useI18n';
export function BookColorKey({
  labels,
  usedColors,
  hiddenColors,
  onRemove,
  onAdd,
  onChange,
  onRetry,
  unsaved,
  disabled,
}: {
  labels: Record<string, string>;
  usedColors: (string | undefined)[];
  hiddenColors: string[];
  onRemove: (hex: string) => void;
  onAdd: (hex: string) => void;
  onChange: (labels: Record<string, string>) => void;
  onRetry: () => void;
  unsaved: boolean;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const [restore, setRestore] = useState('');
  const [custom, setCustom] = useState('');
  const allColors = [
    ...new Set([
      ...HIGHLIGHT_PRESETS.map((p) => p.hex),
      ...usedColors.map(highlightColor),
      ...Object.keys(labels),
      ...hiddenColors,
    ]),
  ];
  const colors = allColors.filter((hex) => !hiddenColors.includes(hex));
  const customHex = normalizeHex(custom);
  return (
    <details className="book-note-entry color-key-toggle" aria-label={t('colorKey.title')}>
      <summary>
        {t('colorKey.title')}
        {unsaved && <span> ({t('colorKey.unsavedShort')})</span>}
      </summary>
      <p>{t('colorKey.intro')}</p>
      <div className="book-color-key">
        {colors.map((hex) => {
          const name = presetColorName(hex, t);
          return (
            <div key={hex} className="color-key-row">
              <span
                className="color-key-swatch"
                style={{ backgroundColor: hex }}
                aria-hidden="true"
              />
              <span className="color-key-name">{name}</span>
              <input
                type="text"
                aria-label={t('colorKey.labelAria', { name })}
                value={labels[hex] ?? ''}
                placeholder={t('colorKey.labelPlaceholder')}
                disabled={disabled}
                onChange={(e) => onChange({ ...labels, [hex]: e.target.value })}
              />
              <button
                className="chip"
                aria-label={t('colorKey.removeAria', { name })}
                title={t('colorKey.removeTitle')}
                disabled={disabled}
                onClick={() => onRemove(hex)}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
      {!colors.length && <p>{t('colorKey.empty')}</p>}
      <p>{t('colorKey.removeNote')}</p>
      {hiddenColors.length > 0 && (
        <div className="color-key-add">
          <label>
            {t('colorKey.restoreLabel')}
            <select
              value={restore}
              disabled={disabled}
              onChange={(e) => setRestore(e.target.value)}
            >
              <option value="">{t('colorKey.choose')}</option>
              {hiddenColors.map((hex) => (
                <option key={hex} value={hex}>
                  {presetColorName(hex, t)}
                  {labels[hex] ? `: ${labels[hex]}` : ''}
                </option>
              ))}
            </select>
          </label>
          <button
            className="chip"
            disabled={disabled || !hiddenColors.includes(restore)}
            onClick={() => {
              onAdd(restore);
              setRestore('');
            }}
          >
            {t('colorKey.addColor')}
          </button>
        </div>
      )}
      <div className="color-key-add">
        <label>
          {t('colorKey.customHex')}
          <input
            type="text"
            placeholder="#AABBCC"
            value={custom}
            maxLength={7}
            disabled={disabled}
            aria-invalid={custom.length > 0 && !customHex}
            onChange={(e) => setCustom(e.target.value)}
          />
        </label>
        <button
          className="chip"
          disabled={disabled || !customHex || colors.includes(customHex)}
          onClick={() => {
            if (customHex) {
              onAdd(customHex);
              setCustom('');
            }
          }}
        >
          {t('colorKey.addCustom')}
        </button>
      </div>
      {custom && !customHex && <p role="status">{t('colorKey.hexInvalid')}</p>}
      <p role="status">
        {unsaved ? t('colorKey.unsaved') : t('colorKey.saved')}
      </p>
      {unsaved && (
        <button className="chip" disabled={disabled} onClick={onRetry}>
          {t('colorKey.save')}
        </button>
      )}
    </details>
  );
}
