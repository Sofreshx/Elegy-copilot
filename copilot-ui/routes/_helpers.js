'use strict';

/**
 * Shared HTTP helper utilities for route modules.
 * Extracted from server.js to support route decomposition.
 */

/**
 * Request context passed to every route handler by the route dispatcher.
 * NOTE: `ctx.query` does NOT exist. Use `ctx.u.searchParams` or the
 * `getQueryParam` helper to read query string parameters.
 *
 * @typedef {object} RequestContext
 * @property {import('http').IncomingMessage} req - Incoming HTTP request
 * @property {import('http').ServerResponse} res - Outgoing HTTP response
 * @property {URL} u - Parsed request URL; use `u.searchParams.get(key)` for query params
 * @property {string} pathname - Request pathname (set by route dispatcher)
 * @property {RegExpMatchArray|null} match - Regex capture groups (null for exact-path routes)
 * @property {string} engineRoot - Instruction engine root directory
 * @property {string} elegyHome - ~/.elegy directory
 * @property {string} elegyHomeAbs - Resolved absolute elegy home path
 * @property {string} opencodeHome - ~/.config/opencode directory
 * @property {string} codexHome - ~/.codex directory
 * @property {object} changeTracker - Change tracking service
 * @property {object} planningPersistenceConfig - Planning persistence configuration
 * @property {object} planningPersistenceState - Planning persistence state
 * @property {object} planningApiState - Planning API state
 * @property {object} providerState - Provider state
 * @property {object} elegyDb - Elegy database instance
 */

/**
 * Read a query string parameter from the request context.
 * Returns `fallback` (default '') when the parameter is absent or empty.
 * @param {RequestContext} ctx
 * @param {string} key
 * @param {string} [fallback='']
 * @returns {string}
 */
function getQueryParam(ctx, key, fallback = '') {
  const value = ctx.u.searchParams.get(key);
  return value ? value.trim() : fallback;
}

/**
 * Send a standardized JSON error response.
 * @param {import('http').ServerResponse} res
 * @param {number} statusCode
 * @param {string} message
 * @param {string} [code='internal_error']
 */
function sendError(res, statusCode, message, code = 'internal_error') {
  sendJson(res, statusCode, { ok: false, error: message, code });
}

/**
 * Normalize a list of items that may contain YAML colon-space objects.
 * YAML items like "- Key: explanation" parse as `{Key: explanation}` objects.
 * This reconstructs them as strings: "Key: explanation".
 * Strings pass through unchanged.
 * @param {Array} arr
 * @returns {string[]}
 */
function safeListArray(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map((item) => {
    if (typeof item === 'string') return item;
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      return Object.entries(item)
        .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : String(v)}`)
        .join('; ');
    }
    return String(item);
  });
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendText(res, code, text, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
  res.end(text || '');
}

async function readJsonBody(req, maxBytes = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error('Request body too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(Object.assign(new Error('Invalid JSON body'), { statusCode: 400, cause: e }));
      }
    });
    req.on('error', reject);
  });
}

function parseJsonBodySafe(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

module.exports = { sendJson, sendText, sendError, readJsonBody, parseJsonBodySafe, getQueryParam, safeListArray };
