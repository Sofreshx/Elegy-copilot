import { createStore } from '../lib/store';
import { getRepoContextCheck } from '../lib/api/repoContext';
import type { DriftCheckResponse } from '../lib/api/repoContext';

// --- Types ---

interface DriftIssue {
  code: string;
  severity: 'error' | 'warning' | 'info';
  claim: {
    type: string;
    value: string;
    negated: boolean;
    source: { file: string; line: number; section: string | null };
  } | null;
  file: string;
  line: number;
  message: string;
  suggestion: string | null;
}

interface DriftReport {
  score: number;
  issues: DriftIssue[];
  fileCount: number;
  claimCount: number;
  verifiedCount: number;
  failedCount: number;
  timestamp: string;
  severityCounts: { error: number; warning: number; info: number };
}

interface DriftRepoState {
  report: DriftReport | null;
  checkStatuses: Record<string, 'idle' | 'running' | 'done' | 'error'>;
  checkTimestamps: Record<string, string | null>;
  lastFullRunAt: string | null;
  error: string | null;
}

interface DriftCheckState {
  byRepo: Record<string, DriftRepoState>;
}

// --- Constants ---

const PHASE_CODES: Record<string, string[]> = {
  frontmatter: ['frontmatter_invalid'],
  staleness: ['stale_doc'],
  links: ['broken_internal_link'],
  scripts: ['undocumented_script'],
  'cross-file': ['cross_file_conflict'],
  'todo-fixme': ['todo_fixme_marker'],
  'tool-config-sync': ['tool_config_drift'],
};

// --- Helpers (private) ---

function normalizeRepoPath(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase();
}

function getStorageKey(repoPath: string): string {
  return `elegy-copilot-drift-${normalizeRepoPath(repoPath)}`;
}

function normalizeReport(raw: unknown): DriftReport | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.score !== 'number') return null;
  return {
    score: obj.score,
    issues: Array.isArray(obj.issues) ? (obj.issues as DriftIssue[]) : [],
    fileCount:
      (typeof obj.filesChecked === 'number' ? obj.filesChecked : undefined) ??
      (typeof obj.fileCount === 'number' ? obj.fileCount : 0),
    claimCount:
      (typeof obj.claimsExtracted === 'number' ? obj.claimsExtracted : undefined) ??
      (typeof obj.claimCount === 'number' ? obj.claimCount : 0),
    verifiedCount: typeof obj.verifiedCount === 'number' ? obj.verifiedCount : 0,
    failedCount: typeof obj.failedCount === 'number' ? obj.failedCount : 0,
    timestamp: typeof obj.timestamp === 'string' ? obj.timestamp : new Date().toISOString(),
    severityCounts:
      obj.severityCounts && typeof obj.severityCounts === 'object'
        ? {
            error: typeof (obj.severityCounts as Record<string, unknown>).error === 'number'
              ? (obj.severityCounts as Record<string, unknown>).error as number
              : 0,
            warning: typeof (obj.severityCounts as Record<string, unknown>).warning === 'number'
              ? (obj.severityCounts as Record<string, unknown>).warning as number
              : 0,
            info: typeof (obj.severityCounts as Record<string, unknown>).info === 'number'
              ? (obj.severityCounts as Record<string, unknown>).info as number
              : 0,
          }
        : { error: 0, warning: 0, info: 0 },
  };
}

function recomputeScore(report: DriftReport): DriftReport {
  const errors = report.issues.filter((i) => i.severity === 'error').length;
  const warnings = report.issues.filter((i) => i.severity === 'warning').length;
  const infos = report.issues.filter((i) => i.severity === 'info').length;
  const failedCount = report.issues.filter((i) => i.claim !== null).length;
  const verifiedCount = report.claimCount - failedCount;
  const baseScore = report.claimCount > 0 ? (100 * verifiedCount) / (verifiedCount + failedCount) : 100;
  const score = Math.max(0, Math.round(baseScore - errors * 2 - warnings * 1 - infos * 0.5));
  return {
    ...report,
    score,
    failedCount,
    verifiedCount,
    severityCounts: { error: errors, warning: warnings, info: infos },
    timestamp: new Date().toISOString(),
  };
}

function belongsToPhase(issue: DriftIssue, checkName: string): boolean {
  if (checkName === 'claims') return issue.claim !== null;
  if (checkName === 'cross-file') return issue.code === 'cross_file_conflict';
  return issue.claim === null && (PHASE_CODES[checkName]?.includes(issue.code) ?? false);
}

function mergeIssues(existing: DriftIssue[], incoming: DriftIssue[], checkName: string): DriftIssue[] {
  const filtered = existing.filter((i) => !belongsToPhase(i, checkName));
  return [...filtered, ...incoming];
}

// --- Factory ---

function createDriftCheckStore() {
  const store = createStore<DriftCheckState>({ byRepo: {} });

  function getState(): DriftCheckState {
    return store.getState();
  }

  function subscribe(listener: () => void): () => void {
    return store.subscribe(listener);
  }

  function getNormalized(repoPath: string): string {
    return normalizeRepoPath(repoPath);
  }

  function loadCached(repoPath: string): DriftRepoState | null {
    const normalized = getNormalized(repoPath);
    const key = getStorageKey(repoPath);
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed: DriftRepoState = JSON.parse(raw);
      store.setState((state) => {
        if (!state.byRepo[normalized]) return state;
        return {
          ...state,
          byRepo: {
            ...state.byRepo,
            [normalized]: parsed,
          },
        };
      });
      return parsed;
    } catch {
      return null;
    }
  }

  function initRepo(repoPath: string): void {
    const normalized = getNormalized(repoPath);
    store.setState((state) => {
      if (state.byRepo[normalized]) return state;
      return {
        ...state,
        byRepo: {
          ...state.byRepo,
          [normalized]: {
            report: null,
            checkStatuses: {},
            checkTimestamps: {},
            lastFullRunAt: null,
            error: null,
          },
        },
      };
    });
    loadCached(repoPath);
  }

  function saveCache(repoPath: string): void {
    const normalized = getNormalized(repoPath);
    const key = getStorageKey(repoPath);
    try {
      const repoState = store.getState().byRepo[normalized];
      if (repoState) {
        localStorage.setItem(key, JSON.stringify(repoState));
      }
    } catch {
      // silent fail — localStorage may be full or unavailable
    }
  }

  async function runFull(repoPath: string): Promise<void> {
    const normalized = getNormalized(repoPath);
    initRepo(repoPath);
    try {
      const response: DriftCheckResponse = await getRepoContextCheck(repoPath);
      const report = normalizeReport(response.report ?? null);

      const now = new Date().toISOString();
      const allCheckNames = Object.keys(PHASE_CODES).concat('claims');
      const checkStatuses: Record<string, 'idle' | 'running' | 'done' | 'error'> = {};
      const checkTimestamps: Record<string, string | null> = {};
      for (const name of allCheckNames) {
        checkStatuses[name] = 'done';
        checkTimestamps[name] = now;
      }

      store.setState((state) => {
        const current = state.byRepo[normalized] ?? {
          report: null,
          checkStatuses: {},
          checkTimestamps: {},
          lastFullRunAt: null,
          error: null,
        };
        return {
          ...state,
          byRepo: {
            ...state.byRepo,
            [normalized]: {
              ...current,
              report,
              checkStatuses,
              checkTimestamps,
              lastFullRunAt: now,
              error: null,
            },
          },
        };
      });
      saveCache(repoPath);
    } catch (err) {
      store.setState((state) => {
        const current = state.byRepo[normalized] ?? {
          report: null,
          checkStatuses: {},
          checkTimestamps: {},
          lastFullRunAt: null,
          error: null,
        };
        return {
          ...state,
          byRepo: {
            ...state.byRepo,
            [normalized]: {
              ...current,
              error: err instanceof Error ? err.message : String(err),
            },
          },
        };
      });
    }
  }

  async function runSingle(repoPath: string, checkName: string): Promise<void> {
    const normalized = getNormalized(repoPath);
    initRepo(repoPath);

    store.setState((state) => {
      const current = state.byRepo[normalized] ?? {
        report: null,
        checkStatuses: {},
        checkTimestamps: {},
        lastFullRunAt: null,
        error: null,
      };
      return {
        ...state,
        byRepo: {
          ...state.byRepo,
          [normalized]: {
            ...current,
            checkStatuses: { ...current.checkStatuses, [checkName]: 'running' },
            error: null,
          },
        },
      };
    });

    try {
      const response: DriftCheckResponse = await getRepoContextCheck(repoPath, checkName);
      const incomingReport = normalizeReport(response.report ?? null);

      store.setState((state) => {
        const current = state.byRepo[normalized];
        if (!current) return state;

        const existingIssues = current.report?.issues ?? [];
        const incomingIssues = incomingReport?.issues ?? [];
        const mergedIssues = mergeIssues(existingIssues, incomingIssues, checkName);

        const mergedReport: DriftReport | null = current.report
          ? { ...current.report, issues: mergedIssues }
          : incomingReport
            ? { ...incomingReport, issues: mergedIssues }
            : null;

        const finalReport = mergedReport ? recomputeScore(mergedReport) : null;

        return {
          ...state,
          byRepo: {
            ...state.byRepo,
            [normalized]: {
              ...current,
              report: finalReport,
              checkStatuses: { ...current.checkStatuses, [checkName]: 'done' },
              checkTimestamps: { ...current.checkTimestamps, [checkName]: new Date().toISOString() },
            },
          },
        };
      });
      saveCache(repoPath);
    } catch (err) {
      store.setState((state) => {
        const current = state.byRepo[normalized];
        if (!current) return state;
        return {
          ...state,
          byRepo: {
            ...state.byRepo,
            [normalized]: {
              ...current,
              checkStatuses: { ...current.checkStatuses, [checkName]: 'error' },
              error: err instanceof Error ? err.message : String(err),
            },
          },
        };
      });
    }
  }

  function clearCache(repoPath: string): void {
    const normalized = getNormalized(repoPath);
    const key = getStorageKey(repoPath);
    try {
      localStorage.removeItem(key);
    } catch {
      // silent fail
    }
    store.setState((state) => {
      if (!state.byRepo[normalized]) return state;
      return {
        ...state,
        byRepo: {
          ...state.byRepo,
          [normalized]: {
            report: null,
            checkStatuses: {},
            checkTimestamps: {},
            lastFullRunAt: null,
            error: null,
          },
        },
      };
    });
  }

  function reset(): void {
    const state = store.getState();
    for (const repoPath of Object.keys(state.byRepo)) {
      try {
        localStorage.removeItem(getStorageKey(repoPath));
      } catch {
        // silent fail
      }
    }
    store.setState(() => ({ byRepo: {} }));
  }

  return {
    getState,
    subscribe,
    initRepo,
    loadCached,
    saveCache,
    runFull,
    runSingle,
    clearCache,
    reset,
  };
}

// --- Singleton ---

export const driftCheckStore = createDriftCheckStore();

// --- Type exports ---

export type { DriftCheckState, DriftRepoState, DriftReport, DriftIssue };
