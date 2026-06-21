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
const gateName = 'Repo Skill Mirrors';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function isDirectory(entryPath) {
  return fs.existsSync(entryPath) && fs.statSync(entryPath).isDirectory();
}

function hasSkillDocument(entryPath) {
  return isDirectory(entryPath) && fs.existsSync(path.join(entryPath, 'SKILL.md'));
}

function formatRepoPath(repoRoot, targetPath) {
  return path.relative(repoRoot, targetPath).replace(/\\/g, '/');
}

function getMirrorTargetKey(targetName, targetConfig) {
  const mirrorRoot = typeof targetConfig?.mirrorRoot === 'string' ? normalizeRel(targetConfig.mirrorRoot) : '';
  return mirrorRoot || `target:${targetName}`;
}

function pruneDirectory(targetPath, options = {}) {
  const log = typeof options.log === 'function' ? options.log : console.log;
  const action = options.dryRun ? 'would_prune' : 'pruned';
  if (!options.dryRun) {
    fs.rmSync(targetPath, { recursive: true, force: true });
  }
  if (action === 'would_prune') {
    log(`[DRY-RUN] PRUNE ${targetPath}`);
  } else {
    log(`[PRUNE]  ${targetPath}`);
  }
  return { action, path: targetPath };
}

export function parseMirrorActionArgs(argv, options = {}) {
  const allowDryRun = options.allowDryRun !== false;
  const args = {
    repoRoot: defaultRepoRoot,
    configPath: defaultTargetMapPath,
    targets: [],
    dryRun: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--help') {
      args.help = true;
      continue;
    }
    if (value === '--dry-run') {
      if (!allowDryRun) {
        throw new Error('Unknown arg: --dry-run');
      }
      args.dryRun = true;
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

export function buildUsage(scriptName, description, options = {}) {
  const allowDryRun = options.allowDryRun !== false;
  const lines = [
    `Usage: node scripts/${scriptName} [options]`,
    '',
    description,
    '',
    'Options:',
    '  --repo <path>               Repository root to inspect (defaults to elegy-copilot repo root)',
    '  --config <path>             Path to target-map JSON config',
    '  --targets <csv>             Limit to selected targets (for example codex,opencode,antigravity-cli)',
  ];

  if (allowDryRun) {
    lines.push('  --dry-run                   Preview writes without changing files');
  }

  lines.push('  --help                      Show this help text');
  return lines.join('\n');
}

export function readTargetMap(configPath) {
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

  for (const [targetName, targetConfig] of Object.entries(config.targets)) {
    if (!targetConfig || typeof targetConfig !== 'object' || Array.isArray(targetConfig)) {
      throw new Error(`Target '${targetName}' must be a JSON object.`);
    }
    if (targetConfig.enabled === false || targetConfig.kind !== 'repo-mirror') {
      continue;
    }
    if (typeof targetConfig.mirrorRoot !== 'string' || !targetConfig.mirrorRoot.trim()) {
      throw new Error(`Target '${targetName}' must define mirrorRoot.`);
    }
  }

  return config;
}

export function listCanonicalSkills(sourceRoot) {
  if (!fs.existsSync(sourceRoot)) {
    return [];
  }

  return fs.readdirSync(sourceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => hasSkillDocument(path.join(sourceRoot, entry.name)))
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

export function normalizeTargetSelection(targetsConfig, requestedTargets) {
  const availableTargets = Object.entries(targetsConfig)
    .filter(([, config]) => config && config.enabled !== false && config.kind === 'repo-mirror')
    .map(([name]) => name);

  const selectedTargets = requestedTargets && requestedTargets.length > 0
    ? requestedTargets
    : availableTargets;

  for (const target of selectedTargets) {
    if (!Object.prototype.hasOwnProperty.call(targetsConfig, target)) {
      throw new Error(`Unknown target '${target}'.`);
    }
    const config = targetsConfig[target];
    if (!config || config.enabled === false || config.kind !== 'repo-mirror') {
      throw new Error(`Target '${target}' is not an enabled repo-local mirror target.`);
    }
  }

  const dedupedTargets = [];
  const seenMirrorRoots = new Set();
  for (const targetName of selectedTargets) {
    const targetKey = getMirrorTargetKey(targetName, targetsConfig[targetName]);
    if (seenMirrorRoots.has(targetKey)) {
      continue;
    }
    seenMirrorRoots.add(targetKey);
    dedupedTargets.push(targetName);
  }

  return dedupedTargets;
}

export function buildCounts(results) {
  const counts = {
    created: 0,
    updated: 0,
    skipped: 0,
    skippedConflict: 0,
    pruned: 0,
    wouldCreate: 0,
    wouldUpdate: 0,
    wouldPrune: 0,
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
      case 'pruned':
        counts.pruned += 1;
        break;
      case 'would_create':
        counts.wouldCreate += 1;
        break;
      case 'would_update':
        counts.wouldUpdate += 1;
        break;
      case 'would_prune':
        counts.wouldPrune += 1;
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

export function summarizeCheckDrift(sourceRoot, mirrorRoot, skillName) {
  const sourcePath = path.join(sourceRoot, skillName);
  const mirrorPath = path.join(mirrorRoot, skillName);
  const sourceExists = hasSkillDocument(sourcePath);
  const mirrorExists = hasSkillDocument(mirrorPath);
  const mirrorDirectoryExists = isDirectory(mirrorPath);
  if (sourceExists && !mirrorExists) {
    return { action: 'missing_mirror', skill: skillName, sourcePath, mirrorPath };
  }
  if (!sourceExists && mirrorDirectoryExists) {
    return { action: 'unexpected_mirror', skill: skillName, sourcePath, mirrorPath };
  }
  if (!sourceExists && !mirrorDirectoryExists) {
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
    mode,
    dryRun,
    log,
  } = options;

  const mirrorRoot = path.join(repoRoot, normalizeRel(targetConfig.mirrorRoot));
  const canonicalSkills = listCanonicalSkills(sourceRoot);
  const mirrorSkills = readOptionalDirChildren(mirrorRoot);
  const skillNames = Array.from(new Set([...canonicalSkills, ...mirrorSkills])).sort((left, right) => left.localeCompare(right));
  const results = [];

  if (mode !== 'check' && (canonicalSkills.length > 0 || mirrorSkills.length > 0 || fs.existsSync(mirrorRoot))) {
    ensureDir(mirrorRoot, dryRun, log);
  }

  for (const skillName of skillNames) {
    const sourcePath = path.join(sourceRoot, skillName);
    const mirrorPath = path.join(mirrorRoot, skillName);
    const sourceExists = hasSkillDocument(sourcePath);
    const mirrorExists = hasSkillDocument(mirrorPath);
    const mirrorDirectoryExists = isDirectory(mirrorPath);

    if (!sourceExists && mirrorDirectoryExists) {
      if (mode === 'update') {
        const pruneResult = pruneDirectory(mirrorPath, { dryRun, log });
        results.push({ ...pruneResult, target: targetName, skill: skillName, sourcePath, mirrorPath });
      } else {
        results.push({ action: 'unexpected_mirror', target: targetName, skill: skillName, sourcePath, mirrorPath });
      }
      continue;
    }

    if (sourceExists && !mirrorExists) {
      if (mode === 'check') {
        results.push({ action: 'missing_mirror', target: targetName, skill: skillName, sourcePath, mirrorPath });
        continue;
      }
      const syncResult = syncDirectory(sourcePath, mirrorPath, { dryRun, force: true, log });
      results.push({ ...syncResult, target: targetName, skill: skillName, sourcePath, mirrorPath });
      continue;
    }

    if (!sourceExists && !mirrorExists) {
      continue;
    }

    if (mode === 'check') {
      const drift = summarizeCheckDrift(sourceRoot, mirrorRoot, skillName);
      if (drift) {
        results.push({ ...drift, target: targetName });
      }
      continue;
    }

    const syncResult = syncDirectory(sourcePath, mirrorPath, {
      dryRun,
      force: mode === 'update',
      log,
    });
    results.push({ ...syncResult, target: targetName, skill: skillName, sourcePath, mirrorPath });
  }

  return {
    target: targetName,
    mirrorRoot,
    canonicalCount: canonicalSkills.length,
    results,
  };
}

export function runRepoSkillMirrors(options = {}) {
  const mode = String(options.mode || '').trim();
  if (!['check', 'install', 'update'].includes(mode)) {
    throw new Error(`Unsupported repo skill mirror mode: ${mode || '(empty)'}`);
  }

  const repoRoot = path.resolve(options.repoRoot || defaultRepoRoot);
  const configPath = path.resolve(options.configPath || defaultTargetMapPath);
  const log = typeof options.log === 'function' ? options.log : console.log;
  const config = readTargetMap(configPath);
  const sourceRoot = path.join(repoRoot, normalizeRel(config.canonicalSourceRoot));
  const targets = normalizeTargetSelection(config.targets, options.targets || []);

  const targetSummaries = targets.map((targetName) => syncTargetSkills({
    repoRoot,
    sourceRoot,
    targetName,
    targetConfig: config.targets[targetName],
    mode,
    dryRun: Boolean(options.dryRun),
    log,
  }));

  const results = targetSummaries.flatMap((summary) => summary.results);
  const counts = buildCounts(results);
  const hasCheckFailures = counts.staleMirrors > 0 || counts.unexpectedMirrors > 0 || counts.missingMirrors > 0;

  return {
    gateName,
    mode,
    repoRoot,
    configPath,
    sourceRoot,
    targets,
    counts,
    results,
    targetSummaries,
    ok: mode === 'check' ? !hasCheckFailures : true,
  };
}

export function logSummary(summary) {
  console.log(`${gateName}: mode=${summary.mode} repo=${summary.repoRoot}`);
  console.log(`${gateName}: source=${summary.sourceRoot}`);
  console.log(`${gateName}: targets=${summary.targets.join(', ') || '(none)'}`);

  for (const targetSummary of summary.targetSummaries) {
    console.log(`${gateName}: target=${targetSummary.target} mirror=${targetSummary.mirrorRoot}`);
  }
}

export function logCheckFailures(summary) {
  for (const result of summary.results) {
    if (result.action === 'missing_mirror') {
      console.error(`${gateName} failed: ${result.target}:${result.skill} missing mirror at ${formatRepoPath(summary.repoRoot, result.mirrorPath)}`);
    } else if (result.action === 'unexpected_mirror') {
      console.error(`${gateName} failed: ${result.target}:${result.skill} unexpected generated mirror at ${formatRepoPath(summary.repoRoot, result.mirrorPath)}`);
    } else if (result.action === 'stale_mirror') {
      console.error(`${gateName} failed: ${result.target}:${result.skill} stale mirror at ${formatRepoPath(summary.repoRoot, result.mirrorPath)} (source and mirror hashes differ)`);
    }
  }
}

export function logInstallWarnings(summary) {
  for (const result of summary.results) {
    if (result.action === 'skipped_conflict') {
      console.warn(`${gateName}: ${result.target}:${result.skill} left diverged mirror at ${formatRepoPath(summary.repoRoot, result.mirrorPath)}; run node scripts/update-repo-skill-mirrors.mjs to overwrite it`);
    } else if (result.action === 'unexpected_mirror') {
      console.warn(`${gateName}: ${result.target}:${result.skill} left unexpected mirror at ${formatRepoPath(summary.repoRoot, result.mirrorPath)}; run node scripts/update-repo-skill-mirrors.mjs to prune it`);
    }
  }
}

export {
  defaultRepoRoot,
  defaultTargetMapPath,
  gateName,
};
