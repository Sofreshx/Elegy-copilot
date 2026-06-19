import { create } from 'zustand';
import {
  getRemoteStatus,
  restartRemoteRuntime,
  listRemoteProjects,
  listRemoteSessions,
  sendRemotePrompt,
  addRemoteProject,
  getRemoteLogs,
  type RemoteStatus,
  type RemoteProject,
  type RemoteSession,
} from '../../lib/api/remote';

interface RemoteState {
  status: RemoteStatus | null;
  projects: RemoteProject[];
  sessions: RemoteSession[];
  logsTail: string[];
  statusLoading: boolean;
  actionLoading: boolean;
  error: string | null;
  loadStatus: () => Promise<RemoteStatus | null>;
  loadOperations: () => Promise<void>;
  sendPrompt: (project: string, prompt: string, threadId?: string, permission?: string[]) => Promise<void>;
  addProject: (dir: string, guildId?: string) => Promise<void>;
  refreshLogs: () => Promise<void>;
  restart: () => Promise<void>;
}

let statusRequest: Promise<RemoteStatus | null> | null = null;
let operationsRequest: Promise<void> | null = null;

export const useRemoteStore = create<RemoteState>((set, get) => ({
  status: null,
  projects: [],
  sessions: [],
  logsTail: [],
  statusLoading: false,
  actionLoading: false,
  error: null,

  loadStatus: async () => {
    if (statusRequest) return statusRequest;
    statusRequest = (async () => {
      set({ statusLoading: true });
      try {
        const status = await getRemoteStatus();
        set({ status, statusLoading: false, error: null });
        return status;
      } catch (err) {
        set({ statusLoading: false, error: err instanceof Error ? err.message : String(err) });
        return null;
      } finally {
        statusRequest = null;
      }
    })();
    return statusRequest;
  },

  loadOperations: async () => {
    if (!get().status?.ready || operationsRequest) return operationsRequest ?? Promise.resolve();
    operationsRequest = (async () => {
      try {
        const [{ projects }, { sessions }] = await Promise.all([
          listRemoteProjects(),
          listRemoteSessions({ limit: 50 }),
        ]);
        set({ projects, sessions, error: null });
      } catch (err) {
        set({ error: err instanceof Error ? err.message : String(err) });
      } finally {
        operationsRequest = null;
      }
    })();
    return operationsRequest;
  },

  sendPrompt: async (project, prompt, threadId, permission) => {
    set({ actionLoading: true, error: null });
    try {
      await sendRemotePrompt({ project, prompt, threadId, permission });
      await get().loadOperations();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      set({ actionLoading: false });
    }
  },

  addProject: async (dir, guildId) => {
    set({ actionLoading: true, error: null });
    try {
      await addRemoteProject({ directory: dir, guildId });
      await get().loadOperations();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      set({ actionLoading: false });
    }
  },

  refreshLogs: async () => {
    try {
      const { lines } = await getRemoteLogs(100);
      set({ logsTail: lines });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  restart: async () => {
    set({ actionLoading: true, error: null, projects: [], sessions: [] });
    try {
      await restartRemoteRuntime();
      await get().loadStatus();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      set({ actionLoading: false });
    }
  },
}));
