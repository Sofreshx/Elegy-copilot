#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const CONFIG_DIR = '.copilot';
const CONFIG_FILE = 'commit-checks.json';
const SCHEMA_VERSION = 1;

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

async function readDiscovery(repoRoot) {
  const { discover } = await import('./commit-check-discover.mjs');
  return discover(repoRoot);
}

function buildConfig(discoveryResult) {
  const lanes = {};
  const foundLanes = discoveryResult.lanes;

  for (const [name, lane] of Object.entries(SHIPPED_DEFAULTS.weights)) {
    if (foundLanes[name]?.found) {
      lanes[name] = {
        enabled: true,
        commands: foundLanes[name].commands,
      };
    }
  }

  if (foundLanes.typecheck?.found) {
    lanes.typecheck = {
      enabled: true,
      commands: foundLanes.typecheck.commands,
    };
  }

  for (const [name, lane] of Object.entries(foundLanes)) {
    if (!lanes[name] && lane.found) {
      lanes[name] = {
        enabled: true,
        commands: lane.commands,
      };
    }
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    configVersion: 1,
    generated: new Date().toISOString(),
    repoLanguages: discoveryResult.languages || [],
    threshold: SHIPPED_DEFAULTS.threshold,
    weights: { ...SHIPPED_DEFAULTS.weights },
    gates: [...SHIPPED_DEFAULTS.gates],
    lanes,
  };
}

function mergeConfig(existing, discoveryResult) {
  const merged = { ...existing };

  merged.schemaVersion = SCHEMA_VERSION;
  merged.configVersion = (existing.configVersion || 0) + 1;
  merged.generated = new Date().toISOString();
  merged.repoLanguages = [...new Set([
    ...(merged.repoLanguages || []),
    ...(discoveryResult.languages || []),
  ])];

  if (!merged.threshold) merged.threshold = SHIPPED_DEFAULTS.threshold;
  if (!merged.weights) merged.weights = { ...SHIPPED_DEFAULTS.weights };
  if (!merged.gates) merged.gates = [...SHIPPED_DEFAULTS.gates];
  if (!merged.lanes) merged.lanes = {};

  const foundLanes = discoveryResult.lanes;
  for (const [name, lane] of Object.entries(foundLanes)) {
    if (lane.found) {
      if (!merged.lanes[name]) {
        merged.lanes[name] = {
          enabled: true,
          commands: lane.commands,
        };
      } else if (!merged.lanes[name].commands || merged.lanes[name].commands.length === 0) {
        merged.lanes[name].commands = lane.commands;
      }
    }
  }

  for (const name of Object.keys(merged.lanes)) {
    if (foundLanes[name] && !foundLanes[name].found) {
      merged.lanes[name].commands = merged.lanes[name].commands || [];
      merged.lanes[name].note = 'Lane was not detected by recent discovery; commands may be stale';
    }
  }

  return merged;
}

function addPackageJsonScript(repoRoot, config) {
  const pkgPath = path.join(repoRoot, 'package.json');
  if (!exists(pkgPath)) return false;

  const pkg = readJson(pkgPath);
  if (!pkg) return false;

  if (!pkg.scripts) pkg.scripts = {};
  if (pkg.scripts['commit-check']) {
    console.warn('[setup] npm script "commit-check" already exists in package.json (skipping)');
    return false;
  }

  const relativeConfigPath = path.relative(repoRoot, config);
  pkg.scripts['commit-check'] = `node scripts/commit-check-run.mjs --config "${relativeConfigPath}" --json`;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  console.log('[setup] Added "commit-check" npm script to package.json');
  return true;
}

export async function setup(repoRoot, options = {}) {
  if (!exists(repoRoot)) {
    throw new Error(`Repo root not found: ${repoRoot}`);
  }

  const configDir = path.join(repoRoot, CONFIG_DIR);
  if (!exists(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  const configPath = path.join(configDir, CONFIG_FILE);
  const hasExistingConfig = exists(configPath);

  const discoveryResult = await readDiscovery(repoRoot);

  let config;
  if (hasExistingConfig && !options.force) {
    const existing = readJson(configPath);
    if (existing) {
      config = mergeConfig(existing, discoveryResult);
      console.log('[setup] Merged existing config with discovered lanes');
    } else {
      console.warn('[setup] Existing config is invalid; creating fresh');
      config = buildConfig(discoveryResult);
    }
  } else {
    if (hasExistingConfig && options.force) {
      console.log('[setup] Force overwriting existing config');
    }
    config = buildConfig(discoveryResult);
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
  console.log(`[setup] Wrote config to ${configPath}`);

  if (!options.noScript) {
    addPackageJsonScript(repoRoot, configPath);
  }

  return { configPath, config };
}

function main() {
  const repoRoot = process.argv[2] || process.cwd();
  const force = process.argv.includes('--force');
  const noScript = process.argv.includes('--no-script');

  setup(repoRoot, { force, noScript })
    .then(({ configPath }) => {
      console.log(`\nCommit validation config ready: ${configPath}`);
      console.log('Run checks with: node scripts/commit-check-run.mjs --config "' + configPath + '"');
    })
    .catch((err) => die(`Setup failed: ${err.message}`));
}

if (process.argv[1]?.endsWith('commit-check-setup.mjs')) {
  main();
}
