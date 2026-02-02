// Offline Sync Service
// Handles offline change tracking, sync queue, and conflict resolution

const DB_NAME = 'mobile-companion-db';
const SYNC_QUEUE_STORE = 'sync-queue';
const SYNC_STATE_STORE = 'sync-state';
const DB_VERSION = 6;

export type SyncOperation = 'create' | 'update' | 'delete';
export type SyncStatus = 'pending' | 'syncing' | 'synced' | 'conflict' | 'failed';
export type EntityType = 'idea' | 'chat' | 'checkpoint' | 'reminder' | 'queue-item';

export interface SyncQueueItem {
  id: string;
  entityType: EntityType;
  entityId: string;
  operation: SyncOperation;
  data: unknown;
  timestamp: number;
  status: SyncStatus;
  retryCount: number;
  lastError?: string;
  serverVersion?: number;
  localVersion: number;
}

export interface ConflictInfo {
  queueItem: SyncQueueItem;
  localData: unknown;
  serverData: unknown;
  serverTimestamp: number;
}

export type ConflictResolution = 'keep-local' | 'keep-server' | 'merge';

export interface SyncState {
  lastSyncTime: number;
  isOnline: boolean;
  isSyncing: boolean;
  pendingCount: number;
  conflictCount: number;
}

type SyncStateListener = (state: SyncState) => void;
type ConflictHandler = (conflict: ConflictInfo) => Promise<ConflictResolution>;

class OfflineSyncService {
  private dbPromise: Promise<IDBDatabase>;
  private isOnline: boolean = navigator.onLine;
  private isSyncing: boolean = false;
  private listeners: Set<SyncStateListener> = new Set();
  private conflictHandler: ConflictHandler | null = null;
  private syncInProgress: Promise<void> | null = null;

  constructor() {
    this.dbPromise = this.initDb();
    this.setupNetworkListeners();
  }

  private initDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        if (!db.objectStoreNames.contains(SYNC_QUEUE_STORE)) {
          const store = db.createObjectStore(SYNC_QUEUE_STORE, { keyPath: 'id' });
          store.createIndex('entityType', 'entityType');
          store.createIndex('entityId', 'entityId');
          store.createIndex('status', 'status');
          store.createIndex('timestamp', 'timestamp');
        }
        
        if (!db.objectStoreNames.contains(SYNC_STATE_STORE)) {
          db.createObjectStore(SYNC_STATE_STORE, { keyPath: 'id' });
        }
      };
    });
  }

  private setupNetworkListeners(): void {
    window.addEventListener('online', () => {
      this.isOnline = true;
      this.notifyListeners();
      // Auto-sync when back online
      this.sync();
    });
    
    window.addEventListener('offline', () => {
      this.isOnline = false;
      this.notifyListeners();
    });
  }

  // Track a change for sync
  async trackChange(
    entityType: EntityType,
    entityId: string,
    operation: SyncOperation,
    data: unknown,
    localVersion: number = 1
  ): Promise<SyncQueueItem> {
    const db = await this.dbPromise;
    
    // Check for existing pending change to same entity
    const existing = await this.getPendingForEntity(entityType, entityId);
    
    const queueItem: SyncQueueItem = {
      id: existing?.id || `sync-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      entityType,
      entityId,
      operation: this.mergeOperations(existing?.operation, operation),
      data,
      timestamp: Date.now(),
      status: 'pending',
      retryCount: existing?.retryCount || 0,
      localVersion,
    };
    
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SYNC_QUEUE_STORE, 'readwrite');
      const store = tx.objectStore(SYNC_QUEUE_STORE);
      const request = store.put(queueItem);
      
      request.onsuccess = () => {
        this.notifyListeners();
        resolve(queueItem);
      };
      request.onerror = () => reject(request.error);
    });
  }

  private mergeOperations(
    existing: SyncOperation | undefined, 
    newOp: SyncOperation
  ): SyncOperation {
    if (!existing) return newOp;
    
    // Create + Delete = nothing (could remove from queue)
    // Create + Update = Create (with updated data)
    // Update + Delete = Delete
    // Update + Update = Update
    
    if (existing === 'create' && newOp === 'update') return 'create';
    if (existing === 'create' && newOp === 'delete') return 'delete';
    if (existing === 'update' && newOp === 'delete') return 'delete';
    
    return newOp;
  }

  private async getPendingForEntity(
    entityType: EntityType,
    entityId: string
  ): Promise<SyncQueueItem | null> {
    const db = await this.dbPromise;
    
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SYNC_QUEUE_STORE, 'readonly');
      const store = tx.objectStore(SYNC_QUEUE_STORE);
      const request = store.getAll();
      
      request.onsuccess = () => {
        const items = request.result as SyncQueueItem[];
        const match = items.find(
          i => i.entityType === entityType && 
               i.entityId === entityId && 
               i.status === 'pending'
        );
        resolve(match || null);
      };
      
      request.onerror = () => reject(request.error);
    });
  }

  async getPendingItems(): Promise<SyncQueueItem[]> {
    const db = await this.dbPromise;
    
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SYNC_QUEUE_STORE, 'readonly');
      const store = tx.objectStore(SYNC_QUEUE_STORE);
      const index = store.index('status');
      const request = index.getAll('pending');
      
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getConflicts(): Promise<SyncQueueItem[]> {
    const db = await this.dbPromise;
    
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SYNC_QUEUE_STORE, 'readonly');
      const store = tx.objectStore(SYNC_QUEUE_STORE);
      const index = store.index('status');
      const request = index.getAll('conflict');
      
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async updateQueueItem(item: SyncQueueItem): Promise<void> {
    const db = await this.dbPromise;
    
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SYNC_QUEUE_STORE, 'readwrite');
      const store = tx.objectStore(SYNC_QUEUE_STORE);
      const request = store.put(item);
      
      request.onsuccess = () => {
        this.notifyListeners();
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  async removeQueueItem(id: string): Promise<void> {
    const db = await this.dbPromise;
    
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SYNC_QUEUE_STORE, 'readwrite');
      const store = tx.objectStore(SYNC_QUEUE_STORE);
      const request = store.delete(id);
      
      request.onsuccess = () => {
        this.notifyListeners();
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  setConflictHandler(handler: ConflictHandler): void {
    this.conflictHandler = handler;
  }

  // Main sync function
  async sync(): Promise<void> {
    if (!this.isOnline || this.isSyncing) {
      return;
    }
    
    // Return existing sync promise if one is in progress
    if (this.syncInProgress) {
      return this.syncInProgress;
    }
    
    this.syncInProgress = this.performSync();
    
    try {
      await this.syncInProgress;
    } finally {
      this.syncInProgress = null;
    }
  }

  private async performSync(): Promise<void> {
    this.isSyncing = true;
    this.notifyListeners();
    
    try {
      const pendingItems = await this.getPendingItems();
      
      // Sort by timestamp to maintain order
      pendingItems.sort((a, b) => a.timestamp - b.timestamp);
      
      for (const item of pendingItems) {
        await this.syncItem(item);
      }
      
      await this.updateLastSyncTime();
    } finally {
      this.isSyncing = false;
      this.notifyListeners();
    }
  }

  private async syncItem(item: SyncQueueItem): Promise<void> {
    item.status = 'syncing';
    await this.updateQueueItem(item);
    
    try {
      // In a real implementation, this would call the relay/server
      // For now, simulate the sync based on entity type
      const result = await this.sendToServer(item);
      
      if (result.conflict) {
        item.status = 'conflict';
        item.serverVersion = result.serverVersion;
        await this.updateQueueItem(item);
        
        // Handle conflict if handler is set
        if (this.conflictHandler) {
          const resolution = await this.conflictHandler({
            queueItem: item,
            localData: item.data,
            serverData: result.serverData,
            serverTimestamp: result.serverTimestamp || Date.now(),
          });
          
          await this.resolveConflict(item.id, resolution, result.serverData);
        }
      } else if (result.success) {
        // Remove from queue on success
        await this.removeQueueItem(item.id);
      } else {
        // Mark as failed
        item.status = 'failed';
        item.retryCount++;
        item.lastError = result.error || 'Unknown error';
        await this.updateQueueItem(item);
      }
    } catch (err) {
      item.status = 'failed';
      item.retryCount++;
      item.lastError = err instanceof Error ? err.message : 'Network error';
      await this.updateQueueItem(item);
    }
  }

  // Simulated server sync - would be replaced with actual relay calls
  private async sendToServer(_item: SyncQueueItem): Promise<{
    success: boolean;
    conflict?: boolean;
    serverVersion?: number;
    serverData?: unknown;
    serverTimestamp?: number;
    error?: string;
  }> {
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // For now, always succeed (in real implementation, would call relay)
    // Could randomly generate conflicts for testing
    return { success: true };
  }

  async resolveConflict(
    queueItemId: string,
    resolution: ConflictResolution,
    serverData?: unknown
  ): Promise<void> {
    const db = await this.dbPromise;
    
    const item = await new Promise<SyncQueueItem | null>((resolve, reject) => {
      const tx = db.transaction(SYNC_QUEUE_STORE, 'readonly');
      const store = tx.objectStore(SYNC_QUEUE_STORE);
      const request = store.get(queueItemId);
      
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
    
    if (!item) return;
    
    switch (resolution) {
      case 'keep-local':
        // Re-queue with incremented version to force overwrite
        item.status = 'pending';
        item.localVersion++;
        await this.updateQueueItem(item);
        // Trigger sync again
        setTimeout(() => this.sync(), 100);
        break;
        
      case 'keep-server':
        // Accept server version, remove from queue
        await this.removeQueueItem(queueItemId);
        // Would need to update local storage with server data
        break;
        
      case 'merge':
        // Merge logic would be entity-specific
        // For now, default to keeping local with updated version
        item.status = 'pending';
        item.localVersion++;
        item.data = this.mergeData(item.data, serverData);
        await this.updateQueueItem(item);
        setTimeout(() => this.sync(), 100);
        break;
    }
    
    this.notifyListeners();
  }

  private mergeData(local: unknown, server: unknown): unknown {
    // Simple merge: prefer local values, but include server keys not in local
    if (typeof local === 'object' && typeof server === 'object' && 
        local !== null && server !== null) {
      return { ...server, ...local };
    }
    return local;
  }

  private async updateLastSyncTime(): Promise<void> {
    const db = await this.dbPromise;
    
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SYNC_STATE_STORE, 'readwrite');
      const store = tx.objectStore(SYNC_STATE_STORE);
      const request = store.put({ id: 'lastSync', timestamp: Date.now() });
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getLastSyncTime(): Promise<number | null> {
    const db = await this.dbPromise;
    
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SYNC_STATE_STORE, 'readonly');
      const store = tx.objectStore(SYNC_STATE_STORE);
      const request = store.get('lastSync');
      
      request.onsuccess = () => {
        const result = request.result;
        resolve(result?.timestamp || null);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getSyncState(): Promise<SyncState> {
    const [pendingItems, conflicts, lastSyncTime] = await Promise.all([
      this.getPendingItems(),
      this.getConflicts(),
      this.getLastSyncTime(),
    ]);
    
    return {
      lastSyncTime: lastSyncTime || 0,
      isOnline: this.isOnline,
      isSyncing: this.isSyncing,
      pendingCount: pendingItems.length,
      conflictCount: conflicts.length,
    };
  }

  subscribe(listener: SyncStateListener): () => void {
    this.listeners.add(listener);
    // Immediately send current state
    this.getSyncState().then(state => listener(state));
    
    return () => {
      this.listeners.delete(listener);
    };
  }

  private async notifyListeners(): Promise<void> {
    const state = await this.getSyncState();
    this.listeners.forEach(listener => listener(state));
  }

  // Force sync now
  async forceSync(): Promise<void> {
    if (!this.isOnline) {
      throw new Error('Cannot sync while offline');
    }
    return this.sync();
  }

  // Retry failed items
  async retryFailed(): Promise<number> {
    const db = await this.dbPromise;
    
    const failed = await new Promise<SyncQueueItem[]>((resolve, reject) => {
      const tx = db.transaction(SYNC_QUEUE_STORE, 'readonly');
      const store = tx.objectStore(SYNC_QUEUE_STORE);
      const index = store.index('status');
      const request = index.getAll('failed');
      
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    
    for (const item of failed) {
      item.status = 'pending';
      await this.updateQueueItem(item);
    }
    
    // Trigger sync
    await this.sync();
    
    return failed.length;
  }

  // Clear all sync data (for testing/reset)
  async clearSyncData(): Promise<void> {
    const db = await this.dbPromise;
    
    return new Promise((resolve, reject) => {
      const tx = db.transaction([SYNC_QUEUE_STORE, SYNC_STATE_STORE], 'readwrite');
      tx.objectStore(SYNC_QUEUE_STORE).clear();
      tx.objectStore(SYNC_STATE_STORE).clear();
      
      tx.oncomplete = () => {
        this.notifyListeners();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  }
}

export const offlineSyncService = new OfflineSyncService();
