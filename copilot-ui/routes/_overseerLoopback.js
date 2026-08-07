'use strict';

const { sendJson: defaultSendJson, readJsonBody: defaultReadJsonBody } = require('./_helpers');

const OVERSEER_ORIGIN = 'http://127.0.0.1:4173';
const SESSION_PATH = '/api/session';
const JSON_BODY_LIMIT = 64 * 1024;
const FILE_BODY_LIMIT = 20 * 1024 * 1024;

function redactSecrets(value) {
  if (typeof value === 'string') return value
    .replace(/[A-Za-z]:[\\/][^\s)]+/g, '[local path redacted]')
    .replace(/(?:token|secret|password|api[_ -]?key|authorization)\s*[:=]\s*[^\s,;]+/gi, '$1: [redacted]');
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (/token|authorization|session/i.test(key)) continue;
    result[key] = redactSecrets(item);
  }
  return result;
}

function safeProxyError(code, message = 'Overseer could not complete this request.') {
  return { ok: false, error: 'overseer_request_failed', code, message };
}

async function readBinaryBody(req, maxBytes = FILE_BODY_LIMIT) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) { const error = new Error('The intake file is larger than 20 MiB.'); error.statusCode = 413; throw error; }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function createLoopbackClient({ fetch: configuredFetch, sendJson: configuredSendJson, readJsonBody: configuredReadJsonBody, resolveTarget, binaryPaths = new Set() } = {}) {
  const fetchImpl = configuredFetch || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required for the Overseer loopback client.');
  const sendJson = configuredSendJson || defaultSendJson;
  const readJsonBody = configuredReadJsonBody || ((req, options) => defaultReadJsonBody(req, options?.maxBytes ?? JSON_BODY_LIMIT));
  let cachedToken = null;
  let sessionRequest = null;

  async function sessionToken({ refresh = false } = {}) {
    if (!refresh && cachedToken) return cachedToken;
    if (!refresh && sessionRequest) return sessionRequest;
    sessionRequest = (async () => {
      let response;
      try { response = await fetchImpl(`${OVERSEER_ORIGIN}${SESSION_PATH}`, { method: 'GET', headers: { accept: 'application/json' } }); }
      catch { const error = new Error('Overseer is unavailable. Start Overseer and try again.'); error.code = 'overseer_unavailable'; error.statusCode = 503; throw error; }
      if (!response.ok) { const error = new Error('Overseer session could not be established.'); error.code = 'overseer_session_unavailable'; error.statusCode = response.status >= 500 ? 503 : 502; throw error; }
      let body; try { body = await response.json(); } catch { body = null; }
      if (!body || typeof body.token !== 'string' || !body.token) { const error = new Error('Overseer returned an invalid session.'); error.code = 'overseer_session_invalid'; error.statusCode = 502; throw error; }
      cachedToken = body.token;
      return cachedToken;
    })();
    try { return await sessionRequest; } finally { sessionRequest = null; }
  }

  async function handle(ctx) {
    const pathname = ctx.pathname || ctx.u?.pathname || '';
    const targetPath = resolveTarget(pathname);
    if (!targetPath) { const error = new Error('Route is not allowlisted.'); error.statusCode = 404; throw error; }
    const method = ctx.req.method;
    let body;
    let contentType;
    const headers = {};
    if (method === 'POST' || method === 'PUT') {
      if (binaryPaths.has(pathname)) {
        body = await readBinaryBody(ctx.req);
        contentType = ctx.req.headers?.['content-type'] || 'application/octet-stream';
        if (ctx.req.headers?.['x-filename']) headers['x-filename'] = String(ctx.req.headers['x-filename']).slice(0, 180);
        if (ctx.req.headers?.['x-mime-type']) headers['x-mime-type'] = String(ctx.req.headers['x-mime-type']).slice(0, 120);
      } else {
        const value = await readJsonBody(ctx.req, { maxBytes: JSON_BODY_LIMIT });
        body = JSON.stringify(value || {});
        contentType = 'application/json';
      }
    }
    let retried = false;
    while (true) {
      const token = await sessionToken({ refresh: retried });
      let response;
      try { response = await fetchImpl(`${OVERSEER_ORIGIN}${targetPath}${ctx.u?.search || ''}`, { method, headers: { accept: 'application/json', 'x-overseer-session': token, ...headers, ...(contentType ? { 'content-type': contentType } : {}) }, body, signal: AbortSignal.timeout(8000) }); }
      catch (error) { const wrapped = new Error('Overseer is unavailable or timed out.'); wrapped.code = error?.name === 'TimeoutError' ? 'overseer_timeout' : 'overseer_unavailable'; wrapped.statusCode = 503; throw wrapped; }
      if (response.status === 403 && !retried) { cachedToken = null; retried = true; continue; }
      let payload = null; try { payload = await response.json(); } catch { payload = null; }
      if (!response.ok) { const error = new Error('Overseer could not complete this request.'); error.code = response.status >= 500 ? 'overseer_unavailable' : `overseer_${response.status}`; error.statusCode = response.status >= 500 ? 503 : response.status; throw error; }
      sendJson(ctx.res, response.status, redactSecrets(payload || {}));
      return;
    }
  }

  return { handler(ctx) { return handle(ctx).catch((error) => sendJson(ctx.res, Number.isInteger(error?.statusCode) ? error.statusCode : 503, safeProxyError(error?.code || 'overseer_unavailable'))); } };
}

module.exports = { OVERSEER_ORIGIN, redactSecrets, createLoopbackClient };
