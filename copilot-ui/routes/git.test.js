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

function registerWithMocks({ execResponses = [], body = {} } = {}) {
  const queue = [...execResponses];
  return register({
    sendJson: createSendJson(),
    readJsonBody: createReadJsonBody(body),
    childProcess: {
      execFile(command, args, options, callback) {
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
  });
}

async function run() {
  console.log('\nGit Route Tests\n');

  await test('register returns 14 route descriptors', async () => {
    const routes = registerWithMocks();
    assert.equal(routes.length, 14);
  });

  await test('GET /api/git/status returns branch, counts, and files', async () => {
    const routes = registerWithMocks({
      execResponses: [
        { stdout: ' M src/app.ts\nA  README.md\n' },
        { stdout: 'feature/test\n' },
        { stdout: '# branch.ab +2 -1\n' },
        { stdout: 'origin/feature/test\n' },
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
        { stdout: ' M src/app.ts\n' },
        { stdout: 'feature/test\n' },
        { stdout: '# branch.ab +3 -0\n' },
        { stdout: 'origin/feature/test\n' },
        { stdout: '/repo\n' },
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
  });

  await test('GET /api/git/summary normalizes HTTPS remote to browser URL', async () => {
    const routes = registerWithMocks({
      execResponses: [
        { stdout: ' M src/app.ts\n' },
        { stdout: 'main\n' },
        { stdout: '# branch.ab +1 -0\n' },
        { stdout: 'origin/main\n' },
        { stdout: '/repo\n' },
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
        { stdout: 'feature/test\n' },
        { stdout: 'pushed\n' },
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

  console.log(`\n  ${passed} tests passed\n`);
}

run().catch((err) => {
  console.error('Unexpected error:', err);
  process.exitCode = 1;
});
