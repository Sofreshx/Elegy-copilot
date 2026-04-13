'use strict';

const hookRulesServiceDefault = require('../lib/hookRulesService');
const { sendJson: defaultSendJson, readJsonBody: defaultReadJsonBody } = require('./_helpers');

/**
 * Hook rules API routes.
 * GET  /api/hooks/rules       — list all rules with current state
 * PATCH /api/hooks/rules/:id  — toggle a single rule
 * POST /api/hooks/rules/batch — batch toggle multiple rules
 */
function register(deps = {}) {
  const resolvedDeps = {
    sendJson: deps.sendJson || defaultSendJson,
    readJsonBody: deps.readJsonBody || defaultReadJsonBody,
    hookRulesService: deps.hookRulesService || hookRulesServiceDefault,
  };

  return [
    {
      method: 'GET',
      path: '/api/hooks/rules',
      handler: (ctx) => handleListRules(ctx, resolvedDeps),
    },
    {
      method: 'PATCH',
      path: /^\/api\/hooks\/rules\/([a-z0-9-]+)$/,
      handler: (ctx) => handleToggleRule(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/hooks/rules/batch',
      handler: (ctx) => handleBatchToggle(ctx, resolvedDeps),
    },
  ];
}

function handleListRules(ctx, deps) {
  const { copilotHome } = ctx;
  if (!copilotHome) {
    deps.sendJson(ctx.res, 500, { error: 'copilotHome not available' });
    return;
  }
  const result = deps.hookRulesService.getEffectiveRules(copilotHome);
  deps.sendJson(ctx.res, 200, result);
}

async function handleToggleRule(ctx, deps) {
  const { copilotHome } = ctx;
  if (!copilotHome) {
    deps.sendJson(ctx.res, 500, { error: 'copilotHome not available' });
    return;
  }

  const ruleId = ctx.match && ctx.match[1];
  if (!ruleId) {
    deps.sendJson(ctx.res, 400, { error: 'Missing rule ID' });
    return;
  }

  let body;
  try {
    body = await deps.readJsonBody(ctx.req);
  } catch (err) {
    deps.sendJson(ctx.res, err.statusCode || 400, { error: err.message });
    return;
  }

  if (typeof body.enabled !== 'boolean') {
    deps.sendJson(ctx.res, 400, { error: 'Body must include { "enabled": true|false }' });
    return;
  }

  const updated = deps.hookRulesService.toggleRule(copilotHome, ruleId, body.enabled);
  if (!updated) {
    deps.sendJson(ctx.res, 404, { error: `Rule not found: ${ruleId}` });
    return;
  }

  deps.sendJson(ctx.res, 200, updated);
}

async function handleBatchToggle(ctx, deps) {
  const { copilotHome } = ctx;
  if (!copilotHome) {
    deps.sendJson(ctx.res, 500, { error: 'copilotHome not available' });
    return;
  }

  let body;
  try {
    body = await deps.readJsonBody(ctx.req);
  } catch (err) {
    deps.sendJson(ctx.res, err.statusCode || 400, { error: err.message });
    return;
  }

  if (!Array.isArray(body.updates)) {
    deps.sendJson(ctx.res, 400, { error: 'Body must include { "updates": [{ "id": "...", "enabled": true|false }] }' });
    return;
  }

  for (const update of body.updates) {
    if (typeof update.id !== 'string' || typeof update.enabled !== 'boolean') {
      deps.sendJson(ctx.res, 400, { error: 'Each update must have { "id": string, "enabled": boolean }' });
      return;
    }
  }

  const result = deps.hookRulesService.batchToggle(copilotHome, body.updates);
  deps.sendJson(ctx.res, 200, result);
}

module.exports = { register };
