#!/usr/bin/env node
'use strict';

const path = require('path');
const { pathToFileURL } = require('url');

const gateName = 'Repo Skill Sync Gate';

async function loadModule() {
  const modulePath = path.resolve(__dirname, 'sync-repo-skills.mjs');
  return import(pathToFileURL(modulePath).href);
}

async function runValidation(options = {}) {
  const syncModule = await loadModule();
  const result = syncModule.runRepoSkillSync({
    repoRoot: options.repoRoot,
    configPath: options.configPath,
    targets: options.targets,
    check: true,
  });

  const errors = [];
  for (const entry of result.results) {
    if (entry.action === 'missing_mirror') {
      errors.push(`${entry.target}:${entry.skill} missing generated mirror at ${path.relative(result.repoRoot, entry.mirrorPath).replace(/\\/g, '/')}`);
    } else if (entry.action === 'unexpected_mirror') {
      errors.push(`${entry.target}:${entry.skill} unexpected generated mirror at ${path.relative(result.repoRoot, entry.mirrorPath).replace(/\\/g, '/')}`);
    } else if (entry.action === 'stale_mirror') {
      errors.push(`${entry.target}:${entry.skill} stale generated mirror at ${path.relative(result.repoRoot, entry.mirrorPath).replace(/\\/g, '/')}`);
    }
  }

  return {
    gateName,
    result,
    errors,
  };
}

async function main() {
  const validation = await runValidation();
  if (validation.errors.length > 0) {
    for (const error of validation.errors) {
      console.error(`${gateName} failed: ${error}`);
    }
    process.exit(1);
  }

  console.log(`${gateName} ok`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`${gateName} failed: ${error.message || String(error)}`);
    process.exit(1);
  });
}

module.exports = {
  gateName,
  runValidation,
};
