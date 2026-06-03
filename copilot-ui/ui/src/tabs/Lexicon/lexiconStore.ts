import { createStore, useStoreValue } from '../../lib/store';
import { getLexicon, type LexiconEntry, type LexiconResponse } from '../../lib/api/lexicon';

export interface LexiconState {
  entries: LexiconEntry[];
  total: number;
  categories: Record<string, string>;
  loading: boolean;
  error: string | null;
  query: string;
  activeCategory: string;
}

const initialState: LexiconState = {
  entries: [],
  total: 0,
  categories: {},
  loading: true,
  error: null,
  query: '',
  activeCategory: '',
};

function createLexiconStore() {
  const store = createStore<LexiconState>(initialState);

  async function load() {
    store.setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const state = store.getState();
      const response = await getLexicon(
        state.query || undefined,
        state.activeCategory || undefined,
      );
      store.setState((s) => ({
        ...s,
        entries: response.entries,
        total: response.total,
        categories: response.categories,
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

  function setQuery(query: string) {
    store.setState((s) => ({ ...s, query }));
  }

  function setActiveCategory(category: string) {
    store.setState((s) => ({ ...s, activeCategory: category }));
  }

  async function search() {
    await load();
  }

  function reset() {
    store.setState(initialState);
  }

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    load,
    setQuery,
    setActiveCategory,
    search,
    reset,
  };
}

export const lexiconStore = createLexiconStore();
