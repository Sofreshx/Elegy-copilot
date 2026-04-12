import { useState, useEffect } from 'react';
import { FormInput } from '../../../components';
import { SESSION_AGENTS } from '../../../constants/sessionAgents';
import type { SessionWizardState } from '../sessionWizardStore';
import { sessionWizardStore } from '../sessionWizardStore';

interface ObjectiveStepProps {
  state: SessionWizardState;
}

export default function ObjectiveStep({ state }: ObjectiveStepProps) {
  const [showTasks, setShowTasks] = useState(Boolean(state.taskIds));

  useEffect(() => {
    if (state.selectedProject?.repoPath) {
      sessionWizardStore.loadBacklog();
    }
  }, [state.selectedProject?.repoPath]);

  return (
    <div className="session-wizard-objective-step" data-testid="session-wizard-objective-step">
      <div className="session-wizard-agent-section" data-testid="session-wizard-agent-section">
        <span className="session-wizard-agent-section-label">Choose an agent</span>
        <div className="session-wizard-agent-grid" data-testid="session-wizard-agent-grid">
          {SESSION_AGENTS.map((agent) => (
            <div
              key={agent.id}
              role="button"
              tabIndex={0}
              className={`session-wizard-agent-card ${state.agentId === agent.id ? 'session-wizard-agent-card-active' : ''}`}
              data-testid={`session-wizard-agent-${agent.id}`}
              onClick={() => sessionWizardStore.setAgentId(agent.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  sessionWizardStore.setAgentId(agent.id);
                }
              }}
            >
              <span className="session-wizard-agent-card-icon">{agent.icon}</span>
              <span className="session-wizard-agent-card-label">{agent.label}</span>
              <span className="session-wizard-agent-card-desc">{agent.description}</span>
            </div>
          ))}
        </div>
      </div>

      <label className="session-wizard-objective-label" htmlFor="session-wizard-objective-textarea">
        What should be done?
      </label>
      <textarea
        id="session-wizard-objective-textarea"
        className="session-wizard-objective-textarea"
        data-testid="session-wizard-objective-textarea"
        placeholder="Describe what you want to accomplish…"
        rows={4}
        value={state.objective}
        onChange={(e) => sessionWizardStore.setObjective(e.target.value)}
      />

      {state.objective && state.selectedBulletIds.length > 0 && (
        <div className="objective-prefill-hint" data-testid="objective-prefill-hint">
          📋 Pre-filled from backlog ({state.selectedBulletIds.length} item{state.selectedBulletIds.length !== 1 ? 's' : ''})
        </div>
      )}

      {/* Backlog items */}
      <div className="session-wizard-backlog-section" data-testid="session-wizard-backlog-section">
        <span className="session-wizard-backlog-label">Backlog items</span>
        {state.backlogLoading && (
          <div className="session-wizard-backlog-loading" data-testid="session-wizard-backlog-loading">
            Loading backlog…
          </div>
        )}
        {!state.backlogLoading && state.backlogBullets.length === 0 && (
          <div className="session-wizard-backlog-empty" data-testid="session-wizard-backlog-empty">
            No backlog items for this project.
          </div>
        )}
        {!state.backlogLoading && state.backlogBullets.length > 0 && (
          <div className="session-wizard-backlog-list" data-testid="session-wizard-backlog-list">
            {state.backlogBullets.map((bullet) => (
              <label
                key={bullet.id}
                className={`session-wizard-backlog-item ${state.selectedBulletIds.includes(bullet.id) ? 'session-wizard-backlog-item-selected' : ''}`}
                data-testid={`session-wizard-backlog-item-${bullet.id}`}
              >
                <input
                  type="checkbox"
                  checked={state.selectedBulletIds.includes(bullet.id)}
                  onChange={() => sessionWizardStore.toggleBullet(bullet.id)}
                />
                <span className="session-wizard-backlog-item-id">{bullet.id}</span>
                <span className="session-wizard-backlog-item-title">{bullet.title}</span>
                <span className="session-wizard-backlog-item-state">{bullet.state}</span>
              </label>
            ))}
          </div>
        )}
        {state.selectedBulletIds.length > 0 && (
          <button
            type="button"
            className="session-wizard-backlog-clear"
            data-testid="session-wizard-backlog-clear"
            onClick={() => sessionWizardStore.clearBullets()}
          >
            Clear selection ({state.selectedBulletIds.length})
          </button>
        )}
      </div>

      <div className="session-wizard-tasks-section">
        <button
          type="button"
          className="session-wizard-tasks-toggle"
          data-testid="session-wizard-tasks-toggle"
          onClick={() => setShowTasks((prev) => !prev)}
          aria-expanded={showTasks}
        >
          {showTasks ? '▾ Link tasks' : '▸ Link tasks'}
        </button>

        {showTasks ? (
          <FormInput
            label="Task IDs (comma-separated)"
            placeholder="task-1, task-2"
            value={state.taskIds}
            onValueChange={(v) => sessionWizardStore.setTaskIds(v)}
            testId="session-wizard-task-ids"
          />
        ) : null}
      </div>
    </div>
  );
}
