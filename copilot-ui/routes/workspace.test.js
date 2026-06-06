'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const {
  validateCommand,
  validateCwd,
  containsShellMeta,
  handleGetCommands,
  handleRunCommand,
  handleGetLaunchers,
  handleLaunch,
  readWorkspaceConfig,
  normalizeCommand,
  detectPackageScripts,
  buildLauncherCommand,
  detectTerminal,
} = require('./workspace');

function createMockCtx(queryParams = {}) {
  const res = {
    statusCode: null,
    body: null,
  };
  res.status = (code) => { res.statusCode = code; return res; };
  const searchParams = new URLSearchParams(queryParams);
  return {
    res,
    u: { searchParams },
    req: {},
  };
}

function captureSendJson() {
  const calls = [];
  function sendJson(res, status, body) {
    calls.push({ res, status, body });
    res.statusCode = status;
    res.body = body;
  }
  return { sendJson, calls };
}

function captureReadJsonBody(body) {
  async function readJsonBody() {
    return body;
  }
  return { readJsonBody };
}

describe('workspace route validation', () => {
  describe('containsShellMeta', () => {
    it('returns false for safe strings', () => {
      assert.equal(containsShellMeta('npm'), false);
      assert.equal(containsShellMeta('node'), false);
      assert.equal(containsShellMeta('echo hello'), false);
      assert.equal(containsShellMeta('--verbose'), false);
    });

    it('returns true for shell metacharacters', () => {
      assert.equal(containsShellMeta('echo hello; rm -rf /'), true);
      assert.equal(containsShellMeta('cat $(whoami)'), true);
      assert.equal(containsShellMeta('ls | grep foo'), true);
      assert.equal(containsShellMeta('echo `id`'), true);
      assert.equal(containsShellMeta('curl http://example.com?foo=bar'), true);
      assert.equal(containsShellMeta('echo {a,b}'), true);
      assert.equal(containsShellMeta('echo $HOME'), true);
      assert.equal(containsShellMeta('echo hello>file'), true);
      assert.equal(containsShellMeta('echo hello<file'), true);
      assert.equal(containsShellMeta('echo hello!'), true);
    });

    it('returns false for quotes and backslashes (safe with shell:false)', () => {
      assert.equal(containsShellMeta('echo "hello"'), false);
      assert.equal(containsShellMeta("echo 'hello'"), false);
      assert.equal(containsShellMeta('path\\to\\file'), false);
    });
  });

  describe('validateCommand', () => {
    it('rejects empty command', () => {
      const result = validateCommand('', []);
      assert.equal(result.ok, false);
      assert.match(result.error, /empty/);
    });

    it('rejects non-array args', () => {
      const result = validateCommand('npm', 'not-an-array');
      assert.equal(result.ok, false);
      assert.match(result.error, /array/);
    });

    it('rejects non-string args', () => {
      const result = validateCommand('npm', [123]);
      assert.equal(result.ok, false);
      assert.match(result.error, /strings/);
    });

    it('rejects command with shell metacharacters', () => {
      const result = validateCommand('echo; rm -rf /', []);
      assert.equal(result.ok, false);
      assert.match(result.error, /metacharacters/);
    });

    it('rejects args with shell metacharacters', () => {
      const result = validateCommand('echo', ['hello; rm -rf /']);
      assert.equal(result.ok, false);
      assert.match(result.error, /metacharacters/);
    });

    it('rejects command with path traversal', () => {
      const result = validateCommand('../../../bin/evil', []);
      assert.equal(result.ok, false);
      assert.match(result.error, /escapes/);
    });

    it('accepts safe command with args', () => {
      const result = validateCommand('npm', ['run', 'test']);
      assert.equal(result.ok, true);
    });

    it('accepts node command with script path', () => {
      const result = validateCommand('node', ['scripts/build.js']);
      assert.equal(result.ok, true);
    });
  });

  describe('validateCwd', () => {
    it('accepts empty cwd (defaults to root)', () => {
      const result = validateCwd(null, '/repo');
      assert.equal(result.ok, true);
      assert.equal(result.resolved, '/repo');
    });

    it('accepts relative cwd inside root', () => {
      const result = validateCwd('src', '/repo');
      assert.equal(result.ok, true);
      assert.equal(result.resolved, path.resolve('/repo', 'src'));
    });

    it('rejects cwd that escapes root', () => {
      const result = validateCwd('../../etc', '/repo');
      assert.equal(result.ok, false);
      assert.match(result.error, /escapes/);
    });

    it('rejects absolute cwd outside root', () => {
      const result = validateCwd('/etc', '/repo');
      assert.equal(result.ok, false);
      assert.match(result.error, /escapes/);
    });
  });
});

describe('workspace route handlers', () => {
  describe('handleGetCommands', () => {
    it('returns 400 when repoPath is missing', () => {
      const ctx = createMockCtx();
      const { sendJson, calls } = captureSendJson();
      handleGetCommands(ctx, { sendJson });
      assert.equal(calls.length, 1);
      assert.equal(calls[0].status, 400);
      assert.match(calls[0].body.error, /repoPath/);
    });

    it('returns 404 when repo path does not exist', () => {
      const ctx = createMockCtx({ repoPath: '/nonexistent/path/that/does/not/exist' });
      const { sendJson, calls } = captureSendJson();
      handleGetCommands(ctx, { sendJson });
      assert.equal(calls.length, 1);
      assert.equal(calls[0].status, 404);
    });

    it('returns commands and detected scripts for valid repo', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-test-'));
      const configPath = path.join(tmpDir, 'elegy.workspace.json');
      fs.writeFileSync(configPath, JSON.stringify({
        commands: [
          { id: 'test', label: 'Run Tests', kind: 'test', command: 'npm', args: ['test'] },
        ],
      }));
      const pkgPath = path.join(tmpDir, 'package.json');
      fs.writeFileSync(pkgPath, JSON.stringify({ scripts: { build: 'tsc', lint: 'eslint .' } }));

      try {
        const ctx = createMockCtx({ repoPath: tmpDir });
        const { sendJson, calls } = captureSendJson();
        handleGetCommands(ctx, { sendJson });
        assert.equal(calls.length, 1);
        assert.equal(calls[0].status, 200);
        assert.equal(calls[0].body.hasConfig, true);
        assert.equal(calls[0].body.commands.length, 1);
        assert.equal(calls[0].body.commands[0].id, 'test');
        assert.ok(calls[0].body.detected.length >= 2);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('handleRunCommand', () => {
    it('returns 400 when body is missing repoPath', async () => {
      const ctx = createMockCtx();
      const { sendJson, calls } = captureSendJson();
      const readJsonBody = async () => ({});
      await handleRunCommand(ctx, { sendJson, readJsonBody });
      assert.equal(calls.length, 1);
      assert.equal(calls[0].status, 400);
      assert.match(calls[0].body.error, /repoPath/);
    });

    it('returns 400 when body is missing commandId', async () => {
      const ctx = createMockCtx();
      const { sendJson, calls } = captureSendJson();
      const readJsonBody = async () => ({ repoPath: '/some/path' });
      await handleRunCommand(ctx, { sendJson, readJsonBody });
      assert.equal(calls.length, 1);
      assert.equal(calls[0].status, 400);
      assert.match(calls[0].body.error, /commandId/);
    });

    it('returns 404 when no workspace config exists', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-test-'));
      try {
        const ctx = createMockCtx();
        const { sendJson, calls } = captureSendJson();
        const readJsonBody = async () => ({ repoPath: tmpDir, commandId: 'test' });
        await handleRunCommand(ctx, { sendJson, readJsonBody });
        assert.equal(calls.length, 1);
        assert.equal(calls[0].status, 404);
        assert.match(calls[0].body.error, /elegy.workspace.json/);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('returns 404 when command not found in config', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-test-'));
      const configPath = path.join(tmpDir, 'elegy.workspace.json');
      fs.writeFileSync(configPath, JSON.stringify({
        commands: [{ id: 'other', label: 'Other', kind: 'custom', command: 'echo', args: ['hi'] }],
      }));
      try {
        const ctx = createMockCtx();
        const { sendJson, calls } = captureSendJson();
        const readJsonBody = async () => ({ repoPath: tmpDir, commandId: 'nonexistent' });
        await handleRunCommand(ctx, { sendJson, readJsonBody });
        assert.equal(calls.length, 1);
        assert.equal(calls[0].status, 404);
        assert.match(calls[0].body.error, /nonexistent/);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('returns 403 when command has shell metacharacters', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-test-'));
      const configPath = path.join(tmpDir, 'elegy.workspace.json');
      fs.writeFileSync(configPath, JSON.stringify({
        commands: [{ id: 'evil', label: 'Evil', kind: 'custom', command: 'echo; rm -rf /', args: [] }],
      }));
      try {
        const ctx = createMockCtx();
        const { sendJson, calls } = captureSendJson();
        const readJsonBody = async () => ({ repoPath: tmpDir, commandId: 'evil' });
        await handleRunCommand(ctx, { sendJson, readJsonBody });
        assert.equal(calls.length, 1);
        assert.equal(calls[0].status, 403);
        assert.match(calls[0].body.error, /metacharacters/);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('runs a safe declared command successfully', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-test-'));
      const scriptPath = path.join(tmpDir, 'hello.js');
      fs.writeFileSync(scriptPath, 'console.log("hello")');
      const configPath = path.join(tmpDir, 'elegy.workspace.json');
      fs.writeFileSync(configPath, JSON.stringify({
        commands: [{ id: 'hello', label: 'Say Hello', kind: 'custom', command: 'node', args: [scriptPath] }],
      }));
      try {
        const ctx = createMockCtx();
        const { sendJson, calls } = captureSendJson();
        const readJsonBody = async () => ({ repoPath: tmpDir, commandId: 'hello' });
        await handleRunCommand(ctx, { sendJson, readJsonBody });
        assert.equal(calls.length, 1);
        assert.equal(calls[0].status, 200);
        assert.equal(calls[0].body.exitCode, 0);
        assert.ok(calls[0].body.stdout.includes('hello'));
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('handles spawn error for nonexistent binary', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-test-'));
      const configPath = path.join(tmpDir, 'elegy.workspace.json');
      fs.writeFileSync(configPath, JSON.stringify({
        commands: [{ id: 'bad', label: 'Bad Binary', kind: 'custom', command: 'nonexistent_binary_xyz', args: [] }],
      }));
      try {
        const ctx = createMockCtx();
        const { sendJson, calls } = captureSendJson();
        const readJsonBody = async () => ({ repoPath: tmpDir, commandId: 'bad' });
        await handleRunCommand(ctx, { sendJson, readJsonBody });
        assert.equal(calls.length, 1);
        assert.equal(calls[0].status, 500);
        assert.equal(calls[0].body.exitCode, -2);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('handleGetLaunchers', () => {
    it('returns a list of launchers', () => {
      const ctx = createMockCtx();
      const { sendJson, calls } = captureSendJson();
      handleGetLaunchers(ctx, { sendJson });
      assert.equal(calls.length, 1);
      assert.equal(calls[0].status, 200);
      assert.ok(Array.isArray(calls[0].body.launchers));
      assert.ok(calls[0].body.launchers.length > 0);
      for (const l of calls[0].body.launchers) {
        assert.ok(typeof l.id === 'string');
        assert.ok(typeof l.label === 'string');
        assert.ok(typeof l.available === 'boolean');
      }
    });
  });

  describe('handleLaunch', () => {
    it('returns 400 when launcherId is missing', async () => {
      const ctx = createMockCtx();
      const { sendJson, calls } = captureSendJson();
      const readJsonBody = async () => ({ repoPath: '/some/path' });
      await handleLaunch(ctx, { sendJson, readJsonBody });
      assert.equal(calls.length, 1);
      assert.equal(calls[0].status, 400);
      assert.match(calls[0].body.error, /launcherId/);
    });

    it('returns 400 when repoPath is missing', async () => {
      const ctx = createMockCtx();
      const { sendJson, calls } = captureSendJson();
      const readJsonBody = async () => ({ launcherId: 'vscode' });
      await handleLaunch(ctx, { sendJson, readJsonBody });
      assert.equal(calls.length, 1);
      assert.equal(calls[0].status, 400);
      assert.match(calls[0].body.error, /repoPath/);
    });

    it('returns 404 when repo path does not exist', async () => {
      const ctx = createMockCtx();
      const { sendJson, calls } = captureSendJson();
      const readJsonBody = async () => ({ launcherId: 'vscode', repoPath: '/nonexistent/path' });
      await handleLaunch(ctx, { sendJson, readJsonBody });
      assert.equal(calls.length, 1);
      assert.equal(calls[0].status, 404);
    });

    it('returns 404 for unknown launcher', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-test-'));
      try {
        const ctx = createMockCtx();
        const { sendJson, calls } = captureSendJson();
        const readJsonBody = async () => ({ launcherId: 'nonexistent', repoPath: tmpDir });
        await handleLaunch(ctx, { sendJson, readJsonBody });
        assert.equal(calls.length, 1);
        assert.equal(calls[0].status, 404);
        assert.match(calls[0].body.error, /nonexistent/);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('buildLauncherCommand', () => {
    const repoPath = 'C:\\Users\\test\\my-repo';

    function makeLauncher(overrides = {}) {
      return {
        id: 'opencode',
        label: 'OpenCode CLI',
        group: 'agents',
        command: 'opencode',
        available: true,
        argsPreview: '<repo-path>',
        ...overrides,
      };
    }

    describe('Windows (win32)', () => {
      const platform = 'win32';

      it('uses wt.exe when available for agent CLI (OpenCode)', () => {
        const launcher = makeLauncher();
        const terminal = { cmd: 'wt.exe', type: 'wt' };
        const result = buildLauncherCommand(launcher, repoPath, platform, terminal);
        assert.equal(result.cmd, 'wt.exe');
        assert.deepEqual(result.args, ['-d', repoPath, 'pwsh', '-NoExit', '-Command', 'opencode .']);
      });

      it('uses wt.exe when available for agent CLI (Codex)', () => {
        const launcher = makeLauncher({ id: 'codex', label: 'Codex CLI', command: 'codex' });
        const terminal = { cmd: 'wt.exe', type: 'wt' };
        const result = buildLauncherCommand(launcher, repoPath, platform, terminal);
        assert.equal(result.cmd, 'wt.exe');
        assert.deepEqual(result.args, ['-d', repoPath, 'pwsh', '-NoExit', '-Command', 'codex']);
      });

      it('uses wt.exe when available for agent CLI (Copilot)', () => {
        const launcher = makeLauncher({ id: 'copilot', label: 'Copilot CLI', command: 'copilot' });
        const terminal = { cmd: 'wt.exe', type: 'wt' };
        const result = buildLauncherCommand(launcher, repoPath, platform, terminal);
        assert.equal(result.cmd, 'wt.exe');
        assert.deepEqual(result.args, ['-d', repoPath, 'pwsh', '-NoExit', '-Command', 'copilot']);
      });

      it('falls back to pwsh.exe for agent CLI when wt.exe unavailable', () => {
        const launcher = makeLauncher();
        const terminal = { cmd: 'pwsh.exe', type: 'pwsh' };
        const result = buildLauncherCommand(launcher, repoPath, platform, terminal);
        assert.equal(result.cmd, 'pwsh.exe');
        assert.equal(result.args[0], '-NoExit');
        assert.equal(result.args[1], '-Command');
        assert.ok(result.args[2].includes('Set-Location'));
        assert.ok(result.args[2].includes(repoPath));
        assert.ok(result.args[2].includes('opencode .'));
      });

      it('falls back to powershell.exe for agent CLI', () => {
        const launcher = makeLauncher();
        const terminal = { cmd: 'powershell.exe', type: 'powershell' };
        const result = buildLauncherCommand(launcher, repoPath, platform, terminal);
        assert.equal(result.cmd, 'powershell.exe');
        assert.equal(result.args[0], '-NoExit');
        assert.equal(result.args[1], '-Command');
        assert.ok(result.args[2].includes('Set-Location'));
        assert.ok(result.args[2].includes('opencode .'));
      });

      it('uses wt.exe for terminal launcher', () => {
        const launcher = makeLauncher({ id: 'terminal', label: 'Terminal', group: 'terminals', command: 'terminal' });
        const terminal = { cmd: 'wt.exe', type: 'wt' };
        const result = buildLauncherCommand(launcher, repoPath, platform, terminal);
        assert.equal(result.cmd, 'wt.exe');
        assert.deepEqual(result.args, ['-d', repoPath, 'pwsh', '-NoExit']);
      });

      it('falls back to pwsh.exe for terminal launcher', () => {
        const launcher = makeLauncher({ id: 'terminal', label: 'Terminal', group: 'terminals', command: 'terminal' });
        const terminal = { cmd: 'pwsh.exe', type: 'pwsh' };
        const result = buildLauncherCommand(launcher, repoPath, platform, terminal);
        assert.equal(result.cmd, 'pwsh.exe');
        assert.equal(result.args[0], '-NoExit');
        assert.equal(result.args[1], '-Command');
        assert.ok(result.args[2].includes('Set-Location'));
        assert.ok(result.args[2].includes(repoPath));
        // Terminal: should NOT include an agent command
        assert.ok(!result.args[2].includes('opencode'));
        assert.ok(!result.args[2].includes('codex'));
      });

      it('IDE launcher passes repo path directly on Windows', () => {
        const launcher = makeLauncher({ id: 'vscode', label: 'VS Code', group: 'ides', command: 'code' });
        const terminal = { cmd: 'wt.exe', type: 'wt' };
        const result = buildLauncherCommand(launcher, repoPath, platform, terminal);
        assert.equal(result.cmd, 'code');
        assert.deepEqual(result.args, [repoPath]);
      });
    });

    describe('macOS (darwin)', () => {
      const platform = 'darwin';

      it('IDE launcher passes repo path directly on macOS', () => {
        const launcher = makeLauncher({ id: 'cursor', label: 'Cursor', group: 'ides', command: 'cursor' });
        const result = buildLauncherCommand(launcher, repoPath, platform, null);
        assert.equal(result.cmd, 'cursor');
        assert.deepEqual(result.args, [repoPath]);
      });

      it('terminal launcher uses open -a Terminal on macOS', () => {
        const launcher = makeLauncher({ id: 'terminal', label: 'Terminal', group: 'terminals', command: 'terminal' });
        const result = buildLauncherCommand(launcher, repoPath, platform, null);
        assert.equal(result.cmd, 'open');
        assert.deepEqual(result.args, ['-a', 'Terminal', repoPath]);
      });

      it('agent CLI uses osascript on macOS', () => {
        const launcher = makeLauncher();
        const result = buildLauncherCommand(launcher, repoPath, platform, null);
        assert.equal(result.cmd, 'osascript');
        assert.equal(result.args[0], '-e');
        assert.ok(result.args[1].includes('Terminal'));
        assert.ok(result.args[1].includes('opencode'));
      });
    });

    describe('Linux', () => {
      const platform = 'linux';

      it('IDE launcher passes repo path directly on Linux', () => {
        const launcher = makeLauncher({ id: 'codium', label: 'VSCodium', group: 'ides', command: 'codium' });
        const result = buildLauncherCommand(launcher, repoPath, platform, null);
        assert.equal(result.cmd, 'codium');
        assert.deepEqual(result.args, [repoPath]);
      });

      it('terminal launcher uses x-terminal-emulator on Linux', () => {
        const launcher = makeLauncher({ id: 'terminal', label: 'Terminal', group: 'terminals', command: 'terminal' });
        const result = buildLauncherCommand(launcher, repoPath, platform, null);
        assert.equal(result.cmd, 'x-terminal-emulator');
        assert.deepEqual(result.args, ['--working-directory', repoPath]);
      });

      it('agent CLI uses x-terminal-emulator -e on Linux', () => {
        const launcher = makeLauncher();
        const result = buildLauncherCommand(launcher, repoPath, platform, null);
        assert.equal(result.cmd, 'x-terminal-emulator');
        assert.deepEqual(result.args, ['--working-directory', repoPath, '-e', 'opencode']);
      });
    });
  });

  describe('normalizeCommand', () => {
    it('returns null for missing id', () => {
      assert.equal(normalizeCommand({ label: 'Test', command: 'npm', args: [] }), null);
    });

    it('returns null for missing label', () => {
      assert.equal(normalizeCommand({ id: 'test', command: 'npm', args: [] }), null);
    });

    it('returns null for missing command', () => {
      assert.equal(normalizeCommand({ id: 'test', label: 'Test', args: [] }), null);
    });

    it('normalizes a valid command', () => {
      const result = normalizeCommand({ id: 'test', label: 'Test', kind: 'test', command: 'npm', args: ['test'] });
      assert.ok(result);
      assert.equal(result.id, 'test');
      assert.equal(result.kind, 'test');
      assert.deepEqual(result.args, ['test']);
    });

    it('defaults unknown kind to custom', () => {
      const result = normalizeCommand({ id: 'x', label: 'X', command: 'echo', kind: 'unknown', args: [] });
      assert.ok(result);
      assert.equal(result.kind, 'custom');
    });

    it('rejects command with non-array args', () => {
      assert.equal(normalizeCommand({ id: 'x', label: 'X', command: 'echo', args: 'not-array' }), null);
    });

    it('rejects command with non-string args', () => {
      assert.equal(normalizeCommand({ id: 'x', label: 'X', command: 'echo', args: ['ok', 123] }), null);
    });

    it('rejects command with missing args', () => {
      assert.equal(normalizeCommand({ id: 'x', label: 'X', command: 'echo' }), null);
    });
  });

  describe('detectPackageScripts', () => {
    it('returns empty array when no package.json exists', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-test-'));
      try {
        const result = detectPackageScripts(tmpDir);
        assert.deepEqual(result, []);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('returns detected scripts from package.json', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-test-'));
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
        scripts: { test: 'jest', build: 'tsc', lint: 'eslint .' },
      }));
      try {
        const result = detectPackageScripts(tmpDir);
        assert.equal(result.length, 3);
        assert.equal(result[0].id, 'npm:test');
        assert.equal(result[0].label, 'npm run test');
        assert.equal(result[0].detected, true);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('readWorkspaceConfig', () => {
    it('returns null when no config file exists', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-test-'));
      try {
        assert.equal(readWorkspaceConfig(tmpDir), null);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('parses a valid config file', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-test-'));
      fs.writeFileSync(path.join(tmpDir, 'elegy.workspace.json'), JSON.stringify({
        commands: [
          { id: 'test', label: 'Test', kind: 'test', command: 'npm', args: ['test'] },
          { id: 'build', label: 'Build', kind: 'build', command: 'npm', args: ['run', 'build'] },
        ],
      }));
      try {
        const config = readWorkspaceConfig(tmpDir);
        assert.ok(config);
        assert.equal(config.commands.length, 2);
        assert.equal(config.commands[0].id, 'test');
        assert.equal(config.commands[1].id, 'build');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('filters out malformed commands', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-test-'));
      fs.writeFileSync(path.join(tmpDir, 'elegy.workspace.json'), JSON.stringify({
        commands: [
          { id: 'good', label: 'Good', command: 'echo', args: ['hi'] },
          { label: 'No ID', command: 'echo', args: [] },
          { id: 'no-cmd', label: 'No CMD', args: [] },
          { id: 'bad-args', label: 'Bad Args', command: 'echo', args: [123] },
          null,
          'not an object',
        ],
      }));
      try {
        const config = readWorkspaceConfig(tmpDir);
        assert.ok(config);
        assert.equal(config.commands.length, 1);
        assert.equal(config.commands[0].id, 'good');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
