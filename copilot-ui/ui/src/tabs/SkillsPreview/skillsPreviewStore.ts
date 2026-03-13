import { getAssetView, getSkillsPreview } from '../../lib/api';
import { createStore } from '../../lib/store';
import type { SkillPreviewItem } from '../../lib/types';

export interface SkillsPreviewState {
  skills: SkillPreviewItem[];
  loading: boolean;
  error: string | null;
  searchQuery: string;
  selectedSkillId: string | null;
  detailLoading: boolean;
  detailError: string | null;
  detailText: string;
}

const INITIAL_STATE: SkillsPreviewState = {
  skills: [],
  loading: false,
  error: null,
  searchQuery: '',
  selectedSkillId: null,
  detailLoading: false,
  detailError: null,
  detailText: '(select a skill above)',
};

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return 'Unable to load skills preview.';
}

function normalizeSkills(input: unknown): SkillPreviewItem[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const normalized = input
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }

      const record = entry as Record<string, unknown>;
      const name = typeof record.name === 'string' ? record.name.trim() : '';
      if (!name) {
        return null;
      }

      const assetId =
        typeof record.assetId === 'string' && record.assetId.trim()
          ? record.assetId.trim()
          : `${name}:${typeof record.viewPath === 'string' ? record.viewPath : typeof record.absPath === 'string' ? record.absPath : ''}`;
      const kind = typeof record.kind === 'string' && record.kind.trim() ? record.kind : 'full';

      return {
        ...record,
        assetId,
        name,
        kind,
        loadMode: typeof record.loadMode === 'string' ? record.loadMode : undefined,
        availability: typeof record.availability === 'string' ? record.availability : undefined,
        description: typeof record.description === 'string' ? record.description : '',
        triggers: typeof record.triggers === 'string' ? record.triggers : '',
        absPath: typeof record.absPath === 'string' ? record.absPath : undefined,
        vaultPath:
          typeof record.vaultPath === 'string' || record.vaultPath === null ? record.vaultPath : undefined,
        viewPath: typeof record.viewPath === 'string' ? record.viewPath : undefined,
        provider: typeof record.provider === 'string' ? record.provider : undefined,
        sourcePackage: typeof record.sourcePackage === 'string' ? record.sourcePackage : undefined,
        namespace: typeof record.namespace === 'string' ? record.namespace : undefined,
        readOnly: record.readOnly === true,
      } as SkillPreviewItem;
    })
    .filter((entry): entry is SkillPreviewItem => entry !== null);

  normalized.sort((a, b) => {
    const nameCompare = a.name.localeCompare(b.name);
    if (nameCompare !== 0) {
      return nameCompare;
    }
    return String(a.assetId || '').localeCompare(String(b.assetId || ''));
  });
  return normalized;
}

function buildSkillDetailPath(skill: SkillPreviewItem): string | null {
  if (typeof skill.viewPath === 'string' && skill.viewPath.trim()) {
    return skill.viewPath;
  }

  return null;
}

function buildPreviewUnavailableMessage(skill: SkillPreviewItem | null, label: string): string {
  if (skill && String(skill.availability || '').trim() === 'not-installed') {
    return `${label} is managed but not installed yet. Install or sync it before previewing content.`;
  }
  return `${label} cannot be previewed from the current source location.`;
}

function createSkillsPreviewStore() {
  const store = createStore<SkillsPreviewState>(INITIAL_STATE);
  let requestVersion = 0;
  let detailRequestVersion = 0;

  async function loadSkills(): Promise<void> {
    const nextVersion = ++requestVersion;

    store.setState((state) => ({
      ...state,
      loading: true,
      error: null,
    }));

    try {
      const response = await getSkillsPreview();
      const skills = normalizeSkills(response.skills);

      store.setState((state) => {
        if (nextVersion !== requestVersion) {
          return state;
        }

        const selectedStillExists =
          state.selectedSkillId != null &&
          skills.some((skill) => skill.assetId === state.selectedSkillId);

        return {
          ...state,
          skills,
          selectedSkillId: selectedStillExists ? state.selectedSkillId : null,
          loading: false,
          error: null,
          detailLoading: selectedStillExists ? state.detailLoading : false,
          detailText: selectedStillExists ? state.detailText : '(select a skill above)',
          detailError: selectedStillExists ? state.detailError : null,
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

  async function loadSkillDetail(skillId: string): Promise<void> {
    const normalizedSkillId = skillId.trim();
    if (!normalizedSkillId) {
      return;
    }
    const nextDetailVersion = ++detailRequestVersion;

    const selectedSkill = store.getState().skills.find((skill) => skill.assetId === normalizedSkillId) ?? null;
    const selectedSkillLabel = selectedSkill?.name || normalizedSkillId;

    store.setState((state) => ({
      ...state,
      selectedSkillId: normalizedSkillId,
      detailLoading: true,
      detailError: null,
      detailText: `(loading ${selectedSkillLabel}...)`,
    }));

    const detailPath = buildSkillDetailPath(selectedSkill ?? { name: selectedSkillLabel, kind: 'full' });
    if (!detailPath) {
      store.setState((state) => {
        if (state.selectedSkillId !== normalizedSkillId) {
          return state;
        }

        return {
          ...state,
          detailLoading: false,
          detailError: null,
          detailText: buildPreviewUnavailableMessage(selectedSkill, selectedSkillLabel),
        };
      });
      return;
    }

    try {
      const detailText = await getAssetView(detailPath);

      store.setState((state) => {
        if (nextDetailVersion !== detailRequestVersion || state.selectedSkillId !== normalizedSkillId) {
          return state;
        }

        return {
          ...state,
          detailLoading: false,
          detailError: null,
          detailText: detailText || '(empty skill content)',
        };
      });
    } catch (error) {
      const message = toErrorMessage(error);

      store.setState((state) => {
        if (nextDetailVersion !== detailRequestVersion || state.selectedSkillId !== normalizedSkillId) {
          return state;
        }

        return {
          ...state,
          detailLoading: false,
          detailError: message,
          detailText: `Error loading ${selectedSkillLabel}: ${message}`,
        };
      });
    }
  }

  function setSearchQuery(query: string): void {
    store.setState((state) => ({
      ...state,
      searchQuery: query,
    }));
  }

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    loadSkills,
    refresh: loadSkills,
    loadSkillDetail,
    setSearchQuery,
  };
}

export const skillsPreviewStore = createSkillsPreviewStore();
