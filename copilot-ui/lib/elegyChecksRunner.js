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

function resolveBinary(repoRoot) {
  if (process.env.ELEGY_CHECKS_BIN && process.env.ELEGY_CHECKS_BIN.trim()) {
    return process.env.ELEGY_CHECKS_BIN.trim();
  }
  const exe = process.platform === 'win32' ? 'elegy-checks.exe' : 'elegy-checks';
  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  const elegyBin = homeDir ? path.join(homeDir, '.elegy', 'bin') : '';
  const candidates = [
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
      };
    });
  checks.groups = config.groups || {};
  checks.profiles = config.profiles || {};
  return checks;
}

function runAllChecks(repoRoot) {
  return runChecks(repoRoot);
}

function runAllChecksWithProfile(repoRoot, options = {}) {
  if (options.selectedGroup || (options.skipLanes && options.skipLanes.size > 0)) {
    return Promise.resolve(null);
  }
  return runChecks(repoRoot, options);
}

function runChecks(repoRoot, options = {}) {
  return new Promise((resolve) => {
    const binary = resolveBinary(repoRoot);
    if (!binary || !readConfig(repoRoot)) {
      resolve(null);
      return;
    }

    const args = ['run', '--repo', repoRoot, '--json'];
    if (options.profile) args.push('--profile', options.profile);
    const selectedLanes = normalizeSelectedLanes(options.selectedLanes);
    if (selectedLanes && selectedLanes.length === 1) args.push('--check', selectedLanes[0]);
    if (selectedLanes && selectedLanes.length > 1) {
      resolve(null);
      return;
    }

    execFile(binary, args, {
      cwd: repoRoot,
      timeout: resolveRunTimeout(repoRoot, options),
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
      resolve(transformRunResult(repoRoot, parsed, options));
    });
  });
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
      ? `All ${passed} checks passed.`
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

function getState(repoRoot) {
  const binary = resolveBinary(repoRoot);
  if (!binary || !readConfig(repoRoot)) return null;
  try {
    const output = execFileSync(binary, ['state', '--repo', repoRoot, '--json'], {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
    const parsed = JSON.parse(output);
    return {
      repoId: parsed.repoId,
      repoPath: parsed.repoPath || repoRoot,
      hasState: parsed.hasState === true,
      lastRun: parsed.lastRun
        ? {
            timestamp: parsed.lastRun.timestamp,
            profile: parsed.lastRun.profile || null,
            overallPass: parsed.lastRun.overallPass === true,
            configHash: parsed.lastRun.configHash || null,
            lanes: {},
          }
        : null,
      freshness: parsed.freshness || { fresh: false, reason: 'unknown' },
      history: [],
      source: 'elegy-checks',
    };
  } catch {
    return null;
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
  if (!readConfig(repoRoot)) return null;
  const args = ['history', '--repo', repoRoot, '--json'];
  if (Number.isFinite(Number(options.limit))) args.push('--limit', String(Number(options.limit)));
  if (Number.isFinite(Number(options.offset))) args.push('--offset', String(Number(options.offset)));
  return runJsonSync(repoRoot, args, { timeout: 30000 });
}

function logs(repoRoot, options = {}) {
  if (!readConfig(repoRoot) || !options.runId) return null;
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
  const config = readConfig(repoRoot);
  const checks = config?.checks && typeof config.checks === 'object' ? config.checks : {};
  let names = Object.keys(checks).filter((name) => checks[name]?.enabled !== false);
  const selectedLanes = normalizeSelectedLanes(options.selectedLanes);
  if (selectedLanes) names = names.filter((name) => selectedLanes.includes(name));
  const profile = options.profile || config?.defaultProfile || 'commit';
  if (!selectedLanes && profile) {
    names = names.filter((name) => Array.isArray(checks[name]?.defaultProfiles) && checks[name].defaultProfiles.includes(profile));
  }
  const summed = names.reduce((sum, name) => {
    const timeout = Number(checks[name]?.timeoutMs);
    return sum + (Number.isFinite(timeout) && timeout > 0 ? timeout : 120000);
  }, 0);
  return Math.min(Math.max(summed + Math.max(30000, names.length * 5000), 120000), 30 * 60 * 1000);
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
