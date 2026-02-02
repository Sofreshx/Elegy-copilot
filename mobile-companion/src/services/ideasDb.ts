/**
 * IndexedDB-based storage for ideas.
 * Provides offline-first persistence for the idea drafting system.
 */

export type IdeaStatus = 'draft' | 'refining' | 'ready' | 'queued' | 'completed' | 'archived';
export type IdeaPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface Idea {
  id: string;
  title: string;
  description: string;
  tags: string[];
  status: IdeaStatus;
  priority: IdeaPriority;
  createdAt: number;
  updatedAt: number;
}

export type IdeaInput = Omit<Idea, 'id' | 'createdAt' | 'updatedAt'>;

export interface IdeaFilters {
  status?: IdeaStatus;
  priority?: IdeaPriority;
}

const DB_NAME = 'mobile-companion';
const DB_VERSION = 1;
const STORE_NAME = 'ideas';

let dbInstance: IDBDatabase | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbInstance) {
    return Promise.resolve(dbInstance);
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('status', 'status', { unique: false });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(request.result);
    };

    request.onerror = () => {
      reject(new Error('Failed to open IndexedDB'));
    };
  });
}

function generateId(): string {
  return crypto.randomUUID();
}

export const ideasDb = {
  async getAll(): Promise<Idea[]> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(new Error('Failed to get ideas'));
    });
  },

  async getById(id: string): Promise<Idea | undefined> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('Failed to get idea'));
    });
  },

  async create(input: IdeaInput): Promise<Idea> {
    const db = await openDb();
    const now = Date.now();
    const idea: Idea = {
      ...input,
      id: generateId(),
      createdAt: now,
      updatedAt: now,
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.add(idea);
      request.onsuccess = () => resolve(idea);
      request.onerror = () => reject(new Error('Failed to create idea'));
    });
  },

  async update(id: string, changes: Partial<IdeaInput>): Promise<Idea> {
    const db = await openDb();
    const existing = await this.getById(id);
    if (!existing) {
      throw new Error('Idea not found');
    }

    const updated: Idea = {
      ...existing,
      ...changes,
      updatedAt: Date.now(),
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(updated);
      request.onsuccess = () => resolve(updated);
      request.onerror = () => reject(new Error('Failed to update idea'));
    });
  },

  async delete(id: string): Promise<void> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error('Failed to delete idea'));
    });
  },

  async getAllTags(): Promise<string[]> {
    const ideas = await this.getAll();
    const tagSet = new Set<string>();
    ideas.forEach((idea) => idea.tags.forEach((tag) => tagSet.add(tag)));
    return Array.from(tagSet).sort();
  },

  exportToMarkdown(idea: Idea): string {
    const statusLabel = {
      draft: '📝 Draft',
      refining: '🔄 Refining',
      ready: '✅ Ready',
      queued: '⏳ Queued',
      completed: '🎉 Completed',
      archived: '📦 Archived',
    };
    const priorityLabel = {
      low: 'Low',
      medium: 'Medium',
      high: 'High',
      urgent: '🚨 Urgent',
    };
    return `# ${idea.title}

**Status:** ${statusLabel[idea.status]}
**Priority:** ${priorityLabel[idea.priority]}
**Tags:** ${idea.tags.length > 0 ? idea.tags.join(', ') : 'None'}

---

${idea.description || '_No description_'}

---
_Created: ${new Date(idea.createdAt).toLocaleString()}_
_Updated: ${new Date(idea.updatedAt).toLocaleString()}_
`;
  },
};
