import { useMemo, useState } from 'react';
import { searchBook, type BookSearchResult } from '../lib/bookSearch';
import type { Annotation } from '../lib/annotations';
import type { Book, LoadedBook } from '../lib/types';
import { useI18n } from '../i18n/useI18n';

export function BookSearch({
  book,
  loaded,
  notes,
  general,
  labels,
  onSelect,
}: {
  book: Book;
  loaded: LoadedBook;
  notes: Annotation[];
  general: string;
  labels: Record<string, string>;
  onSelect: (result: BookSearchResult) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'all' | 'book' | 'notes'>('all');
  const [limit, setLimit] = useState(30);
  const results = useMemo(
    () => searchBook(book, loaded, notes, general, labels, query, scope),
    [book, loaded, notes, general, labels, query, scope]
  );
  return (
    <>
      <button className="chip" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {t('search.open')}
      </button>
      {open && (
        <section className="book-search-panel" aria-label={t('search.panel')}>
          <div className="book-search-heading">
            <strong>{t('search.heading', { title: book.title })}</strong>
            <button className="chip" onClick={() => setOpen(false)}>
              {t('search.close')}
            </button>
          </div>
          <label>
            {t('search.query')}
            <input
              autoFocus
              type="search"
              value={query}
              placeholder={t('search.placeholder')}
              onChange={(e) => {
                setQuery(e.target.value);
                setLimit(30);
              }}
            />
          </label>
          <label>
            {t('search.scope')}
            <select
              value={scope}
              onChange={(e) => {
                setScope(e.target.value as 'all' | 'book' | 'notes');
                setLimit(30);
              }}
            >
              <option value="all">{t('search.scopeAll')}</option>
              <option value="book">{t('search.scopeBook')}</option>
              <option value="notes">{t('search.scopeNotes')}</option>
            </select>
          </label>
          <p>{t('search.help')}</p>
          {query.trim() && (
            <p role="status">
              {results.length === 1
                ? t('search.countOne')
                : t('search.countMany', { n: results.length })}
            </p>
          )}
          {query.trim() && !results.length && (
            <p>{t('search.none')}</p>
          )}
          <div className="book-search-results">
            {results.slice(0, limit).map((result) => (
              <button
                key={result.id}
                className="book-search-result"
                onClick={() => {
                  onSelect(result);
                  setOpen(false);
                }}
              >
                <strong>{result.title}</strong>
                <span>{result.snippet}</span>
              </button>
            ))}
          </div>
          {results.length > limit && (
            <button className="chip" onClick={() => setLimit((n) => n + 30)}>
              {t('search.more')}
            </button>
          )}
        </section>
      )}
    </>
  );
}
