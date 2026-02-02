// Queue Management Service
// Provides queue operations with priority, ordering, and batch execution

const DB_NAME = 'mobile-companion-db';
const QUEUE_STORE = 'queue';
const DB_VERSION = 6;

export type Priority = 'high' | 'medium' | 'low';
export type QueueItemStatus = 'pending' | 'executing' | 'completed' | 'failed';

export interface QueueItem {
  id: string;
  ideaId: string;
  title: string;
  description: string;
  priority: Priority;
  order: number;
  status: QueueItemStatus;
  estimatedMinutes?: number;
  agentName?: string;
  createdAt: number;
  updatedAt: number;
  executedAt?: number;
  completedAt?: number;
  error?: string;
}

export interface QueueStats {
  total: number;
  pending: number;
  executing: number;
  completed: number;
  failed: number;
  estimatedTotalMinutes: number;
}

export interface BatchExecutionResult {
  itemId: string;
  success: boolean;
  error?: string;
}

class QueueService {
  private dbPromise: Promise<IDBDatabase>;

  constructor() {
    this.dbPromise = this.initDb();
  }

  private initDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        if (!db.objectStoreNames.contains(QUEUE_STORE)) {
          const store = db.createObjectStore(QUEUE_STORE, { keyPath: 'id' });
          store.createIndex('order', 'order');
          store.createIndex('priority', 'priority');
          store.createIndex('status', 'status');
          store.createIndex('ideaId', 'ideaId');
        }
      };
    });
  }

  async addToQueue(
    ideaId: string,
    title: string,
    description: string,
    options?: {
      priority?: Priority;
      estimatedMinutes?: number;
      agentName?: string;
    }
  ): Promise<QueueItem> {
    const db = await this.dbPromise;
    
    // Get current max order
    const items = await this.getQueueItems();
    const maxOrder = items.reduce((max, item) => Math.max(max, item.order), 0);
    
    const queueItem: QueueItem = {
      id: `queue-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      ideaId,
      title,
      description,
      priority: options?.priority || 'medium',
      order: maxOrder + 1,
      status: 'pending',
      estimatedMinutes: options?.estimatedMinutes,
      agentName: options?.agentName,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    
    return new Promise((resolve, reject) => {
      const tx = db.transaction(QUEUE_STORE, 'readwrite');
      const store = tx.objectStore(QUEUE_STORE);
      const request = store.add(queueItem);
      
      request.onsuccess = () => resolve(queueItem);
      request.onerror = () => reject(request.error);
    });
  }

  async getQueueItems(status?: QueueItemStatus): Promise<QueueItem[]> {
    const db = await this.dbPromise;
    
    return new Promise((resolve, reject) => {
      const tx = db.transaction(QUEUE_STORE, 'readonly');
      const store = tx.objectStore(QUEUE_STORE);
      const request = store.getAll();
      
      request.onsuccess = () => {
        let items = request.result as QueueItem[];
        
        if (status) {
          items = items.filter(item => item.status === status);
        }
        
        // Sort by order
        items.sort((a, b) => a.order - b.order);
        resolve(items);
      };
      
      request.onerror = () => reject(request.error);
    });
  }

  async updatePriority(itemId: string, priority: Priority): Promise<QueueItem | null> {
    const db = await this.dbPromise;
    
    return new Promise((resolve, reject) => {
      const tx = db.transaction(QUEUE_STORE, 'readwrite');
      const store = tx.objectStore(QUEUE_STORE);
      const getRequest = store.get(itemId);
      
      getRequest.onsuccess = () => {
        const item = getRequest.result as QueueItem | undefined;
        if (!item) {
          resolve(null);
          return;
        }
        
        item.priority = priority;
        item.updatedAt = Date.now();
        
        const putRequest = store.put(item);
        putRequest.onsuccess = () => resolve(item);
        putRequest.onerror = () => reject(putRequest.error);
      };
      
      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  async reorderItems(orderedIds: string[]): Promise<void> {
    const db = await this.dbPromise;
    const items = await this.getQueueItems();
    
    return new Promise((resolve, reject) => {
      const tx = db.transaction(QUEUE_STORE, 'readwrite');
      const store = tx.objectStore(QUEUE_STORE);
      
      let completed = 0;
      const total = orderedIds.length;
      
      orderedIds.forEach((id, index) => {
        const item = items.find(i => i.id === id);
        if (item) {
          item.order = index;
          item.updatedAt = Date.now();
          
          const request = store.put(item);
          request.onsuccess = () => {
            completed++;
            if (completed === total) resolve();
          };
          request.onerror = () => reject(request.error);
        } else {
          completed++;
          if (completed === total) resolve();
        }
      });
      
      if (total === 0) resolve();
    });
  }

  async removeFromQueue(itemId: string): Promise<boolean> {
    const db = await this.dbPromise;
    
    return new Promise((resolve, reject) => {
      const tx = db.transaction(QUEUE_STORE, 'readwrite');
      const store = tx.objectStore(QUEUE_STORE);
      const request = store.delete(itemId);
      
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }

  async removeMultiple(itemIds: string[]): Promise<number> {
    let removed = 0;
    for (const id of itemIds) {
      const success = await this.removeFromQueue(id);
      if (success) removed++;
    }
    return removed;
  }

  async updateStatus(
    itemId: string, 
    status: QueueItemStatus,
    error?: string
  ): Promise<QueueItem | null> {
    const db = await this.dbPromise;
    
    return new Promise((resolve, reject) => {
      const tx = db.transaction(QUEUE_STORE, 'readwrite');
      const store = tx.objectStore(QUEUE_STORE);
      const getRequest = store.get(itemId);
      
      getRequest.onsuccess = () => {
        const item = getRequest.result as QueueItem | undefined;
        if (!item) {
          resolve(null);
          return;
        }
        
        item.status = status;
        item.updatedAt = Date.now();
        
        if (status === 'executing') {
          item.executedAt = Date.now();
        } else if (status === 'completed' || status === 'failed') {
          item.completedAt = Date.now();
        }
        
        if (error) {
          item.error = error;
        }
        
        const putRequest = store.put(item);
        putRequest.onsuccess = () => resolve(item);
        putRequest.onerror = () => reject(putRequest.error);
      };
      
      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  async getStats(): Promise<QueueStats> {
    const items = await this.getQueueItems();
    
    const stats: QueueStats = {
      total: items.length,
      pending: 0,
      executing: 0,
      completed: 0,
      failed: 0,
      estimatedTotalMinutes: 0,
    };
    
    for (const item of items) {
      switch (item.status) {
        case 'pending':
          stats.pending++;
          if (item.estimatedMinutes) {
            stats.estimatedTotalMinutes += item.estimatedMinutes;
          }
          break;
        case 'executing':
          stats.executing++;
          break;
        case 'completed':
          stats.completed++;
          break;
        case 'failed':
          stats.failed++;
          break;
      }
    }
    
    return stats;
  }

  async sortByPriority(): Promise<void> {
    const items = await this.getQueueItems();
    
    // Sort by priority (high > medium > low), then by current order
    const priorityOrder: Record<Priority, number> = {
      high: 0,
      medium: 1,
      low: 2,
    };
    
    items.sort((a, b) => {
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return a.order - b.order;
    });
    
    // Reorder with new sequence
    const orderedIds = items.map(item => item.id);
    await this.reorderItems(orderedIds);
  }

  // Execute a single item (mock - would dispatch to agent in real implementation)
  async executeItem(
    itemId: string,
    executor: (item: QueueItem) => Promise<void>
  ): Promise<boolean> {
    const items = await this.getQueueItems();
    const item = items.find(i => i.id === itemId);
    
    if (!item || item.status !== 'pending') {
      return false;
    }
    
    await this.updateStatus(itemId, 'executing');
    
    try {
      await executor(item);
      await this.updateStatus(itemId, 'completed');
      return true;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      await this.updateStatus(itemId, 'failed', errorMsg);
      return false;
    }
  }

  // Batch execute multiple items sequentially
  async executeBatch(
    itemIds: string[],
    executor: (item: QueueItem) => Promise<void>,
    onProgress?: (completed: number, total: number, result: BatchExecutionResult) => void
  ): Promise<BatchExecutionResult[]> {
    const results: BatchExecutionResult[] = [];
    
    for (const itemId of itemIds) {
      const success = await this.executeItem(itemId, executor);
      
      const result: BatchExecutionResult = {
        itemId,
        success,
        error: success ? undefined : 'Execution failed',
      };
      
      results.push(result);
      
      if (onProgress) {
        onProgress(results.length, itemIds.length, result);
      }
    }
    
    return results;
  }

  async clearCompleted(): Promise<number> {
    const items = await this.getQueueItems('completed');
    return this.removeMultiple(items.map(i => i.id));
  }

  async clearFailed(): Promise<number> {
    const items = await this.getQueueItems('failed');
    return this.removeMultiple(items.map(i => i.id));
  }

  async retryFailed(): Promise<number> {
    const items = await this.getQueueItems('failed');
    let retried = 0;
    
    for (const item of items) {
      await this.updateStatus(item.id, 'pending');
      retried++;
    }
    
    return retried;
  }
}

export const queueService = new QueueService();
