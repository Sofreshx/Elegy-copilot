const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const scriptPath = path.join(__dirname, 'create-desktop-release-tag.js');

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
  });
}

function runTagHelper(repoRoot, args = []) {
  return runCommand(process.execPath, [scriptPath, '--desktop-release', '--dry-run', ...args], {
    cwd: repoRoot,
  }).stdout;
}

test('desktop tag helper proposes creating a tag after a version bump', () => {
  const { root, repoRoot } = createRepoWithOrigin();

  try {
    seedDesktopPackage(repoRoot, '0.1.0');
    commitAll(repoRoot, 'seed package');
    runCommand('git', ['push', '-u', 'origin', 'main'], { cwd: repoRoot });

    seedDesktopPackage(repoRoot, '0.2.0');
    commitAll(repoRoot, 'bump desktop version');

    const output = runTagHelper(repoRoot);
    assert.match(output, /Would create local tag 'desktop-v0\.2\.0'\./);
    assert.match(output, /Would push 'desktop-v0\.2\.0' to origin\./);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('desktop tag helper backfills a missing tag even without a version bump', () => {
  const { root, repoRoot } = createRepoWithOrigin();

  try {
    seedDesktopPackage(repoRoot, '0.1.0');
    commitAll(repoRoot, 'seed package');
    runCommand('git', ['push', '-u', 'origin', 'main'], { cwd: repoRoot });

    fs.writeFileSync(path.join(repoRoot, 'notes.txt'), 'desktop runtime changed without version bump\n', 'utf8');
    commitAll(repoRoot, 'change runtime without bump');

    const output = runTagHelper(repoRoot);
    assert.match(output, /No desktop version bump detected \(0\.1\.0\); creating missing tag 'desktop-v0\.1\.0' anyway\./);
    assert.match(output, /Would create local tag 'desktop-v0\.1\.0'\./);
    assert.match(output, /Would push 'desktop-v0\.1\.0' to origin\./);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('desktop tag helper skips when the remote tag already exists', () => {
  const { root, repoRoot } = createRepoWithOrigin();

  try {
    seedDesktopPackage(repoRoot, '0.1.0');
    commitAll(repoRoot, 'seed package');
    runCommand('git', ['push', '-u', 'origin', 'main'], { cwd: repoRoot });
    runCommand('git', ['tag', 'desktop-v0.1.0'], { cwd: repoRoot });
    runCommand('git', ['push', 'origin', 'refs/tags/desktop-v0.1.0'], { cwd: repoRoot });

    const output = runTagHelper(repoRoot);
    assert.match(output, /Tag 'desktop-v0\.1\.0' already exists on origin; skipping\./);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
