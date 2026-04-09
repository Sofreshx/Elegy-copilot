const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const workspaceRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(workspaceRoot, '..');
const localVitestDir = path.join(workspaceRoot, 'node_modules', 'vitest');
const localVitestPackageJson = path.join(localVitestDir, 'package.json');

// `npm exec vitest` can leave a partial workspace-local install that breaks module resolution.
if (fs.existsSync(localVitestDir) && !fs.existsSync(localVitestPackageJson)) {
  fs.rmSync(localVitestDir, { recursive: true, force: true, maxRetries: 3 });
}

const vitestCandidates = [
  path.join(localVitestDir, 'vitest.mjs'),
  path.join(repoRoot, 'node_modules', 'vitest', 'vitest.mjs'),
];

const vitestCliPath = vitestCandidates.find((candidate) => fs.existsSync(candidate));

if (!vitestCliPath) {
  console.error('Unable to locate a usable Vitest CLI entrypoint.');
  process.exit(1);
}

const result = spawnSync(process.execPath, [vitestCliPath, 'run', ...process.argv.slice(2)], {
  cwd: workspaceRoot,
  stdio: 'inherit',
  env: process.env,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
