#!/usr/bin/env node

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ELEGY_HOOK_MARKER = '# Elegy managed hook';

function isCiOrSkipped() {
  return !!(process.env.CI || process.env.ELEGY_SKIP_HOOKS_INSTALL);
}

function isElegyManaged(hookPath) {
  if (!fs.existsSync(hookPath)) return false;
  const content = fs.readFileSync(hookPath, 'utf8');
  return content.includes(ELEGY_HOOK_MARKER);
}

export function setupGitHooks(repoRoot = process.cwd()) {
  if (isCiOrSkipped()) {
    return {
      hooksConfigured: false,
      coreHooksPath: null,
      hooksPresent: {},
      allHooksPresent: false,
      skipped: true,
      reason: 'CI or ELEGY_SKIP_HOOKS_INSTALL env set',
    };
  }

  const githooksDir = path.join(repoRoot, '.githooks');
  const hooksPresent = {
    'pre-commit': fs.existsSync(path.join(githooksDir, 'pre-commit')),
    'pre-push': fs.existsSync(path.join(githooksDir, 'pre-push')),
  };
  const allPresent = Object.values(hooksPresent).every(Boolean);

  let currentHooksPath = null;
  try {
    currentHooksPath = execSync('git config core.hooksPath', {
      cwd: repoRoot,
      encoding: 'utf8',
      windowsHide: true,
    }).trim();
  } catch {
    // Not set
  }

  const expectedPath = '.githooks';
  let hooksPathSet = currentHooksPath === expectedPath || currentHooksPath === '.githooks';

  if (!hooksPathSet) {
    execSync('git config core.hooksPath .githooks', {
      cwd: repoRoot,
      encoding: 'utf8',
      windowsHide: true,
    });
    hooksPathSet = true;
  }

  return {
    hooksConfigured: hooksPathSet,
    coreHooksPath: expectedPath,
    previousCoreHooksPath: currentHooksPath,
    hooksPresent,
    allHooksPresent: allPresent,
    skipped: false,
  };
}

export function hookStatus(repoRoot = process.cwd()) {
  const githooksDir = path.join(repoRoot, '.githooks');

  let currentHooksPath = null;
  try {
    currentHooksPath = execSync('git config core.hooksPath', {
      cwd: repoRoot,
      encoding: 'utf8',
      windowsHide: true,
    }).trim();
  } catch {
    // Not set
  }

  const active = currentHooksPath === '.githooks';

  const hookInfo = (name) => {
    const hookPath = path.join(githooksDir, name);
    const exists = fs.existsSync(hookPath);
    const managed = exists ? isElegyManaged(hookPath) : false;
    return { exists, managed };
  };

  return {
    coreHooksPath: currentHooksPath,
    active,
    hooks: {
      'pre-commit': {
        ...hookInfo('pre-commit'),
        group: 'commit',
      },
      'pre-push': {
        ...hookInfo('pre-push'),
        group: 'push',
      },
    },
  };
}

function main() {
  const args = process.argv.slice(2);
  const repoRoot = args.find(a => !a.startsWith('--')) || process.cwd();
  const jsonOutput = args.includes('--json');
  const statusOnly = args.includes('--status');
  const force = args.includes('--force');

  if (statusOnly) {
    const result = hookStatus(repoRoot);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exit(0);
  }

  const result = setupGitHooks(repoRoot);
  if (jsonOutput) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    if (result.skipped) {
      console.log(`[hooks] Skipped: ${result.reason}`);
    } else {
      console.log(`[hooks] core.hooksPath set to ${result.coreHooksPath}`);
      for (const [name, present] of Object.entries(result.hooksPresent)) {
        console.log(`[hooks] .githooks/${name}: ${present ? 'present' : 'MISSING'}`);
      }
    }
  }

  process.exit(0);
}

if (process.argv[1]?.endsWith('setup-git-hooks.mjs')) {
  main();
}
