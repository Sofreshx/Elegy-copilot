#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getUserHome, normalizeRel } from './install-surface-utils.mjs';
import { runHarnessInstall } from './harness-install-template.mjs';
import { runRepoSetupProfileBootstrap } from './repo-setup-profile-bootstrap.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const claudeAssetsRoot = path.join(repoRoot, 'claude-assets');
const manifestPath = path.join(claudeAssetsRoot, 'manifest.json');

const DESCRIPTOR = {
  surface: 'claude',
  manifestPath,
  inventoryFileName: '.elegy-copilot-claude-managed.json',
  resolveHome(explicit) {
    if (explicit) return path.resolve(explicit);
    if (process.env.CLAUDE_HOME) return path.resolve(process.env.CLAUDE_HOME);
    return path.join(getUserHome(), '.claude');
  },
  resolveSkills(explicit, home) {
    if (explicit) return path.resolve(explicit);
    if (process.env.INSTRUCTION_ENGINE_CLAUDE_SKILLS_HOME) {
      return path.resolve(process.env.INSTRUCTION_ENGINE_CLAUDE_SKILLS_HOME);
    }
    return path.join(home, 'skills');
  },
};

export function resolveClaudeHome(explicit) {
  return DESCRIPTOR.resolveHome(explicit);
}

export function resolveSkillsHome(explicit, claudeHome) {
  return DESCRIPTOR.resolveSkills(explicit, claudeHome);
}

export function parseArgs(argv) {
  const args = {
    dryRun: false,
    force: false,
    claudeHome: '',
    skillsHome: '',
    repoRoot: '',
    setupProfile: '',
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
    if (value.startsWith('--claude-home=')) {
      args.claudeHome = value.slice('--claude-home='.length);
      continue;
    }
    if (value === '--claude-home') {
      i += 1;
      if (i >= argv.length) {
        throw new Error('Missing value for --claude-home');
      }
      args.claudeHome = argv[i] || '';
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
    if (value === '--repo-root') {
      i += 1;
      if (i >= argv.length) {
        throw new Error('Missing value for --repo-root');
      }
      args.repoRoot = argv[i] || '';
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
    throw new Error(`Unknown arg: ${value} (supported: --dry-run, --force, --claude-home <path>, --skills-home <path>, --repo-root <path>, --setup-profile <key>, --print-env-only)`);
  }

  if (args.repoRoot && !args.setupProfile) {
    throw new Error('Missing value for --setup-profile when --repo-root is provided');
  }

  if (args.setupProfile && !args.repoRoot) {
    throw new Error('Missing value for --repo-root when --setup-profile is provided');
  }

  return args;
}

export async function runInstall(args = {}) {
  const summary = runHarnessInstall(DESCRIPTOR, {
    dryRun: args.dryRun,
    force: args.force,
    explicitHome: args.claudeHome,
    explicitSkillsHome: args.skillsHome,
  });

  if (args.repoRoot) {
    summary.repoSetup = runRepoSetupProfileBootstrap({
      surface: 'claude',
      repoRoot: path.resolve(args.repoRoot),
      profileKey: args.setupProfile,
      dryRun: args.dryRun,
      force: args.force,
    });
  }

  return summary;
}

try {
  if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    const args = parseArgs(process.argv.slice(2));
    if (args.printEnvOnly) {
      process.exit(0);
    }
    await runInstall(args);
  }
} catch (error) {
  console.error(error.message || String(error));
  process.exit(1);
}
