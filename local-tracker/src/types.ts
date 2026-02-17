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
  type: "git_update" | "task_update" | "file_change";
  timestamp: string;
  data: GitSnapshot | unknown;
}
