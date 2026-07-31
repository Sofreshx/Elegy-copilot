'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { readGitEvidence } = require('./gitEvidence');

const PLAN_SCHEMA_VERSION = 'check-plan/v1';
const ACTIONS = new Set(['commit', 'push', 'ci-local', 'release']);
const LOCAL_EXECUTION_POLICY = 'local-command';
const REMOTE_EXECUTION_POLICY = 'never-auto-execute';

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = canonicalize(value[key]);
      return result;
    }, {});
  }
  return value;
}

function hashValue(value) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(canonicalize(value)), 'utf8')
    .digest('hex');
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function readGitContext(repoRoot) {
  return readGitEvidence(repoRoot);
}

function workspaceDirectories(repoRoot, rootPackage) {
  const patterns = Array.isArray(rootPackage?.workspaces)
    ? rootPackage.workspaces
    : Array.isArray(rootPackage?.workspaces?.packages)
      ? rootPackage.workspaces.packages
      : [];
  const directories = [{ relativePath: '.', absolutePath: repoRoot }];

  for (const pattern of patterns) {
    if (typeof pattern !== 'string') continue;
    const normalized = pattern.replace(/\\/g, '/').replace(/^\.\//, '');
    const wildcard = normalized.indexOf('*');
    if (wildcard === -1) {
      const absolutePath = path.join(repoRoot, normalized);
      if (fs.existsSync(path.join(absolutePath, 'package.json'))) {
        directories.push({ relativePath: normalized, absolutePath });
      }
      continue;
    }
    const parent = normalized.slice(0, wildcard).replace(/\/$/, '');
    const parentPath = path.join(repoRoot, parent);
    try {
      for (const entry of fs.readdirSync(parentPath, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const relativePath = path.posix.join(parent.replace(/\\/g, '/'), entry.name);
        const absolutePath = path.join(repoRoot, relativePath);
        if (fs.existsSync(path.join(absolutePath, 'package.json'))) {
          directories.push({ relativePath, absolutePath });
        }
      }
    } catch {
      // A missing workspace root is a discovery omission, not a reason to write or fail.
    }
  }

  return directories;
}

function costFor(kind, name = '') {
  const value = `${kind}:${name}`.toLowerCase();
  if (value.includes('release') || value.includes('build') || value.includes('test') || value.includes('clippy')) return 'heavy';
  if (value.includes('type') || value.includes('lint') || value.includes('check')) return 'medium';
  return 'fast';
}

function inferredProfiles(kind, name = '') {
  const value = `${kind}:${name}`.toLowerCase();
  if (kind === 'format' || kind === 'lint' || kind === 'typecheck') return ['commit', 'push', 'ci-local'];
  if (kind === 'test') return ['push', 'ci-local'];
  if (kind === 'build' || kind === 'quality') return ['ci-local'];
  if (kind === 'hook' && value.includes('pre-commit')) return ['commit'];
  if (kind === 'hook' && value.includes('pre-push')) return ['push'];
  if (kind === 'release' || value.includes('release')) return ['release'];
  return [];
}

function candidateBase(fields) {
  return {
    classification: 'inferred',
    required: false,
    blocking: false,
    skippable: true,
    cost: 'fast',
    defaultProfiles: [],
    command: null,
    commands: [],
    cwd: '.',
    executionPolicy: LOCAL_EXECUTION_POLICY,
    ...fields,
  };
}

function packageCandidates(repoRoot, rootPackage) {
  const candidates = [];
  for (const workspace of workspaceDirectories(repoRoot, rootPackage)) {
    const packageJson = readJson(path.join(workspace.absolutePath, 'package.json'));
    const scripts = packageJson?.scripts && typeof packageJson.scripts === 'object'
      ? packageJson.scripts
      : {};
    for (const scriptName of Object.keys(scripts).sort()) {
      if (typeof scripts[scriptName] !== 'string' || !scripts[scriptName].trim()) continue;
      const relativePrefix = workspace.relativePath === '.' ? 'npm' : `npm --prefix "${workspace.relativePath}"`;
      const command = `${relativePrefix} run ${scriptName}`;
      const kind = scriptKind(scriptName);
      if (!kind) continue;
      candidates.push(candidateBase({
        id: workspace.relativePath === '.'
          ? `package.${scriptName}`
          : `package.${workspace.relativePath.replace(/[^A-Za-z0-9._-]+/g, '-')}.${scriptName}`,
        name: workspace.relativePath === '.' ? scriptName : `${workspace.relativePath} ${scriptName}`,
        description: `Package script ${command}`,
        source: 'package-script',
        provenance: 'package.json',
        command,
        commands: [command],
        cwd: workspace.relativePath,
        kind,
        classification: 'verified',
        defaultProfiles: inferredProfiles(kind, scriptName),
        cost: costFor(kind, scriptName),
        commandProvenance: {
          source: 'package.json',
          path: workspace.relativePath === '.' ? 'package.json' : `${workspace.relativePath}/package.json`,
          field: `scripts.${scriptName}`,
        },
      }));
    }
  }
  return candidates;
}

function inferredToolCandidates(repoRoot, rootPackage, packageCandidatesFound) {
  const dependencies = {
    ...(rootPackage?.dependencies && typeof rootPackage.dependencies === 'object' ? rootPackage.dependencies : {}),
    ...(rootPackage?.devDependencies && typeof rootPackage.devDependencies === 'object' ? rootPackage.devDependencies : {}),
  };
  const hasKind = (kind) => packageCandidatesFound.some((candidate) => candidate.kind === kind);
  const candidates = [];
  const addTool = ({ id, name, kind, configPaths, dependencyNames, field }) => {
    if (hasKind(kind)) return;
    const configPath = configPaths.find((relativePath) => fs.existsSync(path.join(repoRoot, relativePath)));
    const dependency = dependencyNames.find((dependencyName) => Object.prototype.hasOwnProperty.call(dependencies, dependencyName));
    if (!configPath && !dependency) return;
    const provenancePath = configPath || 'package.json';
    candidates.push(candidateBase({
      id,
      name,
      description: `${name} was inferred from ${provenancePath}, but no executable repository script was declared.`,
      source: 'tool-detection',
      provenance: provenancePath,
      kind,
      classification: 'inferred',
      executionPolicy: REMOTE_EXECUTION_POLICY,
      reason: 'Tool detected without a declared repository command; inspect or adopt an explicit script before execution.',
      defaultProfiles: inferredProfiles(kind, id),
      cost: costFor(kind, id),
      commandProvenance: {
        source: configPath ? 'tool-config' : 'package.json',
        path: provenancePath,
        field: configPath ? null : field,
      },
    }));
  };

  addTool({
    id: 'tool.typescript',
    name: 'TypeScript typecheck',
    kind: 'typecheck',
    configPaths: ['tsconfig.json', 'tsconfig.base.json'],
    dependencyNames: ['typescript'],
    field: 'devDependencies.typescript',
  });
  addTool({
    id: 'tool.eslint',
    name: 'ESLint',
    kind: 'lint',
    configPaths: ['eslint.config.js', 'eslint.config.mjs', '.eslintrc', '.eslintrc.json'],
    dependencyNames: ['eslint'],
    field: 'devDependencies.eslint',
  });
  addTool({
    id: 'tool.stylelint',
    name: 'Stylelint',
    kind: 'lint',
    configPaths: ['stylelint.config.js', 'stylelint.config.cjs', '.stylelintrc'],
    dependencyNames: ['stylelint'],
    field: 'devDependencies.stylelint',
  });
  addTool({
    id: 'tool.test-runner',
    name: 'JavaScript test runner',
    kind: 'test',
    configPaths: ['vitest.config.ts', 'vitest.config.js', 'jest.config.js', '.mocharc.json'],
    dependencyNames: ['vitest', 'jest', 'mocha', 'ava'],
    field: 'devDependencies.vitest',
  });
  return candidates;
}

function scriptKind(name) {
  const normalized = name.toLowerCase();
  if (/(^|:)test($|:)|(^|:)tests($|:)|quality:test/.test(normalized)) return 'test';
  if (/(^|:)lint($|:)|eslint|stylelint/.test(normalized)) return 'lint';
  if (/type.?check|check:types|tsc/.test(normalized)) return 'typecheck';
  if (/format|fmt/.test(normalized)) return 'format';
  if (/(^|:)build($|:)|compile/.test(normalized)) return 'build';
  if (/quality|ci/.test(normalized)) return 'quality';
  return null;
}

function cargoCandidates(repoRoot) {
  const manifestPaths = [];
  const rootManifest = path.join(repoRoot, 'Cargo.toml');
  if (fs.existsSync(rootManifest)) manifestPaths.push(rootManifest);
  for (const entry of fs.existsSync(repoRoot) ? fs.readdirSync(repoRoot, { withFileTypes: true }) : []) {
    if (!entry.isDirectory()) continue;
    const nestedManifest = path.join(repoRoot, entry.name, 'Cargo.toml');
    if (fs.existsSync(nestedManifest)) manifestPaths.push(nestedManifest);
  }
  if (manifestPaths.length === 0) return [];

  const manifest = path.relative(repoRoot, manifestPaths[0]).replace(/\\/g, '/');
  const prefix = manifest === 'Cargo.toml' ? 'cargo' : `cargo --manifest-path "${manifest}"`;
  return [
    ['fmt', `${prefix} fmt --check`, 'format'],
    ['clippy', `${prefix} clippy --workspace --all-targets --all-features -- -D warnings`, 'lint'],
    ['test', `${prefix} test --workspace`, 'test'],
  ].map(([name, command, kind]) => candidateBase({
    id: `cargo.${name}`,
    name: `Cargo ${name}`,
    description: `Rust ${name} proof discovered from ${manifest}`,
    source: 'cargo-manifest',
    provenance: manifest,
    command,
    commands: [command],
    kind,
    classification: 'verified',
    defaultProfiles: inferredProfiles(kind, name),
    cost: costFor(kind, name),
    commandProvenance: { source: 'Cargo.toml', path: manifest, field: 'workspace' },
  }));
}

function hookCandidates(repoRoot) {
  const candidates = [];
  if (fs.existsSync(path.join(repoRoot, 'lefthook.yml')) || fs.existsSync(path.join(repoRoot, 'lefthook.yaml'))) {
    candidates.push(candidateBase({
      id: 'hook.lefthook-pre-commit',
      name: 'Lefthook pre-commit',
      description: 'Repository hook lane declared by Lefthook',
      source: 'hook-config',
      provenance: 'lefthook.yml',
      command: 'lefthook run pre-commit',
      commands: ['lefthook run pre-commit'],
      kind: 'hook',
      classification: 'verified',
      defaultProfiles: ['commit'],
      cost: 'fast',
      commandProvenance: { source: 'lefthook', path: 'lefthook.yml', field: 'pre-commit' },
    }));
  }
  const legacyHooks = ['pre-commit', 'pre-push'].filter((name) => fs.existsSync(path.join(repoRoot, '.githooks', name)));
  for (const name of legacyHooks) {
    candidates.push(candidateBase({
      id: `hook:legacy-${name}`,
      name: `Legacy ${name} hook`,
      description: `Manual hook entry at .githooks/${name}`,
      source: 'legacy-hook',
      provenance: `.githooks/${name}`,
      command: null,
      commands: [],
      kind: 'hook',
      classification: 'manual',
      executionPolicy: REMOTE_EXECUTION_POLICY,
      reason: 'Legacy hook requires explicit inspection before execution.',
    }));
  }
  for (const fileName of ['Makefile', 'justfile']) {
    if (!fs.existsSync(path.join(repoRoot, fileName))) continue;
    candidates.push(candidateBase({
      id: `manual.${fileName.toLowerCase()}`,
      name: `${fileName} repository tasks`,
      description: `Manual task definitions found in ${fileName}`,
      source: 'task-file',
      provenance: fileName,
      kind: 'manual',
      classification: 'manual',
      executionPolicy: REMOTE_EXECUTION_POLICY,
      reason: 'Task files require explicit target selection before execution.',
      commandProvenance: { source: 'task-file', path: fileName },
    }));
  }
  return candidates;
}

function workflowCandidates(repoRoot) {
  const workflowsRoot = path.join(repoRoot, '.github', 'workflows');
  if (!fs.existsSync(workflowsRoot)) return [];
  const candidates = [];
  for (const entry of fs.readdirSync(workflowsRoot, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || !/\.ya?ml$/i.test(entry.name)) continue;
    const relativePath = `.github/workflows/${entry.name}`;
    const text = readText(path.join(workflowsRoot, entry.name)) || '';
    const nameMatch = text.match(/^\s*name:\s*["']?([^"'\r\n]+)["']?\s*$/m);
    const jobsIndex = text.search(/^jobs:\s*$/m);
    const jobsText = jobsIndex >= 0 ? text.slice(jobsIndex) : '';
    const jobs = [...jobsText.matchAll(/^\s{2}([A-Za-z0-9_-]+):\s*$/gm)].map((match) => match[1]);
    const jobNames = jobs.length > 0 ? jobs : [null];
    for (const job of jobNames) {
      candidates.push(candidateBase({
        id: `workflow:${entry.name}${job ? `#${job}` : ''}`,
        name: `${nameMatch ? nameMatch[1].trim() : entry.name}${job ? ` / ${job}` : ''}`,
        description: 'GitHub workflow evidence requiring a clean remote checkout or hosted toolchain',
        source: 'github-workflow',
        provenance: relativePath,
        command: null,
        commands: [],
        kind: 'remote',
        classification: 'remote-only',
        executionPolicy: REMOTE_EXECUTION_POLICY,
        remoteOnly: true,
        workflow: entry.name,
        job,
        cost: 'heavy',
        reason: 'Remote-only evidence is visible here but is never auto-executed from discovery.',
        commandProvenance: { source: 'github-workflow', path: relativePath, job },
      }));
    }
  }
  return candidates;
}

function adoptedCandidates(config) {
  const checks = config?.checks && typeof config.checks === 'object' ? config.checks : {};
  return Object.entries(checks)
    .filter(([, check]) => check && check.enabled !== false)
    .map(([id, check]) => {
      const commands = Array.isArray(check.commands) ? check.commands.filter((command) => typeof command === 'string' && command.trim()) : [];
      return candidateBase({
        id,
        name: id,
        description: check.description || `Adopted repository check ${id}`,
        source: 'elegy-config',
        command: commands.length === 1 ? commands[0] : commands.join(' && '),
        commands,
        cwd: check.cwd || '.',
        kind: check.group || 'configured',
        classification: 'verified',
        provenance: 'adopted-policy',
        required: check.required !== false,
        blocking: check.blocking !== false,
        skippable: check.skippable === true,
        defaultProfiles: Array.isArray(check.defaultProfiles) ? check.defaultProfiles : [],
        cost: check.cost || costFor(check.group || '', id),
        gateStrength: check.gateStrength || null,
        determinism: check.determinism || null,
        ciWorkflow: check.ciWorkflow || null,
        ciJob: check.ciJob || null,
        ciRequired: check.ciRequired === true,
        commandProvenance: { source: '.elegy/checks.json', path: '.elegy/checks.json', field: `checks.${id}.commands` },
      });
    });
}

function mergeCandidates(adopted, discovered) {
  const result = [];
  const seenIds = new Set();
  const seenCommands = new Set();
  for (const candidate of [...adopted, ...discovered]) {
    if (seenIds.has(candidate.id)) continue;
    const commandKey = candidate.command || (candidate.commands || []).join('\u0000');
    if (candidate.source !== 'github-workflow' && commandKey && seenCommands.has(commandKey)) continue;
    seenIds.add(candidate.id);
    if (commandKey) seenCommands.add(commandKey);
    result.push(candidate);
  }
  return result;
}

function isActionCandidate(candidate, action) {
  if (candidate.classification === 'remote-only') return false;
  if (candidate.executionPolicy !== LOCAL_EXECUTION_POLICY || !candidate.commands?.length) return false;
  if (candidate.defaultProfiles.includes(action)) return true;
  if (action === 'release') return candidate.kind === 'release' || candidate.defaultProfiles.includes('release');
  return false;
}

function isAffectedByChange(candidate, changedFiles) {
  if (!Array.isArray(changedFiles) || changedFiles.length === 0) return true;
  if (candidate.source === 'elegy-config') return true;
  const files = changedFiles.map((file) => file.replace(/\\/g, '/'));
  if (candidate.source === 'package-script' && candidate.cwd && candidate.cwd !== '.') {
    const prefix = `${candidate.cwd.replace(/\\/g, '/').replace(/\/$/, '')}/`;
    return files.some((file) => file === candidate.cwd || file.startsWith(prefix));
  }
  if (candidate.source === 'cargo-manifest') {
    return files.some((file) => /(^|\/)(Cargo\.toml|Cargo\.lock)$/.test(file) || /\.rs$/.test(file));
  }
  if (candidate.kind === 'docs') return files.some((file) => /^docs\//.test(file) || /\.mdx?$/.test(file));
  if (candidate.kind === 'governance') {
    return files.some((file) => /(^|\/)(AGENTS\.md|CLAUDE\.md|GEMINI\.md)$/.test(file) || /^(catalog-assets|engine-assets|codex-assets|opencode-assets|antigravity-assets|claude-assets)\//.test(file));
  }
  return true;
}

function expectedCost(candidates) {
  const order = { fast: 1, medium: 2, heavy: 3 };
  const tier = candidates.reduce((result, candidate) => order[candidate.cost] > order[result] ? candidate.cost : result, 'fast');
  const score = candidates.reduce((sum, candidate) => sum + (order[candidate.cost] || 1), 0);
  return { tier, score, checkCount: candidates.length };
}

function discoverCheckPlan(repoRoot, options = {}) {
  const action = ACTIONS.has(options.action) ? options.action : 'commit';
  const rootPackage = readJson(path.join(repoRoot, 'package.json')) || {};
  const configPath = path.join(repoRoot, '.elegy', 'checks.json');
  const config = readJson(configPath);
  const git = readGitContext(repoRoot);
  const discoveredPackages = packageCandidates(repoRoot, rootPackage);
  const discovered = [
    ...discoveredPackages,
    ...inferredToolCandidates(repoRoot, rootPackage, discoveredPackages),
    ...cargoCandidates(repoRoot),
    ...hookCandidates(repoRoot),
    ...workflowCandidates(repoRoot),
  ];
  const candidates = mergeCandidates(config ? adoptedCandidates(config) : [], discovered);
  const localCandidates = candidates.filter((candidate) => candidate.classification !== 'remote-only');
  for (const candidate of candidates) {
    candidate.affectedByChange = isAffectedByChange(candidate, git.changedFiles);
  }
  // `.elegy/checks.json` supplies durable policy metadata, but native package,
  // Cargo, and hook declarations remain executable candidates. An execution
  // uses an ephemeral plan snapshot; adoption only persists repository policy.
  const executableCandidates = localCandidates.filter(
    (candidate) => candidate.executionPolicy === LOCAL_EXECUTION_POLICY && candidate.commands.length > 0,
  );
  const requiredChecks = localCandidates.filter((candidate) => candidate.required === true);
  const requestedIds = Array.isArray(options.selectedIds)
    ? [...new Set(options.selectedIds.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim()))]
    : null;
  let recommendedChecks = requestedIds
    ? executableCandidates.filter((candidate) => requestedIds.includes(candidate.id))
    : executableCandidates.filter((candidate) => isActionCandidate(candidate, action) && (candidate.affectedByChange !== false || candidate.required));
  if (recommendedChecks.length === 0) recommendedChecks = requiredChecks.slice();
  const recommendedIds = new Set(recommendedChecks.map((candidate) => candidate.id));
  const omittedChecks = candidates
    .filter((candidate) => !recommendedIds.has(candidate.id))
    .map((candidate) => ({
      id: candidate.id,
      reason: candidate.classification === 'remote-only'
        ? 'remote-only evidence is not executable in the local runner'
        : candidate.executionPolicy !== LOCAL_EXECUTION_POLICY || candidate.commands.length === 0
          ? 'manual or non-executable evidence requires explicit inspection'
        : candidate.required
          ? 'required by policy but not selected by this action; run the explicit profile or inspect policy'
          : 'not selected for this action or change scope',
      classification: candidate.classification,
    }));
  const basePlan = {
    schemaVersion: PLAN_SCHEMA_VERSION,
    repoPath: repoRoot,
    action,
    generatedAt: new Date().toISOString(),
    selectionMode: options.selectionMode || (requestedIds ? 'ai-selected' : 'change-aware'),
    affectedScope: {
      branch: git.branch,
      head: git.head,
      dirtyHash: git.dirtyHash,
      clean: git.clean,
      changedFiles: git.changedFiles,
    },
    discoveryMode: config ? 'adopted-policy-plus-read-only-discovery' : 'zero-config-read-only',
    configHash: config ? hashValue(config) : null,
    candidates,
    recommendedChecks,
    requiredChecks,
    omittedChecks,
    expectedCost: expectedCost(recommendedChecks),
    selectionRationale: requestedIds
      ? `Selected the explicitly AI-requested local proof lanes after inspecting repository policy and the affected scope; unrequested required or remote-only evidence remains visible below.`
      : config
        ? `Selected the smallest deterministic local proof for the ${action} action from adopted policy, affected scope, and native repository metadata. Adoption persists metadata; it is not required to run read-only local proof.`
        : `Selected the smallest deterministic local proof inferred for the ${action} action from repository metadata and affected scope; remote workflow commands remain unexecuted.`,
    remoteEvidence: candidates.filter((candidate) => candidate.classification === 'remote-only'),
    readOnly: true,
    persistence: 'approval-gated-adoption-only',
  };
  const { generatedAt: _generatedAt, ...planIdentity } = basePlan;
  return {
    ...basePlan,
    planHash: hashValue(planIdentity),
  };
}

function timeoutForCost(cost) {
  if (cost === 'heavy') return 300000;
  if (cost === 'medium') return 120000;
  return 60000;
}

/**
 * Convert a read-only plan into an ephemeral runner config. The caller writes
 * this outside the repository and passes it to the runner explicitly; opening
 * a workspace or discovering a plan never persists repository policy.
 */
function buildExecutionConfig(plan, selectedIds, runAll = false) {
  const requested = Array.isArray(selectedIds) ? new Set(selectedIds) : null;
  const candidates = (plan?.candidates || []).filter((candidate) => (
    candidate.executionPolicy === LOCAL_EXECUTION_POLICY
    && Array.isArray(candidate.commands)
    && candidate.commands.length > 0
    && (runAll || !requested || requested.has(candidate.id))
  ));
  if (!runAll && requested && candidates.length !== requested.size) {
    const missing = [...requested].filter((id) => !candidates.some((candidate) => candidate.id === id));
    throw new Error(`Selected plan lanes are not executable: ${missing.join(', ')}`);
  }

  const checks = {};
  for (const candidate of candidates) {
    checks[candidate.id] = {
      enabled: true,
      group: candidate.kind || null,
      description: candidate.description || candidate.name || candidate.id,
      cwd: candidate.cwd || '.',
      timeoutMs: timeoutForCost(candidate.cost),
      blocking: candidate.blocking === true,
      required: candidate.required === true,
      skippable: candidate.skippable === true,
      requiresReasonOnSkip: false,
      defaultProfiles: Array.isArray(candidate.defaultProfiles) ? candidate.defaultProfiles : [],
      cost: candidate.cost || 'fast',
      opensWindow: candidate.opensWindow === true,
      ciWorkflow: candidate.ciWorkflow || null,
      ciJob: candidate.ciJob || null,
      ciRequired: candidate.ciRequired === true,
      commands: candidate.commands,
      gateStrength: candidate.gateStrength || (candidate.blocking ? 'blocking' : 'advisory'),
      determinism: candidate.determinism || 'deterministic-runnable',
      sourcePack: null,
      tags: [],
      severity: candidate.blocking ? 'error' : 'warning',
      promotionState: candidate.blocking ? 'enforced' : 'advisory',
      owner: null,
    };
  }

  const action = plan?.action || 'commit';
  return {
    schemaVersion: 2,
    configVersion: 1,
    generated: null,
    defaultProfile: action,
    profiles: {
      [action]: {
        label: action,
        description: 'Ephemeral read-only discovery plan',
        cost: plan?.expectedCost?.tier || 'medium',
        opensWindow: false,
      },
    },
    groups: {},
    ciRemoteOnly: [],
    checks,
  };
}

module.exports = {
  PLAN_SCHEMA_VERSION,
  canonicalize,
  hashValue,
  readGitContext,
  discoverCheckPlan,
  buildExecutionConfig,
};
