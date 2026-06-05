'use strict';

const childProcess = require('node:child_process');
const { sendJson: defaultSendJson, readJsonBody: defaultReadJsonBody } = require('./_helpers');
const { gateGitAction } = require('../lib/gitCheckRunner');

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function runCommand(childProcessImpl, command, args, cwd, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    childProcessImpl.execFile(command, args, {
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

function runGit(childProcessImpl, args, cwd, timeoutMs = 10000) {
  return runCommand(childProcessImpl, 'git', args, cwd, timeoutMs);
}

function resolveRepoPath(ctx) {
  const { u } = ctx;
  const repoPath = u.searchParams.get('repoPath');
  if (!isNonEmptyString(repoPath)) {
    return null;
  }
  return repoPath.trim();
}

function resolveStatusCounts(files) {
  let stagedCount = 0;
  let unstagedCount = 0;
  for (const file of files) {
    const status = String(file.status || '');
    if (status[0] && status[0] !== ' ') stagedCount += 1;
    if (status[1] && status[1] !== ' ') unstagedCount += 1;
  }
  return { stagedCount, unstagedCount };
}

function parseAheadBehind(output) {
  const text = String(output || '');
  const porcelainMatch = text.match(/#\s+branch\.ab\s+\+(\d+)\s+-(\d+)/i);
  if (porcelainMatch) {
    return {
      ahead: Number(porcelainMatch[1]) || 0,
      behind: Number(porcelainMatch[2]) || 0,
    };
  }
  const aheadMatch = text.match(/ahead (\d+)/i);
  const behindMatch = text.match(/behind (\d+)/i);
  return {
    ahead: aheadMatch ? Number(aheadMatch[1]) : 0,
    behind: behindMatch ? Number(behindMatch[1]) : 0,
  };
}

function parseNumstat(output) {
  let additions = 0;
  let deletions = 0;
  for (const line of String(output || '').split('\n')) {
    const [added, removed] = line.split('\t');
    const nextAdditions = Number.parseInt(added, 10);
    const nextDeletions = Number.parseInt(removed, 10);
    if (Number.isFinite(nextAdditions)) additions += nextAdditions;
    if (Number.isFinite(nextDeletions)) deletions += nextDeletions;
  }
  return { additions, deletions };
}

function normalizeBranchName(name) {
  return typeof name === 'string' && name.trim().length > 0 ? name.trim() : '';
}

function parseBranches(output) {
  return String(output || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [marker, second, third, upstream] = line.split('\t');
      const [type, name] = second === 'local' || second === 'remote'
        ? [second, third]
        : [third, second];
      return {
        name: normalizeBranchName(name),
        current: marker === '*',
        remote: type === 'remote',
        upstream: upstream || null,
      };
    })
    .filter((branch) => branch.name.length > 0)
    .sort((left, right) => {
      if (left.current !== right.current) {
        return left.current ? -1 : 1;
      }
      if (left.remote !== right.remote) {
        return left.remote ? 1 : -1;
      }
      return left.name.localeCompare(right.name);
    });
}

async function resolvePullRequest(childProcessImpl, repoPath) {
  try {
    const authResult = await runCommand(childProcessImpl, 'gh', ['auth', 'status'], repoPath, 15000);
    if (!/Logged in/i.test(authResult.stdout) && !/Logged in/i.test(authResult.stderr)) {
      return {
        available: true,
        tool: 'gh',
        authenticated: false,
        pullRequest: null,
        error: 'GitHub CLI is not authenticated.',
      };
    }
  } catch {
    return {
      available: false,
      tool: null,
      authenticated: false,
      pullRequest: null,
      error: 'GitHub CLI is unavailable.',
    };
  }

  try {
    const result = await runCommand(childProcessImpl, 'gh', ['pr', 'view', '--json', 'number,url,state'], repoPath, 20000);
    const parsed = JSON.parse(result.stdout || '{}');
    if (!parsed || typeof parsed.number !== 'number') {
      return {
        available: true,
        tool: 'gh',
        authenticated: true,
        pullRequest: null,
        error: null,
      };
    }

    return {
      available: true,
      tool: 'gh',
      authenticated: true,
      pullRequest: {
        number: parsed.number,
        url: String(parsed.url || ''),
        state: String(parsed.state || 'OPEN'),
      },
      error: null,
    };
  } catch (error) {
    const message = String(error.stderr || error.message || error).trim();
    if (/no pull requests found/i.test(message) || /could not find any pull requests/i.test(message)) {
      return {
        available: true,
        tool: 'gh',
        authenticated: true,
        pullRequest: null,
        error: null,
      };
    }
    return {
      available: true,
      tool: 'gh',
      authenticated: true,
      pullRequest: null,
      error: message || null,
    };
  }
}

async function resolveGitStatus(childProcessImpl, repoPath) {
  const [statusResult, branchResult, aheadBehindResult, upstreamResult, topLevelResult] = await Promise.all([
    runGit(childProcessImpl, ['status', '--porcelain=v1'], repoPath),
    runGit(childProcessImpl, ['branch', '--show-current'], repoPath),
    runGit(childProcessImpl, ['status', '--branch', '--porcelain=v2'], repoPath).catch(() => ({ stdout: '', stderr: '' })),
    runGit(childProcessImpl, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], repoPath).catch(() => ({ stdout: '', stderr: '' })),
    runGit(childProcessImpl, ['rev-parse', '--show-toplevel'], repoPath).catch(() => ({ stdout: '', stderr: '' })),
  ]);

  const files = statusResult.stdout
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => ({
      status: line.substring(0, 2),
      path: line.substring(3),
    }));

  const branch = branchResult.stdout.trim() || null;
  const upstream = upstreamResult.stdout.trim() || null;
  const { ahead, behind } = parseAheadBehind(aheadBehindResult.stdout);
  const { stagedCount, unstagedCount } = resolveStatusCounts(files);

  return {
    branch,
    files,
    clean: files.length === 0,
    repoRoot: topLevelResult.stdout.trim() || null,
    stagedCount,
    unstagedCount,
    ahead,
    behind,
    upstream,
    remoteName: upstream ? upstream.split('/')[0] : null,
  };
}

async function resolveGitSummary(childProcessImpl, repoPath) {
  const status = await resolveGitStatus(childProcessImpl, repoPath);
  const [numstatResult, remoteResult, pullRequestResult] = await Promise.all([
    runGit(childProcessImpl, ['diff', '--numstat', 'HEAD'], repoPath).catch(() => ({ stdout: '', stderr: '' })),
    runGit(childProcessImpl, ['remote', 'get-url', status.remoteName || 'origin'], repoPath).catch(() => ({ stdout: '', stderr: '' })),
    resolvePullRequest(childProcessImpl, repoPath),
  ]);

  const remoteUrl = remoteResult.stdout.trim();
  const remoteLabel = remoteUrl
    ? remoteUrl.replace(/^.*github.com[:/]/i, '').replace(/\.git$/i, '')
    : null;
  const { additions, deletions } = parseNumstat(numstatResult.stdout);

  return {
    branch: status.branch,
    clean: status.clean,
    changedFiles: status.files.length,
    stagedFiles: status.stagedCount || 0,
    additions,
    deletions,
    ahead: status.ahead || 0,
    behind: status.behind || 0,
    upstream: status.upstream || null,
    remoteName: status.remoteName || null,
    remoteLabel,
    hasRemote: Boolean(status.remoteName || remoteUrl),
    pullRequest: pullRequestResult.pullRequest,
  };
}

function handleGitStatus(ctx, deps) {
  const { res } = ctx;
  const { sendJson } = deps;
  const repoPath = resolveRepoPath(ctx);

  if (!repoPath) {
    sendJson(res, 400, { error: 'repoPath query parameter is required' });
    return;
  }

  return Promise.resolve()
    .then(async () => resolveGitStatus(deps.childProcess, repoPath))
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

  return Promise.resolve()
    .then(async () => {
      const args = staged ? ['diff', '--cached'] : ['diff'];
      const result = await runGit(deps.childProcess, args, repoPath);
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

  return Promise.resolve()
    .then(async () => {
      const result = await runGit(
        deps.childProcess,
        [
          'log', '--pretty=format:%h\t%s\t%an\t%aI', '--no-decorate', '-20',
        ],
        repoPath,
      );

      const commits = result.stdout
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => {
          const [hash, message, author, authoredAt] = line.split('\t');
          return {
            hash: hash || line,
            message: message || '',
            author: author || null,
            authoredAt: authoredAt || null,
          };
        });

      return { commits };
    })
    .then((result) => sendJson(res, 200, result))
    .catch((error) => {
      sendJson(res, 500, { error: String(error.message || error) });
    });
}

function handleGitBranches(ctx, deps) {
  const { res } = ctx;
  const { sendJson } = deps;
  const repoPath = resolveRepoPath(ctx);

  if (!repoPath) {
    sendJson(res, 400, { error: 'repoPath query parameter is required' });
    return;
  }

  return Promise.resolve()
    .then(async () => {
      const currentBranch = (await runGit(deps.childProcess, ['branch', '--show-current'], repoPath)).stdout.trim() || null;
      const output = await runGit(deps.childProcess, ['for-each-ref', '--format=%(if)%(HEAD)%(then)*%(else) %(end)\t%(if)%(refname:short)%(then)%(refname:short)%(end)\t%(if)%(refname:lstrip=2)%(then)remote%(else)local%(end)\t%(upstream:short)', 'refs/heads', 'refs/remotes'], repoPath);
      return {
        currentBranch,
        branches: parseBranches(output.stdout),
      };
    })
    .then((result) => sendJson(res, 200, result))
    .catch((error) => {
      sendJson(res, 500, { error: String(error.message || error) });
    });
}

function handleGitSummary(ctx, deps) {
  const { res } = ctx;
  const { sendJson } = deps;
  const repoPath = resolveRepoPath(ctx);

  if (!repoPath) {
    sendJson(res, 400, { error: 'repoPath query parameter is required' });
    return;
  }

  return Promise.resolve()
    .then(async () => resolveGitSummary(deps.childProcess, repoPath))
    .then((result) => sendJson(res, 200, result))
    .catch((error) => {
      sendJson(res, 500, { error: String(error.message || error) });
    });
}

function handleGitStage(ctx, deps) {
  const { req, res } = ctx;
  const { sendJson, readJsonBody } = deps;

  return readJsonBody(req)
    .then(async (body) => {
      const payload = body && typeof body === 'object' ? body : {};
      const repoPath = isNonEmptyString(payload.repoPath) ? payload.repoPath.trim() : '';
      const files = Array.isArray(payload.files) ? payload.files.filter(isNonEmptyString) : [];

      if (!repoPath) {
        throw Object.assign(new Error('repoPath is required'), { statusCode: 400 });
      }

      if (files.length === 0) {
        await runGit(deps.childProcess, ['add', '-A'], repoPath);
      } else {
        await runGit(deps.childProcess, ['add', '--', ...files], repoPath);
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
  return handleGitActionWithGate(ctx, deps, 'commit', async (repoPath, body) => {
    const message = isNonEmptyString(body.message) ? body.message.trim() : '';
    if (!message) {
      throw Object.assign(new Error('message is required'), { statusCode: 400 });
    }
    const result = await runGit(deps.childProcess, ['commit', '-m', message], repoPath);
    return { committed: true, output: result.stdout.trim() };
  });
}

function handleGitUnstage(ctx, deps) {
  const { req, res } = ctx;
  const { sendJson, readJsonBody } = deps;

  return readJsonBody(req)
    .then(async (body) => {
      const payload = body && typeof body === 'object' ? body : {};
      const repoPath = isNonEmptyString(payload.repoPath) ? payload.repoPath.trim() : '';
      const files = Array.isArray(payload.files) ? payload.files.filter(isNonEmptyString) : [];

      if (!repoPath) {
        throw Object.assign(new Error('repoPath is required'), { statusCode: 400 });
      }

      if (files.length === 0) {
        await runGit(deps.childProcess, ['reset', 'HEAD'], repoPath);
      } else {
        await runGit(deps.childProcess, ['reset', 'HEAD', '--', ...files], repoPath);
      }

      return { unstaged: true };
    })
    .then((result) => sendJson(res, 200, result))
    .catch((error) => {
      const statusCode = typeof error.statusCode === 'number' ? error.statusCode : 500;
      sendJson(res, statusCode, { error: String(error.message || error) });
    });
}

function handleGitCheckout(ctx, deps) {
  const { req, res } = ctx;
  const { sendJson, readJsonBody } = deps;

  return readJsonBody(req)
    .then(async (body) => {
      const payload = body && typeof body === 'object' ? body : {};
      const repoPath = isNonEmptyString(payload.repoPath) ? payload.repoPath.trim() : '';
      const branchName = isNonEmptyString(payload.branchName) ? payload.branchName.trim() : '';
      const create = payload.create === true;
      const startPoint = isNonEmptyString(payload.startPoint) ? payload.startPoint.trim() : null;

      if (!repoPath) {
        throw Object.assign(new Error('repoPath is required'), { statusCode: 400 });
      }
      if (!branchName) {
        throw Object.assign(new Error('branchName is required'), { statusCode: 400 });
      }

      const args = create
        ? ['checkout', '-b', branchName, ...(startPoint ? [startPoint] : [])]
        : ['checkout', branchName];
      await runGit(deps.childProcess, args, repoPath);
      return { checkedOut: true, branch: branchName };
    })
    .then((result) => sendJson(res, 200, result))
    .catch((error) => {
      const statusCode = typeof error.statusCode === 'number' ? error.statusCode : 500;
      sendJson(res, statusCode, { error: String(error.message || error) });
    });
}

function handleGitPull(ctx, deps) {
  const { req, res } = ctx;
  const { sendJson, readJsonBody } = deps;

  return readJsonBody(req)
    .then(async (body) => {
      const payload = body && typeof body === 'object' ? body : {};
      const repoPath = isNonEmptyString(payload.repoPath) ? payload.repoPath.trim() : '';
      if (!repoPath) {
        throw Object.assign(new Error('repoPath is required'), { statusCode: 400 });
      }
      const result = await runGit(deps.childProcess, ['pull', '--ff-only'], repoPath, 30000);
      return { pulled: true, output: `${result.stdout}${result.stderr}`.trim() };
    })
    .then((result) => sendJson(res, 200, result))
    .catch((error) => {
      const statusCode = typeof error.statusCode === 'number' ? error.statusCode : 500;
      sendJson(res, statusCode, { error: String(error.message || error) });
    });
}

function handleGitPush(ctx, deps) {
  return handleGitActionWithGate(ctx, deps, 'push', async (repoPath, body) => {
    const setUpstream = body?.setUpstream === true;
    const branch = (await runGit(deps.childProcess, ['branch', '--show-current'], repoPath)).stdout.trim();
    const args = setUpstream
      ? ['push', '-u', 'origin', branch]
      : ['push'];
    const result = await runGit(deps.childProcess, args, repoPath, 30000);
    return { pushed: true, output: `${result.stdout}${result.stderr}`.trim() };
  });
}

function handleGitAuthLogin(ctx, deps) {
  const { res } = ctx;
  const { sendJson } = deps;
  const os = require('os');

  const homeDir = os.homedir();

  return Promise.resolve()
    .then(() => runCommand(deps.childProcess, 'gh', ['auth', 'login', '--web'], homeDir, 60000))
    .then(() => runCommand(deps.childProcess, 'gh', ['auth', 'status'], homeDir, 15000))
    .then((result) => {
      const authenticated = /Logged in/i.test(result.stdout) || /Logged in/i.test(result.stderr);
      sendJson(res, 200, { authenticated });
    })
    .catch((error) => {
      const message = String(error.stderr || error.message || error).trim();
      if (/already logged in/i.test(message)) {
        return sendJson(res, 200, { authenticated: true });
      }
      sendJson(res, 500, { authenticated: false, error: message || 'GitHub login failed' });
    });
}

function handleGitPullRequest(ctx, deps) {
  const { req, res } = ctx;
  const { sendJson, readJsonBody } = deps;

  if (req.method === 'GET') {
    const repoPath = resolveRepoPath(ctx);
    if (!repoPath) {
      sendJson(res, 400, { error: 'repoPath query parameter is required' });
      return;
    }

    return Promise.resolve()
      .then(async () => resolvePullRequest(deps.childProcess, repoPath))
      .then((result) => sendJson(res, 200, result))
      .catch((error) => {
        sendJson(res, 500, { error: String(error.message || error) });
      });
  }

  return handleGitActionWithGate(ctx, deps, 'pull-request', async (repoPath, body) => {
    const args = ['pr', 'create', '--fill'];
    if (isNonEmptyString(body.title)) {
      args.push('--title', body.title.trim());
    }
    if (isNonEmptyString(body.body)) {
      args.push('--body', body.body.trim());
    }
    if (isNonEmptyString(body.base)) {
      args.push('--base', body.base.trim());
    }
    if (isNonEmptyString(body.head)) {
      args.push('--head', body.head.trim());
    }

    await runCommand(deps.childProcess, 'gh', args, repoPath, 30000);
    const prResult = await resolvePullRequest(deps.childProcess, repoPath);
    if (!prResult.pullRequest) {
      throw Object.assign(new Error('Failed to determine created pull request'), { statusCode: 502 });
    }
    return {
      created: true,
      pullRequest: prResult.pullRequest,
      output: prResult.pullRequest.url || '',
    };
  });
}

/**
 * Gate a git action through pre-action validation checks.
 * Supports unsafe override via request body { unsafeOverride: { reason: "..." } }
 */
function handleGitActionWithGate(ctx, deps, action, executeAction) {
  const { req, res } = ctx;
  const { sendJson, readJsonBody } = deps;

  return Promise.resolve()
    .then(() => readJsonBody(req))
    .then(async (body) => {
      const repoPath = String(body.repoPath || '').trim();
      if (!repoPath) {
        const error = new Error('repoPath is required');
        error.statusCode = 400;
        throw error;
      }

      // Gate through checks
      const gate = await gateGitAction(repoPath, action, body.unsafeOverride);
      
      if (!gate.allowed) {
        // Checks failed and no override — return 422 with check results
        return sendJson(res, 422, {
          error: 'Pre-action checks failed',
          checkResults: gate.checkResults,
          message: gate.message,
          requiresOverride: true,
          action,
        });
      }

      // Execute the actual git action
      const result = await executeAction(repoPath, body);

      return sendJson(res, 200, {
        ...result,
        checkResults: gate.checkResults,
        overrideApplied: gate.skipped || false,
        overrideReason: gate.overrideReason || null,
      });
    })
    .catch((error) => {
      const statusCode = typeof error.statusCode === 'number' ? error.statusCode : 500;
      sendJson(res, statusCode, {
        error: String(error.message || error),
        action,
      });
    });
}

function register(context = {}) {
  const sendJson = context.sendJson || defaultSendJson;
  const readJsonBody = context.readJsonBody || defaultReadJsonBody;
  const deps = { sendJson, readJsonBody, childProcess: context.childProcess || childProcess };

  return [
    { method: 'GET', path: '/api/git/status', handler: (ctx) => handleGitStatus(ctx, deps) },
    { method: 'GET', path: '/api/git/diff', handler: (ctx) => handleGitDiff(ctx, deps) },
    { method: 'GET', path: '/api/git/log', handler: (ctx) => handleGitLog(ctx, deps) },
    { method: 'GET', path: '/api/git/branches', handler: (ctx) => handleGitBranches(ctx, deps) },
    { method: 'GET', path: '/api/git/summary', handler: (ctx) => handleGitSummary(ctx, deps) },
    { method: 'GET', path: '/api/git/pull-request', handler: (ctx) => handleGitPullRequest(ctx, deps) },
    { method: 'POST', path: '/api/git/stage', handler: (ctx) => handleGitStage(ctx, deps) },
    { method: 'POST', path: '/api/git/unstage', handler: (ctx) => handleGitUnstage(ctx, deps) },
    { method: 'POST', path: '/api/git/commit', handler: (ctx) => handleGitCommit(ctx, deps) },
    { method: 'POST', path: '/api/git/checkout', handler: (ctx) => handleGitCheckout(ctx, deps) },
    { method: 'POST', path: '/api/git/pull', handler: (ctx) => handleGitPull(ctx, deps) },
    { method: 'POST', path: '/api/git/push', handler: (ctx) => handleGitPush(ctx, deps) },
    { method: 'POST', path: '/api/git/pull-request', handler: (ctx) => handleGitPullRequest(ctx, deps) },
    { method: 'POST', path: '/api/git/auth/login', handler: (ctx) => handleGitAuthLogin(ctx, deps) },
  ];
}

module.exports = { register };
