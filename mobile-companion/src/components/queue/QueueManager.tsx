import { useState, useEffect, useCallback } from 'react';
import { 
  queueService, 
  QueueItem, 
  QueueStats, 
  Priority 
} from '../../services/queueService';
import './QueueManager.css';

interface QueueManagerProps {
  onClose: () => void;
  onExecute?: (item: QueueItem) => Promise<void>;
}

export function QueueManager({ onClose, onExecute }: QueueManagerProps) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [stats, setStats] = useState<QueueStats | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionProgress, setExecutionProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    const [queueItems, queueStats] = await Promise.all([
      queueService.getQueueItems(),
      queueService.getStats(),
    ]);
    setItems(queueItems);
    setStats(queueStats);
  }, []);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  const handleToggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const handleSelectAll = () => {
    const pendingItems = items.filter(i => i.status === 'pending');
    if (selectedIds.size === pendingItems.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(pendingItems.map(i => i.id)));
    }
  };

  const handlePriorityChange = async (itemId: string, priority: Priority) => {
    await queueService.updatePriority(itemId, priority);
    await loadQueue();
  };

  const handleRemove = async (itemId: string) => {
    await queueService.removeFromQueue(itemId);
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      newSet.delete(itemId);
      return newSet;
    });
    await loadQueue();
  };

  const handleRemoveSelected = async () => {
    await queueService.removeMultiple(Array.from(selectedIds));
    setSelectedIds(new Set());
    await loadQueue();
  };

  const handleSortByPriority = async () => {
    await queueService.sortByPriority();
    await loadQueue();
  };

  const handleClearCompleted = async () => {
    await queueService.clearCompleted();
    await loadQueue();
  };

  const handleRetryFailed = async () => {
    await queueService.retryFailed();
    await loadQueue();
  };

  const handleExecuteSelected = async () => {
    if (!onExecute || selectedIds.size === 0) return;
    
    setIsExecuting(true);
    setExecutionProgress({ current: 0, total: selectedIds.size });
    
    await queueService.executeBatch(
      Array.from(selectedIds),
      onExecute,
      (completed, total) => {
        setExecutionProgress({ current: completed, total });
      }
    );
    
    setIsExecuting(false);
    setExecutionProgress(null);
    setSelectedIds(new Set());
    await loadQueue();
  };

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedId(id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (id !== draggedId) {
      setDragOverId(id);
    }
  };

  const handleDragLeave = () => {
    setDragOverId(null);
  };

  const handleDrop = async (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    
    if (!draggedId || draggedId === targetId) {
      setDraggedId(null);
      setDragOverId(null);
      return;
    }
    
    // Reorder: move draggedId to position of targetId
    const currentOrder = items.map(i => i.id);
    const draggedIndex = currentOrder.indexOf(draggedId);
    const targetIndex = currentOrder.indexOf(targetId);
    
    if (draggedIndex !== -1 && targetIndex !== -1) {
      currentOrder.splice(draggedIndex, 1);
      currentOrder.splice(targetIndex, 0, draggedId);
      await queueService.reorderItems(currentOrder);
      await loadQueue();
    }
    
    setDraggedId(null);
    setDragOverId(null);
  };

  const handleDragEnd = () => {
    setDraggedId(null);
    setDragOverId(null);
  };

  const formatTime = (minutes: number) => {
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  };

  const getPriorityColor = (priority: Priority) => {
    switch (priority) {
      case 'high': return 'priority-high';
      case 'medium': return 'priority-medium';
      case 'low': return 'priority-low';
    }
  };

  const getStatusIcon = (status: QueueItem['status']) => {
    switch (status) {
      case 'pending': return '⏳';
      case 'executing': return '⚙️';
      case 'completed': return '✅';
      case 'failed': return '❌';
    }
  };

  const pendingItems = items.filter(i => i.status === 'pending');
  const completedItems = items.filter(i => i.status === 'completed');
  const failedItems = items.filter(i => i.status === 'failed');

  return (
    <div className="queue-manager-overlay" onClick={onClose}>
      <div className="queue-manager" onClick={e => e.stopPropagation()}>
        <header className="queue-header">
          <h2>Queue Manager</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </header>

        {stats && (
          <div className="queue-stats">
            <div className="stat">
              <span className="stat-value">{stats.pending}</span>
              <span className="stat-label">Pending</span>
            </div>
            <div className="stat">
              <span className="stat-value">{stats.executing}</span>
              <span className="stat-label">Running</span>
            </div>
            <div className="stat">
              <span className="stat-value">{stats.completed}</span>
              <span className="stat-label">Done</span>
            </div>
            {stats.estimatedTotalMinutes > 0 && (
              <div className="stat">
                <span className="stat-value">{formatTime(stats.estimatedTotalMinutes)}</span>
                <span className="stat-label">Est. Time</span>
              </div>
            )}
          </div>
        )}

        <div className="queue-actions">
          <button 
            className="action-button"
            onClick={handleSelectAll}
            disabled={pendingItems.length === 0}
          >
            {selectedIds.size === pendingItems.length && pendingItems.length > 0 
              ? 'Deselect All' 
              : 'Select All'}
          </button>
          <button 
            className="action-button"
            onClick={handleSortByPriority}
            disabled={items.length < 2}
          >
            Sort by Priority
          </button>
          {selectedIds.size > 0 && (
            <>
              <button 
                className="action-button primary"
                onClick={handleExecuteSelected}
                disabled={isExecuting || !onExecute}
              >
                {isExecuting 
                  ? `Running ${executionProgress?.current}/${executionProgress?.total}...`
                  : `Execute (${selectedIds.size})`}
              </button>
              <button 
                className="action-button danger"
                onClick={handleRemoveSelected}
                disabled={isExecuting}
              >
                Remove ({selectedIds.size})
              </button>
            </>
          )}
        </div>

        {isExecuting && executionProgress && (
          <div className="execution-progress">
            <div 
              className="progress-fill"
              style={{ width: `${(executionProgress.current / executionProgress.total) * 100}%` }}
            />
          </div>
        )}

        <div className="queue-content">
          {pendingItems.length === 0 && completedItems.length === 0 && failedItems.length === 0 ? (
            <div className="empty-queue">
              <p className="empty-icon">📋</p>
              <p>Queue is empty</p>
              <p className="hint">Add ideas to the queue from the Ideas view</p>
            </div>
          ) : (
            <>
              {pendingItems.length > 0 && (
                <section className="queue-section">
                  <h3>Pending ({pendingItems.length})</h3>
                  <div className="queue-list">
                    {pendingItems.map(item => (
                      <div
                        key={item.id}
                        className={`queue-item ${selectedIds.has(item.id) ? 'selected' : ''} ${
                          draggedId === item.id ? 'dragging' : ''
                        } ${dragOverId === item.id ? 'drag-over' : ''}`}
                        draggable
                        onDragStart={e => handleDragStart(e, item.id)}
                        onDragOver={e => handleDragOver(e, item.id)}
                        onDragLeave={handleDragLeave}
                        onDrop={e => handleDrop(e, item.id)}
                        onDragEnd={handleDragEnd}
                      >
                        <div className="item-drag-handle">⋮⋮</div>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(item.id)}
                          onChange={() => handleToggleSelect(item.id)}
                          className="item-checkbox"
                        />
                        <div className="item-content">
                          <div className="item-header">
                            <span className="item-status">{getStatusIcon(item.status)}</span>
                            <span className="item-title">{item.title}</span>
                          </div>
                          <div className="item-meta">
                            {item.agentName && (
                              <span className="agent-name">{item.agentName}</span>
                            )}
                            {item.estimatedMinutes && (
                              <span className="est-time">~{formatTime(item.estimatedMinutes)}</span>
                            )}
                          </div>
                        </div>
                        <select
                          value={item.priority}
                          onChange={e => handlePriorityChange(item.id, e.target.value as Priority)}
                          className={`priority-select ${getPriorityColor(item.priority)}`}
                        >
                          <option value="high">High</option>
                          <option value="medium">Medium</option>
                          <option value="low">Low</option>
                        </select>
                        <button 
                          className="remove-button"
                          onClick={() => handleRemove(item.id)}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {failedItems.length > 0 && (
                <section className="queue-section failed">
                  <div className="section-header">
                    <h3>Failed ({failedItems.length})</h3>
                    <button 
                      className="section-action"
                      onClick={handleRetryFailed}
                    >
                      Retry All
                    </button>
                  </div>
                  <div className="queue-list">
                    {failedItems.map(item => (
                      <div key={item.id} className="queue-item failed">
                        <div className="item-content">
                          <div className="item-header">
                            <span className="item-status">{getStatusIcon(item.status)}</span>
                            <span className="item-title">{item.title}</span>
                          </div>
                          {item.error && (
                            <div className="item-error">{item.error}</div>
                          )}
                        </div>
                        <button 
                          className="remove-button"
                          onClick={() => handleRemove(item.id)}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {completedItems.length > 0 && (
                <section className="queue-section completed">
                  <div className="section-header">
                    <h3>Completed ({completedItems.length})</h3>
                    <button 
                      className="section-action"
                      onClick={handleClearCompleted}
                    >
                      Clear All
                    </button>
                  </div>
                  <div className="queue-list">
                    {completedItems.map(item => (
                      <div key={item.id} className="queue-item completed">
                        <div className="item-content">
                          <div className="item-header">
                            <span className="item-status">{getStatusIcon(item.status)}</span>
                            <span className="item-title">{item.title}</span>
                          </div>
                        </div>
                        <button 
                          className="remove-button"
                          onClick={() => handleRemove(item.id)}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
