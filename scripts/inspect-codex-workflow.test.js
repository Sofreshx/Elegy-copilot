#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

let collector;
const surfaceMapPath = path.join(
  __dirname,
  '..',
  'codex-assets',
  'skills',
  'evaluate-task-workflow',
  'references',
  'codex-customization-surfaces.md',
);

test.before(async () => {
  collector = await import('../codex-assets/skills/evaluate-task-workflow/scripts/inspect-codex-workflow.mjs');
});

test('customization surface map routes every supported durable authority and rejects deprecated prompts', () => {
  const surfaceMap = fs.readFileSync(surfaceMapPath, 'utf8');
  for (const surface of [
    'Prompt/thread context',
    'Global `AGENTS.md`',
    'Repository or nested `AGENTS.md`',
    'User or project `config.toml`',
    'Skill',
    'Custom agent',
    'Codex hook',
    'MCP/app',
    'App-server integration',
    'Memory',
    'Scheduled task',
    'Plugin',
    'Repository enforcement',
    'Product feedback',
    'Deprecated custom prompt',
  ]) assert.match(surfaceMap, new RegExp(`\\| ${surface.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')} \\|`));

  assert.match(surfaceMap, /Global `AGENTS\.md`[\s\S]*Repeated personal behavior/);
  assert.match(surfaceMap, /Skill[\s\S]*Reusable procedure/);
  assert.match(surfaceMap, /Custom agent[\s\S]*Specialized independent work/);
  assert.match(surfaceMap, /Codex hook[\s\S]*Deterministic lifecycle behavior/);
  assert.match(surfaceMap, /MCP\/app[\s\S]*External live system/);
  assert.match(surfaceMap, /config\.toml[\s\S]*Model, sandbox, or concurrency/);
  assert.match(surfaceMap, /Scheduled task[\s\S]*Recurring execution/);
  assert.match(surfaceMap, /Product feedback[\s\S]*Unavailable product behavior/);
  assert.match(surfaceMap, /Deprecated custom prompt[\s\S]*Never select/);
});

function recordedTransport(responses) {
  const calls = [];
  return {
    calls,
    version: '1.2.3',
    async request(method, params) {
      calls.push({ method, params });
      return responses[method] ?? {};
    },
  };
}

test('collects one explicitly selected thread through only stable read methods', async () => {
  const transport = recordedTransport({
    'thread/read': { thread: { id: 'thread-42', status: 'completed', cwd: 'C:\\private\\repo' } },
    'thread/goal/get': { goal: { objective: 'Ship the collector', status: 'complete' } },
    'config/read': { layers: [{ scope: 'user', path: 'C:\\Users\\private\\.codex\\config.toml' }] },
    'configRequirements/read': { requirements: [{ key: 'approval_policy', status: 'satisfied' }] },
    'skills/list': { skills: [{ name: 'evaluate-task-workflow', enabled: true }] },
    'hooks/list': { hooks: [{ name: 'preflight', enabled: false }] },
    'mcpServerStatus/list': { servers: [{ name: 'docs', configured: true, enabled: true, callable: false, blockedByPolicy: true }] },
  });

  const result = await collector.collectCodexWorkflow({ transport, threadId: 'thread-42' });

  assert.deepEqual(transport.calls.map(({ method }) => method), collector.STABLE_READ_METHODS);
  assert.deepEqual(transport.calls[0], { method: 'thread/read', params: { threadId: 'thread-42', includeTurns: true } });
  assert.deepEqual(transport.calls[1], { method: 'thread/goal/get', params: { threadId: 'thread-42' } });
  assert.equal(result.thread.id, 'thread-42');
  assert.equal(result.collector.version, '1.2.3');
  assert.equal(result.surfaces.skills.items[0].state, 'enabled');
  assert.equal(result.surfaces.hooks.items[0].state, 'discovered');
  assert.equal(result.surfaces.mcpServers.items[0].state, 'policy-blocked');
  assert.doesNotMatch(JSON.stringify(result), /C:\\private|C:\\Users\\private/);
});

test('summarizes the accepted real-session compaction and fan-out shape without retaining content or recommendations', async () => {
  const acceptedThreadId = '019fbcb7-3807-7022-80f4-85a77f1738ee';
  const transport = recordedTransport({
    'thread/read': {
      thread: {
        id: acceptedThreadId,
        turns: [{
          items: [
            { id: 'compact-1', type: 'contextCompaction', status: 'completed', createdAt: '2026-08-01T10:00:00Z', message: 'private compaction body' },
            { id: 'start-1', type: 'subAgentActivity', status: 'started', createdAt: '2026-08-01T10:01:00Z', agent: { id: 'agent-architecture', name: 'architecture_review' }, reasoning: 'private reasoning' },
            { id: 'start-2', type: 'subAgentActivity', status: 'started', createdAt: '2026-08-01T10:02:00Z', agent: { id: 'agent-tests', name: 'test_runner' }, toolCall: { arguments: 'private tool body' } },
            { id: 'start-3', type: 'subAgentActivity', status: 'started', agent: { id: 'agent-3', name: 'agent_kit_foundation' } },
            { id: 'start-4', type: 'subAgentActivity', status: 'started', agent: { id: 'agent-4', name: 'question_studio_integration_audit' } },
            { id: 'start-5', type: 'subAgentActivity', status: 'started', agent: { id: 'agent-5', name: 'showcase_integration_audit' } },
            { id: 'start-6', type: 'subAgentActivity', status: 'started', agent: { id: 'agent-6', name: 'showcase_discovery_impl' } },
            { id: 'start-7', type: 'subAgentActivity', status: 'started', agent: { id: 'agent-7', name: 'showcase_rust_agent_impl' } },
            { id: 'start-8', type: 'subAgentActivity', status: 'started', agent: { id: 'agent-8', name: 'question_authoring_contract_impl' } },
            { id: 'start-9', type: 'subAgentActivity', status: 'started', agent: { id: 'agent-9', name: 'opencode_provider_impl2' } },
            { id: 'compact-2', type: 'contextCompaction', status: 'completed', createdAt: '2026-08-01T10:03:00Z', content: 'private content' },
          ],
        }],
      },
    },
    'thread/goal/get': {},
    'config/read': {},
    'configRequirements/read': {},
    'skills/list': {},
    'hooks/list': {},
    'mcpServerStatus/list': {},
  });

  const result = await collector.collectCodexWorkflow({ transport, threadId: acceptedThreadId });
  const encoded = JSON.stringify(result);

  assert.equal(result.structuralEvents.contextCompactions.length, 2);
  assert.equal(result.structuralEvents.subAgentActivityStarts.length, 9);
  assert.ok(result.structuralEvents.subAgentActivityStarts.some((event) => event.agentName === 'architecture_review'));
  assert.doesNotMatch(encoded, /private compaction body|private reasoning|private tool body|private content|improvementCandidates|recommendation/i);
});

test('requires a non-empty exact thread selector before transport calls', async () => {
  const transport = recordedTransport({});
  await assert.rejects(
    () => collector.collectCodexWorkflow({ transport, threadId: ' ' }),
    /exact non-empty threadId/i,
  );
  assert.deepEqual(transport.calls, []);
});

test('marks a mismatched thread/read identity unavailable and drops its structural evidence', async () => {
  const transport = recordedTransport({
    'thread/read': { thread: { id: 'different-thread', turns: [{ items: [{ type: 'contextCompaction' }] }] } },
    'thread/goal/get': {},
    'config/read': {},
    'configRequirements/read': {},
    'skills/list': {},
    'hooks/list': {},
    'mcpServerStatus/list': {},
  });

  const result = await collector.collectCodexWorkflow({ transport, threadId: 'selected-thread' });

  assert.equal(result.collector.readStatus['thread/read'], 'unavailable');
  assert.equal(result.thread.id, 'selected-thread');
  assert.equal(result.thread.identityStatus, 'mismatch');
  assert.deepEqual(result.structuralEvents, { contextCompactions: [], subAgentActivityStarts: [] });
});

test('fails soft on an unavailable stable method while recording its read status', async () => {
  const transport = recordedTransport({
    'thread/read': { thread: { id: 'thread-42' } },
    'thread/goal/get': {},
    'config/read': {},
    'configRequirements/read': {},
    'skills/list': {},
    'mcpServerStatus/list': {},
  });
  const request = transport.request;
  transport.request = async (method, params) => {
    if (method === 'hooks/list') throw new Error('request timed out');
    return request(method, params);
  };

  const result = await collector.collectCodexWorkflow({ transport, threadId: 'thread-42' });

  assert.equal(result.collector.readStatus['hooks/list'], 'unavailable');
  assert.deepEqual(result.surfaces.hooks.items, []);
  assert.deepEqual(transport.calls.map(({ method }) => method), collector.STABLE_READ_METHODS.filter((method) => method !== 'hooks/list'));
});

test('preserves a stable response continuation cursor and separates configured from callable states', async () => {
  const transport = recordedTransport({
    'thread/read': { thread: { id: 'thread-42', title: 'api_key=hidden Bearer bearer-secret sk-secret C:\\private\\repo /home/private/repo' } },
    'thread/goal/get': {},
    'config/read': { layers: [{ name: 'user-config', configured: true }] },
    'configRequirements/read': { requirements: [{ name: 'approval', status: 'policy-blocked' }] },
    'skills/list': { skills: [{ name: 'skill', configured: true, description: 'private free-form skill description' }], nextCursor: 'skills:2' },
    'hooks/list': {},
    'mcpServerStatus/list': { servers: [{ name: 'server', callable: true }] },
  });

  const result = await collector.collectCodexWorkflow({ transport, threadId: 'thread-42' });

  assert.equal(result.surfaces.skills.page.nextCursor, 'skills:2');
  assert.equal(result.configuration.layers.items[0].state, 'configured');
  assert.equal(result.configuration.requirements.items[0].state, 'policy-blocked');
  assert.equal(result.surfaces.mcpServers.items[0].state, 'callable');
  assert.doesNotMatch(JSON.stringify(result), /hidden|bearer-secret|sk-secret|C:\\private|\/home\/private/);
  assert.doesNotMatch(JSON.stringify(result), /private free-form skill description/);
});

test('uses only supplied instruction paths and direct custom-agent TOMLs within supplied roots', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inspect-codex-workflow-'));
  try {
    const activeAgents = path.join(root, 'AGENTS.md');
    const ignoredAgents = path.join(root, 'nested', 'AGENTS.md');
    const agentRoot = path.join(root, 'agents');
    fs.mkdirSync(path.dirname(ignoredAgents), { recursive: true });
    fs.mkdirSync(path.join(agentRoot, 'nested'), { recursive: true });
    fs.writeFileSync(activeAgents, 'Active instruction', 'utf8');
    fs.writeFileSync(ignoredAgents, 'Do not discover recursively', 'utf8');
    fs.writeFileSync(path.join(agentRoot, 'reviewer.toml'), 'name = "reviewer"', 'utf8');
    fs.writeFileSync(path.join(agentRoot, 'nested', 'ignored.toml'), 'name = "ignored"', 'utf8');

    const filesystem = collector.readBoundedFilesystem({
      activeInstructionPaths: [activeAgents],
      customAgentRoots: [agentRoot],
    });

    assert.deepEqual(filesystem.instructions.map((item) => item.name), ['AGENTS.md']);
    assert.deepEqual(filesystem.customAgents.map((item) => item.name), ['reviewer.toml']);
    assert.doesNotMatch(JSON.stringify(filesystem), new RegExp(root.replace(/\\/g, '\\\\')));
    assert.doesNotMatch(JSON.stringify(filesystem), /Do not discover recursively|ignored/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('collects filesystem evidence only through bounded filesystem options', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inspect-codex-workflow-api-'));
  try {
    const agentsPath = path.join(root, 'AGENTS.md');
    const agentRoot = path.join(root, 'agents');
    fs.mkdirSync(agentRoot, { recursive: true });
    fs.writeFileSync(agentsPath, 'Active instruction', 'utf8');
    fs.writeFileSync(path.join(agentRoot, 'worker.toml'), 'name = "worker"', 'utf8');
    const transport = recordedTransport({
      'thread/read': { thread: { id: 'thread-42' } },
      'thread/goal/get': {},
      'config/read': {},
      'configRequirements/read': {},
      'skills/list': {},
      'hooks/list': {},
      'mcpServerStatus/list': {},
    });

    const result = await collector.collectCodexWorkflow({
      transport,
      threadId: 'thread-42',
      filesystemOptions: { activeInstructionPaths: [agentsPath], customAgentRoots: [agentRoot] },
    });

    assert.deepEqual(result.filesystem.instructions.map((item) => item.name), ['AGENTS.md']);
    assert.deepEqual(result.filesystem.customAgents.map((item) => item.name), ['worker.toml']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('projects collection output deterministically, paginates items, and keeps it within 512 KiB', async () => {
  const transport = recordedTransport({
    'thread/read': { thread: { id: 'thread-42', note: 'x'.repeat(800000), token: 'secret-value' } },
    'thread/goal/get': {},
    'config/read': {
      layers: Array.from({ length: 200 }, (_, index) => ({
        name: `layer-${index}`,
        description: 'y'.repeat(10000),
      })),
    },
    'configRequirements/read': {},
    'skills/list': { skills: Array.from({ length: 3 }, (_, index) => ({ name: `skill-${index}` })) },
    'hooks/list': {},
    'mcpServerStatus/list': {},
  });

  const result = await collector.collectCodexWorkflow({ transport, threadId: 'thread-42', pageSize: 2 });
  const encoded = JSON.stringify(result);

  assert.ok(Buffer.byteLength(encoded) <= collector.MAX_PROJECTION_BYTES);
  assert.equal(result.surfaces.skills.items.length, 2);
  assert.equal(result.surfaces.skills.page.nextCursor, '2');
  assert.doesNotMatch(encoded, /secret-value|xxxxxxxx/);
  assert.equal(result.projection.truncated, true);
});
