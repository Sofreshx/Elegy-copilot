import React, { useState } from 'react';
import { useIdeas, useDeleteIdea } from '../../hooks/useIdeas';
import { IdeaStatus, IdeaPriority, Idea } from '../../services/ideasDb';
import IdeaCard from './IdeaCard';
import './IdeaList.css';

interface IdeaListProps {
  onSelectIdea: (idea: Idea) => void;
  statusFilter?: IdeaStatus;
  priorityFilter?: IdeaPriority;
  searchQuery?: string;
}

export default function IdeaList({ 
  onSelectIdea, 
  statusFilter, 
  priorityFilter,
  searchQuery 
}: IdeaListProps) {
  const { data: ideas = [], isLoading, error } = useIdeas({ 
    status: statusFilter,
    priority: priorityFilter 
  });
  const deleteIdea = useDeleteIdea();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const filteredIdeas = React.useMemo(() => {
    if (!searchQuery) return ideas;
    const query = searchQuery.toLowerCase();
    return ideas.filter(idea => 
      idea.title.toLowerCase().includes(query) ||
      idea.description.toLowerCase().includes(query) ||
      idea.tags.some(tag => tag.toLowerCase().includes(query))
    );
  }, [ideas, searchQuery]);

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await deleteIdea.mutateAsync(id);
    } finally {
      setDeletingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="idea-list-loading">
        <span className="spinner"></span>
        <p>Loading ideas...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="idea-list-error">
        <p>Failed to load ideas</p>
        <span>{error.message}</span>
      </div>
    );
  }

  if (filteredIdeas.length === 0) {
    return (
      <div className="idea-list-empty">
        {ideas.length === 0 ? (
          <>
            <span className="idea-list-empty-icon">💡</span>
            <p>No ideas yet</p>
            <span>Tap the + button to capture your first idea</span>
          </>
        ) : (
          <>
            <p>No matching ideas</p>
            <span>Try adjusting your filters</span>
          </>
        )}
      </div>
    );
  }

  // Group ideas by status for better organization
  const grouped = {
    draft: filteredIdeas.filter(i => i.status === 'draft'),
    refining: filteredIdeas.filter(i => i.status === 'refining'),
    ready: filteredIdeas.filter(i => i.status === 'ready'),
    queued: filteredIdeas.filter(i => i.status === 'queued'),
    completed: filteredIdeas.filter(i => i.status === 'completed'),
    archived: filteredIdeas.filter(i => i.status === 'archived'),
  };

  const renderGroup = (status: IdeaStatus, label: string, ideas: Idea[]) => {
    if (ideas.length === 0 || (statusFilter && statusFilter !== status)) return null;
    return (
      <div className="idea-group" key={status}>
        <h3 className="idea-group-header">
          {label}
          <span className="idea-group-count">{ideas.length}</span>
        </h3>
        <div className="idea-group-list">
          {ideas.map(idea => (
            <IdeaCard
              key={idea.id}
              idea={idea}
              onClick={() => onSelectIdea(idea)}
              onDelete={() => handleDelete(idea.id)}
              isDeleting={deletingId === idea.id}
            />
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="idea-list">
      {renderGroup('draft', '📝 Drafts', grouped.draft)}
      {renderGroup('refining', '🔄 Refining', grouped.refining)}
      {renderGroup('ready', '✅ Ready', grouped.ready)}
      {renderGroup('queued', '⏳ Queued', grouped.queued)}
      {renderGroup('completed', '🎉 Completed', grouped.completed)}
      {renderGroup('archived', '📦 Archived', grouped.archived)}
    </div>
  );
}
