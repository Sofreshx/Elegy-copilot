'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { formatStartupDiagnostics } = require('./validate-tauri-native-desktop-smoke');

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
