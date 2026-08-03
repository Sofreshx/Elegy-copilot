'use strict';

const fs = require('fs');
const path = require('path');

// Deterministic, LLM-free command discovery for a repository root.
// Sources: README-style docs (fenced shell blocks + `$ ` lines), package.json
// scripts, and Makefile targets. Dedupe keeps the package.json variant as
// canonical; README-only commands carry source refs.

const SCHEMA_VERSION = 2;

const CATEGORY_ORDER = Object.freeze([
  { id: 'setup', label: 'Setup' },
  { id: 'dev', label: 'Start / Dev' },
  { id: 'test', label: 'Test' },
  { id: 'check', label: 'Lint / Check' },
  { id: 'build', label: 'Build' },
  { id: 'docs', label: 'Docs' },
  { id: 'other', label: 'Other' },
]);

// Same rules as routes/workspace.js: shell metacharacters must not appear in
// command or args; backslash excluded since Windows paths use \ and shell:false
// prevents interpretation.
const SHELL_META_RE = /[;&|`$(){}!<>#*\?\[\]]/;

const DOC_SOURCES = Object.freeze(['README.md', 'README', 'CONTRIBUTING.md', 'GETTING_STARTED.md']);

const SHELL_FENCES = new Set(['bash', 'sh', 'shell', 'console', 'zsh', 'ps', 'powershell']);

const NPM_LIKE = new Set(['npm', 'yarn', 'pnpm', 'bun']);

const SCRIPT_CATEGORY_TABLE = Object.freeze({
  test: 'test',
  tests: 'test',
  'test:unit': 'test',
  'test:watch': 'test',
  unit: 'test',
  spec: 'test',
  e2e: 'test',
  coverage: 'check',
  dev: 'dev',
  start: 'dev',
  'start:dev': 'dev',
  'start:prod': 'dev',
  serve: 'dev',
  watch: 'dev',
  preview: 'dev',
  storybook: 'dev',
  'storybook:dev': 'dev',
  lint: 'check',
  'lint:fix': 'check',
  typecheck: 'check',
  check: 'check',
  format: 'check',
  'format:check': 'check',
  build: 'build',
  'build:prod': 'build',
  compile: 'build',
  dist: 'build',
  docs: 'docs',
  'docs:dev': 'docs',
  'docs:build': 'docs',
  doc: 'docs',
  typedoc: 'docs',
  install: 'setup',
  setup: 'setup',
  bootstrap: 'setup',
});

const SETUP_SCRIPT_NAMES = new Set(['install', 'setup', 'bootstrap', 'deps', 'dependencies']);

const LONG_RUNNING_SCRIPTS = new Set([
  'dev', 'start', 'start:dev', 'start:prod', 'serve', 'watch',
  'preview', 'storybook', 'storybook:dev', 'docs:dev',
]);

const NPMX_TOOL_CATEGORY = Object.freeze({
  storybook: 'dev',
  serve: 'dev',
  'http-server': 'dev',
  vitest: 'test',
  jest: 'test',
  mocha: 'test',
  playwright: 'test',
  cypress: 'test',
  eslint: 'check',
  tsc: 'check',
  prettier: 'check',
  typedoc: 'docs',
  docsify: 'docs',
  docusaurus: 'docs',
});

const CARGO_VERBS = Object.freeze({
  test: 'test',
  build: 'build',
  check: 'check',
  clippy: 'check',
  fmt: 'check',
  doc: 'docs',
  run: 'dev',
});

const GO_VERBS = Object.freeze({
  test: 'test',
  build: 'build',
  vet: 'check',
  fmt: 'check',
  run: 'dev',
});

const PY_MODULE_CATEGORY = Object.freeze({
  pytest: 'test',
  unittest: 'test',
  sphinx: 'docs',
  mkdocs: 'docs',
  'http.server': 'dev',
  flask: 'dev',
  uvicorn: 'dev',
  streamlit: 'dev',
  manage: 'dev',
});

const PY_TOOL_CATEGORY = Object.freeze({
  pytest: 'test',
  uvicorn: 'dev',
  flask: 'dev',
  streamlit: 'dev',
  mkdocs: 'docs',
  sphinx: 'docs',
  manage: 'dev',
});

const RAILS_VERBS = Object.freeze({
  s: 'dev',
  server: 'dev',
  test: 'test',
  spec: 'test',
  console: 'dev',
});

const DOCKER_VERBS = Object.freeze({
  up: 'dev',
  run: 'dev',
  down: 'other',
  build: 'build',
  stop: 'other',
  logs: 'other',
});

const NOISE_COMMANDS = new Set([
  'echo', 'ls', 'dir', 'pwd', 'cat', 'less', 'more', 'head', 'tail',
  'vim', 'vi', 'nano', 'code', 'code-insiders', 'clear', 'exit',
  'history', 'which', 'where', 'type', 'tree', 'touch', 'mkdir', 'rm',
  'whoami', 'env', 'printenv', 'open', 'start', 'explorer', 'xed',
]);

const SKIP_MAKE_TARGETS = new Set(['.PHONY', 'help', '.DEFAULT', 'all', 'clean', 'distclean', 'install-strip']);

const SETUP_PRIORITY_INSTALL = 1;
const SETUP_PRIORITY_BUILD = 2;

// Deterministic within-group importance hints: server-starting (long-running)
// commands rank first, then commands whose label or args hint at a UI-facing
// surface (web app, dashboard, desktop shell). Scores are additive and kept
// small so stable-name ordering still dominates ties.
const UI_HINT_TOKENS = Object.freeze([
  'ui', 'web', 'app', 'frontend', 'dashboard', 'desktop', 'tauri', 'electron', 'gui',
]);

function commandImportance(cmd) {
  let score = 0;
  if (cmd.longRunning) score += 10;
  const hint = `${cmd.label} ${(cmd.args || []).join(' ')}`.toLowerCase();
  const tokens = new Set(hint.split(/[^a-z0-9]+/).filter(Boolean));
  if (UI_HINT_TOKENS.some((token) => tokens.has(token))) score += 5;
  return score;
}

function compareByImportance(a, b) {
  const diff = commandImportance(b) - commandImportance(a);
  if (diff !== 0) return diff;
  if (a.label === b.label) return 0;
  return a.label < b.label ? -1 : 1;
}

function validateCommandShape(command, args) {
  if (typeof command !== 'string' || command.trim().length === 0) {
    return { ok: false, error: 'command is empty' };
  }
  if (SHELL_META_RE.test(command)) {
    return { ok: false, error: 'command contains shell metacharacters' };
  }
  if (command.includes('/') || command.includes('\\')) {
    const normalized = path.normalize(command);
    if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
      return { ok: false, error: 'command path escapes repository root' };
    }
  }
  if (!Array.isArray(args)) return { ok: false, error: 'args must be an array' };
  for (const arg of args) {
    if (typeof arg !== 'string') return { ok: false, error: 'all args must be strings' };
    if (SHELL_META_RE.test(arg)) {
      return { ok: false, error: `arg contains shell metacharacters: ${arg}` };
    }
  }
  return { ok: true };
}

function classifyScriptName(name) {
  const key = String(name || '').toLowerCase();
  if (SCRIPT_CATEGORY_TABLE[key]) return SCRIPT_CATEGORY_TABLE[key];
  const base = key.split(':')[0];
  return SCRIPT_CATEGORY_TABLE[base] || 'other';
}

function isLongRunningScript(name) {
  const key = String(name || '').toLowerCase();
  if (LONG_RUNNING_SCRIPTS.has(key)) return true;
  if (key.endsWith(':watch')) return true;
  const base = key.split(':')[0];
  return LONG_RUNNING_SCRIPTS.has(base);
}

function formatCommand(command, args) {
  return [command, ...(args || [])].join(' ');
}

function dedupeKey(command, args) {
  return formatCommand(command, args);
}

function buildCommand({ id, command, args, category, longRunning, label, description, source, setupPriority }) {
  return {
    id: id || '',
    label: label || formatCommand(command, args),
    category: category || 'other',
    command,
    args,
    longRunning: Boolean(longRunning),
    description,
    source,
    setupPriority: setupPriority || null,
  };
}

function classifyTool(first, args) {
  const verb = args[0];
  if (NPM_LIKE.has(first)) {
    if (verb === 'run' || verb === 'run-script') {
      const name = args[1];
      if (!name) return { category: 'other', longRunning: false };
      const category = classifyScriptName(name);
      return { category, longRunning: isLongRunningScript(name) };
    }
    if (verb === 'install' || verb === 'ci' || verb === 'i') {
      return { category: 'setup', longRunning: false, setupPriority: SETUP_PRIORITY_INSTALL };
    }
    if (verb) {
      // yarn/pnpm/bun (and npm) can run scripts without `run`: `yarn test`.
      const category = classifyScriptName(verb);
      return { category, longRunning: isLongRunningScript(verb) };
    }
    return { category: 'other', longRunning: false };
  }
  if (first === 'npx' || first === 'pnpx') {
    const tool = (verb || '').toLowerCase();
    const category = NPMX_TOOL_CATEGORY[tool] || 'other';
    return { category, longRunning: category === 'dev' };
  }
  if (first === 'cargo') {
    const v = CARGO_VERBS[verb] || 'other';
    return {
      category: v,
      longRunning: verb === 'run',
      setupPriority: verb === 'build' ? SETUP_PRIORITY_BUILD : null,
    };
  }
  if (first === 'go') {
    const v = GO_VERBS[verb] || 'other';
    return { category: v, longRunning: verb === 'run' };
  }
  if (first === 'make' || first === 'gmake' || first === 'mingw32-make') {
    const target = verb || '';
    const key = String(target).toLowerCase();
    const category = SCRIPT_CATEGORY_TABLE[key] || 'other';
    const setupPriority = SETUP_SCRIPT_NAMES.has(key)
      ? SETUP_PRIORITY_INSTALL
      : key === 'build' ? SETUP_PRIORITY_BUILD : null;
    return { category, longRunning: category === 'dev' || isLongRunningScript(key), setupPriority };
  }
  if (first === 'docker' && verb === 'compose') {
    const action = args[1];
    const v = DOCKER_VERBS[action] || 'other';
    return { category: v, longRunning: action === 'up' || action === 'run' };
  }
  if (first === 'docker') {
    const v = DOCKER_VERBS[verb] || 'other';
    return { category: v, longRunning: verb === 'run' };
  }
  if (first === 'python' || first === 'python3' || first === 'py') {
    if (verb === '-m') {
      const mod = (args[1] || '').toLowerCase();
      const category = PY_MODULE_CATEGORY[mod] || 'other';
      return { category, longRunning: category === 'dev' || category === 'docs' };
    }
    const script = (verb || '').toLowerCase();
    const category = script.endsWith('.py') ? PY_MODULE_CATEGORY[script.split('/').pop().replace('.py', '')] || 'other' : 'other';
    return { category, longRunning: category === 'dev' };
  }
  const pyTool = PY_TOOL_CATEGORY[first];
  if (pyTool) {
    return {
      category: pyTool,
      longRunning: pyTool === 'dev' || (pyTool === 'docs' && (verb === 'serve' || verb === 'dev')),
    };
  }
  if (first === 'rails') {
    const v = RAILS_VERBS[verb] || 'other';
    return { category: v, longRunning: verb === 's' || verb === 'server' || verb === 'console' };
  }
  if (first === 'rake') {
    const target = (verb || '').toLowerCase();
    const category = target.startsWith('db:') ? 'other' : (SCRIPT_CATEGORY_TABLE[target] || 'other');
    return { category, longRunning: false };
  }
  if (first === 'bundle' || first === 'bun') {
    if (verb === 'install') return { category: 'setup', longRunning: false, setupPriority: SETUP_PRIORITY_INSTALL };
    if (verb === 'exec') {
      const inner = args[1];
      if (inner === 'rake') {
        const target = (args[2] || '').toLowerCase();
        return { category: SCRIPT_CATEGORY_TABLE[target] || 'other', longRunning: false };
      }
      if (inner === 'rails') {
        const v = RAILS_VERBS[args[2]] || 'other';
        return { category: v, longRunning: args[2] === 's' || args[2] === 'server' };
      }
      return { category: 'other', longRunning: false };
    }
    return { category: 'other', longRunning: false };
  }
  if (first === 'pip' || first === 'pip3') {
    if (verb === 'install') return { category: 'setup', longRunning: false, setupPriority: SETUP_PRIORITY_INSTALL };
    return { category: 'other', longRunning: false };
  }
  if (first === 'uv') {
    if (verb === 'sync' || verb === 'install') {
      return { category: 'setup', longRunning: false, setupPriority: SETUP_PRIORITY_INSTALL };
    }
    return { category: 'other', longRunning: false };
  }
  if (first === 'poetry') {
    if (verb === 'install') return { category: 'setup', longRunning: false, setupPriority: SETUP_PRIORITY_INSTALL };
    return { category: 'other', longRunning: false };
  }
  if (first === 'git') {
    if (verb === 'clone') return { category: 'setup', longRunning: false, setupPriority: null, skip: true };
    return { category: 'other', longRunning: false };
  }
  return { category: 'other', longRunning: false };
}

function isNoise(command, args) {
  const lower = String(command).toLowerCase();
  if (NOISE_COMMANDS.has(lower)) return true;
  if (lower === 'cd') return true;
  if (lower === 'export') return true;
  if (lower === 'git' && args[0] === 'clone') return true;
  return false;
}

function cleanCandidateLine(raw) {
  let line = raw.trim();
  if (line.startsWith('$')) line = line.slice(1).trim();
  const hashIdx = line.search(/\s#/);
  if (hashIdx >= 0) line = line.slice(0, hashIdx).trim();
  if (line.endsWith('\\')) line = line.slice(0, -1).trim();
  return line;
}

function readDocCommands(repoPath, docName) {
  const docPath = path.join(repoPath, docName);
  if (!fs.existsSync(docPath)) return { commands: [], mtime: 0 };
  let content;
  let mtime;
  try {
    content = fs.readFileSync(docPath, 'utf8');
    mtime = fs.statSync(docPath).mtimeMs;
  } catch {
    return { commands: [], mtime: 0 };
  }
  const lines = content.split(/\r?\n/);
  let fenceLang = null;
  let skipContinuation = false;
  const rawCandidates = [];
  for (const [idx, raw] of lines.entries()) {
    const trimmed = raw.trim();
    const fence = /^```([\w-]*)/.exec(trimmed);
    if (fence) {
      if (fenceLang === null) {
        const lang = fence[1].toLowerCase();
        fenceLang = SHELL_FENCES.has(lang) ? lang : 'non-shell';
      } else {
        fenceLang = null;
      }
      continue;
    }
    if (skipContinuation) {
      if (!trimmed.endsWith('\\')) skipContinuation = false;
      continue;
    }
    if (fenceLang === 'non-shell') continue;
    const inShellFence = fenceLang !== null;
    const promptLine = /^\$\s+/.test(raw);
    if (!inShellFence && !promptLine) continue;
    const candidate = cleanCandidateLine(raw);
    if (!candidate) continue;
    if (trimmed.endsWith('\\')) skipContinuation = true;
    rawCandidates.push({ text: candidate, line: idx + 1 });
  }

  const commands = [];
  let idx = 0;
  let skipped = 0;
  for (const { text, line } of rawCandidates) {
    idx += 1;
    const tokens = text.split(/\s+/).filter((t) => t.length > 0);
    if (tokens.length === 0) continue;
    const command = tokens[0];
    const args = tokens.slice(1);
    if (isNoise(command, args)) {
      skipped += 1;
      continue;
    }
    const validation = validateCommandShape(command, args);
    if (!validation.ok) {
      skipped += 1;
      continue;
    }
    const classified = classifyTool(command.toLowerCase(), args);
    if (classified.skip) {
      skipped += 1;
      continue;
    }
    commands.push(buildCommand({
      id: `readme:${idx}`,
      command,
      args,
      category: classified.category,
      longRunning: classified.longRunning,
      description: text,
      source: { kind: 'readme', docPath: docName, line },
      setupPriority: classified.setupPriority || null,
    }));
  }
  return { commands, mtime, skipped };
}

function readPackageScripts(repoPath) {
  const pkgPath = path.join(repoPath, 'package.json');
  if (!fs.existsSync(pkgPath)) return { commands: [], mtime: 0 };
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const scripts = pkg.scripts || {};
    const commands = Object.entries(scripts)
      .slice(0, 20)
      .map(([name, body]) => buildCommand({
        id: `npm:${name}`,
        label: `npm run ${name}`,
        command: 'npm',
        args: ['run', name],
        category: classifyScriptName(name),
        longRunning: isLongRunningScript(name),
        description: typeof body === 'string' ? body : undefined,
        source: { kind: 'package.json' },
        setupPriority: SETUP_SCRIPT_NAMES.has(name.toLowerCase()) ? SETUP_PRIORITY_INSTALL : null,
      }));
    return { commands, mtime: fs.statSync(pkgPath).mtimeMs };
  } catch {
    return { commands: [], mtime: 0 };
  }
}

function readMakefile(repoPath) {
  const mkPath = path.join(repoPath, 'Makefile');
  if (!fs.existsSync(mkPath)) return { commands: [], mtime: 0 };
  let content;
  let mtime;
  try {
    content = fs.readFileSync(mkPath, 'utf8');
    mtime = fs.statSync(mkPath).mtimeMs;
  } catch {
    return { commands: [], mtime: 0 };
  }
  const seen = new Set();
  const commands = [];
  const lines = content.split(/\r?\n/);
  for (const [idx, line] of lines.entries()) {
    const m = /^([A-Za-z0-9_.\-]+)\s*:/.exec(line);
    if (!m) continue;
    const target = m[1];
    if (SKIP_MAKE_TARGETS.has(target) || seen.has(target)) continue;
    seen.add(target);
    const key = target.toLowerCase();
    const category = SCRIPT_CATEGORY_TABLE[key] || 'other';
    commands.push(buildCommand({
      id: `make:${target}`,
      label: `make ${target}`,
      command: 'make',
      args: [target],
      category,
      longRunning: category === 'dev' || isLongRunningScript(key),
      source: { kind: 'makefile', target },
      setupPriority: SETUP_SCRIPT_NAMES.has(key) ? SETUP_PRIORITY_INSTALL : null,
    }));
  }
  return { commands, mtime };
}

function collectSources(repoPath) {
  const sources = [];
  for (const docName of DOC_SOURCES) {
    const p = path.join(repoPath, docName);
    if (fs.existsSync(p)) sources.push({ path: p, mtime: fs.statSync(p).mtimeMs });
  }
  for (const name of ['package.json', 'Makefile']) {
    const p = path.join(repoPath, name);
    if (fs.existsSync(p)) sources.push({ path: p, mtime: fs.statSync(p).mtimeMs });
  }
  return sources;
}

function discover(repoRoot) {
  if (!repoRoot || !fs.existsSync(repoRoot) || !fs.statSync(repoRoot).isDirectory()) {
    return emptyDiscovery(repoRoot);
  }

  const pkg = readPackageScripts(repoRoot);
  const mk = readMakefile(repoRoot);
  const docs = DOC_SOURCES.map((name) => readDocCommands(repoRoot, name));

  // Priority order: package.json > Makefile > README docs.
  const ordered = [pkg, mk, ...docs];
  const seen = new Set();
  const commands = [];
  let skipped = 0;
  for (const batch of ordered) {
    skipped += batch.skipped || 0;
    for (const cmd of batch.commands) {
      const key = dedupeKey(cmd.command, cmd.args);
      if (seen.has(key)) continue;
      seen.add(key);
      commands.push(cmd);
    }
  }

  // Assign stable ids (source-prefixed; suffix duplicates).
  const idSeen = new Map();
  for (const cmd of commands) {
    const base = cmd.id;
    const count = idSeen.get(base) || 0;
    idSeen.set(base, count + 1);
    cmd.id = count === 0 ? base : `${base}-${count}`;
  }

  // Setup selection: lowest priority value wins, first at that priority.
  let setup = null;
  let setupPriority = Infinity;
  for (const cmd of commands) {
    if (cmd.setupPriority === null || cmd.setupPriority > setupPriority) continue;
    if (cmd.setupPriority < setupPriority || setup === null) {
      setup = cmd;
      setupPriority = cmd.setupPriority;
    }
  }
  for (const cmd of commands) {
    delete cmd.setupPriority;
  }

  const categories = CATEGORY_ORDER
    .map((group) => ({
      id: group.id,
      label: group.label,
      commands: commands
        .filter((cmd) => cmd.category === group.id)
        .sort(compareByImportance),
    }))
    .filter((group) => group.commands.length > 0);

  const sources = collectSources(repoRoot);
  return {
    schemaVersion: SCHEMA_VERSION,
    repoPath: repoRoot,
    detectedAt: new Date().toISOString(),
    sources,
    setup: setup ? { id: setup.id, label: setup.label } : null,
    categories,
    meta: { total: commands.length, skipped },
  };
}

function emptyDiscovery(repoRoot) {
  return {
    schemaVersion: SCHEMA_VERSION,
    repoPath: repoRoot || null,
    detectedAt: new Date().toISOString(),
    sources: [],
    setup: null,
    categories: [],
    meta: { total: 0, skipped: 0 },
  };
}

function isDiscoveryStale(discovery) {
  if (!discovery || !Array.isArray(discovery.sources)) return true;
  for (const source of discovery.sources) {
    try {
      const stat = fs.statSync(source.path);
      if (stat.mtimeMs !== source.mtime) return true;
    } catch {
      return true;
    }
  }
  return false;
}

module.exports = {
  SCHEMA_VERSION,
  CATEGORY_ORDER,
  SHELL_META_RE,
  discover,
  classifyScriptName,
  isLongRunningScript,
  validateCommandShape,
  isDiscoveryStale,
  formatCommand,
};
