'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function resolveTemplatesDir(copilotHome) {
  return path.join(path.resolve(copilotHome), 'workflow-templates');
}

function resolveRunsDir(copilotHome) {
  return path.join(path.resolve(copilotHome), 'workflow-runs');
}

function readJsonIfExists(absPath) {
  try {
    const stat = fs.statSync(absPath);
    if (!stat.isFile()) {
      return null;
    }
    return JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch {
    return null;
  }
}

function writeJsonAtomic(absPath, value) {
  const dir = path.dirname(absPath);
  fs.mkdirSync(dir, { recursive: true });
  const tempPath = path.join(
    dir,
    `.${path.basename(absPath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
  );
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2) + '\n', 'utf8');
  fs.renameSync(tempPath, absPath);
}

function safeReadDir(absPath) {
  try {
    return fs.readdirSync(absPath);
  } catch {
    return [];
  }
}

function generateId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function nowISO() {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function normalizeSchedule(input) {
  if (!input || typeof input !== 'object') return null;
  const enabled = Boolean(input.enabled);
  if (!enabled) return null;
  const intervalMinutes = Math.max(1, Math.min(43200, Number(input.intervalMinutes) || 60));
  return {
    enabled: true,
    intervalMinutes,
    lastRunAt: typeof input.lastRunAt === 'string' ? input.lastRunAt : null,
    nextRunAt: typeof input.nextRunAt === 'string' ? input.nextRunAt : null,
  };
}

function validateTemplateInput(input) {
  if (!input || typeof input !== 'object') {
    throw Object.assign(new Error('Template input must be an object'), { statusCode: 400 });
  }
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) {
    throw Object.assign(new Error('Template name is required'), { statusCode: 400 });
  }
  const steps = input.steps;
  if (!Array.isArray(steps) || steps.length === 0) {
    throw Object.assign(new Error('Template must have at least one step'), { statusCode: 400 });
  }
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (!s || typeof s !== 'object') {
      throw Object.assign(new Error(`Step ${i} must be an object`), { statusCode: 400 });
    }
    const label = typeof s.label === 'string' ? s.label.trim() : '';
    const objective = typeof s.objective === 'string' ? s.objective.trim() : '';
    if (!label) {
      throw Object.assign(new Error(`Step ${i} must have a label`), { statusCode: 400 });
    }
    if (!objective) {
      throw Object.assign(new Error(`Step ${i} must have an objective`), { statusCode: 400 });
    }
  }
}

function normalizeStep(input) {
  return {
    stepId: generateId('wfs'),
    label: String(input.label || '').trim(),
    objective: String(input.objective || '').trim(),
    type: ['session', 'approval', 'hook'].includes(input.type) ? input.type : 'session',
    actorRole: String(input.actorRole || 'implementer').trim(),
    isolationMode: String(input.isolationMode || 'shared').trim(),
    approvalRequired: Boolean(input.approvalRequired),
    triggerCondition: ['on-complete', 'on-approve', 'manual'].includes(input.triggerCondition)
      ? input.triggerCondition
      : 'on-complete',
    agentId: typeof input.agentId === 'string' ? input.agentId.trim() || null : null,
    model: typeof input.model === 'string' ? input.model.trim() || null : null,
  };
}

// ---------------------------------------------------------------------------
// Template CRUD
// ---------------------------------------------------------------------------

function listTemplates(copilotHome) {
  const dir = resolveTemplatesDir(copilotHome);
  const files = safeReadDir(dir).filter((f) => f.endsWith('.json'));
  const templates = [];
  for (const file of files) {
    const data = readJsonIfExists(path.join(dir, file));
    if (data && data.templateId) {
      templates.push(data);
    }
  }
  templates.sort((a, b) => {
    const nameA = String(a.name || '').toLowerCase();
    const nameB = String(b.name || '').toLowerCase();
    if (nameA < nameB) return -1;
    if (nameA > nameB) return 1;
    return 0;
  });
  return templates;
}

function getTemplate(copilotHome, templateId) {
  if (!templateId) return null;
  const filePath = path.join(resolveTemplatesDir(copilotHome), `${templateId}.json`);
  return readJsonIfExists(filePath);
}

function createTemplate(copilotHome, input) {
  validateTemplateInput(input);
  const now = nowISO();
  const template = {
    templateId: generateId('wft'),
    name: String(input.name).trim(),
    description: typeof input.description === 'string' ? input.description.trim() : '',
    steps: input.steps.map(normalizeStep),
    createdAt: now,
    updatedAt: now,
  };
  const filePath = path.join(resolveTemplatesDir(copilotHome), `${template.templateId}.json`);
  template.schedule = normalizeSchedule(input.schedule);
  writeJsonAtomic(filePath, template);
  return template;
}

function updateTemplate(copilotHome, templateId, fields) {
  if (!templateId) return null;
  const filePath = path.join(resolveTemplatesDir(copilotHome), `${templateId}.json`);
  const existing = readJsonIfExists(filePath);
  if (!existing) return null;

  if (fields && typeof fields === 'object') {
    if (typeof fields.name === 'string') {
      const name = fields.name.trim();
      if (name) existing.name = name;
    }
    if (typeof fields.description === 'string') {
      existing.description = fields.description.trim();
    }
    if (Array.isArray(fields.steps) && fields.steps.length > 0) {
      validateTemplateInput({ name: existing.name, steps: fields.steps });
      existing.steps = fields.steps.map(normalizeStep);
    }
    if (fields.schedule !== undefined) {
      existing.schedule = normalizeSchedule(fields.schedule);
    }
  }

  existing.updatedAt = nowISO();
  writeJsonAtomic(filePath, existing);
  return existing;
}

function deleteTemplate(copilotHome, templateId) {
  if (!templateId) return false;
  const filePath = path.join(resolveTemplatesDir(copilotHome), `${templateId}.json`);
  try {
    fs.unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}

function updateTemplateScheduleMeta(copilotHome, templateId, meta) {
  if (!templateId) return null;
  const filePath = path.join(resolveTemplatesDir(copilotHome), `${templateId}.json`);
  const existing = readJsonIfExists(filePath);
  if (!existing || !existing.schedule) return null;
  if (meta.lastRunAt) existing.schedule.lastRunAt = meta.lastRunAt;
  if (meta.nextRunAt) existing.schedule.nextRunAt = meta.nextRunAt;
  writeJsonAtomic(filePath, existing);
  return existing;
}

// ---------------------------------------------------------------------------
// Run CRUD
// ---------------------------------------------------------------------------

function listRuns(copilotHome, filters) {
  const opts = filters && typeof filters === 'object' ? filters : {};
  const dir = resolveRunsDir(copilotHome);
  const files = safeReadDir(dir).filter((f) => f.endsWith('.json'));
  const runs = [];
  for (const file of files) {
    const data = readJsonIfExists(path.join(dir, file));
    if (!data || !data.workflowRunId) continue;
    if (opts.projectId && data.projectId !== opts.projectId) continue;
    if (opts.status && data.status !== opts.status) continue;
    runs.push(data);
  }
  runs.sort((a, b) => {
    const tA = a.launchedAt || '';
    const tB = b.launchedAt || '';
    if (tA > tB) return -1;
    if (tA < tB) return 1;
    return 0;
  });
  return runs;
}

function getRun(copilotHome, workflowRunId) {
  if (!workflowRunId) return null;
  const filePath = path.join(resolveRunsDir(copilotHome), `${workflowRunId}.json`);
  return readJsonIfExists(filePath);
}

function createRun(copilotHome, input) {
  if (!input || typeof input !== 'object') {
    throw Object.assign(new Error('Run input must be an object'), { statusCode: 400 });
  }
  const templateId = typeof input.templateId === 'string' ? input.templateId.trim() : '';
  if (!templateId) {
    throw Object.assign(new Error('templateId is required'), { statusCode: 400 });
  }
  const template = getTemplate(copilotHome, templateId);
  if (!template) {
    throw Object.assign(new Error('Template not found'), { statusCode: 404 });
  }

  const now = nowISO();
  const run = {
    workflowRunId: generateId('wfr'),
    templateId: template.templateId,
    projectId: typeof input.projectId === 'string' ? input.projectId.trim() || null : null,
    repoPath: typeof input.repoPath === 'string' ? input.repoPath.trim() || null : null,
    status: 'running',
    currentStepIndex: 0,
    steps: template.steps.map((s) => ({
      stepId: s.stepId,
      label: s.label,
      type: s.type || 'session',
      sessionId: null,
      executorJobId: null,
      executorRunId: null,
      status: 'pending',
      startedAt: null,
      completedAt: null,
      outcome: null,
      error: null,
      contextOutput: null,
    })),
    launchedAt: now,
    updatedAt: now,
    completedAt: null,
  };

  const filePath = path.join(resolveRunsDir(copilotHome), `${run.workflowRunId}.json`);
  writeJsonAtomic(filePath, run);
  return run;
}

function updateRunStep(copilotHome, workflowRunId, stepIndex, fields) {
  if (!workflowRunId) return null;
  const filePath = path.join(resolveRunsDir(copilotHome), `${workflowRunId}.json`);
  const run = readJsonIfExists(filePath);
  if (!run) return null;

  const idx = Number(stepIndex);
  if (!Number.isFinite(idx) || idx < 0 || idx >= run.steps.length) {
    throw Object.assign(new Error('Invalid step index'), { statusCode: 400 });
  }

  const step = run.steps[idx];
  if (fields && typeof fields === 'object') {
    if (typeof fields.status === 'string') step.status = fields.status;
    if (typeof fields.sessionId === 'string') step.sessionId = fields.sessionId;
    if (typeof fields.outcome === 'string') step.outcome = fields.outcome;
    if (typeof fields.startedAt === 'string') step.startedAt = fields.startedAt;
    if (typeof fields.completedAt === 'string') step.completedAt = fields.completedAt;
    if (typeof fields.executorJobId === 'string') step.executorJobId = fields.executorJobId;
    if (typeof fields.executorRunId === 'string') step.executorRunId = fields.executorRunId;
    if (typeof fields.error === 'string') step.error = fields.error;
    if (typeof fields.contextOutput === 'string') step.contextOutput = fields.contextOutput;
  }

  // Auto-advance if step completed and next step exists
  if (step.status === 'completed' && idx === run.currentStepIndex) {
    if (idx + 1 < run.steps.length) {
      run.currentStepIndex = idx + 1;
    } else {
      // All steps done
      run.status = 'completed';
      run.completedAt = nowISO();
    }
  }

  // If step failed, mark the run as failed
  if (step.status === 'failed') {
    run.status = 'failed';
  }

  run.updatedAt = nowISO();
  writeJsonAtomic(filePath, run);
  return run;
}

function cancelRun(copilotHome, workflowRunId) {
  if (!workflowRunId) return null;
  const filePath = path.join(resolveRunsDir(copilotHome), `${workflowRunId}.json`);
  const run = readJsonIfExists(filePath);
  if (!run) return null;

  run.status = 'cancelled';
  run.completedAt = nowISO();
  run.updatedAt = nowISO();
  writeJsonAtomic(filePath, run);
  return run;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  updateTemplateScheduleMeta,
  listRuns,
  getRun,
  createRun,
  updateRunStep,
  cancelRun,
};
