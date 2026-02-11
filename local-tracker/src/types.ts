export interface SessionSnapshot {
  id: string;
  status: string;
  planId?: string;
  taskSummary?: { total: number; done: number; inProgress: number };
  lastUpdated: string;
}

export interface GitSnapshot {
  repo: string;
  branch: string;
  ahead: number;
  behind: number;
  modified: number;
  untracked: number;
  lastChecked: string;
}

export interface TrackerEvent {
  type: "session_update" | "git_update" | "task_update" | "file_change";
  timestamp: string;
  data: SessionSnapshot | GitSnapshot | unknown;
}
