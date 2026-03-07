import { getAssetView, getSkillsPreview } from '../../lib/api';
import { createStore } from '../../lib/store';
import type { SkillPreviewItem } from '../../lib/types';

export interface SkillsPreviewState {
  skills: SkillPreviewItem[];
  loading: boolean;
  error: string | null;
  searchQuery: string;
  selectedSkillName: string | null;
  detailLoading: boolean;
  detailError: string | null;
  detailText: string;
}

const INITIAL_STATE: SkillsPreviewState = {
  skills: [],
  loading: false,
  error: null,
  searchQuery: '',
  selectedSkillName: null,
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

      const kind = typeof record.kind === 'string' && record.kind.trim() ? record.kind : 'full';

      return {
        ...record,
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
      } as SkillPreviewItem;
    })
    .filter((entry): entry is SkillPreviewItem => entry !== null);

  normalized.sort((a, b) => a.name.localeCompare(b.name));
  return normalized;
}

function buildSkillDetailPath(skill: SkillPreviewItem): string {
  if (typeof skill.viewPath === 'string' && skill.viewPath.trim()) {
    return skill.viewPath;
  }

  return `skills/${skill.name}/SKILL.md`;
}

function createSkillsPreviewStore() {
  const store = createStore<SkillsPreviewState>(INITIAL_STATE);
  let requestVersion = 0;

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
          state.selectedSkillName != null &&
          skills.some((skill) => skill.name === state.selectedSkillName);

        return {
          ...state,
          skills,
          selectedSkillName: selectedStillExists ? state.selectedSkillName : null,
          loading: false,
          error: null,
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

  async function loadSkillDetail(skillName: string): Promise<void> {
    const normalizedSkillName = skillName.trim();
    if (!normalizedSkillName) {
      return;
    }

    store.setState((state) => ({
      ...state,
      selectedSkillName: normalizedSkillName,
      detailLoading: true,
      detailError: null,
      detailText: `(loading ${normalizedSkillName}...)`,
    }));

    try {
      const selectedSkill = store.getState().skills.find((skill) => skill.name === normalizedSkillName);
      const detailPath = buildSkillDetailPath(selectedSkill ?? { name: normalizedSkillName, kind: 'full' });
      const detailText = await getAssetView(detailPath);

      store.setState((state) => ({
        ...state,
        detailLoading: false,
        detailError: null,
        detailText: detailText || '(empty skill content)',
      }));
    } catch (error) {
      const message = toErrorMessage(error);

      store.setState((state) => ({
        ...state,
        detailLoading: false,
        detailError: message,
        detailText: `Error loading ${normalizedSkillName}: ${message}`,
      }));
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
