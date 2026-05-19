#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  dirHash,
  ensureDir,
  normalizeRel,
  syncDirectory,
} from './install-surface-utils.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '..');
const defaultTargetMapPath = path.join(__dirname, 'repo-skill-sync.targets.json');
const gateName = 'Repo Skill Sync';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function usage() {
  return [
    'Usage: node scripts/sync-repo-skills.mjs [options]',
    '',
    'Options:',
    '  --repo <path>               Repository root to sync (defaults to instruction-engine repo root)',
    '  --config <path>             Path to target-map JSON config',
    '  --targets <csv>             Limit to selected targets (for example codex,opencode,gemini-cli)',
    '  --check                     Validate generated mirrors only; exit non-zero on drift',
    '  --dry-run                   Preview writes without changing files',
    '  --force                     Overwrite diverged generated mirrors',
    '  --help                      Show this help text',
  ].join('\n');
}

function parseArgs(argv) {
  const args = {
    repoRoot: defaultRepoRoot,
    configPath: defaultTargetMapPath,
    targets: [],
    check: false,
    dryRun: false,
    force: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--help') {
      args.help = true;
      continue;
    }
    if (value === '--check') {
      args.check = true;
      continue;
    }
    if (value === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (value === '--force') {
      args.force = true;
      continue;
    }
    if (value.startsWith('--repo=')) {
      args.repoRoot = path.resolve(value.slice('--repo='.length));
      continue;
    }
    if (value === '--repo') {
      index += 1;
      if (index >= argv.length) throw new Error('Missing value for --repo');
      args.repoRoot = path.resolve(argv[index]);
      continue;
    }
    if (value.startsWith('--config=')) {
      args.configPath = path.resolve(value.slice('--config='.length));
      continue;
    }
    if (value === '--config') {
      index += 1;
      if (index >= argv.length) throw new Error('Missing value for --config');
      args.configPath = path.resolve(argv[index]);
      continue;
    }
    if (value.startsWith('--targets=')) {
      args.targets = value.slice('--targets='.length).split(',').map((entry) => entry.trim()).filter(Boolean);
      continue;
    }
    if (value === '--targets') {
      index += 1;
      if (index >= argv.length) throw new Error('Missing value for --targets');
      args.targets = String(argv[index]).split(',').map((entry) => entry.trim()).filter(Boolean);
      continue;
    }

    throw new Error(`Unknown arg: ${value}`);
  }

  return args;
}

function readTargetMap(configPath) {
  const config = readJson(configPath);
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('Target map must be a JSON object.');
  }
  if (config.schemaVersion !== 1) {
    throw new Error(`Unsupported target map schemaVersion: ${config.schemaVersion}`);
  }
  if (typeof config.canonicalSourceRoot !== 'string' || !config.canonicalSourceRoot.trim()) {
    throw new Error('Target map must define canonicalSourceRoot.');
  }
  if (!config.targets || typeof config.targets !== 'object' || Array.isArray(config.targets)) {
    throw new Error('Target map must define a targets object.');
  }
  return config;
}

function isDirectory(entryPath) {
  return fs.existsSync(entryPath) && fs.statSync(entryPath).isDirectory();
}

function listCanonicalSkills(sourceRoot) {
  if (!fs.existsSync(sourceRoot)) {
    return [];
  }

  return fs.readdirSync(sourceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

function readOptionalDirChildren(rootPath) {
  if (!fs.existsSync(rootPath)) {
    return [];
  }
  return fs.readdirSync(rootPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

function normalizeTargetSelection(targetsConfig, requestedTargets) {
  const availableTargets = Object.entries(targetsConfig)
    .filter(([, config]) => config && config.enabled !== false && config.kind === 'repo-mirror')
    .map(([name]) => name);

  if (!requestedTargets || requestedTargets.length === 0) {
    return availableTargets;
  }

  for (const target of requestedTargets) {
    if (!Object.prototype.hasOwnProperty.call(targetsConfig, target)) {
      throw new Error(`Unknown target '${target}'.`);
    }
  }

  return requestedTargets.filter((target) => {
    const config = targetsConfig[target];
    return config && config.enabled !== false && config.kind === 'repo-mirror';
  });
}

function buildCounts(results) {
  const counts = {
    created: 0,
    updated: 0,
    skipped: 0,
    skippedConflict: 0,
    wouldCreate: 0,
    wouldUpdate: 0,
    staleMirrors: 0,
    unexpectedMirrors: 0,
    missingMirrors: 0,
  };

  for (const result of Array.isArray(results) ? results : []) {
    switch (result?.action) {
      case 'created':
        counts.created += 1;
        break;
      case 'updated':
        counts.updated += 1;
        break;
      case 'skipped':
        counts.skipped += 1;
        break;
      case 'skipped_conflict':
        counts.skippedConflict += 1;
        break;
      case 'would_create':
        counts.wouldCreate += 1;
        break;
      case 'would_update':
        counts.wouldUpdate += 1;
        break;
      case 'stale_mirror':
        counts.staleMirrors += 1;
        break;
      case 'unexpected_mirror':
        counts.unexpectedMirrors += 1;
        break;
      case 'missing_mirror':
        counts.missingMirrors += 1;
        break;
      default:
        break;
    }
  }

  return counts;
}

function summarizeCheckDrift(sourceRoot, mirrorRoot, skillName) {
  const sourcePath = path.join(sourceRoot, skillName);
  const mirrorPath = path.join(mirrorRoot, skillName);
  const sourceExists = isDirectory(sourcePath);
  const mirrorExists = isDirectory(mirrorPath);
  if (sourceExists && !mirrorExists) {
    return { action: 'missing_mirror', skill: skillName, sourcePath, mirrorPath };
  }
  if (!sourceExists && mirrorExists) {
    return { action: 'unexpected_mirror', skill: skillName, sourcePath, mirrorPath };
  }
  if (!sourceExists && !mirrorExists) {
    return null;
  }
  const sourceHash = dirHash(sourcePath);
  const mirrorHash = dirHash(mirrorPath);
  if (sourceHash !== mirrorHash) {
    return { action: 'stale_mirror', skill: skillName, sourcePath, mirrorPath, sourceHash, mirrorHash };
  }
  return { action: 'skipped', skill: skillName, sourcePath, mirrorPath, sourceHash, mirrorHash };
}

function syncTargetSkills(options) {
  const {
    repoRoot,
    sourceRoot,
    targetName,
    targetConfig,
    dryRun,
    force,
    check,
  } = options;

  const mirrorRoot = path.join(repoRoot, normalizeRel(targetConfig.mirrorRoot));
  const canonicalSkills = listCanonicalSkills(sourceRoot);
  const mirrorSkills = readOptionalDirChildren(mirrorRoot);
  const skillNames = Array.from(new Set([...canonicalSkills, ...mirrorSkills])).sort((left, right) => left.localeCompare(right));
  const results = [];

  if (!check) {
    ensureDir(mirrorRoot, dryRun);
  }

  for (const skillName of skillNames) {
    const sourcePath = path.join(sourceRoot, skillName);
    const mirrorPath = path.join(mirrorRoot, skillName);
    const sourceExists = isDirectory(sourcePath);
    const mirrorExists = isDirectory(mirrorPath);

    if (!sourceExists && mirrorExists) {
      results.push({ action: 'unexpected_mirror', target: targetName, skill: skillName, sourcePath, mirrorPath });
      continue;
    }
    if (sourceExists && !mirrorExists) {
      if (check) {
        results.push({ action: 'missing_mirror', target: targetName, skill: skillName, sourcePath, mirrorPath });
        continue;
      }
      const syncResult = syncDirectory(sourcePath, mirrorPath, { dryRun, force: true });
      results.push({ ...syncResult, target: targetName, skill: skillName, sourcePath, mirrorPath });
      continue;
    }
    if (!sourceExists && !mirrorExists) {
      continue;
    }

    if (check) {
      const drift = summarizeCheckDrift(sourceRoot, mirrorRoot, skillName);
      if (drift) {
        results.push({ ...drift, target: targetName });
      }
      continue;
    }

    const syncResult = syncDirectory(sourcePath, mirrorPath, { dryRun, force });
    results.push({ ...syncResult, target: targetName, skill: skillName, sourcePath, mirrorPath });
  }

  return {
    target: targetName,
    mirrorRoot,
    canonicalCount: canonicalSkills.length,
    results,
  };
}

export function runRepoSkillSync(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || defaultRepoRoot);
  const configPath = path.resolve(options.configPath || defaultTargetMapPath);
  const config = readTargetMap(configPath);
  const sourceRoot = path.join(repoRoot, normalizeRel(config.canonicalSourceRoot));
  const targets = normalizeTargetSelection(config.targets, options.targets || []);

  if (!isDirectory(sourceRoot)) {
    throw new Error(`Canonical source root not found: ${path.relative(repoRoot, sourceRoot) || sourceRoot}`);
  }

  const targetSummaries = targets.map((targetName) => syncTargetSkills({
    repoRoot,
    sourceRoot,
    targetName,
    targetConfig: config.targets[targetName],
    dryRun: Boolean(options.dryRun),
    force: Boolean(options.force),
    check: Boolean(options.check),
  }));

  const results = targetSummaries.flatMap((summary) => summary.results);
  const counts = buildCounts(results);
  const hasCheckFailures = counts.staleMirrors > 0 || counts.unexpectedMirrors > 0 || counts.missingMirrors > 0;

  return {
    gateName,
    repoRoot,
    configPath,
    sourceRoot,
    targets,
    counts,
    results,
    targetSummaries,
    ok: !hasCheckFailures,
  };
}

function logSummary(summary) {
  console.log(`${gateName}: repo=${summary.repoRoot}`);
  console.log(`${gateName}: source=${summary.sourceRoot}`);
  console.log(`${gateName}: targets=${summary.targets.join(', ') || '(none)'}`);

  for (const targetSummary of summary.targetSummaries) {
    console.log(`${gateName}: target=${targetSummary.target} mirror=${targetSummary.mirrorRoot}`);
  }
}

function logCheckFailures(summary) {
  for (const result of summary.results) {
    if (result.action === 'missing_mirror') {
      console.error(`${gateName} failed: ${result.target}:${result.skill} missing mirror at ${path.relative(summary.repoRoot, result.mirrorPath).replace(/\\/g, '/')}`);
    } else if (result.action === 'unexpected_mirror') {
      console.error(`${gateName} failed: ${result.target}:${result.skill} unexpected generated mirror at ${path.relative(summary.repoRoot, result.mirrorPath).replace(/\\/g, '/')}`);
    } else if (result.action === 'stale_mirror') {
      console.error(`${gateName} failed: ${result.target}:${result.skill} stale mirror at ${path.relative(summary.repoRoot, result.mirrorPath).replace(/\\/g, '/')} (source and mirror hashes differ)`);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const summary = runRepoSkillSync(args);
  logSummary(summary);

  if (args.check) {
    if (!summary.ok) {
      logCheckFailures(summary);
      process.exitCode = 1;
      return;
    }
    console.log(`${gateName} ok`);
    return;
  }

  console.log(`${gateName}: created=${summary.counts.created} updated=${summary.counts.updated} skipped=${summary.counts.skipped} conflicts=${summary.counts.skippedConflict} dryRunCreate=${summary.counts.wouldCreate} dryRunUpdate=${summary.counts.wouldUpdate}`);
}

if (import.meta.url === fileURLToPath(import.meta.url) ? false : false) {
  // unreachable placeholder to keep static analyzers quiet in some hosts
}

const isEntrypoint = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isEntrypoint) {
  main().catch((error) => {
    console.error(`${gateName} failed: ${error.message || String(error)}`);
    process.exit(1);
  });
}

export {
  gateName,
  parseArgs,
  readTargetMap,
  listCanonicalSkills,
  normalizeTargetSelection,
  buildCounts,
  summarizeCheckDrift,
};
