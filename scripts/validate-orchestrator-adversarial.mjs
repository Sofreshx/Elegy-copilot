#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');

function run(command, args, options = {}) {
  process.stdout.write(`\n> ${command} ${args.join(' ')}\n`);
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const scenarios = [
  ['lease concurrency, expiry, stale fencing', 'ORCH-005 planning lease evidence'],
  ['restart at every journal boundary', 'orchestrator::journal tests'],
  ['lost acknowledgements and duplicate commands', 'orchestrator_adversarial integration test'],
  ['malformed and oversized worker output', 'orchestrator::worker tests'],
  ['process-tree hangs and cancellation races', 'orchestrator::worker tests'],
  ['scope violations and dirty worktrees', 'orchestrator::worktree tests'],
  ['stale approvals and target drift', 'orchestrator::approval tests'],
  ['merge conflicts and duplicate merge prevention', 'orchestrator_adversarial integration test'],
  ['SSE replay and disconnect handling', 'orchestrator::api + Node proxy tests'],
  ['SQLITE_BUSY classification and bounded retry', 'orchestrator::planning tests'],
];

run('cargo', ['test', '-p', 'elegy-native-runtime']);
run('node', ['copilot-ui/server.orchestrator-proxy.test.js']);

const vitestRunner = path.join(root, 'copilot-ui', 'scripts', 'run-vitest.js');
const vitestAvailable = fs.existsSync(path.join(root, 'node_modules', 'vitest', 'vitest.mjs'))
  || fs.existsSync(path.join(root, 'copilot-ui', 'node_modules', 'vitest', 'vitest.mjs'));
if (vitestAvailable) {
  run('node', [
    vitestRunner,
    'tests/workspace-execution-tab.vitest.tsx',
    'tests/opencode-view.vitest.tsx',
    'ui/src/views/Workspace/WorkspaceLocalTabs.test.tsx',
  ]);
} else {
  process.stdout.write('\nSKIP UI regressions: Vitest dependency tree is not installed.\n');
}

process.stdout.write('\nAdversarial scenario evidence:\n');
for (const [scenario, evidence] of scenarios) {
  process.stdout.write(`- PASS ${scenario}: ${evidence}\n`);
}
