'use strict';

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const { sendJson: defaultSendJson } = require('./_helpers');

/**
 * Build the code review launch command for a given harness and context.
 */
function buildReviewCommand(opts) {
  const {
    harness,      // 'opencode' | 'codex'
    lane,         // for opencode: 'quick' | 'standard' | 'spec' | 'project'
    repoPath,     // repo root
    worktreePath, // worktree path or null
    prUrl,        // PR URL or null
  } = opts;

  const isWin = process.platform === 'win32';

  if (harness === 'opencode') {
    const cmd = isWin ? 'opencode' : 'opencode';
    const args = [];
    
    // Add lane selection
    if (lane && lane !== 'standard') {
      args.push('--lane', lane);
    }
    
    // Add worktree context
    if (worktreePath) {
      args.push('--cwd', worktreePath);
    }
    
    // Build the review prompt
    let prompt = 'Perform a thorough code review of the changes in this worktree.';
    if (prUrl) {
      prompt = `Review the pull request at ${prUrl}. Focus on correctness, security, and code quality.`;
    }
    args.push(prompt);
    
    return { cmd, args, cwd: worktreePath || repoPath };
  }

  if (harness === 'codex') {
    const cmd = isWin ? 'codex' : 'codex';
    const args = [];
    
    let prompt = 'Review the code changes in this worktree. Check for bugs, security issues, and adherence to project conventions.';
    if (prUrl) {
      prompt = `Review the pull request at ${prUrl}.`;
    }
    args.push(prompt);
    
    return { cmd, args, cwd: worktreePath || repoPath };
  }

  return null;
}

/**
 * GET /api/code-review/prepare
 * Query params: repoPath, worktreePath?, prUrl?
 * Returns context for code review (diff stats, changed files, branch info)
 */
function handlePrepare(ctx, deps) {
  const { res, u } = ctx;
  const { sendJson } = deps;
  const repoPath = (u.searchParams.get('repoPath') || '').trim();
  const worktreePath = (u.searchParams.get('worktreePath') || '').trim();
  const prUrl = (u.searchParams.get('prUrl') || '').trim();

  if (!repoPath) {
    sendJson(res, 400, { error: 'repoPath is required' });
    return;
  }

  // If worktree specified, check it exists
  if (worktreePath && !fs.existsSync(worktreePath)) {
    sendJson(res, 404, { error: 'Worktree path not found' });
    return;
  }

  const cwd = worktreePath || repoPath;

  try {
    // Get git diff stats
    let diffStat = '';
    let changedFiles = [];
    let branch = '';
    let baseBranch = '';

    try {
      branch = childProcess.execSync('git rev-parse --abbrev-ref HEAD', {
        cwd, encoding: 'utf8', timeout: 5000, windowsHide: true,
      }).trim();
    } catch { /* ignore */ }

    try {
      // Try to determine base branch
      const remoteShow = childProcess.execSync('git remote show origin 2>nul || git remote -v', {
        cwd, encoding: 'utf8', timeout: 5000, windowsHide: true,
      }).trim();
      // Look for HEAD branch
      const headMatch = remoteShow.match(/HEAD branch:\s*(\S+)/);
      if (headMatch) baseBranch = headMatch[1];
    } catch { /* ignore */ }

    try {
      diffStat = childProcess.execSync(
        baseBranch ? `git diff --stat ${baseBranch}...HEAD` : 'git diff --stat HEAD~1..HEAD',
        { cwd, encoding: 'utf8', timeout: 10000, windowsHide: true }
      ).trim();
    } catch {
      try {
        diffStat = childProcess.execSync('git diff --stat --cached', {
          cwd, encoding: 'utf8', timeout: 10000, windowsHide: true,
        }).trim();
      } catch { /* ignore */ }
    }

    // Get changed file list
    try {
      const fileList = childProcess.execSync(
        baseBranch ? `git diff --name-only ${baseBranch}...HEAD` : 'git diff --name-only HEAD~1..HEAD',
        { cwd, encoding: 'utf8', timeout: 10000, windowsHide: true }
      ).trim();
      changedFiles = fileList ? fileList.split('\n').filter(Boolean) : [];
    } catch {
      try {
        const fileList = childProcess.execSync('git diff --name-only --cached', {
          cwd, encoding: 'utf8', timeout: 10000, windowsHide: true,
        }).trim();
        changedFiles = fileList ? fileList.split('\n').filter(Boolean) : [];
      } catch { /* ignore */ }
    }

    sendJson(res, 200, {
      repoPath,
      worktreePath: worktreePath || null,
      branch,
      baseBranch: baseBranch || null,
      diffStat: diffStat || null,
      changedFiles,
      changedFileCount: changedFiles.length,
      prUrl: prUrl || null,
    });
  } catch (error) {
    sendJson(res, 500, { error: String(error.message || error) });
  }
}

/**
 * POST /api/code-review/launch
 * Body: { harness, lane?, repoPath, worktreePath?, prUrl? }
 * Launches the review CLI
 */
function handleLaunch(ctx, deps) {
  const { res } = ctx;
  const { sendJson, readJsonBody } = deps;

  readJsonBody(ctx.req).then((body) => {
    const harness = (body.harness || 'opencode').trim().toLowerCase();
    const lane = (body.lane || '').trim().toLowerCase() || null;
    const repoPath = (body.repoPath || '').trim();
    const worktreePath = (body.worktreePath || '').trim() || null;
    const prUrl = (body.prUrl || '').trim() || null;

    if (!repoPath) {
      sendJson(res, 400, { error: 'repoPath is required' });
      return;
    }

    if (!['opencode', 'codex'].includes(harness)) {
      sendJson(res, 400, { error: 'harness must be opencode or codex' });
      return;
    }

    const command = buildReviewCommand({ harness, lane, repoPath, worktreePath, prUrl });
    if (!command) {
      sendJson(res, 400, { error: 'Unsupported harness' });
      return;
    }

    try {
      // Check that the CLI exists
      try {
        const whichCmd = process.platform === 'win32' ? 'where' : 'command -v';
        childProcess.execSync(`${whichCmd} ${command.cmd}`, {
          timeout: 5000, windowsHide: true,
        });
      } catch {
        sendJson(res, 404, {
          error: `${harness} CLI not found. Please install ${harness} first.`,
          command: command.cmd,
        });
        return;
      }

      // Launch the review
      const child = childProcess.spawn(command.cmd, command.args, {
        cwd: command.cwd,
        detached: true,
        stdio: 'ignore',
        shell: false,
        windowsHide: false,
      });
      child.unref();

      sendJson(res, 200, {
        ok: true,
        harness,
        lane: lane || 'default',
        repoPath,
        worktreePath,
        prUrl,
        command: `${command.cmd} ${command.args.join(' ')}`,
        pid: child.pid,
        message: `Code review launched with ${harness}${lane ? ` (${lane} lane)` : ''}. The ${harness} window should open shortly.`,
      });
    } catch (error) {
      sendJson(res, 500, { error: String(error.message || error) });
    }
  }).catch((err) => {
    sendJson(res, 400, { error: String(err.message || err) });
  });
}

function register(context = {}) {
  const sendJson = context.sendJson || defaultSendJson;
  const readJsonBody = context.readJsonBody || (
    (req) => new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try { resolve(body ? JSON.parse(body) : {}); }
        catch (e) { reject(e); }
      });
      req.on('error', reject);
    })
  );
  const deps = { sendJson, readJsonBody };

  return [
    { method: 'GET', path: '/api/code-review/prepare', handler: (ctx) => handlePrepare(ctx, deps) },
    { method: 'POST', path: '/api/code-review/launch', handler: (ctx) => handleLaunch(ctx, deps) },
  ];
}

module.exports = { register };
