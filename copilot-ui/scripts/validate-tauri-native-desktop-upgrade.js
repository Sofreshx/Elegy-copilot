'use strict';

const fs = require('fs');
const path = require('path');

const { validateTauriWindowsReleaseArtifacts } = require('./validate-tauri-windows-release-artifacts');

const workspaceRoot = path.resolve(__dirname, '..');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function requireExistingFile(envName) {
  const value = String(process.env[envName] || '').trim();
  assert(value, `Missing ${envName}. Provide the signed installer path for the Windows upgrade smoke.`);
  const resolved = path.resolve(value);
  assert(fs.existsSync(resolved), `${envName} does not exist: ${resolved}`);
  assert(fs.statSync(resolved).isFile(), `${envName} must point to a file: ${resolved}`);
  return resolved;
}

function requireUrl(envName) {
  const value = String(process.env[envName] || '').trim();
  assert(value, `Missing ${envName}. Provide a stable/prerelease latest.json URL for the signed updater smoke.`);
  const parsed = new URL(value);
  assert(parsed.protocol === 'http:' || parsed.protocol === 'https:', `${envName} must be an http(s) URL: ${value}`);
  return parsed.toString();
}

function main() {
  assert(process.platform === 'win32', 'validate-tauri-native-desktop-upgrade.js only supports Windows hosts.');

  const fromInstaller = requireExistingFile('INSTRUCTION_ENGINE_UPGRADE_FROM_INSTALLER');
  const toInstaller = requireExistingFile('INSTRUCTION_ENGINE_UPGRADE_TO_INSTALLER');
  const feedUrl = requireUrl('INSTRUCTION_ENGINE_UPGRADE_FEED_URL');
  const releaseValidation = validateTauriWindowsReleaseArtifacts({ workspaceRoot });

  assert(
    path.resolve(releaseValidation.installerPath).toLowerCase() === path.resolve(toInstaller).toLowerCase(),
    `INSTRUCTION_ENGINE_UPGRADE_TO_INSTALLER must match the staged signed updater artifact. staged=${releaseValidation.installerPath}; provided=${toInstaller}`,
  );

  console.log('[tauri-native-upgrade] prerequisites validated.');
  console.log(`[tauri-native-upgrade] from=${fromInstaller}`);
  console.log(`[tauri-native-upgrade] to=${toInstaller}`);
  console.log(`[tauri-native-upgrade] feed=${feedUrl}`);
  console.log('[tauri-native-upgrade] Run this command on a Windows desktop host with UI automation enabled to install the old build, launch it with INSTRUCTION_ENGINE_UPDATE_FEED_URL, apply the in-app update, relaunch, and verify preserved ~/.elegy state.');
}

main();
