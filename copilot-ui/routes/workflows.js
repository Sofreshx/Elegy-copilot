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

function handleSessionWorkflowLookup(ctx, deps) {
  const sessionId = decodeURIComponent(ctx.match[1] || '').trim();
  if (!sessionId) {
    deps.sendJson(ctx.res, 400, { error: 'sessionId is required' });
    return;
  }
  const copilotHome = ctx.copilotHomeAbs || ctx.copilotHome;
  const runs = deps.workflowTemplateService.listRuns(copilotHome, {});
  for (const run of runs) {
    for (let i = 0; i < run.steps.length; i++) {
      if (run.steps[i].sessionId === sessionId) {
        const template = deps.workflowTemplateService.getTemplate(copilotHome, run.templateId);
        deps.sendJson(ctx.res, 200, {
          found: true,
          workflowRunId: run.workflowRunId,
          templateId: run.templateId,
          templateName: template ? template.name : null,
          stepIndex: i,
          stepLabel: run.steps[i].label,
          stepStatus: run.steps[i].status,
        });
        return;
      }
    }
  }
  deps.sendJson(ctx.res, 200, { found: false });
}

function handleUpdateSchedule(ctx, deps) {
  deps.readJsonBody(ctx.req)
    .then(async (body) => {
      const templateId = decodeURIComponent(ctx.match[1] || '').trim();
      const copilotHome = ctx.copilotHomeAbs || ctx.copilotHome;

      if (!deps.workflowExecutionService) {
        deps.sendJson(ctx.res, 503, { error: 'Workflow execution service unavailable' });
        return;
      }

      const template = await deps.workflowExecutionService.updateSchedule(
        copilotHome, templateId, body
      );
      deps.sendJson(ctx.res, 200, template);
    })
    .catch((error) => {
      const code = typeof error.statusCode === 'number' ? error.statusCode : 500;
      deps.sendJson(ctx.res, code, { error: error.message });
    });
}

function handleSeedTemplates(ctx, deps) {
  const copilotHome = ctx.copilotHomeAbs || ctx.copilotHome;

  try {
    const existing = deps.workflowTemplateService.listTemplates(copilotHome);
    const seeded = [];

    const seeds = [
      {
        name: 'CI Monitor',
        description: 'Monitor GitHub Actions for failures and suggest fixes',
        steps: [
          {
            label: 'Check CI Status',
            objective: 'Check the GitHub Actions workflows for this repository. List any failed or failing workflow runs from the last 24 hours. Include the workflow name, branch, failure reason, and a link to the run.',
            type: 'session',
            agentId: 'orchestrator-cli',
            model: 'claude-opus-4.6',
          },
          {
            label: 'Review & Approve Fixes',
            objective: 'Review the CI failures found. Approve to proceed with fix analysis.',
            type: 'approval',
            approvalRequired: true,
          },
          {
            label: 'Analyze & Fix Failures',
            objective: 'Based on the CI failures identified in the previous step, analyze the error logs and suggest concrete fixes. If the fixes are straightforward, implement them directly.',
            type: 'session',
            agentId: 'orchestrator-cli',
            model: 'claude-opus-4.6',
          },
        ],
      },
      {
        name: 'Issue Triage',
        description: 'Read and categorize open GitHub issues',
        steps: [
          {
            label: 'Read Open Issues',
            objective: 'List all open GitHub issues for this repository. For each issue, include the title, number, labels, creation date, and a brief summary of the request or bug report. Group them by category (bug, feature request, question, documentation).',
            type: 'session',
            agentId: 'orchestrator-cli',
            model: 'gpt-5.4',
          },
          {
            label: 'Prioritize & Recommend',
            objective: 'Based on the issues found in the previous step, create a prioritized action plan. Identify which issues are most critical, which can be quick wins, and which need more investigation. Suggest assignment to appropriate team roles (frontend, backend, devops).',
            type: 'session',
            agentId: 'orchestrator-cli',
            model: 'gpt-5.4',
          },
        ],
      },
      {
        name: 'Autonomous Testing',
        description: 'Run the application, test features, and report bugs',
        steps: [
          {
            label: 'Explore & Test',
            objective: 'You are an autonomous tester. Start the application using the documented development commands (check package.json, README, or Makefile). Navigate through all major features and user flows. Log every interaction: what you tested, what worked, what did not. Pay special attention to error handling, edge cases, and UI inconsistencies. Take note of any unimplemented features, broken links, or confusing UX.',
            type: 'session',
            agentId: 'orchestrator-cli',
            model: 'claude-opus-4.6',
          },
          {
            label: 'Review Test Results',
            objective: 'Review the testing report before generating the final bug/issue list.',
            type: 'approval',
            approvalRequired: true,
          },
          {
            label: 'Generate Bug Report',
            objective: 'Based on the testing results from the exploration step, generate a structured report with: (1) Confirmed Bugs — clear reproduction steps, expected vs actual behavior, severity, (2) Missing Features — features that appear intended but are not implemented, (3) UX Issues — confusing flows, poor error messages, accessibility problems, (4) Recommendations — suggested improvements and priorities. Format as a markdown document suitable for creating GitHub issues.',
            type: 'session',
            agentId: 'orchestrator-cli',
            model: 'claude-opus-4.6',
          },
        ],
      },
      {
        name: 'DevOps Health Check',
        description: 'Check infrastructure, CI/CD, and release artifacts',
        steps: [
          {
            label: 'Infrastructure Audit',
            objective: 'Audit the DevOps setup for this repository: (1) Check GitHub Actions workflows — are they up to date, using latest action versions, have proper caching? (2) Check if release artifacts are available and downloadable on GitHub Releases. (3) Check branch protection rules and required checks. (4) Check for security vulnerabilities in dependencies (npm audit or equivalent). (5) Check Dockerfile or deployment configs if present. Report findings with severity levels.',
            type: 'session',
            agentId: 'orchestrator-cli',
            model: 'gpt-5.4',
          },
          {
            label: 'Fix & Improve',
            objective: 'Based on the infrastructure audit, implement the fixes that are safe to apply directly: update deprecated action versions, fix security vulnerabilities, improve CI caching, update documentation. For changes that require manual review, create detailed TODO items.',
            type: 'session',
            agentId: 'orchestrator-cli',
            model: 'claude-opus-4.6',
          },
        ],
      },
    ];

    for (const seed of seeds) {
      const alreadyExists = existing.some(t => t.name === seed.name);
      if (!alreadyExists) {
        const created = deps.workflowTemplateService.createTemplate(copilotHome, seed);
        seeded.push(created);
      }
    }

    deps.sendJson(ctx.res, 200, { seeded, skipped: seeds.length - seeded.length });
  } catch (error) {
    const code = typeof error.statusCode === 'number' ? error.statusCode : 500;
    deps.sendJson(ctx.res, code, { error: error.message });
  }
}

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
    {
      method: 'PUT',
      path: /^\/api\/workflows\/templates\/([^/]+)\/schedule$/,
      handler: (ctx) => handleUpdateSchedule(ctx, resolvedDeps),
    },
    // Runs
    {
      method: 'GET',
      path: /^\/api\/workflows\/sessions\/([^/]+)$/,
      handler: (ctx) => handleSessionWorkflowLookup(ctx, resolvedDeps),
    },
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
      path: '/api/workflows/seed',
      handler: (ctx) => handleSeedTemplates(ctx, resolvedDeps),
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
