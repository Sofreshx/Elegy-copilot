'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  formatStartupDiagnostics,
  resolveSmokeInstallerOverride,
  resolveUserShortcutPaths,
  resolveInstallerRegistryKey,
  resolveInstallerUninstallRegistryKey,
  resolveInstallerRegistryBackupPath,
  snapshotPathStates,
  restorePathStates,
} = require('./validate-tauri-native-desktop-smoke');

test('does not require a local installer override by default', () => {
  const previous = process.env.ELEGY_TAURI_NATIVE_SMOKE_INSTALLER;

  try {
    delete process.env.ELEGY_TAURI_NATIVE_SMOKE_INSTALLER;
    assert.equal(resolveSmokeInstallerOverride(), null);
  } finally {
    if (previous === undefined) {
      delete process.env.ELEGY_TAURI_NATIVE_SMOKE_INSTALLER;
    } else {
      process.env.ELEGY_TAURI_NATIVE_SMOKE_INSTALLER = previous;
    }
  }
});

test('formats native startup diagnostics with boot log and child stderr', () => {
  const message = formatStartupDiagnostics({
    errorMessage: 'desktop health endpoint timed out',
    bootLog: '[boot] setup closure entered',
    stdout: 'runtime stdout',
    stderr: 'runtime stderr',
  });

  assert.match(message, /desktop health endpoint timed out/);
  assert.match(message, /tauri boot log:\n\[boot\] setup closure entered/);
  assert.match(message, /runtime stdout/);
  assert.match(message, /runtime stderr/);
});

test('restores user-facing shortcuts after the smoke installer mutates them', () => {
  const shortcutPaths = resolveUserShortcutPaths({
    userProfile: 'C:\\Users\\smoke-user',
    appData: 'C:\\Users\\smoke-user\\AppData\\Roaming',
  });

  assert.deepEqual(shortcutPaths, [
    'C:\\Users\\smoke-user\\Desktop\\Elegy Copilot.lnk',
    'C:\\Users\\smoke-user\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Elegy Copilot.lnk',
  ]);

  const files = new Map([
    [shortcutPaths[0], Buffer.from('original desktop shortcut')],
  ]);
  const fsApi = {
    existsSync: (filePath) => files.has(filePath),
    readFileSync: (filePath) => files.get(filePath),
    writeFileSync: (filePath, contents) => files.set(filePath, Buffer.from(contents)),
    unlinkSync: (filePath) => files.delete(filePath),
  };

  const states = snapshotPathStates(shortcutPaths, fsApi);
  files.set(shortcutPaths[0], Buffer.from('smoke installer shortcut'));
  files.set(shortcutPaths[1], Buffer.from('smoke installer shortcut'));

  restorePathStates(states, fsApi);

  assert.deepEqual(files.get(shortcutPaths[0]), Buffer.from('original desktop shortcut'));
  assert.equal(files.has(shortcutPaths[1]), false);
});

test('uses the Tauri installer registry key for side-effect isolation', () => {
  assert.equal(
    resolveInstallerRegistryKey(),
    'HKCU\\Software\\elegycopilot\\Elegy Copilot',
  );
  assert.equal(
    resolveInstallerUninstallRegistryKey(),
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Elegy Copilot',
  );
});

test('stores the installer registry backup outside the scratch install tree', () => {
  const backupPath = resolveInstallerRegistryBackupPath({
    tempDirectory: 'C:\\Users\\smoke-user\\AppData\\Local\\Temp',
    processId: 1234,
  });

  assert.equal(
    backupPath,
    'C:\\Users\\smoke-user\\AppData\\Local\\Temp\\elegy-copilot-tauri-native-smoke-1234.reg',
  );
});
