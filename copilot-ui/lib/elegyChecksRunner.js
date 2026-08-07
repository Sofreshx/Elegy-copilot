'use strict';

let fs = require('fs');
const path = require('path');
let { execFile, execFileSync } = require('child_process');

function configPath(repoRoot) {
  return path.join(repoRoot, '.elegy', 'checks.json');
}

function readConfig(repoRoot) {
  const target = configPath(repoRoot);
  if (!fs.existsSync(target)) return null;
  try {
    return JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch {
    return null;
  }
}

function resolveCargoTargetDir(repoRoot) {
  const raw = process.env.CARGO_TARGET_DIR && process.env.CARGO_TARGET_DIR.trim()
    ? process.env.CARGO_TARGET_DIR.trim()
    : '';
  if (!raw) return '';
  // Cargo resolves a relative CARGO_TARGET_DIR against the current working
  // directory (the repository root when the runner invokes the binary).
  return path.isAbsolute(raw) ? raw : path.join(repoRoot, raw);
}

function resolveBinary(repoRoot) {
  if (process.env.ELEGY_CHECKS_BIN && process.env.ELEGY_CHECKS_BIN.trim()) {
    return process.env.ELEGY_CHECKS_BIN.trim();
  }
  const exe = process.platform === 'win32' ? 'elegy-checks.exe' : 'elegy-checks';
  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  const elegyBin = homeDir ? path.join(homeDir, '.elegy', 'bin') : '';
  const cargoTargetDir = resolveCargoTargetDir(repoRoot);
  const candidates = [
    // Shared Cargo target directory (CARGO_TARGET_DIR) for in-tree development
    cargoTargetDir ? path.join(cargoTargetDir, 'debug', exe) : null,
    cargoTargetDir ? path.join(cargoTargetDir, 'release', exe) : null,
    // Installed via marketplace installer (standard location)
    elegyBin ? path.join(elegyBin, exe) : null,
    // In-tree source (transition period, active development)
    path.join(repoRoot, 'elegy-checks', 'target', 'debug', exe),
    path.join(repoRoot, 'elegy-checks', 'target', 'release', exe),
    path.join(path.dirname(repoRoot), 'elegy-checks', 'target', 'debug', exe),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function canRun(repoRoot) {
  return !!readConfig(repoRoot) && !!resolveBinary(repoRoot);
}

function discoverChecks(repoRoot) {
  const config = readConfig(repoRoot);
  if (!config || !config.checks || typeof config.checks !== 'object') return null;
  const checks = Object.keys(config.checks)
    .filter((name) => config.checks[name]?.enabled !== false)
    .sort()
    .map((name) => {
      const check = config.checks[name] || {};
      return {
        name,
        path: Array.isArray(check.commands) && check.commands.length > 0 ? check.commands.join(', ') : '(configured)',
        fullPath: '',
        description: check.description || '',
        group: check.group || null,
        cwd: check.cwd || null,
        timeoutMs: check.timeoutMs || null,
        blocking: check.blocking !== false,
        ciWorkflow: check.ciWorkflow || null,
        ciJob: check.ciJob || null,
        ciRequired: check.ciRequired === true,
        source: 'elegy-checks',
        required: check.required !== false,
        skippable: check.skippable === true,
        requiresReasonOnSkip: check.requiresReasonOnSkip === true,
        defaultProfiles: Array.isArray(check.defaultProfiles) ? check.defaultProfiles : [],
        cost: check.cost || 'medium',
        opensWindow: check.opensWindow === true,
        gateStrength: check.gateStrength || null,
        determinism: check.determinism || null,
        sourcePack: check.sourcePack || null,
        tags: Array.isArray(check.tags) ? check.tags : [],
        severity: check.severity || null,
        promotionState: check.promotionState || null,
        owner: check.owner || null,
      };
    });
  checks.groups = config.groups || {};
  checks.profiles = config.profiles || {};
  return checks;
}

function runAllChecks(repoRoot) {
  return runChecks(repoRoot, { runAll: true, action: 'ci-local', selectionMode: 'explicit-all' });
}

function runAllChecksWithProfile(repoRoot, options = {}) {
  if (options.selectedGroup || (options.skipLanes && options.skipLanes.size > 0)) {
    return Promise.resolve(null);
  }
  return runChecks(repoRoot, options);
}

function runChecks(repoRoot, options = {}) {
  return new Promise((resolve) => {
    try {
      const binary = resolveBinary(repoRoot);
      const repoConfig = readConfig(repoRoot);
      if (!binary) {
        resolve(null);
        return;
      }

      const selectedLanes = normalizeSelectedLanes(options.selectedLanes);
      const plan = options.plan || discoverCurrentPlan(repoRoot, options);
      const executableCount = (plan?.candidates || []).filter((candidate) => (
        candidate.executionPolicy === 'local-command'
        && Array.isArray(candidate.commands)
        && candidate.commands.length > 0
      )).length;
      if (!repoConfig && executableCount === 0) {
        resolve(null);
        return;
      }
      const planPath = options.planPath || materializePlanSnapshot(repoRoot, { ...options, plan });
      const configuredNames = new Set(Object.keys(repoConfig?.checks || {}));
      const needsEphemeralConfig = !repoConfig
        || options.selectionMode === 'recommended'
        || (selectedLanes && selectedLanes.some((lane) => !configuredNames.has(lane)));
      const executionConfigPath = options.configPath || (needsEphemeralConfig
        ? materializeExecutionConfig(repoRoot, { ...options, plan }, selectedLanes)
        : null);
      if (!repoConfig && !executionConfigPath) {
        resolve(null);
        return;
      }

      const args = ['run', '--repo', repoRoot, '--json'];
      if (options.runAll === true) args.push('--all');
      if (options.profile) args.push('--profile', options.profile);
      if (options.action) args.push('--action', options.action);
      if (planPath) args.push('--plan', planPath);
      if (options.planHash) args.push('--plan-hash', options.planHash);
      if (executionConfigPath) args.push('--config', executionConfigPath);
      if (selectedLanes && options.runAll !== true) {
        for (const lane of selectedLanes) args.push('--check', lane);
      }

      execFile(binary, args, {
        cwd: repoRoot,
        timeout: resolveRunTimeout(repoRoot, { ...options, configPath: executionConfigPath }),
        maxBuffer: 1024 * 1024 * 4,
        windowsHide: true,
      }, (error, stdout, stderr) => {
      const raw = (stdout || '').trim();
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        resolve({
          repoRoot,
          source: 'elegy-checks',
          checkedAt: new Date().toISOString(),
          checksAvailable: 0,
          checksRun: 0,
          checksPassed: 0,
          checksFailed: 1,
          allPassed: false,
          results: [],
          errorOutput: [stderr, stdout].filter(Boolean).join('\n'),
          message: error && error.killed
            ? 'elegy-checks process timed out.'
            : 'elegy-checks did not return valid JSON.',
        });
        return;
      }
        resolve(transformRunResult(repoRoot, parsed, { ...options, planPath, configPath: executionConfigPath }));
      });
    } catch (error) {
      resolve({
        repoRoot,
        source: 'elegy-checks',
        checkedAt: new Date().toISOString(),
        checksAvailable: 0,
        checksRun: 0,
        checksPassed: 0,
        checksFailed: 1,
        allPassed: false,
        results: [],
        errorOutput: String(error?.message || error),
        message: String(error?.message || error),
      });
    }
  });
}

function discoverCurrentPlan(repoRoot, options = {}) {
  const { discoverCheckPlan } = require('./checkPlanService');
  const action = ['commit', 'push', 'ci-local', 'release'].includes(options.action)
    ? options.action
    : options.profile === 'push' ? 'push' : options.profile === 'release' ? 'release' : 'commit';
  return discoverCheckPlan(repoRoot, { action, selectionMode: options.selectionMode || 'change-aware' });
}

function materializePlanSnapshot(repoRoot, options = {}) {
  try {
    const { canonicalize } = require('./checkPlanService');
    const { deriveRepoId, getStatePath } = require('./checkState');
    const plan = options.plan || discoverCurrentPlan(repoRoot, options);
    const { generatedAt: _generatedAt, planHash: _planHash, ...identity } = plan;
    const statePath = getStatePath(deriveRepoId(repoRoot));
    const planPath = path.join(path.dirname(statePath), 'check-plan.json');
    fs.mkdirSync(path.dirname(planPath), { recursive: true });
    fs.writeFileSync(planPath, JSON.stringify(canonicalize(identity)), 'utf8');
    return planPath;
  } catch {
    return null;
  }
}

function materializeExecutionConfig(repoRoot, options, selectedLanes) {
  const { buildExecutionConfig } = require('./checkPlanService');
  const { deriveRepoId, getStatePath } = require('./checkState');
  const plan = options.plan || discoverCurrentPlan(repoRoot, options);
  const config = buildExecutionConfig(plan, selectedLanes, options.runAll === true);
  const statePath = getStatePath(deriveRepoId(repoRoot));
  const configPath = path.join(path.dirname(statePath), 'check-plan-config.json');
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config), 'utf8');
  return configPath;
}

function transformRunResult(repoRoot, parsed, options = {}) {
  const lanes = parsed.lanes || {};
  const laneNames = Object.keys(lanes);
  const results = laneNames.map((name) => {
    const lane = lanes[name] || {};
    const status = String(lane.status || '').toUpperCase();
    const passed = status === 'PASS';
    return {
      checkName: name,
      status,
      passed,
      exitCode: typeof lane.exitCode === 'number' ? lane.exitCode : undefined,
      durationMs: typeof lane.durationMs === 'number' ? lane.durationMs : undefined,
      error: passed ? undefined : (lane.details || 'Check failed'),
      output: lane.details || '',
      commands: Array.isArray(lane.commands) ? lane.commands : [],
      group: lane.group || null,
      blocking: lane.blocking !== false,
      ciWorkflow: lane.ciWorkflow || null,
      ciJob: lane.ciJob || null,
      ciRequired: lane.ciRequired === true,
      required: lane.required !== false,
      skippable: lane.skippable === true,
      cost: lane.cost || 'medium',
      opensWindow: lane.opensWindow === true,
      defaultProfiles: Array.isArray(lane.defaultProfiles) ? lane.defaultProfiles : [],
      gateStrength: lane.gateStrength || null,
      determinism: lane.determinism || null,
      sourcePack: lane.sourcePack || null,
      tags: Array.isArray(lane.tags) ? lane.tags : [],
      severity: lane.severity || null,
      promotionState: lane.promotionState || null,
      owner: lane.owner || null,
    };
  });
  const failed = results.filter((result) => !result.passed).length;
  const passed = results.length - failed;
  const allPassed = parsed.overallPass !== false;
  return {
    repoRoot,
    source: 'elegy-checks',
    checkedAt: parsed.timestamp || new Date().toISOString(),
    runId: parsed.runId || null,
    configHash: parsed.configHash || null,
    configPath: parsed.configPath || options.configPath || null,
    planHash: parsed.planHash || options.planHash || parsed.planIdentity?.hash || null,
    branch: parsed.branch || null,
    head: parsed.head || null,
    dirtyHash: parsed.dirtyHash || parsed.dirtyTreeFingerprint || null,
    action: parsed.action || options.action || null,
    selectionMode: parsed.selectionMode || options.selectionMode || (options.runAll ? 'explicit-all' : 'profile'),
    runnerVersion: parsed.runnerVersion || null,
    // `source` identifies the runner implementation; sourceKind identifies
    // where evidence came from for the UI contract.
    sourceKind: parsed.source === 'github' || parsed.source === 'remote' ? 'github' : 'local',
    checksAvailable: laneNames.length,
    checksRun: results.length,
    checksPassed: passed,
    checksFailed: failed,
    allPassed,
    gatePassed: allPassed,
    profile: parsed.profile || options.profile || null,
    blockingFailures: parsed.blockingFailures || [],
    requiredFailures: parsed.blockingFailures || [],
    logs: parsed.logs || [],
    results,
    message: allPassed
      ? (failed > 0
        ? `${failed} advisory check${failed === 1 ? '' : 's'} failed; blocking proof passed.`
        : `All ${passed} checks passed.`)
      : `${failed} of ${results.length} checks failed.`,
  };
}

function syncCiState(repoRoot, options = {}) {
  const config = readConfig(repoRoot);
  if (!config) return null;
  const { discoverCiWorkflows, mapCiToLocal } = require('./ciSync');
  const lanes = {};
  for (const [name, check] of Object.entries(config.checks || {})) {
    lanes[name] = check;
  }
  const ciWorkflows = discoverCiWorkflows(repoRoot);
  const syncResult = mapCiToLocal(ciWorkflows, {
    lanes,
    ciRemoteOnly: config.ciRemoteOnly || [],
  }, options);
  return {
    repoRoot,
    config: { laneCount: Object.keys(lanes).length, gateCount: 0, source: 'elegy-checks' },
    ciWorkflows,
    syncResult,
  };
}

function stateField(value, camel, snake, fallback = null) {
  if (value && value[camel] !== undefined) return value[camel];
  if (value && value[snake] !== undefined) return value[snake];
  return fallback;
}

function hydrateStateRun(rawRun) {
  if (!rawRun) return null;
  const gitFingerprint = rawRun.gitFingerprint || rawRun.git_fingerprint || {
    head: stateField(rawRun, 'head', 'head'),
    dirtyHash: stateField(rawRun, 'dirtyHash', 'dirty_hash', rawRun.dirtyTreeFingerprint || rawRun.dirty_tree_fingerprint),
  };
  return {
    ...rawRun,
    runId: stateField(rawRun, 'runId', 'run_id'),
    timestamp: stateField(rawRun, 'timestamp', 'timestamp', null),
    profile: stateField(rawRun, 'profile', 'profile'),
    overallPass: stateField(rawRun, 'overallPass', 'overall_pass', false) === true,
    configHash: stateField(rawRun, 'configHash', 'config_hash'),
    configPath: stateField(rawRun, 'configPath', 'config_path'),
    planHash: stateField(rawRun, 'planHash', 'plan_hash', rawRun.planIdentity?.hash || rawRun.plan_identity?.hash),
    branch: stateField(rawRun, 'branch', 'branch'),
    head: stateField(rawRun, 'head', 'head'),
    dirtyHash: stateField(rawRun, 'dirtyHash', 'dirty_hash', rawRun.dirtyTreeFingerprint || rawRun.dirty_tree_fingerprint),
    action: stateField(rawRun, 'action', 'action'),
    selectionMode: stateField(rawRun, 'selectionMode', 'selection_mode'),
    runnerVersion: stateField(rawRun, 'runnerVersion', 'runner_version'),
    source: stateField(rawRun, 'source', 'source', 'local'),
    sourceKind: stateField(rawRun, 'sourceKind', 'source_kind', null)
      || (stateField(rawRun, 'source', 'source', 'local') === 'github' ? 'github' : 'local'),
    gitFingerprint: {
      branch: gitFingerprint?.branch || rawRun.branch || rawRun.git_branch || null,
      head: gitFingerprint?.head || null,
      dirtyHash: gitFingerprint?.dirtyHash || gitFingerprint?.dirty_hash || rawRun.dirtyTreeFingerprint || rawRun.dirty_tree_fingerprint || null,
    },
    lanes: rawRun.lanes || {},
    groups: rawRun.groups || {},
    groupResults: rawRun.groupResults || rawRun.group_results || {},
    ciSync: rawRun.ciSync || rawRun.ci_sync || null,
    requiredFailures: rawRun.requiredFailures || rawRun.required_failures || [],
    blockingFailures: rawRun.blockingFailures || rawRun.blocking_failures || [],
    skippedLanes: rawRun.skippedLanes || rawRun.skipped_lanes || {},
    logs: rawRun.logs || [],
  };
}

function getState(repoRoot) {
  const binary = resolveBinary(repoRoot);
  if (!binary) return null;
  try {
    const readState = (planPath) => execFileSync(binary, [
      'state', '--repo', repoRoot, '--json', ...(planPath ? ['--plan', planPath] : []),
    ], {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
    let parsed = JSON.parse(readState(null));
    const initialLastRun = parsed.lastRun || parsed.last_run || null;
    const action = initialLastRun?.action || initialLastRun?.action_name || 'commit';
    const selectionMode = initialLastRun?.selectionMode
      || initialLastRun?.selection_mode
      || 'change-aware';
    if (supportsStatePlan(binary, repoRoot)) {
      try {
        const planPath = materializePlanSnapshot(repoRoot, { action, selectionMode });
        if (planPath) parsed = JSON.parse(readState(planPath));
      } catch {
        // The unplanned state remains useful when discovery cannot be refreshed.
      }
    }
    const rawLastRun = parsed.lastRun || parsed.last_run || null;
    const history = parsed.history || parsed.runs || [];
    return {
      repoId: parsed.repoId || parsed.repo_id,
      // Older installed binaries may report Windows extended-length paths;
      // the API keeps the caller's repository spelling stable.
      repoPath: repoRoot,
      hasState: parsed.hasState === true || parsed.has_state === true,
      lastRun: hydrateStateRun(rawLastRun),
      freshness: parsed.freshness || { fresh: false, reason: 'unknown' },
      history: Array.isArray(history) ? history : [],
      source: 'elegy-checks',
    };
  } catch {
    return null;
  }
}

function supportsStatePlan(binary, repoRoot) {
  try {
    const output = execFileSync(binary, ['state', '--help'], {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 10000,
      maxBuffer: 256 * 1024,
      windowsHide: true,
    });
    return /(?:--plan|plan-path)/i.test(String(output));
  } catch {
    return false;
  }
}

function runJsonSync(repoRoot, args, options = {}) {
  const binary = resolveBinary(repoRoot || process.cwd());
  if (!binary) return null;
  try {
    const output = execFileSync(binary, args, {
      cwd: repoRoot || process.cwd(),
      encoding: 'utf8',
      timeout: options.timeout || 30000,
      maxBuffer: options.maxBuffer || 1024 * 1024 * 4,
      windowsHide: true,
    });
    return JSON.parse(output);
  } catch (error) {
    return {
      error: String(error.message || error),
      stderr: error.stderr ? String(error.stderr) : '',
      stdout: error.stdout ? String(error.stdout) : '',
    };
  }
}

function audit(repoRoot) {
  if (!readConfig(repoRoot)) return null;
  return runJsonSync(repoRoot, ['audit', '--repo', repoRoot, '--json'], { timeout: 60000 });
}

function doctor(repoRoot) {
  if (!readConfig(repoRoot)) return null;
  return runJsonSync(repoRoot, ['doctor', '--repo', repoRoot, '--json'], { timeout: 60000 });
}

function history(repoRoot, options = {}) {
  if (!resolveBinary(repoRoot)) return null;
  const args = ['history', '--repo', repoRoot, '--json'];
  if (Number.isFinite(Number(options.limit))) args.push('--limit', String(Number(options.limit)));
  if (Number.isFinite(Number(options.offset))) args.push('--offset', String(Number(options.offset)));
  if (options.branch === null) args.push('--branch', 'all');
  else if (options.branch) args.push('--branch', String(options.branch));
  return runJsonSync(repoRoot, args, { timeout: 30000 });
}

function logs(repoRoot, options = {}) {
  if (!resolveBinary(repoRoot) || !options.runId) return null;
  const args = ['logs', '--repo', repoRoot, '--run-id', String(options.runId), '--json'];
  if (options.check) args.push('--check', String(options.check));
  if (Number.isFinite(Number(options.limit))) args.push('--limit', String(Number(options.limit)));
  if (Number.isFinite(Number(options.offset))) args.push('--offset', String(Number(options.offset)));
  return runJsonSync(repoRoot, args, { timeout: 30000, maxBuffer: 1024 * 1024 * 8 });
}

function applyRecommendations(repoRoot, options = {}) {
  if (!readConfig(repoRoot)) return null;
  const args = ['apply', '--repo', repoRoot, '--json'];
  if (options.all) args.push('--all');
  if (options.proposal) args.push('--proposal', String(options.proposal));
  return runJsonSync(repoRoot, args, { timeout: 60000 });
}

function packsList(repoRoot) {
  return runJsonSync(repoRoot || process.cwd(), ['packs', 'list', '--json'], { timeout: 30000 });
}

function packShow(repoRoot, packId) {
  if (!packId) return null;
  return runJsonSync(repoRoot || process.cwd(), ['packs', 'show', String(packId), '--json'], { timeout: 30000 });
}

function normalizeSelectedLanes(selectedLanes) {
  if (!selectedLanes) return null;
  if (Array.isArray(selectedLanes)) return selectedLanes;
  return [selectedLanes];
}

function resolveRunTimeout(repoRoot, options = {}) {
  const config = options.configPath
    ? readConfigFile(options.configPath)
    : readConfig(repoRoot);
  const checks = config?.checks && typeof config.checks === 'object' ? config.checks : {};
  let names = Object.keys(checks).filter((name) => checks[name]?.enabled !== false);
  const selectedLanes = normalizeSelectedLanes(options.selectedLanes);
  if (selectedLanes) names = names.filter((name) => selectedLanes.includes(name));
  const profile = options.runAll ? null : (options.profile || config?.defaultProfile || 'commit');
  if (!selectedLanes && profile) {
    names = names.filter((name) => Array.isArray(checks[name]?.defaultProfiles) && checks[name].defaultProfiles.includes(profile));
  }
  const summed = names.reduce((sum, name) => {
    const timeout = Number(checks[name]?.timeoutMs);
    return sum + (Number.isFinite(timeout) && timeout > 0 ? timeout : 120000);
  }, 0);
  return Math.min(Math.max(summed + Math.max(30000, names.length * 5000), 120000), 30 * 60 * 1000);
}

function readConfigFile(target) {
  try {
    return JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch {
    return null;
  }
}

function __setDeps(deps = {}) {
  if (deps.fs) fs = deps.fs;
  if (deps.execFile) execFile = deps.execFile;
  if (deps.execFileSync) execFileSync = deps.execFileSync;
}

module.exports = {
  applyRecommendations,
  audit,
  canRun,
  configPath,
  discoverChecks,
  doctor,
  getState,
  history,
  logs,
  packShow,
  packsList,
  readConfig,
  resolveBinary,
  runAllChecks,
  runAllChecksWithProfile,
  syncCiState,
  transformRunResult,
  __setDeps,
};
