const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

const workspaceRoot = path.resolve(__dirname, '..');
const unpackedDir = path.join(workspaceRoot, 'release', 'win-unpacked');
const executablePath = path.join(unpackedDir, 'Elegy Copilot.exe');
const STARTUP_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 1_000;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
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

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        try {
          resolve({ statusCode: response.statusCode, body: JSON.parse(raw) });
        } catch (error) {
          reject(new Error(`Invalid JSON response: ${error.message}; body=${raw}`));
        }
      });
    });

    request.on('error', reject);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(baseUrl, child) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < STARTUP_TIMEOUT_MS) {
    if (child.exitCode != null) {
      throw new Error(`Packaged desktop exited before health became ready (exitCode=${child.exitCode})`);
    }

    try {
      const response = await fetchJson(`${baseUrl}/api/health`);
      if (response.statusCode === 200) {
        return response.body;
      }
    } catch {
      // retry until timeout
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(`Timed out waiting for ${baseUrl}/api/health`);
}

function killProcessTree(child) {
  if (!child || child.exitCode != null) {
    return;
  }

  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', timeout: 15_000 });
      return;
    }
  } catch {
    // fall through to child.kill()
  }

  try {
    child.kill('SIGTERM');
  } catch {
    // ignore cleanup failures
  }
}

async function main() {
  assert(fs.existsSync(executablePath), `Packaged desktop executable not found at ${executablePath}. Run npm run package:preview first.`);

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-desktop-startup-smoke-'));
  const homeRoot = path.join(tempRoot, 'home');
  const appDataRoaming = path.join(homeRoot, 'AppData', 'Roaming');
  const appDataLocal = path.join(homeRoot, 'AppData', 'Local');
  const tempDir = path.join(tempRoot, 'temp');
  fs.mkdirSync(appDataRoaming, { recursive: true });
  fs.mkdirSync(appDataLocal, { recursive: true });
  fs.mkdirSync(tempDir, { recursive: true });

  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const stdout = [];
  const stderr = [];

  const child = spawn(executablePath, [], {
    cwd: unpackedDir,
    env: {
      ...process.env,
      HOME: homeRoot,
      USERPROFILE: homeRoot,
      APPDATA: appDataRoaming,
      LOCALAPPDATA: appDataLocal,
      TEMP: tempDir,
      TMP: tempDir,
      INSTRUCTION_ENGINE_DESKTOP_SERVER_PORT: String(port),
      INSTRUCTION_ENGINE_DISABLE_UPDATES: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  child.stdout.on('data', (chunk) => {
    stdout.push(chunk.toString('utf8'));
  });
  child.stderr.on('data', (chunk) => {
    stderr.push(chunk.toString('utf8'));
  });

  try {
    const health = await waitForHealth(baseUrl, child);
    assert(health.ok === true, 'Expected packaged desktop health.ok to be true');
    assert(health.startupManagedAssetSync && typeof health.startupManagedAssetSync === 'object', 'Expected startupManagedAssetSync in packaged health');
    assert(health.autonomousDecisionLog && typeof health.autonomousDecisionLog === 'object', 'Expected autonomousDecisionLog in packaged health');
    assert(health.startupManagedAssetSync.decisionLogged === true, 'Expected packaged startup sync decision to be logged');
    assert(health.autonomousDecisionLog.lastEventKind === 'startup.managed_asset_sync', 'Expected packaged startup decision log to report startup.managed_asset_sync');
    assert(typeof health.autonomousDecisionLog.path === 'string' && fs.existsSync(health.autonomousDecisionLog.path), 'Expected packaged autonomous decision log file to exist');

    console.log('[smoke] packaged desktop startup reached /api/health');
    console.log(`[smoke] health: ${baseUrl}/api/health`);
    console.log(`[smoke] startup sync outcome: ${health.startupManagedAssetSync.outcome}`);
    console.log(`[smoke] decision log: ${health.autonomousDecisionLog.path}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const stdoutText = stdout.join('').trim();
    const stderrText = stderr.join('').trim();
    const sections = [detail];
    if (stdoutText) {
      sections.push(`stdout:\n${stdoutText}`);
    }
    if (stderrText) {
      sections.push(`stderr:\n${stderrText}`);
    }
    throw new Error(sections.join('\n\n'));
  } finally {
    killProcessTree(child);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(`[smoke] packaged desktop startup smoke failed: ${detail}`);
  process.exit(1);
});