export interface ProjectRecord {
  projectId: string;
  repoId: string;
  repoPath: string;
  repoLabel: string;
  canonicalRemote: string | null;
  pinned: boolean;
  lastActivityMs: number | null;
  sessionCount: number;
  activeSessionCount: number;
  installedAssetSummary?: {
    agents: number;
    skills: number;
  };
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface ProjectGitSummary {
  branch: string | null;
  clean: boolean;
  changedFiles: number;
  stagedFiles: number;
  ahead: number;
  behind: number;
  additions: number;
  deletions: number;
  hasRemote: boolean;
  prNumber: number | null;
  prUrl: string | null;
  prState: string | null;
  remoteName: string | null;
  remoteLabel: string | null;
}

export const EMPTY_PROJECT_GIT_SUMMARY: ProjectGitSummary = {
  branch: null,
  clean: true,
  changedFiles: 0,
  stagedFiles: 0,
  ahead: 0,
  behind: 0,
  additions: 0,
  deletions: 0,
  hasRemote: false,
  prNumber: null,
  prUrl: null,
  prState: null,
  remoteName: null,
  remoteLabel: null,
};
