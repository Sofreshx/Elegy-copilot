#!/usr/bin/env node

import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { DEFAULT_PROFILE_NAME, DEFAULT_REVIEW_MODEL, patchConfigFile } from './codex-config-patch.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const codexAssetsRoot = path.join(repoRoot, 'codex-assets');
const manifestPath = path.join(codexAssetsRoot, 'manifest.json');

export function parseArgs(argv) {
  const args = {
    dryRun: false,
    force: false,
    codexHome: '',
    skillsHome: '',
    reviewModel: DEFAULT_REVIEW_MODEL,
    profileName: DEFAULT_PROFILE_NAME,
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
    if (value.startsWith('--codex-home=')) {
      args.codexHome = value.slice('--codex-home='.length);
      continue;
    }
    if (value === '--codex-home') {
      i += 1;
      if (i >= argv.length) {
        throw new Error('Missing value for --codex-home');
      }
      args.codexHome = argv[i] || '';
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
    if (value.startsWith('--review-model=')) {
      args.reviewModel = value.slice('--review-model='.length);
      continue;
    }
    if (value === '--review-model') {
      i += 1;
      if (i >= argv.length) {
        throw new Error('Missing value for --review-model');
      }
      args.reviewModel = argv[i] || '';
      continue;
    }
    if (value.startsWith('--profile-name=')) {
      args.profileName = value.slice('--profile-name='.length);
      continue;
    }
    if (value === '--profile-name') {
      i += 1;
      if (i >= argv.length) {
        throw new Error('Missing value for --profile-name');
      }
      args.profileName = argv[i] || '';
      continue;
    }
    throw new Error(`Unknown arg: ${value} (supported: --dry-run, --force, --codex-home <path>, --skills-home <path>, --review-model <model>, --profile-name <name>)`);
  }

  return args;
}

function getUserHome() {
  return process.env.HOME || process.env.USERPROFILE || os.homedir();
}

export function resolveCodexHome(explicit) {
  if (explicit) return path.resolve(explicit);
  if (process.env.CODEX_HOME) return path.resolve(process.env.CODEX_HOME);
  return path.join(getUserHome(), '.codex');
}

export function resolveSkillsHome(explicit) {
  if (explicit) return path.resolve(explicit);
  if (process.env.INSTRUCTION_ENGINE_CODEX_SKILLS_HOME) {
    return path.resolve(process.env.INSTRUCTION_ENGINE_CODEX_SKILLS_HOME);
  }
  return path.join(getUserHome(), '.agents', 'skills');
}

function normalizeRel(value) {
  return String(value || '').replace(/\\/g, '/');
}

function shaFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function dirHash(dirPath) {
  if (!fs.existsSync(dirPath)) return '';
  const files = [];

  function walk(current, base) {
    const entries = fs.readdirSync(current, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      const rel = path.relative(base, abs).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        walk(abs, base);
      } else if (entry.isFile()) {
        files.push(`${rel}\0${shaFile(abs)}`);
      }
    }
  }

  walk(dirPath, dirPath);
  return crypto.createHash('sha256').update(files.join('\n')).digest('hex');
}

function ensureDir(targetPath, dryRun) {
  if (fs.existsSync(targetPath)) return;
  if (dryRun) {
    console.log(`[DRY-RUN] mkdir ${targetPath}`);
    return;
  }
  fs.mkdirSync(targetPath, { recursive: true });
}

function syncFile(src, dst, options) {
  const dstDir = path.dirname(dst);
  ensureDir(dstDir, options.dryRun);

  if (!fs.existsSync(dst)) {
    if (options.dryRun) {
      console.log(`[DRY-RUN] CREATE ${dst}`);
    } else {
      fs.copyFileSync(src, dst);
      console.log(`[CREATE] ${dst}`);
    }
    return;
  }

  if (shaFile(src) === shaFile(dst)) {
    console.log(`[SKIP]   ${dst} (up-to-date)`);
    return;
  }

  if (!options.force) {
    console.log(`[SKIP]   ${dst} (differs; re-run with --force to overwrite)`);
    return;
  }

  if (options.dryRun) {
    console.log(`[DRY-RUN] UPDATE ${dst}`);
  } else {
    fs.copyFileSync(src, dst);
    console.log(`[UPDATE] ${dst}`);
  }
}

function syncDirectory(src, dst, options) {
  ensureDir(path.dirname(dst), options.dryRun);

  if (!fs.existsSync(dst)) {
    if (options.dryRun) {
      console.log(`[DRY-RUN] CREATE-DIR ${dst}`);
    } else {
      fs.cpSync(src, dst, { recursive: true });
      console.log(`[CREATE] ${dst}`);
    }
    return;
  }

  if (dirHash(src) === dirHash(dst)) {
    console.log(`[SKIP]   ${dst} (up-to-date)`);
    return;
  }

  if (!options.force) {
    console.log(`[SKIP]   ${dst} (differs; re-run with --force to overwrite)`);
    return;
  }

  if (options.dryRun) {
    console.log(`[DRY-RUN] UPDATE-DIR ${dst}`);
  } else {
    fs.rmSync(dst, { recursive: true, force: true });
    fs.cpSync(src, dst, { recursive: true });
    console.log(`[UPDATE] ${dst}`);
  }
}

function mapDestination(asset, codexHome, skillsHome) {
  const destination = normalizeRel(asset.destination);
  if (asset.type === 'skill') {
    const suffix = destination.startsWith('skills/') ? destination.slice('skills/'.length) : destination;
    return path.join(skillsHome, suffix);
  }
  return path.join(codexHome, destination);
}

function validateManifestAsset(asset) {
  if (!asset || typeof asset !== 'object') {
    throw new Error('Manifest asset entry must be an object');
  }
  if (!asset.id || !asset.type || !asset.source || !asset.destination) {
    throw new Error(`Manifest asset is missing required fields: ${JSON.stringify(asset)}`);
  }
}

export function runInstall(args = {}) {
  const codexHome = resolveCodexHome(args.codexHome);
  const skillsHome = resolveSkillsHome(args.skillsHome);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const assets = Array.isArray(manifest.assets) ? manifest.assets : [];

  console.log(`Codex home:  ${codexHome}`);
  console.log(`Skills home: ${skillsHome}`);
  console.log(`Engine root: ${repoRoot}`);
  console.log(`Assets:      ${assets.length}`);

  ensureDir(codexHome, args.dryRun);
  ensureDir(path.join(codexHome, 'agents'), args.dryRun);
  ensureDir(skillsHome, args.dryRun);

  for (const asset of assets) {
    validateManifestAsset(asset);
    const src = path.join(repoRoot, normalizeRel(asset.source));
    const dst = mapDestination(asset, codexHome, skillsHome);
    if (!fs.existsSync(src)) {
      throw new Error(`Source asset missing: ${asset.source}`);
    }

    if (asset.type === 'skill') {
      syncDirectory(src, dst, args);
    } else {
      syncFile(src, dst, args);
    }
  }

  const configPath = path.join(codexHome, 'config.toml');
  const configResult = patchConfigFile(configPath, {
    dryRun: args.dryRun,
    reviewModel: args.reviewModel,
    profileName: args.profileName,
  });
  if (args.dryRun) {
    if (configResult.changed) {
      console.log(`[DRY-RUN] PATCH ${configPath}`);
    } else {
      console.log(`[SKIP]   ${configPath} (up-to-date)`);
    }
  } else if (configResult.changed) {
    console.log(`[CONFIG] ${configPath}`);
  } else {
    console.log(`[SKIP]   ${configPath} (up-to-date)`);
  }

  console.log('Done.');
}

try {
  if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    runInstall(parseArgs(process.argv.slice(2)));
  }
} catch (error) {
  console.error(error.message || String(error));
  process.exit(1);
}
