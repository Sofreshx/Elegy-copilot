#!/usr/bin/env node

import assert from 'assert';
import childProcess from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const scriptPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'vscode-settings-patch.mjs');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS: ${name}`);
  } catch (e) {
    console.error(`  FAIL: ${name}`);
    console.error(`    ${e.message}`);
    process.exitCode = 1;
  }
}

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-vscode-patch-'));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function runPatch({ settingsPath, copilotHome, vscodeHome }) {
  childProcess.execFileSync(process.execPath, [
    scriptPath,
    '--settings',
    settingsPath,
    '--copilot-home',
    copilotHome,
    '--vscode-home',
    vscodeHome,
  ], {
    stdio: 'pipe',
  });
}

test('patcher authorizes dynamic first-level .copilot subfolders', () => {
  withTempDir((root) => {
    const copilotHome = path.join(root, '.copilot');
    const vscodeHome = path.join(root, '.copilot-vscode');
    const settingsPath = path.join(root, 'settings.json');

    fs.mkdirSync(copilotHome, { recursive: true });
    fs.mkdirSync(vscodeHome, { recursive: true });
    fs.mkdirSync(path.join(copilotHome, 'dynamic-alpha'));
    fs.mkdirSync(path.join(vscodeHome, 'dynamic-beta'));
    fs.writeFileSync(settingsPath, '{}\n', 'utf8');

    runPatch({ settingsPath, copilotHome, vscodeHome });

    const permissionsPath = path.join(copilotHome, 'permissions-config.json');
    const config = JSON.parse(fs.readFileSync(permissionsPath, 'utf8'));
    const locations = config && config.locations ? config.locations : {};

    assert.ok(Object.prototype.hasOwnProperty.call(locations, path.join(copilotHome, 'dynamic-alpha')));
    assert.ok(Object.prototype.hasOwnProperty.call(locations, path.join(vscodeHome, 'dynamic-beta')));
  });
});

test('patcher is idempotent for permissions-config approvals', () => {
  withTempDir((root) => {
    const copilotHome = path.join(root, '.copilot');
    const vscodeHome = path.join(root, '.copilot-vscode');
    const settingsPath = path.join(root, 'settings.json');

    fs.mkdirSync(copilotHome, { recursive: true });
    fs.mkdirSync(vscodeHome, { recursive: true });
    fs.mkdirSync(path.join(copilotHome, 'custom-tools'));
    fs.writeFileSync(settingsPath, '{}\n', 'utf8');

    runPatch({ settingsPath, copilotHome, vscodeHome });
    const permissionsPath = path.join(copilotHome, 'permissions-config.json');
    const first = JSON.parse(fs.readFileSync(permissionsPath, 'utf8'));

    runPatch({ settingsPath, copilotHome, vscodeHome });
    const second = JSON.parse(fs.readFileSync(permissionsPath, 'utf8'));

    assert.deepStrictEqual(second, first);
    const approvals = second.locations[path.join(copilotHome, 'custom-tools')].tool_approvals;
    const kinds = approvals.map((item) => item && item.kind).sort();
    assert.deepStrictEqual(kinds, ['memory', 'read', 'write']);
  });
});

test('patcher removes vault path from chat.agentSkillsLocations', () => {
  withTempDir((root) => {
    const copilotHome = path.join(root, '.copilot');
    const vscodeHome = path.join(root, '.copilot-vscode');
    const settingsPath = path.join(root, 'settings.json');

    fs.mkdirSync(copilotHome, { recursive: true });
    fs.mkdirSync(vscodeHome, { recursive: true });

    // Pre-seed settings with a vault path that should be removed
    const initial = {
      'chat.agentSkillsLocations': {
        '~/.copilot/skills': true,
        '~/.copilot/skills-vault': true
      }
    };
    fs.writeFileSync(settingsPath, JSON.stringify(initial, null, 2) + '\n', 'utf8');

    runPatch({ settingsPath, copilotHome, vscodeHome });

    const patched = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const locs = patched['chat.agentSkillsLocations'];

    // Vault path must be removed
    for (const k of Object.keys(locs)) {
      assert.ok(!k.includes('skills-vault'), `vault path should be removed: ${k}`);
    }
    // Skills path should still be present
    const hasSkills = Object.keys(locs).some((k) => k.includes('/skills') && !k.includes('vault'));
    assert.ok(hasSkills, 'skills location should still be present');
  });
});

test('patcher removes ephemeral ie-api-contract locations from all chat asset settings', () => {
  withTempDir((root) => {
    const copilotHome = path.join(root, '.copilot');
    const vscodeHome = path.join(root, '.copilot-vscode');
    const settingsPath = path.join(root, 'settings.json');

    fs.mkdirSync(copilotHome, { recursive: true });
    fs.mkdirSync(vscodeHome, { recursive: true });

    const initial = {
      'chat.agentFilesLocations': {
        '~/.copilot/agents': true,
        '~/Documents/GitHub/instruction-engine/.tmp/llm-work/install-check/.copilot/agents': true,
        '~/AppData/Local/Temp/ie-api-contract-AbCd12/.copilot/agents': true
      },
      'chat.agentSkillsLocations': {
        '~/.copilot/skills': true,
        '~/Documents/GitHub/instruction-engine/.tmp/llm-work/install-check/.copilot/skills': true,
        '~/AppData/Local/Temp/ie-api-contract-AbCd12/.copilot/skills': true
      },
      'chat.promptFilesLocations': {
        '~/.copilot/prompts': true,
        '~/Documents/GitHub/instruction-engine/.tmp/llm-work/install-check/.copilot/prompts': true,
        '~/AppData/Local/Temp/ie-api-contract-AbCd12/.copilot/prompts': true
      },
      'chat.instructionsFilesLocations': {
        '~/.copilot': true,
        '~/Documents/GitHub/instruction-engine/.tmp/llm-work/install-check/.copilot': true,
        '~/AppData/Local/Temp/ie-api-contract-AbCd12/.copilot': true
      }
    };
    fs.writeFileSync(settingsPath, JSON.stringify(initial, null, 2) + '\n', 'utf8');

    runPatch({ settingsPath, copilotHome, vscodeHome });

    const patched = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const keys = [
      'chat.agentFilesLocations',
      'chat.agentSkillsLocations',
      'chat.promptFilesLocations',
      'chat.instructionsFilesLocations'
    ];

    for (const key of keys) {
      for (const locationKey of Object.keys(patched[key])) {
        assert.ok(!locationKey.includes('ie-api-contract-'), `${key} should not contain temp location: ${locationKey}`);
        assert.ok(!locationKey.includes('instruction-engine/.tmp/'), `${key} should not contain repo temp location: ${locationKey}`);
      }
    }
  });
});

console.log(`\n${passed} tests passed`);
if (process.exitCode) {
  console.error('Some tests FAILED');
} else {
  console.log('All tests passed');
}
