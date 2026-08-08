'use strict';

const { randomUUID } = require('node:crypto');
const { isMainThread, parentPort, Worker, workerData } = require('node:worker_threads');

const DEFAULT_TTL_MS = 30_000;
const DEFAULT_PAGE_LIMIT = 100;
const MAX_PAGE_LIMIT = 200;
const WORKER_KIND = 'dashboard-harness-session-snapshot';

if (!isMainThread && workerData && workerData.kind === WORKER_KIND) {
  try {
    const { listHarnessSessions } = require('./dashboardHarnessSessions');
    parentPort.postMessage({ ok: true, inventory: listHarnessSessions(workerData.options || {}) });
  } catch (error) {
    parentPort.postMessage({
      ok: false,
      error: error && error.message ? error.message : 'Unknown dashboard session inventory error',
    });
  }
}

function createSnapshotError(code, message, statusCode) {
  return Object.assign(new Error(message), { code, statusCode });
}

function normalizeLimit(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_PAGE_LIMIT;
  }
  return Math.min(parsed, MAX_PAGE_LIMIT);
}

function encodeCursor(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeCursor(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (
      !parsed
      || parsed.v !== 1
      || typeof parsed.snapshotId !== 'string'
      || typeof parsed.harnessId !== 'string'
      || !Number.isSafeInteger(parsed.offset)
      || parsed.offset < 0
    ) {
      throw new Error('invalid cursor payload');
    }
    return parsed;
  } catch {
    throw createSnapshotError('invalid_cursor', 'The session page cursor is invalid.', 400);
  }
}

function withoutSessions(harness) {
  const summary = { ...harness };
  delete summary.sessions;
  return summary;
}

function buildSummary(snapshot) {
  return {
    snapshotId: snapshot.id,
    generatedAtMs: snapshot.generatedAtMs,
    expiresAtMs: snapshot.expiresAtMs,
    totalSessionCount: snapshot.inventory.totalSessionCount,
    harnesses: snapshot.inventory.harnesses.map(withoutSessions),
    inventorySummary: snapshot.inventory.inventorySummary,
  };
}

function buildHarnessSessionsInWorker(options = {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(__filename, {
      workerData: { kind: WORKER_KIND, options },
    });
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      callback(value);
    };
    worker.once('message', (message) => {
      if (message && message.ok) {
        finish(resolve, message.inventory);
        return;
      }
      finish(reject, new Error(message && message.error ? message.error : 'Dashboard session inventory worker failed.'));
    });
    worker.once('error', (error) => finish(reject, error));
    worker.once('exit', (code) => {
      if (code !== 0) {
        finish(reject, new Error(`Dashboard session inventory worker exited with code ${code}.`));
      }
    });
  });
}

function scheduleSnapshotBuild(buildSnapshot) {
  return new Promise((resolve, reject) => {
    setImmediate(() => {
      try {
        resolve(buildSnapshot());
      } catch (error) {
        reject(error);
      }
    });
  });
}

class DashboardHarnessSessionSnapshotStore {
  constructor(options = {}) {
    if (typeof options.buildSnapshot !== 'function') {
      throw new TypeError('buildSnapshot must be a function');
    }
    this._buildSnapshot = options.buildSnapshot;
    this._ttlMs = Number.isFinite(options.ttlMs) && options.ttlMs > 0 ? options.ttlMs : DEFAULT_TTL_MS;
    this._now = typeof options.now === 'function' ? options.now : Date.now;
    this._createId = typeof options.createId === 'function' ? options.createId : randomUUID;
    this._snapshot = null;
    this._inFlight = null;
  }

  async getSnapshot() {
    const now = this._now();
    if (this._snapshot && now < this._snapshot.expiresAtMs) {
      return this._snapshot;
    }
    if (this._inFlight) {
      return this._inFlight;
    }
    this._inFlight = Promise.resolve()
      .then(() => this._buildSnapshot())
      .then((inventory) => {
        if (!inventory || !Array.isArray(inventory.harnesses)) {
          throw new Error('Dashboard session inventory returned an invalid response.');
        }
        const generatedAtMs = this._now();
        const snapshot = {
          id: this._createId(),
          generatedAtMs,
          expiresAtMs: generatedAtMs + this._ttlMs,
          inventory,
        };
        this._snapshot = snapshot;
        return snapshot;
      })
      .finally(() => {
        this._inFlight = null;
      });
    return this._inFlight;
  }

  async getLegacyInventory() {
    return (await this.getSnapshot()).inventory;
  }

  async getSummary() {
    return buildSummary(await this.getSnapshot());
  }

  async getPage(options = {}) {
    const decodedCursor = decodeCursor(options.cursor);
    const requestedHarnessId = typeof options.harnessId === 'string' ? options.harnessId.trim() : '';
    const harnessId = requestedHarnessId || decodedCursor?.harnessId || '';
    if (!harnessId) {
      throw createSnapshotError('harness_required', 'A harnessId is required.', 400);
    }
    if (decodedCursor && decodedCursor.harnessId !== harnessId) {
      throw createSnapshotError('invalid_cursor', 'The session page cursor belongs to another harness.', 400);
    }

    const snapshot = await this.getSnapshot();
    if (decodedCursor && decodedCursor.snapshotId !== snapshot.id) {
      throw createSnapshotError('stale_cursor', 'The session inventory changed. Restart pagination from the first page.', 409);
    }

    const harness = snapshot.inventory.harnesses.find((entry) => entry.harnessId === harnessId);
    if (!harness) {
      throw createSnapshotError('harness_not_found', `Harness "${harnessId}" was not found.`, 404);
    }

    const limit = normalizeLimit(options.limit);
    const offset = decodedCursor ? decodedCursor.offset : 0;
    const allSessions = Array.isArray(harness.sessions) ? harness.sessions : [];
    const sessions = allSessions.slice(offset, offset + limit);
    const nextOffset = offset + sessions.length;
    const hasMore = nextOffset < allSessions.length;

    return {
      snapshotId: snapshot.id,
      generatedAtMs: snapshot.generatedAtMs,
      expiresAtMs: snapshot.expiresAtMs,
      harnessId,
      harness: withoutSessions(harness),
      sessions,
      limit,
      hasMore,
      nextCursor: hasMore
        ? encodeCursor({ v: 1, snapshotId: snapshot.id, harnessId, offset: nextOffset })
        : null,
      page: {
        limit,
        offset,
        returnedCount: sessions.length,
        totalCount: allSessions.length,
        hasMore,
        nextCursor: hasMore
          ? encodeCursor({ v: 1, snapshotId: snapshot.id, harnessId, offset: nextOffset })
          : null,
      },
    };
  }
}

function createDashboardHarnessSessionSnapshotStore(options) {
  return new DashboardHarnessSessionSnapshotStore(options);
}

module.exports = {
  DEFAULT_PAGE_LIMIT,
  DEFAULT_TTL_MS,
  MAX_PAGE_LIMIT,
  DashboardHarnessSessionSnapshotStore,
  buildHarnessSessionsInWorker,
  createDashboardHarnessSessionSnapshotStore,
  scheduleSnapshotBuild,
};
