'use strict';

const assert = require('node:assert/strict');

const { _private } = require('./vaultDriveSync');

let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  PASS: ${name}`);
  } catch (error) {
    console.error(`  FAIL: ${name}`);
    console.error(`    ${error.message}`);
    process.exitCode = 1;
  }
}

async function run() {
  console.log('\nVault Drive Sync Tests\n');

  await test('buildExpandArchiveArgs does not rely on empty PowerShell args forwarding', () => {
    const args = _private.buildExpandArchiveArgs(
      "C:\\Users\\Test User\\AppData\\Local\\Temp\\rclone's.zip",
      'C:\\Users\\Test User\\AppData\\Local\\Temp\\extract dir'
    );

    assert.deepEqual(args.slice(0, 5), [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
    ]);
    assert.equal(args.length, 6);
    assert.doesNotMatch(args[5], /\$args/);
    assert.match(args[5], /Expand-Archive/);
    assert.match(args[5], /-LiteralPath 'C:\\Users\\Test User\\AppData\\Local\\Temp\\rclone''s\.zip'/);
    assert.match(args[5], /-DestinationPath 'C:\\Users\\Test User\\AppData\\Local\\Temp\\extract dir'/);
  });

  await test('quotePowerShellLiteral escapes embedded apostrophes', () => {
    assert.equal(_private.quotePowerShellLiteral("C:\\tmp\\owner's path"), "'C:\\tmp\\owner''s path'");
  });

  if (!process.exitCode) {
    console.log(`\nVault Drive sync tests passed (${passed})`);
  }
}

run().catch((error) => {
  console.error('Vault Drive sync tests failed');
  console.error(error);
  process.exitCode = 1;
});
