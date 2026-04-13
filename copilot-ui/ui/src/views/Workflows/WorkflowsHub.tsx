import { useEffect, useState } from 'react';
import { useStoreValue } from '../../lib/store';
import { Button, Panel, Toolbar, Badge, StatusBadge } from '../../components';
import { navigationStore } from '../../stores/navigation';
import { workflowStore } from './workflowStore';
import type { WorkflowTemplate, WorkflowRun } from './workflowStore';
import WorkflowPipeline from './WorkflowPipeline';

type HubTab = 'templates' | 'runs';

interface TemplateCardProps {
  template: WorkflowTemplate;
  onEdit: (id: string) => void;
  onLaunch: (id: string) => void;
  onDelete: (id: string) => void;
}

function TemplateCard({ template, onEdit, onLaunch, onDelete }: TemplateCardProps) {
  return (
    <div className="template-card" data-testid={`template-card-${template.templateId}`}>
      <div className="template-card-header">
        <h4
          className="template-card-name"
          onClick={() => navigationStore.selectWorkflowTemplate(template.templateId)}
        >
          {template.name}
        </h4>
        <Badge tone="neutral">{template.steps.length} steps</Badge>
      </div>
      {template.description ? (
        <p className="template-card-description">{template.description}</p>
      ) : null}
      {template.schedule?.enabled && (
        <div className="template-schedule-indicator" data-testid={`schedule-indicator-${template.templateId}`}>
          <span className="schedule-icon">⏱</span>
          <span className="schedule-text">
            Every {template.schedule.intervalMinutes < 60
              ? `${template.schedule.intervalMinutes}m`
              : template.schedule.intervalMinutes < 1440
                ? `${Math.round(template.schedule.intervalMinutes / 60)}h`
                : `${Math.round(template.schedule.intervalMinutes / 1440)}d`
            }
            {template.schedule.nextRunAt && (
              <> · Next: {new Date(template.schedule.nextRunAt).toLocaleTimeString()}</>
            )}
          </span>
        </div>
      )}
      {template.steps.length > 0 && (
        <WorkflowPipeline
          compact
          nodes={template.steps.map((s) => ({
            stepId: s.stepId,
            label: s.label,
            type: s.type,
            status: 'pending',
          }))}
        />
      )}
      <div className="template-card-actions">
        <Button variant="ghost" size="sm" testId={`edit-template-${template.templateId}`} onClick={() => onEdit(template.templateId)}>
          Edit
        </Button>
        <Button variant="primary" size="sm" testId={`launch-template-${template.templateId}`} onClick={() => onLaunch(template.templateId)}>
          Launch
        </Button>
        <Button variant="danger" size="sm" testId={`delete-template-${template.templateId}`} onClick={() => onDelete(template.templateId)}>
          Delete
        </Button>
      </div>
    </div>
  );
}

interface RunCardProps {
  run: WorkflowRun;
}

function RunCard({ run }: RunCardProps) {
  const state = useStoreValue(workflowStore);
  const templateName = state.templates.find((t) => t.templateId === run.templateId)?.name ?? 'Unknown';

  const totalSteps = run.steps.length;
  const completedSteps = run.steps.filter(
    (s) => s.status === 'completed' || s.status === 'skipped',
  ).length;
  const progressPercent = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

  return (
    <div
      className="run-card"
      data-testid={`run-card-${run.workflowRunId}`}
      onClick={() => navigationStore.selectWorkflowRun(run.workflowRunId)}
    >
      <div className="run-card-header">
        <h4 className="run-card-name">{templateName}</h4>
        <StatusBadge status={run.status} testId={`run-status-${run.workflowRunId}`} />
      </div>
      <div className="run-card-progress">
        <span className="run-card-step-label">
          Step {Math.min(run.currentStepIndex + 1, totalSteps)} / {totalSteps}
        </span>
        <div className="progress-bar" data-testid={`run-progress-${run.workflowRunId}`}>
          <div className="progress-bar-fill" style={{ width: `${progressPercent}%` }} />
        </div>
      </div>
    </div>
  );
}

export default function WorkflowsHub() {
  const [activeTab, setActiveTab] = useState<HubTab>('templates');
  const state = useStoreValue(workflowStore);

  useEffect(() => {
    void workflowStore.refresh();
  }, []);

  const handleEdit = (id: string) => {
    navigationStore.selectWorkflowTemplate(id);
  };

  const handleLaunch = async (templateId: string) => {
    await workflowStore.launchRun(templateId);
  };

  const handleDelete = async (id: string) => {
    await workflowStore.deleteTemplate(id);
  };

  const handleNewTemplate = () => {
    navigationStore.selectWorkflowTemplate('__new__');
  };

  return (
    <div className="workflows-hub" data-testid="workflows-hub">
      <Toolbar testId="workflows-hub-toolbar">
        <div className="tab-buttons">
          <Button
            variant={activeTab === 'templates' ? 'primary' : 'ghost'}
            size="sm"
            testId="tab-templates"
            onClick={() => setActiveTab('templates')}
          >
            Templates
          </Button>
          <Button
            variant={activeTab === 'runs' ? 'primary' : 'ghost'}
            size="sm"
            testId="tab-runs"
            onClick={() => setActiveTab('runs')}
          >
            Active Runs
          </Button>
        </div>
        {activeTab === 'templates' ? (
          <div className="toolbar-actions">
            <Button variant="secondary" size="sm" testId="seed-templates-btn" onClick={() => workflowStore.seedTemplates()}>
              Seed Examples
            </Button>
            <Button variant="primary" size="sm" testId="new-template-btn" onClick={handleNewTemplate}>
              New Template
            </Button>
          </div>
        ) : null}
      </Toolbar>

      {state.error ? (
        <div className="workflows-error" data-testid="workflows-error">
          {state.error}
        </div>
      ) : null}

      {state.loading ? (
        <div className="workflows-loading" data-testid="workflows-loading">
          Loading…
        </div>
      ) : null}

      {activeTab === 'templates' ? (
        <Panel title="Templates" testId="templates-panel">
          {state.templates.length === 0 && !state.loading ? (
            <p data-testid="no-templates">No workflow templates yet.</p>
          ) : (
            <div className="template-list" data-testid="template-list">
              {state.templates.map((t) => (
                <TemplateCard
                  key={t.templateId}
                  template={t}
                  onEdit={handleEdit}
                  onLaunch={handleLaunch}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}
        </Panel>
      ) : (
        <Panel title="Active Runs" testId="runs-panel">
          {state.runs.length === 0 && !state.loading ? (
            <p data-testid="no-runs">No active workflow runs.</p>
          ) : (
            <div className="run-list" data-testid="run-list">
              {state.runs.map((r) => (
                <RunCard key={r.workflowRunId} run={r} />
              ))}
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}
