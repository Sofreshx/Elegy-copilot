'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
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
    runGit(childProcessImpl, ['status', '--porcelain=v1'], repoPath).catch(() => ({ stdout: '', stderr: '' })),
    runGit(childProcessImpl, ['branch', '--show-current'], repoPath).catch(() => ({ stdout: '', stderr: '' })),
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

  // Normalize remote URL to a browser-friendly URL for GitHub remotes
  let normalizedRemoteUrl = null;
  if (remoteUrl) {
    const httpsMatch = remoteUrl.match(/^https:\/\/github\.com\/(.+?)(\.git)?$/i);
    const sshMatch = remoteUrl.match(/^git@github\.com:(.+?)(\.git)?$/i);
    if (httpsMatch) {
      normalizedRemoteUrl = `https://github.com/${httpsMatch[1]}`;
    } else if (sshMatch) {
      normalizedRemoteUrl = `https://github.com/${sshMatch[1]}`;
    }
  }

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
    remoteUrl: normalizedRemoteUrl,
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
          'log', '--pretty=format:%h\t%H\t%s\t%an\t%aI', '--no-decorate', '-20',
        ],
        repoPath,
      );

      const commits = result.stdout
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => {
          const [hash, fullHash, message, author, authoredAt] = line.split('\t');
          return {
            hash: hash || line,
            fullHash: fullHash || null,
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

function handleGitHubInstall(ctx, deps) {
  const { res } = ctx;
  const { sendJson } = deps;
  const os = require('os');
  const https = require('https');
  const fs = require('fs');
  const path = require('path');
  const { execSync } = require('child_process');

  const platform = os.platform(); // 'win32', 'darwin', 'linux'
  const homeDir = os.homedir();

  return Promise.resolve()
    .then(async () => {
      // Step 1: Try platform package manager first
      let installed = false;
      let method = '';

      if (platform === 'win32') {
        try {
          // winget is the preferred method on Windows (ships with Win 10+)
          execSync('winget install --id GitHub.cli --accept-source-agreements --accept-package-agreements', {
            timeout: 120000,
            encoding: 'utf8',
            windowsHide: true,
          });
          // winget returns exit code 0 on success; verify it's installed
          const verifyResult = execSync('where gh', { timeout: 15000, encoding: 'utf8', windowsHide: true });
          if (verifyResult.trim()) {
            installed = true;
            method = 'winget';
          }
        } catch {
          // winget failed or not available, try direct download
        }
      } else if (platform === 'darwin') {
        try {
          execSync('brew install gh', { timeout: 120000, encoding: 'utf8' });
          installed = true;
          method = 'homebrew';
        } catch {
          // brew failed
        }
      } else if (platform === 'linux') {
        try {
          // Try apt (Debian/Ubuntu)
          execSync('sudo apt-get update && sudo apt-get install -y gh', { timeout: 120000, encoding: 'utf8' });
          installed = true;
          method = 'apt';
        } catch {
          // apt failed
        }
      }

      // Step 2: If package manager failed, download binary directly
      if (!installed) {
        const releaseUrl = platform === 'win32'
          ? 'https://github.com/cli/cli/releases/download/v2.63.0/gh_2.63.0_windows_amd64.zip'
          : platform === 'darwin'
            ? 'https://github.com/cli/cli/releases/download/v2.63.0/gh_2.63.0_macos_amd64.tar.gz'
            : 'https://github.com/cli/cli/releases/download/v2.63.0/gh_2.63.0_linux_amd64.tar.gz';

        const tmpDir = path.join(homeDir, '.elegy', 'tmp');
        if (!fs.existsSync(tmpDir)) {
          fs.mkdirSync(tmpDir, { recursive: true });
        }

        const archiveName = platform === 'win32' ? 'gh.zip' : 'gh.tar.gz';
        const archivePath = path.join(tmpDir, archiveName);
        const extractDir = path.join(tmpDir, 'gh-extract');

        // Download the archive
        await new Promise((resolve, reject) => {
          const file = fs.createWriteStream(archivePath);
          https.get(releaseUrl, { headers: { 'User-Agent': 'Elegy-Copilot' } }, (response) => {
            // Handle redirects
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
              https.get(response.headers.location, { headers: { 'User-Agent': 'Elegy-Copilot' } }, (redirectRes) => {
                redirectRes.pipe(file);
                file.on('finish', () => { file.close(() => resolve()); });
              }).on('error', reject);
              return;
            }
            response.pipe(file);
            file.on('finish', () => { file.close(() => resolve()); });
          }).on('error', reject);
        });

        // Extract
        if (platform === 'win32') {
          // Use PowerShell to extract zip (available on all Windows systems)
          try {
            if (!fs.existsSync(extractDir)) fs.mkdirSync(extractDir, { recursive: true });
            execSync(`powershell -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${extractDir}' -Force"`, {
              timeout: 30000,
              encoding: 'utf8',
              windowsHide: true,
            });
            // Move gh.exe to a location in PATH (use ~/.elegy/bin)
            const binDir = path.join(homeDir, '.elegy', 'bin');
            if (!fs.existsSync(binDir)) fs.mkdirSync(binDir, { recursive: true });
            // Find gh.exe in the extracted directory (it's in a subdirectory)
            const extractedDirs = fs.readdirSync(extractDir);
            const ghDir = extractedDirs.find(d => d.startsWith('gh_'));
            if (ghDir) {
              const ghExe = path.join(extractDir, ghDir, 'bin', 'gh.exe');
              if (fs.existsSync(ghExe)) {
                fs.copyFileSync(ghExe, path.join(binDir, 'gh.exe'));
                // Add to PATH for current session
                process.env.PATH = `${binDir};${process.env.PATH || ''}`;
                installed = true;
                method = 'direct-download';
              }
            }
          } catch (extractErr) {
            throw new Error(`Failed to extract: ${extractErr.message}`);
          }
        } else {
          // macOS/Linux: use tar
          try {
            if (!fs.existsSync(extractDir)) fs.mkdirSync(extractDir, { recursive: true });
            execSync(`tar -xzf "${archivePath}" -C "${extractDir}"`, { timeout: 30000, encoding: 'utf8' });
            const binDir = path.join(homeDir, '.elegy', 'bin');
            if (!fs.existsSync(binDir)) fs.mkdirSync(binDir, { recursive: true });
            const extractedDirs = fs.readdirSync(extractDir);
            const ghDir = extractedDirs.find(d => d.startsWith('gh_'));
            if (ghDir) {
              const ghBin = path.join(extractDir, ghDir, 'bin', 'gh');
              if (fs.existsSync(ghBin)) {
                fs.copyFileSync(ghBin, path.join(binDir, 'gh'));
                fs.chmodSync(path.join(binDir, 'gh'), 0o755);
                process.env.PATH = `${binDir}:${process.env.PATH || ''}`;
                installed = true;
                method = 'direct-download';
              }
            }
          } catch (err) {
            throw new Error(`Failed to extract: ${err.message}`);
          }
        }

        // Cleanup temp files
        try { fs.rmSync(archivePath, { force: true }); } catch {}
        try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch {}
      }

      // Step 3: Verify installation
      if (installed) {
        try {
          const versionResult = await runCommand(deps.childProcess, 'gh', ['--version'], homeDir, 15000);
          const versionMatch = String(versionResult.stdout || '').match(/gh version ([\d.]+)/i);
          const version = versionMatch ? versionMatch[1] : 'unknown';
          sendJson(res, 200, { installed: true, method, version });
        } catch {
          sendJson(res, 200, { installed: true, method, version: null });
        }
      } else {
        sendJson(res, 500, {
          installed: false,
          error: `Could not install GitHub CLI automatically on ${platform}. Please install manually from https://cli.github.com`,
        });
      }
    })
    .catch((error) => {
      sendJson(res, 500, {
        installed: false,
        error: String(error.message || error),
      });
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

      // Determine profile based on action type
      let profile = 'commit'; // default
      if (action === 'push') profile = 'ci-local';
      if (action === 'pull-request') profile = 'ci-local';

      // Detect current branch for protected-branch policy
      let branchName = null;
      try {
        const branchResult = await runGit(deps.childProcess, ['branch', '--show-current'], repoPath);
        branchName = (branchResult.stdout || '').trim();
      } catch {
        // Branch detection failure is non-blocking
      }

      // Gate through checks
      const gate = await gateGitAction(repoPath, action, body.unsafeOverride, profile, branchName);
      
      if (!gate.allowed) {
        // Checks failed and no override — return 422 with check results
        return sendJson(res, 422, {
          error: 'Pre-action checks failed',
          checkResults: gate.checkResults,
          message: gate.message,
          requiresOverride: gate.requiresOverride || false,
          overrideBlocked: gate.overrideBlocked || false,
          protectedBranch: gate.protectedBranch || false,
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
        protectedBranch: gate.protectedBranch || false,
        isProtected: gate.isProtected || false,
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

function handleGitMergeCandidates(ctx, deps) {
  const { res } = ctx;
  const { sendJson } = deps;
  const repoPath = resolveRepoPath(ctx);

  if (!repoPath) {
    sendJson(res, 400, { error: 'repoPath query parameter is required' });
    return;
  }

  return Promise.resolve()
    .then(async () => {
      // Get current branch
      const currentBranch = (await runGit(deps.childProcess, ['branch', '--show-current'], repoPath)).stdout.trim();
      
      // Get all local branches
      const branchOutput = await runGit(deps.childProcess, ['for-each-ref', '--format=%(refname:short)\t%(upstream:short)\t%(objectname:short)\t%(committerdate:iso)', 'refs/heads'], repoPath);
      const branches = branchOutput.stdout.trim().split('\n').filter(Boolean).map(line => {
        const [name, upstream, lastCommit, lastCommitDate] = line.split('\t');
        return {
          name: String(name || '').trim(),
          upstream: String(upstream || '').trim() || null,
          lastCommit: String(lastCommit || '').trim(),
          lastCommitDate: String(lastCommitDate || '').trim(),
          current: String(name || '').trim() === currentBranch,
        };
      });

      // For each non-current branch, check merge status
      const candidates = await Promise.all(branches
        .filter(b => !b.current && b.name)
        .map(async (branch) => {
          try {
            // Check if branch is merged into current
            const mergedResult = await runGit(deps.childProcess, ['merge-base', '--is-ancestor', branch.name, currentBranch], repoPath).catch(() => null);
            const isMerged = mergedResult !== null;
            
            // Get ahead/behind
            const aheadResult = await runGit(deps.childProcess, ['rev-list', '--count', `${currentBranch}..${branch.name}`], repoPath).catch(() => ({ stdout: '0' }));
            const behindResult = await runGit(deps.childProcess, ['rev-list', '--count', `${branch.name}..${currentBranch}`], repoPath).catch(() => ({ stdout: '0' }));
            
            return {
              name: branch.name,
              upstream: branch.upstream,
              lastCommit: branch.lastCommit,
              lastCommitDate: branch.lastCommitDate,
              isMerged,
              ahead: parseInt(String(aheadResult.stdout).trim(), 10) || 0,
              behind: parseInt(String(behindResult.stdout).trim(), 10) || 0,
            };
          } catch {
            return {
              name: branch.name,
              upstream: branch.upstream,
              lastCommit: branch.lastCommit,
              lastCommitDate: branch.lastCommitDate,
              isMerged: false,
              ahead: 0,
              behind: 0,
              error: 'Could not determine merge status',
            };
          }
        }));

      return {
        repoPath,
        currentBranch,
        branches: candidates,
      };
    })
    .then((result) => sendJson(res, 200, result))
    .catch((error) => {
      sendJson(res, 500, { error: String(error.message || error) });
    });
}

function handleGitMergeDryRun(ctx, deps) {
  const { req, res } = ctx;
  const { sendJson, readJsonBody } = deps;

  return readJsonBody(req)
    .then(async (body) => {
      const payload = body && typeof body === 'object' ? body : {};
      const repoPath = isNonEmptyString(payload.repoPath) ? payload.repoPath.trim() : '';
      const sourceRef = isNonEmptyString(payload.sourceRef) ? payload.sourceRef.trim() : '';
      const targetRef = isNonEmptyString(payload.targetRef) ? payload.targetRef.trim() : '';

      if (!repoPath) throw Object.assign(new Error('repoPath is required'), { statusCode: 400 });
      if (!sourceRef) throw Object.assign(new Error('sourceRef is required'), { statusCode: 400 });
      if (!targetRef) throw Object.assign(new Error('targetRef is required'), { statusCode: 400 });

      // Check if worktree is dirty
      const statusResult = await runGit(deps.childProcess, ['status', '--porcelain'], repoPath);
      const isDirty = statusResult.stdout.trim().length > 0;

      if (isDirty) {
        return {
          ok: false,
          clean: false,
          conflicts: [],
          diagnostics: 'Working tree is dirty. Please commit or stash changes before attempting a merge.',
          sourceRef,
          targetRef,
          dirty: true,
        };
      }

      // Use git merge-tree for non-mutating merge analysis
      let mergeResult;
      try {
        mergeResult = await runGit(deps.childProcess, ['merge-tree', targetRef, sourceRef], repoPath, 15000);
      } catch (err) {
        // merge-tree exits non-zero on conflicts — that's expected and we parse stdout
        const stdout = err.stdout || '';
        const stderr = err.stderr || '';
        const message = String(err.message || '');

        // Distinguish between conflict non-zero exit and command failure
        if (stdout.includes('<<<<<<<') || stdout.includes('>>>>>>>') || stdout.includes('=======') || message.includes('merge-tree')) {
          // Expected: merge-tree found conflicts
          mergeResult = { stdout, stderr };
        } else {
          // Unexpected: command failure (git not found, bad ref, pre-2.38 git, etc.)
          return {
            ok: false,
            clean: false,
            conflicts: [],
            diagnostics: `Merge analysis failed: ${message || stderr || 'Unknown error'}`,
            sourceRef,
            targetRef,
            dirty: false,
            error: message || stderr || 'Merge analysis failed',
          };
        }
      }

      const output = mergeResult.stdout || '';
      const hasConflicts = output.includes('<<<<<<<') || output.includes('>>>>>>>') || output.includes('=======');
      
      // Parse conflict files
      const conflicts = [];
      if (hasConflicts) {
        const lines = output.split('\n');
        for (const line of lines) {
          // merge-tree outputs conflict filenames in various formats
          const conflictMatch = line.match(/^(?:changed in both|added in both|CONFLICT|merged\s+)\s*(.+)$/i);
          if (conflictMatch) {
            conflicts.push(conflictMatch[1].trim());
          }
        }
      }

      return {
        ok: !hasConflicts,
        clean: !hasConflicts,
        conflicts: conflicts.length > 0 ? conflicts : undefined,
        diagnostics: hasConflicts ? `Merge conflict detected in ${conflicts.length} file(s)` : 'No conflicts detected',
        sourceRef,
        targetRef,
        dirty: false,
      };
    })
    .then((result) => sendJson(res, 200, result))
    .catch((error) => {
      const statusCode = typeof error.statusCode === 'number' ? error.statusCode : 500;
      sendJson(res, statusCode, { error: String(error.message || error) });
    });
}

function handleGitMergeLocal(ctx, deps) {
  const { req, res } = ctx;
  const { sendJson, readJsonBody } = deps;

  return readJsonBody(req)
    .then(async (body) => {
      const payload = body && typeof body === 'object' ? body : {};
      const repoPath = isNonEmptyString(payload.repoPath) ? payload.repoPath.trim() : '';
      const sourceRef = isNonEmptyString(payload.sourceRef) ? payload.sourceRef.trim() : '';
      const targetRef = isNonEmptyString(payload.targetRef) ? payload.targetRef.trim() : '';

      if (!repoPath) throw Object.assign(new Error('repoPath is required'), { statusCode: 400 });
      if (!sourceRef) throw Object.assign(new Error('sourceRef is required'), { statusCode: 400 });
      if (!targetRef) throw Object.assign(new Error('targetRef is required'), { statusCode: 400 });

      // Safety: check current branch
      const currentBranch = (await runGit(deps.childProcess, ['branch', '--show-current'], repoPath)).stdout.trim();
      if (currentBranch !== targetRef) {
        throw Object.assign(new Error(`Current branch (${currentBranch}) does not match target ref (${targetRef}). Switch to the target branch first.`), { statusCode: 409 });
      }

      // Safety: check clean worktree
      const statusResult = await runGit(deps.childProcess, ['status', '--porcelain'], repoPath);
      if (statusResult.stdout.trim().length > 0) {
        throw Object.assign(new Error('Working tree is dirty. Commit or stash changes before merging.'), { statusCode: 409 });
      }

      // Verify merge would be clean via merge-tree first
      let mergeCheck;
      try {
        mergeCheck = await runGit(deps.childProcess, ['merge-tree', targetRef, sourceRef], repoPath, 10000);
      } catch (err) {
        mergeCheck = { stdout: err.stdout || '', stderr: err.stderr || '' };
      }
      const mergeOutput = mergeCheck.stdout || '';
      if (mergeOutput.includes('<<<<<<<') || mergeOutput.includes('>>>>>>>')) {
        throw Object.assign(new Error('Dry-run indicates conflicts exist. Resolve conflicts or run merge dry-run first.'), { statusCode: 409, conflicts: true });
      }

      // Execute the merge (--no-ff to record merge commit)
      const result = await runGit(deps.childProcess, ['merge', '--no-ff', sourceRef], repoPath, 30000);

      return {
        merged: true,
        sourceRef,
        targetRef,
        output: `${result.stdout}${result.stderr}`.trim(),
      };
    })
    .then((result) => sendJson(res, 200, result))
    .catch((error) => {
      if (error.conflicts) {
        sendJson(res, 409, { error: String(error.message || error), conflicts: true });
        return;
      }
      const statusCode = typeof error.statusCode === 'number' ? error.statusCode : 500;
      sendJson(res, statusCode, { error: String(error.message || error) });
    });
}

function handleGitMergeWorktree(ctx, deps) {
  const { req, res } = ctx;
  const { sendJson, readJsonBody } = deps;

  return readJsonBody(req)
    .then(async (body) => {
      const payload = body && typeof body === 'object' ? body : {};
      const repoPath = isNonEmptyString(payload.repoPath) ? payload.repoPath.trim() : '';
      const worktreePath = isNonEmptyString(payload.worktreePath) ? payload.worktreePath.trim() : '';
      const worktreeBranch = isNonEmptyString(payload.worktreeBranch) ? payload.worktreeBranch.trim() : '';
      const targetBranch = isNonEmptyString(payload.targetBranch) ? payload.targetBranch.trim() : '';

      if (!repoPath) throw Object.assign(new Error('repoPath is required'), { statusCode: 400 });
      if (!worktreePath) throw Object.assign(new Error('worktreePath is required'), { statusCode: 400 });
      if (!worktreeBranch) throw Object.assign(new Error('worktreeBranch is required'), { statusCode: 400 });
      if (!targetBranch) throw Object.assign(new Error('targetBranch is required'), { statusCode: 400 });

      // Safety: check current branch matches target branch
      const currentBranch = (await runGit(deps.childProcess, ['branch', '--show-current'], repoPath)).stdout.trim();
      if (currentBranch !== targetBranch) {
        throw Object.assign(new Error(`Current branch (${currentBranch}) does not match target branch (${targetBranch}). Switch to the target branch first.`), { statusCode: 409 });
      }

      // Safety: check working tree is clean
      const statusResult = await runGit(deps.childProcess, ['status', '--porcelain'], repoPath);
      if (statusResult.stdout.trim().length > 0) {
        throw Object.assign(new Error('Working tree is dirty. Commit or stash changes before merging.'), { statusCode: 409 });
      }

      // Dry-run: use merge-tree to check for conflicts
      let mergeCheck;
      try {
        mergeCheck = await runGit(deps.childProcess, ['merge-tree', targetBranch, worktreeBranch], repoPath, 15000);
      } catch (err) {
        mergeCheck = { stdout: err.stdout || '', stderr: err.stderr || '' };
      }
      const mergeOutput = mergeCheck.stdout || '';

      // Parse conflicts from merge-tree output
      const hasConflicts = mergeOutput.includes('<<<<<<<') || mergeOutput.includes('>>>>>>>') || mergeOutput.includes('=======');
      const conflictFiles = [];
      if (hasConflicts) {
        const lines = mergeOutput.split('\n');
        for (const line of lines) {
          const conflictMatch = line.match(/^(?:changed in both|added in both|CONFLICT|merged\s+)\s*(.+)$/i);
          if (conflictMatch) {
            conflictFiles.push(conflictMatch[1].trim());
          }
        }
      }

      if (hasConflicts) {
        return {
          merged: false,
          conflicts: true,
          conflictFiles,
          diagnostics: `Merge conflict detected in ${conflictFiles.length} file(s)`,
          sourceRef: worktreeBranch,
          targetRef: targetBranch,
        };
      }

      // Execute the merge (--no-ff to record merge commit)
      const result = await runGit(deps.childProcess, ['merge', '--no-ff', worktreeBranch], repoPath, 30000);

      return {
        merged: true,
        sourceRef: worktreeBranch,
        targetRef: targetBranch,
        output: `${result.stdout}${result.stderr}`.trim(),
      };
    })
    .then((result) => sendJson(res, 200, result))
    .catch((error) => {
      const statusCode = typeof error.statusCode === 'number' ? error.statusCode : 500;
      sendJson(res, statusCode, { error: String(error.message || error) });
    });
}

function handleGitHubStatus(ctx, deps) {
  const { res } = ctx;
  const { sendJson } = deps;
  const os = require('os');
  const homeDir = os.homedir();

  let ghInstalled = false;
  let ghVersion = null;
  let authenticated = false;
  let user = null;
  let error = null;

  return Promise.resolve()
    .then(async () => {
      // Check if gh CLI is installed
      try {
        const versionResult = await runCommand(deps.childProcess, 'gh', ['--version'], homeDir, 10000);
        ghInstalled = true;
        const versionMatch = String(versionResult.stdout || versionResult.stderr || '').match(/gh version ([\d.]+)/i);
        ghVersion = versionMatch ? versionMatch[1] : 'unknown';
      } catch (e) {
        error = 'GitHub CLI (gh) is not installed or not in PATH.';
      }

      // Check auth status
      if (ghInstalled) {
        try {
          const authResult = await runCommand(deps.childProcess, 'gh', ['auth', 'status'], homeDir, 15000);
          authenticated = /Logged in/i.test(authResult.stdout) || /Logged in/i.test(authResult.stderr);
        } catch (e) {
          // gh auth status may exit non-zero even when partially authenticated
          const msg = String(e.stderr || e.message || '').toLowerCase();
          if (/logged in/i.test(msg)) authenticated = true;
        }

        // Get user info if authenticated
        if (authenticated) {
          try {
            const userResult = await runCommand(deps.childProcess, 'gh', ['api', 'user', '--jq', '.login'], homeDir, 10000);
            user = String(userResult.stdout || '').trim() || null;
          } catch (e) {
            // User info not critical
          }
        }
      }

      sendJson(res, 200, {
        ghInstalled,
        ghVersion,
        authenticated,
        user,
        error,
      });
    })
    .catch((err) => {
      sendJson(res, 500, {
        ghInstalled: false,
        ghVersion: null,
        authenticated: false,
        user: null,
        error: String(err.message || err),
      });
    });
  }

// ─── Stash handlers ──────────────────────────────────────────────────────────

function handleListStashes(ctx, deps) {
  const { res } = ctx;
  const { sendJson } = deps;
  const repoPath = resolveRepoPath(ctx);

  if (!repoPath) {
    sendJson(res, 400, { error: 'repoPath query parameter is required' });
    return;
  }

  return Promise.resolve()
    .then(async () => {
      let result;
      try {
        result = await runGit(deps.childProcess, ['stash', 'list', '--format=%gd %h %s'], repoPath, 10000);
      } catch {
        return { repoPath, count: 0, stashes: [] };
      }

      const lines = result.stdout.split('\n').filter(Boolean);
      const stashes = lines.map((line) => {
        const match = line.match(/^(stash@\{\d+\})\s+(\S+)\s+(.*)$/);
        if (!match) return null;
        const ref = match[1];
        const hash = match[2];
        const message = match[3];
        const indexMatch = ref.match(/stash@\{(\d+)\}/);
        const index = indexMatch ? Number(indexMatch[1]) : 0;
        return { index, ref, hash, message };
      }).filter(Boolean);

      return { repoPath, count: stashes.length, stashes };
    })
    .then((result) => sendJson(res, 200, result))
    .catch((error) => {
      sendJson(res, 500, { error: String(error.message || error) });
    });
}

function handleCreateStash(ctx, deps) {
  const { req, res } = ctx;
  const { sendJson, readJsonBody } = deps;

  return readJsonBody(req)
    .then(async (body) => {
      const payload = body && typeof body === 'object' ? body : {};
      const repoPath = isNonEmptyString(payload.repoPath) ? payload.repoPath.trim() : '';
      const message = isNonEmptyString(payload.message) ? payload.message.trim() : '';

      if (!repoPath) {
        throw Object.assign(new Error('repoPath is required'), { statusCode: 400 });
      }

      const args = message ? ['stash', 'push', '-m', message] : ['stash', 'push'];
      const result = await runGit(deps.childProcess, args, repoPath, 30000);
      return { stashed: true, message: message || 'WIP', output: result.stdout.trim() };
    })
    .then((result) => sendJson(res, 200, result))
    .catch((error) => {
      const statusCode = typeof error.statusCode === 'number' ? error.statusCode : 500;
      sendJson(res, statusCode, { error: String(error.message || error) });
    });
}

function handleApplyStash(ctx, deps) {
  const { req, res } = ctx;
  const { sendJson, readJsonBody } = deps;

  return readJsonBody(req)
    .then(async (body) => {
      const payload = body && typeof body === 'object' ? body : {};
      const repoPath = isNonEmptyString(payload.repoPath) ? payload.repoPath.trim() : '';
      const index = typeof payload.index === 'number' ? payload.index : undefined;

      if (!repoPath) {
        throw Object.assign(new Error('repoPath is required'), { statusCode: 400 });
      }

      const args = index !== undefined
        ? ['stash', 'apply', `stash@{${index}}`]
        : ['stash', 'apply'];
      const result = await runGit(deps.childProcess, args, repoPath, 60000);
      return { applied: true, index: index ?? 0, output: result.stdout.trim() };
    })
    .then((result) => sendJson(res, 200, result))
    .catch((error) => {
      const statusCode = typeof error.statusCode === 'number' ? error.statusCode : 500;
      sendJson(res, statusCode, { error: String(error.message || error) });
    });
}

function handlePopStash(ctx, deps) {
  const { req, res } = ctx;
  const { sendJson, readJsonBody } = deps;

  return readJsonBody(req)
    .then(async (body) => {
      const payload = body && typeof body === 'object' ? body : {};
      const repoPath = isNonEmptyString(payload.repoPath) ? payload.repoPath.trim() : '';
      const index = typeof payload.index === 'number' ? payload.index : undefined;

      if (!repoPath) {
        throw Object.assign(new Error('repoPath is required'), { statusCode: 400 });
      }

      const args = index !== undefined
        ? ['stash', 'pop', `stash@{${index}}`]
        : ['stash', 'pop'];
      const result = await runGit(deps.childProcess, args, repoPath, 60000);
      return { popped: true, index: index ?? 0, output: result.stdout.trim() };
    })
    .then((result) => sendJson(res, 200, result))
    .catch((error) => {
      const statusCode = typeof error.statusCode === 'number' ? error.statusCode : 500;
      sendJson(res, statusCode, { error: String(error.message || error) });
    });
}

function handleDropStash(ctx, deps) {
  const { req, res } = ctx;
  const { sendJson, readJsonBody } = deps;

  return readJsonBody(req)
    .then(async (body) => {
      const payload = body && typeof body === 'object' ? body : {};
      const repoPath = isNonEmptyString(payload.repoPath) ? payload.repoPath.trim() : '';
      const index = typeof payload.index === 'number' ? payload.index : undefined;

      if (!repoPath) {
        throw Object.assign(new Error('repoPath is required'), { statusCode: 400 });
      }

      const args = index !== undefined
        ? ['stash', 'drop', `stash@{${index}}`]
        : ['stash', 'drop'];
      const result = await runGit(deps.childProcess, args, repoPath, 10000);
      return { dropped: true, index: index ?? 0, output: result.stdout.trim() };
    })
    .then((result) => sendJson(res, 200, result))
    .catch((error) => {
      const statusCode = typeof error.statusCode === 'number' ? error.statusCode : 500;
      sendJson(res, statusCode, { error: String(error.message || error) });
    });
}

/**
 * GET /api/git/graph
 * Returns parsed git log --graph output as structured JSON.
 */
function handleGitGraph(ctx, deps) {
  const { res } = ctx;
  const { sendJson } = deps;
  const repoPath = resolveRepoPath(ctx);

  if (!repoPath) {
    sendJson(res, 400, { error: 'repoPath query parameter is required' });
    return;
  }

  return Promise.resolve()
    .then(async () => {
      const result = await runGit(deps.childProcess, [
        'log',
        '--graph',
        '--decorate',
        '--all',
        '--date-order',
        '--format=%H%x00%h%x00%D%x00%an%x00%ad%x00%s',
        '--date=short',
        '-30', // last 30 commits
      ], repoPath, 15000).catch(() => ({ stdout: '' }));

      const lines = result.stdout.trim().split('\n').filter(Boolean);
      const commits = [];

      for (const line of lines) {
        // Split into graph portion and data portion
        // Graph: everything up to the first hex commit hash
        const hashMatch = line.match(/[0-9a-f]{40}/);
        if (!hashMatch || hashMatch.index === undefined) continue;

        const graphChars = line.slice(0, hashMatch.index);
        const dataPart = line.slice(hashMatch.index);
        const fields = dataPart.split('\x00');

        if (fields.length < 6) continue;

        commits.push({
          fullHash: fields[0],
          shortHash: fields[1],
          refs: fields[2] ? fields[2].split(',').map((r) => r.trim()).filter(Boolean) : [],
          author: fields[3],
          date: fields[4],
          subject: fields[5],
          graph: graphChars,
          isMerge: Boolean(fields[5] && fields[5].startsWith('Merge')),
        });
      }

      sendJson(res, 200, {
        repoPath,
        count: commits.length,
        commits,
      });
    })
    .catch((error) => {
      sendJson(res, 500, { error: String(error.message || error) });
    });
}

function resolveOpenCodeBin() {
  if (process.env.OPENCODE_BIN) return process.env.OPENCODE_BIN;
  const { execSync } = require('node:child_process');
  if (process.platform === 'win32') {
    try { return execSync('where.exe opencode.cmd', { encoding: 'utf8', stdio: 'pipe', windowsHide: true }).trim().split('\n')[0].trim(); } catch (_) {}
    try { return execSync('where.exe opencode', { encoding: 'utf8', stdio: 'pipe', windowsHide: true }).trim().split('\n')[0].trim(); } catch (_) {}
    const appData = process.env.APPDATA || '';
    if (appData) {
      const candidate = `${appData}\\npm\\opencode.cmd`;
      const { existsSync } = require('node:fs');
      if (existsSync(candidate)) return candidate;
    }
    return null;
  }
  try { return execSync('which opencode', { encoding: 'utf8', stdio: 'pipe' }).trim(); } catch (_) {}
  return null;
}

const FALLBACK_OPENCODE_COMMIT_MODELS = [
  'opencode/deepseek-v4-flash-free',
  'opencode/deepseek-v4-pro-free',
  'opencode-go/deepseek-v4-flash',
];

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))];
}

function readOpenCodeProfileCommitModels(engineRoot = path.resolve(__dirname, '..', '..')) {
  try {
    const profilesPath = path.resolve(engineRoot, 'opencode-assets', 'profiles.json');
    const parsed = JSON.parse(fs.readFileSync(profilesPath, 'utf8'));
    const profiles = parsed && parsed.profiles && typeof parsed.profiles === 'object' ? parsed.profiles : {};
    const activeProfileId = typeof parsed.activeProfile === 'string' ? parsed.activeProfile : '';
    const orderedProfileIds = uniqueStrings([
      'opencode-zen-free',
      activeProfileId,
      'opencode-go-fast',
      'opencode-go-balanced',
      ...Object.keys(profiles),
    ]);

    const models = [];
    for (const profileId of orderedProfileIds) {
      const profile = profiles[profileId];
      if (!profile || typeof profile !== 'object') continue;
      const roleModels = profile.roleModels && typeof profile.roleModels === 'object' ? profile.roleModels : {};
      models.push(
        roleModels.implementation,
        roleModels.exploration,
        roleModels.planning,
        profile.small,
        profile.big,
      );
    }
    return uniqueStrings(models);
  } catch (_) {
    return [];
  }
}

function resolveCommitMessageModels(body, deps = {}) {
  if (Array.isArray(body.models) && body.models.length > 0) {
    return uniqueStrings(body.models);
  }
  const configuredModels = typeof deps.getOpenCodeCommitModels === 'function'
    ? deps.getOpenCodeCommitModels()
    : readOpenCodeProfileCommitModels(deps.engineRoot);
  return uniqueStrings([...configuredModels, ...FALLBACK_OPENCODE_COMMIT_MODELS]);
}

function extractOpenCodeText(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(extractOpenCodeText).filter(Boolean).join('\n');
  if (typeof value !== 'object') return '';

  for (const key of ['content', 'text', 'output', 'message', 'part']) {
    const text = extractOpenCodeText(value[key]);
    if (text.trim()) return text;
  }

  if (Array.isArray(value.parts)) {
    return value.parts.map(extractOpenCodeText).filter(Boolean).join('\n');
  }

  return '';
}

function parseOpenCodeCommitMessage(stdout) {
  const lines = String(stdout || '').split('\n').filter((line) => line.trim());
  let messageContent = '';

  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      if (event.type && /error/i.test(String(event.type))) continue;
      const content = extractOpenCodeText(event).trim();
      if (content) messageContent = content;
    } catch (_) {
      // Non-JSON lines are handled below.
    }
  }

  if (!messageContent.trim()) {
    const textLines = lines.filter((line) => {
      try { JSON.parse(line); return false; } catch (_) { return true; }
    });
    messageContent = textLines.join('\n').trim();
  }

  return messageContent.replace(/```[\s\S]*?```/g, '').replace(/`([^`]+)`/g, '$1').trim();
}

function handleGenerateCommitMessage(ctx, deps) {
  const { req, res } = ctx;
  const { sendJson, readJsonBody, childProcess: childProcessImpl } = deps;

  return readJsonBody(req).then(async (body) => {
    const repoPath = isNonEmptyString(body.repoPath) ? body.repoPath.trim() : '';
    if (!repoPath) throw Object.assign(new Error('repoPath is required'), { statusCode: 400 });
    const models = resolveCommitMessageModels(body, deps);
    const warnings = [];
    const stagedOnly = body.stagedOnly === true;

    // Resolve opencode binary
    const resolveBin = deps.resolveOpenCodeBin || resolveOpenCodeBin;
    const openCodeBin = resolveBin();

    if (!openCodeBin) {
      sendJson(res, 200, { ok: false, code: 'OPENCODE_NOT_FOUND', message: 'OpenCode CLI is not available to the Elegy backend.', warnings: [] });
      return;
    }

    const useShell = process.platform === 'win32' && openCodeBin.toLowerCase().endsWith('.cmd');

    let recentCommits = '';
    try {
      const logResult = await runGit(childProcessImpl, ['log', '--pretty=%s', '-8'], repoPath);
      recentCommits = logResult.stdout.trim();
    } catch (e) {
      warnings.push('Could not read recent commits for style reference');
    }

    let diffText = '';
    let usedStaged = true;
    try {
      const statResult = await runGit(childProcessImpl, ['diff', '--cached', '--stat'], repoPath);
      if (statResult.stdout.trim()) {
        const diffResult = await runGit(childProcessImpl, ['diff', '--cached'], repoPath, 15000);
        diffText = diffResult.stdout.substring(0, 4000);
        if (diffResult.stdout.length > 4000) warnings.push('Diff truncated to 4000 characters');
      } else {
        usedStaged = false;
        if (!stagedOnly) {
          warnings.push('No staged changes; generated from working tree.');
        }
        const unstagedStat = await runGit(childProcessImpl, ['diff', '--stat'], repoPath, 15000);
        const unstagedDiff = await runGit(childProcessImpl, ['diff'], repoPath, 15000);
        diffText = unstagedDiff.stdout.substring(0, 4000);
        if (unstagedDiff.stdout.length > 4000) warnings.push('Diff truncated to 4000 characters');
      }
    } catch (e) {
      // If diff fails entirely, try unstaged
      try {
        usedStaged = false;
        if (!stagedOnly) {
          warnings.push('No staged changes; generated from working tree.');
        }
        const unstagedDiff = await runGit(childProcessImpl, ['diff'], repoPath, 15000);
        diffText = unstagedDiff.stdout.substring(0, 4000);
        if (unstagedDiff.stdout.length > 4000) warnings.push('Diff truncated to 4000 characters');
      } catch (e2) {
        throw Object.assign(new Error('Could not read git diff'), { statusCode: 500 });
      }
    }

    if (stagedOnly && !usedStaged) {
      sendJson(res, 200, { ok: false, code: 'NO_CHANGES', message: 'No staged changes available (stagedOnly=true)', warnings: [...warnings, 'No staged changes available (stagedOnly=true)'] });
      return;
    }

    if (!diffText.trim()) {
      sendJson(res, 200, { ok: false, code: 'NO_CHANGES', message: 'No changes to generate a commit message from.', warnings: [...warnings, 'No changes to generate message from'] });
      return;
    }

    const prompt = `Generate a git commit message for the following diff.

RULES:
- Return ONLY the commit message text. No other output.
- First line max 72 characters.
- Use imperative mood (e.g., "Add feature" not "Added feature").
- Match the style of recent commits for consistency. If they use Conventional Commits (e.g., "feat:", "fix:", "chore:"), follow that convention.
- Include a body paragraph only if the diff needs explanation beyond the first line.
- NO Markdown fences, NO commentary, NO signatures, NO co-author trailers.
- Do not use any tools. Output text only.

RECENT COMMITS (for style reference):
${recentCommits || '(none)'}

GIT DIFF:
${diffText}`;

    let lastError = null;
    for (let i = 0; i < models.length; i++) {
      const model = models[i];
      try {
        const result = await new Promise((resolve, reject) => {
          const execOpts = {
            cwd: repoPath,
            timeout: 60000,
            windowsHide: true,
            maxBuffer: 1024 * 1024,
          };
          if (useShell) execOpts.shell = true;
          childProcessImpl.execFile(openCodeBin, [
            'run',
            '--model', model,
            '--agent', 'plan',
            '--format', 'json',
            '--dir', repoPath,
            prompt,
          ], execOpts, (error, stdout, stderr) => {
            if (error) {
              reject(Object.assign(error, { stdout, stderr }));
              return;
            }
            resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
          });
        });

        const messageContent = parseOpenCodeCommitMessage(result.stdout);

        if (messageContent) {
          sendJson(res, 200, {
            ok: true,
            message: messageContent,
            model,
            source: 'opencode',
            fallbackIndex: i,
            warnings,
          });
          return;
        }
      } catch (e) {
        lastError = e;
        // Continue to next model
      }
    }

    // All models failed — return non-blocking error
    sendJson(res, 200, { ok: false, code: 'MODEL_CHAIN_FAILED', message: 'No free OpenCode model returned a commit message.', warnings: [...warnings, `All models failed. Last error: ${lastError?.message || 'unknown'}`], lastError: lastError?.message || 'unknown' });
  }).catch((error) => {
    const statusCode = typeof error.statusCode === 'number' ? error.statusCode : 500;
    sendJson(res, statusCode, { error: String(error.message || error) });
  });
}

function register(context = {}) {
  const sendJson = context.sendJson || defaultSendJson;
  const readJsonBody = context.readJsonBody || defaultReadJsonBody;
  const deps = {
    sendJson,
    readJsonBody,
    childProcess: context.childProcess || childProcess,
    resolveOpenCodeBin: context.resolveOpenCodeBin || null,
    getOpenCodeCommitModels: context.getOpenCodeCommitModels || null,
    engineRoot: context.engineRoot || null,
  };

  return [
    { method: 'GET', path: '/api/git/status', handler: (ctx) => handleGitStatus(ctx, deps) },
    { method: 'GET', path: '/api/git/diff', handler: (ctx) => handleGitDiff(ctx, deps) },
    { method: 'GET', path: '/api/git/log', handler: (ctx) => handleGitLog(ctx, deps) },
    { method: 'GET', path: '/api/git/graph', handler: (ctx) => handleGitGraph(ctx, deps) },
    { method: 'GET', path: '/api/git/branches', handler: (ctx) => handleGitBranches(ctx, deps) },
    { method: 'GET', path: '/api/git/summary', handler: (ctx) => handleGitSummary(ctx, deps) },
    { method: 'GET', path: '/api/git/pull-request', handler: (ctx) => handleGitPullRequest(ctx, deps) },
    { method: 'POST', path: '/api/git/stage', handler: (ctx) => handleGitStage(ctx, deps) },
    { method: 'POST', path: '/api/git/unstage', handler: (ctx) => handleGitUnstage(ctx, deps) },
    { method: 'POST', path: '/api/git/commit', handler: (ctx) => handleGitCommit(ctx, deps) },
    { method: 'POST', path: '/api/git/commit-message', handler: (ctx) => handleGenerateCommitMessage(ctx, deps) },
    { method: 'POST', path: '/api/git/checkout', handler: (ctx) => handleGitCheckout(ctx, deps) },
    { method: 'POST', path: '/api/git/pull', handler: (ctx) => handleGitPull(ctx, deps) },
    { method: 'POST', path: '/api/git/push', handler: (ctx) => handleGitPush(ctx, deps) },
    { method: 'POST', path: '/api/git/pull-request', handler: (ctx) => handleGitPullRequest(ctx, deps) },
    { method: 'POST', path: '/api/git/auth/login', handler: (ctx) => handleGitAuthLogin(ctx, deps) },
    { method: 'POST', path: '/api/git/github-install', handler: (ctx) => handleGitHubInstall(ctx, deps) },
    { method: 'GET', path: '/api/git/merge-candidates', handler: (ctx) => handleGitMergeCandidates(ctx, deps) },
    { method: 'POST', path: '/api/git/merge-dry-run', handler: (ctx) => handleGitMergeDryRun(ctx, deps) },
    { method: 'POST', path: '/api/git/merge-local', handler: (ctx) => handleGitMergeLocal(ctx, deps) },
    { method: 'POST', path: '/api/git/merge-worktree', handler: (ctx) => handleGitMergeWorktree(ctx, deps) },
    { method: 'GET', path: '/api/git/github-status', handler: (ctx) => handleGitHubStatus(ctx, deps) },
    { method: 'GET', path: '/api/git/stashes', handler: (ctx) => handleListStashes(ctx, deps) },
    { method: 'POST', path: '/api/git/stash', handler: (ctx) => handleCreateStash(ctx, deps) },
    { method: 'POST', path: '/api/git/stash/apply', handler: (ctx) => handleApplyStash(ctx, deps) },
    { method: 'POST', path: '/api/git/stash/pop', handler: (ctx) => handlePopStash(ctx, deps) },
    { method: 'POST', path: '/api/git/stash/drop', handler: (ctx) => handleDropStash(ctx, deps) },
  ];
}

module.exports = {
  register,
  handleGitMergeWorktree,
  handleListStashes,
  handleCreateStash,
  handleApplyStash,
  handlePopStash,
  handleDropStash,
};
