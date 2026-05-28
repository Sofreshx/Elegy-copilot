import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  ensureDir,
  normalizeRel,
  shaText,
} from './install-surface-utils.mjs';
import {
  logInstallWarnings,
  runRepoSkillMirrors,
} from './repo-skill-mirror-lib.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const instructionEngineRoot = path.resolve(__dirname, '..');
const setupProfilesPath = path.join(instructionEngineRoot, 'engine-assets', 'skills', 'repo-setup-governance', 'setup-profiles.json');
const configurationPackagePath = path.join(instructionEngineRoot, 'configuration', 'elegy-plugin-package.json');

const SPEC_DRIVEN_OVERLAYS_PROFILE_ID = 'instruction-engine-spec-driven-overlays';
const SPEC_DRIVEN_VALIDATOR_PROFILE_ID = 'instruction-engine-spec-driven-validator';
const VALIDATE_SPECS_COMMAND = 'node scripts/validate-specs.js';

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeProfileType(value) {
  return String(value || 'canonical-doc-entrypoint').trim() || 'canonical-doc-entrypoint';
}

function buildCounts(results) {
  const counts = {
    created: 0,
    updated: 0,
    skipped: 0,
    skippedConflict: 0,
    wouldCreate: 0,
    wouldUpdate: 0,
  };

  for (const result of Array.isArray(results) ? results : []) {
    switch (result?.action) {
      case 'created':
      case 'created_dir':
        counts.created += 1;
        break;
      case 'updated':
        counts.updated += 1;
        break;
      case 'skipped':
      case 'exists':
        counts.skipped += 1;
        break;
      case 'skipped_conflict':
        counts.skippedConflict += 1;
        break;
      case 'would_create':
      case 'would_create_dir':
        counts.wouldCreate += 1;
        break;
      case 'would_update':
        counts.wouldUpdate += 1;
        break;
      default:
        break;
    }
  }

  return counts;
}

function createTextFileIfMissing(content, filePath, options = {}) {
  const log = options.log || console.log;
  ensureDir(path.dirname(filePath), options.dryRun, log);

  if (fs.existsSync(filePath)) {
    log(`[SKIP]   ${filePath} (already exists)`);
    return {
      action: 'skipped',
      path: filePath,
      sourceHash: shaText(content),
      destinationHash: shaText(fs.readFileSync(filePath, 'utf8')),
    };
  }

  const action = options.dryRun ? 'would_create' : 'created';
  if (options.dryRun) {
    log(`[DRY-RUN] CREATE ${filePath}`);
  } else {
    fs.writeFileSync(filePath, content, 'utf8');
    log(`[CREATE] ${filePath}`);
  }

  return {
    action,
    path: filePath,
    sourceHash: shaText(content),
    destinationHash: options.dryRun ? null : shaText(fs.readFileSync(filePath, 'utf8')),
  };
}

function syncPackageJsonScript(packageJsonPath, scriptName, scriptCommand, options = {}) {
  const log = options.log || console.log;
  if (!fs.existsSync(packageJsonPath)) {
    log(`[SKIP]   ${packageJsonPath} (package.json not found)`);
    return {
      action: 'skipped',
      path: packageJsonPath,
      scriptName,
      reason: 'package-json-not-found',
    };
  }

  const currentText = fs.readFileSync(packageJsonPath, 'utf8');
  const parsed = JSON.parse(currentText);
  const currentScripts = parsed && parsed.scripts && typeof parsed.scripts === 'object' && !Array.isArray(parsed.scripts)
    ? parsed.scripts
    : {};
  const currentCommand = Object.prototype.hasOwnProperty.call(currentScripts, scriptName)
    ? String(currentScripts[scriptName])
    : '';

  if (currentCommand === scriptCommand) {
    log(`[SKIP]   ${packageJsonPath} (script '${scriptName}' is up-to-date)`);
    return {
      action: 'skipped',
      path: packageJsonPath,
      scriptName,
      sourceHash: shaText(currentText),
      destinationHash: shaText(currentText),
    };
  }

  if (currentCommand) {
    log(`[SKIP]   ${packageJsonPath} (script '${scriptName}' already exists with different content)`);
    return {
      action: 'skipped_conflict',
      path: packageJsonPath,
      scriptName,
      currentCommand,
      expectedCommand: scriptCommand,
      sourceHash: shaText(currentText),
      destinationHash: shaText(currentText),
    };
  }

  parsed.scripts = {
    ...currentScripts,
    [scriptName]: scriptCommand,
  };
  const nextText = `${JSON.stringify(parsed, null, 2)}\n`;
  const action = options.dryRun ? 'would_update' : 'updated';

  if (options.dryRun) {
    log(`[DRY-RUN] UPDATE ${packageJsonPath}`);
  } else {
    fs.writeFileSync(packageJsonPath, nextText, 'utf8');
    log(`[UPDATE] ${packageJsonPath}`);
  }

  return {
    action,
    path: packageJsonPath,
    scriptName,
    sourceHash: shaText(nextText),
    destinationHash: options.dryRun ? shaText(currentText) : shaText(fs.readFileSync(packageJsonPath, 'utf8')),
  };
}

function buildSpecsIndexText() {
  return [
    '# Specs',
    '',
    'This repo opts into instruction-engine spec-driven development for non-trivial work.',
    '',
    '- Durable specs live under `specs/<spec-slug>/spec.md`.',
    '- Use `spec-dev` to choose `spec-first`, `spec-anchored`, or `spec-as-source`.',
    '- Use `spec-authoring` to create or refine durable specs and `spec-review` before implementation planning when the spec will drive the work.',
    '- Narrow candidate constraints to the minimum hard constraints needed for the active step.',
    '- Use ADRs only for key architectural, workflow-authority, trust-boundary, or long-lived contract decisions.',
    '- Validate specs with `node scripts/validate-specs.js` or `npm run validate:specs` when the repo exposes that script.',
    '',
    '## Index',
    '',
    '- None yet.',
    '',
  ].join('\n');
}

function getRepoInstructionFile(surface) {
  if (surface === 'antigravity') {
    return 'GEMINI.md';
  }
  return 'AGENTS.md';
}

function getSurfaceLabel(surface) {
  if (surface === 'codex') return 'Codex';
  if (surface === 'opencode') return 'OpenCode';
  if (surface === 'antigravity') return 'Antigravity';
  return surface;
}

function getRepoSkillMirrorTarget(surface) {
  if (surface === 'copilot') return '';
  if (surface === 'codex') return 'codex';
  if (surface === 'opencode') return 'opencode';
  if (surface === 'antigravity') return 'antigravity';
  return '';
}

function loadSetupProfile(profileKey) {
  const setupProfiles = readJson(setupProfilesPath);
  const profiles = Array.isArray(setupProfiles?.profiles) ? setupProfiles.profiles : [];
  const selectedProfile = profiles.find((profile) => String(profile?.key || '').trim() === String(profileKey || '').trim());
  if (!selectedProfile) {
    throw new Error(`Unknown repo setup profile '${profileKey}'.`);
  }
  return {
    setupProfiles,
    profiles,
    selectedProfile,
  };
}

function resolveBaseProfileForOverlay(repoRoot, profiles, overlayProfile) {
  const candidateKeys = Array.isArray(overlayProfile?.match?.extendsProfileKeys) ? overlayProfile.match.extendsProfileKeys : [];
  const candidateProfiles = candidateKeys
    .map((profileKey) => profiles.find((profile) => String(profile?.key || '').trim() === String(profileKey || '').trim()))
    .filter(Boolean)
    .filter((profile) => normalizeProfileType(profile.profileType) === 'canonical-doc-entrypoint');
  const matchedProfiles = candidateProfiles.filter((profile) => {
    const entrypoint = String(profile?.match?.canonicalDocEntrypointPath || '').trim();
    return entrypoint && fs.existsSync(path.join(repoRoot, normalizeRel(entrypoint)));
  });

  if (matchedProfiles.length > 0) {
    return matchedProfiles[0];
  }

  const expectedEntrypoints = candidateProfiles
    .map((profile) => String(profile?.match?.canonicalDocEntrypointPath || '').trim())
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
  throw new Error(
    `Repo setup profile '${overlayProfile?.key || '<unknown>'}' requires one existing canonical doc entrypoint: ${expectedEntrypoints.join(', ')}`
  );
}

function resolveElegyCliPath(options = {}) {
  const configuredPath = normalizeString(options.elegyCliPath || process.env.INSTRUCTION_ENGINE_ELEGY_CLI_PATH);
  if (!configuredPath) {
    throw new Error('Repo setup bootstrap requires Elegy CLI path. Pass --elegy-cli <path> or set INSTRUCTION_ENGINE_ELEGY_CLI_PATH.');
  }

  const resolvedPath = path.resolve(configuredPath);
  if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
    throw new Error(`Repo setup bootstrap Elegy CLI path does not exist: ${resolvedPath}`);
  }

  return resolvedPath;
}

function runElegyConfigurationApply(options = {}) {
  const args = [
    'configuration',
    'apply',
    '--package',
    configurationPackagePath,
    '--profile-id',
    String(options.profileId || '').trim(),
    '--target',
    options.repoRoot,
    '--json',
  ];
  if (options.dryRun) {
    args.push('--dry-run');
  }
  if (options.force) {
    args.push('--force');
  }

  for (const [key, value] of Object.entries(options.bindings || {})) {
    args.push('--binding', `${key}=${value}`);
  }

  const result = spawnSync(options.elegyCliPath, args, {
    encoding: 'utf8',
  });
  if (result.error) {
    throw result.error;
  }
  if (result.signal) {
    throw new Error(`Elegy configuration apply terminated with signal ${result.signal}.`);
  }

  const stdout = String(result.stdout || '').trim();
  if (!stdout) {
    const stderr = normalizeString(result.stderr);
    throw new Error(
      stderr
        ? `Elegy configuration apply returned no JSON output: ${stderr}`
        : 'Elegy configuration apply returned no JSON output.'
    );
  }

  let envelope;
  try {
    envelope = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`Failed to parse Elegy configuration JSON output: ${error.message}`);
  }

  const receipt = envelope && typeof envelope === 'object' ? envelope.data : null;
  if (!receipt || receipt.schemaVersion !== 'elegy-configuration-receipt/v1') {
    throw new Error('Elegy configuration apply returned an unexpected receipt payload.');
  }

  return {
    exitCode: typeof result.status === 'number' ? result.status : 1,
    envelope,
    receipt,
    stderr: String(result.stderr || ''),
  };
}

function mapReceiptActionToBootstrapAction(action) {
  if (action === 'would-create') return 'would_create';
  if (action === 'would-update') return 'would_update';
  if (action === 'conflict') return 'skipped_conflict';
  if (action === 'created' || action === 'updated' || action === 'skipped') {
    return action;
  }
  return 'skipped';
}

function receiptEntriesToResults(receipt) {
  return Array.isArray(receipt?.entries)
    ? receipt.entries.map((entry) => ({
        action: mapReceiptActionToBootstrapAction(entry.action),
        path: entry.path,
        sourceHash: entry.expectedHash || null,
        destinationHash: entry.actualHash || null,
        operationId: entry.operationId,
        templateId: entry.templateId,
        detail: entry.detail || '',
      }))
    : [];
}

function buildEmptySkillMirrorSummary(repoRoot) {
  return {
    gateName: 'Repo Skill Mirrors',
    mode: 'install',
    repoRoot,
    configPath: '',
    sourceRoot: path.join(repoRoot, '.github', 'skills'),
    targets: [],
    counts: buildCounts([]),
    results: [],
    targetSummaries: [],
    ok: true,
  };
}

export function runRepoSetupProfileBootstrap(options = {}) {
  const surface = String(options.surface || '').trim();
  const repoRootInput = String(options.repoRoot || '').trim();
  const repoRoot = repoRootInput ? path.resolve(repoRootInput) : '';
  const profileKey = String(options.profileKey || '').trim();
  const log = options.log || console.log;

  if (!surface) {
    throw new Error('Repo setup bootstrap requires a surface.');
  }
  if (!repoRoot) {
    throw new Error('Repo setup bootstrap requires repoRoot.');
  }
  if (!fs.existsSync(repoRoot) || !fs.statSync(repoRoot).isDirectory()) {
    throw new Error(`Repo setup bootstrap target is not a directory: ${repoRoot}`);
  }
  if (!profileKey) {
    throw new Error('Repo setup bootstrap requires profileKey.');
  }

  const { profiles, selectedProfile } = loadSetupProfile(profileKey);
  if (normalizeProfileType(selectedProfile.profileType) !== 'overlay') {
    throw new Error(`Repo setup bootstrap currently supports only overlay profiles. Received '${selectedProfile.profileType || ''}'.`);
  }

  const baseProfile = resolveBaseProfileForOverlay(repoRoot, profiles, selectedProfile);
  const elegyCliPath = resolveElegyCliPath(options);
  const repoInstructionFile = getRepoInstructionFile(surface);
  const results = [];

  log(`Repo setup (${getSurfaceLabel(surface)}): ${repoRoot}`);
  log(`Repo setup profile: ${profileKey}`);
  log(`Repo setup base profile: ${baseProfile.key} (${baseProfile.match.canonicalDocEntrypointPath})`);
  log(`Repo setup Elegy CLI: ${elegyCliPath}`);

  results.push(ensureDir(path.join(repoRoot, '.github', 'agents'), Boolean(options.dryRun), log));
  results.push(ensureDir(path.join(repoRoot, '.github', 'skills'), Boolean(options.dryRun), log));
  results.push(ensureDir(path.join(repoRoot, 'specs'), Boolean(options.dryRun), log));

  const overlays = runElegyConfigurationApply({
    elegyCliPath,
    repoRoot,
    profileId: SPEC_DRIVEN_OVERLAYS_PROFILE_ID,
    dryRun: Boolean(options.dryRun),
    force: true,
    bindings: {
      'target.instructions': repoInstructionFile,
    },
  });
  results.push(...receiptEntriesToResults(overlays.receipt));

  results.push(createTextFileIfMissing(buildSpecsIndexText(), path.join(repoRoot, 'specs', 'index.md'), options));

  const validator = runElegyConfigurationApply({
    elegyCliPath,
    repoRoot,
    profileId: SPEC_DRIVEN_VALIDATOR_PROFILE_ID,
    dryRun: Boolean(options.dryRun),
    force: Boolean(options.force),
  });
  results.push(...receiptEntriesToResults(validator.receipt));

  results.push(syncPackageJsonScript(path.join(repoRoot, 'package.json'), 'validate:specs', VALIDATE_SPECS_COMMAND, options));

  const mirrorTarget = getRepoSkillMirrorTarget(surface);
  const skillMirrors = mirrorTarget
    ? runRepoSkillMirrors({
        mode: 'install',
        repoRoot,
        dryRun: Boolean(options.dryRun),
        targets: [mirrorTarget],
        log,
      })
    : buildEmptySkillMirrorSummary(repoRoot);
  if (mirrorTarget) {
    logInstallWarnings(skillMirrors);
  }

  return {
    ok: overlays.exitCode === 0 && validator.exitCode === 0,
    surface,
    repoRoot,
    profileKey,
    profile: selectedProfile,
    baseProfileKey: baseProfile.key,
    baseCanonicalDocEntrypointPath: String(baseProfile?.match?.canonicalDocEntrypointPath || '').trim(),
    repoInstructionFile,
    elegyCliPath,
    configurationPackagePath,
    configuration: {
      overlays: overlays.receipt,
      validator: validator.receipt,
    },
    skillMirrors,
    results,
    counts: buildCounts(results),
  };
}
