import { createStore } from '../../lib/store';
import { createCatalogAsset } from '../../lib/api/catalog';
import type { CatalogAssetCreatePayload } from '../../lib/api/core';

export interface AssetCreationState {
  step: number;
  kind: 'agent' | 'skill';
  authoringScope: 'shared' | 'user-global' | 'repo-local';
  repoPath: string;
  assetKey: string;
  title: string;
  description: string;
  content: string;
  loadMode: 'always' | 'on-demand';
  triggersOn: string;
  creating: boolean;
  createError: string | null;
  created: boolean;
}

const INITIAL_STATE: AssetCreationState = {
  step: 0,
  kind: 'agent',
  authoringScope: 'user-global',
  repoPath: '',
  assetKey: '',
  title: '',
  description: '',
  content: '',
  loadMode: 'on-demand',
  triggersOn: '',
  creating: false,
  createError: null,
  created: false,
};

function toKebabCase(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function createAssetCreationStore() {
  const store = createStore<AssetCreationState>(INITIAL_STATE);

  function setStep(step: number): void {
    store.setState((s) => ({ ...s, step }));
  }

  function setKind(kind: AssetCreationState['kind']): void {
    store.setState((s) => ({ ...s, kind }));
  }

  function setAuthoringScope(authoringScope: AssetCreationState['authoringScope']): void {
    store.setState((s) => ({ ...s, authoringScope }));
  }

  function setRepoPath(repoPath: string): void {
    store.setState((s) => ({ ...s, repoPath }));
  }

  function setAssetKey(assetKey: string): void {
    store.setState((s) => ({ ...s, assetKey }));
  }

  function setTitle(title: string): void {
    store.setState((s) => ({
      ...s,
      title,
      assetKey: toKebabCase(title),
    }));
  }

  function setDescription(description: string): void {
    store.setState((s) => ({ ...s, description }));
  }

  function setContent(content: string): void {
    store.setState((s) => ({ ...s, content }));
  }

  function setLoadMode(loadMode: AssetCreationState['loadMode']): void {
    store.setState((s) => ({ ...s, loadMode }));
  }

  function setTriggersOn(triggersOn: string): void {
    store.setState((s) => ({ ...s, triggersOn }));
  }

  async function create(): Promise<void> {
    const state = store.getState();
    store.setState((s) => ({ ...s, creating: true, createError: null }));

    try {
      const triggersOnArray = state.triggersOn
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      const payload: CatalogAssetCreatePayload = {
        authoringScope: state.authoringScope,
        kind: state.kind,
        assetKey: state.assetKey,
        title: state.title || undefined,
        description: state.description || undefined,
        content: state.content,
        loadMode: state.kind === 'skill' ? state.loadMode : undefined,
        triggersOn: state.kind === 'skill' && triggersOnArray.length > 0 ? triggersOnArray : undefined,
        repoPath: state.authoringScope === 'repo-local' && state.repoPath ? state.repoPath : undefined,
        authoringRepoPath: state.authoringScope === 'repo-local' && state.repoPath ? state.repoPath : undefined,
      };

      await createCatalogAsset(payload);
      store.setState((s) => ({ ...s, creating: false, created: true }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      store.setState((s) => ({ ...s, creating: false, createError: message }));
    }
  }

  function reset(): void {
    store.setState(INITIAL_STATE);
  }

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    setStep,
    setKind,
    setAuthoringScope,
    setRepoPath,
    setAssetKey,
    setTitle,
    setDescription,
    setContent,
    setLoadMode,
    setTriggersOn,
    create,
    reset,
  };
}

export const assetCreationStore = createAssetCreationStore();
