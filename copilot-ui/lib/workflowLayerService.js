'use strict';

const fs = require('fs');
const path = require('path');

const WORKFLOW_LAYER_CONTRACT_VERSION = '1';
const MAX_TRIGGER_ENTRIES = 200;
const DEFAULT_AUTOMATION_REASON = 'local_workflow_automation_retired';
const EXECUTOR_EVENT_TYPES = new Set([
  'executor.run.queued',
  'executor.attempt.started',
  'executor.attempt.enqueued',
  'executor.run.completed',
  'executor.run.failed',
  'executor.run.cancelled',
  'executor.session.event',
]);

function isObject(value) {
  return value !== null && typeof value === 'object';
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function asTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function nowIso(nowFn) {
  return new Date(typeof nowFn === 'function' ? nowFn() : Date.now()).toISOString();
}

class WorkflowLayerService {
  constructor(config = {}, deps = {}) {
    this._config = isObject(config) ? config : {};
    this._fs = deps.fs || fs;
    this._path = deps.path || path;
    this._now = typeof deps.now === 'function' ? deps.now : () => Date.now();
    this._statePath = this._path.join(
      this._path.resolve(String(this._config.elegyHome || this._config.copilotHome || '.')),
      'executor',
      'workflow-layer.json'
    );
    this._executorService = this._config.executorService || null;
    const envKillSwitch = String(process.env.INSTRUCTION_ENGINE_DISABLE_LOCAL_WORKFLOW_AUTOMATION || '').trim() === '1';
    this._state = {
      version: WORKFLOW_LAYER_CONTRACT_VERSION,
      automationEnabled: false,
      automationSource: envKillSwitch
        ? 'env'
        : 'default',
      automationReason: envKillSwitch
        ? 'env_kill_switch'
        : DEFAULT_AUTOMATION_REASON,
      updatedAt: nowIso(this._now),
      recentTriggers: [],
      dispatchSummary: {
        lastTriggerId: null,
        lastDispatchAt: null,
        lastDeliveryState: null,
        lastError: null,
      },
    };
    this._boundExecutorListener = null;
    this._initialized = false;
  }

  async init() {
    if (this._initialized) {
      return this;
    }
    this._loadState();
    this._enforceAutomationAvailability();
    if (this._executorService && typeof this._executorService.on === 'function') {
      this._boundExecutorListener = (event) => {
        void this._handleExecutorEvent(event);
      };
      this._executorService.on('workflow-layer:event', this._boundExecutorListener);
    }
    this._initialized = true;
    return this;
  }

  async shutdown() {
    if (this._executorService && this._boundExecutorListener && typeof this._executorService.off === 'function') {
      this._executorService.off('workflow-layer:event', this._boundExecutorListener);
    } else if (this._executorService && this._boundExecutorListener && typeof this._executorService.removeListener === 'function') {
      this._executorService.removeListener('workflow-layer:event', this._boundExecutorListener);
    }
    this._boundExecutorListener = null;
  }

  getHealth() {
    return {
      contractVersion: WORKFLOW_LAYER_CONTRACT_VERSION,
      enabled: this._state.automationEnabled === true,
      killSwitchEnabled: this._state.automationEnabled !== true,
      automationSource: this._state.automationSource || 'default',
      automationReason: this._state.automationReason || null,
      recentTriggerCount: this._state.recentTriggers.length,
      lastTriggerAt: this._state.recentTriggers.length
        ? this._state.recentTriggers[this._state.recentTriggers.length - 1].capturedAt
        : null,
      dispatchTarget: {
        state: 'retired',
        reason: DEFAULT_AUTOMATION_REASON,
      },
      dispatchSummary: clone(this._state.dispatchSummary),
    };
  }

  getStatus() {
    return {
      ...this.getHealth(),
      recentTriggers: this.listTriggers({ limit: 25 }),
    };
  }

  listTriggers(options = {}) {
    const sessionId = asTrimmedString(options.sessionId);
    const repoId = asTrimmedString(options.repoId);
    const taskIds = Array.isArray(options.taskIds)
      ? new Set(options.taskIds.map((value) => asTrimmedString(value)).filter(Boolean))
      : null;
    const limit = Number.isFinite(Number(options.limit)) ? Math.max(1, Math.min(100, Number(options.limit))) : 20;

    return this._state.recentTriggers
      .filter((entry) => {
        if (!entry || typeof entry !== 'object') return false;
        if (sessionId && asTrimmedString(entry.context && entry.context.sessionId) !== sessionId) {
          return false;
        }
        if (repoId && asTrimmedString(entry.context && entry.context.repo && entry.context.repo.repoId) !== repoId) {
          return false;
        }
        if (taskIds && taskIds.size) {
          const entryTaskIds = Array.isArray(entry.context && entry.context.taskRefs)
            ? entry.context.taskRefs.map((taskRef) => asTrimmedString(taskRef && taskRef.taskId)).filter(Boolean)
            : [];
          if (!entryTaskIds.some((taskId) => taskIds.has(taskId))) {
            return false;
          }
        }
        return true;
      })
      .slice(-limit)
      .reverse()
      .map((entry) => clone(entry));
  }

  setAutomationEnabled(enabled, options = {}) {
    if (enabled === true) {
      const availability = this._getAutomationAvailability();
      if (!availability.allowed) {
        throw Object.assign(new Error(availability.message), {
          statusCode: 409,
          code: 'workflow_layer_automation_unavailable',
        });
      }
    }
    this._state.automationEnabled = enabled === true;
    this._state.automationSource = asTrimmedString(options.source) || 'operator';
    this._state.automationReason = this._state.automationEnabled ? null : (asTrimmedString(options.reason) || 'operator_kill_switch');
    this._state.updatedAt = nowIso(this._now);
    this._persistState();
    return this.getHealth();
  }

  _getAutomationAvailability() {
    if (String(process.env.INSTRUCTION_ENGINE_DISABLE_LOCAL_WORKFLOW_AUTOMATION || '').trim() === '1') {
      return {
        allowed: false,
        source: 'env',
        reason: 'env_kill_switch',
        message: 'Local workflow automation is disabled by INSTRUCTION_ENGINE_DISABLE_LOCAL_WORKFLOW_AUTOMATION.',
      };
    }

    return {
      allowed: false,
      source: 'runtime',
      reason: DEFAULT_AUTOMATION_REASON,
      message: 'Local workflow automation dispatch is retired.',
    };
  }

  _enforceAutomationAvailability() {
    const availability = this._getAutomationAvailability();
    if (availability.allowed) {
      return;
    }

    this._state.automationEnabled = false;
    this._state.automationSource = availability.source;
    this._state.automationReason = availability.reason;
    this._state.updatedAt = nowIso(this._now);
    this._persistState();
  }

  async _handleExecutorEvent(event) {
    if (!isObject(event)) {
      return;
    }
    if (!EXECUTOR_EVENT_TYPES.has(asTrimmedString(event.type))) {
      return;
    }

    const triggerRecord = this._buildTriggerRecord(event);
    if (!triggerRecord) {
      return;
    }

    if (this._state.automationEnabled !== true) {
      triggerRecord.delivery = {
        state: 'suppressed',
        reason: this._state.automationReason || 'workflow_kill_switch_enabled',
      };
      this._recordTrigger(triggerRecord);
      return;
    }

    triggerRecord.delivery = {
      state: 'suppressed',
      reason: DEFAULT_AUTOMATION_REASON,
    };
    this._recordTrigger(triggerRecord);
  }

  _buildTriggerRecord(event) {
    const run = isObject(event.run) ? event.run : {};
    const job = isObject(event.job) ? event.job : {};
    const orchestration = isObject(run.orchestration)
      ? run.orchestration
      : (isObject(job.orchestration) ? job.orchestration : {});
    const workflow = isObject(orchestration.workflow) ? orchestration.workflow : {};
    const repo = isObject(orchestration.repo) ? orchestration.repo : {};
    const isolation = isObject(orchestration.isolation) ? orchestration.isolation : {};
    const taskRefs = Array.isArray(orchestration.taskRefs) ? orchestration.taskRefs : [];
    const sessionId = asTrimmedString(run.sessionId) || asTrimmedString(event.sessionId) || asTrimmedString(workflow.sessionId);
    const workflowId = asTrimmedString(workflow.workflowId) || asTrimmedString(event.workflowId) || asTrimmedString(job.id);
    const repoId = asTrimmedString(run.repoId) || asTrimmedString(job.repoId) || asTrimmedString(repo.repoId);
    const repoPath = asTrimmedString(run.repoPath) || asTrimmedString(job.repoPath) || asTrimmedString(repo.repoPath);
    const requiresSessionId = asTrimmedString(job.targetType) === 'existing-session';

    if (!workflowId) {
      return null;
    }

    if (requiresSessionId && !sessionId) {
      return null;
    }

    if (!sessionId && !repoId && !repoPath && !taskRefs.length) {
      return null;
    }

    return {
      triggerId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      contractVersion: 'local_workflow_trigger_v1',
      source: 'executor',
      eventType: asTrimmedString(event.type) || 'executor.unknown',
      at: nowIso(this._now),
      capturedAt: nowIso(this._now),
      context: {
        sessionId: sessionId || null,
        repo: {
          repoId: repoId || null,
          repoPath: repoPath || null,
          repoLabel: asTrimmedString(repo.repoLabel) || null,
          branch: asTrimmedString(repo.branch) || null,
        },
        isolation: {
          mode: asTrimmedString(isolation.mode) || null,
          worktreeId: asTrimmedString(isolation.worktreeId) || null,
          worktreePath: asTrimmedString(isolation.worktreePath) || null,
          worktreeStatus: asTrimmedString(isolation.worktreeStatus) || null,
          sandboxId: asTrimmedString(isolation.sandboxId) || null,
          contextType: asTrimmedString(isolation.contextType) || null,
        },
        workflow: {
          workflowId,
          workflowKind: asTrimmedString(workflow.workflowKind) || null,
          trigger: asTrimmedString(workflow.trigger) || null,
          mode: asTrimmedString(workflow.mode) || null,
          runId: asTrimmedString(run.id) || asTrimmedString(workflow.runId) || null,
          jobId: asTrimmedString(run.jobId) || asTrimmedString(job.id) || asTrimmedString(workflow.jobId) || null,
          status: asTrimmedString(run.status) || asTrimmedString(workflow.status) || null,
        },
        taskRefs: taskRefs.map((taskRef) => ({
          taskId: asTrimmedString(taskRef && taskRef.taskId) || null,
          ownerSessionId: asTrimmedString(taskRef && taskRef.ownerSessionId) || null,
          activeActorId: asTrimmedString(taskRef && taskRef.activeActorId) || null,
        })),
      },
      data: isObject(event.data) ? clone(event.data) : null,
    };
  }

  _recordTrigger(triggerRecord) {
    this._state.recentTriggers.push(triggerRecord);
    if (this._state.recentTriggers.length > MAX_TRIGGER_ENTRIES) {
      this._state.recentTriggers.splice(0, this._state.recentTriggers.length - MAX_TRIGGER_ENTRIES);
    }
    this._state.dispatchSummary = {
      lastTriggerId: triggerRecord.triggerId,
      lastDispatchAt: triggerRecord.capturedAt,
      lastDeliveryState: triggerRecord.delivery ? triggerRecord.delivery.state : null,
      lastError: triggerRecord.delivery && triggerRecord.delivery.reason ? triggerRecord.delivery.reason : null,
    };
    this._state.updatedAt = nowIso(this._now);
    this._persistState();
  }

  _ensureStateDir() {
    this._fs.mkdirSync(this._path.dirname(this._statePath), { recursive: true });
  }

  _loadState() {
    if (!this._fs.existsSync(this._statePath)) {
      return;
    }

    try {
      const parsed = JSON.parse(this._fs.readFileSync(this._statePath, 'utf8'));
      if (isObject(parsed)) {
        if (typeof parsed.automationEnabled === 'boolean' && this._state.automationSource !== 'env') {
          this._state.automationEnabled = parsed.automationEnabled;
          this._state.automationSource = asTrimmedString(parsed.automationSource) || 'persisted';
          this._state.automationReason = asTrimmedString(parsed.automationReason) || null;
        }
        this._state.updatedAt = asTrimmedString(parsed.updatedAt) || this._state.updatedAt;
        this._state.recentTriggers = Array.isArray(parsed.recentTriggers)
          ? parsed.recentTriggers.slice(-MAX_TRIGGER_ENTRIES)
          : [];
        this._state.dispatchSummary = isObject(parsed.dispatchSummary)
          ? {
            lastTriggerId: asTrimmedString(parsed.dispatchSummary.lastTriggerId) || null,
            lastDispatchAt: asTrimmedString(parsed.dispatchSummary.lastDispatchAt) || null,
            lastDeliveryState: asTrimmedString(parsed.dispatchSummary.lastDeliveryState) || null,
            lastError: asTrimmedString(parsed.dispatchSummary.lastError) || null,
          }
          : this._state.dispatchSummary;
      }
    } catch {
      // Best-effort fail soft for workflow layer state.
    }
  }

  _persistState() {
    this._ensureStateDir();
    this._fs.writeFileSync(this._statePath, JSON.stringify(this._state, null, 2));
  }
}

function createWorkflowLayerService(config = {}, deps = {}) {
  return new WorkflowLayerService(config, deps);
}

module.exports = {
  WORKFLOW_LAYER_CONTRACT_VERSION,
  WorkflowLayerService,
  createWorkflowLayerService,
};
