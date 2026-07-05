#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  COMMIT_CHECK_CONFIG_SCHEMA_VERSION,
  COMMIT_CHECK_DISCOVERY_SCHEMA_VERSION,
} from './commit-check-defaults.mjs';

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

function probeToolVersion(command, versionArgs) {
  try {
    const result = spawnSync(command, versionArgs, {
      stdio: 'pipe',
      encoding: 'utf8',
      timeout: 10000,
      shell: true,
    });
    if (result.status !== 0) {
      return { found: false, version: null, major: null };
    }
    const output = (result.stdout || result.stderr || '').trim();
    // Extract semver: e.g. "node v20.11.0" → "20.11.0", "cargo 1.77.0" → "1.77.0"
    const versionMatch = output.match(/(\d+)\.(\d+)\.(\d+)/);
    if (!versionMatch) {
      return { found: true, version: output, major: null };
    }
    return {
      found: true,
      version: versionMatch[0],
      major: parseInt(versionMatch[1], 10),
    };
  } catch {
    return { found: false, version: null, major: null };
  }
}

function probeEnvironment() {
  const probes = {
    os: process.platform,
    node: probeToolVersion('node', ['--version']),
    git: probeToolVersion('git', ['--version']),
    cargo: probeToolVersion('cargo', ['--version']),
    gh: probeToolVersion('gh', ['--version']),
  };

  const unmet = [];

  if (!probes.node.found) {
    unmet.push({
      tool: 'node',
      issue: 'not-found',
      detail: 'Node.js is required to run any JavaScript checks.',
      remediation: 'Install Node.js >=18 from https://nodejs.org',
    });
  } else if (probes.node.major < 18) {
    unmet.push({
      tool: 'node',
      issue: 'version-too-old',
      detail: `Node ${probes.node.version} found, but >=18 is required.`,
      remediation: 'Upgrade Node.js to >=18 from https://nodejs.org',
    });
  }

  if (!probes.git.found) {
    unmet.push({
      tool: 'git',
      issue: 'not-found',
      detail: 'Git is required for commit-check operations.',
      remediation: 'Install Git from https://git-scm.com',
    });
  }

  if (!probes.cargo.found) {
    unmet.push({
      tool: 'cargo',
      issue: 'not-found',
      detail: 'Cargo is required for Rust lane checks.',
      remediation: 'Install Rust from https://rustup.rs',
    });
  }

  if (!probes.gh.found) {
    unmet.push({
      tool: 'gh',
      issue: 'not-found',
      detail: 'GitHub CLI is required for git pull-request checks.',
      remediation: 'Install GitHub CLI from https://cli.github.com',
    });
  }

  return { probes, unmet };
}

function collectWorkspaceDeps(repoRoot, pkg) {
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
  const workspaces = pkg.workspaces || [];

  for (const ws of workspaces) {
    const wsRoot = path.join(repoRoot, ws.replace(/\/+$/, ''));
    const wsPkgPath = path.join(wsRoot, 'package.json');
    if (!exists(wsPkgPath)) continue;
    const wsPkg = readJson(wsPkgPath);
    if (!wsPkg) continue;
    Object.assign(allDeps, wsPkg.dependencies, wsPkg.devDependencies);
  }

  return allDeps;
}

function collectWorkspacePackageRoots(repoRoot, pkg) {
  const roots = [];
  const workspaces = pkg.workspaces || [];

  for (const ws of workspaces) {
    if (typeof ws !== 'string' || ws.includes('*')) continue;
    const wsRoot = path.join(repoRoot, ws.replace(/\/+$/, ''));
    if (exists(path.join(wsRoot, 'package.json'))) {
      roots.push(wsRoot);
    }
  }

  return roots;
}

function collectTsConfigCommands(repoRoot, workspaceRoots) {
  const candidates = [
    path.join(repoRoot, 'tsconfig.json'),
    path.join(repoRoot, 'tsconfig.build.json'),
    ...workspaceRoots.flatMap(root => [
      path.join(root, 'tsconfig.json'),
      path.join(root, 'tsconfig.build.json'),
      path.join(root, 'ui', 'tsconfig.json'),
    ]),
  ];
  const seen = new Set();
  const commands = [];

  for (const candidate of candidates) {
    if (!exists(candidate)) continue;
    const relative = path.relative(repoRoot, candidate).replace(/\\/g, '/');
    if (seen.has(relative)) continue;
    seen.add(relative);
    commands.push(`npx tsc -p "${relative}" --noEmit`);
  }

  return commands;
}

function detectEmbeddedVitestConfig(repoRoot) {
  // Check for vitest config embedded in vite.config.* files
  const viteConfigPatterns = [
    'vite.config.ts', 'vite.config.js', 'vite.config.mts', 'vite.config.mjs',
  ];
  const results = [];

  // Only check repo root + known workspace dirs, not recursive
  const dirsToCheck = [repoRoot];

  // Also check workspace package roots from package.json
  const pkgJsonPath = path.join(repoRoot, 'package.json');
  if (exists(pkgJsonPath)) {
    const pkg = readJson(pkgJsonPath);
    if (pkg && pkg.workspaces) {
      for (const ws of pkg.workspaces) {
        if (typeof ws === 'string' && !ws.includes('*')) {
          dirsToCheck.push(path.join(repoRoot, ws.replace(/\/+$/, '')));
        }
      }
    }
  }

  for (const dir of dirsToCheck) {
    for (const pattern of viteConfigPatterns) {
      const configPath = path.join(dir, pattern);
      if (!exists(configPath)) continue;
      const content = fs.readFileSync(configPath, 'utf8');
      // Check if it contains a vitest test: section
      if (content.includes('test:') && (content.includes('vitest') || content.includes("'vitest'") || content.includes('"vitest"'))) {
        results.push({ path: configPath, embedded: true });
      }
    }
  }

  return results;
}

function detectTypeScriptLanes(repoRoot) {
  const lanes = {};
  const pkgJsonPath = path.join(repoRoot, 'package.json');
  if (!exists(pkgJsonPath)) {
    return { lanes, found: false };
  }

  const pkg = readJson(pkgJsonPath);
  if (!pkg) {
    return { lanes, found: false };
  }

  const scripts = pkg.scripts || {};
  const deps = collectWorkspaceDeps(repoRoot, pkg);
  const workspaceRoots = collectWorkspacePackageRoots(repoRoot, pkg);

  const hasTsConfig = exists(path.join(repoRoot, 'tsconfig.json')) ||
    exists(path.join(repoRoot, 'tsconfig.build.json'));
  const tsConfigCommands = collectTsConfigCommands(repoRoot, workspaceRoots);

  const eslintConfigs = [
    '.eslintrc', '.eslintrc.json', '.eslintrc.js', '.eslintrc.yaml', '.eslintrc.yml',
    'eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs',
  ];
  const hasEslintConfig = eslintConfigs.some(c => exists(path.join(repoRoot, c)));
  const hasEslint = deps.eslint !== undefined && (hasEslintConfig || scripts.lint);

  const prettierConfigs = [
    '.prettierrc', '.prettierrc.json', '.prettierrc.js', '.prettierrc.yaml', '.prettierrc.yml',
    '.prettierrc.toml', 'prettier.config.js',
  ];
  const hasPrettier = prettierConfigs.some(c => exists(path.join(repoRoot, c))) ||
    deps.prettier !== undefined;

  const hasVitest = deps.vitest !== undefined;
  const hasJest = deps.jest !== undefined;
  const hasTsc = deps.typescript !== undefined && (hasTsConfig || tsConfigCommands.length > 0 || scripts.typecheck || scripts['type:check'] || scripts['tsc:check']);

  if (hasVitest || hasJest) {
    const testScript = scripts.test || scripts['test:unit'] || null;
    const testFramework = hasVitest ? 'vitest' : 'jest';
    const defaultCmd = hasVitest ? 'npx vitest run' : 'npx jest';

    let commands = [];
    if (testScript && testScript !== 'echo "no tests"') {
      const scriptName = Object.entries(scripts).find(([,v]) => v === testScript)?.[0] || 'test';
      commands.push(`npm run ${scriptName}`);
    }
    if (commands.length === 0) {
      commands.push(defaultCmd);
    }

    lanes.test = { found: true, commands, framework: testFramework };

    const coverageScript = scripts['test:coverage'] || scripts.coverage || null;
    const embeddedVitestConfigs = detectEmbeddedVitestConfig(repoRoot);
    const hasEmbeddedVitest = embeddedVitestConfigs.length > 0;
    const hasCoverageConfig = (hasVitest &&
      (exists(path.join(repoRoot, 'vitest.config.ts')) ||
       exists(path.join(repoRoot, 'vitest.config.mts')) ||
       exists(path.join(repoRoot, 'vitest.config.js')))) ||
      hasEmbeddedVitest;
    const hasC8 = deps.c8 !== undefined || deps['@vitest/coverage-v8'] !== undefined;

    if (coverageScript || hasCoverageConfig || hasC8) {
      let coverageCommands = coverageScript
        ? [`npm run ${Object.entries(scripts).find(([,v]) => v === coverageScript)?.[0] || 'test:coverage'}`]
        : [hasVitest ? 'npx vitest run --coverage' : 'npx jest --coverage'];
      lanes.coverage = { found: true, commands: coverageCommands, tool: hasVitest ? 'vitest/istanbul' : 'jest/istanbul' };
    } else if (hasCoverageConfig) {
      lanes.coverage = { found: true, commands: ['npx vitest run --coverage'], tool: 'vitest/istanbul' };
    }
  }

  if (hasEslint) {
    const lintScript = scripts.lint || null;
    let commands = lintScript
      ? [`npm run ${Object.entries(scripts).find(([,v]) => v === lintScript)?.[0] || 'lint'}`]
      : ['npx eslint .'];
    lanes.lint = { found: true, commands, linter: 'eslint' };
  }

  if (hasPrettier) {
    const formatScript = scripts.format || scripts['format:check'] || null;
    let commands = formatScript
      ? [`npm run ${Object.entries(scripts).find(([,v]) => v === formatScript)?.[0] || 'format'}`]
      : ['npx prettier --check .'];
    lanes.format = { found: true, commands, formatter: 'prettier' };
  }

  if (hasTsc) {
    const typecheckScript = scripts.typecheck || scripts['type:check'] || scripts['tsc:check'] || null;
    let commands = typecheckScript
      ? [`npm run ${Object.entries(scripts).find(([,v]) => v === typecheckScript)?.[0] || 'typecheck'}`]
      : tsConfigCommands.length > 0
        ? tsConfigCommands
        : ['npx tsc --noEmit'];
    lanes.typecheck = { found: true, commands, tool: 'tsc' };
  }

  return { lanes, found: Object.keys(lanes).length > 0 };
}

function detectRustTool(toolName) {
  try {
    const r = spawnSync(`${toolName} --version`, [], {
      stdio: 'pipe',
      encoding: 'utf8',
      timeout: 5000,
      shell: true,
    });
    return r.status === 0;
  } catch {
    return false;
  }
}

function parseCargoToml(cargoTomlPath) {
  const content = fs.readFileSync(cargoTomlPath, 'utf8');
  const result = {};
  const memberMatch = content.match(/members\s*=\s*\[([^\]]+)\]/s);
  if (memberMatch) {
    result.members = memberMatch[1]
      .split(',')
      .map(m => m.trim().replace(/["'\s]/g, ''))
      .filter(Boolean);
  }
  return result;
}

function detectWorkspaceCargoTomls(repoRoot) {
  const results = [];
  // First, try to find workspace members from root Cargo.toml
  const rootCargoPath = path.join(repoRoot, 'Cargo.toml');
  const candidates = [];

  if (exists(rootCargoPath)) {
    const cargoInfo = parseCargoToml(rootCargoPath);
    if (cargoInfo.members && cargoInfo.members.length > 0) {
      for (const member of cargoInfo.members) {
        const memberPath = path.join(repoRoot, member);
        if (exists(path.join(memberPath, 'Cargo.toml'))) {
          candidates.push(path.join(memberPath, 'Cargo.toml'));
        }
      }
    }
  }

  // Also check for nested Cargo.toml files in common locations (but NOT in node_modules, target, .git)
  // Use readdirSync with manual recursion limited to depth 2
  function scanDir(dir, depth) {
    if (depth > 2) return;
    const skipNames = new Set(['node_modules', 'target', '.git', '.elegy', 'ui-dist', 'gen', 'release']);
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch { return; }
    for (const entry of entries) {
      if (skipNames.has(entry.name)) continue;
      if (entry.isDirectory()) {
        const cargoPath = path.join(dir, entry.name, 'Cargo.toml');
        if (exists(cargoPath) && !candidates.includes(cargoPath)) {
          candidates.push(cargoPath);
        }
        scanDir(path.join(dir, entry.name), depth + 1);
      }
    }
  }
  scanDir(repoRoot, 0);

  // Parse each candidate
  for (const cargoPath of candidates) {
    const rel = path.relative(repoRoot, cargoPath).replace(/\\/g, '/');
    let name = rel.replace('/Cargo.toml', '');
    try {
      const content = fs.readFileSync(cargoPath, 'utf8');
      const nameMatch = content.match(/^name\s*=\s*"([^"]+)"/m);
      if (nameMatch) name = nameMatch[1];
    } catch { /* keep path as name */ }
    results.push({ path: cargoPath, relative: rel, name });
  }

  return results;
}

function detectRustLanes(repoRoot) {
  const lanes = {};
  const cargoTomls = detectWorkspaceCargoTomls(repoRoot);

  if (cargoTomls.length === 0) {
    return { lanes, found: false };
  }

  const manifestArgs = cargoTomls
    .map(c => `--manifest-path ${c.relative}`)
    .join(' ');

  // For each cargo manifest, build commands
  const testCommands = cargoTomls.map(c => `cargo test --manifest-path ${c.relative}`);
  const checkCommands = cargoTomls.map(c => `cargo check --manifest-path ${c.relative}`);
  const clippyCommands = cargoTomls.map(c => `cargo clippy --manifest-path ${c.relative} -- -D warnings`);
  const fmtCommands = cargoTomls.map(c => `cargo fmt --manifest-path ${c.relative} -- --check`);

  lanes.test = { found: true, commands: testCommands, framework: 'cargo-test' };
  lanes.typecheck = { found: true, commands: checkCommands, tool: 'cargo-check' };
  lanes.lint = { found: true, commands: clippyCommands, linter: 'clippy' };
  lanes.format = { found: true, commands: fmtCommands, formatter: 'rustfmt' };

  const hasTarpaulin = detectRustTool('cargo-tarpaulin');
  const hasLlvmCov = detectRustTool('cargo-llvm-cov');

  if (hasLlvmCov || hasTarpaulin) {
    lanes.coverage = {
      found: true,
      commands: [hasLlvmCov ? 'cargo llvm-cov' : 'cargo tarpaulin'],
      tool: hasLlvmCov ? 'cargo-llvm-cov' : 'cargo-tarpaulin',
    };
  } else {
    lanes.coverage = {
      found: false,
      commands: [],
      tool: null,
      note: 'Rust coverage requires cargo-llvm-cov or cargo-tarpaulin. Install with: cargo install cargo-llvm-cov',
    };
  }

  return { lanes, found: true };
}

function detectExistingConfig(repoRoot) {
  const configPath = path.join(repoRoot, '.copilot', 'commit-checks.json');
  if (exists(configPath)) {
    const config = readJson(configPath);
    if (config && Number(config.schemaVersion) === COMMIT_CHECK_CONFIG_SCHEMA_VERSION) {
      return { exists: true, valid: true, path: configPath, config };
    }
    return { exists: true, valid: false, path: configPath, config: null };
  }
  return { exists: false, valid: false, path: configPath, config: null };
}

export function discover(repoRoot) {
  if (!exists(repoRoot)) {
    throw new Error(`Repo root not found: ${repoRoot}`);
  }

  const tsLanes = detectTypeScriptLanes(repoRoot);
  const rustLanes = detectRustLanes(repoRoot);
  const env = probeEnvironment();
  const existingConfig = detectExistingConfig(repoRoot);

  const allLanes = {};

  for (const [name, lane] of Object.entries(tsLanes.lanes)) {
    allLanes[name] = { ...lane, source: 'typescript' };
  }

  for (const [name, lane] of Object.entries(rustLanes.lanes)) {
    if (allLanes[name]) {
      if (lane.found) {
        allLanes[name].commands = [...allLanes[name].commands, ...lane.commands];
        allLanes[name].source = 'multi';
      }
    } else {
      allLanes[name] = { ...lane, source: 'rust' };
    }
  }

  const languages = [];
  if (tsLanes.found) languages.push('typescript');
  if (rustLanes.found) languages.push('rust');

  return {
    schemaVersion: COMMIT_CHECK_DISCOVERY_SCHEMA_VERSION,
    configSchemaVersion: COMMIT_CHECK_CONFIG_SCHEMA_VERSION,
    repoRoot,
    languages,
    environment: env.probes,
    UNMET_REQUIREMENTS: env.unmet,
    configExists: existingConfig.exists,
    configValid: existingConfig.valid,
    configPath: existingConfig.path,
    lanes: allLanes,
    summary: {
      totalLanes: Object.keys(allLanes).length,
      foundLanes: Object.values(allLanes).filter(l => l.found).length,
      languages,
    },
  };
}

function main() {
  const repoRoot = process.argv[2] || process.cwd();
  try {
    const result = discover(repoRoot);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } catch (err) {
    die(`Discovery failed: ${err.message}`);
  }
}

if (process.argv[1]?.endsWith('commit-check-discover.mjs')) {
  main();
}
