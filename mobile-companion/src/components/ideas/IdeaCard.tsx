/**
 * Idea card component.
 */
import { Idea, IdeaPriority, IdeaStatus } from '../../services/ideasDb';
import './IdeaCard.css';

interface IdeaCardProps {
  idea: Idea;
  onClick: () => void;
  onDelete?: () => void;
  isDeleting?: boolean;
}

const STATUS_COLORS: Record<IdeaStatus, string> = {
  draft: '#666',
  refining: '#8b5cf6',
  ready: '#22c55e',
  queued: '#3b82f6',
  completed: '#10b981',
  archived: '#6b7280',
};

const PRIORITY_COLORS: Record<IdeaPriority, string> = {
  low: '#9ca3af',
  medium: '#3b82f6',
  high: '#f59e0b',
  urgent: '#ef4444',
};

export function IdeaCard({ idea, onClick, onDelete, isDeleting }: IdeaCardProps) {
  const formatDate = (ts: number) => {
    const date = new Date(ts);
    return date.toLocaleDateString();
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onDelete && !isDeleting && window.confirm('Delete this idea?')) {
      onDelete();
    }
  };

  return (
    <div className="idea-card" onClick={onClick}>
      <div className="idea-card-header">
        <h3 className="idea-card-title">{idea.title}</h3>
        <span
          className="idea-card-status"
          style={{ backgroundColor: STATUS_COLORS[idea.status] }}
        >
          {idea.status}
        </span>
      </div>
      
      {idea.description && (
        <p className="idea-card-description">
          {idea.description.slice(0, 100)}
          {idea.description.length > 100 ? '...' : ''}
        </p>
      )}
      
      <div className="idea-card-footer">
        <div className="idea-card-tags">
          {idea.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="idea-card-tag">
              {tag}
            </span>
          ))}
          {idea.tags.length > 3 && (
            <span className="idea-card-tag">+{idea.tags.length - 3}</span>
          )}
        </div>
        
        <div className="idea-card-meta">
          <span
            className="idea-card-priority"
            style={{ color: PRIORITY_COLORS[idea.priority] }}
          >
            {idea.priority}
          </span>
          <span className="idea-card-date">{formatDate(idea.updatedAt)}</span>
          {onDelete && (
            <button
              className="idea-card-delete"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? '...' : '×'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default IdeaCard;
