#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { ensureDir, getUserHome, syncFile, syncText } from './install-surface-utils.mjs';
import { composeInstructions } from './instruction-compose-utils.mjs';
import { runRepoSetupProfileBootstrap } from './repo-setup-profile-bootstrap.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const assetsModule = await import(pathToFileUrl(path.join(repoRoot, 'copilot-ui', 'lib', 'assets.js')));
const {
  loadManifest,
  syncManagedInstall,
  readInstallState,
} = assetsModule.default || assetsModule;

function pathToFileUrl(filePath) {
  const normalized = path.resolve(filePath).replace(/\\/g, '/');
  return new URL(`file:///${normalized.startsWith('/') ? normalized.slice(1) : normalized}`);
}

function normalizeInstallProfile(value) {
  const normalized = String(value || 'minimal').trim().toLowerCase();
  if (normalized === 'minimal' || normalized === 'public') {
    return 'minimal';
  }
  if (normalized === 'full' || normalized === 'internal') {
    return 'full';
  }
  throw new Error(`Unsupported install profile: ${value} (supported: minimal, full, public, internal)`);
}

function resolveElegyHome(explicit) {
  if (explicit) {
    return path.resolve(explicit);
  }
  if (process.env.XDG_CONFIG_HOME) {
    return path.resolve(process.env.XDG_CONFIG_HOME);
  }
  return path.join(getUserHome(), '.elegy');
}

function buildCounts(results) {
  const counts = {
    installed: 0,
    updated: 0,
    noop: 0,
    skipped: 0,
    wouldInstall: 0,
    wouldUpdate: 0,
  };

  for (const result of Array.isArray(results) ? results : []) {
    switch (result?.action) {
      case 'installed':
        counts.installed += 1;
        break;
      case 'updated':
        counts.updated += 1;
        break;
      case 'noop':
        counts.noop += 1;
        break;
      case 'skipped':
        counts.skipped += 1;
        break;
      case 'would_install':
        counts.wouldInstall += 1;
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

function buildCopilotAssetFilter() {
  return (asset) => {
    if (!asset || typeof asset !== 'object') {
      return false;
    }

    return asset.type === 'agent' || asset.type === 'skill' || asset.type === 'instructions';
  };
}

function buildInstallStateOverride(currentState, previousState, installProfile) {
  const normalizedCurrentPrompts = Array.isArray(currentState?.managedPrompts)
    ? currentState.managedPrompts.map((entry) => String(entry || '').trim()).filter(Boolean)
    : [];

  return {
    ...currentState,
    installProfile,
    managedPrompts: normalizedCurrentPrompts,
  };
}

function writeInstallState(destinationHome, state, options = {}) {
  const statePath = path.join(path.resolve(destinationHome), '.elegy-copilot-install-state.json');
  const payload = `${JSON.stringify({
    schemaVersion: 3,
    installProfile: String(state?.installProfile || 'minimal'),
    managedSkills: Array.isArray(state?.managedSkills) ? [...new Set(state.managedSkills)].sort() : [],
    alwaysLoadedSkills: Array.isArray(state?.alwaysLoadedSkills) ? [...new Set(state.alwaysLoadedSkills)].sort() : [],
    vaultSkills: Array.isArray(state?.vaultSkills) ? [...new Set(state.vaultSkills)].sort() : [],
    managedAgents: Array.isArray(state?.managedAgents) ? [...new Set(state.managedAgents)].sort() : [],
    managedPrompts: Array.isArray(state?.managedPrompts) ? [...new Set(state.managedPrompts)].sort() : [],
  }, null, 2)}
`;
  if (options.dryRun) {
    console.log(`[DRY-RUN] WRITE-STATE ${statePath}`);
    return { action: 'would_update', path: statePath };
  }

  ensureDir(path.dirname(statePath), false);
  fs.writeFileSync(statePath, payload, 'utf8');
  console.log(`[STATE]  ${statePath}`);
  return { action: 'updated', path: statePath };
}

function syncInstructions(baselinePath, appendixPath, destinationHome, options = {}) {
  const composed = composeInstructions(baselinePath, appendixPath);
  return syncText(composed, path.join(destinationHome, 'copilot-instructions.md'), options);
}

function summarizeSurface(surface, result, installStateAction, instructionsAction) {
  return {
    surface,
    counts: buildCounts(result?.synced),
    prunedPaths: Array.isArray(result?.prunedPaths) ? result.prunedPaths : [],
    installState: installStateAction,
    instructions: instructionsAction,
    assets: Array.isArray(result?.synced) ? result.synced : [],
  };
}

export function parseArgs(argv) {
  const args = {
    dryRun: false,
    force: false,
    pointerMode: true,
    installProfile: 'minimal',
    doCli: false,
    elegyHome: '',
    repoRoot: '',
    elegyCliPath: '',
    setupProfile: '',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (value === '--force') {
      args.force = true;
      continue;
    }
    if (value === '--cli') {
      args.doCli = true;
      continue;
    }
    if (value === '--pointer') {
      args.pointerMode = true;
      continue;
    }
    if (value.startsWith('--profile=')) {
      args.installProfile = value.slice('--profile='.length);
      continue;
    }
    if (value === '--profile') {
      i += 1;
      if (i >= argv.length) {
        throw new Error('Missing value for --profile');
      }
      args.installProfile = argv[i] || '';
      continue;
    }
    if (value === '--minimal' || value === '--public') {
      args.installProfile = 'minimal';
      continue;
    }
    if (value === '--full' || value === '--internal') {
      args.installProfile = 'full';
      continue;
    }
    if (value.startsWith('--elegy-home=')) {
      args.elegyHome = value.slice('--elegy-home='.length);
      continue;
    }
    if (value === '--elegy-home') {
      i += 1;
      if (i >= argv.length) {
        throw new Error('Missing value for --elegy-home');
      }
      args.elegyHome = argv[i] || '';
      continue;
    }
    if (value.startsWith('--repo-root=')) {
      args.repoRoot = value.slice('--repo-root='.length);
      continue;
    }
    if (value.startsWith('--elegy-cli=')) {
      args.elegyCliPath = value.slice('--elegy-cli='.length);
      continue;
    }
    if (value === '--repo-root') {
      i += 1;
      if (i >= argv.length) {
        throw new Error('Missing value for --repo-root');
      }
      args.repoRoot = argv[i] || '';
      continue;
    }
    if (value === '--elegy-cli') {
      i += 1;
      if (i >= argv.length) {
        throw new Error('Missing value for --elegy-cli');
      }
      args.elegyCliPath = argv[i] || '';
      continue;
    }
    if (value.startsWith('--setup-profile=')) {
      args.setupProfile = value.slice('--setup-profile='.length);
      continue;
    }
    if (value === '--setup-profile') {
      i += 1;
      if (i >= argv.length) {
        throw new Error('Missing value for --setup-profile');
      }
      args.setupProfile = argv[i] || '';
      continue;
    }
    throw new Error(`Unknown arg: ${value} (supported: --dry-run, --force, --cli, --pointer, --profile <minimal|full>, --profile=<minimal|full>, --minimal, --full, --public, --internal, --elegy-home <path>, --repo-root <path>, --elegy-cli <path>, --setup-profile <key>)`);
  }

  if (!args.doCli) {
    args.doCli = true;
  }

  args.installProfile = normalizeInstallProfile(args.installProfile);

  if (args.repoRoot && !args.setupProfile) {
    throw new Error('Missing value for --setup-profile when --repo-root is provided');
  }
  if (args.setupProfile && !args.repoRoot) {
    throw new Error('Missing value for --repo-root when --setup-profile is provided');
  }

  return args;
}

export function runInstall(args = {}) {
  const installProfile = normalizeInstallProfile(args.installProfile || 'minimal');
  const elegyHome = resolveElegyHome(args.elegyHome);
  const manifest = loadManifest(repoRoot);
  const repoSetupRoot = args.repoRoot ? path.resolve(args.repoRoot) : '';

  console.log(`Elegy home: ${elegyHome}`);
  console.log(`Engine root:  ${repoRoot}`);
  console.log(`Profile:      ${installProfile}`);
  console.log(`Assets:       ${Array.isArray(manifest.assets) ? manifest.assets.length : 0}`);

  const surfaces = [];

  const runSurface = (surface, destinationHome, instructionsSource, instructionsAppendix) => {
    ensureDir(destinationHome, Boolean(args.dryRun));

    const previousState = readInstallState(destinationHome);
    const result = syncManagedInstall(repoRoot, destinationHome, {
      dryRun: Boolean(args.dryRun),
      force: Boolean(args.force),
      pointerMode: args.pointerMode !== false,
      assetFilter: buildCopilotAssetFilter(),
      preserveManagedPrompts: true,
    });
    const installState = buildInstallStateOverride(result.installState, previousState, installProfile);
    const installStateAction = writeInstallState(destinationHome, installState, { dryRun: Boolean(args.dryRun) });
    const instructionsAction = syncInstructions(instructionsSource, instructionsAppendix, destinationHome, {
      dryRun: Boolean(args.dryRun),
      force: Boolean(args.force),
    });
    surfaces.push(summarizeSurface(surface, result, installStateAction, instructionsAction));
  };

  if (args.doCli) {
    runSurface('cli', elegyHome,
      path.join(repoRoot, 'catalog-assets', 'instructions', 'agent-session-defaults.md'),
      path.join(repoRoot, 'engine-assets', 'copilot-instructions-appendix.md'));
  }

  const repoSetup = repoSetupRoot
    ? runRepoSetupProfileBootstrap({
        surface: 'copilot',
        repoRoot: repoSetupRoot,
        profileKey: args.setupProfile,
        elegyCliPath: args.elegyCliPath,
        dryRun: Boolean(args.dryRun),
        force: Boolean(args.force),
      })
    : null;

  const summary = {
    surface: 'copilot',
    ok: true,
    dryRun: Boolean(args.dryRun),
    force: Boolean(args.force),
    pointerMode: args.pointerMode !== false,
    installProfile,
    homes: {
      elegyHome,
    },
    surfaces,
    repoSetup,
  };

  console.log('Done.');
  return summary;
}

try {
  if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    runInstall(parseArgs(process.argv.slice(2)));
  }
} catch (error) {
  console.error(error.message || String(error));
  process.exit(1);
}
