#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SCHEMA_VERSION = 2;
const DEFAULT_CONFIG_NAME = '.copilot/commit-checks.json';

function die(message, code = 1) {
  console.error(message);
  process.exit(code);
}

function exists(filePath) {
  return fs.existsSync(filePath);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function resolveConfig(configPath) {
  if (configPath) {
    if (!exists(configPath)) {
      die(`Config file not found: ${configPath}`);
    }
    const cfg = readJson(configPath);
    if (!cfg) die(`Invalid config file: ${configPath}`);
    return cfg;
  }

  const cwdDefault = path.join(process.cwd(), DEFAULT_CONFIG_NAME);
  if (exists(cwdDefault)) {
    const cfg = readJson(cwdDefault);
    if (cfg) return cfg;
  }

  const explicit = path.join(process.cwd(), '.copilot', 'commit-checks.json');
  if (exists(explicit)) {
    const cfg = readJson(explicit);
    if (cfg) return cfg;
  }

  die(`No commit-checks.json found. Run commit-check-setup.mjs first, or pass --config <path>`);
}

const SHIPPED_DEFAULTS = {
  threshold: 70,
  weights: {
    test: 0.40,
    coverage: 0.30,
    lint: 0.15,
    format: 0.15,
  },
  gates: ['typecheck'],
};

function runCommand(command, cwd, timeoutMs = 120000) {
  const result = spawnSync(command, [], {
    cwd,
    stdio: 'pipe',
    encoding: 'utf8',
    timeout: timeoutMs,
    shell: true,
  });

  const timedOut = result.error?.code === 'ETIMEDOUT';
  const killedBySignal = result.signal != null;
  const success = result.status === 0 && !killedBySignal && !timedOut;

  return {
    exitCode: result.status ?? (timedOut ? -1 : -2),
    success,
    timedOut,
    killedBySignal,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
  };
}

function parseCoverageOutput(stdout, stderr) {
  const combined = stdout + '\n' + stderr;

  const lines = {};
  const lineMatch = combined.match(/(?:Lines?|lines?):\s*(\d+(?:\.\d+)?)%/i);
  if (lineMatch) lines.linePct = parseFloat(lineMatch[1]);

  const branchMatch = combined.match(/(?:Branches?|branches?):\s*(\d+(?:\.\d+)?)%/i);
  if (branchMatch) lines.branchPct = parseFloat(branchMatch[1]);

  const funcMatch = combined.match(/(?:Functions?|funcs?):\s*(\d+(?:\.\d+)?)%/i);
  if (funcMatch) lines.functionPct = parseFloat(funcMatch[1]);

  if (Object.keys(lines).length === 0) {
    const covMatch = combined.match(/(\d+(?:\.\d+)?)%/);
    if (covMatch) lines.linePct = parseFloat(covMatch[1]);
  }

  return lines;
}

function computeCoverageScore(metrics) {
  const linePct = metrics.linePct ?? 0;
  const branchPct = metrics.branchPct ?? 0;
  const functionPct = metrics.functionPct ?? 0;
  return Math.min(100, Math.max(0, linePct * 0.5 + branchPct * 0.3 + functionPct * 0.2));
}

function parseLaneSummary(name, result) {
  if (result.timedOut) return 'Timed out after 120s';
  if (result.killedBySignal) return `Killed by signal: ${result.signal}`;
  if (result.success) {
    if (name === 'test') {
      const passMatch = result.stdout.match(/(\d+)\s+(?:passed|tests?\s+passed)/i);
      const failMatch = result.stdout.match(/(\d+)\s+(?:failed|tests?\s+failed)/i);
      let summary = '';
      if (passMatch) summary += `${passMatch[1]} passed`;
      if (failMatch) summary += `, ${failMatch[1]} failed`;
      return summary || 'Passed';
    }
    if (name === 'lint') {
      const errMatch = result.stdout.match(/(\d+)\s+(?:errors?|problems?)/i);
      return errMatch ? `${errMatch[1]} issues found and fixed` : 'Clean';
    }
    if (name === 'format') return 'All files formatted';
    if (name === 'typecheck') return 'No type errors';
    return 'Passed';
  }
  const errLines = result.stderr.split('\n').filter(l => l).slice(0, 3).join('; ');
  return errLines || `Exit code ${result.exitCode}`;
}

export function runChecks(config, repoRoot) {
  const threshold = config.threshold ?? SHIPPED_DEFAULTS.threshold;
  const weights = config.weights ?? SHIPPED_DEFAULTS.weights;
  const gates = config.gates ?? SHIPPED_DEFAULTS.gates;
  const lanes = config.lanes ?? {};
  const groups = config.groups ?? {};

  const laneNames = Object.keys(lanes).filter(name => lanes[name].enabled !== false).sort();

  const results = {};
  let anyGateFailed = false;
  let errorOutput = '';

  for (const name of laneNames) {
    const lane = lanes[name];
    const commands = lane.commands || [];
    const isGate = gates.includes(name);
    // Lane is blocking unless explicitly set to false (backward compatible with v1 configs)
    const isBlocking = lane.blocking !== false;

    if (commands.length === 0) {
      results[name] = {
        status: 'SKIP',
        exitCode: 0,
        durationMs: 0,
        score: null,
        details: 'No commands configured',
      };
      continue;
    }

    let lanePassed = true;
    const laneResults = [];

    for (const cmd of commands) {
      const start = Date.now();
      const cmdCwd = lane.cwd ? path.resolve(repoRoot, lane.cwd) : repoRoot;
      const cmdTimeout = lane.timeoutMs ?? 120000;
      const result = runCommand(cmd, cmdCwd, cmdTimeout);
      const durationMs = Date.now() - start;

      laneResults.push({ command: cmd, ...result, durationMs });

      if (!result.success) {
        lanePassed = false;
        errorOutput += `[${name}] Command failed: ${cmd}\n  ${result.stderr.slice(0, 200)}\n`;
      }
    }

    let score = null;
    let coverageMetrics = {};
    let details = '';

    if (name === 'coverage' && lanePassed) {
      for (const r of laneResults) {
        const metrics = parseCoverageOutput(r.stdout, r.stderr);
        if (Object.keys(metrics).length > 0) {
          coverageMetrics = metrics;
        }
      }
      score = Math.round(computeCoverageScore(coverageMetrics));
      const parts = [];
      if (coverageMetrics.linePct != null) parts.push(`Lines: ${coverageMetrics.linePct}%`);
      if (coverageMetrics.branchPct != null) parts.push(`Branches: ${coverageMetrics.branchPct}%`);
      if (coverageMetrics.functionPct != null) parts.push(`Functions: ${coverageMetrics.functionPct}%`);
      details = parts.length > 0 ? parts.join(', ') : 'Coverage ran successfully';
    } else {
      const lastResult = laneResults[laneResults.length - 1];
      score = lanePassed ? 100 : 0;
      details = parseLaneSummary(name, lastResult);
    }

    if (isGate && isBlocking && !lanePassed) {
      anyGateFailed = true;
    }

    results[name] = {
      status: lanePassed ? 'PASS' : 'FAIL',
      exitCode: laneResults.every(r => r.success) ? 0 : 1,
      durationMs: laneResults.reduce((sum, r) => sum + (r.durationMs || 0), 0),
      score,
      commands: laneResults.map(r => ({
        command: r.command,
        exitCode: r.exitCode,
        success: r.success,
        durationMs: r.durationMs,
      })),
      details,
      group: lane.group ?? null,
      blocking: lane.blocking ?? true,
      ciWorkflow: lane.ciWorkflow ?? null,
      ciJob: lane.ciJob ?? null,
      ciRequired: lane.ciRequired ?? false,
      ...(name === 'coverage' && Object.keys(coverageMetrics).length > 0 ? { coverage: coverageMetrics } : {}),
    };
  }

  const scoredLanes = laneNames.filter(name =>
    results[name]?.score != null && weights[name] != null && weights[name] > 0
  );

  let weightedSum = 0;
  let totalWeight = 0;
  const scoreBreakdown = [];

  for (const name of scoredLanes) {
    const weight = weights[name];
    const score = results[name].score;
    weightedSum += weight * score;
    totalWeight += weight;
    scoreBreakdown.push({ lane: name, weight, score, weighted: weight * score });
  }

  const compositeScore = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : null;
  const passesThreshold = compositeScore != null && compositeScore >= threshold;
  const overallPass = passesThreshold && !anyGateFailed;

  const groupResults = {};
  for (const [name, result] of Object.entries(results)) {
    const group = result.group || '__ungrouped__';
    if (!groupResults[group]) {
      groupResults[group] = { passedLanes: [], failedLanes: [], allPassed: true };
    }
    if (result.status === 'PASS') {
      groupResults[group].passedLanes.push(name);
    } else {
      groupResults[group].failedLanes.push(name);
      groupResults[group].allPassed = false;
    }
  }

  const summary = {
    schemaVersion: SCHEMA_VERSION,
    timestamp: new Date().toISOString(),
    repoRoot,
    threshold,
    compositeScore,
    overallPass,
    anyGateFailed,
    groups,
    groupResults,
    scoreBreakdown,
    totalLanes: laneNames.length,
    passedLanes: laneNames.filter(name => results[name]?.status === 'PASS').length,
    lanes: results,
  };

  if (errorOutput && !overallPass) {
    summary.errorOutput = errorOutput;
  }

  return summary;
}

function main() {
  const args = process.argv.slice(2);
  let configPath = null;
  let jsonOutput = false;
  let repoRoot = process.cwd();

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--config' && i + 1 < args.length) {
      configPath = path.resolve(args[++i]);
    } else if (args[i] === '--repo' && i + 1 < args.length) {
      repoRoot = path.resolve(args[++i]);
    } else if (args[i] === '--json') {
      jsonOutput = true;
    } else if (!args[i].startsWith('--')) {
      repoRoot = path.resolve(args[i]);
    }
  }

  const config = resolveConfig(configPath);
  const result = runChecks(config, repoRoot);

  if (jsonOutput) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    console.log(`\n=== Commit Check Result ===`);
    console.log(`Score: ${result.compositeScore ?? 'N/A'} / 100  (threshold: ${result.threshold})`);
    console.log(`Status: ${result.overallPass ? 'PASS' : 'FAIL'}`);
    if (result.anyGateFailed) console.log('Gate failure: one or more gate lanes failed');
    console.log(`\nLanes: ${result.passedLanes}/${result.totalLanes} passed\n`);
    for (const [name, lane] of Object.entries(result.lanes)) {
      const icon = lane.status === 'PASS' ? 'PASS' : lane.status === 'SKIP' ? 'SKIP' : 'FAIL';
      const scoreStr = lane.score != null ? ` (score: ${lane.score})` : '';
      console.log(`  ${icon}  ${name}${scoreStr} — ${lane.details}`);
    }
    console.log('');
  }

  const exitCode = result.overallPass ? 0 : 1;
  process.exit(exitCode);
}

if (process.argv[1]?.endsWith('commit-check-run.mjs')) {
  main();
}
