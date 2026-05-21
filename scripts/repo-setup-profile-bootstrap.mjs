import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  ensureDir,
  normalizeRel,
  shaText,
  syncFile,
} from './install-surface-utils.mjs';
import {
  logInstallWarnings,
  runRepoSkillMirrors,
} from './repo-skill-mirror-lib.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const instructionEngineRoot = path.resolve(__dirname, '..');
const setupProfilesPath = path.join(instructionEngineRoot, 'engine-assets', 'skills', 'repo-setup-governance', 'setup-profiles.json');
const validatorSourcePath = path.join(instructionEngineRoot, 'scripts', 'validate-specs.js');

const MANAGED_BLOCK_START = '<!-- instruction-engine:begin spec-driven -->';
const MANAGED_BLOCK_END = '<!-- instruction-engine:end spec-driven -->';

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

function renderManagedBlock(bodyText) {
  return [
    MANAGED_BLOCK_START,
    String(bodyText || '').trim(),
    MANAGED_BLOCK_END,
    '',
  ].join('\n');
}

function composeManagedMarkdown(existingText, bodyText) {
  const managedBlock = renderManagedBlock(bodyText);
  const source = String(existingText || '').replace(/\r\n/g, '\n');

  if (!source.trim()) {
    return managedBlock;
  }

  const startIndex = source.indexOf(MANAGED_BLOCK_START);
  const endIndex = source.indexOf(MANAGED_BLOCK_END);
  if (startIndex >= 0 && endIndex >= startIndex) {
    const blockEnd = endIndex + MANAGED_BLOCK_END.length;
    const before = source.slice(0, startIndex).replace(/\s*$/, '');
    const after = source.slice(blockEnd).replace(/^\s*/, '');
    return [before, managedBlock.trimEnd(), after]
      .filter(Boolean)
      .join('\n\n')
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd() + '\n';
  }

  return `${source.trimEnd()}\n\n${managedBlock}`;
}

function syncManagedMarkdown(filePath, bodyText, options = {}) {
  const log = options.log || console.log;
  ensureDir(path.dirname(filePath), options.dryRun, log);

  const existingText = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  const nextText = composeManagedMarkdown(existingText, bodyText);
  const previousHash = fs.existsSync(filePath) ? shaText(existingText) : null;
  const nextHash = shaText(nextText);

  if (previousHash === nextHash) {
    log(`[SKIP]   ${filePath} (up-to-date)`);
    return {
      action: 'skipped',
      path: filePath,
      sourceHash: nextHash,
      destinationHash: previousHash,
    };
  }

  const action = fs.existsSync(filePath)
    ? (options.dryRun ? 'would_update' : 'updated')
    : (options.dryRun ? 'would_create' : 'created');

  if (options.dryRun) {
    log(`[DRY-RUN] ${action === 'would_create' ? 'CREATE' : 'UPDATE'} ${filePath}`);
  } else {
    fs.writeFileSync(filePath, nextText, 'utf8');
    log(`[${action === 'created' ? 'CREATE' : 'UPDATE'}] ${filePath}`);
  }

  return {
    action,
    path: filePath,
    sourceHash: nextHash,
    destinationHash: options.dryRun ? previousHash : shaText(fs.readFileSync(filePath, 'utf8')),
  };
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

function buildSpecDrivenInstructionBody() {
  return [
    '## Spec-Driven Development',
    '',
    'This repo opts into instruction-engine spec-driven development for non-trivial work.',
    '',
    '- Use `spec-dev` when a task needs spec-first clarification, a durable repo spec, or a narrow spec-as-source flow.',
    '- Durable specs live under `specs/<spec-slug>/spec.md`; keep `specs/index.md` current as durable specs accumulate.',
    '- Use `spec-authoring` to create or refine durable specs and `spec-review` before implementation planning when the spec will drive the work.',
    '- Validate specs with `node scripts/validate-specs.js` or `npm run validate:specs` when the repo exposes that script.',
  ].join('\n');
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
  const sharedInstructionBody = buildSpecDrivenInstructionBody();
  const repoInstructionFile = getRepoInstructionFile(surface);
  const results = [];

  log(`Repo setup (${getSurfaceLabel(surface)}): ${repoRoot}`);
  log(`Repo setup profile: ${profileKey}`);
  log(`Repo setup base profile: ${baseProfile.key} (${baseProfile.match.canonicalDocEntrypointPath})`);

  results.push(ensureDir(path.join(repoRoot, '.github', 'agents'), Boolean(options.dryRun), log));
  results.push(ensureDir(path.join(repoRoot, '.github', 'skills'), Boolean(options.dryRun), log));
  results.push(ensureDir(path.join(repoRoot, 'specs'), Boolean(options.dryRun), log));
  results.push(syncManagedMarkdown(path.join(repoRoot, '.github', 'copilot-instructions.md'), sharedInstructionBody, options));
  results.push(syncManagedMarkdown(path.join(repoRoot, repoInstructionFile), sharedInstructionBody, options));
  results.push(createTextFileIfMissing(buildSpecsIndexText(), path.join(repoRoot, 'specs', 'index.md'), options));
  results.push(syncFile(validatorSourcePath, path.join(repoRoot, 'scripts', 'validate-specs.js'), options));
  results.push(syncPackageJsonScript(path.join(repoRoot, 'package.json'), 'validate:specs', 'node scripts/validate-specs.js', options));
  const skillMirrors = runRepoSkillMirrors({
    mode: 'install',
    repoRoot,
    dryRun: Boolean(options.dryRun),
    targets: [getRepoSkillMirrorTarget(surface)],
    log,
  });
  logInstallWarnings(skillMirrors);

  return {
    ok: true,
    surface,
    repoRoot,
    profileKey,
    profile: selectedProfile,
    baseProfileKey: baseProfile.key,
    baseCanonicalDocEntrypointPath: String(baseProfile?.match?.canonicalDocEntrypointPath || '').trim(),
    repoInstructionFile,
    skillMirrors,
    results,
    counts: buildCounts(results),
  };
}
