'use strict';

const fs = require('fs');
const path = require('path');

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function clipOutput(value, limit = 64 * 1024) {
  const text = String(value || '');
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit)}\n...[truncated ${text.length - limit} chars]`;
}

function getConfiguredCommands(config = {}) {
  const cliCommands = config.cliCommands && typeof config.cliCommands === 'object'
    ? config.cliCommands
    : {};
  return {
    probe: Array.isArray(cliCommands.probe) ? cliCommands.probe : [],
    syncStatus: Array.isArray(cliCommands.syncStatus) ? cliCommands.syncStatus : [],
    refreshInventory: Array.isArray(cliCommands.refreshInventory) ? cliCommands.refreshInventory : [],
    manualSync: Array.isArray(cliCommands.manualSync) ? cliCommands.manualSync : [],
  };
}

function hasConfiguredCli(config = {}) {
  const commands = getConfiguredCommands(config);
  return Boolean(
    normalizeString(config.cliPath)
    || commands.probe.length > 0
    || commands.syncStatus.length > 0
    || commands.refreshInventory.length > 0
    || commands.manualSync.length > 0
  );
}

function hasMissingAbsoluteExecutable(command, fsImpl = fs) {
  const executable = Array.isArray(command) && command.length > 0 ? normalizeString(command[0]) : '';
  if (!executable || !path.isAbsolute(executable)) {
    return false;
  }
  return !fsImpl.existsSync(executable);
}

function resolveCommand(config, commandName) {
  const commands = getConfiguredCommands(config);
  const command = commands[commandName];
  return Array.isArray(command) ? command.slice() : [];
}

function createUnavailableStatus(config, message) {
  const commands = getConfiguredCommands(config);
  return {
    state: 'unavailable',
    message,
    checkedAt: new Date().toISOString(),
    probeConfigured: commands.probe.length > 0,
    syncStatusConfigured: commands.syncStatus.length > 0,
    refreshInventoryConfigured: commands.refreshInventory.length > 0,
    manualSyncConfigured: commands.manualSync.length > 0,
  };
}

function runCommand(command, options = {}) {
  if (!Array.isArray(command) || command.length === 0) {
    return Promise.reject(new Error('Obsidian CLI command is not configured.'));
  }

  if (hasMissingAbsoluteExecutable(command, options.fs || fs)) {
    return Promise.reject(new Error(`Obsidian CLI executable is unavailable: ${command[0]}`));
  }

  const childProcess = options.childProcess || require('child_process');
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 15_000;

  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = childProcess.spawn(command[0], command.slice(1), {
      cwd: options.cwd || undefined,
      env: options.env || process.env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        child.kill();
      } catch {
        // ignore
      }
      const error = new Error(`Obsidian CLI command timed out after ${timeoutMs}ms.`);
      error.code = 'obsidian_cli_timeout';
      reject(error);
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (exitCode, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);

      const result = {
        command: command.slice(),
        exitCode: Number.isFinite(exitCode) ? exitCode : null,
        signal: normalizeString(signal) || null,
        stdout: clipOutput(stdout),
        stderr: clipOutput(stderr),
        durationMs: Date.now() - startedAt,
      };

      if (exitCode === 0) {
        resolve(result);
        return;
      }

      const detail = normalizeString(result.stderr) || normalizeString(result.stdout) || `exit code ${result.exitCode}`;
      const error = new Error(`Obsidian CLI command failed: ${detail}`);
      error.code = 'obsidian_cli_failed';
      error.result = result;
      reject(error);
    });
  });
}

async function probeCli(config, options = {}) {
  const commands = getConfiguredCommands(config);
  if (!hasConfiguredCli(config)) {
    return {
      state: 'not-configured',
      message: 'No Obsidian CLI command contract is configured.',
      checkedAt: new Date().toISOString(),
      probeConfigured: false,
      syncStatusConfigured: false,
      refreshInventoryConfigured: false,
      manualSyncConfigured: false,
    };
  }

  if (hasMissingAbsoluteExecutable(commands.probe, options.fs) || hasMissingAbsoluteExecutable(commands.syncStatus, options.fs)) {
    return createUnavailableStatus(config, 'An absolute Obsidian CLI executable path is configured but missing.');
  }

  try {
    if (commands.probe.length > 0) {
      await runCommand(commands.probe, options);
      return {
        state: 'ready',
        message: 'Obsidian CLI probe succeeded.',
        checkedAt: new Date().toISOString(),
        probeConfigured: true,
        syncStatusConfigured: commands.syncStatus.length > 0,
        refreshInventoryConfigured: commands.refreshInventory.length > 0,
        manualSyncConfigured: commands.manualSync.length > 0,
      };
    }

    if (commands.syncStatus.length > 0) {
      await runCommand(commands.syncStatus, options);
      return {
        state: 'ready',
        message: 'Obsidian CLI sync-status command succeeded.',
        checkedAt: new Date().toISOString(),
        probeConfigured: false,
        syncStatusConfigured: true,
        refreshInventoryConfigured: commands.refreshInventory.length > 0,
        manualSyncConfigured: commands.manualSync.length > 0,
      };
    }

    return {
      state: 'configured',
      message: 'Obsidian CLI commands are configured but no explicit probe command is defined.',
      checkedAt: new Date().toISOString(),
      probeConfigured: false,
      syncStatusConfigured: false,
      refreshInventoryConfigured: commands.refreshInventory.length > 0,
      manualSyncConfigured: commands.manualSync.length > 0,
    };
  } catch (error) {
    const message = normalizeString(error && error.message);
    return {
      state: 'error',
      message: message || 'Obsidian CLI probe failed.',
      checkedAt: new Date().toISOString(),
      probeConfigured: commands.probe.length > 0,
      syncStatusConfigured: commands.syncStatus.length > 0,
      refreshInventoryConfigured: commands.refreshInventory.length > 0,
      manualSyncConfigured: commands.manualSync.length > 0,
      lastError: message || undefined,
    };
  }
}

function runConfiguredCommand(config, commandName, options = {}) {
  const command = resolveCommand(config, commandName);
  return runCommand(command, options);
}

module.exports = {
  hasConfiguredCli,
  probeCli,
  resolveCommand,
  runConfiguredCommand,
};
