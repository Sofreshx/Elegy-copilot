import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import React from 'react';

// ─── Mock the API module (hoisted before imports) ───
vi.mock('../../lib/api/patternAtlas', () => ({
  getPatternAtlas: vi.fn(),
}));

import { getPatternAtlas as _getPatternAtlas } from '../../lib/api/patternAtlas';
const getPatternAtlas = _getPatternAtlas as Mock;
import { patternAtlasStore } from './patternAtlasStore';
import PatternAtlasView from './PatternAtlasView';

// ─── Mock Data ────────────────────────────────────────────────────

const MOCK_ENTRIES = [
  {
    id: 'glassmorphism',
    name: 'Glassmorphism',
    aliases: ['frosted glass', 'glass UI'],
    type: 'Visual Style',
    domain: 'Visual Style',
    confidence: 'Emerging',
    tagline: 'Frosted glass transparency with blur effects',
    description:
      'A design trend featuring translucent panels with background blur.\nCommon in modern dashboards.',
    traits: ['Translucency', 'Background blur', 'Layered depth', 'Vibrant backgrounds', 'Subtle borders'],
    bestFit: ['Modern SaaS dashboards', 'Card-based layouts'],
    avoidIf: ['High-density data tables', 'Low-contrast environments'],
    commonFailures: ['Over-blurring content', 'Insufficient contrast'],
    contrasts: [
      {
        term: 'Neumorphism',
        difference:
          'Glassmorphism uses transparency and blur, while neumorphism uses soft shadows.',
      },
    ],
    compatibilities: [{ entryId: 'minimalism', name: 'Minimalism' }],
    promptLanguage:
      'Design a UI using glassmorphism with frosted glass panels and backdrop blur.',
    styleRecipe:
      'background: rgba(255, 255, 255, 0.15);\nbackdrop-filter: blur(10px);',
    sources: [{ label: 'Material Design 3', url: 'https://m3.material.io' }],
    tags: ['glass', 'transparency', 'blur', 'modern'],
  },
  {
    id: 'minimalism',
    name: 'Minimalism',
    aliases: ['minimal design', 'less is more'],
    type: 'Visual Style',
    domain: 'Visual Style',
    confidence: 'Established',
    tagline: 'Reduce to the essentials',
    description: 'A design philosophy focused on simplicity and removing unnecessary elements.',
    traits: ['Simplicity', 'White space', 'Limited color palette', 'Clear hierarchy'],
    bestFit: ['Content-focused sites', 'Portfolio designs'],
    avoidIf: ['Feature-rich applications', 'Gaming UIs'],
    commonFailures: ['Being too bare', 'Lack of visual interest'],
    contrasts: [],
    compatibilities: [],
    promptLanguage:
      'Design a minimal interface with ample whitespace and simple typography.',
    sources: [],
    tags: ['minimal', 'simple', 'clean'],
  },
  {
    id: 'command-palette',
    name: 'Command Palette',
    aliases: ['cmd-k', 'quick search'],
    type: 'UX Pattern',
    domain: 'UI/UX',
    confidence: 'Established',
    tagline: 'Keyboard-first command interface',
    description:
      'A searchable interface element that surfaces commands and actions.',
    traits: ['Keyboard shortcut', 'Searchable', 'Contextual results'],
    bestFit: ['Power user tools', 'IDEs', 'Productivity apps'],
    avoidIf: ['Simple linear workflows', 'Touch-first mobile apps'],
    commonFailures: ['Slow search', 'Too many results', 'No keyboard shortcuts'],
    contrasts: [
      {
        term: 'Traditional menus',
        difference:
          'Command palette is searchable and keyboard-first, while menus are visual and mouse-first.',
      },
    ],
    compatibilities: [{ entryId: 'glassmorphism', name: 'Glassmorphism' }],
    promptLanguage:
      'Implement a command palette that opens with Cmd+K and allows searching through available commands.',
    sources: [{ label: 'VS Code Docs', url: 'https://code.visualstudio.com/docs' }],
    tags: ['keyboard', 'search', 'commands', 'productivity'],
  },
];

const MOCK_RESPONSE = {
  entries: MOCK_ENTRIES,
  total: 3,
  filteredTotal: 3,
  filters: {
    types: ['visual-style', 'ux-pattern'],
    domains: ['visual-style', 'ui-ux'],
    tags: ['glass', 'minimal', 'simple', 'keyboard'],
  },
};

// ─────────────────────────────────────────────────────────────────
//  A. Store Tests — pure logic, no DOM
// ─────────────────────────────────────────────────────────────────

describe('patternAtlasStore', () => {
  beforeEach(() => {
    patternAtlasStore.reset();
    vi.clearAllMocks();
  });

  it('starts with empty state', () => {
    const state = patternAtlasStore.getState();
    expect(state.entries).toEqual([]);
    expect(state.total).toBe(0);
    expect(state.filteredTotal).toBe(0);
    expect(state.loading).toBe(true);
    expect(state.error).toBeNull();
    expect(state.searchQuery).toBe('');
    expect(state.activeType).toBe('');
    expect(state.activeDomain).toBe('');
    expect(state.activeConfidence).toBe('');
    expect(state.selectedEntryId).toBeNull();
    expect(state.filters).toEqual({ types: [], domains: [], tags: [] });
  });

  it('load() fetches and populates entries', async () => {
    getPatternAtlas.mockResolvedValue(MOCK_RESPONSE);
    await patternAtlasStore.load();

    const state = patternAtlasStore.getState();
    expect(state.entries).toHaveLength(3);
    expect(state.total).toBe(3);
    expect(state.filteredTotal).toBe(3);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
    expect(state.filters.types).toEqual(['visual-style', 'ux-pattern']);
    expect(state.filters.domains).toEqual(['visual-style', 'ui-ux']);
  });

  it('search() filters entries by query', async () => {
    getPatternAtlas.mockResolvedValue(MOCK_RESPONSE);
    await patternAtlasStore.load(); // initial load

    // Set up filtered response
    getPatternAtlas.mockResolvedValue({
      ...MOCK_RESPONSE,
      entries: [MOCK_ENTRIES[0]],
      filteredTotal: 1,
    });

    await patternAtlasStore.search('glass');

    expect(getPatternAtlas).toHaveBeenCalledWith(
      expect.objectContaining({ q: 'glass' }),
    );
    const state = patternAtlasStore.getState();
    expect(state.searchQuery).toBe('glass');
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0].id).toBe('glassmorphism');
  });

  it('setActiveType() filters by entry type', async () => {
    patternAtlasStore.setActiveType('visual-style');
    expect(patternAtlasStore.getState().activeType).toBe('visual-style');

    patternAtlasStore.setActiveType('ux-pattern');
    expect(patternAtlasStore.getState().activeType).toBe('ux-pattern');
  });

  it('setActiveDomain() filters by domain', async () => {
    patternAtlasStore.setActiveDomain('ui-ux');
    expect(patternAtlasStore.getState().activeDomain).toBe('ui-ux');

    patternAtlasStore.setActiveDomain('visual-style');
    expect(patternAtlasStore.getState().activeDomain).toBe('visual-style');
  });

  it('setActiveConfidence() filters by confidence', async () => {
    patternAtlasStore.setActiveConfidence('established');
    expect(patternAtlasStore.getState().activeConfidence).toBe('established');

    patternAtlasStore.setActiveConfidence('emerging');
    expect(patternAtlasStore.getState().activeConfidence).toBe('emerging');

    patternAtlasStore.setActiveConfidence('');
    expect(patternAtlasStore.getState().activeConfidence).toBe('');
  });

  it('clearFilters() resets all filters', () => {
    // Set up some filters
    patternAtlasStore.setActiveType('visual-style');
    patternAtlasStore.setActiveDomain('ui-ux');
    patternAtlasStore.setActiveConfidence('established');

    expect(patternAtlasStore.getState().activeType).toBe('visual-style');
    expect(patternAtlasStore.getState().activeDomain).toBe('ui-ux');
    expect(patternAtlasStore.getState().activeConfidence).toBe('established');

    patternAtlasStore.clearFilters();

    const state = patternAtlasStore.getState();
    expect(state.activeType).toBe('');
    expect(state.activeDomain).toBe('');
    expect(state.activeConfidence).toBe('');
    // Search query should be preserved (not a filter)
    expect(state.searchQuery).toBe('');
  });

  it('selectEntry() sets and clears selected entry', () => {
    patternAtlasStore.selectEntry('glassmorphism');
    expect(patternAtlasStore.getState().selectedEntryId).toBe('glassmorphism');

    patternAtlasStore.selectEntry(null);
    expect(patternAtlasStore.getState().selectedEntryId).toBeNull();
  });

  it('handles API errors gracefully', async () => {
    getPatternAtlas.mockRejectedValue(new Error('Network error'));
    await patternAtlasStore.load();

    const state = patternAtlasStore.getState();
    expect(state.entries).toEqual([]);
    expect(state.loading).toBe(false);
    expect(state.error).toBe('Network error');
  });
});

// ─────────────────────────────────────────────────────────────────
//  B. View Tests — with @testing-library/react
// ─────────────────────────────────────────────────────────────────

describe('PatternAtlasView', () => {
  beforeEach(() => {
    patternAtlasStore.reset();
  });

  it('renders the view shell', () => {
    getPatternAtlas.mockResolvedValue(MOCK_RESPONSE);
    render(<PatternAtlasView />);

    expect(screen.getByTestId('pattern-atlas-view')).toBeInTheDocument();
    expect(screen.getByTestId('atlas-toolbar')).toBeInTheDocument();
    expect(screen.getByText('Pattern Atlas')).toBeInTheDocument();
  });

  it('shows loading state when no entries', () => {
    // Keep the promise pending so loading persists
    getPatternAtlas.mockReturnValue(new Promise<never>(() => {}));
    render(<PatternAtlasView />);

    expect(screen.getByTestId('atlas-loading')).toBeInTheDocument();
    expect(screen.getByText('Loading pattern atlas…')).toBeInTheDocument();
  });

  it('shows error state when API fails', async () => {
    getPatternAtlas.mockRejectedValue(new Error('Network error'));
    render(<PatternAtlasView />);

    await waitFor(() => {
      expect(screen.getByTestId('atlas-error-panel')).toBeInTheDocument();
    });
    expect(screen.getByText('Network error')).toBeInTheDocument();
  });

  it('renders gallery cards for loaded entries', async () => {
    getPatternAtlas.mockResolvedValue(MOCK_RESPONSE);
    render(<PatternAtlasView />);

    await waitFor(() => {
      expect(screen.getByTestId('atlas-gallery-grid')).toBeInTheDocument();
    });

    // All three cards rendered
    expect(screen.getByTestId('atlas-card-glassmorphism')).toBeInTheDocument();
    expect(screen.getByTestId('atlas-card-minimalism')).toBeInTheDocument();
    expect(screen.getByTestId('atlas-card-command-palette')).toBeInTheDocument();

    // Badges rendered for first entry
    expect(screen.getByTestId('atlas-card-badge-type-glassmorphism')).toHaveTextContent('Visual Style');
    expect(screen.getByTestId('atlas-card-badge-domain-glassmorphism')).toHaveTextContent('Visual Style');
    expect(screen.getByTestId('atlas-card-badge-confidence-glassmorphism')).toHaveTextContent('Emerging');

    // Tagline truncated via truncate helper
    expect(screen.getByText(/Frosted glass transparency/)).toBeInTheDocument();
  });

  it('searches and filters entries', async () => {
    getPatternAtlas.mockResolvedValue(MOCK_RESPONSE);
    render(<PatternAtlasView />);

    await waitFor(() => {
      expect(screen.getByTestId('atlas-card-glassmorphism')).toBeInTheDocument();
    });

    // Mock a filtered search response
    getPatternAtlas.mockResolvedValue({
      ...MOCK_RESPONSE,
      entries: [MOCK_ENTRIES[0]],
      filteredTotal: 1,
    });

    fireEvent.change(screen.getByTestId('atlas-search-input'), {
      target: { value: 'glass' },
    });

    // Wait for debounce (250ms) and re-render
    await waitFor(
      () => {
        expect(getPatternAtlas).toHaveBeenCalledWith(
          expect.objectContaining({ q: 'glass' }),
        );
      },
      { timeout: 2000 },
    );

    await waitFor(() => {
      expect(screen.getByTestId('atlas-card-glassmorphism')).toBeInTheDocument();
    });

    // Filtered-out entries should not be in the DOM
    expect(screen.queryByTestId('atlas-card-minimalism')).not.toBeInTheDocument();
    expect(screen.queryByTestId('atlas-card-command-palette')).not.toBeInTheDocument();
  });

  it('opens detail panel when card is clicked', async () => {
    getPatternAtlas.mockResolvedValue(MOCK_RESPONSE);
    render(<PatternAtlasView />);

    await waitFor(() => {
      expect(screen.getByTestId('atlas-card-glassmorphism')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('atlas-card-glassmorphism'));

    await waitFor(() => {
            expect(screen.getByTestId('atlas-detail-panel')).toBeInTheDocument();
          });

    const detailPanel = screen.getByTestId('atlas-detail-panel');
    // Detail shows entry name
    expect(detailPanel).toHaveTextContent('Glassmorphism');
    // Detail badges
    expect(screen.getByTestId('atlas-detail-badge-type')).toHaveTextContent('Visual Style');
    expect(screen.getByTestId('atlas-detail-badge-domain')).toHaveTextContent('Visual Style');
    expect(screen.getByTestId('atlas-detail-badge-confidence')).toHaveTextContent('Emerging');
    // Aliases rendered
    expect(screen.getByText(/Also known as:/)).toBeInTheDocument();
    expect(screen.getByText(/frosted glass, glass UI/)).toBeInTheDocument();
  });

  it('closes detail panel on Escape key', async () => {
    getPatternAtlas.mockResolvedValue(MOCK_RESPONSE);
    render(<PatternAtlasView />);

    await waitFor(() => {
      expect(screen.getByTestId('atlas-card-glassmorphism')).toBeInTheDocument();
    });

    // Open detail panel
    fireEvent.click(screen.getByTestId('atlas-card-glassmorphism'));
    await waitFor(() => {
      expect(screen.getByTestId('atlas-detail-panel')).toBeInTheDocument();
    });

    // Press Escape on the detail panel
    fireEvent.keyDown(screen.getByTestId('atlas-detail-panel'), { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByTestId('atlas-detail-panel')).not.toBeInTheDocument();
    });

    // Store should have no selected entry
    expect(patternAtlasStore.getState().selectedEntryId).toBeNull();
  });

  it('closes detail panel via close button', async () => {
    getPatternAtlas.mockResolvedValue(MOCK_RESPONSE);
    render(<PatternAtlasView />);

    await waitFor(() => {
      expect(screen.getByTestId('atlas-card-glassmorphism')).toBeInTheDocument();
    });

    // Open detail panel
    fireEvent.click(screen.getByTestId('atlas-card-glassmorphism'));
    await waitFor(() => {
      expect(screen.getByTestId('atlas-detail-panel')).toBeInTheDocument();
    });

    // Click close button
    fireEvent.click(screen.getByTestId('atlas-detail-close'));

    await waitFor(() => {
      expect(screen.queryByTestId('atlas-detail-panel')).not.toBeInTheDocument();
    });
  });

  it('shows copy buttons for prompt language and style recipe', async () => {
    getPatternAtlas.mockResolvedValue(MOCK_RESPONSE);
    render(<PatternAtlasView />);

    await waitFor(() => {
      expect(screen.getByTestId('atlas-card-glassmorphism')).toBeInTheDocument();
    });

    // Open the entry that has promptLanguage and styleRecipe
    fireEvent.click(screen.getByTestId('atlas-card-glassmorphism'));
    await waitFor(() => {
      expect(screen.getByTestId('atlas-detail-panel')).toBeInTheDocument();
    });

    // Copy button for prompt language
    const promptCopyButton = screen.getByTestId('atlas-copy-prompt');
    expect(promptCopyButton).toBeInTheDocument();

    // Copy button for style recipe
    const recipeCopyButton = screen.getByTestId('atlas-copy-recipe');
    expect(recipeCopyButton).toBeInTheDocument();

    // Prompt language text visible
    expect(
      screen.getByText(/Design a UI using glassmorphism/),
    ).toBeInTheDocument();
  });

  it('renders compatibility links in detail panel', async () => {
    getPatternAtlas.mockResolvedValue(MOCK_RESPONSE);
    render(<PatternAtlasView />);

    await waitFor(() => {
      expect(screen.getByTestId('atlas-card-glassmorphism')).toBeInTheDocument();
    });

    // Open glassmorphism — it's compatible with minimalism
    fireEvent.click(screen.getByTestId('atlas-card-glassmorphism'));
    await waitFor(() => {
      expect(screen.getByTestId('atlas-detail-panel')).toBeInTheDocument();
    });

    const compatDetailPanel = screen.getByTestId('atlas-detail-panel');

    // Compatibility link should exist within the detail panel
    expect(
      within(compatDetailPanel).getByTestId('atlas-compat-link-minimalism'),
    ).toBeInTheDocument();
    expect(
      within(compatDetailPanel).getByText('Minimalism'),
    ).toBeInTheDocument();

    // Clicking the compatibility link navigates to that entry
    fireEvent.click(
      within(compatDetailPanel).getByTestId('atlas-compat-link-minimalism'),
    );
    await waitFor(() => {
      expect(patternAtlasStore.getState().selectedEntryId).toBe('minimalism');
    });
  });

  it('clears search on Escape key', async () => {
    getPatternAtlas.mockResolvedValue(MOCK_RESPONSE);
    render(<PatternAtlasView />);

    await waitFor(() => {
      expect(screen.getByTestId('atlas-gallery-grid')).toBeInTheDocument();
    });

    const input = screen.getByTestId('atlas-search-input') as HTMLInputElement;

    // Type in the search
    fireEvent.change(input, { target: { value: 'glass' } });
    expect(input.value).toBe('glass');

    // Press Escape to clear
    fireEvent.keyDown(input, { key: 'Escape' });

    // Input should clear immediately
    expect(input.value).toBe('');
  });

  it('renders filter chips and clicking them works', async () => {
    getPatternAtlas.mockResolvedValue(MOCK_RESPONSE);
    render(<PatternAtlasView />);

    await waitFor(() => {
      expect(screen.getByTestId('atlas-filter-bar')).toBeInTheDocument();
    });

    // Type filter chips
    expect(screen.getByTestId('atlas-filter-type-All')).toBeInTheDocument();
    expect(
      screen.getByTestId('atlas-filter-type-Visual Style'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('atlas-filter-type-UX Pattern'),
    ).toBeInTheDocument();

    // Domain filter chips
    expect(screen.getByTestId('atlas-filter-domain-All')).toBeInTheDocument();
    expect(
      screen.getByTestId('atlas-filter-domain-UI/UX'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('atlas-filter-domain-Visual Style'),
    ).toBeInTheDocument();

    // Confidence filter chips — all three always shown
    expect(
      screen.getByTestId('atlas-filter-confidence-All'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('atlas-filter-confidence-Established'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('atlas-filter-confidence-Emerging'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('atlas-filter-confidence-Descriptive'),
    ).toBeInTheDocument();

    // Click a type filter and verify API is called
    getPatternAtlas.mockClear();
    getPatternAtlas.mockResolvedValue({
      ...MOCK_RESPONSE,
      entries: MOCK_ENTRIES.filter((e) => e.type === 'Visual Style'),
      filteredTotal: 2,
    });

    fireEvent.click(screen.getByTestId('atlas-filter-type-Visual Style'));

    await waitFor(() => {
      expect(getPatternAtlas).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'visual-style' }),
      );
    }, { timeout: 2000 });

    // Click a domain filter
    getPatternAtlas.mockClear();
    getPatternAtlas.mockResolvedValue({
      ...MOCK_RESPONSE,
      entries: MOCK_ENTRIES.filter((e) => e.domain === 'UI/UX'),
      filteredTotal: 1,
    });

    fireEvent.click(screen.getByTestId('atlas-filter-domain-UI/UX'));

    await waitFor(() => {
      expect(getPatternAtlas).toHaveBeenCalledWith(
        expect.objectContaining({ domain: 'ui-ux' }),
      );
    }, { timeout: 2000 });
  });

  it('renders "No patterns match" message when empty with active filters', async () => {
    getPatternAtlas.mockResolvedValue(MOCK_RESPONSE);
    render(<PatternAtlasView />);

    await waitFor(() => {
      expect(screen.getByTestId('atlas-gallery-grid')).toBeInTheDocument();
    });

    // Simulate a filtered response with zero results
    getPatternAtlas.mockResolvedValue({
      entries: [],
      total: 0,
      filteredTotal: 0,
      filters: { types: ['visual-style'], domains: ['visual-style'], tags: [] },
    });

    // Trigger a search to make filters active
    fireEvent.change(screen.getByTestId('atlas-search-input'), {
      target: { value: 'nonexistent' },
    });

    await waitFor(
      () => {
        expect(screen.getByTestId('atlas-gallery-empty')).toBeInTheDocument();
      },
      { timeout: 2000 },
    );

    expect(
      screen.getByText(
        'No patterns match your current filters. Try adjusting your search or filters.',
      ),
    ).toBeInTheDocument();
  });

  it('renders sources list in detail panel when available', async () => {
    getPatternAtlas.mockResolvedValue(MOCK_RESPONSE);
    render(<PatternAtlasView />);

    await waitFor(() => {
      expect(screen.getByTestId('atlas-card-glassmorphism')).toBeInTheDocument();
    });

    // Open glassmorphism — has sources
    fireEvent.click(screen.getByTestId('atlas-card-glassmorphism'));
    await waitFor(() => {
      expect(screen.getByTestId('atlas-detail-panel')).toBeInTheDocument();
    });

    // Sources section visible
    expect(screen.getByText('Sources')).toBeInTheDocument();
    const sourceLink = screen.getByText('Material Design 3') as HTMLAnchorElement;
    expect(sourceLink).toBeInTheDocument();
    expect(sourceLink.href).toBe('https://m3.material.io/');
  });

  it('renders contrasts section in detail panel when available', async () => {
    getPatternAtlas.mockResolvedValue(MOCK_RESPONSE);
    render(<PatternAtlasView />);

    await waitFor(() => {
      expect(screen.getByTestId('atlas-card-command-palette')).toBeInTheDocument();
    });

    // Open command-palette — has contrasts
    fireEvent.click(screen.getByTestId('atlas-card-command-palette'));
    await waitFor(() => {
      expect(screen.getByTestId('atlas-detail-panel')).toBeInTheDocument();
    });

    expect(screen.getByText('Contrasts')).toBeInTheDocument();
    expect(screen.getByText(/Traditional menus/)).toBeInTheDocument();
  });

  it('does not show detail panel when no entry selected', async () => {
    getPatternAtlas.mockResolvedValue(MOCK_RESPONSE);
    render(<PatternAtlasView />);

    await waitFor(() => {
      expect(screen.getByTestId('atlas-gallery-grid')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('atlas-detail-panel')).not.toBeInTheDocument();
  });
});
