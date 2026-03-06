'use strict';

const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');
const { Pool } = require('pg');

const START_TIMEOUT_MS = 30_000;
const STOP_TIMEOUT_MS = 10_000;
const START_RETRY_DELAY_MS = 250;
const START_RETRY_COUNT = 40;

function defaultLogger(message) {
  console.log(message);
}

function log(logger, message) {
  (typeof logger === 'function' ? logger : defaultLogger)(`[embedded-postgres] ${message}`);
}

function exists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function resolveRuntimeHome(runtimeRoot, explicitRuntimePath) {
  const candidates = [];
  if (typeof explicitRuntimePath === 'string' && explicitRuntimePath.trim()) {
    candidates.push(path.resolve(explicitRuntimePath.trim()));
  }

  candidates.push(
    path.resolve(runtimeRoot, 'embedded-postgres-runtime'),
    path.resolve(runtimeRoot, 'engine-assets', 'embedded-postgres-runtime'),
    path.resolve(runtimeRoot, 'engine-assets', 'runtime', 'embedded-postgres')
  );

  return candidates.find((candidate) => exists(candidate)) || null;
}

function resolveBinary(runtimeHome, binaryName) {
  const executableName = process.platform === 'win32' ? `${binaryName}.exe` : binaryName;
  const candidates = [
    path.join(runtimeHome, 'bin', executableName),
    path.join(runtimeHome, 'postgresql', 'bin', executableName),
    path.join(runtimeHome, 'pgsql', 'bin', executableName),
  ];

  return candidates.find((candidate) => exists(candidate)) || null;
}

function execFileAsync(file, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    childProcess.execFile(file, args, { windowsHide: true, timeout: timeoutMs }, (error, stdout, stderr) => {
      if (error) {
        const err = new Error(
          `${file} ${args.join(' ')} failed: ${String(stderr || stdout || error.message || '').trim()}`
        );
        err.cause = error;
        reject(err);
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const info = server.address();
      const port = info && typeof info === 'object' ? info.port : null;
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        if (!Number.isFinite(port)) {
          reject(new Error('failed to allocate embedded postgres port'));
          return;
        }
        resolve(Number(port));
      });
    });
  });
}

async function waitForReady(connectionString) {
  let lastError = null;
  for (let i = 0; i < START_RETRY_COUNT; i += 1) {
    const pool = new Pool({
      connectionString,
      max: 1,
      idleTimeoutMillis: 1_000,
      connectionTimeoutMillis: 1_000,
    });
    try {
      await pool.query('SELECT 1');
      await pool.end();
      return;
    } catch (error) {
      lastError = error;
      await pool.end().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, START_RETRY_DELAY_MS));
    }
  }

  throw lastError || new Error('embedded postgres did not become ready');
}

async function ensureInitialized(initdbBin, dataDir, logger) {
  const pgVersionMarker = path.join(dataDir, 'PG_VERSION');
  if (exists(pgVersionMarker)) {
    return;
  }

  fs.mkdirSync(dataDir, { recursive: true });
  log(logger, `initializing data directory at ${dataDir}`);
  await execFileAsync(
    initdbBin,
    ['-D', dataDir, '--auth=trust', '--username=postgres', '--encoding=UTF8', '--locale=C'],
    START_TIMEOUT_MS
  );
}

async function startEmbeddedPostgresRuntime(options = {}) {
  const runtimeRoot = typeof options.runtimeRoot === 'string' ? options.runtimeRoot : process.cwd();
  const logger = options.logger;

  if (process.platform !== 'win32') {
    log(logger, `skip startup on unsupported platform: ${process.platform}`);
    return null;
  }

  const runtimeHome = resolveRuntimeHome(runtimeRoot, options.runtimePath);
  if (!runtimeHome) {
    log(logger, 'runtime not found; continuing without embedded postgres');
    return null;
  }

  const pgCtlBin = resolveBinary(runtimeHome, 'pg_ctl');
  const initdbBin = resolveBinary(runtimeHome, 'initdb');
  if (!pgCtlBin || !initdbBin) {
    log(logger, `required binaries missing under ${runtimeHome}; continuing without embedded postgres`);
    return null;
  }

  const stateRoot = typeof options.stateRoot === 'string' && options.stateRoot.trim()
    ? options.stateRoot.trim()
    : path.join(os.homedir(), '.copilot', 'embedded-postgres');

  const dataDir = path.join(stateRoot, 'data');
  const logPath = path.join(stateRoot, 'postgres.log');
  fs.mkdirSync(stateRoot, { recursive: true });

  const port = await findFreePort();
  await ensureInitialized(initdbBin, dataDir, logger);
  const postgresArgs = `-p ${port} -h 127.0.0.1`;
  await execFileAsync(pgCtlBin, ['-D', dataDir, '-l', logPath, '-w', 'start', '-o', postgresArgs], START_TIMEOUT_MS);

  const connectionString = `postgresql://postgres@127.0.0.1:${port}/postgres`;
  await waitForReady(connectionString);
  log(logger, `started on 127.0.0.1:${port}`);

  const pool = new Pool({
    connectionString,
    max: 4,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 3_000,
  });

  let stopped = false;
  return {
    connectionString,
    queryClient: {
      query(sql, params) {
        return pool.query(sql, params);
      },
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      await pool.end().catch(() => {});
      await execFileAsync(pgCtlBin, ['-D', dataDir, '-w', 'stop', '-m', 'fast'], STOP_TIMEOUT_MS).catch(() => {});
      log(logger, 'stopped');
    },
  };
}

module.exports = {
  startEmbeddedPostgresRuntime,
};
