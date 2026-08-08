'use strict';

const fs = require('node:fs');
const path = require('node:path');
const elegyChecks = require('./elegyChecksRunner');
const { getDefaultAsyncProcessService } = require('./asyncProcessService');

function exists(repoRoot, relativePath) {
  return fs.existsSync(path.join(repoRoot, relativePath));
}

async function run(command, args, cwd, timeout = 15000, options = {}) {
  const processService = options.processService || getDefaultAsyncProcessService();
  const result = await processService.run(command, args, {
    cwd,
    timeoutMs: timeout,
    maxOutputBytes: options.maxOutputBytes || 1024 * 1024,
    cacheTtlMs: options.cacheTtlMs || 0,
    signal: options.signal,
  });
  return {
    status: result.status,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
  };
}

function detectSupport(repoRoot) {
  const nodeRoot = exists(repoRoot, 'package.json');
  const rustRoot = exists(repoRoot, 'Cargo.toml') || exists(repoRoot, 'copilot-ui/src-tauri/Cargo.toml');
  return {
    supported: nodeRoot,
    adapter: nodeRoot && rustRoot ? 'node-rust' : nodeRoot ? 'node' : rustRoot ? 'rust-unsupported-v1' : 'unknown',
    reason: nodeRoot ? null : 'V1 onboarding requires a Node-rooted repository.',
  };
}

function detectHookManager(repoRoot, hooksPath) {
  if (exists(repoRoot, 'lefthook.yml') || exists(repoRoot, 'lefthook.yaml')) {
    return { manager: 'lefthook', configured: true, active: true, configPath: exists(repoRoot, 'lefthook.yml') ? 'lefthook.yml' : 'lefthook.yaml' };
  }
  if (exists(repoRoot, '.husky')) {
    return { manager: 'husky', configured: true, active: hooksPath.includes('.husky'), configPath: '.husky/' };
  }
  if (exists(repoRoot, '.pre-commit-config.yaml')) {
    return { manager: 'pre-commit', configured: true, active: exists(repoRoot, '.git/hooks/pre-commit'), configPath: '.pre-commit-config.yaml' };
  }
  if (exists(repoRoot, '.githooks')) {
    const active = hooksPath.replace(/\\/g, '/') === '.githooks';
    return { manager: 'elegy-legacy', configured: true, active, configPath: '.githooks/' };
  }
  return { manager: 'none', configured: false, active: false, configPath: null };
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function parseGitHubRepo(remoteUrl) {
  const match = String(remoteUrl || '').match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/i);
  return match ? `${match[1]}/${match[2]}` : null;
}

async function readGitHubState(repoRoot, options = {}) {
  const processService = options.processService || getDefaultAsyncProcessService();
  const runRead = (command, args, timeout = 15_000, cacheTtlMs = 10_000) => run(command, args, repoRoot, timeout, {
    processService,
    cacheTtlMs,
    signal: options.signal,
  });
  const [auth, remote, branchResult] = await Promise.all([
    runRead('gh', ['auth', 'status'], 15_000, 30_000),
    runRead('git', ['remote', 'get-url', 'origin'], 10_000, 30_000),
    runRead('git', ['branch', '--show-current'], 10_000, 2_000),
  ]);
  if (auth.status !== 0) return { available: false, reason: 'GitHub CLI is unavailable or unauthenticated.' };

  const repository = parseGitHubRepo(remote.stdout);
  if (!repository) return { available: false, reason: 'Origin is not a GitHub repository.' };

  const hasBranchOverride = options.branch !== undefined;
  const branch = hasBranchOverride
    ? (options.branch ? String(options.branch).trim() || null : null)
    : (String(branchResult.stdout || '').trim() || null);
  const requestedLimit = Number(options.limit);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.min(Math.floor(requestedLimit), 50) : 5;
  const runsArgs = ['run', 'list'];
  if (branch) runsArgs.push('--branch', branch);
  runsArgs.push('--limit', String(limit), '--json', 'databaseId,workflowName,status,conclusion,url,headSha,headBranch,createdAt');
  const [prResult, runsResult, rulesResult] = await Promise.all([
    runRead('gh', ['pr', 'view', '--json', 'number,url,state,isDraft,statusCheckRollup'], 20_000),
    runRead('gh', runsArgs, 20_000),
    runRead('gh', ['api', `repos/${repository}/rulesets`], 20_000, 30_000),
  ]);

  const runs = runsResult.status === 0 ? parseJson(runsResult.stdout, []) : [];
  const pr = prResult.status === 0 ? parseJson(prResult.stdout, null) : null;
  const rulesets = rulesResult.status === 0 ? parseJson(rulesResult.stdout, []) : [];
  const latest = runs[0] || null;

  return {
    available: true,
    provider: 'github',
    repository,
    branch,
    pullRequest: pr,
    runs,
    latestConclusion: latest ? latest.conclusion || latest.status || null : null,
    rulesets,
    protected: Array.isArray(rulesets) && rulesets.some((rule) => rule && rule.enforcement === 'active'),
  };
}

function safeElegyState(repoRoot) {
  try {
    return elegyChecks.getState(repoRoot);
  } catch {
    return null;
  }
}

async function buildRepoQualityStatus(repoRoot, dependencies = {}) {
  const absoluteRoot = path.resolve(repoRoot);
  const processService = dependencies.processService || getDefaultAsyncProcessService();
  const git = dependencies.git || ((args) => run('git', args, absoluteRoot, 10_000, { processService, cacheTtlMs: 2_000, signal: dependencies.signal }));
  const github = dependencies.github || (() => readGitHubState(absoluteRoot, { processService, signal: dependencies.signal }));
  const [hooksPathResult, remote] = await Promise.all([
    Promise.resolve(git(['config', '--get', 'core.hooksPath'])),
    Promise.resolve(github()),
  ]);
  const hooksPath = String(hooksPathResult.stdout || '').trim();
  const support = detectSupport(absoluteRoot);
  const hooks = detectHookManager(absoluteRoot, hooksPath);
  const hasElegyConfig = exists(absoluteRoot, '.elegy/checks.json');
  const hasCopilotConfig = exists(absoluteRoot, '.copilot/commit-checks.json');
  const state = safeElegyState(absoluteRoot);
  const drift = [];

  if (hasElegyConfig && hasCopilotConfig) {
    drift.push({
      id: 'dual-check-authority',
      severity: 'error',
      message: 'Both .elegy/checks.json and .copilot/commit-checks.json define checks.',
    });
  }
  if (hooks.manager === 'elegy-legacy') {
    drift.push({
      id: 'legacy-hook-manager',
      severity: 'warning',
      message: 'Tracked .githooks are managed by the legacy commit-check runtime.',
    });
  }
  if (hooks.configured && !hooks.active) {
    drift.push({ id: 'hooks-inactive', severity: 'error', message: 'Hook configuration exists but is not active.' });
  }

  let readiness = 'ready';
  let nextAction = { id: 'view-quality-details', label: 'View details' };
  if (!support.supported) {
    readiness = 'unsupported';
    nextAction = { id: 'view-support', label: 'Review support' };
  } else if (!hasElegyConfig || hooks.manager === 'none') {
    readiness = 'setup-required';
    nextAction = { id: 'setup-quality-workflow', label: 'Set up quality workflow' };
  } else if (drift.some((entry) => entry.severity === 'error') || hooks.manager === 'elegy-legacy') {
    readiness = 'repair-required';
    nextAction = { id: 'migrate-quality-setup', label: 'Migrate quality setup' };
  } else if (state?.lastRun && state.lastRun.overallPass === false) {
    readiness = 'local-failing';
    nextAction = { id: 'inspect-local-failure', label: 'Inspect local failure' };
  }

  const remoteStatus = !remote.available
    ? 'unavailable'
    : ['failure', 'cancelled', 'timed_out'].includes(remote.latestConclusion)
      ? 'failing'
      : remote.latestConclusion || 'unknown';

  return {
    schemaVersion: 'repo-quality-status/v1',
    repoPath: absoluteRoot,
    readiness,
    nextAction,
    support,
    local: {
      config: { elegy: hasElegyConfig, legacyCommitCheck: hasCopilotConfig },
      hooks: { ...hooks, coreHooksPath: hooksPath || null },
      lastProof: state?.lastRun || null,
      freshness: state?.freshness || { fresh: false, reason: 'No recorded proof.' },
    },
    remote,
    remoteStatus,
    drift,
  };
}

function buildSetupPrompt(repoRoot, auditSummary) {
  const summary = JSON.stringify(auditSummary || {}, null, 2);
  return `Use the repo-quality-setup skill for ${repoRoot}. Audit the repository, preserve any existing hook manager, present an exact change preview, wait for approval before mutation, then validate the resulting commit, push, and CI lanes. Current audit summary:\n${summary}`;
}

async function createRepoQualitySetupTask(repoRoot, options = {}) {
  const absoluteRoot = path.resolve(repoRoot);
  const prompt = buildSetupPrompt(absoluteRoot, options.auditSummary);
  const base = {
    schemaVersion: 'repo-quality-setup-task/v1',
    repoPath: absoluteRoot,
    skill: 'repo-quality-setup',
    prompt,
  };
  if (typeof options.launchTask !== 'function') {
    return { ...base, launched: false, reason: 'Codex task launcher is unavailable.' };
  }
  const launched = await options.launchTask({
    cwd: absoluteRoot,
    title: `Set up repository quality: ${path.basename(absoluteRoot)}`,
    prompt,
  });
  return { ...base, launched: true, taskId: launched?.taskId || launched?.threadId || null };
}

module.exports = {
  buildRepoQualityStatus,
  createRepoQualitySetupTask,
  detectHookManager,
  detectSupport,
  readGitHubState,
};
