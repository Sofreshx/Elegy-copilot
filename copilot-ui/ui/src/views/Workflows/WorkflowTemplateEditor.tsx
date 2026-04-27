import { useEffect, useState } from 'react';
import { Button, Panel, Toolbar } from '../../components';
import { navigationStore } from '../../stores/navigation';
import { workflowStore } from './workflowStore';
import type { WorkflowStep } from './workflowStore';
import WorkflowPipeline from './WorkflowPipeline';

interface WorkflowTemplateEditorProps {
  templateId: string;
}

function createEmptyStep(): WorkflowStep {
  return {
    stepId: crypto.randomUUID(),
    label: '',
    type: 'session',
    agentId: null,
    model: null,
  };
}

export default function WorkflowTemplateEditor({ templateId }: WorkflowTemplateEditorProps) {
  const isNew = templateId === '__new__';

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState<WorkflowStep[]>([createEmptyStep()]);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [intervalMinutes, setIntervalMinutes] = useState(60);

  useEffect(() => {
    if (isNew) return;

    let cancelled = false;

    async function loadTemplate() {
      try {
        const res = await fetch(`/api/workflows/templates/${templateId}`);
        if (!res.ok) throw new Error(`Failed to load template (${res.status})`);
        const template = await res.json();
        if (cancelled) return;
        setName(template.name ?? '');
        setDescription(template.description ?? '');
        setSteps(template.steps?.length ? template.steps : [createEmptyStep()]);
        if (template.schedule) {
          setScheduleEnabled(template.schedule.enabled);
          setIntervalMinutes(template.schedule.intervalMinutes || 60);
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : 'Failed to load template.');
        }
      }
    }

    void loadTemplate();
    return () => { cancelled = true; };
  }, [templateId, isNew]);

  const handleBack = () => {
    navigationStore.selectWorkflowTemplate(null);
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);

    const payload = {
      name: name.trim(),
      description: description.trim(),
      steps,
      schedule: scheduleEnabled ? { enabled: true, intervalMinutes } : { enabled: false, intervalMinutes: 60 },
    };

    if (isNew) {
      const created = await workflowStore.createTemplate(payload);
      if (created) navigationStore.selectWorkflowTemplate(null);
    } else {
      const updated = await workflowStore.updateTemplate(templateId, payload);
      if (updated) navigationStore.selectWorkflowTemplate(null);
    }

    setSaving(false);
  };

  const addStep = () => {
    setSteps((prev) => [...prev, createEmptyStep()]);
  };

  const removeStep = (index: number) => {
    setSteps((prev) => prev.filter((_, i) => i !== index));
  };

  const moveStep = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= steps.length) return;
    setSteps((prev) => {
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const updateStep = (index: number, patch: Partial<WorkflowStep>) => {
    setSteps((prev) =>
      prev.map((step, i) => (i === index ? { ...step, ...patch } : step)),
    );
  };

  if (loadError) {
    return (
      <div className="workflow-template-editor" data-testid="workflow-template-editor">
        <Toolbar>
          <Button variant="ghost" size="sm" testId="editor-back-btn" onClick={handleBack}>
            ← Back
          </Button>
        </Toolbar>
        <div className="editor-error" data-testid="editor-error">{loadError}</div>
      </div>
    );
  }

  return (
    <div className="workflow-template-editor" data-testid="workflow-template-editor">
      <Toolbar>
        <Button variant="ghost" size="sm" testId="editor-back-btn" onClick={handleBack}>
          ← Back
        </Button>
        <h2 data-testid="editor-title">
          {isNew ? 'New Template' : `Edit Template: ${name}`}
        </h2>
      </Toolbar>

      <Panel testId="editor-form-panel">
        <div className="editor-field">
          <label htmlFor="template-name">Name</label>
          <input
            id="template-name"
            data-testid="template-name-input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Template name"
            required
          />
        </div>

        <div className="editor-field">
          <label htmlFor="template-description">Description</label>
          <textarea
            id="template-description"
            data-testid="template-description-input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe the workflow"
            rows={3}
          />
        </div>

        <div className="editor-steps" data-testid="editor-steps">
          <h3>Steps</h3>

          {/* Live pipeline preview */}
          {steps.length > 0 && steps.some((s) => s.label.trim()) && (
            <div className="pipeline-preview-section" data-testid="editor-pipeline-preview">
              <p className="pipeline-preview-label">Preview</p>
              <WorkflowPipeline
                compact
                nodes={steps.map((s) => ({
                  stepId: s.stepId,
                  label: s.label || '(untitled)',
                  type: s.type,
                  status: 'pending',
                }))}
              />
            </div>
          )}

          {steps.map((step, index) => (
            <div className="step-row" key={step.stepId} data-testid={`step-row-${index}`}>
              <span className="step-index">{index + 1}.</span>

              <input
                data-testid={`step-label-${index}`}
                type="text"
                value={step.label}
                onChange={(e) => updateStep(index, { label: e.target.value })}
                placeholder="Step label"
              />

              <select
                data-testid={`step-type-${index}`}
                value={step.type}
                onChange={(e) =>
                  updateStep(index, { type: e.target.value as WorkflowStep['type'] })
                }
              >
                <option value="session">Session</option>
                <option value="approval">Approval</option>
                <option value="hook">Hook</option>
              </select>

              {step.type === 'session' && (
                <>
                  <input
                    data-testid={`step-objective-${index}`}
                    type="text"
                    value={step.objective ?? ''}
                    onChange={(e) => updateStep(index, { objective: e.target.value })}
                    placeholder="Objective / prompt"
                  />
                  <input
                    data-testid={`step-agent-${index}`}
                    type="text"
                    value={step.agentId ?? ''}
                    onChange={(e) => updateStep(index, { agentId: e.target.value || null })}
                    placeholder="Agent (optional)"
                  />
                  <select
                    data-testid={`step-model-${index}`}
                    value={step.model ?? ''}
                    onChange={(e) => updateStep(index, { model: e.target.value || null })}
                  >
                    <option value="">Default model</option>
                    <option value="claude-sonnet-4.6">Claude Sonnet 4.6</option>
                    <option value="gpt-5.4">GPT 5.4</option>
                    <option value="claude-sonnet-4.5">Claude Sonnet 4.5</option>
                    <option value="gpt-4.1">GPT 4.1</option>
                  </select>
                </>
              )}

              {step.type === 'approval' && (
                <input
                  data-testid={`step-approval-msg-${index}`}
                  type="text"
                  value={step.approvalMessage ?? ''}
                  onChange={(e) => updateStep(index, { approvalMessage: e.target.value })}
                  placeholder="Approval message"
                />
              )}

              <div className="step-actions">
                <Button
                  variant="ghost"
                  size="sm"
                  testId={`step-up-${index}`}
                  disabled={index === 0}
                  onClick={() => moveStep(index, -1)}
                >
                  ↑
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  testId={`step-down-${index}`}
                  disabled={index === steps.length - 1}
                  onClick={() => moveStep(index, 1)}
                >
                  ↓
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  testId={`step-remove-${index}`}
                  onClick={() => removeStep(index)}
                >
                  Remove
                </Button>
              </div>
            </div>
          ))}

          <Button variant="secondary" size="sm" testId="add-step-btn" onClick={addStep}>
            Add Step
          </Button>
        </div>
      </Panel>

      <Panel title="Schedule" testId="editor-schedule-panel">
        <div className="editor-field schedule-toggle-field">
          <label htmlFor="schedule-enabled" className="schedule-toggle-label">
            <input
              id="schedule-enabled"
              data-testid="schedule-enabled-toggle"
              type="checkbox"
              checked={scheduleEnabled}
              onChange={(e) => setScheduleEnabled(e.target.checked)}
            />
            Enable recurring schedule
          </label>
        </div>

        {scheduleEnabled && (
          <div className="schedule-config">
            <div className="editor-field">
              <label htmlFor="schedule-interval">Run every</label>
              <div className="schedule-interval-input">
                <input
                  id="schedule-interval"
                  data-testid="schedule-interval-input"
                  type="number"
                  min={1}
                  max={43200}
                  value={intervalMinutes}
                  onChange={(e) => setIntervalMinutes(Math.max(1, parseInt(e.target.value) || 60))}
                />
                <span className="schedule-interval-unit">minutes</span>
              </div>
            </div>
            <div className="schedule-presets">
              {[
                { label: '15m', value: 15 },
                { label: '1h', value: 60 },
                { label: '6h', value: 360 },
                { label: '12h', value: 720 },
                { label: '24h', value: 1440 },
              ].map((p) => (
                <button
                  key={p.value}
                  type="button"
                  className={`schedule-preset-btn${intervalMinutes === p.value ? ' schedule-preset-active' : ''}`}
                  data-testid={`schedule-preset-${p.value}`}
                  onClick={() => setIntervalMinutes(p.value)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </Panel>

      <div className="editor-footer" data-testid="editor-footer">
        <Button variant="ghost" testId="editor-cancel-btn" onClick={handleBack}>
          Cancel
        </Button>
        <Button
          variant="primary"
          testId="editor-save-btn"
          disabled={!name.trim() || saving}
          onClick={handleSave}
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  );
}
