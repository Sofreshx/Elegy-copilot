'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  PASS: ${name}`);
  } catch (error) {
    console.error(`  FAIL: ${name}`);
    console.error(`    ${error.message}`);
    process.exitCode = 1;
  }
}

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('vite config declares the dev API proxy contract', () => {
  const viteConfig = readRepoFile('vite.config.ts');

  assert.match(viteConfig, /COPILOT_UI_DEV_API_URL/);
  assert.match(viteConfig, /proxy\s*:\s*\{[\s\S]*['"]\/api['"]\s*:/);
});

test('cli launch helpers expose the sdk bridge flag contract', () => {
  const cliUiPs1 = readRepoFile('../scripts/cli-ui.ps1');
  const cliUiSh = readRepoFile('../scripts/cli-ui.sh');

  assert.match(cliUiPs1, /--sdk/);
  assert.match(cliUiPs1, /COPILOT_SDK_BRIDGE\s*=\s*'1'/);
  assert.match(cliUiPs1, /\$hadPreviousSdkBridge\s*=\s*Test-Path Env:COPILOT_SDK_BRIDGE/);
  assert.match(cliUiPs1, /if \(\$hadPreviousSdkBridge\) \{[\s\S]*\$env:COPILOT_SDK_BRIDGE\s*=\s*\$previousSdkBridge/);
  assert.match(cliUiPs1, /elseif \(Test-Path Env:COPILOT_SDK_BRIDGE\) \{[\s\S]*Remove-Item Env:COPILOT_SDK_BRIDGE/);

  assert.match(cliUiSh, /--sdk/);
  assert.match(cliUiSh, /COPILOT_SDK_BRIDGE='1'/);
});

process.on('exit', () => {
  console.log(`runtime-startup-contract.test.js: ${passed} passed`);
});