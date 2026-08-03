'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  discover,
  classifyScriptName,
  isLongRunningScript,
  validateCommandShape,
  isDiscoveryStale,
  formatCommand,
} = require('./commandDiscovery');

function makeRepo(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cmd-discovery-'));
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(root, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf8');
  }
  return root;
}

function categoriesById(discovery) {
  const out = {};
  for (const group of discovery.categories) out[group.id] = group.commands;
  return out;
}

const DEFAULT_PACKAGE_JSON = JSON.stringify({
  name: 'fixture',
  scripts: {
    install: 'npm ci',
    dev: 'vite',
    test: 'vitest run',
    build: 'tsc && vite build',
    lint: 'eslint .',
    docs: 'typedoc',
    'docs:dev': 'typedoc --watch',
    storybook: 'storybook dev -p 6006',
    'db:migrate': 'prisma migrate dev',
  },
}, null, 2);

const DEFAULT_README = [
  '# Fixture',
  '',
  '## Quickstart',
  '',
  '```bash',
  '$ npm install',
  '$ npm run dev',
  '```',
  '',
  '## Tests',
  '',
  '```shell',
  'npm run test',
  'cd packages && npm test',
  '```',
  '',
  '## Docs',
  '',
  '```console',
  'npm run docs:dev',
  '```',
  '',
  '> Run `make serve` for the C build.',
].join('\n');

const DEFAULT_MAKEFILE = [
  '.PHONY: help build',
  'help:',
  '\techo "usage"',
  'build:',
  '\tgo build ./...',
  'test:',
  '\tgo test ./...',
  'serve:',
  '\tgo run ./cmd/server',
].join('\n');

function buildFixture(overrides = {}) {
  return makeRepo({
    'package.json': DEFAULT_PACKAGE_JSON,
    'README.md': DEFAULT_README,
    'Makefile': DEFAULT_MAKEFILE,
    ...overrides,
  });
}

test('classifyScriptName maps known names to categories', () => {
  assert.equal(classifyScriptName('test'), 'test');
  assert.equal(classifyScriptName('TEST'), 'test');
  assert.equal(classifyScriptName('dev'), 'dev');
  assert.equal(classifyScriptName('build:prod'), 'build');
  assert.equal(classifyScriptName('docs:dev'), 'docs');
  assert.equal(classifyScriptName('install'), 'setup');
  assert.equal(classifyScriptName('db:migrate'), 'other');
  assert.equal(classifyScriptName('unknown-thing'), 'other');
});

test('isLongRunningScript flags server/watch scripts', () => {
  assert.equal(isLongRunningScript('dev'), true);
  assert.equal(isLongRunningScript('start'), true);
  assert.equal(isLongRunningScript('docs:dev'), true);
  assert.equal(isLongRunningScript('test:watch'), true);
  assert.equal(isLongRunningScript('dev:ui'), true);
  assert.equal(isLongRunningScript('start:prod'), true);
  assert.equal(isLongRunningScript('test'), false);
  assert.equal(isLongRunningScript('build'), false);
  assert.equal(isLongRunningScript('build:prod'), false);
});

test('validateCommandShape rejects shell metacharacters', () => {
  assert.equal(validateCommandShape('npm', ['run', 'dev']).ok, true);
  assert.equal(validateCommandShape('npm', ['run', 'dev && echo hi']).ok, false);
  assert.equal(validateCommandShape('ls -la | grep x', []).ok, false);
  assert.equal(validateCommandShape('../escape', []).ok, false);
  assert.equal(validateCommandShape('./scripts/dev.sh', []).ok, true);
  assert.equal(validateCommandShape('', []).ok, false);
});

test('discover groups commands in fixed order with key categories first', () => {
  const discovery = discover(buildFixture());
  const byId = categoriesById(discovery);
  const order = discovery.categories.map((g) => g.id);
  assert.deepEqual(order, ['setup', 'dev', 'test', 'check', 'build', 'docs', 'other']);
  assert.ok(byId.setup.some((c) => c.label === 'npm install'));
  assert.ok(byId.dev.some((c) => c.id === 'npm:dev'));
  assert.ok(byId.test.some((c) => c.id === 'npm:test'));
  assert.ok(byId.build.some((c) => c.id === 'npm:build'));
  assert.ok(byId.check.some((c) => c.id === 'npm:lint'));
  assert.ok(byId.docs.some((c) => c.id === 'npm:docs'));
  assert.ok(byId.other.some((c) => c.id === 'npm:db:migrate'));
});

test('within-group order ranks long-running and UI-facing commands first', () => {
  const discovery = discover(buildFixture({
    'package.json': JSON.stringify({
      name: 'fixture',
      scripts: {
        dev: 'vite',
        'dev:server': 'tsx src/server.ts',
        'dev:ui': 'vite',
        start: 'node server.js',
        build: 'vite build',
        'build:ui': 'vite build',
        test: 'vitest run',
        'test:ui': 'vitest run',
        gen: 'tsc',
        'gen:ui': 'tsc',
      },
    }, null, 2),
    'README.md': '',
    'Makefile': '',
  }));
  const byId = categoriesById(discovery);

  assert.deepEqual(
    byId.dev.map((c) => c.id),
    ['npm:dev:ui', 'npm:dev', 'npm:dev:server', 'npm:start'],
    'dev group: UI-hinting server first, then long-running scripts by stable name',
  );
  assert.deepEqual(
    byId.build.map((c) => c.id),
    ['npm:build:ui', 'npm:build'],
    'build group: UI-hinting command before plain build',
  );
  assert.deepEqual(
    byId.test.map((c) => c.id),
    ['npm:test:ui', 'npm:test'],
    'test group: UI-hinting command before plain test',
  );
  assert.deepEqual(
    byId.other.map((c) => c.id),
    ['npm:gen:ui', 'npm:gen'],
    'other group: UI-hinting command before plain gen',
  );
});

test('importance ordering keeps stable name tiebreak and does not leak to setup', () => {
  const discovery = discover(buildFixture());
  const setup = categoriesById(discovery).setup;
  assert.deepEqual(
    setup.map((c) => c.label),
    ['npm install', 'npm run install'],
    'same-score commands order by stable name; README variant precedes npm:install label',
  );
  assert.equal(discovery.setup.id, 'npm:install', 'setup selection stays priority-based');
  const dev = categoriesById(discovery).dev;
  const labels = dev.map((c) => c.label);
  assert.deepEqual(labels, [...labels].sort(), 'non-importance commands fall back to stable-name order');
});

test('package.json wins dedupe over README duplicates', () => {
  const discovery = discover(buildFixture());
  const all = discovery.categories.flatMap((g) => g.commands);

  const dev = all.filter((c) => c.command === 'npm' && c.args[1] === 'dev');
  assert.equal(dev.length, 1);
  assert.equal(dev[0].id, 'npm:dev');
  assert.equal(dev[0].source.kind, 'package.json');

  const makeCommands = all.filter((c) => c.command === 'make');
  assert.equal(makeCommands.length, 3, 'Makefile targets build, test, serve are distinct commands');
  assert.ok(makeCommands.some((c) => c.id === 'make:build'));
  assert.ok(makeCommands.some((c) => c.id === 'make:test'));
  assert.ok(makeCommands.some((c) => c.id === 'make:serve'));
});

test('README-only commands carry source refs and line numbers', () => {
  const discovery = discover(buildFixture());
  const all = discovery.categories.flatMap((g) => g.commands);
  const readmeOnly = all.find((c) => c.source.kind === 'readme');
  assert.ok(readmeOnly, 'expected at least one README-only command');
  assert.equal(readmeOnly.source.docPath, 'README.md');
  assert.equal(typeof readmeOnly.source.line, 'number');
});

test('shell-metachar candidates are skipped and counted', () => {
  const discovery = discover(buildFixture({
    'README.md': [
      '# Fixture',
      '```bash',
      'cd packages && npm test',
      'npm run dev | tee /tmp/out',
      'npm run build',
      '```',
    ].join('\n'),
  }));
  assert.equal(discovery.meta.skipped, 2);
  const build = categoriesById(discovery).build;
  assert.ok(build.some((c) => c.command === 'npm' && c.args[1] === 'build'));
});

test('setup detection yields exactly one entry with install priority', () => {
  const discovery = discover(buildFixture());
  assert.ok(discovery.setup, 'expected setup entry');
  assert.equal(discovery.setup.id, 'npm:install', 'package.json install script wins over README npm install');
  const setupGroup = categoriesById(discovery).setup;
  assert.ok(setupGroup.some((c) => c.id === 'npm:install'));
  assert.ok(setupGroup.some((c) => c.label === 'npm install'), 'README npm install kept as separate command');
});

test('cargo build / make build qualify as setup when no install command exists', () => {
  const discovery = discover(buildFixture({
    'package.json': '{}',
    'README.md': [
      '```sh',
      'cargo build',
      '```',
    ].join('\n'),
    'Makefile': [
      'serve:',
      '\tgo run ./cmd/server',
    ].join('\n'),
  }));
  assert.ok(discovery.setup, 'cargo build should qualify as setup candidate');
  assert.equal(discovery.setup.label, 'cargo build');
  const build = categoriesById(discovery).build;
  assert.ok(build.some((c) => c.command === 'cargo'), 'cargo build stays in Build category');
});

test('longRunning flags are set on dev and docs servers only', () => {
  const discovery = discover(buildFixture());
  const dev = categoriesById(discovery).dev;
  const docs = categoriesById(discovery).docs;
  const test = categoriesById(discovery).test;
  assert.ok(dev.every((c) => c.longRunning === true));
  assert.ok(docs.some((c) => c.longRunning === true));
  assert.ok(test.every((c) => c.longRunning === false));
});

test('Makefile targets are extracted and classified', () => {
  const discovery = discover(buildFixture({
    'package.json': '{}',
    'README.md': '',
  }));
  const byId = categoriesById(discovery);
  assert.ok(byId.build.some((c) => c.id === 'make:build'));
  assert.ok(byId.dev.some((c) => c.id === 'make:serve'));
  const all = discovery.categories.flatMap((g) => g.commands);
  assert.ok(!all.some((c) => c.id === 'make:help'), 'help target is skipped');
});

test('yarn-style bare script verbs classify from README', () => {
  const discovery = discover(buildFixture({
    'package.json': '{}',
    'README.md': [
      '```bash',
      'yarn test',
      'pnpm install',
      '```',
    ].join('\n'),
  }));
  const byId = categoriesById(discovery);
  assert.ok(byId.test.some((c) => c.command === 'yarn'));
  assert.equal(discovery.setup.label, 'pnpm install');
});

test('non-shell fences and noise lines are ignored', () => {
  const discovery = discover(buildFixture({
    'package.json': '{}',
    'README.md': [
      '# Fixture',
      '```js',
      'const x = 1;',
      '```',
      '```bash',
      'echo hello',
      'ls -la',
      'export FOO=bar',
      'cd',
      'npm run dev',
      '```',
    ].join('\n'),
    'Makefile': 'x = 1\nall:\n',
  }));
  assert.equal(discovery.meta.skipped, 4, 'echo, ls, export, cd are noise and counted as skipped');
  const byId = categoriesById(discovery);
  assert.ok(byId.dev.some((c) => c.command === 'npm' && c.args[1] === 'dev'));
});

test('line continuations are ignored without leaking payload lines', () => {
  const discovery = discover(buildFixture({
    'package.json': '{}',
    'README.md': [
      '```bash',
      'npm install \\',
      '  --save-dev lodash',
      'npm run dev',
      '```',
    ].join('\n'),
  }));
  const all = discovery.categories.flatMap((g) => g.commands);
  assert.ok(!all.some((c) => c.args[0] === '--save-dev'), 'continuation payload does not leak');
  const byId = categoriesById(discovery);
  assert.ok(byId.dev.some((c) => c.command === 'npm' && c.args[1] === 'dev'));
});

test('empty repo produces empty discovery', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cmd-empty-'));
  const discovery = discover(root);
  assert.equal(discovery.categories.length, 0);
  assert.equal(discovery.setup, null);
  assert.equal(discovery.meta.total, 0);
});

test('discovery staleness tracks source mtimes', () => {
  const root = buildFixture();
  const discovery = discover(root);
  assert.equal(isDiscoveryStale(discovery), false);
  const readmePath = path.join(root, 'README.md');
  fs.appendFileSync(readmePath, '\nmore docs\n', 'utf8');
  // Windows filesystems may retain coarse mtime precision; force a distinct
  // timestamp so this test checks staleness rather than clock resolution.
  const changedAt = new Date(Date.now() + 2_000);
  fs.utimesSync(readmePath, changedAt, changedAt);
  assert.equal(isDiscoveryStale(discovery), true);
  assert.equal(isDiscoveryStale(null), true);
});

test('formatCommand joins command and args', () => {
  assert.equal(formatCommand('npm', ['run', 'dev']), 'npm run dev');
});
