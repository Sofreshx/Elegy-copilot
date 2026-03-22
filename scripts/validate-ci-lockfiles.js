#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

const requiredLockfiles = [
  'package-lock.json',
  path.join('scripts', 'package-lock.json'),
  path.join('copilot-ui', 'package-lock.json'),
  path.join('local-tracker', 'package-lock.json'),
];

const missing = requiredLockfiles.filter((relativePath) => {
const fullPath = path.join(repoRoot, relativePath);
return !fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile();
});

if (missing.length > 0) {
console.error('CI lockfile preflight failed. Missing required lockfile(s):');
for (const relativePath of missing) {
console.error(`  - ${relativePath}`);
}
process.exit(1);
}

console.log(`CI lockfile preflight passed (${requiredLockfiles.length} lockfiles found).`);
