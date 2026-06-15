'use strict';

/**
 * OpenCode Server singleton.
 * Manages the lifecycle of an `opencode serve` process for agent interactions.
 * Uses @opencode-ai/sdk (ESM) via dynamic import() since this is a CJS module.
 */

let clientPromise = null;
let serverInstance = null;
let isStarting = false;
let startError = null;

const DEFAULT_PORT = 4096;
const DEFAULT_HOST = '127.0.0.1';

/**
 * Get an opencode client instance. Lazily starts the server if not running.
 * @returns {Promise<{ client: any, url: string }>}
 */
async function getOpencodeClient() {
  if (clientPromise) {
    return clientPromise;
  }

  if (isStarting) {
    // Wait for the in-flight start
    return clientPromise;
  }

  isStarting = true;
  startError = null;

  clientPromise = (async () => {
    try {
      // Try to connect to an already-running opencode serve
      const { createOpencodeClient } = await import('@opencode-ai/sdk');
      
      try {
        const client = createOpencodeClient({ baseUrl: `http://${DEFAULT_HOST}:${DEFAULT_PORT}` });
        // Quick health check to see if it's alive
        await client.global.health();
        serverInstance = { url: `http://${DEFAULT_HOST}:${DEFAULT_PORT}`, external: true };
        return { client, url: serverInstance.url };
      } catch {
        // Not running — start our own
      }

      // Start opencode serve
      const { spawn } = require('child_process');
      const openCodeBin = await resolveOpencodeBin();
      if (!openCodeBin) {
        throw new Error('opencode CLI not found. Install with: npm install -g opencode-ai');
      }

      return new Promise((resolve, reject) => {
        const child = spawn(openCodeBin, ['serve', '--hostname', DEFAULT_HOST, '--port', String(DEFAULT_PORT)], {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env },
        });

        let resolved = false;
        const timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            reject(new Error('opencode serve timed out starting'));
          }
        }, 15000);

        child.stdout.on('data', (data) => {
          const output = data.toString();
          // opencode prints "opencode server listening on http://..."
          const match = output.match(/on\s+(https?:\/\/[^\s]+)/);
          if (match && !resolved) {
            resolved = true;
            clearTimeout(timeout);
            const url = `http://${DEFAULT_HOST}:${DEFAULT_PORT}`;
            serverInstance = { url, child, external: false };
            const client = createOpencodeClient({ baseUrl: url });
            resolve({ client, url });
          }
        });

        child.stderr.on('data', (data) => {
          // opencode may output to stderr during startup
        });

        child.on('error', (err) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            reject(err);
          }
        });

        child.on('exit', (code) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            reject(new Error(`opencode serve exited with code ${code}`));
          }
          serverInstance = null;
          clientPromise = null;
        });
      });
    } catch (err) {
      startError = err;
      clientPromise = null;
      throw err;
    } finally {
      isStarting = false;
    }
  })();

  return clientPromise;
}

/**
 * Resolve the opencode binary path.
 * @returns {Promise<string|null>}
 */
async function resolveOpencodeBin() {
  const which = require('which');
  try {
    return await which('opencode');
  } catch {
    try {
      return await which('opencode.cmd');
    } catch {
      return null;
    }
  }
}

/**
 * Check if the opencode server is currently running.
 */
function isRunning() {
  return clientPromise !== null && serverInstance !== null;
}

/**
 * Stop the opencode server if we started it.
 */
async function stop() {
  if (serverInstance && !serverInstance.external && serverInstance.child) {
    serverInstance.child.kill();
  }
  serverInstance = null;
  clientPromise = null;
  isStarting = false;
  startError = null;
}

/**
 * Get the last start error, if any.
 */
function getLastError() {
  return startError;
}

module.exports = {
  getOpencodeClient,
  isRunning,
  stop,
  getLastError,
};
