'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const telemetryService = require('../lib/telemetryService');

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
