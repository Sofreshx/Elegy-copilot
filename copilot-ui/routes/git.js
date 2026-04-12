'use strict';

const childProcess = require('node:child_process');
const { sendJson: defaultSendJson, readJsonBody: defaultReadJsonBody } = require('./_helpers');

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function runGit(args, cwd, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    childProcess.execFile('git', args, {
      cwd,
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stdout, stderr }));
        return;
      }
      resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

function resolveRepoPath(ctx) {
  const { u } = ctx;
  const repoPath = u.searchParams.get('repoPath');
  if (!isNonEmptyString(repoPath)) {
    return null;
  }
  return repoPath.trim();
}

function handleGitStatus(ctx, deps) {
  const { res } = ctx;
  const { sendJson } = deps;
  const repoPath = resolveRepoPath(ctx);

  if (!repoPath) {
    sendJson(res, 400, { error: 'repoPath query parameter is required' });
    return;
  }

  Promise.resolve()
    .then(async () => {
      const [statusResult, branchResult] = await Promise.all([
        runGit(['status', '--porcelain=v1'], repoPath),
        runGit(['branch', '--show-current'], repoPath),
      ]);

      const files = statusResult.stdout
        .split('\n')
        .filter(line => line.trim())
        .map(line => ({
          status: line.substring(0, 2),
          path: line.substring(3),
        }));

      return {
        branch: branchResult.stdout.trim(),
        files,
        clean: files.length === 0,
      };
    })
    .then((result) => sendJson(res, 200, result))
    .catch((error) => {
      sendJson(res, 500, { error: String(error.message || error) });
    });
}

function handleGitDiff(ctx, deps) {
  const { res } = ctx;
  const { sendJson } = deps;
  const repoPath = resolveRepoPath(ctx);

  if (!repoPath) {
    sendJson(res, 400, { error: 'repoPath query parameter is required' });
    return;
  }

  const { u } = ctx;
  const staged = u.searchParams.get('staged') === 'true';

  Promise.resolve()
    .then(async () => {
      const args = staged ? ['diff', '--cached'] : ['diff'];
      const result = await runGit(args, repoPath);
      return { diff: result.stdout, staged };
    })
    .then((result) => sendJson(res, 200, result))
    .catch((error) => {
      sendJson(res, 500, { error: String(error.message || error) });
    });
}

function handleGitLog(ctx, deps) {
  const { res } = ctx;
  const { sendJson } = deps;
  const repoPath = resolveRepoPath(ctx);

  if (!repoPath) {
    sendJson(res, 400, { error: 'repoPath query parameter is required' });
    return;
  }

  Promise.resolve()
    .then(async () => {
      const result = await runGit([
        'log', '--oneline', '--no-decorate', '-20',
      ], repoPath);

      const commits = result.stdout
        .split('\n')
        .filter(line => line.trim())
        .map(line => {
          const spaceIdx = line.indexOf(' ');
          return {
            hash: spaceIdx > 0 ? line.substring(0, spaceIdx) : line,
            message: spaceIdx > 0 ? line.substring(spaceIdx + 1) : '',
          };
        });

      return { commits };
    })
    .then((result) => sendJson(res, 200, result))
    .catch((error) => {
      sendJson(res, 500, { error: String(error.message || error) });
    });
}

function handleGitStage(ctx, deps) {
  const { req, res } = ctx;
  const { sendJson, readJsonBody } = deps;

  readJsonBody(req)
    .then(async (body) => {
      const payload = body && typeof body === 'object' ? body : {};
      const repoPath = isNonEmptyString(payload.repoPath) ? payload.repoPath.trim() : '';
      const files = Array.isArray(payload.files) ? payload.files.filter(isNonEmptyString) : [];

      if (!repoPath) {
        throw Object.assign(new Error('repoPath is required'), { statusCode: 400 });
      }

      if (files.length === 0) {
        // Stage all
        await runGit(['add', '-A'], repoPath);
      } else {
        await runGit(['add', '--', ...files], repoPath);
      }

      return { staged: true };
    })
    .then((result) => sendJson(res, 200, result))
    .catch((error) => {
      const statusCode = typeof error.statusCode === 'number' ? error.statusCode : 500;
      sendJson(res, statusCode, { error: String(error.message || error) });
    });
}

function handleGitCommit(ctx, deps) {
  const { req, res } = ctx;
  const { sendJson, readJsonBody } = deps;

  readJsonBody(req)
    .then(async (body) => {
      const payload = body && typeof body === 'object' ? body : {};
      const repoPath = isNonEmptyString(payload.repoPath) ? payload.repoPath.trim() : '';
      const message = isNonEmptyString(payload.message) ? payload.message.trim() : '';

      if (!repoPath) {
        throw Object.assign(new Error('repoPath is required'), { statusCode: 400 });
      }
      if (!message) {
        throw Object.assign(new Error('message is required'), { statusCode: 400 });
      }

      const result = await runGit(['commit', '-m', message], repoPath);
      return { committed: true, output: result.stdout.trim() };
    })
    .then((result) => sendJson(res, 200, result))
    .catch((error) => {
      const statusCode = typeof error.statusCode === 'number' ? error.statusCode : 500;
      sendJson(res, statusCode, { error: String(error.message || error) });
    });
}

function handleGitUnstage(ctx, deps) {
  const { req, res } = ctx;
  const { sendJson, readJsonBody } = deps;

  readJsonBody(req)
    .then(async (body) => {
      const payload = body && typeof body === 'object' ? body : {};
      const repoPath = isNonEmptyString(payload.repoPath) ? payload.repoPath.trim() : '';
      const files = Array.isArray(payload.files) ? payload.files.filter(isNonEmptyString) : [];

      if (!repoPath) {
        throw Object.assign(new Error('repoPath is required'), { statusCode: 400 });
      }

      if (files.length === 0) {
        await runGit(['reset', 'HEAD'], repoPath);
      } else {
        await runGit(['reset', 'HEAD', '--', ...files], repoPath);
      }

      return { unstaged: true };
    })
    .then((result) => sendJson(res, 200, result))
    .catch((error) => {
      const statusCode = typeof error.statusCode === 'number' ? error.statusCode : 500;
      sendJson(res, statusCode, { error: String(error.message || error) });
    });
}

function register(context = {}) {
  const sendJson = (context.sendJson || defaultSendJson);
  const readJsonBody = (context.readJsonBody || defaultReadJsonBody);
  const deps = { sendJson, readJsonBody };

  return [
    { method: 'GET', path: '/api/git/status', handler: (ctx) => handleGitStatus(ctx, deps) },
    { method: 'GET', path: '/api/git/diff', handler: (ctx) => handleGitDiff(ctx, deps) },
    { method: 'GET', path: '/api/git/log', handler: (ctx) => handleGitLog(ctx, deps) },
    { method: 'POST', path: '/api/git/stage', handler: (ctx) => handleGitStage(ctx, deps) },
    { method: 'POST', path: '/api/git/unstage', handler: (ctx) => handleGitUnstage(ctx, deps) },
    { method: 'POST', path: '/api/git/commit', handler: (ctx) => handleGitCommit(ctx, deps) },
  ];
}

module.exports = { register };
