import type { OcrProgress } from './bridge';

type T = (key: string, vars?: Record<string, string | number>) => string;

/**
 * How an OCR state reads on a library card and in the import overlay.
 *
 * One function for both surfaces because they must never disagree: a card
 * saying "page 3 / 40" beside an overlay saying "reading…" is two answers to
 * the same question. `undefined` means the host reported nothing countable —
 * the card falls back to its plain label rather than inventing a page 0.
 */
export function ocrLabel(ocr: OcrProgress | undefined, t: T): string {
  if (!ocr) return t('card.reading');
  return ocr.phase === 'queued'
    ? t('card.ocrQueued', { n: ocr.ahead })
    : t('import.ocrPage', { page: ocr.page, of: ocr.of });
}

/** The same state, for the overlay's detail line (which has its own label above). */
export function ocrDetail(ocr: OcrProgress, t: T): string {
  return ocr.phase === 'queued'
    ? t('card.ocrQueued', { n: ocr.ahead })
    : t('import.ocrPage', { page: ocr.page, of: ocr.of });
}
