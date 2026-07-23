#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RUNTIME_FILES = [
  'commit-check-defaults.mjs',
  'commit-check-discover.mjs',
  'commit-check-setup.mjs',
  'commit-check-run.mjs',
  'setup-git-hooks.mjs',
];

const HOOK_FILES = ['pre-commit', 'pre-push'];

const VALID_MODES = new Set(['auto', 'bootstrap', 'update', 'repair']);
const sourceDir = path.dirname(fileURLToPath(import.meta.url));
const hookSourceDir = path.join(sourceDir, '..', 'hooks');

function normalizePath(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function run(command, args, cwd) {
  return spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
    windowsHide: true,
  });
}

function assertRepoRoot(repoRoot) {
  if (!repoRoot) throw new Error('Pass an explicit repository root with --repo <path>');
  const resolved = path.resolve(repoRoot);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error(`Repository root not found: ${resolved}`);
  }

  const result = run('git', ['-C', resolved, 'rev-parse', '--show-toplevel'], resolved);
  if (result.status !== 0) throw new Error(`Target is not a git repository: ${resolved}`);
  const gitRoot = (result.stdout || '').trim();
  if (normalizePath(gitRoot) !== normalizePath(resolved)) {
    throw new Error(`Target must be the git repository root: ${gitRoot}`);
  }
  return resolved;
}

function inferMode(configExists, installedCount) {
  if (!configExists && installedCount === 0) return 'bootstrap';
  if (configExists && installedCount === RUNTIME_FILES.length) return 'update';
  return 'repair';
}

function snapshot(paths) {
  return new Map(paths.map(filePath => [filePath, fs.existsSync(filePath)
    ? { exists: true, data: fs.readFileSync(filePath) }
    : { exists: false, data: null }]));
}

function restore(files, removableDirs) {
  for (const [filePath, state] of files) {
    if (state.exists) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, state.data);
    } else if (fs.existsSync(filePath)) {
      fs.rmSync(filePath, { force: true });
    }
  }
  for (const dir of removableDirs.reverse()) {
    if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  }
}

function parseRunnerJson(result) {
  if (result.status !== 0 && result.status !== 1) {
    throw new Error((result.stderr || result.stdout || 'Commit-check runner failed').trim());
  }
  try {
    const parsed = JSON.parse(result.stdout);
    if (typeof parsed.overallPass !== 'boolean') throw new Error('missing overallPass');
    return parsed;
  } catch (error) {
    throw new Error(`Commit-check runner returned invalid JSON: ${error.message}`);
  }
}

export function orchestrate(repoRoot, options = {}) {
  const targetRepo = assertRepoRoot(repoRoot);
  const requestedMode = options.mode || 'auto';
  if (!VALID_MODES.has(requestedMode)) throw new Error(`Unknown mode: ${requestedMode}`);

  const scriptsDir = path.join(targetRepo, 'scripts');
  const configDir = path.join(targetRepo, '.copilot');
  const githooksDir = path.join(targetRepo, '.githooks');
  const configPath = path.join(configDir, 'commit-checks.json');
  const backupPath = `${configPath}.bak`;
  const packagePath = path.join(targetRepo, 'package.json');
  const runtimeTargets = RUNTIME_FILES.map(name => path.join(scriptsDir, name));
  const hookTargets = HOOK_FILES.map(name => path.join(githooksDir, name));
  const installed = runtimeTargets.filter(filePath => fs.existsSync(filePath));
  const scriptsToInstall = runtimeTargets.filter(filePath => !fs.existsSync(filePath));
  const hooksToInstall = hookTargets.filter(filePath => !fs.existsSync(filePath));
  const configExists = fs.existsSync(configPath);
  const mode = requestedMode === 'auto' ? inferMode(configExists, installed.length) : requestedMode;

  if (mode === 'update' && installed.length !== RUNTIME_FILES.length) {
    throw new Error('Update requires all runtime scripts; use auto or repair mode');
  }

  const plan = {
    mode,
    scriptsToInstall: scriptsToInstall.map(filePath => path.relative(targetRepo, filePath).replaceAll('\\', '/')),
    preservedScripts: installed.map(filePath => path.relative(targetRepo, filePath).replaceAll('\\', '/')),
    hooksToInstall: hooksToInstall.map(filePath => path.relative(targetRepo, filePath).replaceAll('\\', '/')),
    preservedHooks: hookTargets.filter(filePath => fs.existsSync(filePath)).map(filePath => path.relative(targetRepo, filePath).replaceAll('\\', '/')),
    configAction: configExists ? (mode === 'bootstrap' ? 'backup-and-replace' : 'backup-and-merge') : 'create',
  };

  if (options.dryRun) {
    return { setupSucceeded: null, repositoryChecksPassed: null, targetRepo, dryRun: true, plan };
  }

  const affectedPaths = [...runtimeTargets, configPath, backupPath, packagePath, ...hookTargets];
  const before = snapshot(affectedPaths);
  const removableDirs = [scriptsDir, configDir, githooksDir].filter(dir => !fs.existsSync(dir));

  try {
    fs.mkdirSync(scriptsDir, { recursive: true });
    for (const target of scriptsToInstall) {
      const source = path.join(sourceDir, path.basename(target));
      if (!fs.existsSync(source)) throw new Error(`Bundled runtime missing: ${source}`);
      fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    }

    if (configExists) {
      fs.mkdirSync(configDir, { recursive: true });
      fs.copyFileSync(configPath, backupPath);
    }

    fs.mkdirSync(githooksDir, { recursive: true });
    for (const name of HOOK_FILES) {
      const source = path.join(hookSourceDir, name);
      const target = path.join(githooksDir, name);
      if (!fs.existsSync(source)) throw new Error(`Bundled hook missing: ${source}`);
      fs.copyFileSync(source, target);
    }

    const setupArgs = [path.join(scriptsDir, 'commit-check-setup.mjs'), targetRepo];
    if (mode === 'bootstrap') setupArgs.push('--force');
    const setupResult = run(process.execPath, setupArgs, targetRepo);
    if (setupResult.status !== 0) {
      throw new Error((setupResult.stderr || setupResult.stdout || 'Commit-check setup failed').trim());
    }

    const runnerResult = run(process.execPath, [
      path.join(scriptsDir, 'commit-check-run.mjs'),
      '--json',
      '--repo',
      targetRepo,
    ], targetRepo);
    const smoke = parseRunnerJson(runnerResult);

    const hookResult = run(process.execPath, [
      path.join(scriptsDir, 'setup-git-hooks.mjs'),
      '--json',
      targetRepo,
    ], targetRepo);
    let hookSetup = null;
    try { hookSetup = JSON.parse(hookResult.stdout); } catch { /* non-fatal */ }

    return {
      setupSucceeded: true,
      repositoryChecksPassed: smoke.overallPass,
      targetRepo,
      dryRun: false,
      plan,
      mutation: {
        scriptsInstalled: plan.scriptsToInstall,
        scriptsPreserved: plan.preservedScripts,
        hooksInstalled: plan.hooksToInstall,
        hooksPreserved: plan.preservedHooks,
        configPath: path.relative(targetRepo, configPath).replaceAll('\\', '/'),
        backupPath: configExists ? path.relative(targetRepo, backupPath).replaceAll('\\', '/') : null,
      },
      hooks: {
        configured: hookSetup?.hooksConfigured ?? false,
        coreHooksPath: hookSetup?.coreHooksPath ?? '.githooks',
        skipped: hookSetup?.skipped ?? false,
        allHooksPresent: hookSetup?.allHooksPresent ?? true,
      },
      checks: {
        overallPass: smoke.overallPass,
        compositeScore: smoke.compositeScore,
        blockingFailures: smoke.blockingFailures || [],
        lanes: smoke.lanes || {},
      },
    };
  } catch (error) {
    restore(before, removableDirs);
    error.rollbackCompleted = true;
    throw error;
  }
}

function parseArgs(argv) {
  let repoRoot = null;
  let mode = 'auto';
  let dryRun = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--repo' && argv[index + 1]) repoRoot = argv[++index];
    else if (arg === '--mode' && argv[index + 1]) mode = argv[++index];
    else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--help' || arg === '-h') return { help: true };
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return { repoRoot, mode, dryRun, help: false };
}

function showHelp() {
  process.stdout.write('Usage: node commit-check-bootstrap.mjs --repo <path> [--mode auto|bootstrap|update|repair] [--dry-run]\n');
}

if (process.argv[1] && normalizePath(process.argv[1]) === normalizePath(fileURLToPath(import.meta.url))) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) showHelp();
    else process.stdout.write(`${JSON.stringify(orchestrate(args.repoRoot, args), null, 2)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      setupSucceeded: false,
      repositoryChecksPassed: null,
      error: error.message,
      rollbackCompleted: error.rollbackCompleted === true,
    }, null, 2)}\n`);
    process.exitCode = 2;
  }
}
