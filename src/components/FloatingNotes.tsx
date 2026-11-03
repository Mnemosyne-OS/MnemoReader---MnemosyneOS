import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useI18n } from '../i18n/useI18n';

export function FloatingNotes({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const panel = useRef<HTMLElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const resizing = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const [position, setPosition] = useState(() => ({
    x: Math.max(12, window.innerWidth - 456),
    y: 72,
  }));
  const [size, setSize] = useState(() => ({
    width: Math.min(440, window.innerWidth - 16),
    height: Math.min(680, window.innerHeight - 16),
  }));

  const resizePanel = (width: number, height: number) => {
    const rect = panel.current?.getBoundingClientRect();
    const maxWidth = Math.max(1, window.innerWidth - (rect?.left ?? 8) - 8);
    const maxHeight = Math.max(1, window.innerHeight - (rect?.top ?? 8) - 8);
    setSize({
      width: Math.max(Math.min(280, maxWidth), Math.min(width, maxWidth)),
      height: Math.max(Math.min(240, maxHeight), Math.min(height, maxHeight)),
    });
  };

  const constrain = (x: number, y: number) => {
    const rect = panel.current?.getBoundingClientRect();
    return {
      x: Math.max(8, Math.min(x, window.innerWidth - (rect?.width ?? 440) - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - (rect?.height ?? 680) - 8)),
    };
  };

  useEffect(() => {
    const keepOnScreen = () => {
      setSize((s) => ({
        width: Math.min(s.width, window.innerWidth - 16),
        height: Math.min(s.height, window.innerHeight - 16),
      }));
      setPosition((p) => constrain(p.x, p.y));
    };
    keepOnScreen();
    window.addEventListener('resize', keepOnScreen);
    return () => window.removeEventListener('resize', keepOnScreen);
  }, []);

  return (
    <aside
      ref={panel}
      className="book-notes-panel floating-notes"
      aria-label={t('notes.panelLabel', { title })}
      style={{ left: position.x, top: position.y, width: size.width, height: size.height }}
    >
      <div className="book-notes-heading floating-notes-heading">
        <button
          className="notes-drag-handle"
          aria-label={t('notes.move')}
          title={t('notes.moveHint')}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            const rect = panel.current!.getBoundingClientRect();
            drag.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (drag.current)
              setPosition(constrain(e.clientX - drag.current.x, e.clientY - drag.current.y));
          }}
          onPointerUp={(e) => {
            drag.current = null;
            if (e.currentTarget.hasPointerCapture(e.pointerId))
              e.currentTarget.releasePointerCapture(e.pointerId);
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
          onLostPointerCapture={() => {
            drag.current = null;
          }}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 48 : 16;
            const directions: Record<string, [number, number]> = {
              ArrowLeft: [-step, 0],
              ArrowRight: [step, 0],
              ArrowUp: [0, -step],
              ArrowDown: [0, step],
            };
            if (e.key === 'Home') {
              e.preventDefault();
              setPosition(constrain(window.innerWidth - 456, 72));
            } else if (directions[e.key]) {
              e.preventDefault();
              const [dx, dy] = directions[e.key];
              setPosition((p) => constrain(p.x + dx, p.y + dy));
            }
          }}
        >
          <span aria-hidden="true">⠿</span> {t('notes.panelHeading', { title })}
        </button>
        <button className="chip" onClick={onClose}>
          {t('notes.close')}
        </button>
      </div>
      <div className="floating-notes-content">{children}</div>
      <button
        className="notes-resize-handle"
        aria-label={t('notes.resize')}
        title={t('notes.resizeHint')}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          const rect = panel.current!.getBoundingClientRect();
          resizing.current = { x: e.clientX, y: e.clientY, width: rect.width, height: rect.height };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const start = resizing.current;
          if (start)
            resizePanel(start.width + e.clientX - start.x, start.height + e.clientY - start.y);
        }}
        onPointerUp={(e) => {
          resizing.current = null;
          if (e.currentTarget.hasPointerCapture(e.pointerId))
            e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onPointerCancel={() => {
          resizing.current = null;
        }}
        onLostPointerCapture={() => {
          resizing.current = null;
        }}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 48 : 16;
          const directions: Record<string, [number, number]> = {
            ArrowLeft: [-step, 0],
            ArrowRight: [step, 0],
            ArrowUp: [0, -step],
            ArrowDown: [0, step],
          };
          if (directions[e.key]) {
            e.preventDefault();
            const [dw, dh] = directions[e.key];
            resizePanel(size.width + dw, size.height + dh);
          }
        }}
      >
        <span aria-hidden="true">◢</span>
      </button>
    </aside>
  );
}
