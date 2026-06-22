import { createStore } from '../../lib/store';
import {
  getPatternAtlas,
  type PatternAtlasEntry,
  type PatternAtlasFilters,
  type PatternAtlasResponse,
} from '../../lib/api/patternAtlas';

/**
 * Extended entry type matching DetailPanel's full field set.
 * Fields not guaranteed by the API are optional.
 */
export interface AtlasEntryDetail extends PatternAtlasEntry {
  image?: string;
  bestFit?: string[];
  avoidIf?: string[];
  commonFailures?: string[];
  contrasts?: Array<{ term: string; difference: string }>;
  compatibilities?: Array<{ entryId: string; name: string }>;
  promptLanguage?: string;
  styleRecipe?: string;
  sources?: Array<{ label: string; url: string }>;
}

export interface PatternAtlasState {
  entries: AtlasEntryDetail[];
  total: number;
  filteredTotal: number;
  filters: { types: string[]; domains: string[]; tags: string[] };
  activeType: string;
  activeDomain: string;
  activeConfidence: string;
  searchQuery: string;
  selectedEntryId: string | null;
  loading: boolean;
  error: string | null;
}

const initialState: PatternAtlasState = {
  entries: [],
  total: 0,
  filteredTotal: 0,
  filters: { types: [], domains: [], tags: [] },
  activeType: '',
  activeDomain: '',
  activeConfidence: '',
  searchQuery: '',
  selectedEntryId: null,
  loading: true,
  error: null,
};

function createPatternAtlasStore() {
  const store = createStore<PatternAtlasState>(initialState);

  async function load() {
    store.setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const state = store.getState();
      const response = await getPatternAtlas({
        q: state.searchQuery || undefined,
        type: state.activeType || undefined,
        domain: state.activeDomain || undefined,
        confidence: state.activeConfidence || undefined,
      });
      store.setState((s) => ({
        ...s,
        entries: response.entries as AtlasEntryDetail[],
        total: response.total,
        filteredTotal: response.filteredTotal,
        filters: response.filters,
        loading: false,
        error: null,
      }));
    } catch (error) {
      store.setState((s) => ({
        ...s,
        entries: [],
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  function setSearchQuery(query: string) {
    store.setState((s) => ({ ...s, searchQuery: query }));
  }

  function setActiveType(type: string) {
    store.setState((s) => ({ ...s, activeType: type }));
  }

  function setActiveDomain(domain: string) {
    store.setState((s) => ({ ...s, activeDomain: domain }));
  }

  function setActiveConfidence(confidence: string) {
    store.setState((s) => ({ ...s, activeConfidence: confidence }));
  }

  function selectEntry(entryId: string | null) {
    store.setState((s) => ({ ...s, selectedEntryId: entryId }));
  }

  function clearFilters() {
    store.setState((s) => ({
      ...s,
      activeType: '',
      activeDomain: '',
      activeConfidence: '',
    }));
  }

  async function search(query?: string) {
    if (query !== undefined) {
      store.setState((s) => ({ ...s, searchQuery: query }));
    }
    await load();
  }

  function reset() {
    store.setState(initialState);
  }

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    load,
    setSearchQuery,
    setActiveType,
    setActiveDomain,
    setActiveConfidence,
    selectEntry,
    clearFilters,
    search,
    reset,
  };
}

export const patternAtlasStore = createPatternAtlasStore();
