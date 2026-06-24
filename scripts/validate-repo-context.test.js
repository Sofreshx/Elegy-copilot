'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { extractClaims } = require('./lib/claim-extractor.js');
const { verifyClaims, verifyPathClaim, verifyCommandClaim, verifyLinkClaim } = require('./lib/claim-verifier.js');

// Helper: create temp directory with files
function createFixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-context-test-'));
  for (const [relPath, content] of Object.entries(files)) {
    const absPath = path.join(root, relPath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, content);
  }
  return root;
}

// ---------------------------------------------------------------------------
// Claim Extractor Tests
// ---------------------------------------------------------------------------

test('extractClaims extracts path claims from backtick-quoted file paths', () => {
  const root = createFixture({
    'test.md': 'The config is at `src/config.ts`. Also check `lib/utils.js`.\n',
  });
  try {
    const content = fs.readFileSync(path.join(root, 'test.md'), 'utf8');
    const claims = extractClaims(content, 'test.md');
    const pathClaims = claims.filter(c => c.type === 'path');
    assert.equal(pathClaims.length, 2);
    assert.equal(pathClaims[0].value, 'src/config.ts');
    assert.equal(pathClaims[1].value, 'lib/utils.js');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('extractClaims extracts command claims from backtick-quoted CLI invocations', () => {
  const root = createFixture({
    'test.md': 'Run `npm run build` first, then `cargo test`.\n',
  });
  try {
    const content = fs.readFileSync(path.join(root, 'test.md'), 'utf8');
    const claims = extractClaims(content, 'test.md');
    const cmdClaims = claims.filter(c => c.type === 'command');
    assert.equal(cmdClaims.length, 2);
    assert.equal(cmdClaims[0].value, 'npm run build');
    assert.equal(cmdClaims[1].value, 'cargo test');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('extractClaims extracts internal link claims', () => {
  const root = createFixture({
    'test.md': 'See [architecture](context/architecture.md) and [setup](./SETUP.md).\n',
  });
  try {
    const content = fs.readFileSync(path.join(root, 'test.md'), 'utf8');
    const claims = extractClaims(content, 'test.md');
    const linkClaims = claims.filter(c => c.type === 'internal_link');
    assert.equal(linkClaims.length, 2);
    assert.equal(linkClaims[0].value, 'context/architecture.md');
    assert.equal(linkClaims[1].value, './SETUP.md');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('extractClaims skips external links', () => {
  const root = createFixture({
    'test.md': 'See [docs](https://example.com) and [repo](http://github.com/x).\n',
  });
  try {
    const content = fs.readFileSync(path.join(root, 'test.md'), 'utf8');
    const claims = extractClaims(content, 'test.md');
    const linkClaims = claims.filter(c => c.type === 'internal_link');
    assert.equal(linkClaims.length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('extractClaims skips content inside fenced code blocks', () => {
  const root = createFixture({
    'test.md': [
      'Some text before the block.',
      '```',
      'This `src/hidden.ts` is in a code block.',
      '```',
      'But `src/visible.ts` is outside.',
    ].join('\n'),
  });
  try {
    const content = fs.readFileSync(path.join(root, 'test.md'), 'utf8');
    const claims = extractClaims(content, 'test.md');
    const pathClaims = claims.filter(c => c.type === 'path');
    assert.equal(pathClaims.length, 1);
    assert.equal(pathClaims[0].value, 'src/visible.ts');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('extractClaims marks negated claims when context has DO NOT', () => {
  const root = createFixture({
    'test.md': 'DO NOT use `src/deprecated.ts`. Always use `src/current.ts`.\n',
  });
  try {
    const content = fs.readFileSync(path.join(root, 'test.md'), 'utf8');
    const claims = extractClaims(content, 'test.md');
    const negated = claims.filter(c => c.negated);
    const normal = claims.filter(c => !c.negated);
    assert.equal(negated.length, 1);
    assert.equal(negated[0].value, 'src/deprecated.ts');
    assert.equal(normal.length, 1);
    assert.equal(normal[0].value, 'src/current.ts');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('extractClaims tracks markdown section context', () => {
  const root = createFixture({
    'test.md': [
      '# Section One',
      'Path: `src/one.ts`',
      '## Section Two',
      'Path: `src/two.ts`',
    ].join('\n'),
  });
  try {
    const content = fs.readFileSync(path.join(root, 'test.md'), 'utf8');
    const claims = extractClaims(content, 'test.md');
    const pathClaims = claims.filter(c => c.type === 'path');
    assert.equal(pathClaims[0].source.section, 'Section One');
    assert.equal(pathClaims[1].source.section, 'Section Two');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('extractClaims deduplicates across claim types via shared claimedValues set', () => {
  // `node test.js` has extension .js → claimed as path first.
  // Then skipped by command extractor via the shared claimedValues set.
  const root = createFixture({
    'test.md': 'Run `node test.js` to execute tests.\n',
  });
  try {
    const content = fs.readFileSync(path.join(root, 'test.md'), 'utf8');
    const claims = extractClaims(content, 'test.md');
    const pathClaims = claims.filter(c => c.type === 'path');
    const commandClaims = claims.filter(c => c.type === 'command');
    assert.equal(pathClaims.length, 1);
    assert.equal(pathClaims[0].value, 'node test.js');
    assert.equal(commandClaims.length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Claim Verifier Tests
// ---------------------------------------------------------------------------

test('verifyPathClaim returns null for existing file', () => {
  const root = createFixture({
    'src/real.ts': '// real file',
    'test.md': 'See `src/real.ts`.',
  });
  try {
    const claim = { type: 'path', value: 'src/real.ts', negated: false, source: { file: 'test.md', line: 1, section: null } };
    const issue = verifyPathClaim(claim, root);
    assert.equal(issue, null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('verifyPathClaim returns DriftIssue for missing file', () => {
  const root = createFixture({
    'test.md': 'See `src/missing.ts`.',
  });
  try {
    const claim = { type: 'path', value: 'src/missing.ts', negated: false, source: { file: 'test.md', line: 1, section: null } };
    const issue = verifyPathClaim(claim, root);
    assert.notEqual(issue, null);
    assert.equal(issue.code, 'missing_path');
    assert.equal(issue.severity, 'error');
    assert.ok(issue.message.includes('src/missing.ts'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('verifyCommandClaim returns null for existing npm script', () => {
  const root = createFixture({
    'package.json': JSON.stringify({ scripts: { test: 'node test.js', build: 'tsc' } }),
    'test.md': 'Run `npm run test`.',
  });
  try {
    const claim = { type: 'command', value: 'npm run test', negated: false, source: { file: 'test.md', line: 1, section: null } };
    const issue = verifyCommandClaim(claim, root);
    assert.equal(issue, null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('verifyCommandClaim returns DriftIssue for missing npm script', () => {
  const root = createFixture({
    'package.json': JSON.stringify({ scripts: { test: 'node test.js' } }),
    'test.md': 'Run `npm run deploy`.',
  });
  try {
    const claim = { type: 'command', value: 'npm run deploy', negated: false, source: { file: 'test.md', line: 1, section: null } };
    const issue = verifyCommandClaim(claim, root);
    assert.notEqual(issue, null);
    assert.equal(issue.code, 'stale_command');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('verifyLinkClaim returns null for existing link target', () => {
  const root = createFixture({
    'context/arch.md': '# Architecture',
    'test.md': 'See [arch](context/arch.md).',
  });
  try {
    const claim = { type: 'internal_link', value: 'context/arch.md', negated: false, source: { file: 'test.md', line: 1, section: null } };
    const issue = verifyLinkClaim(claim, root, 'test.md');
    assert.equal(issue, null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('verifyLinkClaim returns DriftIssue for missing link target', () => {
  const root = createFixture({
    'test.md': 'See [missing](context/missing.md).',
  });
  try {
    const claim = { type: 'internal_link', value: 'context/missing.md', negated: false, source: { file: 'test.md', line: 1, section: null } };
    const issue = verifyLinkClaim(claim, root, 'test.md');
    assert.notEqual(issue, null);
    assert.equal(issue.code, 'broken_internal_link');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('verifyClaims aggregates multiple issues', () => {
  const root = createFixture({
    'test.md': 'Path `src/missing.ts`, run `npm run deploy`, link to [gone](gone.md).',
    'package.json': JSON.stringify({ scripts: { test: 'node test.js' } }),
  });
  try {
    const claims = [
      { type: 'path', value: 'src/missing.ts', negated: false, source: { file: 'test.md', line: 1, section: null } },
      { type: 'command', value: 'npm run deploy', negated: false, source: { file: 'test.md', line: 1, section: null } },
      { type: 'internal_link', value: 'gone.md', negated: false, source: { file: 'test.md', line: 1, section: null } },
    ];
    const issues = verifyClaims(claims, root);
    assert.equal(issues.length, 3);
    assert.ok(issues.some(i => i.code === 'missing_path'));
    assert.ok(issues.some(i => i.code === 'stale_command'));
    assert.ok(issues.some(i => i.code === 'broken_internal_link'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
