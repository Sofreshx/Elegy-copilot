import { getInstalledAssets, getManagedAssets } from '../../lib/api';
import { createStore } from '../../lib/store';
import type { InstalledAssetsResponse, ManagedAssetStatus } from '../../lib/types';

const EMPTY_INSTALLED_INVENTORY: InstalledAssetsResponse = {
  agents: [],
  skills: [],
  prompts: [],
  instructions: {
    installed: false,
    absPath: '',
  },
};

export interface AssetsState {
  managedAssets: ManagedAssetStatus[];
  installedInventory: InstalledAssetsResponse;
  loading: boolean;
  error: string | null;
  selectedAssetId: string | null;
  selectedAssetPath: string | null;
}

const INITIAL_STATE: AssetsState = {
  managedAssets: [],
  installedInventory: EMPTY_INSTALLED_INVENTORY,
  loading: false,
  error: null,
  selectedAssetId: null,
  selectedAssetPath: null,
};

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return 'Unable to load assets.';
}

function ensureInventory(input: Partial<InstalledAssetsResponse> | null | undefined): InstalledAssetsResponse {
  return {
    agents: Array.isArray(input?.agents) ? input.agents : [],
    skills: Array.isArray(input?.skills) ? input.skills : [],
    prompts: Array.isArray(input?.prompts) ? input.prompts : [],
    instructions:
      input?.instructions && typeof input.instructions === 'object'
        ? {
            installed: Boolean(input.instructions.installed),
            absPath:
              typeof input.instructions.absPath === 'string' ? input.instructions.absPath : '',
          }
        : {
            installed: false,
            absPath: '',
          },
  };
}

function readPrimaryManagedPath(asset: ManagedAssetStatus): string | null {
  const candidates = [asset.destinationAbs, asset.destination, asset.sourceAbs, asset.source];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate;
    }
  }

  return null;
}

function collectInstalledPaths(inventory: InstalledAssetsResponse): Set<string> {
  const paths = new Set<string>();

  const registerPath = (candidate: unknown): void => {
    if (typeof candidate === 'string' && candidate.trim()) {
      paths.add(candidate);
    }
  };

  for (const agent of inventory.agents) {
    registerPath(agent.absPath);
  }

  for (const skill of inventory.skills) {
    registerPath(skill.absPath);
  }

  for (const prompt of inventory.prompts) {
    registerPath(prompt.absPath);
  }

  if (inventory.instructions.installed) {
    registerPath(inventory.instructions.absPath);
  }

  return paths;
}

function resolveFallbackSelection(
  managedAssets: ManagedAssetStatus[],
  inventory: InstalledAssetsResponse
): { selectedAssetId: string | null; selectedAssetPath: string | null } {
  const firstManaged = managedAssets[0];
  if (firstManaged) {
    return {
      selectedAssetId: firstManaged.id,
      selectedAssetPath: readPrimaryManagedPath(firstManaged),
    };
  }

  const installedPaths = collectInstalledPaths(inventory);
  const firstInstalledPath = installedPaths.values().next().value ?? null;

  return {
    selectedAssetId: null,
    selectedAssetPath: firstInstalledPath,
  };
}

function createAssetsStore() {
  const store = createStore<AssetsState>(INITIAL_STATE);
  let requestVersion = 0;

  async function loadAssets(): Promise<void> {
    const nextVersion = ++requestVersion;

    store.setState((state) => ({
      ...state,
      loading: true,
      error: null,
    }));

    try {
      const [managedResponse, installedResponse] = await Promise.all([
        getManagedAssets(),
        getInstalledAssets(),
      ]);

      const managedAssets = Array.isArray(managedResponse.managed) ? managedResponse.managed : [];
      const installedInventory = ensureInventory(installedResponse);

      store.setState((state) => {
        if (nextVersion !== requestVersion) {
          return state;
        }

        const managedIds = new Set(managedAssets.map((asset) => asset.id));
        const managedPaths = new Set(
          managedAssets
            .map((asset) => readPrimaryManagedPath(asset))
            .filter((path): path is string => typeof path === 'string' && path.length > 0)
        );
        const installedPaths = collectInstalledPaths(installedInventory);

        let selectedAssetId =
          state.selectedAssetId && managedIds.has(state.selectedAssetId) ? state.selectedAssetId : null;

        let selectedAssetPath =
          state.selectedAssetPath && (installedPaths.has(state.selectedAssetPath) || managedPaths.has(state.selectedAssetPath))
            ? state.selectedAssetPath
            : null;

        if (selectedAssetId && !selectedAssetPath) {
          const managedSelection = managedAssets.find((asset) => asset.id === selectedAssetId) ?? null;
          selectedAssetPath = managedSelection ? readPrimaryManagedPath(managedSelection) : null;
        }

        if (!selectedAssetId && selectedAssetPath) {
          const managedSelection =
            managedAssets.find((asset) => readPrimaryManagedPath(asset) === selectedAssetPath) ?? null;
          selectedAssetId = managedSelection?.id ?? null;
        }

        if (!selectedAssetId && !selectedAssetPath) {
          const fallback = resolveFallbackSelection(managedAssets, installedInventory);
          selectedAssetId = fallback.selectedAssetId;
          selectedAssetPath = fallback.selectedAssetPath;
        }

        return {
          managedAssets,
          installedInventory,
          loading: false,
          error: null,
          selectedAssetId,
          selectedAssetPath,
        };
      });
    } catch (error) {
      const message = toErrorMessage(error);

      store.setState((state) => {
        if (nextVersion !== requestVersion) {
          return state;
        }

        return {
          ...state,
          loading: false,
          error: message,
        };
      });
    }
  }

  function selectManagedAsset(assetId: string): void {
    store.setState((state) => {
      const selectedAsset = state.managedAssets.find((asset) => asset.id === assetId) ?? null;

      return {
        ...state,
        selectedAssetId: selectedAsset?.id ?? null,
        selectedAssetPath: selectedAsset ? readPrimaryManagedPath(selectedAsset) : state.selectedAssetPath,
      };
    });
  }

  function selectInstalledAsset(assetPath: string): void {
    store.setState((state) => {
      if (!assetPath.trim()) {
        return state;
      }

      const selectedManagedAsset =
        state.managedAssets.find((asset) => readPrimaryManagedPath(asset) === assetPath) ?? null;

      return {
        ...state,
        selectedAssetId: selectedManagedAsset?.id ?? null,
        selectedAssetPath: assetPath,
      };
    });
  }

  function refresh(): Promise<void> {
    return loadAssets();
  }

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    loadAssets,
    refresh,
    selectManagedAsset,
    selectInstalledAsset,
  };
}

export const assetsStore = createAssetsStore();
