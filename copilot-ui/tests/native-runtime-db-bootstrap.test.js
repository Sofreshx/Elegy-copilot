'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');

const copilotUiRoot = path.resolve(__dirname, '..');

describe('native runtime DB bootstrap', () => {
  let tempDir;

  before(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elegy-native-test-'));
  });

  after(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('can require better-sqlite3 from copilot-ui workspace', () => {
    // Resolve from copilot-ui context to ensure we test the workspace package
    const betterSqlite3Path = require.resolve('better-sqlite3', { paths: [copilotUiRoot] });
    assert.ok(betterSqlite3Path, 'better-sqlite3 should be resolvable from copilot-ui root');

    // Verify the .node binding file exists
    const packageDir = path.dirname(
      require.resolve('better-sqlite3/package.json', { paths: [copilotUiRoot] }),
    );
    const bindingPath = path.join(packageDir, 'build', 'Release', 'better_sqlite3.node');
    assert.ok(
      fs.existsSync(bindingPath),
      `Native binding should exist at ${bindingPath}`,
    );

    // require() should succeed
    const Database = require('better-sqlite3');
    assert.ok(
      typeof Database === 'function',
      'better-sqlite3 should export a constructor',
    );
  });

  it('can create and open a temp Elegy DB with sqlite-vec', () => {
    const dbPath = path.join(tempDir, 'test-elegy.db');
    const Database = require('better-sqlite3');

    const db = new Database(dbPath);

    // WAL mode
    db.pragma('journal_mode = WAL');

    // Load sqlite-vec
    const sqliteVec = require('@photostructure/sqlite-vec');
    sqliteVec.load(db);

    // Run basic query
    db.exec(`CREATE TABLE IF NOT EXISTS test_table (
      id TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`);

    db.prepare('INSERT INTO test_table (id, value) VALUES (?, ?)').run(
      'test-1',
      'hello',
    );
    const row = db
      .prepare('SELECT * FROM test_table WHERE id = ?')
      .get('test-1');
    assert.strictEqual(row.value, 'hello');

    db.close();
  });

  it('classifyNativeRequireFailure produces classified diagnostics', () => {
    // classifyNativeRequireFailure is an internal function in elegyDb.js that
    // formats startup diagnostics when a native module binding is missing.
    // We test it by extracting the function from source and calling it with
    // a mock error in a subprocess (cannot use inline eval here because the
    // function references require.resolve which must find the real package).
    const elegyDbPath = require.resolve(
      path.join(copilotUiRoot, 'lib', 'elegyDb'),
    );
    const source = fs.readFileSync(elegyDbPath, 'utf8');

    // Extract the classifyNativeRequireFailure function
    const match = source.match(
      /(function classifyNativeRequireFailure[\s\S]*?\n\})/,
    );
    assert.ok(match, 'classifyNativeRequireFailure should exist in source');

    const result = execFileSync(
      process.execPath,
      [
        '-e',
        `
        ${match[1]}

        const error = new Error('DLL load failed: The specified module could not be found');
        error.code = 'ERR_DLOPEN_FAILED';

        const diagnostics = classifyNativeRequireFailure('better-sqlite3', error);
        const lines = diagnostics.split('\\n');

        const output = {
          headerLine: lines[0],
          hasNativeDependencyHeader: diagnostics.includes('[elegy-db:native-dependency]'),
          hasNodeVersion: diagnostics.includes('Node:'),
          hasNodeAbi: diagnostics.includes('ABI'),
          hasPlatform: diagnostics.includes('Platform:'),
          hasPackageRoot: diagnostics.includes('Package root:'),
          hasRemediation: diagnostics.includes('Remediation:'),
          hasErrorMessage: diagnostics.includes(error.message),
          hasNativeModuleName: diagnostics.includes('better-sqlite3'),
          lineCount: lines.length,
        };

        process.stdout.write(JSON.stringify(output));
      `,
      ],
      { encoding: 'utf8' },
    );

    const output = JSON.parse(result.trim());

    assert.ok(
      output.hasNativeDependencyHeader,
      'Should have [elegy-db:native-dependency] header',
    );
    assert.ok(output.hasNodeVersion, 'Should include Node version line');
    assert.ok(output.hasNodeAbi, 'Should include Node ABI line');
    assert.ok(output.hasPlatform, 'Should include platform line');
    assert.ok(output.hasPackageRoot, 'Should include package root line');
    assert.ok(output.hasRemediation, 'Should include remediation line');
    assert.ok(
      output.hasErrorMessage,
      'Should include the original error message',
    );
    assert.ok(
      output.hasNativeModuleName,
      'Should include the native module name',
    );
    assert.ok(
      output.lineCount >= 6,
      `Should have at least 6 lines of diagnostics, got ${output.lineCount}`,
    );
  });
});
