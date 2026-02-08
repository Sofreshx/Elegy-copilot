/**
 * IndexedDB-based storage for app settings and preferences.
 */

export interface AgentConfig {
  defaultAgent: string;
  availableAgents: string[];
}

export interface SkillConfig {
  skillId: string;
  enabled: boolean;
}

export interface AppSettings {
  agent: AgentConfig;
  skills: SkillConfig[];
  notifications: {
    permissionRequests: boolean;
    sessionUpdates: boolean;
    reminders: boolean;
  };
  theme: 'light' | 'dark' | 'system';
}

import { getDb } from './db';

const SETTINGS_STORE = 'settings';

const DEFAULT_SETTINGS: AppSettings = {
  agent: {
    defaultAgent: 'executive2-planner',
    availableAgents: [
      'executive2-planner',
      'executive2',
      'debugger',
      'code-explorer',
      'code-reviewer',
      'code-architect',
      'task-runner',
      'test-runner',
      'test-executive',
    ],
  },
  skills: [],
  notifications: {
    permissionRequests: true,
    sessionUpdates: true,
    reminders: true,
  },
  theme: 'system',
};

// Available skills (mirroring instruction-engine skills)
export const AVAILABLE_SKILLS = [
  { id: 'aspire-apphost', name: 'Aspire AppHost', category: 'Infrastructure' },
  { id: 'aspire-deployment', name: 'Aspire Deployment', category: 'Infrastructure' },
  { id: 'auth', name: 'Authentication', category: 'Security' },
  { id: 'cloudflare-storage', name: 'Cloudflare Storage', category: 'Infrastructure' },
  { id: 'code-review', name: 'Code Review', category: 'Quality' },
  { id: 'csharp-expert', name: 'C# Expert', category: 'Language' },
  { id: 'debug', name: 'Debugging', category: 'Development' },
  { id: 'design', name: 'Architecture Design', category: 'Planning' },
  { id: 'docs', name: 'Documentation', category: 'Quality' },
  { id: 'feature-creator', name: 'Feature Creator', category: 'Development' },
  { id: 'frontend', name: 'Frontend', category: 'Development' },
  { id: 'marten-documents', name: 'Marten Documents', category: 'Data' },
  { id: 'marten-events', name: 'Marten Events', category: 'Data' },
  { id: 'orleans', name: 'Orleans', category: 'Infrastructure' },
  { id: 'refactor', name: 'Refactoring', category: 'Quality' },
  { id: 'security', name: 'Security', category: 'Security' },
  { id: 'signalr', name: 'SignalR', category: 'Infrastructure' },
  { id: 'terraform', name: 'Terraform', category: 'Infrastructure' },
  { id: 'testing-dotnet-unit', name: '.NET Unit Testing', category: 'Testing' },
  { id: 'testing-frontend-unit', name: 'Frontend Testing', category: 'Testing' },
  { id: 'wolverine-core', name: 'Wolverine Core', category: 'Infrastructure' },
  { id: 'wolverine-http', name: 'Wolverine HTTP', category: 'Infrastructure' },
];

export const settingsDb = {
  async get<T>(key: string): Promise<T | null> {
    const db = await getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SETTINGS_STORE, 'readonly');
      const store = tx.objectStore(SETTINGS_STORE);
      const request = store.get(key);
      request.onsuccess = () => {
        resolve(request.result?.value ?? null);
      };
      request.onerror = () => reject(new Error('Failed to get setting'));
    });
  },

  async set<T>(key: string, value: T): Promise<void> {
    const db = await getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SETTINGS_STORE, 'readwrite');
      const store = tx.objectStore(SETTINGS_STORE);
      const request = store.put({ key, value });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error('Failed to set setting'));
    });
  },

  async getSettings(): Promise<AppSettings> {
    const stored = await this.get<AppSettings>('app-settings');
    if (!stored) {
      return { ...DEFAULT_SETTINGS };
    }
    // Merge with defaults to handle new fields
    return {
      ...DEFAULT_SETTINGS,
      ...stored,
      agent: { ...DEFAULT_SETTINGS.agent, ...stored.agent },
      notifications: { ...DEFAULT_SETTINGS.notifications, ...stored.notifications },
    };
  },

  async saveSettings(settings: Partial<AppSettings>): Promise<AppSettings> {
    const current = await this.getSettings();
    const updated = {
      ...current,
      ...settings,
      agent: settings.agent ? { ...current.agent, ...settings.agent } : current.agent,
      notifications: settings.notifications
        ? { ...current.notifications, ...settings.notifications }
        : current.notifications,
    };
    await this.set('app-settings', updated);
    return updated;
  },

  async setDefaultAgent(agentId: string): Promise<AppSettings> {
    return this.saveSettings({ agent: { defaultAgent: agentId, availableAgents: DEFAULT_SETTINGS.agent.availableAgents } });
  },

  async setSkillEnabled(skillId: string, enabled: boolean): Promise<AppSettings> {
    const settings = await this.getSettings();
    const skills = [...settings.skills];
    const idx = skills.findIndex((s) => s.skillId === skillId);
    if (idx >= 0) {
      skills[idx] = { skillId, enabled };
    } else {
      skills.push({ skillId, enabled });
    }
    return this.saveSettings({ skills });
  },

  async isSkillEnabled(skillId: string): Promise<boolean> {
    const settings = await this.getSettings();
    const skill = settings.skills.find((s) => s.skillId === skillId);
    // Default to enabled if not explicitly set
    return skill?.enabled ?? true;
  },

  async setNotificationSetting(
    key: keyof AppSettings['notifications'],
    enabled: boolean
  ): Promise<AppSettings> {
    const settings = await this.getSettings();
    return this.saveSettings({
      notifications: { ...settings.notifications, [key]: enabled },
    });
  },
};
