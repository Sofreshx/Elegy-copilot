'use strict';

const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const { isOptionalResource, loadTauriNodeSidecarLayout } = require('./tauri-node-sidecar-layout');
const { validateTauriWindowsReleaseArtifacts } = require('./validate-tauri-windows-release-artifacts');
const { removeTarget } = require('./clean-tauri-release');

const workspaceRoot = path.resolve(__dirname, '..');
const scratchRoot = path.join(workspaceRoot, '.tmp', 'tauri-native-desktop-smoke');
const installRoot = path.join(scratchRoot, 'install');
const stateRoot = path.join(scratchRoot, 'state');
const installTimeoutMs = 180_000;
const uninstallTimeoutMs = 120_000;
const startupTimeoutMs = 90_000;
const singleInstanceTimeoutMs = 20_000;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatStartupDiagnostics({ errorMessage, bootLog = '', stdout = '', stderr = '' }) {
  const sections = [
    String(errorMessage || '').trim(),
    bootLog.trim() ? `tauri boot log:\n${bootLog.trim()}` : '',
    stdout.trim() ? `child stdout:\n${stdout.trim()}` : '',
    stderr.trim() ? `child stderr:\n${stderr.trim()}` : '',
  ].filter(Boolean);
  return sections.join('\n');
}

function ensureCleanDir(targetPath) {
  removeTarget(targetPath);
  fs.mkdirSync(targetPath, { recursive: true });
}

function cleanupScratchRoot() {
  removeTarget(scratchRoot);
}

function normalizeName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function normalizeWindowsPath(value) {
  return path.resolve(String(value || '').replace(/^\\\\\?\\/, '')).toLowerCase();
}

function collectFiles(rootDir, currentDir = rootDir) {
  if (!fs.existsSync(currentDir)) {
    return [];
  }

  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(rootDir, absolutePath));
      continue;
    }
    if (entry.isFile()) {
      files.push(path.relative(rootDir, absolutePath));
    }
  }

  return files.sort();
}

function spawnSyncChecked(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: 'pipe',
    windowsHide: true,
    ...options,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const stdout = String(result.stdout || '').trim();
    const stderr = String(result.stderr || '').trim();
    const details = [stdout, stderr].filter(Boolean).join('\n');
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}.${details ? `\n${details}` : ''}`);
  }

  return result;
}

function escapePowerShellString(value) {
  return String(value || '').replace(/'/g, "''");
}

function runPowerShellJson(script) {
  const result = spawnSyncChecked('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    script,
  ]);
  const stdout = String(result.stdout || '').trim();
  assert(stdout, 'Expected PowerShell command to emit JSON output.');
  return JSON.parse(stdout);
}

function closeWindowForProcess(processId) {
  spawnSyncChecked('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    [
      '$ErrorActionPreference = "Stop"',
      `$process = Get-Process -Id ${Number(processId)}`,
      'if ($process.MainWindowHandle -ne 0) {',
      '  [void]$process.CloseMainWindow()',
      '}',
    ].join('; '),
  ]);
}

function stopProcess(processId) {
  spawnSyncChecked('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    `Stop-Process -Id ${Number(processId)} -Force`,
  ]);
}

function readProcessWindowInfo(processId) {
  return runPowerShellJson([
    '$ErrorActionPreference = "Stop"',
    'try {',
    `  $process = Get-Process -Id ${Number(processId)}`,
    '  [pscustomobject]@{',
    '    exists = $true',
    '    id = $process.Id',
    '    mainWindowHandle = [int64]$process.MainWindowHandle',
    '    mainWindowTitle = [string]$process.MainWindowTitle',
    '    path = [string]$process.Path',
    '  } | ConvertTo-Json -Compress',
    '} catch {',
    '  [pscustomobject]@{',
    '    exists = $false',
    '    message = $_.Exception.Message',
    '  } | ConvertTo-Json -Compress',
    '}',
  ].join('\n'));
}

function countVisibleWindowsForPath(appPath, expectedTitle) {
  return runPowerShellJson([
    '$ErrorActionPreference = "Stop"',
    `$appPath = '${escapePowerShellString(appPath)}'`,
    `$expectedTitle = '${escapePowerShellString(expectedTitle)}'`,
    '$matches = @(Get-Process | Where-Object {',
    '  $_.MainWindowHandle -ne 0 -and',
    '  $_.Path -eq $appPath -and',
    '  $_.MainWindowTitle -eq $expectedTitle',
    '})',
    '[pscustomobject]@{',
    '  count = $matches.Count',
    '  ids = @($matches | ForEach-Object { $_.Id })',
    '} | ConvertTo-Json -Compress',
  ].join('\n'));
}

function listProcessesUnderPath(rootPath) {
  const result = runPowerShellJson([
    '$ErrorActionPreference = "Stop"',
    `$rootPath = '${escapePowerShellString(rootPath)}'`,
    '$matches = @(Get-Process | Where-Object { $_.Path -like "$rootPath*" })',
    '[pscustomobject]@{',
    '  processes = @($matches | ForEach-Object {',
    '    [pscustomobject]@{',
    '      id = $_.Id',
    '      path = [string]$_.Path',
    '      mainWindowTitle = [string]$_.MainWindowTitle',
    '    }',
    '  })',
    '} | ConvertTo-Json -Compress',
  ].join('\n'));

  return Array.isArray(result.processes)
    ? result.processes
    : (result.processes ? [result.processes] : []);
}

function resolveInstalledResourcesRoot() {
  const directResourcesRoot = path.join(installRoot, 'resources');
  if (fs.existsSync(directResourcesRoot)) {
    return directResourcesRoot;
  }

  const manifestMatch = collectFiles(installRoot)
    .find((relativePath) => relativePath.split(path.sep).join('/').endsWith('runtime-manifests/windows-tauri-node-sidecar.json'));
  assert(manifestMatch, `Unable to locate installed Tauri resources under ${installRoot}.`);
  return path.dirname(path.dirname(path.join(installRoot, manifestMatch)));
}

function resolveInstalledExecutables(productName) {
  const executableFiles = collectFiles(installRoot)
    .filter((relativePath) => path.extname(relativePath).toLowerCase() === '.exe')
    .map((relativePath) => path.join(installRoot, relativePath));

  assert(executableFiles.length > 0, `No executables were installed into ${installRoot}.`);

  const normalizedProductName = normalizeName(productName);
  const uninstallPath = executableFiles.find((filePath) => /uninstall|unins/i.test(path.basename(filePath)));
  const appCandidates = executableFiles.filter((filePath) => filePath !== uninstallPath);
  assert(appCandidates.length > 0, `Unable to find installed desktop executable under ${installRoot}.`);

  const preferredAppPath = appCandidates.find((filePath) => normalizeName(path.basename(filePath, '.exe')) === normalizedProductName)
    || appCandidates.find((filePath) => path.dirname(filePath) === installRoot)
    || appCandidates[0];

  assert(uninstallPath, `Unable to find installed uninstaller under ${installRoot}.`);

  return {
    appPath: preferredAppPath,
    uninstallPath,
  };
}

function validateInstalledLayout(resourcesRoot) {
  const { manifestPath, manifest } = loadTauriNodeSidecarLayout({ workspaceRoot });
  const installedManifestPath = path.join(resourcesRoot, 'runtime-manifests', path.basename(manifestPath));

  assert(fs.existsSync(installedManifestPath), `Missing installed runtime manifest: ${installedManifestPath}`);
  assert(
    fs.readFileSync(installedManifestPath, 'utf8') === fs.readFileSync(manifestPath, 'utf8'),
    `Installed runtime manifest drifted from source metadata: ${installedManifestPath}`,
  );

  const nodeRuntimePath = path.join(resourcesRoot, manifest.nodeRuntime.relativePath);
  assert(fs.existsSync(nodeRuntimePath), `Missing installed bundled Node runtime: ${nodeRuntimePath}`);

  for (const resource of manifest.resourceCopies || []) {
    const expectedPath = path.join(resourcesRoot, resource.target);
    if (!fs.existsSync(expectedPath) && isOptionalResource(resource)) {
      continue;
    }
    assert(fs.existsSync(expectedPath), `Missing installed resource ${resource.id}: ${expectedPath}`);
    const stat = fs.statSync(expectedPath);
    if (resource.kind === 'file') {
      assert(stat.isFile(), `Expected installed resource ${resource.id} to be a file: ${expectedPath}`);
    } else {
      assert(stat.isDirectory(), `Expected installed resource ${resource.id} to be a directory: ${expectedPath}`);
    }
  }

  return {
    resourcesRoot,
    resourceCount: (manifest.resourceCopies || []).length,
    nodeRuntimePath,
  };
}

function waitForChildExit(child, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;

    const finish = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      resolve(value);
    };

    child.once('exit', (code, signal) => finish({ exited: true, code, signal }));
    child.once('error', (error) => finish({ exited: true, code: null, signal: null, error }));

    timer = setTimeout(() => finish({ exited: false, code: null, signal: null }), timeoutMs);
  });
}

async function waitForCondition(label, predicate, { timeoutMs, intervalMs = 500 }) {
  const startedAt = Date.now();
  let lastError = null;

  while ((Date.now() - startedAt) < timeoutMs) {
    try {
      const result = await predicate();
      if (result) {
        return result;
      }
    } catch (error) {
      lastError = error;
    }
    await delay(intervalMs);
  }

  const suffix = lastError instanceof Error ? ` Last error: ${lastError.message}` : '';
  throw new Error(`${label} did not complete within ${timeoutMs}ms.${suffix}`);
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : null;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
    server.on('error', reject);
  });
}

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { timeout: 5_000 }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const rawBody = Buffer.concat(chunks).toString('utf8');
        let body = null;
        try {
          body = rawBody ? JSON.parse(rawBody) : null;
        } catch {
          body = rawBody;
        }
        resolve({
          status: response.statusCode,
          body,
          rawBody,
        });
      });
    });

    request.on('error', reject);
    request.on('timeout', () => request.destroy(new Error(`Timed out requesting ${url}`)));
  });
}

function buildIsolatedLaunchEnv(serverPort) {
  const isolatedHome = path.join(stateRoot, 'home');
  const isolatedAppData = path.join(stateRoot, 'appdata');
  const isolatedLocalAppData = path.join(stateRoot, 'localappdata');
  const isolatedTemp = path.join(stateRoot, 'temp');

  for (const targetPath of [isolatedHome, isolatedAppData, isolatedLocalAppData, isolatedTemp]) {
    fs.mkdirSync(targetPath, { recursive: true });
  }

  return {
    ...process.env,
    HOME: isolatedHome,
    USERPROFILE: isolatedHome,
    APPDATA: isolatedAppData,
    LOCALAPPDATA: isolatedLocalAppData,
    TEMP: isolatedTemp,
    TMP: isolatedTemp,
    INSTRUCTION_ENGINE_DESKTOP_SERVER_PORT: String(serverPort),
    INSTRUCTION_ENGINE_DISABLE_STARTUP_ASSET_SYNC: '1',
  };
}

async function launchAndValidateInstalledApp(appPath, expectedTitle, expectedResourcesRoot) {
  const serverPort = await getFreePort();
  const launchEnv = buildIsolatedLaunchEnv(serverPort);
  console.log(`[tauri-native-smoke] launching ${path.basename(appPath)} on 127.0.0.1:${serverPort}`);
  const stdoutChunks = [];
  const stderrChunks = [];
  const child = spawn(appPath, [], {
    cwd: path.dirname(appPath),
    env: launchEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout.on('data', (chunk) => stdoutChunks.push(Buffer.from(chunk)));
  child.stderr.on('data', (chunk) => stderrChunks.push(Buffer.from(chunk)));

  let secondInstance = null;

  try {
    let healthResponse;
    try {
      healthResponse = await waitForCondition(
        'desktop health endpoint',
        async () => {
          const info = readProcessWindowInfo(child.pid);
          if (!info.exists) {
            throw new Error(info.message || `Desktop process ${child.pid} exited before /api/health became ready.`);
          }
          const response = await httpGetJson(`http://127.0.0.1:${serverPort}/api/health`);
          return response.status === 200 ? response : null;
        },
        { timeoutMs: startupTimeoutMs },
      );
    } catch (error) {
      const bootLogPath = path.join(stateRoot, 'home', '.elegy', 'tauri-boot.log');
      const bootLog = fs.existsSync(bootLogPath) ? fs.readFileSync(bootLogPath, 'utf8') : '';
      throw new Error(formatStartupDiagnostics({
        errorMessage: error instanceof Error ? error.message : String(error),
        bootLog,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
      }));
    }
    console.log('[tauri-native-smoke] loopback health endpoint responded');
    const runtimeRoot = healthResponse && healthResponse.body ? healthResponse.body.engineRoot : null;
    assert(runtimeRoot, 'Desktop health endpoint did not report engineRoot runtime root.');
    assert(
      normalizeWindowsPath(runtimeRoot) === normalizeWindowsPath(expectedResourcesRoot),
      `Running desktop runtime root drifted from installed resource root. health.engineRoot=${runtimeRoot}; installedResourcesRoot=${expectedResourcesRoot}`,
    );
    console.log(`[tauri-native-smoke] runtime root matches installed resources root ${expectedResourcesRoot}`);

    await waitForCondition(
      'desktop main window',
      async () => {
        const info = readProcessWindowInfo(child.pid);
        if (!info.exists) {
          throw new Error(info.message || `Desktop process ${child.pid} exited before its window was ready.`);
        }
        return info.mainWindowHandle !== 0 && info.mainWindowTitle === expectedTitle ? info : null;
      },
      { timeoutMs: startupTimeoutMs },
    );
    console.log(`[tauri-native-smoke] observed native window "${expectedTitle}"`);

    secondInstance = spawn(appPath, [], {
      cwd: path.dirname(appPath),
      env: launchEnv,
      stdio: 'ignore',
      windowsHide: true,
    });

    const secondExit = await waitForChildExit(secondInstance, singleInstanceTimeoutMs);
    assert(secondExit.exited, `Second desktop launch stayed alive beyond ${singleInstanceTimeoutMs}ms; expected Tauri single-instance reuse.`);
    if (secondExit.error) {
      throw new Error(`Second desktop launch failed unexpectedly: ${secondExit.error.message}`);
    }

    const windowCount = countVisibleWindowsForPath(appPath, expectedTitle);
    assert(windowCount.count === 1, `Expected exactly one visible native desktop window for ${appPath}; found ${windowCount.count}.`);

    return {
      processId: child.pid,
      serverPort,
      visibleWindowCount: windowCount.count,
    };
  } finally {
    if (secondInstance && !secondInstance.killed && secondInstance.exitCode == null) {
      try {
        stopProcess(secondInstance.pid);
      } catch {
        // best-effort cleanup for any stray second instance
      }
    }

    if (child.exitCode == null && !child.killed) {
      try {
        closeWindowForProcess(child.pid);
      } catch {
        // fall through to forced termination below
      }

      const exitResult = await waitForChildExit(child, 10_000);
      if (!exitResult.exited) {
        try {
          stopProcess(child.pid);
        } catch {
          // ignore cleanup failure; uninstall will surface any remaining lock problems
        }
      }
    }
  }
}

function installDesktop(installerPath) {
  ensureCleanDir(scratchRoot);
  fs.mkdirSync(installRoot, { recursive: true });
  console.log(`[tauri-native-smoke] installing ${path.basename(installerPath)} into ${installRoot}`);

  spawnSyncChecked(installerPath, ['/S', `/D=${installRoot}`], {
    cwd: path.dirname(installerPath),
    timeout: installTimeoutMs,
  });
}

async function uninstallDesktop(uninstallPath, appPath, resourcesRoot) {
  await waitForCondition(
    'installed process shutdown',
    async () => {
      const processes = listProcessesUnderPath(installRoot);
      return processes.length === 0 ? true : null;
    },
    { timeoutMs: 30_000, intervalMs: 1_000 },
  );

  console.log(`[tauri-native-smoke] uninstalling via ${path.basename(uninstallPath)}`);
  spawnSyncChecked(uninstallPath, ['/S'], {
    cwd: path.dirname(uninstallPath),
    timeout: uninstallTimeoutMs,
  });

  const requiredPayloadPaths = [
    appPath,
    path.join(resourcesRoot, 'runtime-manifests'),
    path.join(resourcesRoot, 'copilot-ui'),
    path.join(resourcesRoot, 'node'),
  ];

  await waitForCondition(
    'desktop uninstall cleanup',
    async () => requiredPayloadPaths.every((targetPath) => !fs.existsSync(targetPath)),
    { timeoutMs: uninstallTimeoutMs, intervalMs: 1_000 },
  );
}

async function main() {
  assert(process.platform === 'win32', 'validate-tauri-native-desktop-smoke.js only supports Windows hosts.');

  try {
    const releaseValidation = validateTauriWindowsReleaseArtifacts({ workspaceRoot });
    const tauriConfig = JSON.parse(fs.readFileSync(path.join(workspaceRoot, 'src-tauri', 'tauri.conf.json'), 'utf8'));
    const productName = String(tauriConfig.productName || '').trim();
    assert(productName, 'Expected src-tauri/tauri.conf.json to declare productName.');

    installDesktop(releaseValidation.installerPath);
    const executables = resolveInstalledExecutables(productName);
    console.log(`[tauri-native-smoke] installed app executable ${path.basename(executables.appPath)}`);
    const layout = validateInstalledLayout(resolveInstalledResourcesRoot());
    console.log(`[tauri-native-smoke] validated installed resource layout under ${layout.resourcesRoot}`);
    const runtimeValidation = await launchAndValidateInstalledApp(executables.appPath, productName, layout.resourcesRoot);
    await uninstallDesktop(executables.uninstallPath, executables.appPath, layout.resourcesRoot);

    console.log(
      `[tauri-native-smoke] installer=${path.basename(releaseValidation.installerPath)}; `
        + `app=${path.basename(executables.appPath)}; `
        + `window="${productName}"; `
        + `serverPort=${runtimeValidation.serverPort}; `
        + `resources=${layout.resourceCount}; `
        + `node=${path.basename(layout.nodeRuntimePath)}.`,
    );
  } finally {
    cleanupScratchRoot();
  }
}

if (require.main === module) {
  main().catch((error) => {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[tauri-native-smoke] ${detail}`);
    process.exit(1);
  });
}

module.exports = {
  formatStartupDiagnostics,
};
