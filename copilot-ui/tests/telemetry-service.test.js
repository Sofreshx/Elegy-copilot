'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const telemetryService = require('../lib/telemetryService');
const Database = require('better-sqlite3');

test('OpenCode telemetry aggregates sampled tools and errors from log files', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-telemetry-opencode-'));
  const logDir = path.join(tmp, 'log');
  fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(
    path.join(logDir, '2026-06-15T120000.log'),
    [
      'INFO 2026-06-15T12:00:00Z service=llm providerID=opencode-go modelID=deepseek-v4-flash agent=build mode=primary session.id=s1 small=true',
      'INFO 2026-06-15T12:00:01Z service=tool name=shell_command tool_call.id=t1',
      'ERROR 2026-06-15T12:00:02Z tool failed permission denied',
      'WARN 2026-06-15T12:00:03Z request timeout while calling provider',
    ].join('\n'),
    'utf8',
  );
  const opencodeHome = path.join(tmp, 'opencode-home');
  fs.mkdirSync(opencodeHome, { recursive: true });
  fs.writeFileSync(
    path.join(opencodeHome, 'opencode.jsonc'),
    JSON.stringify({ experimental: { openTelemetry: true } }),
    'utf8',
  );

  const data = telemetryService.buildOpenCodeTelemetry({ logDir, opencodeHome, limit: 50 });

  assert.equal(data.coverage, 'sampled-log-files');
  assert.equal(data.source.openTelemetry, true);
  assert.equal(data.summary.requests, 1);
  assert.equal(data.summary.toolEvents, 2);
  assert.equal(data.summary.errors, 2);
  assert.deepEqual(data.topTools[0], { name: 'shell_command', count: 1 });
  assert.ok(data.errorsByType.some((row) => row.name === 'permission'));
  assert.ok(data.errorsByType.some((row) => row.name === 'timeout'));
});

test('Codex telemetry reports session-index-only coverage without parsing sqlite content', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-telemetry-codex-'));
  fs.writeFileSync(
    path.join(tmp, 'session_index.jsonl'),
    [
      JSON.stringify({ id: 'sess-1', updated_at: '2026-06-15T11:00:00Z', thread_name: 'First' }),
      JSON.stringify({ id: 'sess-2', updated_at: '2026-06-15T12:00:00Z', thread_name: 'Second' }),
      '{bad json',
    ].join('\n'),
    'utf8',
  );

  const data = telemetryService.buildCodexTelemetry({ codexHome: tmp, limit: 50 });

  assert.equal(data.coverage, 'session-index-only');
  assert.equal(data.summary.sessions, 2);
  assert.equal(data.recentEvents[0].label, 'Second');
  assert.deepEqual(data.topTools, []);
  assert.deepEqual(data.errorsByType, []);
});

test('Codex subagent telemetry aggregates state_5 sqlite and rollout metadata', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-telemetry-codex-state-'));
  const rolloutPath = path.join(tmp, 'rollout.jsonl');
  fs.writeFileSync(
    rolloutPath,
    [
      JSON.stringify({ type: 'function_call', name: 'shell_command' }),
      JSON.stringify({ type: 'token_count', payload: { total_token_usage: { input_tokens: 10, cached_input_tokens: 2, output_tokens: 5, reasoning_output_tokens: 1, total_tokens: 16 } } }),
      JSON.stringify({ type: 'task_complete' }),
    ].join('\n'),
    'utf8',
  );
  const db = new Database(path.join(tmp, 'state_5.sqlite'));
  db.exec(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      agent_role TEXT,
      agent_nickname TEXT,
      model TEXT,
      reasoning_effort TEXT,
      sandbox_mode TEXT,
      rollout_path TEXT,
      tokens_used INTEGER,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE thread_spawn_edges (
      parent_thread_id TEXT,
      child_thread_id TEXT,
      status TEXT
    );
  `);
  db.prepare('INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    'child-1',
    'explorer',
    'Scout',
    'gpt-5.4-mini',
    'low',
    'read-only',
    rolloutPath,
    16,
    '2026-07-04T10:00:00Z',
    '2026-07-04T10:01:00Z',
  );
  db.prepare('INSERT INTO thread_spawn_edges VALUES (?, ?, ?)').run('parent-1', 'child-1', 'closed');
  db.close();

  const usage = telemetryService.buildCodexSubagentUsage({ codexHome: tmp, limit: 50 });

  assert.equal(usage.coverage, 'codex-state-plus-rollouts');
  assert.equal(usage.summary.runs, 1);
  assert.equal(usage.summary.tokens, 16);
  assert.equal(usage.summary.toolEvents, 1);
  assert.equal(usage.byAgent[0].name, 'explorer');
  assert.equal(usage.runs[0].completed, true);
});
