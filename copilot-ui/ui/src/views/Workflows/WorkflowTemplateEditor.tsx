import { useEffect, useState } from 'react';
import { Button, Panel, Toolbar } from '../../components';
import { navigationStore } from '../../stores/navigation';
import { workflowStore } from './workflowStore';
import type { WorkflowStep } from './workflowStore';

interface WorkflowTemplateEditorProps {
  templateId: string;
}

function createEmptyStep(): WorkflowStep {
  return {
    id: crypto.randomUUID(),
    label: '',
    type: 'session',
  };
}

export default function WorkflowTemplateEditor({ templateId }: WorkflowTemplateEditorProps) {
  const isNew = templateId === '__new__';

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState<WorkflowStep[]>([createEmptyStep()]);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

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
          {steps.map((step, index) => (
            <div className="step-row" key={step.id} data-testid={`step-row-${index}`}>
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
                <option value="script">Script</option>
              </select>

              {step.type === 'session' ? (
                <input
                  data-testid={`step-objective-${index}`}
                  type="text"
                  value={step.objective ?? ''}
                  onChange={(e) => updateStep(index, { objective: e.target.value })}
                  placeholder="Objective"
                />
              ) : null}

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
