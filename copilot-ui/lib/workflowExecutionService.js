'use strict';

const EventEmitter = require('node:events');

// ---------------------------------------------------------------------------
// WorkflowExecutionService
//
// Orchestrates workflow run execution by bridging workflowTemplateService
// (run state/persistence) with executorService (SDK session execution).
// Listens for executor lifecycle events to auto-advance workflow steps.
// ---------------------------------------------------------------------------

class WorkflowExecutionService extends EventEmitter {
  constructor(config = {}) {
    super();
    this._wts = config.workflowTemplateService || null;
    this._executor = config.executorService || null;
    this._copilotHome = config.copilotHome || '.';
    // runId → { stepJobs: Map<executorJobId, stepIndex> }
    this._activeRuns = new Map();
    this._boundHandler = null;
    this._scheduleTimers = new Map(); // templateId → timer
    this._scheduleLock = new Set(); // templateId set for "currently launching" dedup
  }

  async init() {
    if (this._executor && typeof this._executor.on === 'function') {
      this._boundHandler = (event) => this._handleExecutorEvent(event);
      this._executor.on('workflow-layer:event', this._boundHandler);
    }
    await this.initScheduler();
    return this;
  }

  async initScheduler() {
    if (!this._wts) return;
    const templates = this._wts.listTemplates(this._copilotHome);
    for (const t of templates) {
      if (t.schedule && t.schedule.enabled) {
        this._scheduleTemplate(t);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  async launchRun(copilotHome, templateId, options = {}) {
    if (!this._wts) {
      throw Object.assign(new Error('Workflow template service unavailable'), { statusCode: 503 });
    }

    const run = this._wts.createRun(copilotHome, {
      templateId,
      projectId: options.projectId || null,
      repoPath: options.repoPath || null,
    });

    this._activeRuns.set(run.workflowRunId, { stepJobs: new Map(), repoPath: options.repoPath || null });

    this.emit('workflow:event', { type: 'workflow.run.launched', runId: run.workflowRunId });

    // Start executing the first step
    if (run.steps.length > 0) {
      this._executeStep(copilotHome, run.workflowRunId, 0).catch((err) => {
        console.error(`[workflow-engine] Failed to start step 0 for run ${run.workflowRunId}: ${err.message}`);
      });
    }

    return run;
  }

  async retryStep(copilotHome, workflowRunId, stepIndex) {
    if (!this._wts) {
      throw Object.assign(new Error('Workflow template service unavailable'), { statusCode: 503 });
    }

    const run = this._wts.getRun(copilotHome, workflowRunId);
    if (!run) {
      throw Object.assign(new Error('Run not found'), { statusCode: 404 });
    }

    const idx = Number(stepIndex);
    if (!Number.isFinite(idx) || idx < 0 || idx >= run.steps.length) {
      throw Object.assign(new Error('Invalid step index'), { statusCode: 400 });
    }

    const step = run.steps[idx];
    if (step.status !== 'failed') {
      throw Object.assign(new Error('Only failed steps can be retried'), { statusCode: 400 });
    }

    // Reset step to pending, reset run status to running
    this._wts.updateRunStep(copilotHome, workflowRunId, idx, {
      status: 'pending',
      startedAt: null,
      completedAt: null,
      outcome: null,
      error: null,
      executorJobId: null,
      executorRunId: null,
    });

    // If run was marked failed, restore it to running
    const currentRun = this._wts.getRun(copilotHome, workflowRunId);
    if (currentRun && currentRun.status === 'failed') {
      // Directly patch the run status back to running via the file
      // updateRunStep handles this indirectly — we call it with running status
    }

    // Ensure tracking entry exists
    if (!this._activeRuns.has(workflowRunId)) {
      this._activeRuns.set(workflowRunId, { stepJobs: new Map(), repoPath: currentRun.repoPath || null });
    }

    // Execute the step
    await this._executeStep(copilotHome, workflowRunId, idx);

    return this._wts.getRun(copilotHome, workflowRunId);
  }

  async updateSchedule(copilotHome, templateId, scheduleConfig) {
    if (!this._wts) {
      throw Object.assign(new Error('Workflow template service unavailable'), { statusCode: 503 });
    }

    const template = this._wts.updateTemplate(copilotHome, templateId, {
      schedule: scheduleConfig,
    });

    if (!template) {
      throw Object.assign(new Error('Template not found'), { statusCode: 404 });
    }

    if (template.schedule && template.schedule.enabled) {
      // Set nextRunAt based on interval
      const intervalMs = (template.schedule.intervalMinutes || 60) * 60 * 1000;
      const nextRunAt = new Date(Date.now() + intervalMs).toISOString();
      this._wts.updateTemplateScheduleMeta(copilotHome, templateId, { nextRunAt });
      // Re-read and schedule
      const updated = this._wts.getTemplate(copilotHome, templateId);
      this._scheduleTemplate(updated);
    } else {
      this._clearSchedule(templateId);
    }

    return this._wts.getTemplate(copilotHome, templateId);
  }

  async shutdown() {
    if (this._executor && this._boundHandler) {
      this._executor.off('workflow-layer:event', this._boundHandler);
      this._boundHandler = null;
    }
    this._activeRuns.clear();
    for (const [, timer] of this._scheduleTimers) {
      clearTimeout(timer);
    }
    this._scheduleTimers.clear();
    this._scheduleLock.clear();
  }

  // -------------------------------------------------------------------------
  // Step execution
  // -------------------------------------------------------------------------

  async _executeStep(copilotHome, workflowRunId, stepIndex) {
    const run = this._wts.getRun(copilotHome, workflowRunId);
    if (!run) {
      throw Object.assign(new Error('Run not found during step execution'), { statusCode: 404 });
    }

    const step = run.steps[stepIndex];
    if (!step) {
      throw Object.assign(new Error(`Step ${stepIndex} not found`), { statusCode: 400 });
    }

    const template = this._wts.getTemplate(copilotHome, run.templateId);
    const templateStep = template && template.steps ? template.steps[stepIndex] : null;

    // Mark step as running
    this._wts.updateRunStep(copilotHome, workflowRunId, stepIndex, {
      status: 'running',
      startedAt: new Date().toISOString(),
    });

    // Handle approval steps
    if (templateStep && (templateStep.type === 'approval' || templateStep.approvalRequired)) {
      this._wts.updateRunStep(copilotHome, workflowRunId, stepIndex, {
        status: 'awaiting-approval',
      });
      this.emit('workflow:event', {
        type: 'workflow.step.awaiting-approval',
        runId: workflowRunId,
        stepIndex,
      });
      return;
    }

    // For session steps: create executor job
    if (!this._executor) {
      throw Object.assign(new Error('Executor service unavailable — cannot run session steps'), { statusCode: 503 });
    }

    // Build prompt with context from previous step
    let prompt = (templateStep && templateStep.objective) || `Execute step: ${(templateStep && templateStep.label) || 'unnamed'}`;

    // Prepend context from previous step if available
    if (stepIndex > 0) {
      const prevStep = run.steps[stepIndex - 1];
      if (prevStep && prevStep.contextOutput) {
        prompt = `Context from previous step:\n${prevStep.contextOutput}\n\n---\n\n${prompt}`;
      }
    }

    const tracking = this._activeRuns.get(workflowRunId) || { stepJobs: new Map(), repoPath: null };
    const repoPath = tracking.repoPath || run.repoPath || null;

    const result = await this._executor.createJob({
      prompt,
      model: (templateStep && templateStep.model) || null,
      repoPath,
      title: `workflow-${workflowRunId}-step-${stepIndex}`,
      orchestration: {
        workflow: {
          workflowId: workflowRunId,
          workflowKind: 'workflow-step',
          trigger: 'workflow-engine',
          workflowRunId: workflowRunId,
          stepIndex: stepIndex,
          stepLabel: (templateStep && templateStep.label) || '',
          templateId: run.templateId,
        },
        repo: repoPath ? { repoPath } : {},
      },
    });

    const jobId = result.job && result.job.id;
    if (jobId) {
      tracking.stepJobs.set(jobId, stepIndex);
      this._activeRuns.set(workflowRunId, tracking);
    }

    // Update run step with executor IDs
    const updateFields = {};
    if (jobId) updateFields.executorJobId = jobId;
    if (result.run && result.run.sessionId) updateFields.sessionId = result.run.sessionId;
    if (result.run && result.run.id) updateFields.executorRunId = result.run.id;
    if (Object.keys(updateFields).length > 0) {
      this._wts.updateRunStep(copilotHome, workflowRunId, stepIndex, updateFields);
    }

    this.emit('workflow:event', {
      type: 'workflow.step.started',
      runId: workflowRunId,
      stepIndex,
      executorJobId: jobId || null,
    });
  }

  // -------------------------------------------------------------------------
  // Executor event handling
  // -------------------------------------------------------------------------

  _handleExecutorEvent(event) {
    if (!event) return;

    const eventType = event.type || '';
    const jobId = (event.job && event.job.id) || '';

    if (!jobId) return;
    if (eventType !== 'executor.run.completed' && eventType !== 'executor.run.failed') return;

    // Find which workflow run this executor event belongs to
    for (const [runId, tracking] of this._activeRuns) {
      const stepIndex = tracking.stepJobs.get(jobId);
      if (stepIndex !== undefined) {
        if (eventType === 'executor.run.completed') {
          this._onStepCompleted(runId, stepIndex, event);
        } else if (eventType === 'executor.run.failed') {
          this._onStepFailed(runId, stepIndex, event);
        }
        // Clean up the job mapping
        tracking.stepJobs.delete(jobId);
        break;
      }
    }
  }

  _onStepCompleted(workflowRunId, stepIndex, event) {
    const copilotHome = this._copilotHome;
    const sessionId = (event.run && event.run.sessionId) || null;
    const summary = (event.run && event.run.summary) || null;

    const stepFields = {
      status: 'completed',
      completedAt: new Date().toISOString(),
    };
    if (summary) {
      stepFields.outcome = summary;
      stepFields.contextOutput = summary;
    } else {
      stepFields.outcome = 'completed';
    }
    if (sessionId) stepFields.sessionId = sessionId;

    let updated;
    try {
      updated = this._wts.updateRunStep(copilotHome, workflowRunId, stepIndex, stepFields);
    } catch (err) {
      console.error(`[workflow-engine] Failed to update step ${stepIndex} on run ${workflowRunId}: ${err.message}`);
      return;
    }

    this.emit('workflow:event', {
      type: 'workflow.step.completed',
      runId: workflowRunId,
      stepIndex,
      sessionId,
    });

    if (!updated) return;

    // Check if run completed (all steps done)
    if (updated.status === 'completed') {
      this._activeRuns.delete(workflowRunId);
      this.emit('workflow:event', { type: 'workflow.run.completed', runId: workflowRunId });
      return;
    }

    // Auto-advance: execute next step
    const nextIndex = updated.currentStepIndex;
    if (nextIndex > stepIndex) {
      this._executeStep(copilotHome, workflowRunId, nextIndex).catch((err) => {
        console.error(`[workflow-engine] Failed to start step ${nextIndex}: ${err.message}`);
      });
    }
  }

  _onStepFailed(workflowRunId, stepIndex, event) {
    const copilotHome = this._copilotHome;
    const errorMsg = (event.data && event.data.error)
      || (event.run && event.run.error)
      || 'Step execution failed';

    try {
      this._wts.updateRunStep(copilotHome, workflowRunId, stepIndex, {
        status: 'failed',
        completedAt: new Date().toISOString(),
        outcome: errorMsg,
        error: errorMsg,
      });
    } catch (err) {
      console.error(`[workflow-engine] Failed to update failed step ${stepIndex} on run ${workflowRunId}: ${err.message}`);
    }

    this.emit('workflow:event', {
      type: 'workflow.step.failed',
      runId: workflowRunId,
      stepIndex,
      error: errorMsg,
    });
    this.emit('workflow:event', {
      type: 'workflow.run.failed',
      runId: workflowRunId,
      error: errorMsg,
    });
    this._activeRuns.delete(workflowRunId);
  }

  // -------------------------------------------------------------------------
  // Scheduler
  // -------------------------------------------------------------------------

  _scheduleTemplate(template) {
    this._clearSchedule(template.templateId);
    if (!template.schedule || !template.schedule.enabled) return;

    const intervalMs = (template.schedule.intervalMinutes || 60) * 60 * 1000;

    // Calculate delay to next run
    let delayMs = intervalMs;
    if (template.schedule.nextRunAt) {
      const nextMs = Date.parse(template.schedule.nextRunAt);
      if (!isNaN(nextMs)) {
        delayMs = Math.max(0, nextMs - Date.now());
      }
    }

    const timer = setTimeout(() => {
      this._tickSchedule(template.templateId);
    }, delayMs);

    this._scheduleTimers.set(template.templateId, timer);
  }

  async _tickSchedule(templateId) {
    if (this._scheduleLock.has(templateId)) return;
    this._scheduleLock.add(templateId);

    try {
      const template = this._wts.getTemplate(this._copilotHome, templateId);
      if (!template || !template.schedule || !template.schedule.enabled) {
        this._scheduleLock.delete(templateId);
        return;
      }

      // Check if previous run still active
      const runs = this._wts.listRuns(this._copilotHome, {});
      const activeRun = runs.find(r =>
        r.templateId === templateId && r.status === 'running'
      );

      if (activeRun) {
        console.log(`[workflow-scheduler] Skipping ${templateId} — previous run still active`);
      } else {
        const now = new Date().toISOString();
        await this.launchRun(this._copilotHome, templateId, {
          repoPath: template.schedule.repoPath || null,
        });

        this._wts.updateTemplateScheduleMeta(this._copilotHome, templateId, {
          lastRunAt: now,
        });

        this.emit('workflow:event', {
          type: 'workflow.schedule.triggered',
          templateId,
          triggeredAt: now,
        });
      }

      // Schedule next tick
      const intervalMs = (template.schedule.intervalMinutes || 60) * 60 * 1000;
      const nextRunAt = new Date(Date.now() + intervalMs).toISOString();
      this._wts.updateTemplateScheduleMeta(this._copilotHome, templateId, {
        nextRunAt,
      });

      const nextTimer = setTimeout(() => {
        this._tickSchedule(templateId);
      }, intervalMs);
      this._scheduleTimers.set(templateId, nextTimer);

    } catch (err) {
      console.error(`[workflow-scheduler] Error for ${templateId}: ${err.message}`);
      // Retry after interval even on error
      const template = this._wts.getTemplate(this._copilotHome, templateId);
      const intervalMs = (template && template.schedule ? template.schedule.intervalMinutes : 60) * 60 * 1000;
      const nextTimer = setTimeout(() => {
        this._tickSchedule(templateId);
      }, intervalMs);
      this._scheduleTimers.set(templateId, nextTimer);
    } finally {
      this._scheduleLock.delete(templateId);
    }
  }

  _clearSchedule(templateId) {
    const timer = this._scheduleTimers.get(templateId);
    if (timer) {
      clearTimeout(timer);
      this._scheduleTimers.delete(templateId);
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function createWorkflowExecutionService(config = {}) {
  return new WorkflowExecutionService(config);
}

module.exports = {
  WorkflowExecutionService,
  createWorkflowExecutionService,
};
