'use strict';

const { createElegyDb } = require('../lib/elegyDb');
const { sendJson: defaultSendJson, readJsonBody: defaultReadJsonBody } = require('./_helpers');

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

// ── List agent runs ──
function handleAgentRunsList(ctx, deps) {
  const { res, u } = ctx;
  const { sendJson } = deps;

  const status = u.searchParams.get('status') || undefined;
  const action = u.searchParams.get('action') || undefined;
  const noteId = u.searchParams.get('note_id') || undefined;
  const limit = parseInt(u.searchParams.get('limit') || '50', 10);

  try {
    const db = createElegyDb();
    const filter = { limit };
    if (status) filter.status = status;
    if (action) filter.action = action;
    if (noteId) filter.note_id = noteId;
    const runs = db.listRuns(filter);
    db.close();
    sendJson(res, 200, { runs, count: runs.length });
  } catch (err) {
    sendJson(res, 500, { error: String(err.message || err) });
  }
}

// ── Get single agent run ──
function handleAgentRunGet(ctx, deps) {
  const { res, u } = ctx;
  const { sendJson } = deps;
  const id = u.searchParams.get('id');

  if (!isNonEmptyString(id)) {
    sendJson(res, 400, { error: 'id query parameter is required' });
    return;
  }

  try {
    const db = createElegyDb();
    const run = db.getRun(id.trim());
    db.close();
    if (!run) {
      sendJson(res, 404, { error: 'Agent run not found' });
      return;
    }
    sendJson(res, 200, run);
  } catch (err) {
    sendJson(res, 500, { error: String(err.message || err) });
  }
}

// ── Create agent run ──
async function handleAgentRunCreate(ctx, deps) {
  const { res, req } = ctx;
  const { sendJson, readJsonBody } = deps;

  let body;
  try { body = await readJsonBody(req); } catch (e) {
    sendJson(res, 400, { error: 'Invalid request body' });
    return;
  }

  const { parent_kind, parent_id, note_id, action, agent_name, model_id, provider_id, extra_instructions, repo_access_enabled } = body;

  if (!isNonEmptyString(parent_kind) || !isNonEmptyString(action) || !isNonEmptyString(agent_name)) {
    sendJson(res, 400, { error: 'parent_kind, action, and agent_name are required' });
    return;
  }

  const crypto = require('crypto');
  const runId = crypto.randomUUID();
  const now = new Date().toISOString();

  try {
    const db = createElegyDb();
    const run = db.createRun({
      id: runId,
      session_id: null,
      parent_kind: parent_kind.trim(),
      parent_id: parent_id || null,
      note_id: note_id || null,
      action: action.trim(),
      agent_name: agent_name.trim(),
      provider_id: provider_id || null,
      model_id: model_id || null,
      model_id_original: null,
      prompt_summary: (extra_instructions || '').slice(0, 200) || null,
      extra_instructions: extra_instructions || null,
      repo_access_enabled: repo_access_enabled ? 1 : 0,
      status: 'queued',
      started_at: now,
      ended_at: null,
      duration_ms: null,
      prompt_tokens: null,
      output_tokens: null,
      reasoning_tokens: null,
      cache_read: null,
      cache_write: null,
      cost_usd: null,
      error_code: null,
      error_message: null,
      output_text: null,
      result_block_id: null,
      metadata_json: null,
      created_by: 'user',
      workspace_id: null,
    });
    db.close();
    sendJson(res, 201, run);
  } catch (err) {
    sendJson(res, 500, { error: String(err.message || err) });
  }
}

// ── Abort agent run ──
function handleAgentRunAbort(ctx, deps) {
  const { res, u } = ctx;
  const { sendJson } = deps;
  const id = u.searchParams.get('id');

  if (!isNonEmptyString(id)) {
    sendJson(res, 400, { error: 'id query parameter is required' });
    return;
  }

  try {
    const db = createElegyDb();
    const run = db.getRun(id.trim());
    if (!run) {
      db.close();
      sendJson(res, 404, { error: 'Agent run not found' });
      return;
    }

    if (run.status !== 'running' && run.status !== 'queued') {
      db.close();
      sendJson(res, 400, { error: `Cannot abort run with status: ${run.status}` });
      return;
    }

    db.updateRun({
      id: run.id,
      status: 'aborted',
      ended_at: new Date().toISOString(),
      duration_ms: run.started_at ? Date.now() - new Date(run.started_at).getTime() : null,
    });
    db.close();
    sendJson(res, 200, { aborted: true, id: run.id });
  } catch (err) {
    sendJson(res, 500, { error: String(err.message || err) });
  }
}

// ── List completions ──
function handleAgentCompletions(ctx, deps) {
  const { res, u } = ctx;
  const { sendJson } = deps;

  const noteId = u.searchParams.get('note_id') || undefined;
  const limit = parseInt(u.searchParams.get('limit') || '20', 10);

  try {
    const db = createElegyDb();
    const runs = db.listRuns({
      status: 'completed',
      note_id: noteId,
      limit,
    });
    db.close();
    sendJson(res, 200, { completions: runs, count: runs.length });
  } catch (err) {
    sendJson(res, 500, { error: String(err.message || err) });
  }
}

// ── Health check ──
async function handleAgentHealth(ctx, deps) {
  const { res } = ctx;
  const { sendJson } = deps;

  sendJson(res, 200, {
    serverRunning: false,
    lastError: 'opencodeServer manager removed — Kimaki owns OpenCode',
  });
}

// ── SSE stream for a run ──
function handleAgentRunStream(ctx, deps) {
  const { req, res, u } = ctx;
  const { sendJson } = deps;
  
  const runId = u.searchParams.get('id');
  if (!isNonEmptyString(runId)) {
    sendJson(res, 400, { error: 'id query parameter is required' });
    return;
  }

  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const db = createElegyDb();
  const run = db.getRun(runId.trim());
  db.close();

  if (!run) {
    res.write(`data: ${JSON.stringify({ type: 'error', message: 'Run not found' })}\n\n`);
    res.end();
    return;
  }

  // Send initial state
  res.write(`data: ${JSON.stringify({ type: 'run.status', run_id: run.id, status: run.status, action: run.action, agent: run.agent_name, model: run.model_id })}\n\n`);

  // If run is already terminal, send completion and close
  if (run.status === 'completed' || run.status === 'aborted' || run.status === 'error') {
    res.write(`data: ${JSON.stringify({ type: 'run.terminal', run_id: run.id, status: run.status, output: run.output_text, error: run.error_message })}\n\n`);
    res.end();
    return;
  }

  // Poll the run status (in lieu of live opencode SSE proxying)
  // This is a polling fallback; the real SSE proxy would subscribe to opencode events
  let closed = false;
  const pollInterval = setInterval(() => {
    if (closed) return;
    try {
      const db2 = createElegyDb();
      const updated = db2.getRun(runId.trim());
      db2.close();

      if (!updated) {
        res.write(`data: ${JSON.stringify({ type: 'error', message: 'Run disappeared' })}\n\n`);
        clearInterval(pollInterval);
        res.end();
        return;
      }

      // Send status update
      res.write(`data: ${JSON.stringify({ type: 'run.status', run_id: updated.id, status: updated.status })}\n\n`);

      // Check for terminal state
      if (updated.status === 'completed') {
        res.write(`data: ${JSON.stringify({ type: 'run.terminal', run_id: updated.id, status: 'completed', output: updated.output_text, tokens: { prompt: updated.prompt_tokens, output: updated.output_tokens, cost: updated.cost_usd } })}\n\n`);
        clearInterval(pollInterval);
        res.end();
        return;
      }

      if (updated.status === 'error' || updated.status === 'aborted') {
        res.write(`data: ${JSON.stringify({ type: 'run.terminal', run_id: updated.id, status: updated.status, error: updated.error_message })}\n\n`);
        clearInterval(pollInterval);
        res.end();
        return;
      }
    } catch {
      if (!closed) {
        res.write(`data: ${JSON.stringify({ type: 'error', message: 'Poll failed' })}\n\n`);
        clearInterval(pollInterval);
        res.end();
      }
    }
  }, 1000);

  // Handle client disconnect
  req.on('close', () => {
    closed = true;
    clearInterval(pollInterval);
  });
}

// ── Register ──
function register(context = {}) {
  const sendJson = context.sendJson || defaultSendJson;
  const readJsonBody = context.readJsonBody || defaultReadJsonBody;
  const deps = { sendJson, readJsonBody };

  return [
    { method: 'GET',  path: '/api/agent/runs',        handler: (ctx) => handleAgentRunsList(ctx, deps) },
    { method: 'GET',  path: '/api/agent/runs/get',     handler: (ctx) => handleAgentRunGet(ctx, deps) },
    { method: 'POST', path: '/api/agent/runs/create',  handler: (ctx) => handleAgentRunCreate(ctx, deps) },
    { method: 'POST', path: '/api/agent/runs/abort',   handler: (ctx) => handleAgentRunAbort(ctx, deps) },
    { method: 'GET',  path: '/api/agent/completions',  handler: (ctx) => handleAgentCompletions(ctx, deps) },
    { method: 'GET',  path: '/api/agent/health',       handler: (ctx) => handleAgentHealth(ctx, deps) },
    { method: 'GET',  path: '/api/agent/runs/stream', handler: (ctx) => handleAgentRunStream(ctx, deps) },
  ];
}

module.exports = { register };
