'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  MOON_BRIDGE_SOURCE_URL,
  resolveManagedMoonBridgeRoot,
  resolveBinaryPath,
  resolveConfigPath,
  getBootstrapStatus,
  bootstrapMoonBridge,
} = require('./moonBridgeBootstrap');

describe('moonBridgeBootstrap', () => {
  let tmpDir;
  let fakeFs;
  let fakeExec;
  let fakeSpawn;

  function resetFakes() {
    fakeFs = {
      _files: new Map(),
      _dirs: new Set(),
      existsSync(filePath) {
        return fakeFs._files.has(filePath) || fakeFs._dirs.has(filePath);
      },
      mkdirSync(dirPath, options) {
        const parts = dirPath.split(path.sep);
        for (let i = 1; i <= parts.length; i++) {
          fakeFs._dirs.add(parts.slice(0, i).join(path.sep));
        }
      },
      writeFileSync(filePath, data) {
        fakeFs._files.set(filePath, String(data));
      },
      statSync(filePath) {
        if (fakeFs._files.has(filePath)) return { isFile: () => true, isDirectory: () => false };
        if (fakeFs._dirs.has(filePath)) return { isFile: () => false, isDirectory: () => true };
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      },
    };
    fakeExec = {
      _commands: [],
      execSync(cmd, opts) {
        fakeExec._commands.push({ cmd, opts });
        return '';
      },
    };
    fakeSpawn = {
      _commands: [],
      spawnSync(cmd, args, opts) {
        fakeSpawn._commands.push({ cmd, args, opts });
        return { status: 0, stdout: '', stderr: '' };
      },
    };
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-bootstrap-test-'));
    resetFakes();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ---- path helpers ----

  it('resolveManagedMoonBridgeRoot returns the expected subpath', () => {
    const root = resolveManagedMoonBridgeRoot(path.join(os.homedir(), '.copilot'));
    assert.ok(root.endsWith('managed-cli/moon-bridge') || root.endsWith('managed-cli\\moon-bridge'));
  });

  it('resolveBinaryPath returns .exe suffix on win32', () => {
    const binary = resolveBinaryPath('/root', 'win32');
    assert.ok(binary.endsWith('moon-bridge.exe'));
  });

  it('resolveBinaryPath omits .exe suffix on non-win32', () => {
    const binary = resolveBinaryPath('/root', 'darwin');
    assert.ok(!binary.includes('.exe'));
    assert.ok(binary.endsWith('moon-bridge'));
  });

  it('resolveConfigPath returns config.yaml under the install root', () => {
    const cfg = resolveConfigPath('/root');
    assert.ok(cfg.endsWith('config.yaml'));
  });

  // ---- getBootstrapStatus ----

  it('getBootstrapStatus resolves all paths and probes prerequisites', () => {
    const copilotHome = path.join(tmpDir, '.copilot');
    fakeFs._dirs.add(copilotHome);

    // Simulate git and go available by returning without error
    fakeExec.execSync = (cmd, opts) => {
      fakeExec._commands.push({ cmd, opts });
    };

    const status = getBootstrapStatus({
      copilotHome,
      platform: 'win32',
      fsImpl: fakeFs,
      execImpl: fakeExec,
    });

    assert.equal(status.installRoot, resolveManagedMoonBridgeRoot(copilotHome));
    assert.equal(status.sourceUrl, MOON_BRIDGE_SOURCE_URL);
    assert.equal(status.binaryPath, resolveBinaryPath(resolveManagedMoonBridgeRoot(copilotHome), 'win32'));
    assert.equal(status.gitAvailable, true);
    assert.equal(status.goAvailable, true);
    assert.equal(status.installed, false);
    assert.equal(status.built, false);
    assert.equal(status.lastBootstrapAt, null);
    assert.equal(status.lastError, null);
  });

  it('getBootstrapStatus reports gitAvailable=false when git check throws', () => {
    fakeExec.execSync = (cmd) => {
      if (cmd.startsWith('git')) throw new Error('git not found');
    };
    const status = getBootstrapStatus({
      copilotHome: tmpDir,
      platform: 'win32',
      fsImpl: fakeFs,
      execImpl: fakeExec,
    });
    assert.equal(status.gitAvailable, false);
  });

  it('getBootstrapStatus reports goAvailable=false when go check throws', () => {
    fakeExec.execSync = (cmd) => {
      if (cmd.startsWith('go')) throw new Error('go not found');
    };
    const status = getBootstrapStatus({
      copilotHome: tmpDir,
      platform: 'win32',
      fsImpl: fakeFs,
      execImpl: fakeExec,
    });
    assert.equal(status.goAvailable, false);
  });

  it('getBootstrapStatus merges existingBootstrapState', () => {
    const status = getBootstrapStatus({
      copilotHome: tmpDir,
      platform: 'win32',
      fsImpl: fakeFs,
      execImpl: fakeExec,
      existingBootstrapState: {
        lastBootstrapAt: '2025-06-01T00:00:00.000Z',
        lastError: 'test error',
      },
    });
    assert.equal(status.lastBootstrapAt, '2025-06-01T00:00:00.000Z');
    assert.equal(status.lastError, 'test error');
  });

  it('getBootstrapStatus reports installed=true when .git directory exists', () => {
    const copilotHome = path.join(tmpDir, '.copilot');
    const installRoot = resolveManagedMoonBridgeRoot(copilotHome);
    fakeFs._dirs.add(path.join(installRoot, '.git'));

    const status = getBootstrapStatus({
      copilotHome,
      platform: 'win32',
      fsImpl: fakeFs,
      execImpl: fakeExec,
    });
    assert.equal(status.installed, true);
  });

  it('getBootstrapStatus reports built=true when binary exists', () => {
    const copilotHome = path.join(tmpDir, '.copilot');
    const installRoot = resolveManagedMoonBridgeRoot(copilotHome);
    const binaryPath = resolveBinaryPath(installRoot, 'win32');
    fakeFs._files.set(binaryPath, 'fake-binary-content');

    const status = getBootstrapStatus({
      copilotHome,
      platform: 'win32',
      fsImpl: fakeFs,
      execImpl: fakeExec,
    });
    assert.equal(status.built, true);
  });

  // ---- bootstrapMoonBridge ----

  it('bootstrapMoonBridge fails when git is not available', () => {
    // simulate git unavailable
    fakeExec.execSync = (cmd) => {
      if (cmd.startsWith('git')) throw new Error('git not found');
    };
    const result = bootstrapMoonBridge({
      copilotHome: tmpDir,
      platform: 'win32',
      fsImpl: fakeFs,
      execImpl: fakeExec,
      spawnImpl: fakeSpawn,
    });
    assert.equal(result.success, false);
    assert.match(result.error, /git is not available/);
    assert.equal(result.status.gitAvailable, false);
  });

  it('bootstrapMoonBridge fails when go is not available', () => {
    // simulate go unavailable
    fakeExec.execSync = (cmd) => {
      if (cmd.startsWith('go')) throw new Error('go not found');
    };
    const result = bootstrapMoonBridge({
      copilotHome: tmpDir,
      platform: 'win32',
      fsImpl: fakeFs,
      execImpl: fakeExec,
      spawnImpl: fakeSpawn,
    });
    assert.equal(result.success, false);
    assert.match(result.error, /go is not available/);
    assert.equal(result.status.goAvailable, false);
  });

  it('bootstrapMoonBridge skips git clone when .git already exists', () => {
    const copilotHome = path.join(tmpDir, '.copilot');
    const installRoot = resolveManagedMoonBridgeRoot(copilotHome);
    fakeFs._dirs.add(path.join(installRoot, '.git')); // already installed
    fakeFs._dirs.add(path.join(installRoot, 'bin'));   // bin dir exists

    fakeSpawn.spawnSync = (cmd, args, opts) => {
      fakeSpawn._commands.push({ cmd, args, opts });
      return { status: 0, stdout: '', stderr: '' };
    };

    const result = bootstrapMoonBridge({
      copilotHome,
      platform: 'win32',
      fsImpl: fakeFs,
      execImpl: fakeExec,
      spawnImpl: fakeSpawn,
    });
    assert.equal(result.success, true);
    // git clone should not have been called since .git already exists
    const cloneCommands = fakeExec._commands.filter((c) => c.cmd.startsWith('git clone'));
    assert.equal(cloneCommands.length, 0, 'expected no git clone when already installed');
    assert.equal(result.status.installed, true);
    assert.equal(result.status.built, true);
  });

  it('bootstrapMoonBridge skips go build when binary already exists (and forceRebuild is false)', () => {
    const copilotHome = path.join(tmpDir, '.copilot');
    const installRoot = resolveManagedMoonBridgeRoot(copilotHome);
    fakeFs._dirs.add(path.join(installRoot, '.git'));
    fakeFs._files.set(resolveBinaryPath(installRoot, 'win32'), 'existing-binary');

    const result = bootstrapMoonBridge({
      copilotHome,
      platform: 'win32',
      fsImpl: fakeFs,
      execImpl: fakeExec,
      spawnImpl: fakeSpawn,
    });
    assert.equal(result.success, true);
    // go build should not have been called
    const buildCommands = fakeSpawn._commands.filter((c) => c.cmd === 'go');
    assert.equal(buildCommands.length, 0, 'expected no go build when binary already exists');
    assert.equal(result.status.built, true);
  });

  it('bootstrapMoonBridge performs git clone when .git is absent', () => {
    const copilotHome = path.join(tmpDir, '.copilot');
    const installRoot = resolveManagedMoonBridgeRoot(copilotHome);

    // execSync is called for git clone; spawnSync for go build
    fakeExec.execSync = (cmd, opts) => {
      fakeExec._commands.push({ cmd, opts });
      // simulate creating the .git directory after clone
      fakeFs._dirs.add(path.join(installRoot, '.git'));
      fakeFs._dirs.add(path.join(installRoot, 'bin'));
    };
    fakeSpawn.spawnSync = (cmd, args, opts) => {
      fakeSpawn._commands.push({ cmd, args, opts });
      // simulate creating the binary
      fakeFs._files.set(resolveBinaryPath(installRoot, 'win32'), 'binary');
      return { status: 0 };
    };

    const result = bootstrapMoonBridge({
      copilotHome,
      platform: 'win32',
      fsImpl: fakeFs,
      execImpl: fakeExec,
      spawnImpl: fakeSpawn,
    });
    assert.equal(result.success, true);
    assert.equal(result.status.installed, true);
    assert.equal(result.status.built, true);
    assert.ok(result.status.lastBootstrapAt, 'expected lastBootstrapAt timestamp');
    assert.equal(result.status.lastError, null);

    const cloneCommands = fakeExec._commands.filter((c) => c.cmd.startsWith('git'));
    assert.ok(cloneCommands.length > 0, 'expected git clone command');
    const buildCommands = fakeSpawn._commands.filter((c) => c.cmd === 'go');
    assert.ok(buildCommands.length > 0, 'expected go build command');
  });

  it('bootstrapMoonBridge returns failure when git clone throws', () => {
    const copilotHome = path.join(tmpDir, '.copilot');
    fakeExec.execSync = (cmd, opts) => {
      if (cmd.startsWith('git clone')) throw Object.assign(new Error('network error'), { stderr: 'timeout' });
    };

    const result = bootstrapMoonBridge({
      copilotHome,
      platform: 'win32',
      fsImpl: fakeFs,
      execImpl: fakeExec,
      spawnImpl: fakeSpawn,
    });

    assert.equal(result.success, false);
    assert.match(result.error, /git clone failed/);
    assert.match(result.status.lastError, /git clone failed/);
    assert.equal(result.status.installed, false);
  });

  it('bootstrapMoonBridge returns failure when go build fails', () => {
    const copilotHome = path.join(tmpDir, '.copilot');
    const installRoot = resolveManagedMoonBridgeRoot(copilotHome);
    fakeExec.execSync = (cmd, opts) => {
      if (cmd.startsWith('git')) {
        fakeFs._dirs.add(path.join(installRoot, '.git'));
        fakeFs._dirs.add(path.join(installRoot, 'bin'));
      }
    };
    fakeSpawn.spawnSync = (cmd, args, opts) => {
      return { status: 1, stderr: 'compile error: undefined reference' };
    };

    const result = bootstrapMoonBridge({
      copilotHome,
      platform: 'win32',
      fsImpl: fakeFs,
      execImpl: fakeExec,
      spawnImpl: fakeSpawn,
    });

    assert.equal(result.success, false);
    assert.match(result.error, /go build failed/);
    assert.match(result.status.lastError, /go build failed/);
    assert.equal(result.status.installed, true);
    assert.equal(result.status.built, false);
  });
});
