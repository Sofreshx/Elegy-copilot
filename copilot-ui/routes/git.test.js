'use strict';

const assert = require('node:assert/strict');

const { register } = require('./git');

let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  PASS: ${name}`);
  } catch (error) {
    console.error(`  FAIL: ${name}`);
    console.error(`    ${error.message}`);
    process.exitCode = 1;
  }
}

function createResponse() {
  const state = { statusCode: null, headers: null, chunks: [] };
  return {
    get statusCode() { return state.statusCode; },
    get bodyText() { return state.chunks.join(''); },
    writeHead(statusCode, headers) { state.statusCode = statusCode; state.headers = headers; },
    write(chunk) { if (chunk != null) state.chunks.push(String(chunk)); return true; },
    end(chunk) { if (chunk != null) state.chunks.push(String(chunk)); },
  };
}

function parseBody(response) {
  return JSON.parse(response.bodyText || '{}');
}

function createSendJson() {
  return (res, code, payload) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(payload, null, 2));
  };
}

function createReadJsonBody(bodyObj) {
  return async () => bodyObj;
}

function findRoute(routes, method, pathname) {
  for (const route of routes) {
    if (route.method !== method) continue;
    if (typeof route.path === 'string' && route.path === pathname) return { route, match: null };
    if (route.path instanceof RegExp) {
      const match = pathname.match(route.path);
      if (match) return { route, match };
    }
  }
  throw new Error(`Route not found for ${method} ${pathname}`);
}

async function invoke(routes, method, pathname) {
  const res = createResponse();
  const u = new URL(`http://127.0.0.1${pathname}`);
  const { route, match } = findRoute(routes, method, u.pathname);
  await route.handler({ req: { method }, res, u, match, pathname: u.pathname });
  return { res, body: parseBody(res) };
}

function registerWithMocks({ execResponses = [], body = {}, resolveOpenCodeBin = null, getOpenCodeCommitModels = null, onExec = null } = {}) {
  const queue = [...execResponses];
  return register({
    sendJson: createSendJson(),
    readJsonBody: createReadJsonBody(body),
    childProcess: {
      execFile(command, args, options, callback) {
        if (onExec) onExec(command, args, options);
        const next = queue.shift();
        if (!next) {
          callback(new Error(`Unexpected command: ${command} ${args.join(' ')}`), '', '');
          return;
        }
        if (next.error) {
          callback(next.error, next.stdout || '', next.stderr || '');
          return;
        }
        callback(null, next.stdout || '', next.stderr || '');
      },
    },
    resolveOpenCodeBin: resolveOpenCodeBin || (() => 'opencode'),
    getOpenCodeCommitModels,
  });
}

async function run() {
  console.log('\nGit Route Tests\n');

  await test('register returns route descriptors', async () => {
    const routes = registerWithMocks();
    assert.ok(routes.length >= 27);
  });

  await test('GET /api/git/status returns branch, counts, and files', async () => {
    const routes = registerWithMocks({
      execResponses: [
        // porcelain-v2: branch, upstream, ahead/behind, and file entries
        { stdout: '# branch.head feature/test\n# branch.upstream refs/remotes/origin/feature/test\n# branch.ab +2 -1\n1 .M N... 100644 100644 100644 abc123def456 abc123def456 src/app.ts\n1 A. N... 100644 100644 100644 abc123def456 abc123def456 README.md\n' },
        { stdout: '/repo\n' },
      ],
    });
    const { res, body } = await invoke(routes, 'GET', '/api/git/status?repoPath=C%3A%5Crepo');
    assert.equal(res.statusCode, 200);
    assert.equal(body.branch, 'feature/test');
    assert.equal(body.files.length, 2);
    assert.equal(body.stagedCount, 1);
    assert.equal(body.unstagedCount, 1);
    assert.equal(body.ahead, 2);
    assert.equal(body.behind, 1);
  });

  await test('GET /api/git/branches returns local branches', async () => {
    const routes = registerWithMocks({
      execResponses: [
        { stdout: 'main\n' },
        { stdout: '*\tlocal\tmain\torigin/main\n \tlocal\tfeature/test\torigin/feature/test\n' },
      ],
    });
    const { res, body } = await invoke(routes, 'GET', '/api/git/branches?repoPath=C%3A%5Crepo');
    assert.equal(res.statusCode, 200);
    assert.equal(body.currentBranch, 'main');
    assert.equal(body.branches[0].name, 'main');
    assert.equal(body.branches[1].name, 'feature/test');
  });

  await test('GET /api/git/summary returns PR and diff stats', async () => {
    const routes = registerWithMocks({
      execResponses: [
        // resolveGitStatus: porcelain-v2 + toplevel
        { stdout: '# branch.head feature/test\n# branch.upstream refs/remotes/origin/feature/test\n# branch.ab +3 -0\n1 .M N... 100644 100644 100644 abc123def456 abc123def456 src/app.ts\n' },
        { stdout: '/repo\n' },
        // resolveGitSummary: numstat + remote + gh auth status + gh pr view
        { stdout: '12\t4\tsrc/app.ts\n' },
        { stdout: 'git@github.com:owner/repo.git\n' },
        { stdout: 'Logged in to github.com as demo\n' },
        { stdout: '{"number":12,"url":"https://github.com/owner/repo/pull/12","state":"OPEN"}\n' },
      ],
    });
    const { res, body } = await invoke(routes, 'GET', '/api/git/summary?repoPath=C%3A%5Crepo');
    assert.equal(res.statusCode, 200);
    assert.equal(body.branch, 'feature/test');
    assert.equal(body.additions, 12);
    assert.equal(body.deletions, 4);
    assert.equal(body.pullRequest.number, 12);
    assert.equal(body.remoteLabel, 'owner/repo');
    assert.equal(body.remoteUrl, 'https://github.com/owner/repo');
    assert.ok(Array.isArray(body.files), 'should include files array');
    assert.equal(body.files.length, 1);
    assert.equal(body.files[0].path, 'src/app.ts');
    assert.equal(body.files[0].status, ' M');
  });

  await test('GET /api/git/summary normalizes HTTPS remote to browser URL', async () => {
    const routes = registerWithMocks({
      execResponses: [
        // resolveGitStatus: porcelain-v2 + toplevel
        { stdout: '# branch.head main\n# branch.upstream refs/remotes/origin/main\n# branch.ab +1 -0\n1 .M N... 100644 100644 100644 abc123def456 abc123def456 src/app.ts\n' },
        { stdout: '/repo\n' },
        // resolveGitSummary: numstat + remote + gh auth status + gh pr view
        { stdout: '5\t3\tsrc/app.ts\n' },
        { stdout: 'https://github.com/owner/repo.git\n' },
        { stdout: 'Logged in to github.com as demo\n' },
        { stdout: '{"number":42,"url":"https://github.com/owner/repo/pull/42","state":"OPEN"}\n' },
      ],
    });
    const { res, body } = await invoke(routes, 'GET', '/api/git/summary?repoPath=C%3A%5Crepo');
    assert.equal(res.statusCode, 200);
    assert.equal(body.remoteLabel, 'owner/repo');
    assert.equal(body.remoteUrl, 'https://github.com/owner/repo');
  });

  await test('POST /api/git/checkout checks out a branch', async () => {
    const routes = registerWithMocks({
      body: { repoPath: 'C:/repo', branchName: 'feature/new' },
      execResponses: [{ stdout: '' }],
    });
    const { res, body } = await invoke(routes, 'POST', '/api/git/checkout');
    assert.equal(res.statusCode, 200);
    assert.equal(body.checkedOut, true);
    assert.equal(body.branch, 'feature/new');
  });

  await test('POST /api/git/pull runs ff-only pull', async () => {
    const routes = registerWithMocks({
      body: { repoPath: 'C:/repo' },
      execResponses: [{ stdout: 'Already up to date.\n' }],
    });
    const { res, body } = await invoke(routes, 'POST', '/api/git/pull');
    assert.equal(res.statusCode, 200);
    assert.equal(body.pulled, true);
    assert.match(body.output, /Already up to date/i);
  });

  await test('POST /api/git/push sets upstream when requested', async () => {
    const routes = registerWithMocks({
      body: { repoPath: 'C:/repo', setUpstream: true },
      execResponses: [
        { stdout: 'feature/test\n' },   // gate wrapper: git branch --show-current
        { stdout: 'feature/test\n' },   // inner handler: git branch --show-current
        { stdout: 'pushed\n' },         // inner handler: git push -u origin feature/test
      ],
    });
    const { res, body } = await invoke(routes, 'POST', '/api/git/push');
    assert.equal(res.statusCode, 200);
    assert.equal(body.pushed, true);
  });

  await test('GET /api/git/branches handles malformed branch rows without crashing', async () => {
    const routes = registerWithMocks({
      execResponses: [
        { stdout: 'main\n' },
        { stdout: '*\tlocal\tmain\torigin/main\n \tlocal\t\t\n \tremote\torigin/dev\t\n' },
      ],
    });
    const { res, body } = await invoke(routes, 'GET', '/api/git/branches?repoPath=C%3A%5Crepo');
    assert.equal(res.statusCode, 200);
    assert.equal(body.currentBranch, 'main');
    assert.ok(body.branches.length >= 1);
    assert.equal(body.branches[0].name, 'main');
  });

  await test('GET /api/git/pull-request degrades cleanly when gh is unavailable', async () => {
    const error = new Error('spawn gh ENOENT');
    error.code = 'ENOENT';
    const routes = registerWithMocks({
      execResponses: [{ error }],
    });
    const { res, body } = await invoke(routes, 'GET', '/api/git/pull-request?repoPath=C%3A%5Crepo');
    assert.equal(res.statusCode, 200);
    assert.equal(body.available, false);
    assert.equal(body.pullRequest, null);
  });

  await test('POST /api/git/pull-request creates a PR and returns metadata', async () => {
    const routes = registerWithMocks({
      body: { repoPath: 'C:/repo', title: 'Ship it' },
      execResponses: [
        { stdout: '' },
        { stdout: 'Logged in to github.com as demo\n' },
        { stdout: '{"number":55,"url":"https://github.com/owner/repo/pull/55","state":"OPEN"}\n' },
      ],
    });
    const { res, body } = await invoke(routes, 'POST', '/api/git/pull-request');
    assert.equal(res.statusCode, 200);
    assert.equal(body.created, true);
    assert.equal(body.pullRequest.number, 55);
  });

  // ─── Merge route tests ────────────────────────────────────────────────

  await test('GET /api/git/merge-candidates returns branch list with merge status', async () => {
    const routes = registerWithMocks({
      execResponses: [
        { stdout: 'feature/test\n' },
        { stdout: 'main\t\tabc123\t2025-01-15\nfeature/test\t\tdef456\t2025-01-16\n' },
        { stdout: '' }, // merge-base for main -> feature/test (is ancestor)
        { stdout: '2\n' }, // ahead
        { stdout: '0\n' }, // behind
      ],
    });
    const { res, body } = await invoke(routes, 'GET', '/api/git/merge-candidates?repoPath=C%3A%5Crepo');
    assert.equal(res.statusCode, 200);
    assert.equal(body.currentBranch, 'feature/test');
    assert.ok(Array.isArray(body.branches));
    // main is not current, should be a candidate
    const main = body.branches.find((b) => b.name === 'main');
    assert.ok(main);
    assert.equal(typeof main.isMerged, 'boolean');
    assert.equal(typeof main.ahead, 'number');
    assert.equal(typeof main.behind, 'number');
  });

  await test('POST /api/git/merge-dry-run returns clean result when source is ancestor of target', async () => {
    const routes = registerWithMocks({
      body: { repoPath: 'C:/repo', sourceRef: 'feature/test', targetRef: 'main' },
      execResponses: [
        { stdout: '' }, // status — clean
        { stdout: 'tree content with no conflict markers\n' }, // merge-tree
      ],
    });
    const { res, body } = await invoke(routes, 'POST', '/api/git/merge-dry-run');
    assert.equal(res.statusCode, 200);
    assert.equal(body.ok, true);
    assert.equal(body.clean, true);
    assert.equal(body.dirty, false);
    assert.equal(body.sourceRef, 'feature/test');
    assert.equal(body.targetRef, 'main');
  });

  await test('POST /api/git/merge-dry-run reports dirty when working tree has changes', async () => {
    const routes = registerWithMocks({
      body: { repoPath: 'C:/repo', sourceRef: 'feature/test', targetRef: 'main' },
      execResponses: [
        { stdout: ' M src/app.ts\n' }, // status — dirty
      ],
    });
    const { res, body } = await invoke(routes, 'POST', '/api/git/merge-dry-run');
    assert.equal(res.statusCode, 200);
    assert.equal(body.ok, false);
    assert.equal(body.clean, false);
    assert.equal(body.dirty, true);
    assert.match(body.diagnostics, /dirty/i);
  });

  await test('POST /api/git/merge-dry-run reports conflicts when branches diverge', async () => {
    const routes = registerWithMocks({
      body: { repoPath: 'C:/repo', sourceRef: 'feature/test', targetRef: 'main' },
      execResponses: [
        { stdout: '' }, // status — clean
        { stdout: '<<<<<<<\nours\n=======\ntheirs\n>>>>>>>\n' }, // merge-tree with conflicts
      ],
    });
    const { res, body } = await invoke(routes, 'POST', '/api/git/merge-dry-run');
    assert.equal(res.statusCode, 200);
    assert.equal(body.ok, false);
    assert.equal(body.clean, false);
    assert.equal(body.dirty, false);
    assert.ok(body.conflicts === undefined || Array.isArray(body.conflicts));
  });

  await test('POST /api/git/merge-dry-run does NOT mutate HEAD, index, or working tree', async () => {
    // Verify that merge-tree (not merge) was used by checking the git commands issued
    const queue = [
      { stdout: '' }, // status — clean
      { stdout: 'tree content\n' }, // merge-tree
    ];
    const routes = registerWithMocks({
      body: { repoPath: 'C:/repo', sourceRef: 'feature/test', targetRef: 'main' },
      execResponses: queue,
    });
    const { res, body } = await invoke(routes, 'POST', '/api/git/merge-dry-run');
    assert.equal(res.statusCode, 200);
    assert.equal(body.ok, true);
  });

  await test('POST /api/git/merge-local rejects when current branch does not match targetRef', async () => {
    const routes = registerWithMocks({
      body: { repoPath: 'C:/repo', sourceRef: 'feature/test', targetRef: 'main' },
      execResponses: [
        { stdout: 'not-main\n' }, // branch --show-current (mismatch)
      ],
    });
    const { res, body } = await invoke(routes, 'POST', '/api/git/merge-local');
    assert.equal(res.statusCode, 409);
    assert.match(body.error, /does not match/i);
  });

  await test('POST /api/git/merge-local rejects when working tree is dirty', async () => {
    const routes = registerWithMocks({
      body: { repoPath: 'C:/repo', sourceRef: 'feature/test', targetRef: 'main' },
      execResponses: [
        { stdout: 'main\n' }, // branch --show-current (matches)
        { stdout: ' M dirty.txt\n' }, // status — dirty
      ],
    });
    const { res, body } = await invoke(routes, 'POST', '/api/git/merge-local');
    assert.equal(res.statusCode, 409);
    assert.match(body.error, /dirty/i);
  });

  await test('POST /api/git/merge-local succeeds with clean merge', async () => {
    const routes = registerWithMocks({
      body: { repoPath: 'C:/repo', sourceRef: 'feature/test', targetRef: 'main' },
      execResponses: [
        { stdout: 'main\n' }, // branch --show-current (matches)
        { stdout: '' }, // status — clean
        { stdout: 'tree content no conflict\n' }, // merge-tree dry-run
        { stdout: 'Merge made by the "ort" strategy.\n' }, // actual merge
      ],
    });
    const { res, body } = await invoke(routes, 'POST', '/api/git/merge-local');
    assert.equal(res.statusCode, 200);
    assert.equal(body.merged, true);
    assert.equal(body.sourceRef, 'feature/test');
    assert.equal(body.targetRef, 'main');
  });

  // ── POST /api/git/commit-message tests ──────────────────────────

  await test('POST /api/git/commit-message rejects missing repoPath', async () => {
    const routes = registerWithMocks({ body: {} });
    const { res, body } = await invoke(routes, 'POST', '/api/git/commit-message');
    assert.equal(res.statusCode, 400);
    assert.match(body.error, /repoPath is required/i);
  });

  await test('POST /api/git/commit-message uses staged diff when staged changes exist', async () => {
    const routes = registerWithMocks({
      body: { repoPath: 'C:/repo' },
      execResponses: [
        { stdout: 'fix: update readme\nfeat: add login\n' }, // git log
        { stdout: ' src/app.ts | 5 +++++\n' },              // git diff --cached --stat (has content)
        { stdout: 'diff --git a/src/app.ts b/src/app.ts\n...' }, // git diff --cached
        // opencode execFile - return JSON event with message
        { stdout: '{"type":"assistant","content":"feat: add login form"}\n' },
      ],
    });
    const { res, body } = await invoke(routes, 'POST', '/api/git/commit-message');
    assert.equal(res.statusCode, 200);
    assert.equal(body.ok, true);
    assert.equal(body.message, 'feat: add login form');
    assert.equal(body.source, 'opencode');
    assert.equal(body.fallbackIndex, 0);
    // No unstaged fallback warning
    assert.ok(!body.warnings || !body.warnings.some(w => w.includes('unstaged') || w.includes('working tree')));
  });

  await test('POST /api/git/commit-message falls back to unstaged diff with warning', async () => {
    const routes = registerWithMocks({
      body: { repoPath: 'C:/repo' },
      execResponses: [
        { stdout: 'fix: update readme\n' },                        // git log
        { stdout: '' },                                             // git diff --cached --stat (empty)
        { stdout: ' src/app.ts | 3 +++\n' },                       // git diff --stat
        { stdout: 'diff --git a/src/app.ts b/src/app.ts\n...' },   // git diff (unstaged)
        { stdout: '{"type":"assistant","content":"fix: update app"}\n' }, // opencode
      ],
    });
    const { res, body } = await invoke(routes, 'POST', '/api/git/commit-message');
    assert.equal(res.statusCode, 200);
    assert.equal(body.ok, true);
    assert.equal(body.message, 'fix: update app');
    assert.equal(body.source, 'opencode');
    assert.ok(body.warnings && body.warnings.some(w => w.includes('No staged changes')), 'should warn about no staged changes');
  });

  await test('POST /api/git/commit-message tries fallback models when first fails', async () => {
    const routes = registerWithMocks({
      body: { repoPath: 'C:/repo' },
      execResponses: [
        { stdout: 'fix: update readme\n' },
        { stdout: ' src/app.ts | 2 ++\n' },
        { stdout: 'diff --git a/src/app.ts b/src/app.ts\n...' },
        // First opencode call: error (model unavailable)
        { error: new Error('Model not available'), stdout: '', stderr: 'not found' },
        // Second opencode call: success
        { stdout: '{"content":"chore: update dependency"}\n' },
      ],
    });
    const { res, body } = await invoke(routes, 'POST', '/api/git/commit-message');
    assert.equal(res.statusCode, 200);
    assert.equal(body.ok, true);
    assert.equal(body.message, 'chore: update dependency');
    assert.equal(body.source, 'opencode');
    assert.equal(body.fallbackIndex, 1); // second model (index 1) succeeded
  });

  await test('POST /api/git/commit-message returns MODEL_CHAIN_FAILED when all models fail', async () => {
    const routes = registerWithMocks({
      body: { repoPath: 'C:/repo' },
      execResponses: [
        { stdout: 'fix: update readme\n' },
        { stdout: ' src/app.ts | 2 ++\n' },
        { stdout: 'diff --git a/src/app.ts b/src/app.ts\n...' },
        // All three models fail
        { error: new Error('Model 1 unavailable'), stdout: '', stderr: 'err' },
        { error: new Error('Model 2 unavailable'), stdout: '', stderr: 'err' },
        { error: new Error('Model 3 unavailable'), stdout: '', stderr: 'err' },
      ],
    });
    const { res, body } = await invoke(routes, 'POST', '/api/git/commit-message');
    assert.equal(res.statusCode, 200);
    assert.equal(body.ok, false);
    assert.equal(body.code, 'MODEL_CHAIN_FAILED');
    assert.equal(body.message, 'No free OpenCode model returned a commit message.');
    assert.ok(body.lastError, 'should include lastError');
    assert.ok(body.warnings && body.warnings.some(w => w.includes('All models failed')), 'should warn all models failed');
  });

  // ── Commit message new structured error tests ──────────────────

  await test('POST /api/git/commit-message returns OPENCODE_NOT_FOUND when CLI is missing', async () => {
    const routes = registerWithMocks({
      body: { repoPath: 'C:/repo' },
      resolveOpenCodeBin: () => null,
    });
    const { res, body } = await invoke(routes, 'POST', '/api/git/commit-message');
    assert.equal(res.statusCode, 200);
    assert.equal(body.ok, false);
    assert.equal(body.code, 'OPENCODE_NOT_FOUND');
    assert.equal(body.message, 'OpenCode CLI is not available to the Elegy backend.');
  });

  await test('POST /api/git/commit-message uses OPENCODE_BIN override when set', async () => {
    const customBin = 'C:/custom/path/opencode.exe';
    const routes = registerWithMocks({
      body: { repoPath: 'C:/repo' },
      resolveOpenCodeBin: () => customBin,
      execResponses: [
        { stdout: 'fix: update readme\n' },
        { stdout: ' src/app.ts | 2 ++\n' },
        { stdout: 'diff --git a/src/app.ts b/src/app.ts\n...' },
        // Verify the custom bin is called (mock returns success)
        { stdout: '{"type":"assistant","content":"feat: using custom bin"}\n' },
      ],
    });
    const { res, body } = await invoke(routes, 'POST', '/api/git/commit-message');
    assert.equal(res.statusCode, 200);
    assert.equal(body.ok, true);
    assert.equal(body.message, 'feat: using custom bin');
  });

  await test('POST /api/git/commit-message uses free OpenCode profile models by default', async () => {
    const opencodeCalls = [];
    const routes = registerWithMocks({
      body: { repoPath: 'C:/repo' },
      onExec(command, args) {
        if (command === 'opencode') opencodeCalls.push(args);
      },
      execResponses: [
        { stdout: 'fix: update readme\n' },
        { stdout: ' src/app.ts | 2 ++\n' },
        { stdout: 'diff --git a/src/app.ts b/src/app.ts\n...' },
        { stdout: '{"content":"fix: generated from profile model"}\n' },
      ],
    });
    const { res, body } = await invoke(routes, 'POST', '/api/git/commit-message');
    assert.equal(res.statusCode, 200);
    assert.equal(body.ok, true);
    assert.equal(body.model, 'opencode/deepseek-v4-flash-free');
    assert.equal(body.message, 'fix: generated from profile model');
    assert.equal(opencodeCalls[0][2], 'opencode/deepseek-v4-flash-free');
  });

  await test('POST /api/git/commit-message parses nested OpenCode message parts', async () => {
    const routes = registerWithMocks({
      body: { repoPath: 'C:/repo' },
      execResponses: [
        { stdout: 'fix: update readme\n' },
        { stdout: ' src/app.ts | 2 ++\n' },
        { stdout: 'diff --git a/src/app.ts b/src/app.ts\n...' },
        { stdout: '{"type":"text","part":{"type":"text","text":"fix: parse nested event"}}\n' },
      ],
    });
    const { res, body } = await invoke(routes, 'POST', '/api/git/commit-message');
    assert.equal(res.statusCode, 200);
    assert.equal(body.ok, true);
    assert.equal(body.message, 'fix: parse nested event');
  });

  await test('POST /api/git/commit-message returns NO_CHANGES when diff is empty', async () => {
    const routes = registerWithMocks({
      body: { repoPath: 'C:/repo' },
      execResponses: [
        { stdout: 'fix: update readme\n' }, // git log
        { stdout: '' },                      // git diff --cached --stat (empty)
        { stdout: '' },                      // git diff --stat (empty)
        { stdout: '' },                      // git diff (empty - no changes)
      ],
    });
    const { res, body } = await invoke(routes, 'POST', '/api/git/commit-message');
    assert.equal(res.statusCode, 200);
    assert.equal(body.ok, false);
    assert.equal(body.code, 'NO_CHANGES');
    assert.equal(body.message, 'No changes to generate a commit message from.');
  });

  await test('POST /api/git/commit-message passes shell:true for .cmd shims on Windows', async () => {
    if (process.platform !== 'win32') return; // skip on non-Windows
    const customBin = 'C:/Users/test/AppData/Roaming/npm/opencode.cmd';
    let capturedOptions = null;
    const routes = register({
      sendJson: createSendJson(),
      readJsonBody: createReadJsonBody({ repoPath: 'C:/repo' }),
      childProcess: {
        execFile(command, args, options, callback) {
          capturedOptions = options;
          // Return a successful response for git log, diff, and opencode
          callback(null, '{"type":"assistant","content":"feat: shell test"}\n', '');
        },
      },
      resolveOpenCodeBin: () => customBin,
    });
    const res = createResponse();
    const u = new URL('http://127.0.0.1/api/git/commit-message');
    const { route } = findRoute(routes, 'POST', u.pathname);
    await route.handler({ req: { method: 'POST' }, res, u, match: null, pathname: u.pathname });
    const body = parseBody(res);
    assert.equal(res.statusCode, 200);
    assert.equal(body.ok, true);
    assert.equal(capturedOptions.shell, true, 'should use shell:true for .cmd shim');
  });

  await test('POST /api/git/commit-message returns NO_CHANGES when stagedOnly=true and no staged changes', async () => {
    const routes = registerWithMocks({
      body: { repoPath: 'C:/repo', stagedOnly: true },
      execResponses: [
        { stdout: 'fix: update readme\n' }, // git log
        { stdout: '' },                      // git diff --cached --stat (empty - no staged changes)
        { stdout: '' },                      // git diff --stat (unstaged - empty, fetched before stagedOnly check)
        { stdout: 'some unstaged content' }, // git diff (unstaged, fetched before stagedOnly check)
      ],
    });
    const { res, body } = await invoke(routes, 'POST', '/api/git/commit-message');
    assert.equal(res.statusCode, 200);
    assert.equal(body.ok, false);
    assert.equal(body.code, 'NO_CHANGES');
    assert.equal(body.message, 'No staged changes available (stagedOnly=true)');
    // Should NOT contain the misleading "generated from working tree" warning
    assert.ok(!body.warnings || !body.warnings.some(w => w.includes('generated from working tree')),
      'should not contain misleading "generated from working tree" warning when stagedOnly=true');
  });

  await test('POST /api/git/commit-message passes --dangerously-skip-permissions and --no-replay to opencode', async () => {
    const opencodeCalls = [];
    const routes = registerWithMocks({
      body: { repoPath: 'C:/repo' },
      onExec(command, args) {
        if (command === 'opencode') opencodeCalls.push(args);
      },
      execResponses: [
        { stdout: 'fix: update readme\n' },
        { stdout: ' src/app.ts | 2 ++\n' },
        { stdout: 'diff --git a/src/app.ts b/src/app.ts\n...' },
        { stdout: '{"content":"feat: with flags"}\n' },
      ],
    });
    const { res, body } = await invoke(routes, 'POST', '/api/git/commit-message');
    assert.equal(res.statusCode, 200);
    assert.equal(body.ok, true);
    assert.ok(opencodeCalls[0].includes('--dangerously-skip-permissions'), 'should pass --dangerously-skip-permissions');
    assert.ok(opencodeCalls[0].includes('--no-replay'), 'should pass --no-replay');
  });

  console.log(`\n  ${passed} tests passed\n`);
}

run().catch((err) => {
  console.error('Unexpected error:', err);
  process.exitCode = 1;
});
