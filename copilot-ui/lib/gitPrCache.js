'use strict';
const AUTH_TTL_MS = 120_000;   // gh auth status changes rarely
const PR_TTL_MS = 15_000;      // PR state changes on create/merge/push

const authCache = new Map();   // repoPath -> { authenticated, available, error, ts }
const prCache = new Map();     // repoPath -> { result, ts }

function now() { return Date.now(); }

function readAuth(repoPath) {
  const e = authCache.get(repoPath);
  if (!e) return null;
  if (now() - e.ts > AUTH_TTL_MS) { authCache.delete(repoPath); return null; }
  return e;
}
function writeAuth(repoPath, v) { authCache.set(repoPath, { ...v, ts: now() }); }

function readPr(repoPath) {
  const e = prCache.get(repoPath);
  if (!e) return null;
  if (now() - e.ts > PR_TTL_MS) { prCache.delete(repoPath); return null; }
  return e.result;
}
function writePr(repoPath, result) { prCache.set(repoPath, { result, ts: now() }); }

function bust(repoPath) {           // call after create-PR / commit / push
  if (repoPath) { authCache.delete(repoPath); prCache.delete(repoPath); return; }
  authCache.clear(); prCache.clear();
}

module.exports = { readAuth, writeAuth, readPr, writePr, bust, AUTH_TTL_MS, PR_TTL_MS };
