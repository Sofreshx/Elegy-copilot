'use strict';

const assert = require('node:assert/strict');

const { register } = require('./uiRuntimeOverlay');

let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  PASS: ${name}`);
  } catch (error) {
    console.error(`  FAIL: ${name}`);
    console.error(`    ${error.message}`);
    process.exitCode = 1;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createRequest(body) {
  return {
    __body: body,
    on() {
      return undefined;
    },
  };
}

function createResponse() {
  const state = {
    statusCode: null,
    bodyText: '',
  };

  return {
    writeHead(statusCode) {
      state.statusCode = statusCode;
    },
    end(text) {
      state.bodyText = String(text || '');
    },
    get statusCode() {
      return state.statusCode;
    },
    get body() {
      return state.bodyText.trim() ? JSON.parse(state.bodyText) : null;
    },
  };
}

async function invoke(routes, method, pathname, body) {
  const req = createRequest(body);
  const res = createResponse();

  for (const route of routes) {
    if (route.method !== method) continue;
    if (typeof route.path === 'string' && route.path === pathname) {
      route.handler({ req, res, match: null, pathname });
      await sleep(0);
      return { req, res };
    }
    if (route.path instanceof RegExp) {
      const match = pathname.match(route.path);
      if (match) {
        route.handler({ req, res, match, pathname });
        await sleep(0);
        return { req, res };
      }
    }
  }

  throw new Error(`Route not found for ${method} ${pathname}`);
}

async function run() {
  const sessions = [
    {
      id: 'overlay-1',
      status: 'attached',
      runtimeUrl: 'http://127.0.0.1:4173/',
      runtimeOrigin: 'http://127.0.0.1:4173',
      repoId: 'repo-1',
      repoPath: '/repo-1',
      repoLabel: 'Repo 1',
      packageRoot: '/repo-1',
      createdAt: '2026-03-28T10:00:00.000Z',
      updatedAt: '2026-03-28T10:00:00.000Z',
      closedAt: null,
      phase: 'attached',
      evidence: { source: 'copilot-ui', kind: 'runtime-url-registration' },
      observations: [],
      annotations: [],
      changeRequests: [],
      qualitySignals: [],
      lastAnalyzedAt: null,
    },
  ];
  const changeRequests = [
    {
      id: 'cr-1',
      observationId: 'obs-1',
      annotationId: 'ann-1',
      title: 'Fix save button behavior',
      request: 'Enable save when form is dirty.',
      prompt: 'Repo: Repo 1\nRequested change: Enable save when form is dirty.',
      status: 'draft',
      reservationId: null,
      executorJobId: null,
      executorRunId: null,
      createdAt: '2026-03-28T10:02:00.000Z',
      updatedAt: '2026-03-28T10:02:00.000Z',
      queuedAt: null,
    },
  ];
  const calls = [];
  const uiRuntimeOverlayService = {
    listSessions() {
      calls.push('list');
      return sessions;
    },
    async createSession(payload) {
      calls.push(`create:${payload.runtimeUrl}`);
      if (payload.runtimeUrl === 'http://missing-repo.test') {
        throw Object.assign(new Error('A Catalog repo must be selected before attaching a runtime.'), { statusCode: 409 });
      }
      return {
        ...sessions[0],
        id: 'overlay-2',
        runtimeUrl: payload.runtimeUrl,
        runtimeOrigin: 'http://127.0.0.1:4173',
      };
    },
    async closeSession(sessionId) {
      calls.push(`close:${sessionId}`);
      if (sessionId === 'missing') {
        throw Object.assign(new Error('UI Runtime Overlay session not found'), { statusCode: 404 });
      }
      if (changeRequests.some((entry) => entry.status === 'reserved')) {
        throw Object.assign(new Error('UI Runtime Overlay session cannot be closed while a change request reservation is in progress.'), {
          statusCode: 409,
        });
      }
      return {
        ...sessions[0],
        id: sessionId,
        status: 'closed',
        phase: 'closed',
        closedAt: '2026-03-28T10:05:00.000Z',
        updatedAt: '2026-03-28T10:05:00.000Z',
      };
    },
    getSession(sessionId) {
      calls.push(`get-session:${sessionId}`);
      if (sessionId === 'missing') {
        throw Object.assign(new Error('UI Runtime Overlay session not found'), { statusCode: 404 });
      }
      return sessions[0];
    },
    getChangeRequest(sessionId, changeRequestId) {
      calls.push(`get-change-request:${sessionId}:${changeRequestId}`);
      if (sessionId === 'missing') {
        throw Object.assign(new Error('UI Runtime Overlay session not found'), { statusCode: 404 });
      }
      if (changeRequestId === 'missing-change-request') {
        throw Object.assign(new Error('UI Runtime Overlay change request not found'), { statusCode: 404 });
      }
      return changeRequests[0];
    },
    async addObservation(sessionId, payload) {
      calls.push(`observation:${sessionId}`);
      if (sessionId === 'missing') {
        throw Object.assign(new Error('UI Runtime Overlay session not found'), { statusCode: 404 });
      }
      if (sessions[0].status === 'closed') {
        throw Object.assign(new Error('UI Runtime Overlay session is closed and does not allow further mutations.'), { statusCode: 409 });
      }
      if (!payload.summary || !String(payload.summary).trim()) {
        throw Object.assign(new Error('summary is required'), { statusCode: 400 });
      }
      return {
        session: sessions[0],
        observation: {
          id: 'obs-1',
          kind: payload.kind || 'note',
          summary: String(payload.summary).trim(),
        },
        qualitySignals: [
          {
            id: 'quality-signal-obs-1-slow-interaction',
            observationId: 'obs-1',
            kind: 'slow-interaction',
            severity: 'warning',
            summary: 'Interaction latency reached 2200ms.',
            createdAt: '2026-03-28T10:01:00.000Z',
          },
        ],
      };
    },
    async addAnnotation(sessionId, payload) {
      calls.push(`annotation:${sessionId}`);
      if (sessionId === 'missing') {
        throw Object.assign(new Error('UI Runtime Overlay session not found'), { statusCode: 404 });
      }
      if (sessions[0].status === 'closed') {
        throw Object.assign(new Error('UI Runtime Overlay session is closed and does not allow further mutations.'), { statusCode: 409 });
      }
      if (!payload.message || !String(payload.message).trim()) {
        throw Object.assign(new Error('message is required'), { statusCode: 400 });
      }
      return {
        session: sessions[0],
        annotation: {
          id: 'ann-1',
          observationId: payload.observationId || null,
          title: payload.title || 'Annotation',
          message: String(payload.message).trim(),
          status: 'open',
          createdAt: '2026-03-28T10:02:00.000Z',
          updatedAt: '2026-03-28T10:02:00.000Z',
        },
      };
    },
    async addChangeRequest(sessionId, payload) {
      calls.push(`change-request:${sessionId}`);
      if (sessionId === 'missing') {
        throw Object.assign(new Error('UI Runtime Overlay session not found'), { statusCode: 404 });
      }
      if (sessions[0].status === 'closed') {
        throw Object.assign(new Error('UI Runtime Overlay session is closed and does not allow further mutations.'), { statusCode: 409 });
      }
      if (!payload.request || !String(payload.request).trim()) {
        throw Object.assign(new Error('request is required'), { statusCode: 400 });
      }
      if (payload.status && String(payload.status).trim().toLowerCase() !== 'draft') {
        throw Object.assign(new Error('change request status must be draft when creating a change request.'), { statusCode: 400 });
      }
      return {
        session: sessions[0],
        changeRequest: {
          ...changeRequests[0],
          request: String(payload.request).trim(),
          prompt: payload.prompt || 'Repo: Repo 1\nRequested change: Enable save when form is dirty.',
          status: 'draft',
        },
      };
    },
    async reserveQueueChangeRequest(sessionId, changeRequestId) {
      calls.push(`reserve:${sessionId}:${changeRequestId}`);
      if (sessionId === 'missing') {
        throw Object.assign(new Error('UI Runtime Overlay session not found'), { statusCode: 404 });
      }
      if (sessions[0].status === 'closed') {
        throw Object.assign(new Error('UI Runtime Overlay session is closed and does not allow further mutations.'), { statusCode: 409 });
      }
      if (changeRequestId === 'missing-change-request') {
        throw Object.assign(new Error('UI Runtime Overlay change request not found'), { statusCode: 404 });
      }
      const changeRequest = changeRequests[0];
      if (changeRequest.status === 'queued') {
        throw Object.assign(new Error('UI Runtime Overlay change request is already queued.'), { statusCode: 409 });
      }
      if (changeRequest.status === 'reserved') {
        throw Object.assign(new Error('UI Runtime Overlay change request is already reserved for queueing.'), { statusCode: 409 });
      }
      if (changeRequest.status !== 'draft') {
        throw Object.assign(new Error(`UI Runtime Overlay change request cannot be queued from status "${changeRequest.status}".`), { statusCode: 409 });
      }

      changeRequests[0] = {
        ...changeRequest,
        status: 'reserved',
        reservationId: 'reservation-1',
        updatedAt: '2026-03-28T10:03:00.000Z',
      };

      return {
        session: sessions[0],
        changeRequest: changeRequests[0],
      };
    },
    async releaseQueueChangeRequest(sessionId, changeRequestId) {
      calls.push(`release:${sessionId}:${changeRequestId}`);
      if (sessionId === 'missing') {
        throw Object.assign(new Error('UI Runtime Overlay session not found'), { statusCode: 404 });
      }
      if (changeRequestId === 'missing-change-request') {
        throw Object.assign(new Error('UI Runtime Overlay change request not found'), { statusCode: 404 });
      }
      if (changeRequests[0].status === 'reserved') {
        changeRequests[0] = {
          ...changeRequests[0],
          status: 'draft',
          reservationId: null,
          executorJobId: null,
          executorRunId: null,
          queuedAt: null,
          updatedAt: '2026-03-28T10:04:00.000Z',
        };
      }

      return {
        session: sessions[0],
        changeRequest: changeRequests[0],
      };
    },
    async queueChangeRequest(sessionId, changeRequestId, meta) {
      calls.push(`queue:${sessionId}:${changeRequestId}`);
      if (sessionId === 'missing') {
        throw Object.assign(new Error('UI Runtime Overlay session not found'), { statusCode: 404 });
      }
      if (sessions[0].status === 'closed') {
        throw Object.assign(new Error('UI Runtime Overlay session is closed and does not allow further mutations.'), { statusCode: 409 });
      }
      if (changeRequestId === 'missing-change-request') {
        throw Object.assign(new Error('UI Runtime Overlay change request not found'), { statusCode: 404 });
      }
      const changeRequest = changeRequests[0];
      if (changeRequest.status === 'queued') {
        throw Object.assign(new Error('UI Runtime Overlay change request is already queued.'), { statusCode: 409 });
      }
      if (!meta || !String(meta.reservationId || '').trim()) {
        throw Object.assign(new Error('reservationId is required'), { statusCode: 400 });
      }
      if (changeRequest.status !== 'reserved' || String(changeRequest.reservationId || '').trim() !== String(meta.reservationId).trim()) {
        throw Object.assign(new Error('UI Runtime Overlay change request reservation is no longer active.'), { statusCode: 409 });
      }

      changeRequests[0] = {
        ...changeRequest,
        status: 'queued',
        reservationId: null,
        executorJobId: meta.executorJobId,
        executorRunId: meta.executorRunId,
        queuedAt: '2026-03-28T10:03:00.000Z',
        updatedAt: '2026-03-28T10:03:00.000Z',
      };

      return {
        session: sessions[0],
        changeRequest: changeRequests[0],
      };
    },
  };
  const executorService = {
    async createJob(payload) {
      calls.push(`executor:${payload.repoId}`);
      return {
        job: {
          id: 'job-1',
          title: payload.title,
          prompt: payload.prompt,
          repoId: payload.repoId,
        },
        run: {
          id: 'run-1',
          jobId: 'job-1',
          status: 'starting',
        },
      };
    },
    async cancelJob(jobId) {
      calls.push(`cancel:${jobId}`);
      return {
        jobId,
        status: 'cancelled',
      };
    },
  };

  const routes = register({
    uiRuntimeOverlayService,
    executorService,
    sendJson(res, code, payload) {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(payload));
    },
    readJsonBody: async (req) => req.__body || {},
  });

  await test('GET route returns overlay sessions', async () => {
    const response = await invoke(routes, 'GET', '/api/ui-runtime-overlay/sessions');
    assert.equal(response.res.statusCode, 200);
    assert.equal(response.res.body.sessions.length, 1);
    assert.equal(response.res.body.sessions[0].id, 'overlay-1');
  });

  await test('POST create route returns 201 on success and 409 when no repo is selected', async () => {
    const created = await invoke(routes, 'POST', '/api/ui-runtime-overlay/sessions', {
      runtimeUrl: 'http://127.0.0.1:4173',
    });
    const failed = await invoke(routes, 'POST', '/api/ui-runtime-overlay/sessions', {
      runtimeUrl: 'http://missing-repo.test',
    });

    assert.equal(created.res.statusCode, 201);
    assert.equal(created.res.body.session.id, 'overlay-2');
    assert.equal(failed.res.statusCode, 409);
    assert.match(failed.res.body.error, /Catalog repo must be selected/i);
  });

  await test('POST close route returns 200 for existing sessions and 404 for missing sessions', async () => {
    const closed = await invoke(routes, 'POST', '/api/ui-runtime-overlay/sessions/overlay-1/close');
    const missing = await invoke(routes, 'POST', '/api/ui-runtime-overlay/sessions/missing/close');

    assert.equal(closed.res.statusCode, 200);
    assert.equal(closed.res.body.session.status, 'closed');
    assert.equal(missing.res.statusCode, 404);
    assert.match(missing.res.body.error, /not found/i);
  });

  await test('POST observation route returns 201 on success and 400 on blank summary', async () => {
    const created = await invoke(routes, 'POST', '/api/ui-runtime-overlay/sessions/overlay-1/observations', {
      kind: 'interaction',
      summary: 'Save button did nothing.',
    });
    const failed = await invoke(routes, 'POST', '/api/ui-runtime-overlay/sessions/overlay-1/observations', {
      kind: 'note',
      summary: '   ',
    });

    assert.equal(created.res.statusCode, 201);
    assert.equal(created.res.body.observation.id, 'obs-1');
    assert.equal(created.res.body.qualitySignals[0].kind, 'slow-interaction');
    assert.equal(failed.res.statusCode, 400);
    assert.match(failed.res.body.error, /summary is required/i);
  });

  await test('POST annotation route returns 201 on success and 404 for missing sessions', async () => {
    const created = await invoke(routes, 'POST', '/api/ui-runtime-overlay/sessions/overlay-1/annotations', {
      observationId: 'obs-1',
      title: 'Button issue',
      message: 'Save button stays disabled after valid input.',
    });
    const missing = await invoke(routes, 'POST', '/api/ui-runtime-overlay/sessions/missing/annotations', {
      message: 'Missing session.',
    });

    assert.equal(created.res.statusCode, 201);
    assert.equal(created.res.body.annotation.id, 'ann-1');
    assert.equal(missing.res.statusCode, 404);
    assert.match(missing.res.body.error, /session not found/i);
  });

  await test('POST change request route returns 201 on success and 400 for invalid creation payloads', async () => {
    const created = await invoke(routes, 'POST', '/api/ui-runtime-overlay/sessions/overlay-1/change-requests', {
      annotationId: 'ann-1',
      request: 'Enable save when the profile form is dirty.',
    });
    const failed = await invoke(routes, 'POST', '/api/ui-runtime-overlay/sessions/overlay-1/change-requests', {
      request: ' ',
    });
    const nonDraft = await invoke(routes, 'POST', '/api/ui-runtime-overlay/sessions/overlay-1/change-requests', {
      request: 'Create an already queued change request.',
      status: 'queued',
    });

    assert.equal(created.res.statusCode, 201);
    assert.match(created.res.body.changeRequest.prompt, /Requested change/i);
    assert.equal(failed.res.statusCode, 400);
    assert.match(failed.res.body.error, /request is required/i);
    assert.equal(nonDraft.res.statusCode, 400);
    assert.match(nonDraft.res.body.error, /must be draft/i);
  });

  await test('POST release route returns 200 and supports synchronous release service methods', async () => {
    const originalChangeRequest = changeRequests[0];
    changeRequests[0] = {
      ...originalChangeRequest,
      status: 'reserved',
      updatedAt: '2026-03-28T10:03:00.000Z',
    };

    const releaseRoutes = register({
      uiRuntimeOverlayService: {
        ...uiRuntimeOverlayService,
        releaseQueueChangeRequest(sessionId, changeRequestId) {
          calls.push(`release-sync-route:${sessionId}:${changeRequestId}`);
          return uiRuntimeOverlayService.releaseQueueChangeRequest(sessionId, changeRequestId);
        },
      },
      executorService,
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload));
      },
      readJsonBody: async (req) => req.__body || {},
    });

    try {
      const released = await invoke(
        releaseRoutes,
        'POST',
        '/api/ui-runtime-overlay/sessions/overlay-1/change-requests/cr-1/release'
      );
      const missing = await invoke(
        releaseRoutes,
        'POST',
        '/api/ui-runtime-overlay/sessions/overlay-1/change-requests/missing-change-request/release'
      );

      assert.equal(released.res.statusCode, 200);
      assert.equal(released.res.body.changeRequest.status, 'draft');
      assert.equal(changeRequests[0].status, 'draft');
      assert.equal(missing.res.statusCode, 404);
      assert.match(missing.res.body.error, /change request not found/i);
      assert.ok(calls.includes('release-sync-route:overlay-1:cr-1'));
    } finally {
      changeRequests[0] = originalChangeRequest;
    }
  });

  await test('POST executor-job route creates a job, stores linkage, and returns 404 for missing change requests', async () => {
    const originalChangeRequest = changeRequests[0];

    try {
      const created = await invoke(
        routes,
        'POST',
        '/api/ui-runtime-overlay/sessions/overlay-1/change-requests/cr-1/executor-job'
      );
      const missing = await invoke(
        routes,
        'POST',
        '/api/ui-runtime-overlay/sessions/overlay-1/change-requests/missing-change-request/executor-job'
      );

      assert.equal(created.res.statusCode, 201);
      assert.equal(created.res.body.job.id, 'job-1');
      assert.equal(created.res.body.run.id, 'run-1');
      assert.equal(created.res.body.changeRequest.executorJobId, 'job-1');
      assert.equal(created.res.body.changeRequest.status, 'queued');
      assert.equal(missing.res.statusCode, 404);
      assert.match(missing.res.body.error, /change request not found/i);
    } finally {
      changeRequests[0] = originalChangeRequest;
    }
  });

  await test('POST executor-job route releases a reservation when executor job creation fails', async () => {
    const originalChangeRequest = changeRequests[0];
    const releaseCallsBefore = calls.filter((entry) => entry === 'release:overlay-1:cr-1').length;
    const queueCallsBefore = calls.filter((entry) => entry === 'queue:overlay-1:cr-1').length;
    const executorFailureRoutes = register({
      uiRuntimeOverlayService,
      executorService: {
        async createJob(payload) {
          calls.push(`executor-fail:${payload.repoId}`);
          throw Object.assign(new Error('Executor job creation failed.'), { statusCode: 502 });
        },
      },
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload));
      },
      readJsonBody: async (req) => req.__body || {},
    });

    try {
      const response = await invoke(
        executorFailureRoutes,
        'POST',
        '/api/ui-runtime-overlay/sessions/overlay-1/change-requests/cr-1/executor-job'
      );

      const releaseCallsAfter = calls.filter((entry) => entry === 'release:overlay-1:cr-1').length;
      const queueCallsAfter = calls.filter((entry) => entry === 'queue:overlay-1:cr-1').length;

      assert.equal(response.res.statusCode, 502);
      assert.match(response.res.body.error, /Executor job creation failed/i);
      assert.equal(changeRequests[0].status, 'draft');
      assert.equal(releaseCallsAfter, releaseCallsBefore + 1);
      assert.equal(queueCallsAfter, queueCallsBefore);
    } finally {
      changeRequests[0] = originalChangeRequest;
    }
  });

  await test('POST executor-job route handles synchronous release cleanup when executor job creation fails', async () => {
    const originalChangeRequest = changeRequests[0];
    const releaseCallsBefore = calls.filter((entry) => entry === 'release:overlay-1:cr-1').length;
    const syncCleanupRoutes = register({
      uiRuntimeOverlayService: {
        ...uiRuntimeOverlayService,
        releaseQueueChangeRequest(sessionId, changeRequestId) {
          calls.push(`release-sync-cleanup:${sessionId}:${changeRequestId}`);
          return uiRuntimeOverlayService.releaseQueueChangeRequest(sessionId, changeRequestId);
        },
      },
      executorService: {
        async createJob(payload) {
          calls.push(`executor-fail-sync-cleanup:${payload.repoId}`);
          throw Object.assign(new Error('Executor job creation failed.'), { statusCode: 502 });
        },
      },
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload));
      },
      readJsonBody: async (req) => req.__body || {},
    });

    try {
      const response = await invoke(
        syncCleanupRoutes,
        'POST',
        '/api/ui-runtime-overlay/sessions/overlay-1/change-requests/cr-1/executor-job'
      );

      const releaseCallsAfter = calls.filter((entry) => entry === 'release:overlay-1:cr-1').length;

      assert.equal(response.res.statusCode, 502);
      assert.match(response.res.body.error, /Executor job creation failed/i);
      assert.equal(changeRequests[0].status, 'draft');
      assert.equal(releaseCallsAfter, releaseCallsBefore + 1);
      assert.ok(calls.includes('release-sync-cleanup:overlay-1:cr-1'));
    } finally {
      changeRequests[0] = originalChangeRequest;
    }
  });

  await test('POST executor-job route releases a reservation when executor returns no usable job id', async () => {
    const originalChangeRequest = changeRequests[0];
    const releaseCallsBefore = calls.filter((entry) => entry === 'release:overlay-1:cr-1').length;
    const queueCallsBefore = calls.filter((entry) => entry === 'queue:overlay-1:cr-1').length;
    const malformedExecutorRoutes = register({
      uiRuntimeOverlayService,
      executorService: {
        async createJob(payload) {
          calls.push(`executor-missing-job:${payload.repoId}`);
          return {
            job: {
              id: '   ',
              title: payload.title,
              prompt: payload.prompt,
              repoId: payload.repoId,
            },
            run: {
              id: 'run-missing-job',
              status: 'starting',
            },
          };
        },
      },
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload));
      },
      readJsonBody: async (req) => req.__body || {},
    });

    try {
      const response = await invoke(
        malformedExecutorRoutes,
        'POST',
        '/api/ui-runtime-overlay/sessions/overlay-1/change-requests/cr-1/executor-job'
      );

      const releaseCallsAfter = calls.filter((entry) => entry === 'release:overlay-1:cr-1').length;
      const queueCallsAfter = calls.filter((entry) => entry === 'queue:overlay-1:cr-1').length;

      assert.equal(response.res.statusCode, 502);
      assert.match(response.res.body.error, /no usable job id/i);
      assert.equal(changeRequests[0].status, 'draft');
      assert.equal(releaseCallsAfter, releaseCallsBefore + 1);
      assert.equal(queueCallsAfter, queueCallsBefore);
    } finally {
      changeRequests[0] = originalChangeRequest;
    }
  });

  await test('POST executor-job route releases a reservation when queue persistence fails', async () => {
    const originalChangeRequest = changeRequests[0];
    const releaseCallsBefore = calls.filter((entry) => entry === 'release:overlay-1:cr-1').length;
    const cancelCallsBefore = calls.filter((entry) => entry === 'cancel:job-1').length;
    let cancelObserved = false;
    let cancelObservedAtRelease = false;
    const queueFailureRoutes = register({
      uiRuntimeOverlayService: {
        ...uiRuntimeOverlayService,
        async releaseQueueChangeRequest(sessionId, changeRequestId) {
          cancelObservedAtRelease = cancelObserved;
          return uiRuntimeOverlayService.releaseQueueChangeRequest(sessionId, changeRequestId);
        },
        async queueChangeRequest(sessionId, changeRequestId) {
          calls.push(`queue-fail:${sessionId}:${changeRequestId}`);
          throw Object.assign(new Error('Queue persistence failed.'), { statusCode: 503 });
        },
      },
      executorService: {
        ...executorService,
        async cancelJob(jobId) {
          cancelObserved = true;
          return executorService.cancelJob(jobId);
        },
      },
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload));
      },
      readJsonBody: async (req) => req.__body || {},
    });

    try {
      const response = await invoke(
        queueFailureRoutes,
        'POST',
        '/api/ui-runtime-overlay/sessions/overlay-1/change-requests/cr-1/executor-job'
      );

      const releaseCallsAfter = calls.filter((entry) => entry === 'release:overlay-1:cr-1').length;
      const cancelCallsAfter = calls.filter((entry) => entry === 'cancel:job-1').length;

      assert.equal(response.res.statusCode, 503);
      assert.match(response.res.body.error, /Queue persistence failed/i);
      assert.equal(changeRequests[0].status, 'draft');
      assert.equal(cancelCallsAfter, cancelCallsBefore + 1);
      assert.equal(releaseCallsAfter, releaseCallsBefore + 1);
      assert.equal(cancelObservedAtRelease, true);
      assert.ok(calls.includes('queue-fail:overlay-1:cr-1'));
    } finally {
      changeRequests[0] = originalChangeRequest;
    }
  });

  await test('POST executor-job route cancels the executor job and fails closed when a reservation is released mid-flight', async () => {
    const originalChangeRequest = changeRequests[0];
    const cancelCallsBefore = calls.filter((entry) => entry === 'cancel:job-1').length;
    const staleReservationRoutes = register({
      uiRuntimeOverlayService,
      executorService: {
        ...executorService,
        async createJob(payload) {
          calls.push(`executor-release-midflight:${payload.repoId}`);
          await uiRuntimeOverlayService.releaseQueueChangeRequest('overlay-1', 'cr-1');
          return executorService.createJob(payload);
        },
      },
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload));
      },
      readJsonBody: async (req) => req.__body || {},
    });

    try {
      const response = await invoke(
        staleReservationRoutes,
        'POST',
        '/api/ui-runtime-overlay/sessions/overlay-1/change-requests/cr-1/executor-job'
      );

      const cancelCallsAfter = calls.filter((entry) => entry === 'cancel:job-1').length;

      assert.equal(response.res.statusCode, 409);
      assert.match(response.res.body.error, /reservation is no longer active/i);
      assert.equal(changeRequests[0].status, 'draft');
      assert.equal(changeRequests[0].reservationId, null);
      assert.equal(changeRequests[0].executorJobId, null);
      assert.equal(changeRequests[0].queuedAt, null);
      assert.equal(cancelCallsAfter, cancelCallsBefore + 1);
      assert.ok(calls.includes('executor-release-midflight:repo-1'));
      assert.ok(calls.includes('queue:overlay-1:cr-1'));
    } finally {
      changeRequests[0] = originalChangeRequest;
    }
  });

  await test('POST executor-job route preserves the original queue failure when rollback release runs after session closure', async () => {
    const originalSession = sessions[0];
    const originalChangeRequest = changeRequests[0];
    let cleanupReleaseCalls = 0;

    const cleanupSafeService = {
      ...uiRuntimeOverlayService,
      async releaseQueueChangeRequest(sessionId, changeRequestId) {
        cleanupReleaseCalls += 1;
        calls.push(`release-after-close:${sessionId}:${changeRequestId}:${cleanupReleaseCalls}`);
        return uiRuntimeOverlayService.releaseQueueChangeRequest(sessionId, changeRequestId);
      },
    };
    const closeAfterReleaseRoutes = register({
      uiRuntimeOverlayService: cleanupSafeService,
      executorService: {
        ...executorService,
        async createJob(payload) {
          calls.push(`executor-release-then-close:${payload.repoId}`);
          await cleanupSafeService.releaseQueueChangeRequest('overlay-1', 'cr-1');
          sessions[0] = {
            ...sessions[0],
            status: 'closed',
            phase: 'closed',
            closedAt: '2026-03-28T10:05:00.000Z',
            updatedAt: '2026-03-28T10:05:00.000Z',
          };
          return executorService.createJob(payload);
        },
      },
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload));
      },
      readJsonBody: async (req) => req.__body || {},
    });

    try {
      const response = await invoke(
        closeAfterReleaseRoutes,
        'POST',
        '/api/ui-runtime-overlay/sessions/overlay-1/change-requests/cr-1/executor-job'
      );

      assert.equal(response.res.statusCode, 409);
      assert.match(response.res.body.error, /session is closed/i);
      assert.equal(cleanupReleaseCalls, 2);
      assert.equal(changeRequests[0].status, 'draft');
      assert.equal(changeRequests[0].reservationId, null);
      assert.ok(calls.includes('executor-release-then-close:repo-1'));
      assert.ok(calls.includes('release-after-close:overlay-1:cr-1:1'));
      assert.ok(calls.includes('release-after-close:overlay-1:cr-1:2'));
      assert.ok(!/Rollback failed/i.test(response.res.body.error));
    } finally {
      sessions[0] = originalSession;
      changeRequests[0] = originalChangeRequest;
    }
  });

  await test('POST executor-job route returns rollback-failed error when queue persistence fails and cancel cleanup fails', async () => {
    const originalChangeRequest = changeRequests[0];
    const releaseCallsBefore = calls.filter((entry) => entry === 'release:overlay-1:cr-1').length;
    const cancelCallsBefore = calls.filter((entry) => entry === 'cancel:job-1').length;
    const queueFailureRoutes = register({
      uiRuntimeOverlayService: {
        ...uiRuntimeOverlayService,
        async queueChangeRequest(sessionId, changeRequestId) {
          calls.push(`queue-fail-cancel:${sessionId}:${changeRequestId}`);
          throw Object.assign(new Error('Queue persistence failed.'), { statusCode: 503 });
        },
      },
      executorService: {
        ...executorService,
        async cancelJob(jobId) {
          calls.push(`cancel-fail:${jobId}`);
          throw Object.assign(new Error('Executor cancel cleanup failed.'), { statusCode: 502 });
        },
      },
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload));
      },
      readJsonBody: async (req) => req.__body || {},
    });

    try {
      const response = await invoke(
        queueFailureRoutes,
        'POST',
        '/api/ui-runtime-overlay/sessions/overlay-1/change-requests/cr-1/executor-job'
      );

      const releaseCallsAfter = calls.filter((entry) => entry === 'release:overlay-1:cr-1').length;
      const cancelCallsAfter = calls.filter((entry) => entry === 'cancel:job-1').length;

      assert.equal(response.res.statusCode, 502);
      assert.match(response.res.body.error, /Rollback failed/i);
      assert.match(response.res.body.error, /Queue persistence failed/i);
      assert.match(response.res.body.error, /cancel cleanup failed/i);
      assert.equal(changeRequests[0].status, 'reserved');
      assert.equal(cancelCallsAfter, cancelCallsBefore);
      assert.equal(releaseCallsAfter, releaseCallsBefore);
      assert.ok(calls.includes('cancel-fail:job-1'));
      assert.ok(calls.includes('queue-fail-cancel:overlay-1:cr-1'));
    } finally {
      changeRequests[0] = originalChangeRequest;
    }
  });

  await test('POST executor-job route returns rollback-failed error when queue persistence fails and release cleanup fails', async () => {
    const originalChangeRequest = changeRequests[0];
    const releaseCallsBefore = calls.filter((entry) => entry === 'release:overlay-1:cr-1').length;
    const cancelCallsBefore = calls.filter((entry) => entry === 'cancel:job-1').length;
    const queueFailureRoutes = register({
      uiRuntimeOverlayService: {
        ...uiRuntimeOverlayService,
        async releaseQueueChangeRequest(sessionId, changeRequestId) {
          calls.push(`release-fail:${sessionId}:${changeRequestId}`);
          throw Object.assign(new Error('Reservation release cleanup failed.'), { statusCode: 502 });
        },
        async queueChangeRequest(sessionId, changeRequestId) {
          calls.push(`queue-fail-release:${sessionId}:${changeRequestId}`);
          throw Object.assign(new Error('Queue persistence failed.'), { statusCode: 503 });
        },
      },
      executorService,
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload));
      },
      readJsonBody: async (req) => req.__body || {},
    });

    try {
      const response = await invoke(
        queueFailureRoutes,
        'POST',
        '/api/ui-runtime-overlay/sessions/overlay-1/change-requests/cr-1/executor-job'
      );

      const releaseCallsAfter = calls.filter((entry) => entry === 'release:overlay-1:cr-1').length;
      const cancelCallsAfter = calls.filter((entry) => entry === 'cancel:job-1').length;

      assert.equal(response.res.statusCode, 502);
      assert.match(response.res.body.error, /Rollback failed/i);
      assert.match(response.res.body.error, /Queue persistence failed/i);
      assert.match(response.res.body.error, /release cleanup failed/i);
      assert.equal(changeRequests[0].status, 'reserved');
      assert.equal(cancelCallsAfter, cancelCallsBefore + 1);
      assert.equal(releaseCallsAfter, releaseCallsBefore);
      assert.ok(calls.includes('release-fail:overlay-1:cr-1'));
      assert.ok(calls.includes('queue-fail-release:overlay-1:cr-1'));
    } finally {
      changeRequests[0] = originalChangeRequest;
    }
  });

  await test('POST executor-job route rejects already queued requests before creating an executor job', async () => {
    const originalChangeRequest = changeRequests[0];
    const executorCallsBefore = calls.filter((entry) => entry === 'executor:repo-1').length;

    changeRequests[0] = {
      ...originalChangeRequest,
      status: 'queued',
      executorJobId: 'job-existing',
      queuedAt: '2026-03-28T10:03:00.000Z',
    };

    try {
      const response = await invoke(
        routes,
        'POST',
        '/api/ui-runtime-overlay/sessions/overlay-1/change-requests/cr-1/executor-job'
      );

      const executorCallsAfter = calls.filter((entry) => entry === 'executor:repo-1').length;

      assert.equal(response.res.statusCode, 409);
      assert.match(response.res.body.error, /already queued/i);
      assert.equal(executorCallsAfter, executorCallsBefore);
    } finally {
      changeRequests[0] = originalChangeRequest;
    }
  });

  await test('POST executor-job route fails with 503 when executor service is unavailable', async () => {
    const executorUnavailableRoutes = register({
      uiRuntimeOverlayService,
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload));
      },
      readJsonBody: async (req) => req.__body || {},
    });

    const response = await invoke(
      executorUnavailableRoutes,
      'POST',
      '/api/ui-runtime-overlay/sessions/overlay-1/change-requests/cr-1/executor-job'
    );

    assert.equal(response.res.statusCode, 503);
    assert.match(response.res.body.error, /Executor service is unavailable/i);
  });

  assert.ok(calls.includes('list'));
  assert.ok(calls.includes('create:http://127.0.0.1:4173'));
  assert.ok(calls.includes('close:overlay-1'));
  assert.ok(calls.includes('observation:overlay-1'));
  assert.ok(calls.includes('annotation:overlay-1'));
  assert.ok(calls.includes('change-request:overlay-1'));
  assert.ok(calls.includes('reserve:overlay-1:cr-1'));
  assert.ok(calls.includes('queue:overlay-1:cr-1'));
  assert.ok(calls.includes('executor:repo-1'));

  console.log(`\n  ${passed} passed, ${process.exitCode ? 'some failed' : '0 failed'}\n`);
}

run().catch((error) => {
  console.error(`\n  FATAL: ${error.message}\n`);
  process.exitCode = 1;
});