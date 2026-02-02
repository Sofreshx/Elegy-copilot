import React, { useState } from 'react';
import { Idea, IdeaStatus, IdeaPriority } from '../../services/ideasDb';
import { useCreateIdea, useUpdateIdea, useExportIdea } from '../../hooks/useIdeas';
import './IdeaForm.css';

interface IdeaFormProps {
  idea?: Idea;
  onClose: () => void;
  onSaved: () => void;
}

const STATUS_OPTIONS: { value: IdeaStatus; label: string }[] = [
  { value: 'draft', label: '📝 Draft' },
  { value: 'refining', label: '🔄 Refining' },
  { value: 'ready', label: '✅ Ready' },
  { value: 'queued', label: '⏳ Queued' },
  { value: 'completed', label: '🎉 Completed' },
  { value: 'archived', label: '📦 Archived' },
];

const PRIORITY_OPTIONS: { value: IdeaPriority; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];

export default function IdeaForm({ idea, onClose, onSaved }: IdeaFormProps) {
  const [title, setTitle] = useState(idea?.title ?? '');
  const [description, setDescription] = useState(idea?.description ?? '');
  const [tagsInput, setTagsInput] = useState(idea?.tags.join(', ') ?? '');
  const [status, setStatus] = useState<IdeaStatus>(idea?.status ?? 'draft');
  const [priority, setPriority] = useState<IdeaPriority>(idea?.priority ?? 'medium');

  const createIdea = useCreateIdea();
  const updateIdea = useUpdateIdea();
  const exportIdea = useExportIdea();

  const isEditing = !!idea;
  const isSubmitting = createIdea.isPending || updateIdea.isPending;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const tags = tagsInput
      .split(',')
      .map(t => t.trim())
      .filter(t => t.length > 0);

    const data = {
      title: title.trim(),
      description: description.trim(),
      tags,
      status,
      priority,
    };

    try {
      if (isEditing) {
        await updateIdea.mutateAsync({ id: idea.id, changes: data });
      } else {
        await createIdea.mutateAsync(data);
      }
      onSaved();
    } catch (err) {
      console.error('Failed to save idea:', err);
    }
  };

  const handleExport = async () => {
    if (!idea) return;
    const markdown = await exportIdea.mutateAsync(idea.id);
    if (markdown) {
      // Copy to clipboard
      await navigator.clipboard.writeText(markdown);
      alert('Exported to clipboard as Markdown!');
    }
  };

  return (
    <div className="idea-form-overlay" onClick={onClose}>
      <div className="idea-form-modal" onClick={e => e.stopPropagation()}>
        <div className="idea-form-header">
          <h2>{isEditing ? 'Edit Idea' : 'New Idea'}</h2>
          <button className="idea-form-close" onClick={onClose}>×</button>
        </div>

        <form onSubmit={handleSubmit} className="idea-form">
          <div className="idea-form-field">
            <label htmlFor="title">Title</label>
            <input
              id="title"
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="What's your idea?"
              required
              autoFocus
            />
          </div>

          <div className="idea-form-field">
            <label htmlFor="description">Description</label>
            <textarea
              id="description"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Describe your idea in detail..."
              rows={6}
            />
          </div>

          <div className="idea-form-field">
            <label htmlFor="tags">Tags (comma-separated)</label>
            <input
              id="tags"
              type="text"
              value={tagsInput}
              onChange={e => setTagsInput(e.target.value)}
              placeholder="feature, ui, backend"
            />
          </div>

          <div className="idea-form-row">
            <div className="idea-form-field">
              <label htmlFor="status">Status</label>
              <select
                id="status"
                value={status}
                onChange={e => setStatus(e.target.value as IdeaStatus)}
              >
                {STATUS_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div className="idea-form-field">
              <label htmlFor="priority">Priority</label>
              <select
                id="priority"
                value={priority}
                onChange={e => setPriority(e.target.value as IdeaPriority)}
              >
                {PRIORITY_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="idea-form-actions">
            {isEditing && (
              <button 
                type="button" 
                className="idea-form-export"
                onClick={handleExport}
                disabled={exportIdea.isPending}
              >
                📋 Export
              </button>
            )}
            <button type="button" className="idea-form-cancel" onClick={onClose}>
              Cancel
            </button>
            <button 
              type="submit" 
              className="idea-form-submit"
              disabled={isSubmitting || !title.trim()}
            >
              {isSubmitting ? 'Saving...' : (isEditing ? 'Update' : 'Create')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
