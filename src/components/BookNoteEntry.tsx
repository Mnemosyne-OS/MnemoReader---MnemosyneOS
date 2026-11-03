import { useState, type Ref } from 'react';
import type { Annotation } from '../lib/annotations';
import { highlightColor, normalizeHex } from '../lib/highlightColors';
import { HighlightColorPicker } from './HighlightColorPicker';
import { useI18n } from '../i18n/useI18n';

interface Props {
  note: Annotation;
  location: string;
  matches: boolean;
  targeted: boolean;
  entryRef?: Ref<HTMLElement>;
  labels: Record<string, string>;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  onJump: () => void;
  onSave: (note: Annotation) => boolean;
  onRemove: () => void;
}

/** One saved passage, with a local edit draft that survives a failed save. */
export function BookNoteEntry({
  note,
  location,
  matches,
  targeted,
  entryRef,
  labels,
  editing,
  onEditingChange,
  onJump,
  onSave,
  onRemove,
}: Props) {
  const { t } = useI18n();
  const [comment, setComment] = useState(note.comment);
  const [color, setColor] = useState(highlightColor(note.color));

  const edit = () => {
    setComment(note.comment);
    setColor(highlightColor(note.color));
    onEditingChange(true);
  };

  const save = () => {
    const normalized = normalizeHex(color);
    if (normalized && onSave({ ...note, comment: comment.trim(), color: normalized })) {
      onEditingChange(false);
    }
  };

  return (
    <article
      ref={entryRef}
      tabIndex={-1}
      className={`book-note-entry${targeted ? ' targeted-note' : ''}`}
    >
      <button className="note-location" disabled={!matches} onClick={onJump}>
        {location}
      </button>
      {!matches && (
        <p>{t('notes.quoteMoved')}</p>
      )}
      <blockquote style={{ borderLeftColor: highlightColor(note.color) }}>{note.quote}</blockquote>
      {editing ? (
        <>
          <label>
            {t('notes.comment')}
            <textarea value={comment} onChange={(event) => setComment(event.target.value)} />
          </label>
          <HighlightColorPicker value={color} onChange={setColor} labels={labels} />
          <button className="chip" disabled={!normalizeHex(color)} onClick={save}>
            {t('notes.saveChanges')}
          </button>{' '}
          <button className="chip" onClick={() => onEditingChange(false)}>
            {t('notes.cancel')}
          </button>
        </>
      ) : (
        <>
          {note.comment && <p className="note-comment">{note.comment}</p>}
          <button className="chip" onClick={edit}>
            {t('notes.editHighlight')}
          </button>{' '}
          <button className="chip" onClick={onRemove}>
            {t('notes.removeHighlight')}
          </button>
        </>
      )}
    </article>
  );
}
