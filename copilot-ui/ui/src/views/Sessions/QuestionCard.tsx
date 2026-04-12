import { useState } from 'react';
import { Button } from '../../components';
import type { PendingQuestion } from '../../lib/types';

interface QuestionCardProps {
  question: PendingQuestion;
  onAnswer: (toolCallId: string, answer: string) => void;
}

export default function QuestionCard({ question, onAnswer }: QuestionCardProps) {
  const [customAnswer, setCustomAnswer] = useState('');

  if (question.answered) {
    return (
      <div className="question-card question-card-answered" data-testid="question-card-answered">
        <div className="question-card-header">
          <span className="question-card-icon">❓</span>
          <span className="question-card-label">Question (answered)</span>
        </div>
        <div className="question-card-text" data-testid="question-card-text">
          {question.question}
        </div>
        <div className="question-card-answer" data-testid="question-card-answer-value">
          ✓ {question.answeredValue}
        </div>
      </div>
    );
  }

  return (
    <div className="question-card question-card-pending" data-testid="question-card-pending">
      <div className="question-card-header">
        <span className="question-card-icon">❓</span>
        <span className="question-card-label">Model is asking for input</span>
      </div>
      <div className="question-card-text" data-testid="question-card-text">
        {question.question}
      </div>

      {question.options && question.options.length > 0 && (
        <div className="question-card-options" data-testid="question-card-options">
          {question.options.map((opt, i) => (
            <button
              key={i}
              type="button"
              className={`question-card-option ${opt.recommended ? 'question-card-option-recommended' : ''}`}
              data-testid={`question-card-option-${i}`}
              onClick={() => onAnswer(question.toolCallId, opt.value)}
            >
              {opt.label}
              {opt.recommended && <span className="question-card-recommended-badge">recommended</span>}
            </button>
          ))}
        </div>
      )}

      <div className="question-card-custom" data-testid="question-card-custom-input">
        <textarea
          className="question-card-textarea"
          placeholder="Type a custom answer…"
          rows={2}
          value={customAnswer}
          onChange={(e) => setCustomAnswer(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && customAnswer.trim()) {
              e.preventDefault();
              onAnswer(question.toolCallId, customAnswer.trim());
            }
          }}
        />
        <Button
          variant="primary"
          size="sm"
          testId="question-card-send-button"
          disabled={!customAnswer.trim()}
          onClick={() => {
            if (customAnswer.trim()) {
              onAnswer(question.toolCallId, customAnswer.trim());
            }
          }}
        >
          Answer
        </Button>
      </div>
    </div>
  );
}
