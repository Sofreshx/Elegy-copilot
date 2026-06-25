'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const workspaceRoot = path.resolve(__dirname, '..');
const tauriRoot = path.join(workspaceRoot, 'src-tauri');
const cargoManifestPath = 'Cargo.toml';
const tauriDevBinaryNames = [
  'elegy-copilot-tauri-shell.exe',
  'elegy_copilot_tauri_shell.exe',
];

const vsDevCmdPath = path.join(
  process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
  'Microsoft Visual Studio', '2022', 'BuildTools', 'Common7', 'Tools', 'VsDevCmd.bat',
);

function commandLabel(command, args) {
  return `${command} ${args.join(' ')}`.trim();
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || workspaceRoot,
    env: options.env || process.env,
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

function getVsDevEnv() {
  if (!fs.existsSync(vsDevCmdPath)) {
    console.warn(`[tauri-dev:windows] VsDevCmd.bat not found at ${vsDevCmdPath}; falling back to current environment`);
    return null;
  }

  const command = `call "${vsDevCmdPath}" -arch=x64 -host_arch=x64 >nul 2>nul && set`;
  const result = spawnSync(command, [], { encoding: 'utf8', shell: true });

  if (result.error || result.status !== 0) {
    console.warn(`[tauri-dev:windows] failed to init VS dev environment: ${result.error ? result.error.message : 'exit code ' + result.status}`);
    return null;
  }

  const env = {};
  for (const line of result.stdout.split('\n')) {
    const eqIdx = line.indexOf('=');
    if (eqIdx > 0 && !line.startsWith('=')) {
      env[line.substring(0, eqIdx)] = line.substring(eqIdx + 1).trimEnd();
    }
  }
  return env;
}

function mergeEnv(base, overlay) {
  const result = { ...base };
  const baseLower = Object.keys(base).reduce((acc, k) => { acc[k.toLowerCase()] = k; return acc; }, {});
  for (const [k, v] of Object.entries(overlay)) {
    const existing = baseLower[k.toLowerCase()];
    if (existing) {
      result[existing] = v;
    } else {
      result[k] = v;
    }
  }
  return result;
}

function runCargoTauriDev() {
  const vsEnv = getVsDevEnv();
  const mergedEnv = vsEnv ? mergeEnv(process.env, vsEnv) : process.env;

  const command = 'cargo';
  const args = ['run', '--manifest-path', cargoManifestPath];
  const label = commandLabel(command, args);
  console.log(`[tauri-dev:windows] running ${label}`);

  const firstAttempt = runCommand(command, args, { cwd: tauriRoot, env: mergedEnv });
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

  const secondAttempt = runCommand(command, args, { cwd: tauriRoot, env: mergedEnv });
  if (secondAttempt.error) {
    console.error(`[tauri-dev:windows] retry failed to execute ${label}: ${secondAttempt.error.message}`);
    return 1;
  }

  return secondAttempt.status || 1;
}

process.exit(runCargoTauriDev());
