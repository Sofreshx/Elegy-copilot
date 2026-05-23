'use strict';

const { sendJson: defaultSendJson, readJsonBody: defaultReadJsonBody } = require('./_helpers');
const { SESSION_ORCHESTRATION_CONTRACT_VERSION } = require('../lib/runtimeContracts');

function toErrorPayload(error, fallbackStatusCode = 500) {
  if (!error || typeof error !== 'object') {
    return {
      statusCode: fallbackStatusCode,
      body: { error: String(error || 'Unknown error') },
    };
  }

  return {
    statusCode: typeof error.statusCode === 'number' ? error.statusCode : fallbackStatusCode,
    body: {
      error: String(error.message || error),
    },
  };
}

function requireService(res, deps) {
  if (deps.uiRuntimeOverlayService) {
    return deps.uiRuntimeOverlayService;
  }

  deps.sendJson(res, 503, {
    error: 'UI Runtime Overlay service is unavailable.',
  });
  return null;
}

function requireExecutor(res, deps) {
  if (deps.executorService) {
    return deps.executorService;
  }

  deps.sendJson(res, 503, {
    error: 'Executor service is unavailable.',
  });
  return null;
}

function getExecutorJobId(result) {
  const jobId = result && result.job && typeof result.job.id === 'string'
    ? result.job.id.trim()
    : '';

  if (!jobId) {
    throw Object.assign(new Error('Executor job creation returned no usable job id.'), {
      statusCode: 502,
    });
  }

  return jobId;
}

function getReservationId(result) {
  const reservationId = result && result.changeRequest && typeof result.changeRequest.reservationId === 'string'
    ? result.changeRequest.reservationId.trim()
    : '';

  if (!reservationId) {
    throw Object.assign(new Error('Queue reservation returned no usable reservation id.'), {
      statusCode: 502,
    });
  }

  return reservationId;
}

function createRollbackFailure(originalError, rollbackFailures) {
  const originalMessage = originalError && originalError.message
    ? String(originalError.message)
    : String(originalError || 'Unknown error');
  const failedSteps = rollbackFailures.map((failure) => failure.step);
  const rollbackStepLabel = failedSteps.length > 1 ? 'cancel and release' : failedSteps[0];
  const rollbackDetails = rollbackFailures
    .map((failure) => `${failure.step} cleanup failed: ${failure.message}`)
    .join('; ');

  return Object.assign(
    new Error(
      `Rollback failed during ${rollbackStepLabel} cleanup after operational error: ${originalMessage}. ${rollbackDetails}`
    ),
    { statusCode: 502 }
  );
}

function rollbackQueuedChangeRequest({
  service,
  executor,
  sessionId,
  changeRequestId,
  executorJobId,
  originalError,
}) {
  const rollbackFailures = [];

  const cancelPromise = executorJobId
    ? Promise.resolve()
      .then(() => executor.cancelJob(executorJobId))
      .catch((error) => {
        rollbackFailures.push({
          step: 'cancel',
          message: error && error.message ? String(error.message) : String(error || 'Unknown error'),
        });
      })
    : Promise.resolve();

  return cancelPromise
    .then(() => {
      if (rollbackFailures.some((failure) => failure.step === 'cancel')) {
        return createRollbackFailure(originalError, rollbackFailures);
      }

      return Promise.resolve()
        .then(() => service.releaseQueueChangeRequest(sessionId, changeRequestId))
        .catch((error) => {
          rollbackFailures.push({
            step: 'release',
            message: error && error.message ? String(error.message) : String(error || 'Unknown error'),
          });
        })
        .then(() => (rollbackFailures.length ? createRollbackFailure(originalError, rollbackFailures) : null));
    });
}

function handleReleaseChangeRequest(ctx, deps) {
  const service = requireService(ctx.res, deps);
  if (!service) return;

  const sessionId = decodeURIComponent(ctx.match[1] || '').trim();
  const changeRequestId = decodeURIComponent(ctx.match[2] || '').trim();
  Promise.resolve()
    .then(() => service.releaseQueueChangeRequest(sessionId, changeRequestId))
    .then((result) => deps.sendJson(ctx.res, 200, result))
    .catch((error) => {
      const failure = toErrorPayload(error);
      deps.sendJson(ctx.res, failure.statusCode, failure.body);
    });
}

function handleListSessions(ctx, deps) {
  const service = requireService(ctx.res, deps);
  if (!service) return;
  deps.sendJson(ctx.res, 200, {
    sessions: service.listSessions(),
    orchestrationContractVersion: SESSION_ORCHESTRATION_CONTRACT_VERSION,
  });
}

function handleCreateSession(ctx, deps) {
  const service = requireService(ctx.res, deps);
  if (!service) return;

  deps.readJsonBody(ctx.req)
    .then((body) => service.createSession(body && typeof body === 'object' ? body : {}))
    .then((session) => deps.sendJson(ctx.res, 201, {
      session,
      orchestrationContractVersion: SESSION_ORCHESTRATION_CONTRACT_VERSION,
    }))
    .catch((error) => {
      const failure = toErrorPayload(error);
      deps.sendJson(ctx.res, failure.statusCode, failure.body);
    });
}

function handleCloseSession(ctx, deps) {
  const service = requireService(ctx.res, deps);
  if (!service) return;

  const sessionId = decodeURIComponent(ctx.match[1] || '').trim();
  Promise.resolve()
    .then(() => service.closeSession(sessionId))
    .then((session) => deps.sendJson(ctx.res, 200, { session }))
    .catch((error) => {
      const failure = toErrorPayload(error);
      deps.sendJson(ctx.res, failure.statusCode, failure.body);
    });
}

function handleAddObservation(ctx, deps) {
  const service = requireService(ctx.res, deps);
  if (!service) return;

  const sessionId = decodeURIComponent(ctx.match[1] || '').trim();
  deps.readJsonBody(ctx.req)
    .then((body) => service.addObservation(sessionId, body && typeof body === 'object' ? body : {}))
    .then((result) => deps.sendJson(ctx.res, 201, result))
    .catch((error) => {
      const failure = toErrorPayload(error);
      deps.sendJson(ctx.res, failure.statusCode, failure.body);
    });
}

function handleAddAnnotation(ctx, deps) {
  const service = requireService(ctx.res, deps);
  if (!service) return;

  const sessionId = decodeURIComponent(ctx.match[1] || '').trim();
  deps.readJsonBody(ctx.req)
    .then((body) => service.addAnnotation(sessionId, body && typeof body === 'object' ? body : {}))
    .then((result) => deps.sendJson(ctx.res, 201, result))
    .catch((error) => {
      const failure = toErrorPayload(error);
      deps.sendJson(ctx.res, failure.statusCode, failure.body);
    });
}

function handleAddChangeRequest(ctx, deps) {
  const service = requireService(ctx.res, deps);
  if (!service) return;

  const sessionId = decodeURIComponent(ctx.match[1] || '').trim();
  deps.readJsonBody(ctx.req)
    .then((body) => service.addChangeRequest(sessionId, body && typeof body === 'object' ? body : {}))
    .then((result) => deps.sendJson(ctx.res, 201, result))
    .catch((error) => {
      const failure = toErrorPayload(error);
      deps.sendJson(ctx.res, failure.statusCode, failure.body);
    });
}

function handleQueueChangeRequest(ctx, deps) {
  const service = requireService(ctx.res, deps);
  if (!service) return;

  const executor = requireExecutor(ctx.res, deps);
  if (!executor) return;

  const sessionId = decodeURIComponent(ctx.match[1] || '').trim();
  const changeRequestId = decodeURIComponent(ctx.match[2] || '').trim();

  let reservationSucceeded = false;
  let queuePersisted = false;
  let executorResult = null;
  let executorJobId = null;
  let reservationId = null;
  Promise.resolve()
    .then(() => service.reserveQueueChangeRequest(sessionId, changeRequestId))
    .then((result) => {
      reservationSucceeded = true;
      reservationId = getReservationId(result);
      return executor.createJob({
        title: result.changeRequest.title,
        prompt: result.changeRequest.prompt,
        repoId: result.session.repoId,
      });
    })
    .then((result) => {
      executorResult = result;
      executorJobId = getExecutorJobId(result);
      return service.queueChangeRequest(sessionId, changeRequestId, {
        reservationId,
        executorJobId,
        executorRunId: result && result.run ? result.run.id : null,
      });
    })
    .then((result) => {
      queuePersisted = true;
      deps.sendJson(ctx.res, 201, {
        session: result.session,
        changeRequest: result.changeRequest,
        job: executorResult ? executorResult.job : null,
        run: executorResult ? executorResult.run : null,
      });
    })
    .catch((error) => {
      const finalizeFailure = reservationSucceeded && !queuePersisted
        ? rollbackQueuedChangeRequest({
          service,
          executor,
          sessionId,
          changeRequestId,
          executorJobId,
          originalError: error,
        })
        : Promise.resolve(null);

      finalizeFailure.then((rollbackFailure) => {
        const failure = toErrorPayload(rollbackFailure || error);
        deps.sendJson(ctx.res, failure.statusCode, failure.body);
      });
    });
}

function register(deps = {}) {
  const resolvedDeps = {
    sendJson: deps.sendJson || defaultSendJson,
    readJsonBody: deps.readJsonBody || defaultReadJsonBody,
    uiRuntimeOverlayService: deps.uiRuntimeOverlayService || null,
    executorService: deps.executorService || null,
  };

  return [
    {
      method: 'GET',
      path: '/api/ui-runtime-overlay/sessions',
      handler: (ctx) => handleListSessions(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/ui-runtime-overlay/sessions',
      handler: (ctx) => handleCreateSession(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: /^\/api\/ui-runtime-overlay\/sessions\/([^/]+)\/close$/,
      handler: (ctx) => handleCloseSession(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: /^\/api\/ui-runtime-overlay\/sessions\/([^/]+)\/observations$/,
      handler: (ctx) => handleAddObservation(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: /^\/api\/ui-runtime-overlay\/sessions\/([^/]+)\/annotations$/,
      handler: (ctx) => handleAddAnnotation(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: /^\/api\/ui-runtime-overlay\/sessions\/([^/]+)\/change-requests$/,
      handler: (ctx) => handleAddChangeRequest(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: /^\/api\/ui-runtime-overlay\/sessions\/([^/]+)\/change-requests\/([^/]+)\/release$/,
      handler: (ctx) => handleReleaseChangeRequest(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: /^\/api\/ui-runtime-overlay\/sessions\/([^/]+)\/change-requests\/([^/]+)\/executor-job$/,
      handler: (ctx) => handleQueueChangeRequest(ctx, resolvedDeps),
    },
  ];
}

module.exports = { register };
