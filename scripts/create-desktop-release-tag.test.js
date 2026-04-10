const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { main: runTagHelperMain } = require('./create-desktop-release-tag');

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 120000,
    ...options,
  });

  if (result.status !== 0) {
    const commandLabel = [command, ...args].join(' ');
    throw new Error(
      `${commandLabel} failed with code ${result.status}\nstdout:\n${result.stdout || ''}\nstderr:\n${result.stderr || ''}`
    );
  }

  return result;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function createPreviewReleaseServer(releaseByTag) {
  return new Promise((resolve) => {
    const sockets = new Set();
    const server = http.createServer((request, response) => {
      const url = new URL(request.url, 'http://127.0.0.1');
      const match = /^\/repos\/[^/]+\/[^/]+\/releases\/tags\/(.+)$/.exec(url.pathname);
      const tagName = match ? decodeURIComponent(match[1]) : '';
      const payload = tagName ? releaseByTag[tagName] : null;

      response.setHeader('Connection', 'close');
      response.setHeader('Content-Type', 'application/json');
      if (!payload) {
        response.statusCode = 404;
        response.end(JSON.stringify({ message: 'Not Found' }));
        return;
      }

      response.statusCode = 200;
      response.end(JSON.stringify(payload));
    });

    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.on('close', () => {
        sockets.delete(socket);
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((closeResolve) => {
          for (const socket of sockets) {
            socket.destroy();
          }
          server.close(closeResolve);
        }),
      });
    });
  });
}

function createPreviewRelease(tagName) {
  return {
    id: 101,
    tag_name: tagName,
    html_url: `https://github.com/test-owner/test-repo/releases/tag/${tagName}`,
    draft: false,
    prerelease: true,
    assets: [
      { name: 'release-manifest.json' },
      { name: `Elegy Copilot_${tagName}_x64-setup.exe` },
      { name: 'windows-installation-guide.md' },
    ],
  };
}

function commitAll(repoRoot, message) {
  runCommand('git', ['add', '.'], { cwd: repoRoot });
  runCommand('git', ['commit', '-m', message], { cwd: repoRoot });
}

function createRepoWithOrigin() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-tag-helper-'));
  const repoRoot = path.join(root, 'repo');
  const originRoot = path.join(root, 'origin.git');

  fs.mkdirSync(repoRoot, { recursive: true });
  runCommand('git', ['init', '--bare', originRoot]);
  runCommand('git', ['init', '--initial-branch=main'], { cwd: repoRoot });
  runCommand('git', ['config', 'user.name', 'Copilot Test'], { cwd: repoRoot });
  runCommand('git', ['config', 'user.email', 'copilot@example.com'], { cwd: repoRoot });
  runCommand('git', ['remote', 'add', 'origin', originRoot], { cwd: repoRoot });

  return { root, repoRoot, originRoot };
}

function seedDesktopPackage(repoRoot, version) {
  writeJson(path.join(repoRoot, 'copilot-ui', 'package.json'), {
    name: 'elegy-copilot-desktop',
    version,
    desktopRelease: {
      publishRepository: 'test-owner/test-repo',
    },
  });
}

async function runTagHelperResult(repoRoot, args = [], env = {}) {
  const originalCwd = process.cwd();
  const originalLog = console.log;
  const originalError = console.error;
  const stdout = [];
  const stderr = [];
  const previousEnvValues = new Map();

  console.log = (...values) => {
    stdout.push(values.join(' '));
  };
  console.error = (...values) => {
    stderr.push(values.join(' '));
  };

  for (const [key, value] of Object.entries(env)) {
    previousEnvValues.set(key, process.env[key]);
    process.env[key] = value;
  }

  try {
    process.chdir(repoRoot);
    await runTagHelperMain(['--desktop-release', '--dry-run', ...args]);
    return {
      status: 0,
      stdout: stdout.join('\n'),
      stderr: stderr.join('\n'),
    };
  } catch (error) {
    return {
      status: 1,
      stdout: stdout.join('\n'),
      stderr: [stderr.join('\n'), error.message || String(error)].filter(Boolean).join('\n'),
    };
  } finally {
    process.chdir(originalCwd);
    console.log = originalLog;
    console.error = originalError;
    for (const [key, value] of previousEnvValues.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

async function runTagHelper(repoRoot, args = [], env = {}) {
  const result = await runTagHelperResult(repoRoot, args, env);
  if (result.status !== 0) {
    const commandLabel = ['node', 'scripts/create-desktop-release-tag.js', '--desktop-release', '--dry-run', ...args].join(' ');
    throw new Error(
      `${commandLabel} failed with code ${result.status}\nstdout:\n${result.stdout || ''}\nstderr:\n${result.stderr || ''}`,
    );
  }

  return result.stdout;
}

function pushTag(repoRoot, tagName) {
  runCommand('git', ['tag', tagName], { cwd: repoRoot });
  runCommand('git', ['push', 'origin', `refs/tags/${tagName}`], { cwd: repoRoot });
}

test('desktop tag helper proposes creating a tag after a version bump', async () => {
  const { root, repoRoot } = createRepoWithOrigin();
  const server = await createPreviewReleaseServer({
    '0.2.0': createPreviewRelease('0.2.0'),
  });

  try {
    seedDesktopPackage(repoRoot, '0.1.0');
    commitAll(repoRoot, 'seed package');
    runCommand('git', ['push', '-u', 'origin', 'main'], { cwd: repoRoot });

    seedDesktopPackage(repoRoot, '0.2.0');
    commitAll(repoRoot, 'bump desktop version');
    pushTag(repoRoot, '0.2.0');

    const output = await runTagHelper(repoRoot, [], {
      DESKTOP_RELEASE_GITHUB_API_BASE_URL: server.baseUrl,
      GH_TOKEN: 'test-token',
    });
    assert.match(output, /Stable desktop promotion preflight passed for 'desktop-v0\.2\.0' via preview release '0\.2\.0'\./);
    assert.match(output, /Would create local tag 'desktop-v0\.2\.0'\./);
    assert.match(output, /Would push 'desktop-v0\.2\.0' to origin\./);
  } finally {
    await server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('desktop tag helper blocks stable backfills when the selected ref no longer matches the preview tag', async () => {
  const { root, repoRoot } = createRepoWithOrigin();
  const server = await createPreviewReleaseServer({
    '0.1.0': createPreviewRelease('0.1.0'),
  });

  try {
    seedDesktopPackage(repoRoot, '0.1.0');
    commitAll(repoRoot, 'seed package');
    runCommand('git', ['push', '-u', 'origin', 'main'], { cwd: repoRoot });
    pushTag(repoRoot, '0.1.0');

    fs.writeFileSync(path.join(repoRoot, 'notes.txt'), 'desktop runtime changed without version bump\n', 'utf8');
    commitAll(repoRoot, 'change runtime without bump');

    const result = await runTagHelperResult(repoRoot, [], {
      DESKTOP_RELEASE_GITHUB_API_BASE_URL: server.baseUrl,
      GH_TOKEN: 'test-token',
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /requires preview tag '0\.1\.0'.*selected ref 'HEAD'/);
  } finally {
    await server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('desktop tag helper skips when the remote tag already exists', async () => {
  const { root, repoRoot } = createRepoWithOrigin();
  const server = await createPreviewReleaseServer({
    '0.1.0': createPreviewRelease('0.1.0'),
  });

  try {
    seedDesktopPackage(repoRoot, '0.1.0');
    commitAll(repoRoot, 'seed package');
    runCommand('git', ['push', '-u', 'origin', 'main'], { cwd: repoRoot });
    pushTag(repoRoot, '0.1.0');
    runCommand('git', ['tag', 'desktop-v0.1.0'], { cwd: repoRoot });
    runCommand('git', ['push', 'origin', 'refs/tags/desktop-v0.1.0'], { cwd: repoRoot });

    const output = await runTagHelper(repoRoot, [], {
      DESKTOP_RELEASE_GITHUB_API_BASE_URL: server.baseUrl,
      GH_TOKEN: 'test-token',
    });
    assert.match(output, /Stable desktop promotion preflight passed for 'desktop-v0\.1\.0' via preview release '0\.1\.0'\./);
    assert.match(output, /Tag 'desktop-v0\.1\.0' already exists on origin; skipping\./);
  } finally {
    await server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
