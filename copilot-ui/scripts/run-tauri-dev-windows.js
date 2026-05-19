'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const workspaceRoot = path.resolve(__dirname, '..');
const tauriRoot = path.join(workspaceRoot, 'src-tauri');
const cargoManifestPath = 'Cargo.toml';
const tauriDevBinaryNames = [
  'elegy-copilot-tauri-shell.exe',
  'elegy_copilot_tauri_shell.exe',
];

function commandLabel(command, args) {
  return `${command} ${args.join(' ')}`.trim();
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || workspaceRoot,
    env: process.env,
    encoding: 'utf8',
    stdio: 'pipe',
    ...options,
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  return result;
}

function hasWindowsFileLockError(result) {
  const combined = `${String(result.stdout || '')}\n${String(result.stderr || '')}`.toLowerCase();
  return combined.includes('os error 32') || combined.includes('used by another process');
}

function killTauriDevProcesses() {
  for (const imageName of tauriDevBinaryNames) {
    const args = ['/F', '/T', '/IM', imageName];
    const result = runCommand('taskkill', args);
    if (result.error) {
      console.warn(`[tauri-dev:windows] taskkill failed for ${imageName}: ${result.error.message}`);
      continue;
    }

    const output = `${String(result.stdout || '')}\n${String(result.stderr || '')}`.toLowerCase();
    const noTaskMessage = output.includes('no running instance') || output.includes('not found');
    if ((result.status || 0) !== 0 && !noTaskMessage) {
      console.warn(
        `[tauri-dev:windows] unexpected taskkill exit (${result.status}) for ${imageName} while clearing stale locks.`,
      );
    }
  }
}

function runCargoTauriDev() {
  const command = 'cargo';
  const args = ['run', '--manifest-path', cargoManifestPath];
  const label = commandLabel(command, args);
  console.log(`[tauri-dev:windows] running ${label}`);

  const firstAttempt = runCommand(command, args, { cwd: tauriRoot });
  if (firstAttempt.error) {
    console.error(`[tauri-dev:windows] failed to execute ${label}: ${firstAttempt.error.message}`);
    return 1;
  }

  if ((firstAttempt.status || 0) === 0) {
    return 0;
  }

  if (!hasWindowsFileLockError(firstAttempt)) {
    return firstAttempt.status || 1;
  }

  console.warn('[tauri-dev:windows] detected Windows file lock (os error 32). Terminating stale Tauri dev processes and retrying once.');
  killTauriDevProcesses();

  const secondAttempt = runCommand(command, args, { cwd: tauriRoot });
  if (secondAttempt.error) {
    console.error(`[tauri-dev:windows] retry failed to execute ${label}: ${secondAttempt.error.message}`);
    return 1;
  }

  return secondAttempt.status || 1;
}

process.exit(runCargoTauriDev());
