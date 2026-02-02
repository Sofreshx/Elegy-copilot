/**
 * IndexedDB storage for AI chat conversations.
 */

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

const DB_NAME = 'mobile-companion';
const DB_VERSION = 3; // Bump for chat store
const CHAT_STORE = 'conversations';

let dbInstance: IDBDatabase | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbInstance) {
    return Promise.resolve(dbInstance);
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      
      // Create stores if they don't exist
      if (!db.objectStoreNames.contains('ideas')) {
        const ideasStore = db.createObjectStore('ideas', { keyPath: 'id' });
        ideasStore.createIndex('status', 'status', { unique: false });
        ideasStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
      
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
      
      if (!db.objectStoreNames.contains(CHAT_STORE)) {
        const chatStore = db.createObjectStore(CHAT_STORE, { keyPath: 'id' });
        chatStore.createIndex('updatedAt', 'updatedAt', { unique: false });
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

export const chatDb = {
  async getAllConversations(): Promise<Conversation[]> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(CHAT_STORE, 'readonly');
      const store = tx.objectStore(CHAT_STORE);
      const request = store.getAll();
      request.onsuccess = () => {
        const conversations = request.result || [];
        // Sort by updatedAt descending
        resolve(conversations.sort((a, b) => b.updatedAt - a.updatedAt));
      };
      request.onerror = () => reject(new Error('Failed to get conversations'));
    });
  },

  async getConversation(id: string): Promise<Conversation | undefined> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(CHAT_STORE, 'readonly');
      const store = tx.objectStore(CHAT_STORE);
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('Failed to get conversation'));
    });
  },

  async createConversation(title?: string): Promise<Conversation> {
    const db = await openDb();
    const now = Date.now();
    const conversation: Conversation = {
      id: crypto.randomUUID(),
      title: title || 'New Chat',
      messages: [],
      createdAt: now,
      updatedAt: now,
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction(CHAT_STORE, 'readwrite');
      const store = tx.objectStore(CHAT_STORE);
      const request = store.add(conversation);
      request.onsuccess = () => resolve(conversation);
      request.onerror = () => reject(new Error('Failed to create conversation'));
    });
  },

  async saveConversation(conversation: Conversation): Promise<void> {
    const db = await openDb();
    const updated = { ...conversation, updatedAt: Date.now() };
    
    return new Promise((resolve, reject) => {
      const tx = db.transaction(CHAT_STORE, 'readwrite');
      const store = tx.objectStore(CHAT_STORE);
      const request = store.put(updated);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error('Failed to save conversation'));
    });
  },

  async deleteConversation(id: string): Promise<void> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(CHAT_STORE, 'readwrite');
      const store = tx.objectStore(CHAT_STORE);
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error('Failed to delete conversation'));
    });
  },

  async addMessage(conversationId: string, message: ChatMessage): Promise<void> {
    const conversation = await this.getConversation(conversationId);
    if (!conversation) {
      throw new Error('Conversation not found');
    }

    conversation.messages.push(message);
    
    // Auto-update title from first user message
    if (conversation.title === 'New Chat' && message.role === 'user') {
      conversation.title = message.content.slice(0, 50) + (message.content.length > 50 ? '...' : '');
    }

    await this.saveConversation(conversation);
  },

  async updateLastMessage(conversationId: string, content: string): Promise<void> {
    const conversation = await this.getConversation(conversationId);
    if (!conversation || conversation.messages.length === 0) {
      throw new Error('Conversation not found or empty');
    }

    const lastIdx = conversation.messages.length - 1;
    const lastMessage = conversation.messages[lastIdx];
    if (lastMessage) {
      lastMessage.content = content;
      await this.saveConversation(conversation);
    }
  },
};
