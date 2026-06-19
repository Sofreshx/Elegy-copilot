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
  loading: boolean;
  error: string | null;

  loadStatus: () => Promise<void>;
  loadProjects: () => Promise<void>;
  loadSessions: (projectDir?: string) => Promise<void>;
  sendPrompt: (project: string, prompt: string, threadId?: string, permission?: string[]) => Promise<void>;
  addProject: (dir: string, guildId?: string) => Promise<void>;
  refreshLogs: () => Promise<void>;
  restart: () => Promise<void>;
}

export const useRemoteStore = create<RemoteState>((set, get) => ({
  status: null,
  projects: [],
  sessions: [],
  logsTail: [],
  loading: false,
  error: null,

  loadStatus: async () => {
    try {
      const status = await getRemoteStatus();
      set({ status, error: null });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  loadProjects: async () => {
    try {
      set({ loading: true });
      const { projects } = await listRemoteProjects();
      set({ projects, loading: false, error: null });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : String(err) });
    }
  },

  loadSessions: async (projectDir?: string) => {
    try {
      const { sessions } = await listRemoteSessions({ project: projectDir, limit: 50 });
      set({ sessions, error: null });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  sendPrompt: async (project, prompt, threadId, permission) => {
    try {
      set({ loading: true });
      await sendRemotePrompt({ project, prompt, threadId, permission });
      set({ loading: false, error: null });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : String(err) });
    }
  },

  addProject: async (dir, guildId) => {
    try {
      set({ loading: true });
      await addRemoteProject({ directory: dir, guildId });
      await get().loadProjects();
      set({ loading: false });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : String(err) });
    }
  },

  refreshLogs: async () => {
    try {
      const { lines } = await getRemoteLogs(50);
      set({ logsTail: lines, error: null });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  restart: async () => {
    try {
      set({ loading: true, error: null });
      await restartRemoteRuntime();
      await get().loadStatus();
      set({ loading: false });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : String(err) });
    }
  },
}));
