import { useState } from 'react';
import { FormInput } from '../../../components';
import { SESSION_TEMPLATES } from '../../../constants/sessionTemplates';
import type { SessionWizardState } from '../sessionWizardStore';
import { sessionWizardStore } from '../sessionWizardStore';

interface ObjectiveStepProps {
  state: SessionWizardState;
}

export default function ObjectiveStep({ state }: ObjectiveStepProps) {
  const [showTasks, setShowTasks] = useState(Boolean(state.taskIds));

  return (
    <div className="session-wizard-objective-step" data-testid="session-wizard-objective-step">
      <label className="session-wizard-objective-label" htmlFor="session-wizard-objective-textarea">
        Objective
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

      <div className="session-wizard-templates" data-testid="session-wizard-templates">
        <span className="session-wizard-templates-label">Quick templates</span>
        <div className="session-wizard-templates-grid">
          {SESSION_TEMPLATES.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`session-wizard-template-btn ${state.templateId === t.id ? 'session-wizard-template-btn-active' : ''}`}
              data-testid={`session-wizard-template-${t.id}`}
              onClick={() => {
                sessionWizardStore.setTemplateId(state.templateId === t.id ? null : t.id);
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
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
