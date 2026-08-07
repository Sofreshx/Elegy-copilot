'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const packagePath = path.join(repoRoot, 'local-repo-mcp', 'package.json');

if (!fs.existsSync(packagePath)) {
  console.log('[ci-prerequisites] local-repo-mcp is not present in this checkout; skipping its build.');
  process.exit(0);
}

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(npmCommand, ['--prefix', 'local-repo-mcp', 'run', 'build'], {
  cwd: repoRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
