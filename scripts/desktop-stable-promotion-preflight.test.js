const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { verifyStableDesktopPromotionPreflight } = require('./desktop-stable-promotion-preflight');

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 120000,
    ...options,
  });

  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed with code ${result.status}\nstdout:\n${result.stdout || ''}\nstderr:\n${result.stderr || ''}`,
    );
  }

  return result;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function commitAll(repoRoot, message) {
  runCommand('git', ['add', '.'], { cwd: repoRoot });
  runCommand('git', ['commit', '-m', message], { cwd: repoRoot });
}

function createRepoWithOrigin() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-stable-preflight-'));
  const repoRoot = path.join(root, 'repo');
  const originRoot = path.join(root, 'origin.git');

  fs.mkdirSync(repoRoot, { recursive: true });
  runCommand('git', ['init', '--bare', originRoot]);
  runCommand('git', ['init', '--initial-branch=main'], { cwd: repoRoot });
  runCommand('git', ['config', 'user.name', 'Copilot Test'], { cwd: repoRoot });
  runCommand('git', ['config', 'user.email', 'copilot@example.com'], { cwd: repoRoot });
  runCommand('git', ['remote', 'add', 'origin', originRoot], { cwd: repoRoot });

  return { root, repoRoot };
}

function seedDesktopPackage(repoRoot, version, publishRepository = 'test-owner/test-repo') {
  writeJson(path.join(repoRoot, 'copilot-ui', 'package.json'), {
    name: 'elegy-copilot-desktop',
    version,
    desktopRelease: {
      publishRepository,
    },
  });
}

function pushTag(repoRoot, tagName) {
  runCommand('git', ['tag', tagName], { cwd: repoRoot });
  runCommand('git', ['push', 'origin', `refs/tags/${tagName}`], { cwd: repoRoot });
}

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
  };
}

function createRelease(tagName, overrides = {}) {
  return {
    id: 11,
    tag_name: tagName,
    html_url: `https://github.com/test-owner/test-repo/releases/tag/${tagName}`,
    draft: false,
    prerelease: true,
    assets: [
      { name: 'release-manifest.json' },
      { name: `Elegy Copilot_${tagName}_x64-setup.exe` },
      { name: 'windows-installation-guide.md' },
    ],
    ...overrides,
  };
}

test('stable desktop promotion preflight skips prerelease desktop tags', async () => {
  const { root, repoRoot } = createRepoWithOrigin();

  try {
    seedDesktopPackage(repoRoot, '1.2.3-rc.1');
    commitAll(repoRoot, 'seed prerelease package');

    let fetchCalled = false;
    const result = await verifyStableDesktopPromotionPreflight({
      fetchImpl: async () => {
        fetchCalled = true;
        return jsonResponse({});
      },
      githubToken: 'token',
      repoRoot,
    });

    assert.equal(result.status, 'skipped');
    assert.equal(fetchCalled, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('stable desktop promotion preflight passes when preview tag, selected ref, and published assets line up', async () => {
  const { root, repoRoot } = createRepoWithOrigin();

  try {
    seedDesktopPackage(repoRoot, '1.2.3');
    commitAll(repoRoot, 'seed stable package');
    runCommand('git', ['push', '-u', 'origin', 'main'], { cwd: repoRoot });
    pushTag(repoRoot, '1.2.3');

    const result = await verifyStableDesktopPromotionPreflight({
      fetchImpl: async () => jsonResponse(createRelease('1.2.3')),
      githubToken: 'token',
      repoRoot,
      selectedRef: 'HEAD',
    });

    assert.equal(result.status, 'passed');
    assert.equal(result.desktopTag, 'desktop-v1.2.3');
    assert.equal(result.previewTag, '1.2.3');
    assert.equal(result.attempts, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('stable desktop promotion preflight retries while preview release assets become visible', async () => {
  const { root, repoRoot } = createRepoWithOrigin();

  try {
    seedDesktopPackage(repoRoot, '1.2.3');
    commitAll(repoRoot, 'seed stable package');
    runCommand('git', ['push', '-u', 'origin', 'main'], { cwd: repoRoot });
    pushTag(repoRoot, '1.2.3');

    let fetchCount = 0;
    const waits = [];
    const result = await verifyStableDesktopPromotionPreflight({
      assetVisibilityAttempts: 2,
      assetVisibilityDelayMs: 5,
      fetchImpl: async () => {
        fetchCount += 1;
        if (fetchCount === 1) {
          return jsonResponse(createRelease('1.2.3', { assets: [{ name: 'release-manifest.json' }] }));
        }
        return jsonResponse(createRelease('1.2.3'));
      },
      githubToken: 'token',
      repoRoot,
      selectedRef: 'HEAD',
      wait: async (delayMs) => {
        waits.push(delayMs);
      },
    });

    assert.equal(result.status, 'passed');
    assert.equal(result.attempts, 2);
    assert.deepEqual(waits, [5]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('stable desktop promotion preflight fails when the preview tag does not match the selected ref commit', async () => {
  const { root, repoRoot } = createRepoWithOrigin();

  try {
    seedDesktopPackage(repoRoot, '1.2.3');
    commitAll(repoRoot, 'seed stable package');
    runCommand('git', ['push', '-u', 'origin', 'main'], { cwd: repoRoot });
    pushTag(repoRoot, '1.2.3');

    fs.writeFileSync(path.join(repoRoot, 'notes.txt'), 'selected ref moved after preview tag\n', 'utf8');
    commitAll(repoRoot, 'change after preview tag');

    await assert.rejects(
      verifyStableDesktopPromotionPreflight({
        fetchImpl: async () => jsonResponse(createRelease('1.2.3')),
        githubToken: 'token',
        repoRoot,
        selectedRef: 'HEAD',
      }),
      /requires preview tag '1\.2\.3'.*selected ref 'HEAD'/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('stable desktop promotion preflight fails when the desktop tag points at a different commit than the preview tag', async () => {
  const { root, repoRoot } = createRepoWithOrigin();

  try {
    seedDesktopPackage(repoRoot, '1.2.3');
    commitAll(repoRoot, 'seed stable package');
    runCommand('git', ['push', '-u', 'origin', 'main'], { cwd: repoRoot });
    pushTag(repoRoot, '1.2.3');

    fs.writeFileSync(path.join(repoRoot, 'notes.txt'), 'desktop tag drift\n', 'utf8');
    commitAll(repoRoot, 'drift desktop tag');
    runCommand('git', ['tag', 'desktop-v1.2.3'], { cwd: repoRoot });

    await assert.rejects(
      verifyStableDesktopPromotionPreflight({
        fetchImpl: async () => jsonResponse(createRelease('1.2.3')),
        githubToken: 'token',
        repoRoot,
      }),
      /requires preview tag '1\.2\.3'.*desktop tag 'desktop-v1\.2\.3'/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('stable desktop promotion preflight can query public preview metadata without GitHub auth', async () => {
  const { root, repoRoot } = createRepoWithOrigin();

  try {
    seedDesktopPackage(repoRoot, '1.2.3');
    commitAll(repoRoot, 'seed stable package');
    runCommand('git', ['push', '-u', 'origin', 'main'], { cwd: repoRoot });
    pushTag(repoRoot, '1.2.3');

    let requestHeaders = null;

    const result = await verifyStableDesktopPromotionPreflight({
      commandRunner() {
        return { ok: false, output: '' };
      },
      fetchImpl: async (_url, options) => {
        requestHeaders = options.headers;
        return jsonResponse(createRelease('1.2.3'));
      },
      repoRoot,
      selectedRef: 'HEAD',
    });

    assert.equal(result.status, 'passed');
    assert.equal(requestHeaders.Authorization, undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
