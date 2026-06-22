import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, CopyButton, Panel, Toolbar } from '../../components';
import { useStoreValue } from '../../lib/store';
import { patternAtlasStore, type AtlasEntryDetail } from './patternAtlasStore';

/* ── constants ──────────────────────────────────────────────────── */

const TYPE_OPTIONS = ['Visual Style', 'UI Component', 'UX Pattern', 'System Pattern'] as const;
const DOMAIN_OPTIONS = [
  'UI/UX',
  'Visual Style',
  'Software Arch',
  'Data & Integration',
  'Infra & Ops',
  'Security & Reliability',
  'AI Systems',
] as const;
const CONFIDENCE_OPTIONS = ['Established', 'Emerging', 'Descriptive'] as const;

/** Maps display labels → kebab-case API values */
const VALUE_MAP: Record<string, string> = {
  'Visual Style': 'visual-style',
  'UI Component': 'ui-component',
  'UX Pattern': 'ux-pattern',
  'System Pattern': 'system-pattern',
  'UI/UX': 'ui-ux',
  'Software Arch': 'software-architecture',
  'Data & Integration': 'data-integration',
  'Infra & Ops': 'infrastructure-ops',
  'Security & Reliability': 'security-reliability',
  'AI Systems': 'ai-systems',
  'Established': 'established',
  'Emerging': 'emerging',
  'Descriptive': 'descriptive',
};

/* ── helpers ────────────────────────────────────────────────────── */

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max) + '…';
}

function renderDescription(description: string): React.ReactNode {
  if (!description) return null;
  return description.split('\n').filter(Boolean).map((para, i) => (
    <p key={i} className="atlas-detail-para">{para}</p>
  ));
}

function renderListItems(items: string[] | undefined, label: string): React.ReactNode | null {
  if (!items || items.length === 0) return null;
  return (
    <div className="atlas-detail-section">
      <h4 className="atlas-detail-section-title">{label}</h4>
      <ul className="atlas-detail-list">
        {items.map((item, i) => (
          <li key={i} className="atlas-detail-list-item">{item}</li>
        ))}
      </ul>
    </div>
  );
}

function getEntryById(
  entries: AtlasEntryDetail[],
  id: string | null,
): AtlasEntryDetail | undefined {
  return entries.find((e) => e.id === id);
}

/* ── SearchBar ──────────────────────────────────────────────────── */

function SearchBar({
  value,
  onChange,
  onClear,
  onKeyDown,
  inputRef,
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClear: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  inputRef: React.RefObject<HTMLInputElement>;
}) {
  return (
    <div className="atlas-search-wrapper">
      <span className="atlas-search-icon" aria-hidden="true">🔍</span>
      <input
        ref={inputRef}
        className="atlas-search-input"
        type="text"
        placeholder="Search patterns, styles, components…"
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        data-testid="atlas-search-input"
        aria-label="Search pattern atlas"
      />
      {value ? (
        <button
          className="atlas-search-clear"
          onClick={onClear}
          data-testid="atlas-search-clear"
          type="button"
          aria-label="Clear search"
        >
          ✕
        </button>
      ) : null}
    </div>
  );
}

/* ── FilterBar ──────────────────────────────────────────────────── */

function FilterBar() {
  const state = useStoreValue(patternAtlasStore);

  const availableTypes = useMemo(
    () => TYPE_OPTIONS.filter((t) => state.filters.types.includes(VALUE_MAP[t] || t)),
    [state.filters.types],
  );

  const availableDomains = useMemo(
    () => DOMAIN_OPTIONS.filter((d) => state.filters.domains.includes(VALUE_MAP[d] || d)),
    [state.filters.domains],
  );

  return (
    <div className="atlas-filters" data-testid="atlas-filter-bar">
      {/* Type filters */}
      <div className="atlas-filter-group" data-testid="atlas-filter-group-type">
        <span className="atlas-filter-label">Type</span>
        <button
          className={`atlas-chip${!state.activeType ? ' atlas-chip-active' : ''}`}
          onClick={() => {
            patternAtlasStore.setActiveType('');
            patternAtlasStore.search();
          }}
          data-testid="atlas-filter-type-All"
          type="button"
        >
          All
        </button>
        {availableTypes.map((type) => (
          <button
            key={type}
            className={`atlas-chip${state.activeType === (VALUE_MAP[type] || type) ? ' atlas-chip-active' : ''}`}
            onClick={() => {
              patternAtlasStore.setActiveType(VALUE_MAP[type] || type);
              patternAtlasStore.search();
            }}
            data-testid={`atlas-filter-type-${type}`}
            type="button"
          >
            {type}
          </button>
        ))}
      </div>

      {/* Domain filters */}
      <div className="atlas-filter-group" data-testid="atlas-filter-group-domain">
        <span className="atlas-filter-label">Domain</span>
        <button
          className={`atlas-chip${!state.activeDomain ? ' atlas-chip-active' : ''}`}
          onClick={() => {
            patternAtlasStore.setActiveDomain('');
            patternAtlasStore.search();
          }}
          data-testid="atlas-filter-domain-All"
          type="button"
        >
          All
        </button>
        {availableDomains.map((domain) => (
          <button
            key={domain}
            className={`atlas-chip${state.activeDomain === (VALUE_MAP[domain] || domain) ? ' atlas-chip-active' : ''}`}
            onClick={() => {
              patternAtlasStore.setActiveDomain(VALUE_MAP[domain] || domain);
              patternAtlasStore.search();
            }}
            data-testid={`atlas-filter-domain-${domain}`}
            type="button"
          >
            {domain}
          </button>
        ))}
      </div>

      {/* Confidence filters */}
      <div className="atlas-filter-group" data-testid="atlas-filter-group-confidence">
        <span className="atlas-filter-label">Confidence</span>
        <button
          className={`atlas-chip${!state.activeConfidence ? ' atlas-chip-active' : ''}`}
          onClick={() => {
            patternAtlasStore.setActiveConfidence('');
            patternAtlasStore.search();
          }}
          data-testid="atlas-filter-confidence-All"
          type="button"
        >
          All
        </button>
        {CONFIDENCE_OPTIONS.map((confidence) => (
          <button
            key={confidence}
            className={`atlas-chip${state.activeConfidence === (VALUE_MAP[confidence] || confidence) ? ' atlas-chip-active' : ''}`}
            onClick={() => {
              patternAtlasStore.setActiveConfidence(VALUE_MAP[confidence] || confidence);
              patternAtlasStore.search();
            }}
            data-testid={`atlas-filter-confidence-${confidence}`}
            type="button"
          >
            {confidence}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── GalleryGrid ────────────────────────────────────────────────── */

function GalleryGrid() {
  const state = useStoreValue(patternAtlasStore);

  const handleCardClick = useCallback(
    (entryId: string) => {
      patternAtlasStore.selectEntry(
        state.selectedEntryId === entryId ? null : entryId,
      );
    },
    [state.selectedEntryId],
  );

  if (state.entries.length === 0) {
    return (
      <div className="atlas-empty" data-testid="atlas-gallery-empty">
        <p className="state-message">
          {state.searchQuery || state.activeType || state.activeDomain || state.activeConfidence
            ? 'No patterns match your current filters. Try adjusting your search or filters.'
            : 'No patterns available.'}
        </p>
      </div>
    );
  }

  return (
    <div className="atlas-gallery" data-testid="atlas-gallery-grid">
      {state.entries.map((entry) => (
        <button
          key={entry.id}
          className={`atlas-card${state.selectedEntryId === entry.id ? ' atlas-card-selected' : ''}`}
          onClick={() => handleCardClick(entry.id)}
          data-testid={`atlas-card-${entry.id}`}
          type="button"
          aria-label={`View details for ${entry.name}`}
        >
          <div className="atlas-card-footer">
            <Badge tone="accent" testId={`atlas-card-badge-type-${entry.id}`}>
              {entry.type}
            </Badge>
          </div>

          <h3 className="atlas-card-name">{entry.name}</h3>

          {entry.tagline ? (
            <p className="atlas-card-tagline">{truncate(entry.tagline, 100)}</p>
          ) : null}

          <div className="atlas-card-footer">
            <Badge tone="brand" testId={`atlas-card-badge-domain-${entry.id}`}>
              {entry.domain}
            </Badge>
            <Badge tone="neutral" testId={`atlas-card-badge-confidence-${entry.id}`}>
              {entry.confidence}
            </Badge>
          </div>
        </button>
      ))}
    </div>
  );
}

/* ── DetailPanel ─────────────────────────────────────────────────── */

function DetailPanel({ entry }: { entry: AtlasEntryDetail }) {
  const handleClose = useCallback(() => {
    patternAtlasStore.selectEntry(null);
  }, []);

  const handleCompatibilityClick = useCallback(
    (entryId: string) => {
      patternAtlasStore.selectEntry(entryId);
    },
    [],
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleClose]);

  return (
    <div
      className="atlas-detail-panel"
      data-testid="atlas-detail-panel"
      role="complementary"
      aria-label={`Detail panel for ${entry.name}`}
    >
      <div className="atlas-detail-header">
        <h2 className="atlas-detail-name">{entry.name}</h2>
        <button
          className="atlas-detail-close"
          onClick={handleClose}
          data-testid="atlas-detail-close"
          type="button"
          aria-label="Close detail panel"
        >
          ✕
        </button>
      </div>

      <div className="atlas-detail-badges">
        <Badge tone="accent" testId="atlas-detail-badge-type">{entry.type}</Badge>
        <Badge tone="brand" testId="atlas-detail-badge-domain">{entry.domain}</Badge>
        <Badge tone="neutral" testId="atlas-detail-badge-confidence">{entry.confidence}</Badge>
      </div>

      {entry.aliases && entry.aliases.length > 0 ? (
        <p className="atlas-detail-aliases">
          <strong>Also known as:</strong> {entry.aliases.join(', ')}
        </p>
      ) : null}

      {entry.tagline ? (
        <p className="atlas-detail-tagline">{entry.tagline}</p>
      ) : null}

      <div className="atlas-detail-body">
        {entry.description ? (
          <div className="atlas-detail-section">
            <h4 className="atlas-detail-section-title">Description</h4>
            {renderDescription(entry.description)}
          </div>
        ) : null}

        {renderListItems(entry.traits, 'Traits')}

        {renderListItems(entry.bestFit, 'Best Fit')}

        {renderListItems(entry.avoidIf, 'Avoid If')}

        {renderListItems(entry.commonFailures, 'Common Failures')}

        {/* Contrasts */}
        {entry.contrasts && entry.contrasts.length > 0 ? (
          <div className="atlas-detail-section">
            <h4 className="atlas-detail-section-title">Contrasts</h4>
            <ul className="atlas-detail-list">
              {entry.contrasts.map((c, i) => (
                <li key={i} className="atlas-detail-list-item">
                  <strong>{c.term}</strong> — {c.difference}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* Compatibilities */}
        {entry.compatibilities && entry.compatibilities.length > 0 ? (
          <div className="atlas-detail-section">
            <h4 className="atlas-detail-section-title">Compatible With</h4>
            <ul className="atlas-detail-list">
              {entry.compatibilities.map((comp, i) => (
                <li key={i} className="atlas-detail-list-item">
                  <button
                    className="atlas-detail-compat"
                    onClick={() => handleCompatibilityClick(comp.entryId)}
                    data-testid={`atlas-compat-link-${comp.entryId}`}
                    type="button"
                    aria-label={`Navigate to ${comp.name}`}
                  >
                    {comp.name}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* Prompt Language */}
        {entry.promptLanguage ? (
          <div className="atlas-detail-section">
            <div className="atlas-detail-section-header">
              <h4 className="atlas-detail-section-title">Prompt Language</h4>
              <CopyButton text={entry.promptLanguage} testId="atlas-copy-prompt" />
            </div>
            <pre className="atlas-detail-prompt">{entry.promptLanguage}</pre>
          </div>
        ) : null}

        {/* Style Recipe */}
        {entry.styleRecipe ? (
          <div className="atlas-detail-section">
            <div className="atlas-detail-section-header">
              <h4 className="atlas-detail-section-title">Style Recipe</h4>
              <CopyButton text={entry.styleRecipe} testId="atlas-copy-recipe" />
            </div>
            <pre className="atlas-detail-prompt">{entry.styleRecipe}</pre>
          </div>
        ) : null}

        {/* Sources */}
        {entry.sources && entry.sources.length > 0 ? (
          <div className="atlas-detail-section">
            <h4 className="atlas-detail-section-title">Sources</h4>
            <ul className="atlas-detail-list">
              {entry.sources.map((src, i) => (
                <li key={i} className="atlas-detail-list-item">
                  <a
                    href={src.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {src.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* Tags */}
        {entry.tags && entry.tags.length > 0 ? (
          <div className="atlas-detail-section">
            <h4 className="atlas-detail-section-title">Tags</h4>
            <div className="atlas-detail-tags">
              {entry.tags.map((tag) => (
                <span key={tag} className="atlas-tag">{tag}</span>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ── PatternAtlasView (main export) ─────────────────────────────── */

export default function PatternAtlasView() {
  const state = useStoreValue(patternAtlasStore);
  const searchRef = useRef<HTMLInputElement>(null!);
  const [searchInput, setSearchInput] = useState('');

  const isLoading = state.loading && state.entries.length === 0;

  const selectedEntry = useMemo(
    () => getEntryById(state.entries, state.selectedEntryId),
    [state.entries, state.selectedEntryId],
  );

  const triggerSearch = useCallback((query: string) => {
    patternAtlasStore.search(query);
  }, []);

  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setSearchInput(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => triggerSearch(value), 250);
    },
    [triggerSearch],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        setSearchInput('');
        patternAtlasStore.search('');
        searchRef.current?.blur();
      }
    },
    [],
  );

  const handleSearchClear = useCallback(() => {
    setSearchInput('');
    patternAtlasStore.search('');
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    void patternAtlasStore.load();
  }, []);

  return (
    <section className="view-shell atlas-view" data-testid="pattern-atlas-view">
      <div className="view-static">
        <Toolbar testId="atlas-toolbar">
          <h2>Pattern Atlas</h2>
          <SearchBar
            value={searchInput}
            onChange={handleSearchChange}
            onClear={handleSearchClear}
            onKeyDown={handleKeyDown}
            inputRef={searchRef}
          />
        </Toolbar>

        <FilterBar />
      </div>

      <div className="atlas-content view-scroll">
        {isLoading ? (
          <div className="atlas-loading" data-testid="atlas-loading">
            Loading pattern atlas…
          </div>
        ) : state.error ? (
          <Panel testId="atlas-error-panel" title="Error">
            <p className="state-message state-error" role="alert">
              {state.error}
            </p>
          </Panel>
        ) : (
          <>
            <GalleryGrid />
            {selectedEntry ? <DetailPanel entry={selectedEntry} /> : null}
          </>
        )}
      </div>
    </section>
  );
}
