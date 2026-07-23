'use strict';

const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { spawn, spawnSync } = require('child_process');

const { removeTarget } = require('./clean-tauri-release');

const READY_PREFIX = 'TAURI_RUNTIME_READY ';
const ERROR_PREFIX = 'TAURI_RUNTIME_ERROR ';
const BOOT_DIAGNOSTIC_PREFIX = '[boot:';
const workspaceRoot = path.resolve(__dirname, '..');
const stagedResourcesRoot = path.join(workspaceRoot, 'src-tauri', 'gen', 'resources');
const simStateRoot = path.join(workspaceRoot, '.tmp', 'desktop-prod-sim');
const startupTimeoutMs = 90_000;
const healthCheckTimeoutMs = 15_000;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readJson(filePath, label) {
  assert(fs.existsSync(filePath), `Missing ${label}: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
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
        resolve({ status: response.statusCode, body });
      });
    });
    request.on('error', reject);
    request.on('timeout', () => request.destroy(new Error(`Timed out requesting ${url}`)));
  });
}

function ensureCleanDir(targetPath) {
  removeTarget(targetPath);
  fs.mkdirSync(targetPath, { recursive: true });
}

function resolveStagedNodeExecutable() {
  const nodePath = path.join(stagedResourcesRoot, 'node', 'node.exe');
  assert(fs.existsSync(nodePath), `Staged Node executable not found: ${nodePath}. Run the build first.`);
  return nodePath;
}

function resolveStagedEntrypoint(relativePath, label) {
  const fullPath = path.join(stagedResourcesRoot, relativePath);
  assert(fs.existsSync(fullPath), `Staged ${label} not found: ${fullPath}. Run the build first.`);
  return fullPath;
}

function buildSimEnv(serverPort) {
  const isolatedHome = path.join(simStateRoot, 'home');
  const isolatedAppData = path.join(simStateRoot, 'appdata');
  const isolatedLocalAppData = path.join(simStateRoot, 'localappdata');
  const isolatedTemp = path.join(simStateRoot, 'temp');

  for (const targetPath of [isolatedHome, isolatedAppData, isolatedLocalAppData, isolatedTemp]) {
    fs.mkdirSync(targetPath, { recursive: true });
  }

  const packageJson = readJson(path.join(workspaceRoot, 'package.json'), 'desktop package.json');
  const nodeExecutable = resolveStagedNodeExecutable();
  const runtimeHostPath = resolveStagedEntrypoint(
    path.join('copilot-ui', 'lib', 'desktop-shell', 'tauri', 'runtimeHost.js'),
    'runtime host',
  );
  const serverEntrypoint = resolveStagedEntrypoint(
    path.join('copilot-ui', 'server.js'),
    'server entrypoint',
  );

  return {
    env: {
      ...process.env,
      HOME: isolatedHome,
      USERPROFILE: isolatedHome,
      APPDATA: isolatedAppData,
      LOCALAPPDATA: isolatedLocalAppData,
      TEMP: isolatedTemp,
      TMP: isolatedTemp,
      ELEGY_TAURI_RUNTIME_ROOT: stagedResourcesRoot,
      ELEGY_TAURI_NODE_EXECUTABLE: nodeExecutable,
      ELEGY_TAURI_SERVER_ENTRYPOINT: serverEntrypoint,
      ELEGY_TAURI_IS_PACKAGED: '1',
      ELEGY_TAURI_APP_VERSION: packageJson.version,
      INSTRUCTION_ENGINE_DESKTOP_SERVER_PORT: String(serverPort),
      INSTRUCTION_ENGINE_DISABLE_STARTUP_ASSET_SYNC: '1',
    },
    nodeExecutable,
    runtimeHostPath,
    serverEntrypoint,
    isolatedHome,
    appVersion: packageJson.version,
  };
}

async function waitForHealthEndpoint(port, timeoutMs) {
  const startedAt = Date.now();

  while ((Date.now() - startedAt) < timeoutMs) {
    try {
      const response = await httpGetJson(`http://127.0.0.1:${port}/api/health`);
      if (response.status === 200) {
        return response;
      }
    } catch {
      // server not ready yet
    }
    await delay(500);
  }

  throw new Error(`Health endpoint did not respond within ${timeoutMs}ms.`);
}

function launchRuntimeHost(simConfig) {
  const child = spawn(simConfig.nodeExecutable, [simConfig.runtimeHostPath], {
    cwd: path.dirname(simConfig.runtimeHostPath),
    env: simConfig.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  return child;
}

function collectStderrLines(child) {
  const lines = [];
  const rl = readline.createInterface({ input: child.stderr, terminal: false });
  rl.on('line', (line) => {
    lines.push(line);
    process.stderr.write(`[runtime-host:stderr] ${line}\n`);
  });
  return lines;
}

function waitForReadySignal(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const diagnosticLines = [];
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error(
          `Timed out after ${timeoutMs}ms waiting for TAURI_RUNTIME_READY.\n`
          + `Diagnostic output:\n${diagnosticLines.join('\n')}`,
        ));
      }
    }, timeoutMs);

    const rl = readline.createInterface({ input: child.stdout, terminal: false });
    rl.on('line', (line) => {
      if (line.startsWith(BOOT_DIAGNOSTIC_PREFIX)) {
        diagnosticLines.push(line);
        console.log(`  ${line}`);
        return;
      }

      if (line.startsWith(READY_PREFIX)) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          try {
            const payload = JSON.parse(line.slice(READY_PREFIX.length));
            resolve(payload);
          } catch (error) {
            reject(new Error(`Invalid READY payload: ${error.message}`));
          }
        }
        return;
      }

      if (line.startsWith(ERROR_PREFIX)) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error(`Runtime host reported ERROR: ${line.slice(ERROR_PREFIX.length)}`));
        }
        return;
      }

      diagnosticLines.push(line);
      console.log(`  ${line}`);
    });

    rl.on('close', () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(
          `Runtime host stdout closed before READY signal.\n`
          + `Diagnostic output:\n${diagnosticLines.join('\n')}`,
        ));
      }
    });
  });
}

function cleanupProcess(child) {
  return new Promise((resolve) => {
    if (child.exitCode != null || child.killed) {
      resolve();
      return;
    }

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    child.once('exit', finish);
    child.once('error', finish);

    try {
      // Send shutdown signal via stdin (mirrors Tauri's shutdown flow)
      if (child.stdin && !child.stdin.destroyed) {
        child.stdin.write('shutdown\n');
        child.stdin.end();
      }
    } catch {
      // best-effort
    }

    setTimeout(() => {
      try {
        child.kill();
      } catch {
        // already dead
      }
      setTimeout(finish, 2_000);
    }, 5_000);
  });
}

async function cleanup(simConfig, child, keepStaging) {
  console.log('\n[sim] cleaning up...');

  if (child) {
    await cleanupProcess(child);
  }

  removeTarget(simStateRoot);

  if (!keepStaging) {
    console.log(`[sim] removing staged resources: ${stagedResourcesRoot}`);
    removeTarget(stagedResourcesRoot);
  } else {
    console.log(`[sim] keeping staged resources: ${stagedResourcesRoot}`);
  }

  console.log('[sim] cleanup complete.');
}

async function main() {
  const args = process.argv.slice(2);
  const keepStaging = args.includes('--keep-staging');
  const skipBuild = args.includes('--skip-build');
  const keepAlive = args.includes('--keep-alive');

  console.log('[sim] Elegy Copilot Desktop Production Simulation');
  console.log(`[sim] workspace: ${workspaceRoot}`);
  console.log(`[sim] staged resources: ${stagedResourcesRoot}`);
  console.log(`[sim] options: keep-staging=${keepStaging}, skip-build=${skipBuild}, keep-alive=${keepAlive}`);

  if (!skipBuild) {
    console.log('\n[sim] building all components...');

    const buildSteps = [
      { label: 'UI', command: 'npm', args: ['run', 'ui:build'] },
      { label: 'local-tracker', command: 'npm', args: ['run', 'build:local-tracker:desktop'] },
      { label: 'local-repo-mcp', command: 'npm', args: ['run', 'build:local-repo-mcp:desktop'] },
      { label: 'runtime host', command: 'npm', args: ['run', 'build:tauri-runtime-host'] },
      { label: 'bundle staging', command: 'npm', args: ['run', 'prepare:tauri:win-bundle'] },
    ];

    for (const step of buildSteps) {
      console.log(`\n[sim] building ${step.label}...`);
      const result = spawnSync(step.command, step.args, {
        cwd: workspaceRoot,
        stdio: 'inherit',
        env: process.env,
      });
      if (result.status !== 0) {
        console.error(`[sim] build step "${step.label}" failed with exit code ${result.status}`);
        process.exit(1);
      }
    }
    console.log('\n[sim] all build steps completed.');
  }

  assert(fs.existsSync(stagedResourcesRoot), `Staged resources not found: ${stagedResourcesRoot}. Run without --skip-build first.`);

  const serverPort = await getFreePort();
  const simConfig = buildSimEnv(serverPort);

  console.log(`\n[sim] configuration:`);
  console.log(`  runtimeRoot: ${stagedResourcesRoot}`);
  console.log(`  nodeExecutable: ${simConfig.nodeExecutable}`);
  console.log(`  runtimeHost: ${simConfig.runtimeHostPath}`);
  console.log(`  serverEntrypoint: ${simConfig.serverEntrypoint}`);
  console.log(`  serverPort: ${serverPort}`);
  console.log(`  appVersion: ${simConfig.appVersion}`);
  console.log(`  isolatedHome: ${simConfig.isolatedHome}`);

  console.log('\n[sim] launching runtime host...');
  const child = launchRuntimeHost(simConfig);
  const stderrLines = collectStderrLines(child);
  let exited = false;

  child.on('exit', (code, signal) => {
    exited = true;
    console.log(`\n[sim] runtime host exited: code=${code}, signal=${signal}`);
  });

  try {
    const readyPayload = await waitForReadySignal(child, startupTimeoutMs);
    console.log(`\n[sim] READY signal received!`);
    console.log(`  windowUrl: ${readyPayload.windowUrl}`);

    const url = new URL(readyPayload.windowUrl);
    const port = url.port;
    console.log(`\n[sim] waiting for health endpoint on port ${port}...`);
    const health = await waitForHealthEndpoint(port, healthCheckTimeoutMs);
    console.log(`[sim] health endpoint responded: status=${health.status}`);

    if (keepAlive) {
      console.log('\n[sim] --keep-alive: runtime host will keep running. Press Ctrl+C to stop.');
      await new Promise((resolve) => {
        process.on('SIGINT', resolve);
        process.on('SIGTERM', resolve);
      });
    } else {
      console.log('\n[sim] startup simulation PASSED. Shutting down...');
    }
  } catch (error) {
    console.error(`\n[sim] STARTUP SIMULATION FAILED`);
    console.error(`[sim] ${error.message}`);
    if (stderrLines.length > 0) {
      console.error('\n[sim] captured stderr:');
      for (const line of stderrLines) {
        console.error(`  ${line}`);
      }
    }
    await cleanup(simConfig, child, keepStaging);
    process.exit(1);
  }

  await cleanup(simConfig, child, keepStaging);
  console.log('\n[sim] done.');
}

main().catch((error) => {
  console.error(`[sim] fatal: ${error.message}`);
  process.exit(1);
});
