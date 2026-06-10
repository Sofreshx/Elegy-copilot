#!/usr/bin/env node

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { createRequire } from 'module';
import { runRepoSetupProfileBootstrap } from './repo-setup-profile-bootstrap.mjs';
import { normalizeProfile } from './lib/profile-normalizer.mjs';
import { updateAgentModel } from './frontmatter-utils.mjs';
import {
  dirHash,
  ensureDir,
  getUserHome,
  normalizeRel,
  shaFile,
  syncDirectory,
  syncFile,
  syncText,
} from './install-surface-utils.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const { readConfig, writeConfig } = require('../copilot-ui/lib/opencodeConfig.js');
const opencodeAssetsRoot = path.join(repoRoot, 'opencode-assets');
const manifestPath = path.join(opencodeAssetsRoot, 'manifest.json');
const managedInventoryFileName = '.instruction-engine-opencode-managed.json';

function readManifest() {
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function validateManifestAsset(asset) {
  if (!asset || typeof asset !== 'object') {
    throw new Error('Manifest asset entry must be an object');
  }
  if (!asset.id || !asset.type || !asset.source || !asset.destination) {
    throw new Error(`Manifest asset is missing required fields: ${JSON.stringify(asset)}`);
  }
}

function buildCounts(results) {
  const counts = {
    created: 0,
    updated: 0,
    skipped: 0,
    skippedConflict: 0,
    pruned: 0,
    skippedPruneConflict: 0,
    wouldCreate: 0,
    wouldUpdate: 0,
    wouldPrune: 0,
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
      case 'skipped_prune_conflict':
        counts.skippedPruneConflict += 1;
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
      default:
        break;
    }
  }

  return counts;
}

function toStringMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter(([key, mappedValue]) => typeof key === 'string' && key && typeof mappedValue === 'string')
  );
}

function buildManagedInventory(assetResults) {
  const inventory = {
    schemaVersion: 1,
    surface: 'opencode',
    instructions: {},
    agents: {},
    skills: {},
    plugins: {},
  };

  for (const result of Array.isArray(assetResults) ? assetResults : []) {
    const destination = normalizeRel(result.destination);
    if (result.type === 'instructions') {
      inventory.instructions[path.basename(destination)] = String(result.sourceHash || '');
      continue;
    }
    if (result.type === 'agent') {
      inventory.agents[path.basename(destination)] = String(result.sourceHash || '');
      continue;
    }
    if (result.type === 'skill') {
      const suffix = destination.startsWith('skills/') ? destination.slice('skills/'.length) : destination;
      const topDirectory = normalizeRel(suffix).split('/').filter(Boolean)[0];
      if (topDirectory) {
        inventory.skills[topDirectory] = String(result.sourceHash || '');
      }
      continue;
    }
    if (result.type === 'plugin') {
      const suffix = destination.startsWith('plugins/') ? destination.slice('plugins/'.length) : destination;
      inventory.plugins[suffix] = String(result.sourceHash || '');
    }
  }

  return inventory;
}

function readManagedInventory(inventoryPath) {
  if (!fs.existsSync(inventoryPath)) {
    return buildManagedInventory([]);
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
    return {
      schemaVersion: 1,
      surface: 'opencode',
      instructions: toStringMap(parsed.instructions),
      agents: toStringMap(parsed.agents),
      skills: toStringMap(parsed.skills),
      plugins: toStringMap(parsed.plugins),
    };
  } catch {
    return buildManagedInventory([]);
  }
}

function isSafeManagedEntryName(entryName) {
  return Boolean(entryName) && path.basename(entryName) === entryName && !normalizeRel(entryName).includes('/');
}

function logPruneAction(action, targetPath, kind, log) {
  if (action === 'pruned') {
    log(`[PRUNE]  ${targetPath} (${kind})`);
    return;
  }
  if (action === 'would_prune') {
    log(`[DRY-RUN] PRUNE ${targetPath} (${kind})`);
    return;
  }
  if (action === 'skipped_prune_conflict') {
    log(`[SKIP]   ${targetPath} (${kind} diverged; leaving user-modified content in place)`);
  }
}

function pruneManagedEntries(targetRoot, recordedEntries, desiredEntries, kind, hashReader, options = {}) {
  const log = options.log || console.log;
  const results = [];

  if (!fs.existsSync(targetRoot)) {
    return results;
  }

  const entries = Object.entries(recordedEntries || {}).sort(([left], [right]) => left.localeCompare(right));
  for (const [entryName, recordedHash] of entries) {
    if (Object.prototype.hasOwnProperty.call(desiredEntries || {}, entryName)) {
      continue;
    }
    if (!isSafeManagedEntryName(entryName)) {
      continue;
    }

    const targetPath = path.join(targetRoot, entryName);
    if (!fs.existsSync(targetPath)) {
      continue;
    }

    const currentHash = hashReader(targetPath);
    if (recordedHash && currentHash && currentHash !== recordedHash) {
      const result = {
        action: 'skipped_prune_conflict',
        kind,
        path: targetPath,
        recordedHash,
        currentHash,
      };
      results.push(result);
      logPruneAction(result.action, targetPath, kind, log);
      continue;
    }

    const action = options.dryRun ? 'would_prune' : 'pruned';
    if (!options.dryRun) {
      fs.rmSync(targetPath, { recursive: true, force: true });
    }
    const result = {
      action,
      kind,
      path: targetPath,
      recordedHash,
      currentHash,
    };
    results.push(result);
    logPruneAction(action, targetPath, kind, log);
  }

  return results;
}

export function resolveOpenCodeHome(explicit) {
  if (explicit) return path.resolve(explicit);
  if (process.env.OPENCODE_HOME) return path.resolve(process.env.OPENCODE_HOME);
  const cfgDir = process.env.OPENCODE_CONFIG_DIR || process.env.XDG_CONFIG_HOME
    ? path.join(process.env.XDG_CONFIG_HOME || path.join(getUserHome(), '.config'), 'opencode')
    : path.join(getUserHome(), '.config', 'opencode');
  return cfgDir;
}

export function resolveSkillsHome(explicit, opencodeHome) {
  if (explicit) return path.resolve(explicit);
  if (process.env.INSTRUCTION_ENGINE_OPENCODE_SKILLS_HOME) {
    return path.resolve(process.env.INSTRUCTION_ENGINE_OPENCODE_SKILLS_HOME);
  }
  return path.join(opencodeHome, 'skills');
}

export function parseArgs(argv) {
  const args = {
    dryRun: false,
    force: false,
    opencodeHome: '',
    repoRoot: '',
    elegyCliPath: '',
    setupProfile: '',
    skillsHome: '',
    printEnvOnly: false,
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
    if (value.startsWith('--opencode-home=')) {
      args.opencodeHome = value.slice('--opencode-home='.length);
      continue;
    }
    if (value === '--opencode-home') {
      i += 1;
      if (i >= argv.length) {
        throw new Error('Missing value for --opencode-home');
      }
      args.opencodeHome = argv[i] || '';
      continue;
    }
    if (value.startsWith('--skills-home=')) {
      args.skillsHome = value.slice('--skills-home='.length);
      continue;
    }
    if (value === '--skills-home') {
      i += 1;
      if (i >= argv.length) {
        throw new Error('Missing value for --skills-home');
      }
      args.skillsHome = argv[i] || '';
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
    if (value === '--print-env-only') {
      args.printEnvOnly = true;
      continue;
    }
    throw new Error(`Unknown arg: ${value} (supported: --dry-run, --force, --opencode-home <path>, --skills-home <path>, --repo-root <path>, --elegy-cli <path>, --setup-profile <key>, --print-env-only)`);
  }

  if (args.repoRoot && !args.setupProfile) {
    throw new Error('Missing value for --setup-profile when --repo-root is provided');
  }

  if (args.setupProfile && !args.repoRoot) {
    throw new Error('Missing value for --repo-root when --setup-profile is provided');
  }

  return args;
}

async function checkReadiness(opencodeHome, skillsHome, options = {}) {
  const checks = [];
  const warnings = [];

  // Skip readiness checks during dry-run to avoid side effects
  if (options.dryRun) {
    return { checks, warnings };
  }

  // Check worktree plugin installed
  const pluginPath = path.join(opencodeHome, 'plugins', 'worktree.js');
  if (fs.existsSync(pluginPath)) {
    checks.push({ name: 'worktree-plugin', ok: true, path: pluginPath });
    // Smoke test: dynamically import the plugin to surface real module
    // resolution, syntax, and export errors. The dedicated test in
    // opencode-install.test.js performs full instantiation; the readiness
    // check stays lightweight so it is safe to run on every install.
    try {
      const pluginUrl = pathToFileURL(pluginPath).href;
      const mod = await import(pluginUrl);
      if (typeof mod.WorktreePlugin !== 'function') {
        warnings.push(`Worktree plugin at ${pluginPath} loaded but did not export a WorktreePlugin function`);
      } else {
        checks.push({ name: 'worktree-plugin-smoke', ok: true });
      }
    } catch (err) {
      warnings.push(`Worktree plugin at ${pluginPath} failed to load: ${err.message}`);
    }
  } else {
    checks.push({ name: 'worktree-plugin', ok: false, path: pluginPath });
    warnings.push(`Worktree plugin not found at ${pluginPath}`);
  }

  // Check worktree skill installed
  const skillPath = path.join(skillsHome, 'worktree', 'SKILL.md');
  if (fs.existsSync(skillPath)) {
    checks.push({ name: 'worktree-skill', ok: true, path: skillPath });
  } else {
    checks.push({ name: 'worktree-skill', ok: false, path: skillPath });
    warnings.push(`Worktree skill not found at ${skillPath}`);
  }

  // Check shared registry path availability (informational)
  const elegyHome = process.env.ELEGY_HOME
    || path.join(os.homedir(), '.elegy');
  if (fs.existsSync(elegyHome)) {
    checks.push({ name: 'shared-registry-home', ok: true, path: elegyHome });
  } else {
    checks.push({ name: 'shared-registry-home', ok: false, path: elegyHome });
    // Not a warning — shared registry is optional for OpenCode-only users
  }

  return { checks, warnings };
}

export async function runInstall(args = {}) {
  const opencodeHome = resolveOpenCodeHome(args.opencodeHome);
  const skillsHome = resolveSkillsHome(args.skillsHome, opencodeHome);
  const repoSetupRoot = args.repoRoot ? path.resolve(args.repoRoot) : '';
  const inventoryPath = path.join(opencodeHome, managedInventoryFileName);
  const manifest = readManifest();
  const assets = Array.isArray(manifest.assets) ? manifest.assets : [];

  console.log(`OpenCode home: ${opencodeHome}`);
  console.log(`Skills home:   ${skillsHome}`);
  console.log(`Engine root:   ${repoRoot}`);
  console.log(`Assets:        ${assets.length}`);
  if (repoSetupRoot) {
    console.log(`Repo setup:    ${repoSetupRoot} (${args.setupProfile})`);
  }

  ensureDir(opencodeHome, args.dryRun);
  ensureDir(path.join(opencodeHome, 'agents'), args.dryRun);
  ensureDir(skillsHome, args.dryRun);
  ensureDir(path.join(opencodeHome, 'plugins'), args.dryRun);

  const assetResults = [];
  for (const asset of assets) {
    validateManifestAsset(asset);
    const src = path.join(repoRoot, normalizeRel(asset.source));
    const dstRel = normalizeRel(asset.destination);
    let dst;

    if (asset.type === 'skill') {
      const suffix = dstRel.startsWith('skills/') ? dstRel.slice('skills/'.length) : dstRel;
      dst = path.join(skillsHome, suffix);
    } else if (asset.type === 'instructions') {
      dst = path.join(opencodeHome, dstRel);
    } else if (asset.type === 'plugin') {
      const suffix = dstRel.startsWith('plugins/') ? dstRel.slice('plugins/'.length) : dstRel;
      dst = path.join(opencodeHome, 'plugins', suffix);
    } else {
      dst = path.join(opencodeHome, dstRel);
    }

    if (!fs.existsSync(src)) {
      throw new Error(`Source asset missing: ${asset.source}`);
    }

    let syncResult;
    if (asset.type === 'skill') {
      syncResult = syncDirectory(src, dst, args);
    } else {
      syncResult = syncFile(src, dst, args);
    }

    assetResults.push({
      id: asset.id,
      type: asset.type,
      source: normalizeRel(asset.source),
      destination: dstRel,
      ...syncResult,
    });
  }

  const previousInventory = readManagedInventory(inventoryPath);
  const desiredInventory = buildManagedInventory(assetResults);

  const profileInjectionResults = [];
  try {
    const profilesPath = path.join(repoRoot, 'opencode-assets', 'profiles.json');
    if (fs.existsSync(profilesPath)) {
      const profilesConfig = JSON.parse(fs.readFileSync(profilesPath, 'utf8'));
      const activeProfile = profilesConfig.activeProfile || 'opencode-go';
      const profile = profilesConfig.profiles && profilesConfig.profiles[activeProfile];
      const agentRoles = profilesConfig.agentRoles || {};

      if (profile) {
        const roleToAgent = profilesConfig.roleToAgent || null;
        const agentsDir = path.join(opencodeHome, 'agents');
        if (fs.existsSync(agentsDir)) {
          for (const entry of fs.readdirSync(agentsDir)) {
            if (!entry.endsWith('.md')) continue;
            const agentPath = path.join(agentsDir, entry);
            const result = updateAgentModel(agentPath, profile, agentRoles, roleToAgent);
            if (result) {
              profileInjectionResults.push(result);
            }
          }
        }

          try {
          const config = readConfig(opencodeHome);
          if (!config.agent || typeof config.agent !== 'object') {
            config.agent = {};
          }
          let configUpdated = 0;
          for (const [agentName, roleKey] of Object.entries(agentRoles)) {
            const modelValue = profile[roleKey];
            if (!modelValue) continue;
            if (!config.agent[agentName] || typeof config.agent[agentName] !== 'object') {
              config.agent[agentName] = {};
            }
            config.agent[agentName].model = modelValue;
            configUpdated += 1;
          }

          if (configUpdated > 0 && !args.dryRun) {
            writeConfig(opencodeHome, config);
          }

          // Also sync activeProfileId to dashboard state file
          if (!args.dryRun) {
            try {
              const { setActiveProfileId: setActiveId } = require('../copilot-ui/lib/opencodeConfig.js');
              setActiveId(opencodeHome, activeProfile);
            } catch (err) {
              // Non-fatal: dashboard state sync is best-effort
            }
          }
        } catch (err) {
          console.log(`[WARN] Could not sync opencode.jsonc: ${err.message}`);
        }
      }
    }
  } catch (err) {
    console.log(`[WARN] Profile injection failed: ${err.message}`);
  }

  // ── Claude Code provider setup ──
  // Configure Claude Code to use DeepSeek Direct by default (Anthropic-compatible endpoint)
  try {
    const { applyDefaultProvider } = require('../copilot-ui/lib/claudeCodeConfig.js');
    const claudeHome = path.join(os.homedir(), '.claude');
    const ccResult = applyDefaultProvider(claudeHome);
    if (ccResult.applied) {
      console.log(`[OK] Claude Code provider set to ${ccResult.mode} (key from ${ccResult.source})`);
    } else if (ccResult.reason) {
      console.log(`[SKIP] Claude Code provider: ${ccResult.reason}`);
    }
  } catch (err) {
    console.log(`[WARN] Claude Code provider setup failed: ${err.message}`);
  }

  const pruneResults = [
    ...pruneManagedEntries(path.join(opencodeHome, 'agents'), previousInventory.agents, desiredInventory.agents, 'agent', shaFile, args),
    ...pruneManagedEntries(skillsHome, previousInventory.skills, desiredInventory.skills, 'skill', dirHash, args),
    ...pruneManagedEntries(path.join(opencodeHome, 'plugins'), previousInventory.plugins, desiredInventory.plugins, 'plugin', shaFile, args),
  ];
  const inventoryResult = syncText(`${JSON.stringify(desiredInventory, null, 2)}\n`, inventoryPath, {
    dryRun: args.dryRun,
    force: true,
  });
  const repoSetup = repoSetupRoot
    ? runRepoSetupProfileBootstrap({
      surface: 'opencode',
      repoRoot: repoSetupRoot,
      profileKey: args.setupProfile,
      elegyCliPath: args.elegyCliPath,
      dryRun: args.dryRun,
      force: args.force,
    })
    : null;

  const summary = {
    surface: 'opencode',
    ok: true,
    dryRun: Boolean(args.dryRun),
    force: Boolean(args.force),
    homes: {
      opencodeHome,
      skillsHome,
      agentsHome: path.join(opencodeHome, 'agents'),
      inventoryPath,
    },
    counts: buildCounts([...assetResults, ...pruneResults, inventoryResult]),
    assets: assetResults,
    cleanup: {
      inventory: inventoryResult,
      pruneResults,
    },
    profileInjection: profileInjectionResults.length > 0 ? profileInjectionResults : undefined,
    repoSetup,
  };

  // Set INSTRUCTION_ENGINE_ELEGY_PLANNING_SESSION_PATH on Windows when
  // targeting the default Copilot home directory.
  if (process.platform === 'win32' && path.resolve(opencodeHome) === path.resolve('C:\\Users\\lolzi\\.elegy')) {
    const sessionPath = path.join(opencodeHome, 'planning-session.json');
    process.env.INSTRUCTION_ENGINE_ELEGY_PLANNING_SESSION_PATH = sessionPath;
    console.log(`[ENV] INSTRUCTION_ENGINE_ELEGY_PLANNING_SESSION_PATH=${sessionPath}`);

    // Mirror the sidecar from the CLI's default location to the override path
    try {
      const _require = createRequire(import.meta.url);
      const { mirrorSessionSidecar } = _require('../copilot-ui/lib/planningSession.js');
      const defaultSource = path.join(os.homedir(), '.elegy', 'planning-session.json');
      const result = mirrorSessionSidecar({
        resolvedPath: sessionPath,
        defaultSourcePath: defaultSource,
        homedir: os.homedir(),
      });
      if (result) {
        console.log(`[SESSION] Mirrored sidecar: ${result.copiedFrom} → ${result.copiedTo}`);
      } else {
        console.log('[SESSION] No sidecar mirror needed (already present or source missing).');
      }
    } catch (err) {
      console.warn(`[SESSION] Mirror skipped: ${err.message}`);
    }
  }

  console.log('Done.');
  console.log('');
  console.log('Next steps:');
  console.log(`  1. Ensure your OpenCode config exists at ${path.join(opencodeHome, 'opencode.json')}`);
  console.log('  2. Configure your provider and preferred models for lane agents:');
  console.log('     Run /connect in OpenCode TUI and select DeepSeek');
  console.log('  3. Select a lane agent via Tab cycling: quick, standard, spec, project');
  console.log('  4. To switch provider profiles, run: node scripts/opencode-profile-switch.mjs <profile>');
  console.log('  5. Try: use standard for scoped features, spec for API/contract work, project for multi-session roadmap work');
  console.log('');
  if (profileInjectionResults.length > 0) {
    console.log('Profile injection applied:');
    for (const r of profileInjectionResults) {
      console.log(`  ${r.agent}: ${r.oldModel} → ${r.newModel} (role: ${r.role})`);
    }
    console.log('');
  }
  console.log('Worktree plugin config (optional): create .opencode/worktree.json in your project:');
  console.log('  { "syncFiles": [".env", ".env.local", "config/local.json"] }');

  // Readiness checks
  const readiness = await checkReadiness(opencodeHome, skillsHome, { dryRun: args.dryRun });
  if (readiness.warnings.length > 0) {
    console.log('');
    console.log('Readiness warnings:');
    for (const w of readiness.warnings) {
      console.log(`  [WARN] ${w}`);
    }
  }
  if (readiness.checks.length > 0) {
    summary.readiness = readiness;
  }

  return summary;
}

try {
  if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    const args = parseArgs(process.argv.slice(2));
    if (args.printEnvOnly) {
      const elegyHome = resolveOpenCodeHome(args.opencodeHome);
      if (process.platform === 'win32' && path.resolve(elegyHome) === path.resolve('C:\\Users\\lolzi\\.elegy')) {
        const sessionPath = path.join(elegyHome, 'planning-session.json');
        console.log(`INSTRUCTION_ENGINE_ELEGY_PLANNING_SESSION_PATH=${sessionPath}`);
      }
      process.exit(0);
    }
    await runInstall(args);
  }
} catch (error) {
  console.error(error.message || String(error));
  process.exit(1);
}
