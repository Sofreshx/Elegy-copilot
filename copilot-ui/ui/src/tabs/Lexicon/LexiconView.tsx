import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Panel, Toolbar } from '../../components';
import { useStoreValue } from '../../lib/store';
import { lexiconStore } from './lexiconStore';

function highlightTerm(text: string, query: string): React.ReactNode {
  if (!query?.trim() || !text) return text;

  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const lowerText = text.toLowerCase();

  if (!terms.some((t) => lowerText.includes(t))) return text;

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;

  const matches: { start: number; end: number }[] = [];
  for (const term of terms) {
    const termLower = term;
    let searchFrom = 0;
    while (searchFrom < lowerText.length) {
      const idx = lowerText.indexOf(termLower, searchFrom);
      if (idx === -1) break;
      matches.push({ start: idx, end: idx + termLower.length });
      searchFrom = idx + 1;
    }
  }

  matches.sort((a, b) => a.start - b.start);

  for (const match of matches) {
    if (match.start < lastIndex) continue;
    if (match.start > lastIndex) {
      parts.push(<span key={key++}>{text.slice(lastIndex, match.start)}</span>);
    }
    parts.push(
      <strong key={key++} className="lexicon-highlight">
        {text.slice(match.start, match.end)}
      </strong>,
    );
    lastIndex = match.end;
  }

  if (lastIndex < text.length) {
    parts.push(<span key={key++}>{text.slice(lastIndex)}</span>);
  }

  return parts;
}

const FILE_ICONS: Record<string, string> = {
  'ui': '⊞',
  'design': '◎',
  'architecture': '◈',
  'programming': '〈〉',
  'data': '⛁',
  'networking-api': '⇄',
  'infrastructure': '☁',
  'testing': '✓',
  'security': '🔒',
  'concurrency': '⚡',
  'process': '▤',
  'ai-ml': '✦',
  'project-specific': '◆',
};

function getCategoryIcon(file: string): string {
  return FILE_ICONS[file] || '◇';
}

function truncate(text: string, maxLen: number): string {
  if (!text || text.length <= maxLen) return text || '';
  return text.slice(0, maxLen).trimEnd() + '…';
}

export default function LexiconView() {
  const state = useStoreValue(lexiconStore);
  const searchRef = useRef<HTMLInputElement>(null);
  const [searchInput, setSearchInput] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const sortedCategories = useMemo(() => {
    return Object.entries(state.categories).sort(([, a], [, b]) => a.localeCompare(b));
  }, [state.categories]);

  const isLoading = state.loading;

  const browseCategories = useMemo(() => {
    if (state.query.trim() || state.activeCategory) return null;
    return sortedCategories;
  }, [sortedCategories, state.query, state.activeCategory]);

  useEffect(() => {
    void lexiconStore.load();
  }, []);

  const triggerSearch = useCallback((value: string) => {
    lexiconStore.setQuery(value);
    void lexiconStore.search();
  }, []);

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setSearchInput(value);

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        triggerSearch(value);
      }, 200);
    },
    [triggerSearch],
  );

  const handleSearchClear = useCallback(() => {
    setSearchInput('');
    triggerSearch('');
    searchRef.current?.focus();
  }, [triggerSearch]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        triggerSearch(searchInput);
      }
    },
    [searchInput, triggerSearch],
  );

  const handleCategoryClick = useCallback(
    (category: string) => {
      if (state.activeCategory === category) {
        lexiconStore.setActiveCategory('');
      } else {
        lexiconStore.setActiveCategory(category);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        triggerSearch(searchInput);
      }
    },
    [state.activeCategory, searchInput, triggerSearch],
  );

  const handleClearCategory = useCallback(() => {
    lexiconStore.setActiveCategory('');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    triggerSearch(searchInput);
  }, [searchInput, triggerSearch]);

  const showSearchResults = state.query.trim().length > 0;
  const showCategoryBrowse = !showSearchResults && !state.activeCategory;
  const showCategoryTerms = !showSearchResults && !!state.activeCategory;

  return (
    <section className="lexicon-view" data-testid="lexicon-view">
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

      <div className="lexicon-content">
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
