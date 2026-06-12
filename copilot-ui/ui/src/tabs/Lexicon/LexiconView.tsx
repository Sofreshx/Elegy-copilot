import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PageContainer, Panel, Toolbar } from '../../components';
import { useStoreValue } from '../../lib/store';
import { lexiconStore } from './lexiconStore';

function highlightTerm(text: string, query: string): React.ReactNode {
  if (!query?.trim() || !text) return text;

  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const lowerText = text.toLowerCase();

  const ranges: Array<{ start: number; end: number }> = [];
  for (const term of terms) {
    let idx = 0;
    while (idx < lowerText.length) {
      const pos = lowerText.indexOf(term, idx);
      if (pos === -1) break;
      ranges.push({ start: pos, end: pos + term.length });
      idx = pos + 1;
    }
  }

  if (ranges.length === 0) return text;

  ranges.sort((a, b) => a.start - b.start);
  const merged: typeof ranges = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) {
      last.end = Math.max(last.end, r.end);
    } else {
      merged.push(r);
    }
  }

  const result: React.ReactNode[] = [];
  let lastEnd = 0;
  for (const r of merged) {
    if (r.start > lastEnd) {
      result.push(text.slice(lastEnd, r.start));
    }
    result.push(<mark key={`${r.start}-${r.end}`}>{text.slice(r.start, r.end)}</mark>);
    lastEnd = r.end;
  }
  if (lastEnd < text.length) {
    result.push(text.slice(lastEnd));
  }

  return result.length === 1 ? result[0] : <>{result}</>;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max) + '…';
}

function getCategoryIcon(key: string): string {
  const icons: Record<string, string> = {
    ARCHITECTURE: '🏗️',
    CONFIG_VALUES: '⚙️',
    CONSTRAINTS: '🚫',
    NAMING: '📛',
    PROJECT_RULES: '📋',
  };
  return icons[key] || '📄';
}

export default function LexiconView() {
  const state = useStoreValue(lexiconStore);
  const searchRef = useRef<HTMLInputElement>(null);
  const [searchInput, setSearchInput] = useState('');

  const sortedCategories = useMemo(() => {
    return Object.entries(state.categories).sort(([, a], [, b]) => a.localeCompare(b));
  }, [state.categories]);

  const isLoading = state.loading && state.entries.length === 0;

  const triggerSearch = useCallback((query: string) => {
    lexiconStore.search(query);
  }, []);

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setSearchInput(value);
      const debounced = setTimeout(() => triggerSearch(value), 250);
      return () => clearTimeout(debounced);
    },
    [triggerSearch],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        setSearchInput('');
        lexiconStore.search('');
        searchRef.current?.blur();
      }
    },
    [],
  );

  const handleSearchClear = useCallback(() => {
    setSearchInput('');
    lexiconStore.search('');
    searchRef.current?.focus();
  }, []);

  const handleCategoryClick = useCallback(
    (category: string) => {
      lexiconStore.setActiveCategory(state.activeCategory === category ? '' : category);
    },
    [state.activeCategory],
  );

  const handleClearCategory = useCallback(() => {
    lexiconStore.setActiveCategory('');
  }, []);

  useEffect(() => {
    void lexiconStore.load();
  }, []);

  const showSearchResults = state.query.trim().length > 0;
  const showCategoryBrowse = !showSearchResults && !state.activeCategory;
  const showCategoryTerms = !showSearchResults && !!state.activeCategory;

  return (
    <section className="view-shell lexicon-view" data-testid="lexicon-view">
      <div className="view-static">
      <Toolbar testId="lexicon-toolbar">
        <h2 className="lexicon-title">Lexicon</h2>
        <div className="lexicon-search-wrapper">
          <span className="lexicon-search-icon" aria-hidden="true">🔍</span>
          <input
            ref={searchRef}
            className="lexicon-search-input"
            type="text"
            placeholder="Search terms, tags, or definitions…"
            value={searchInput}
            onChange={handleSearchChange}
            onKeyDown={handleKeyDown}
            data-testid="lexicon-search-input"
            aria-label="Search lexicon"
          />
          {searchInput ? (
            <button
              className="lexicon-search-clear"
              onClick={handleSearchClear}
              data-testid="lexicon-search-clear"
              type="button"
              aria-label="Clear search"
            >
              ✕
            </button>
          ) : null}
        </div>
      </Toolbar>

      <div className="lexicon-chips" data-testid="lexicon-category-chips">
        {sortedCategories.map(([key, label]) => (
          <button
            key={key}
            className={`lexicon-chip${state.activeCategory === key ? ' lexicon-chip-active' : ''}`}
            onClick={() => handleCategoryClick(key)}
            data-testid={`lexicon-chip-${key}`}
            type="button"
          >
            <span className="lexicon-chip-icon" aria-hidden="true">
              {getCategoryIcon(key)}
            </span>
            <span>{label}</span>
          </button>
        ))}
      </div>
      </div>

      <div className="view-scroll lexicon-content">
        <PageContainer>
        {isLoading ? (
          <div className="lexicon-loading" data-testid="lexicon-loading">
            Loading lexicon…
          </div>
        ) : state.error ? (
          <Panel testId="lexicon-error-panel" title="Error">
            <p className="state-message state-error" role="alert">
              {state.error}
            </p>
          </Panel>
        ) : showSearchResults ? (
          <LexiconSearchResults
            entries={state.entries}
            query={state.query}
            total={state.total}
            activeCategory={state.activeCategory}
            onClearSearch={handleSearchClear}
            onClearCategory={handleClearCategory}
            onCategoryClick={handleCategoryClick}
          />
        ) : showCategoryBrowse ? (
          <LexiconBrowseCategories
            categories={sortedCategories}
            onCategoryClick={handleCategoryClick}
          />
        ) : showCategoryTerms ? (
          <LexiconCategoryTerms
            entries={state.entries}
            categoryLabel={state.categories[state.activeCategory] || state.activeCategory}
            categoryKey={state.activeCategory}
            onTermSearch={(term) => {
              setSearchInput(term);
              triggerSearch(term);
              lexiconStore.setActiveCategory('');
            }}
          />
        ) : null}
        </PageContainer>
      </div>
    </section>
  );
}

function LexiconSearchResults({
  entries,
  query,
  total,
  activeCategory,
  onClearSearch,
  onClearCategory,
  onCategoryClick,
}: {
  entries: import('../../lib/api/lexicon').LexiconEntry[];
  query: string;
  total: number;
  activeCategory: string;
  onClearSearch: () => void;
  onClearCategory: () => void;
  onCategoryClick: (category: string) => void;
}) {
  return (
    <div data-testid="lexicon-search-results">
      <p className="lexicon-summary">
        {entries.length > 0 ? (
          <>
            {entries.length} result{entries.length !== 1 ? 's' : ''} for "<strong>{query}</strong>"
            {activeCategory ? (
              <>
                {' '}in category <strong>{activeCategory}</strong>{' '}
                <button
                  className="lexicon-inline-link"
                  onClick={onClearCategory}
                  type="button"
                >
                  (clear)
                </button>
              </>
            ) : null}
          </>
        ) : (
          <>
            No results for "<strong>{query}</strong>"
            {activeCategory ? (
              <>
                {' '}in category <strong>{activeCategory}</strong>
              </>
            ) : null}
            .{' '}
            <button
              className="lexicon-inline-link"
              onClick={onClearSearch}
              type="button"
            >
              Clear search
            </button>
            {activeCategory ? (
              <>
                {' '}or{' '}
                <button
                  className="lexicon-inline-link"
                  onClick={onClearCategory}
                  type="button"
                >
                  clear category filter
                </button>
              </>
            ) : null}
          </>
        )}
      </p>

      {entries.length > 0 ? (
        <ul className="lexicon-result-list" data-testid="lexicon-result-list">
          {entries.map((entry, idx) => (
            <li key={`${entry.term}-${idx}`} className="lexicon-result-item">
              <div className="lexicon-result-header">
                <span className="lexicon-result-term">
                  {highlightTerm(entry.term, query)}
                </span>
                <span className="lexicon-result-category">
                  <button
                    className="lexicon-inline-link"
                    onClick={() => onCategoryClick(entry.file)}
                    type="button"
                  >
                    {entry.categoryLabel}
                  </button>
                </span>
              </div>

              {entry.definition ? (
                <p className="lexicon-result-definition">
                  {highlightTerm(truncate(entry.definition, 180), query)}
                </p>
              ) : null}

              {entry.tags.length > 0 ? (
                <div className="lexicon-tag-row">
                  {entry.tags.map((tag) => (
                    <span
                      key={tag}
                      className={`lexicon-tag ${highlightTerm(tag, query) !== tag ? 'lexicon-tag-highlighted' : ''}`}
                    >
                      {highlightTerm(tag, query)}
                    </span>
                  ))}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="state-message">Try a different search term or browse by category above.</p>
      )}
    </div>
  );
}

function LexiconBrowseCategories({
  categories,
  onCategoryClick,
}: {
  categories: [string, string][];
  onCategoryClick: (category: string) => void;
}) {
  return (
    <Panel testId="lexicon-browse-panel" title="Browse by category">
      <div className="lexicon-category-grid" data-testid="lexicon-category-grid">
        {categories.map(([key, label]) => (
          <button
            key={key}
            className="lexicon-category-card"
            onClick={() => onCategoryClick(key)}
            data-testid={`lexicon-category-card-${key}`}
            type="button"
          >
            <span className="lexicon-category-card-icon" aria-hidden="true">
              {getCategoryIcon(key)}
            </span>
            <span className="lexicon-category-card-label">{label}</span>
          </button>
        ))}
      </div>
    </Panel>
  );
}

function LexiconCategoryTerms({
  entries,
  categoryLabel,
  categoryKey,
  onTermSearch,
}: {
  entries: import('../../lib/api/lexicon').LexiconEntry[];
  categoryLabel: string;
  categoryKey: string;
  onTermSearch: (term: string) => void;
}) {
  const sorted = useMemo(
    () => [...entries].sort((a, b) => a.term.localeCompare(b.term)),
    [entries],
  );

  if (sorted.length === 0) {
    return (
      <Panel testId="lexicon-category-panel" title={categoryLabel}>
        <p className="state-message">
          No terms found in {categoryLabel}. Check back after the lexicon is updated.
        </p>
      </Panel>
    );
  }

  return (
    <Panel
      testId="lexicon-category-panel"
      title={categoryLabel}
      subtitle={`${sorted.length} term${sorted.length !== 1 ? 's' : ''}`}
    >
      <ul className="lexicon-category-term-list" data-testid="lexicon-category-term-list">
        {sorted.map((entry, idx) => (
          <li key={`${entry.term}-${idx}`} className="lexicon-category-term-item">
            <button
              className="lexicon-term-link"
              onClick={() => onTermSearch(entry.term)}
              type="button"
            >
              {entry.term}
            </button>
            {entry.definition ? (
              <p className="lexicon-term-definition">{truncate(entry.definition, 120)}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
