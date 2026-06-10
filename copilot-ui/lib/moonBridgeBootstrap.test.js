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
  resolveBundledMetadataPath,
  getBootstrapStatus,
  bootstrapMoonBridge,
  installFromBundledBinary,
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
      readFileSync(filePath) {
        if (fakeFs._files.has(filePath)) return fakeFs._files.get(filePath);
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
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
    const root = resolveManagedMoonBridgeRoot(path.join(os.homedir(), '.elegy'));
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
  it('resolveConfigPath returns config.yml under the install root', () => {
    const cfg = resolveConfigPath('/root');
    assert.ok(cfg.endsWith('config.yml'));
  });
  // ---- getBootstrapStatus ----
  it('getBootstrapStatus resolves all paths and probes prerequisites', () => {
    const elegyHome = path.join(tmpDir, '.elegy');
    fakeFs._dirs.add(elegyHome);
    // Simulate git and go available by returning without error
    fakeExec.execSync = (cmd, opts) => {
      fakeExec._commands.push({ cmd, opts });
    };
    const status = getBootstrapStatus({
      elegyHome,
      platform: 'win32',
      fsImpl: fakeFs,
      execImpl: fakeExec,
    });
    assert.equal(status.installRoot, resolveManagedMoonBridgeRoot(elegyHome));
    assert.equal(status.sourceUrl, MOON_BRIDGE_SOURCE_URL);
    assert.equal(status.binaryPath, resolveBinaryPath(resolveManagedMoonBridgeRoot(elegyHome), 'win32'));
    assert.equal(status.gitAvailable, true);
    assert.equal(status.goAvailable, true);
    assert.equal(status.installed, false);
    assert.equal(status.built, false);
    assert.equal(status.lastBootstrapAt, null);
    assert.equal(status.lastError, null);
    assert.equal(status.bundledSourceAvailable, false);
    assert.equal(status.bundledInstalled, false);
  });
  it('getBootstrapStatus reports gitAvailable=false when git check throws', () => {
    fakeExec.execSync = (cmd) => {
      if (cmd.startsWith('git')) throw new Error('git not found');
    };
    const status = getBootstrapStatus({
      elegyHome: tmpDir,
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
      elegyHome: tmpDir,
      platform: 'win32',
      fsImpl: fakeFs,
      execImpl: fakeExec,
    });
    assert.equal(status.goAvailable, false);
  });
  it('getBootstrapStatus merges existingBootstrapState', () => {
    const status = getBootstrapStatus({
      elegyHome: tmpDir,
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
    const elegyHome = path.join(tmpDir, '.elegy');
    const installRoot = resolveManagedMoonBridgeRoot(elegyHome);
    fakeFs._dirs.add(path.join(installRoot, '.git'));
    const status = getBootstrapStatus({
      elegyHome,
      platform: 'win32',
      fsImpl: fakeFs,
      execImpl: fakeExec,
    });
    assert.equal(status.installed, true);
  });
  it('getBootstrapStatus reports built=true when binary exists', () => {
    const elegyHome = path.join(tmpDir, '.elegy');
    const installRoot = resolveManagedMoonBridgeRoot(elegyHome);
    const binaryPath = resolveBinaryPath(installRoot, 'win32');
    fakeFs._files.set(binaryPath, 'fake-binary-content');
    const status = getBootstrapStatus({
      elegyHome,
      platform: 'win32',
      fsImpl: fakeFs,
      execImpl: fakeExec,
    });
    assert.equal(status.built, true);
    assert.equal(status.bundledInstalled, false);
  });
  // ---- bootstrapMoonBridge ----
  it('bootstrapMoonBridge fails when git is not available', () => {
    // simulate git unavailable
    fakeExec.execSync = (cmd) => {
      if (cmd.startsWith('git')) throw new Error('git not found');
    };
    const result = bootstrapMoonBridge({
      elegyHome: tmpDir,
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
      elegyHome: tmpDir,
      platform: 'win32',
      fsImpl: fakeFs,
      execImpl: fakeExec,
      spawnImpl: fakeSpawn,
    });
    assert.equal(result.success, false);
    assert.match(result.error, /go 1\.25\+ is not available/);
    assert.equal(result.status.goAvailable, false);
  });
  it('bootstrapMoonBridge skips git clone when .git already exists', () => {
    const elegyHome = path.join(tmpDir, '.elegy');
    const installRoot = resolveManagedMoonBridgeRoot(elegyHome);
    fakeFs._dirs.add(path.join(installRoot, '.git')); // already installed
    fakeFs._dirs.add(path.join(installRoot, 'bin'));   // bin dir exists
    fakeSpawn.spawnSync = (cmd, args, opts) => {
      fakeSpawn._commands.push({ cmd, args, opts });
      return { status: 0, stdout: '', stderr: '' };
    };
    const result = bootstrapMoonBridge({
      elegyHome,
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
    const elegyHome = path.join(tmpDir, '.elegy');
    const installRoot = resolveManagedMoonBridgeRoot(elegyHome);
    fakeFs._dirs.add(path.join(installRoot, '.git'));
    fakeFs._files.set(resolveBinaryPath(installRoot, 'win32'), 'existing-binary');
    const result = bootstrapMoonBridge({
      elegyHome,
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
    const elegyHome = path.join(tmpDir, '.elegy');
    const installRoot = resolveManagedMoonBridgeRoot(elegyHome);
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
      elegyHome,
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
    const elegyHome = path.join(tmpDir, '.elegy');
    fakeExec.execSync = (cmd, opts) => {
      if (cmd.startsWith('git clone')) throw Object.assign(new Error('network error'), { stderr: 'timeout' });
    };
    const result = bootstrapMoonBridge({
      elegyHome,
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
    const elegyHome = path.join(tmpDir, '.elegy');
    const installRoot = resolveManagedMoonBridgeRoot(elegyHome);
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
      elegyHome,
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
  // ---- bundled binary install ----
  it('installFromBundledBinary copies binary and writes metadata', () => {
    const elegyHome = path.join(tmpDir, '.elegy');
    const bundledSource = path.join(tmpDir, 'bundled', 'moon-bridge.exe');
    fakeFs._dirs.add(path.dirname(bundledSource));
    fakeFs._files.set(bundledSource, 'fake-binary-content');
    const fakeCrypto = {
      createHash() {
        return {
          update() { return this; },
          digest() { return 'abc123def456'; },
        };
      },
    };
    const result = installFromBundledBinary({
      elegyHome,
      platform: 'win32',
      bundledSource,
      fsImpl: fakeFs,
      cryptoImpl: fakeCrypto,
    });
    assert.equal(result.success, true);
    assert.equal(result.status.bundledInstalled, true);
    assert.equal(result.status.built, true);
    const binaryPath = resolveBinaryPath(resolveManagedMoonBridgeRoot(elegyHome), 'win32');
    assert.ok(fakeFs._files.has(binaryPath), 'binary should be installed');
    const metadataPath = resolveBundledMetadataPath(resolveManagedMoonBridgeRoot(elegyHome));
    assert.ok(fakeFs._files.has(metadataPath), 'metadata should be written');
    const metadata = JSON.parse(fakeFs._files.get(metadataPath));
    assert.equal(metadata.method, 'bundled');
    assert.equal(metadata.source, bundledSource);
    assert.equal(metadata.sha256, 'abc123def456');
  });
  it('installFromBundledBinary fails when bundled source is missing', () => {
    const result = installFromBundledBinary({
      elegyHome: tmpDir,
      platform: 'win32',
      bundledSource: '/nonexistent/binary.exe',
      fsImpl: fakeFs,
    });
    assert.equal(result.success, false);
    assert.match(result.error, /not available/);
  });
  it('bootstrapMoonBridge uses bundled binary when bundledSource is provided', () => {
    const elegyHome = path.join(tmpDir, '.elegy');
    const bundledSource = path.join(tmpDir, 'bundled', 'moon-bridge.exe');
    fakeFs._dirs.add(path.dirname(bundledSource));
    fakeFs._files.set(bundledSource, 'fake-binary-content');
    const fakeCrypto = {
      createHash() {
        return {
          update() { return this; },
          digest() { return 'sha256hash'; },
        };
      },
    };
    const result = bootstrapMoonBridge({
      elegyHome,
      platform: 'win32',
      bundledSource,
      fsImpl: fakeFs,
      execImpl: fakeExec,
      spawnImpl: fakeSpawn,
      cryptoImpl: fakeCrypto,
    });
    assert.equal(result.success, true);
    assert.equal(result.status.bundledInstalled, true);
    // git clone should NOT be called
    const cloneCommands = fakeExec._commands.filter((c) => c.cmd.startsWith('git clone'));
    assert.equal(cloneCommands.length, 0, 'expected no git clone when using bundled binary');
    // go build should NOT be called
    const buildCommands = fakeSpawn._commands.filter((c) => c.cmd === 'go');
    assert.equal(buildCommands.length, 0, 'expected no go build when using bundled binary');
  });
  it('bootstrapMoonBridge skips bundled install when binary already exists', () => {
    const elegyHome = path.join(tmpDir, '.elegy');
    const installRoot = resolveManagedMoonBridgeRoot(elegyHome);
    const bundledSource = path.join(tmpDir, 'bundled', 'moon-bridge.exe');
    fakeFs._dirs.add(path.dirname(bundledSource));
    fakeFs._files.set(bundledSource, 'fake-binary-content');
    fakeFs._files.set(resolveBinaryPath(installRoot, 'win32'), 'existing-binary');
    const result = bootstrapMoonBridge({
      elegyHome,
      platform: 'win32',
      bundledSource,
      fsImpl: fakeFs,
      execImpl: fakeExec,
      spawnImpl: fakeSpawn,
    });
    assert.equal(result.success, true);
    assert.equal(result.status.built, true);
  });
  it('bootstrapMoonBridge falls back to source build when no bundledSource', () => {
    const elegyHome = path.join(tmpDir, '.elegy');
    const installRoot = resolveManagedMoonBridgeRoot(elegyHome);
    fakeExec.execSync = (cmd, opts) => {
      fakeExec._commands.push({ cmd, opts });
      fakeFs._dirs.add(path.join(installRoot, '.git'));
      fakeFs._dirs.add(path.join(installRoot, 'bin'));
    };
    fakeSpawn.spawnSync = (cmd, args, opts) => {
      fakeSpawn._commands.push({ cmd, args, opts });
      fakeFs._files.set(resolveBinaryPath(installRoot, 'win32'), 'binary');
      return { status: 0 };
    };
    const result = bootstrapMoonBridge({
      elegyHome,
      platform: 'win32',
      fsImpl: fakeFs,
      execImpl: fakeExec,
      spawnImpl: fakeSpawn,
    });
    assert.equal(result.success, true);
    assert.equal(result.status.installed, true);
    assert.equal(result.status.built, true);
  });
  it('getBootstrapStatus includes bundledInstalled and bundledSourceAvailable', () => {
    const elegyHome = path.join(tmpDir, '.elegy');
    const bundledSource = path.join(tmpDir, 'bundled', 'moon-bridge.exe');
    fakeFs._files.set(bundledSource, 'binary');
    const status = getBootstrapStatus({
      elegyHome,
      platform: 'win32',
      fsImpl: fakeFs,
      execImpl: fakeExec,
      bundledSource,
    });
    assert.equal(status.bundledSourceAvailable, true);
    assert.equal(status.bundledInstalled, false);
    assert.equal(status.metadataPath, resolveBundledMetadataPath(resolveManagedMoonBridgeRoot(elegyHome)));
  });
  it('getBootstrapStatus reports bundledInstalled when metadata and binary exist', () => {
    const elegyHome = path.join(tmpDir, '.elegy');
    const installRoot = resolveManagedMoonBridgeRoot(elegyHome);
    const binaryPath = resolveBinaryPath(installRoot, 'win32');
    const metadataPath = resolveBundledMetadataPath(installRoot);
    fakeFs._files.set(binaryPath, 'binary');
    fakeFs._files.set(metadataPath, '{"method":"bundled"}');
    const status = getBootstrapStatus({
      elegyHome,
      platform: 'win32',
      fsImpl: fakeFs,
      execImpl: fakeExec,
    });
    assert.equal(status.bundledInstalled, true);
    assert.equal(status.built, true);
  });
});
