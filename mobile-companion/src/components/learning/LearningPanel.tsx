/**
 * Learning mode panel component for managing checkpoints and reviewing.
 */
import { useState, useEffect } from 'react';
import {
  learningService,
  Checkpoint,
  LearningProgress,
} from '../../services/learningService';
import './LearningPanel.css';

interface LearningPanelProps {
  threadId?: string;
  onCreateCheckpoint?: (content: string) => void;
  isOpen: boolean;
  onClose: () => void;
}

type TabType = 'checkpoints' | 'review' | 'progress';

export default function LearningPanel({
  threadId,
  isOpen,
  onClose,
}: LearningPanelProps) {
  const [activeTab, setActiveTab] = useState<TabType>('checkpoints');
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [dueCheckpoints, setDueCheckpoints] = useState<Checkpoint[]>([]);
  const [progress, setProgress] = useState<LearningProgress | null>(null);
  const [newSummary, setNewSummary] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newTags, setNewTags] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [reviewingCheckpoint, setReviewingCheckpoint] = useState<Checkpoint | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen, threadId]);

  const loadData = async () => {
    const [allCheckpoints, due, stats] = await Promise.all([
      threadId
        ? learningService.getCheckpointsByThread(threadId)
        : Promise.resolve([]),
      learningService.getDueCheckpoints(),
      learningService.getProgress(),
    ]);
    setCheckpoints(allCheckpoints);
    setDueCheckpoints(due);
    setProgress(stats);
  };

  const handleAddCheckpoint = async () => {
    if (!threadId || !newSummary.trim()) return;

    await learningService.createCheckpoint(
      threadId,
      newContent.trim() || newSummary,
      newSummary.trim(),
      newTags.split(',').map((t) => t.trim()).filter(Boolean)
    );

    setNewSummary('');
    setNewContent('');
    setNewTags('');
    setIsAdding(false);
    loadData();
  };

  const handleDelete = async (id: string) => {
    await learningService.deleteCheckpoint(id);
    loadData();
  };

  const handleReview = async (confidence: number) => {
    if (!reviewingCheckpoint) return;

    await learningService.recordReview(reviewingCheckpoint.id, confidence);
    setReviewingCheckpoint(null);
    loadData();
  };

  const startNextReview = () => {
    if (dueCheckpoints.length > 0) {
      setReviewingCheckpoint(dueCheckpoints[0]!);
      setActiveTab('review');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="learning-panel-overlay" onClick={onClose}>
      <div className="learning-panel" onClick={(e) => e.stopPropagation()}>
        <header className="learning-panel-header">
          <h2>Learning Mode</h2>
          <button className="close-button" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="learning-tabs">
          <button
            className={activeTab === 'checkpoints' ? 'active' : ''}
            onClick={() => setActiveTab('checkpoints')}
          >
            Checkpoints
          </button>
          <button
            className={activeTab === 'review' ? 'active' : ''}
            onClick={() => setActiveTab('review')}
          >
            Review ({dueCheckpoints.length})
          </button>
          <button
            className={activeTab === 'progress' ? 'active' : ''}
            onClick={() => setActiveTab('progress')}
          >
            Progress
          </button>
        </div>

        <div className="learning-content">
          {activeTab === 'checkpoints' && (
            <div className="checkpoints-tab">
              {!isAdding && (
                <button className="add-checkpoint-button" onClick={() => setIsAdding(true)}>
                  + Add Checkpoint
                </button>
              )}

              {isAdding && (
                <div className="add-checkpoint-form">
                  <input
                    type="text"
                    placeholder="Summary (what did you learn?)"
                    value={newSummary}
                    onChange={(e) => setNewSummary(e.target.value)}
                    autoFocus
                  />
                  <textarea
                    placeholder="Details (optional)"
                    value={newContent}
                    onChange={(e) => setNewContent(e.target.value)}
                    rows={3}
                  />
                  <input
                    type="text"
                    placeholder="Tags (comma-separated)"
                    value={newTags}
                    onChange={(e) => setNewTags(e.target.value)}
                  />
                  <div className="form-actions">
                    <button onClick={() => setIsAdding(false)}>Cancel</button>
                    <button
                      onClick={handleAddCheckpoint}
                      disabled={!newSummary.trim()}
                      className="primary"
                    >
                      Save
                    </button>
                  </div>
                </div>
              )}

              <div className="checkpoints-list">
                {checkpoints.length === 0 ? (
                  <p className="empty-message">
                    No checkpoints yet. Save important learnings to review later!
                  </p>
                ) : (
                  checkpoints.map((cp) => (
                    <div key={cp.id} className="checkpoint-card">
                      <div className="checkpoint-header">
                        <span className="checkpoint-summary">{cp.summary}</span>
                        <button
                          className="delete-button"
                          onClick={() => handleDelete(cp.id)}
                        >
                          ×
                        </button>
                      </div>
                      {cp.tags.length > 0 && (
                        <div className="checkpoint-tags">
                          {cp.tags.map((tag) => (
                            <span key={tag} className="tag">
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="checkpoint-meta">
                        <span>Confidence: {cp.confidence}/5</span>
                        <span>Reviews: {cp.reviewCount}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {activeTab === 'review' && (
            <div className="review-tab">
              {reviewingCheckpoint ? (
                <div className="review-card">
                  <h3>Review this checkpoint:</h3>
                  <p className="review-summary">{reviewingCheckpoint.summary}</p>
                  {reviewingCheckpoint.content !== reviewingCheckpoint.summary && (
                    <p className="review-content">{reviewingCheckpoint.content}</p>
                  )}

                  <p className="confidence-prompt">How well do you remember this?</p>
                  <div className="confidence-buttons">
                    {[0, 1, 2, 3, 4, 5].map((level) => (
                      <button
                        key={level}
                        onClick={() => handleReview(level)}
                        className={`confidence-${level}`}
                      >
                        {level === 0
                          ? '😵 Forgot'
                          : level === 1
                            ? '😕 Hard'
                            : level === 2
                              ? '🤔 Okay'
                              : level === 3
                                ? '🙂 Good'
                                : level === 4
                                  ? '😊 Easy'
                                  : '🎯 Perfect'}
                      </button>
                    ))}
                  </div>
                </div>
              ) : dueCheckpoints.length > 0 ? (
                <div className="start-review">
                  <p>You have {dueCheckpoints.length} checkpoint(s) due for review!</p>
                  <button className="start-review-button" onClick={startNextReview}>
                    Start Review
                  </button>
                </div>
              ) : (
                <div className="no-reviews">
                  <p className="empty-icon">🎉</p>
                  <p>All caught up! No reviews due.</p>
                  <p className="hint">Check back later or add more checkpoints.</p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'progress' && progress && (
            <div className="progress-tab">
              <div className="progress-stats">
                <div className="stat-card">
                  <span className="stat-value">{progress.totalCheckpoints}</span>
                  <span className="stat-label">Total Checkpoints</span>
                </div>
                <div className="stat-card">
                  <span className="stat-value">{progress.mastered}</span>
                  <span className="stat-label">Mastered</span>
                </div>
                <div className="stat-card">
                  <span className="stat-value">{progress.dueForReview}</span>
                  <span className="stat-label">Due for Review</span>
                </div>
                <div className="stat-card streak">
                  <span className="stat-value">{progress.streakDays}</span>
                  <span className="stat-label">Day Streak 🔥</span>
                </div>
              </div>

              <div className="progress-bar-section">
                <h4>Mastery Progress</h4>
                <div className="progress-bar">
                  <div
                    className="progress-fill"
                    style={{
                      width:
                        progress.totalCheckpoints > 0
                          ? `${(progress.mastered / progress.totalCheckpoints) * 100}%`
                          : '0%',
                    }}
                  />
                </div>
                <p className="progress-text">
                  {progress.mastered} / {progress.totalCheckpoints} mastered
                </p>
              </div>

              {progress.lastStudyDate && (
                <p className="last-study">
                  Last study session: {new Date(progress.lastStudyDate).toLocaleDateString()}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
