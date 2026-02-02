import { useState } from 'react';
import { Idea, IdeaStatus, IdeaPriority } from '../services/ideasDb';
import IdeaList from '../components/ideas/IdeaList';
import IdeaForm from '../components/ideas/IdeaForm';
import './Ideas.css';

export default function Ideas() {
  const [selectedIdea, setSelectedIdea] = useState<Idea | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [statusFilter, setStatusFilter] = useState<IdeaStatus | undefined>();
  const [priorityFilter, setPriorityFilter] = useState<IdeaPriority | undefined>();
  const [searchQuery, setSearchQuery] = useState('');

  const handleSelectIdea = (idea: Idea) => {
    setSelectedIdea(idea);
    setShowForm(true);
  };

  const handleNewIdea = () => {
    setSelectedIdea(null);
    setShowForm(true);
  };

  const handleCloseForm = () => {
    setShowForm(false);
    setSelectedIdea(null);
  };

  const handleSaved = () => {
    setShowForm(false);
    setSelectedIdea(null);
  };

  return (
    <div className="page ideas">
      <header className="page-header">
        <h1 className="page-title">Ideas</h1>
        <p className="page-subtitle">Draft and organize your thoughts</p>
      </header>

      <section className="ideas-filters">
        <div className="search-bar">
          <SearchIcon />
          <input
            type="text"
            placeholder="Search ideas..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button className="clear-search" onClick={() => setSearchQuery('')}>
              ×
            </button>
          )}
        </div>

        <div className="filter-row">
          <select
            value={statusFilter ?? ''}
            onChange={(e) => setStatusFilter(e.target.value as IdeaStatus || undefined)}
            className="filter-select"
          >
            <option value="">All Status</option>
            <option value="draft">📝 Draft</option>
            <option value="refining">🔄 Refining</option>
            <option value="ready">✅ Ready</option>
            <option value="queued">⏳ Queued</option>
            <option value="completed">🎉 Completed</option>
            <option value="archived">📦 Archived</option>
          </select>

          <select
            value={priorityFilter ?? ''}
            onChange={(e) => setPriorityFilter(e.target.value as IdeaPriority || undefined)}
            className="filter-select"
          >
            <option value="">All Priority</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </div>
      </section>

      <section className="ideas-content">
        <IdeaList
          onSelectIdea={handleSelectIdea}
          statusFilter={statusFilter}
          priorityFilter={priorityFilter}
          searchQuery={searchQuery}
        />
      </section>

      <button className="fab" onClick={handleNewIdea}>
        <PlusIcon />
      </button>

      {showForm && (
        <IdeaForm
          idea={selectedIdea ?? undefined}
          onClose={handleCloseForm}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  );
}
