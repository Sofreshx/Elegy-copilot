'use strict';

/**
 * Shared HTTP helper utilities for route modules.
 * Extracted from server.js to support route decomposition.
 */

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

module.exports = { sendJson, sendText, readJsonBody, parseJsonBodySafe };
