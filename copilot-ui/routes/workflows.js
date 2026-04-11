'use strict';

const workflowTemplateService = require('../lib/workflowTemplateService');
const { sendJson: defaultSendJson, readJsonBody: defaultReadJsonBody } = require('./_helpers');

// ---------------------------------------------------------------------------
// Handlers — Templates
// ---------------------------------------------------------------------------

function handleListTemplates(ctx, deps) {
  try {
    const templates = deps.workflowTemplateService.listTemplates(ctx.copilotHomeAbs || ctx.copilotHome);
    deps.sendJson(ctx.res, 200, { templates });
  } catch (error) {
    const code = typeof error.statusCode === 'number' ? error.statusCode : 500;
    deps.sendJson(ctx.res, code, { error: error.message });
  }
}

function handleGetTemplate(ctx, deps) {
  try {
    const templateId = decodeURIComponent(ctx.match[1] || '').trim();
    const template = deps.workflowTemplateService.getTemplate(ctx.copilotHomeAbs || ctx.copilotHome, templateId);
    if (!template) {
      deps.sendJson(ctx.res, 404, { error: 'Template not found' });
      return;
    }
    deps.sendJson(ctx.res, 200, template);
  } catch (error) {
    const code = typeof error.statusCode === 'number' ? error.statusCode : 500;
    deps.sendJson(ctx.res, code, { error: error.message });
  }
}

function handleCreateTemplate(ctx, deps) {
  deps.readJsonBody(ctx.req)
    .then((body) => {
      const template = deps.workflowTemplateService.createTemplate(
        ctx.copilotHomeAbs || ctx.copilotHome,
        body,
      );
      deps.sendJson(ctx.res, 201, template);
    })
    .catch((error) => {
      const code = typeof error.statusCode === 'number' ? error.statusCode : 500;
      deps.sendJson(ctx.res, code, { error: error.message });
    });
}

function handleUpdateTemplate(ctx, deps) {
  deps.readJsonBody(ctx.req)
    .then((body) => {
      const templateId = decodeURIComponent(ctx.match[1] || '').trim();
      const updated = deps.workflowTemplateService.updateTemplate(
        ctx.copilotHomeAbs || ctx.copilotHome,
        templateId,
        body,
      );
      if (!updated) {
        deps.sendJson(ctx.res, 404, { error: 'Template not found' });
        return;
      }
      deps.sendJson(ctx.res, 200, updated);
    })
    .catch((error) => {
      const code = typeof error.statusCode === 'number' ? error.statusCode : 500;
      deps.sendJson(ctx.res, code, { error: error.message });
    });
}

function handleDeleteTemplate(ctx, deps) {
  try {
    const templateId = decodeURIComponent(ctx.match[1] || '').trim();
    const deleted = deps.workflowTemplateService.deleteTemplate(ctx.copilotHomeAbs || ctx.copilotHome, templateId);
    if (!deleted) {
      deps.sendJson(ctx.res, 404, { error: 'Template not found' });
      return;
    }
    deps.sendJson(ctx.res, 200, { deleted: true });
  } catch (error) {
    const code = typeof error.statusCode === 'number' ? error.statusCode : 500;
    deps.sendJson(ctx.res, code, { error: error.message });
  }
}

// ---------------------------------------------------------------------------
// Handlers — Runs
// ---------------------------------------------------------------------------

function handleListRuns(ctx, deps) {
  try {
    const copilotHome = ctx.copilotHomeAbs || ctx.copilotHome;
    const filters = {};
    if (ctx.u && ctx.u.searchParams) {
      const projectId = ctx.u.searchParams.get('projectId');
      const status = ctx.u.searchParams.get('status');
      if (projectId) filters.projectId = projectId;
      if (status) filters.status = status;
    }
    const runs = deps.workflowTemplateService.listRuns(copilotHome, filters);
    deps.sendJson(ctx.res, 200, { runs });
  } catch (error) {
    const code = typeof error.statusCode === 'number' ? error.statusCode : 500;
    deps.sendJson(ctx.res, code, { error: error.message });
  }
}

function handleGetRun(ctx, deps) {
  try {
    const runId = decodeURIComponent(ctx.match[1] || '').trim();
    const run = deps.workflowTemplateService.getRun(ctx.copilotHomeAbs || ctx.copilotHome, runId);
    if (!run) {
      deps.sendJson(ctx.res, 404, { error: 'Run not found' });
      return;
    }
    deps.sendJson(ctx.res, 200, run);
  } catch (error) {
    const code = typeof error.statusCode === 'number' ? error.statusCode : 500;
    deps.sendJson(ctx.res, code, { error: error.message });
  }
}

function handleLaunchRun(ctx, deps) {
  deps.readJsonBody(ctx.req)
    .then(async (body) => {
      const copilotHome = ctx.copilotHomeAbs || ctx.copilotHome;

      if (deps.workflowExecutionService) {
        const run = await deps.workflowExecutionService.launchRun(copilotHome, body.templateId, {
          projectId: body.projectId,
          repoPath: body.repoPath,
        });
        deps.sendJson(ctx.res, 201, run);
      } else {
        const run = deps.workflowTemplateService.createRun(copilotHome, body);
        deps.sendJson(ctx.res, 201, run);
      }
    })
    .catch((error) => {
      const code = typeof error.statusCode === 'number' ? error.statusCode : 500;
      deps.sendJson(ctx.res, code, { error: error.message });
    });
}

function handleApproveStep(ctx, deps) {
  deps.readJsonBody(ctx.req)
    .then((body) => {
      const runId = decodeURIComponent(ctx.match[1] || '').trim();
      const copilotHome = ctx.copilotHomeAbs || ctx.copilotHome;
      const run = deps.workflowTemplateService.getRun(copilotHome, runId);
      if (!run) {
        deps.sendJson(ctx.res, 404, { error: 'Run not found' });
        return;
      }
      const stepIndex = run.currentStepIndex;
      const step = run.steps[stepIndex];
      if (!step || step.status !== 'awaiting-approval') {
        deps.sendJson(ctx.res, 400, { error: 'Current step is not awaiting approval' });
        return;
      }
      const now = new Date().toISOString();
      const updated = deps.workflowTemplateService.updateRunStep(copilotHome, runId, stepIndex, {
        status: 'completed',
        completedAt: now,
        outcome: (body && body.outcome) || 'approved',
      });

      // If execution service is available, auto-advance to next step
      if (deps.workflowExecutionService && updated && updated.status === 'running') {
        const nextIndex = updated.currentStepIndex;
        if (nextIndex > stepIndex) {
          deps.workflowExecutionService._executeStep(copilotHome, runId, nextIndex).catch((err) => {
            console.error(`[workflow-engine] Failed to start step ${nextIndex} after approval: ${err.message}`);
          });
        }
      }

      deps.sendJson(ctx.res, 200, updated);
    })
    .catch((error) => {
      const code = typeof error.statusCode === 'number' ? error.statusCode : 500;
      deps.sendJson(ctx.res, code, { error: error.message });
    });
}

function handleResumeRun(ctx, deps) {
  deps.readJsonBody(ctx.req)
    .then(() => {
      const runId = decodeURIComponent(ctx.match[1] || '').trim();
      const copilotHome = ctx.copilotHomeAbs || ctx.copilotHome;
      const run = deps.workflowTemplateService.getRun(copilotHome, runId);
      if (!run) {
        deps.sendJson(ctx.res, 404, { error: 'Run not found' });
        return;
      }
      if (run.status !== 'paused' && run.status !== 'failed') {
        deps.sendJson(ctx.res, 400, { error: 'Run is not paused or failed' });
        return;
      }
      const stepIndex = run.currentStepIndex;
      const now = new Date().toISOString();
      // Update the current step to running — updateRunStep handles persistence
      const updated = deps.workflowTemplateService.updateRunStep(copilotHome, runId, stepIndex, {
        status: 'running',
        startedAt: now,
      });
      deps.sendJson(ctx.res, 200, updated || run);
    })
    .catch((error) => {
      const code = typeof error.statusCode === 'number' ? error.statusCode : 500;
      deps.sendJson(ctx.res, code, { error: error.message });
    });
}

function handleCancelRun(ctx, deps) {
  try {
    const runId = decodeURIComponent(ctx.match[1] || '').trim();
    const run = deps.workflowTemplateService.cancelRun(ctx.copilotHomeAbs || ctx.copilotHome, runId);
    if (!run) {
      deps.sendJson(ctx.res, 404, { error: 'Run not found' });
      return;
    }
    deps.sendJson(ctx.res, 200, run);
  } catch (error) {
    const code = typeof error.statusCode === 'number' ? error.statusCode : 500;
    deps.sendJson(ctx.res, code, { error: error.message });
  }
}

// ---------------------------------------------------------------------------
// Handlers — Run Events (SSE) & Retry
// ---------------------------------------------------------------------------

function handleRunEvents(ctx, deps) {
  const runId = decodeURIComponent(ctx.match[1] || '').trim();
  if (!runId) {
    deps.sendJson(ctx.res, 400, { error: 'runId is required' });
    return;
  }

  ctx.res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // Send initial run state
  const copilotHome = ctx.copilotHomeAbs || ctx.copilotHome;
  const run = deps.workflowTemplateService.getRun(copilotHome, runId);
  if (run) {
    ctx.res.write(`data: ${JSON.stringify({ type: 'workflow.run.state', run })}\n\n`);
  }

  // Subscribe to workflow events
  const handler = (event) => {
    if (event.runId === runId) {
      ctx.res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  };

  if (deps.workflowExecutionService) {
    deps.workflowExecutionService.on('workflow:event', handler);
  }

  // Keep-alive ping
  const keepAlive = setInterval(() => {
    ctx.res.write(': keepalive\n\n');
  }, 15000);

  ctx.req.on('close', () => {
    clearInterval(keepAlive);
    if (deps.workflowExecutionService) {
      deps.workflowExecutionService.off('workflow:event', handler);
    }
  });
}

function handleRetryStep(ctx, deps) {
  deps.readJsonBody(ctx.req)
    .then(async (body) => {
      const runId = decodeURIComponent(ctx.match[1] || '').trim();
      const copilotHome = ctx.copilotHomeAbs || ctx.copilotHome;

      if (!deps.workflowExecutionService) {
        deps.sendJson(ctx.res, 503, { error: 'Workflow execution service unavailable' });
        return;
      }

      const run = await deps.workflowExecutionService.retryStep(
        copilotHome, runId, body.stepIndex,
      );
      deps.sendJson(ctx.res, 200, run);
    })
    .catch((error) => {
      const code = typeof error.statusCode === 'number' ? error.statusCode : 500;
      deps.sendJson(ctx.res, code, { error: error.message });
    });
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

function register(deps = {}) {
  const resolvedDeps = {
    sendJson: deps.sendJson || defaultSendJson,
    readJsonBody: deps.readJsonBody || defaultReadJsonBody,
    workflowTemplateService: deps.workflowTemplateService || workflowTemplateService,
    workflowExecutionService: deps.workflowExecutionService || null,
  };

  return [
    // Templates
    {
      method: 'GET',
      path: '/api/workflows/templates',
      handler: (ctx) => handleListTemplates(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: /^\/api\/workflows\/templates\/([^/]+)$/,
      handler: (ctx) => handleGetTemplate(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/workflows/templates',
      handler: (ctx) => handleCreateTemplate(ctx, resolvedDeps),
    },
    {
      method: 'PATCH',
      path: /^\/api\/workflows\/templates\/([^/]+)$/,
      handler: (ctx) => handleUpdateTemplate(ctx, resolvedDeps),
    },
    {
      method: 'DELETE',
      path: /^\/api\/workflows\/templates\/([^/]+)$/,
      handler: (ctx) => handleDeleteTemplate(ctx, resolvedDeps),
    },
    // Runs
    {
      method: 'GET',
      path: '/api/workflows/runs',
      handler: (ctx) => handleListRuns(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: /^\/api\/workflows\/runs\/([^/]+)\/events$/,
      handler: (ctx) => handleRunEvents(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: /^\/api\/workflows\/runs\/([^/]+)$/,
      handler: (ctx) => handleGetRun(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/workflows/launch',
      handler: (ctx) => handleLaunchRun(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: /^\/api\/workflows\/runs\/([^/]+)\/approve$/,
      handler: (ctx) => handleApproveStep(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: /^\/api\/workflows\/runs\/([^/]+)\/resume$/,
      handler: (ctx) => handleResumeRun(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: /^\/api\/workflows\/runs\/([^/]+)\/retry$/,
      handler: (ctx) => handleRetryStep(ctx, resolvedDeps),
    },
    {
      method: 'DELETE',
      path: /^\/api\/workflows\/runs\/([^/]+)$/,
      handler: (ctx) => handleCancelRun(ctx, resolvedDeps),
    },
  ];
}

module.exports = { register };
