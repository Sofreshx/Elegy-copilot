import React, { useState } from "react";
import { getApiClient } from "../services/apiClient";

interface Task {
  id: number;
  user_id: string;
  title: string;
  description: string | null;
  priority: number;
  status: string;
  created_at: string;
  updated_at: string;
}

interface TasksResponse {
  tasks: Task[];
  total: number;
  page: number;
  limit: number;
}

const STATUS_OPTIONS = ["all", "pending", "in-progress", "completed", "failed"] as const;
const PRIORITY_LABELS = ["Low", "Medium", "High", "Critical"];

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newPriority, setNewPriority] = useState(1);

  // Fetch tasks
  const fetchTasks = async () => {
    try {
      setLoading(true);
      setError(null);
      const api = getApiClient();
      const params = filter !== "all" ? `?status=${filter}` : "";
      const data = await api.get<TasksResponse>(`/api/tasks${params}`);
      setTasks(data.tasks);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to load tasks";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  // Load on mount and filter change
  React.useEffect(() => { fetchTasks(); }, [filter]);

  // Create task
  const handleCreate = async () => {
    if (!newTitle.trim()) return;
    try {
      const api = getApiClient();
      await api.post("/api/tasks", {
        title: newTitle.trim(),
        description: newDescription.trim() || null,
        priority: newPriority,
      });
      setNewTitle("");
      setNewDescription("");
      setNewPriority(1);
      setShowCreateForm(false);
      fetchTasks();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to create task";
      setError(message);
    }
  };

  // Update task status
  const handleStatusUpdate = async (taskId: number, newStatus: string) => {
    try {
      const api = getApiClient();
      await api.put(`/api/tasks/${taskId}`, { status: newStatus });
      fetchTasks();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to update task";
      setError(message);
    }
  };

  // Delete task
  const handleDelete = async (taskId: number) => {
    if (!confirm("Delete this task?")) return;
    try {
      const api = getApiClient();
      await api.delete(`/api/tasks/${taskId}`);
      fetchTasks();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to delete task";
      setError(message);
    }
  };

  return (
    <div className="tasks-page">
      <header className="page-header">
        <h1>Task Queue</h1>
        <button onClick={() => setShowCreateForm(!showCreateForm)} className="btn-primary">
          {showCreateForm ? "Cancel" : "+ New Task"}
        </button>
      </header>

      {showCreateForm && (
        <div className="create-form card">
          <input
            type="text"
            placeholder="Task title"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            className="input-field"
          />
          <textarea
            placeholder="Description (optional)"
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            className="input-field"
          />
          <select value={newPriority} onChange={(e) => setNewPriority(Number(e.target.value))} className="input-field">
            {PRIORITY_LABELS.map((label, i) => (
              <option key={i} value={i}>{label}</option>
            ))}
          </select>
          <button onClick={handleCreate} disabled={!newTitle.trim()} className="btn-primary">
            Create Task
          </button>
        </div>
      )}

      {/* Status filter */}
      <div className="filter-bar">
        {STATUS_OPTIONS.map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`filter-btn ${filter === s ? "active" : ""}`}
          >
            {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {error && <div className="error-banner">{error}</div>}

      {loading ? (
        <div className="loading">Loading tasks...</div>
      ) : tasks.length === 0 ? (
        <div className="empty-state">No tasks found</div>
      ) : (
        <ul className="task-list">
          {tasks.map((task) => (
            <li key={task.id} className={`task-item priority-${task.priority}`}>
              <div className="task-header">
                <span className={`status-badge status-${task.status}`}>{task.status}</span>
                <span className="priority-badge">{PRIORITY_LABELS[task.priority] || "?"}</span>
              </div>
              <h3 className="task-title">{task.title}</h3>
              {task.description && <p className="task-description">{task.description}</p>}
              <div className="task-actions">
                {task.status === "pending" && (
                  <button onClick={() => handleStatusUpdate(task.id, "in-progress")} className="btn-sm">Start</button>
                )}
                {task.status === "in-progress" && (
                  <button onClick={() => handleStatusUpdate(task.id, "completed")} className="btn-sm btn-success">Complete</button>
                )}
                <button onClick={() => handleDelete(task.id)} className="btn-sm btn-danger">Delete</button>
              </div>
              <time className="task-time">{new Date(task.created_at).toLocaleString()}</time>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
