#!/usr/bin/env node

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');
const { execSync } = require('child_process');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  PASS: ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL: ${name}`);
    console.error(`    ${error.message}`);
    process.exitCode = 1;
  }
}

// --- Mock helpers ---

/**
 * Create a mock execSync that throws for every command.
 * Use addHandler(pattern, fn) to register handlers.
 */
function createMockExecSync() {
  const handlers = [];

  function mockExecSync(cmd, opts) {
    for (const { pattern, handler } of handlers) {
      if (cmd.includes(pattern)) {
        return handler(cmd, opts);
      }
    }
    // Default: throw (command not found)
    const err = new Error(`ENOENT: ${cmd}`);
    err.code = 'ENOENT';
    err.status = 1;
    throw err;
  }

  mockExecSync.addHandler = function (pattern, handler) {
    handlers.push({ pattern, handler });
  };

  return mockExecSync;
}

/**
 * Create a mock fs module with configurable accessSync.
 * - If no handler matches, accessSync throws (file not found).
 */
function createMockFs() {
  const accessible = new Set();

  return {
    constants: { X_OK: 1, R_OK: 4, W_OK: 2 },
    accessSync(p, mode) {
      if (accessible.has(p)) return;
      const err = new Error(`ENOENT: ${p}`);
      err.code = 'ENOENT';
      throw err;
    },
    addAccessiblePath(p) {
      accessible.add(p);
    },
  };
}

// --- Tests ---

async function main() {
  const modulePath = pathToFileURL(path.resolve(__dirname, 'shell-detect.mjs')).href;
  const sd = await import(modulePath);

  // ---------------------------------------------------------------------------
  // 1. Non-Windows platform returns empty array
  // ---------------------------------------------------------------------------
  await test('Non-Windows platform returns empty array', async () => {
    if (process.platform !== 'win32') {
      const result = await sd.detect();
      assert.deepStrictEqual(result, [], 'should return [] on non-Windows');
    } else {
      // On Windows we can't test platform rejection without mocking process.platform,
      // which is not allowed per spec. Verify the function exists and returns an array.
      const mockExec = createMockExecSync();
      const result = await sd.detect({ execSync: mockExec });
      assert.ok(Array.isArray(result), 'should return an array');
    }
  });

  // ---------------------------------------------------------------------------
  // 2. WSL detection
  // ---------------------------------------------------------------------------
  await test('detect returns WSL when wsl.exe --status reports Default Distribution', async () => {
    const mockExec = createMockExecSync();
    mockExec.addHandler('wsl.exe --status', () => {
      return 'Windows Subsystem for Linux\nDefault Distribution: Ubuntu\nKernel: 5.10.102.1\n';
    });
    const result = await sd.detect({ execSync: mockExec, timeout: 1000 });
    const wsl = result.find((s) => s.type === 'wsl');
    assert.ok(wsl, 'should find WSL entry');
    assert.strictEqual(wsl.type, 'wsl');
    assert.strictEqual(wsl.path, 'wsl.exe');
    assert.strictEqual(wsl.posix, true);
    assert.strictEqual(wsl.available, true);
    assert.ok(result.indexOf(wsl) === 0, 'WSL should be first (highest priority)');
  });

  // ---------------------------------------------------------------------------
  // 3. Git Bash detection via `where bash.exe`
  // ---------------------------------------------------------------------------
  await test('detect returns Git Bash when where bash.exe returns a path', async () => {
    const mockExec = createMockExecSync();
    const mockFs = createMockFs();
    const bashPath = 'C:\\Program Files\\Git\\bin\\bash.exe';

    // Make the WHERE command succeed
    mockExec.addHandler('where bash.exe', () => bashPath + '\n');
    // Make the path appear executable
    mockFs.addAccessiblePath(bashPath);

    const result = await sd.detect({ execSync: mockExec, fsModule: mockFs, timeout: 1000 });
    const gitBash = result.find((s) => s.type === 'gitbash');
    assert.ok(gitBash, 'should find Git Bash entry');
    assert.strictEqual(gitBash.type, 'gitbash');
    assert.strictEqual(gitBash.path, bashPath);
    assert.strictEqual(gitBash.posix, true);
    assert.strictEqual(gitBash.available, true);
  });

  // ---------------------------------------------------------------------------
  // 4. Git Bash detection via OPENCODE_GIT_BASH_PATH env var
  // ---------------------------------------------------------------------------
  await test('detect returns Git Bash when OPENCODE_GIT_BASH_PATH is set', async () => {
    const originalEnv = process.env.OPENCODE_GIT_BASH_PATH;
    const mockExec = createMockExecSync();
    const mockFs = createMockFs();
    const customPath = 'D:\\custom\\git\\bin\\bash.exe';

    process.env.OPENCODE_GIT_BASH_PATH = customPath;
    mockFs.addAccessiblePath(customPath);

    try {
      const result = await sd.detect({ execSync: mockExec, fsModule: mockFs, timeout: 1000 });
      const gitBash = result.find((s) => s.type === 'gitbash');
      assert.ok(gitBash, 'should find Git Bash entry via env var');
      assert.strictEqual(gitBash.path, customPath);
    } finally {
      // Avoid setting process.env to undefined (Node converts to string 'undefined')
      if (originalEnv === undefined) {
        delete process.env.OPENCODE_GIT_BASH_PATH;
      } else {
        process.env.OPENCODE_GIT_BASH_PATH = originalEnv;
      }
    }
  });

  // ---------------------------------------------------------------------------
  // 5. Coreutils detection
  // ---------------------------------------------------------------------------
  await test('detect returns Coreutils when winget list succeeds', async () => {
    const mockExec = createMockExecSync();
    mockExec.addHandler('winget list Microsoft.Coreutils', () => {
      return 'Name              Id                          Version\n' +
             'Microsoft Coreutils Microsoft.Coreutils     1.0.0\n';
    });

    const result = await sd.detect({ execSync: mockExec, timeout: 1000 });
    const coreutils = result.find((s) => s.type === 'coreutils');
    assert.ok(coreutils, 'should find Coreutils entry');
    assert.strictEqual(coreutils.type, 'coreutils');
    assert.strictEqual(coreutils.path, 'pwsh.exe');
    assert.strictEqual(coreutils.posix, false);
    assert.strictEqual(coreutils.available, true);
  });

  // ---------------------------------------------------------------------------
  // 6. pwsh detection
  // ---------------------------------------------------------------------------
  await test('detect returns pwsh when where pwsh.exe succeeds', async () => {
    const mockExec = createMockExecSync();
    mockExec.addHandler('where pwsh.exe', () => 'C:\\Program Files\\PowerShell\\7\\pwsh.exe\n');

    const result = await sd.detect({ execSync: mockExec, timeout: 1000 });
    const pwsh = result.find((s) => s.type === 'pwsh');
    assert.ok(pwsh, 'should find pwsh entry');
    assert.strictEqual(pwsh.type, 'pwsh');
    assert.strictEqual(pwsh.path, 'pwsh.exe');
    assert.strictEqual(pwsh.posix, false);
    assert.strictEqual(pwsh.available, true);
  });

  // ---------------------------------------------------------------------------
  // 7. powershell detection
  // ---------------------------------------------------------------------------
  await test('detect returns powershell when where powershell.exe succeeds', async () => {
    const mockExec = createMockExecSync();
    mockExec.addHandler('where powershell.exe', () => {
      return 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe\n';
    });

    const result = await sd.detect({ execSync: mockExec, timeout: 1000 });
    const ps = result.find((s) => s.type === 'powershell');
    assert.ok(ps, 'should find powershell entry');
    assert.strictEqual(ps.type, 'powershell');
    assert.strictEqual(ps.path, 'powershell.exe');
    assert.strictEqual(ps.posix, false);
    assert.strictEqual(ps.available, true);
  });

  // ---------------------------------------------------------------------------
  // 8. getBestShell returns first available (WSL preferred)
  // ---------------------------------------------------------------------------
  await test('getBestShell returns WSL when WSL and other shells are available', async () => {
    const mockExec = createMockExecSync();

    // WSL succeeds
    mockExec.addHandler('wsl.exe --status', () => {
      return 'Windows Subsystem for Linux\nDefault Distribution: Ubuntu\n';
    });

    // Make all other commands fail by not adding handlers
    // The default mock throws for anything unhandled

    const best = await sd.getBestShell({ execSync: mockExec, timeout: 1000 });
    assert.ok(best, 'getBestShell should return a shell');
    assert.strictEqual(best.type, 'wsl', 'WSL should be preferred');
  });

  // ---------------------------------------------------------------------------
  // 9. getBestShell returns first when multiple available
  // ---------------------------------------------------------------------------
  await test('getBestShell returns the first available shell when multiple exist', async () => {
    const mockExec = createMockExecSync();

    // Only Git Bash is available (WSL and Coreutils fail)
    const mockFs = createMockFs();
    const bashPath = 'C:\\Program Files\\Git\\bin\\bash.exe';

    mockExec.addHandler('where bash.exe', () => bashPath + '\n');
    mockFs.addAccessiblePath(bashPath);

    const best = await sd.getBestShell({ execSync: mockExec, fsModule: mockFs, timeout: 1000 });
    assert.ok(best, 'getBestShell should return a shell');
    assert.strictEqual(best.type, 'gitbash', 'should return Git Bash when WSL and Coreutils are unavailable');
    assert.strictEqual(best.path, bashPath);
  });

  // ---------------------------------------------------------------------------
  // 9b. CLI --json mode outputs valid JSON
  // ---------------------------------------------------------------------------
  await test('CLI --json mode outputs valid JSON', async () => {
    const scriptPath = path.resolve(__dirname, 'shell-detect.mjs');
    let output;
    try {
      output = execSync(`node "${scriptPath}" --json`, {
        encoding: 'utf8',
        timeout: 10000,
      });
    } catch (e) {
      // If the command itself failed (unlikely), capture stdout for inspection
      output = e.stdout || '';
    }
    assert.ok(output, 'CLI should produce output');
    const trimmed = output.trim();
    // Should be parseable JSON
    const parsed = JSON.parse(trimmed);
    // Should be either null (no shells) or a shell entry object
    assert.ok(
      parsed === null || (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)),
      'CLI output should be null or a shell entry object',
    );
    if (parsed !== null) {
      // If we got a shell, verify the shape
      assert.ok(typeof parsed.type === 'string', 'type should be a string');
      assert.ok(typeof parsed.path === 'string', 'path should be a string');
      assert.ok(typeof parsed.posix === 'boolean', 'posix should be boolean');
      assert.ok(typeof parsed.available === 'boolean', 'available should be boolean');
    }
  });

  // ---------------------------------------------------------------------------
  // 10. skipSlowProbes option works
  // ---------------------------------------------------------------------------
  await test('skipSlowProbes skips winget and registry probes (still finds other shells)', async () => {
    const mockExec = createMockExecSync();
    const mockFs = createMockFs();

    // Register handlers that record if winget or reg is called
    let wingetCalled = false;
    let regCalled = false;

    mockExec.addHandler('winget', () => {
      wingetCalled = true;
      return 'Microsoft.Coreutils found\n';
    });

    mockExec.addHandler('reg query', () => {
      regCalled = true;
      return 'InstallPath    REG_SZ    C:\\Program Files\\Git\n';
    });

    // Make powershell available as a baseline shell
    mockExec.addHandler('where powershell.exe', () => {
      return 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe\n';
    });

    const result = await sd.detect({
      execSync: mockExec,
      fsModule: mockFs,
      timeout: 1000,
      skipSlowProbes: true,
    });

    assert.strictEqual(wingetCalled, false, 'winget should not be called when skipSlowProbes=true');
    assert.strictEqual(regCalled, false, 'reg query should not be called when skipSlowProbes=true');
    assert.ok(result.length > 0, 'should still find available shells with skipSlowProbes');
    // The exact first shell depends on what the mock exec allows to pass through;
    // the contract is that slow probes are skipped, not the ordering.
    const types = result.map((s) => s.type);
    assert.ok(types.includes('powershell'), 'powershell should be found even with skipSlowProbes');
  });

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log(`\n${passed} passed, ${failed} failed`);
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exitCode = 1;
});
