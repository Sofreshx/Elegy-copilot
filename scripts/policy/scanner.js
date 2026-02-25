#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { buildPolicyCacheKey, PolicyScanCache } = require('./cache');

function sha256Hex(text) {
  return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex');
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;

  const out = {};
  for (const key of Object.keys(value).sort((a, b) => a.localeCompare(b))) {
    out[key] = canonicalize(value[key]);
  }
  return out;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function signWaiverPayload(waiver, secret) {
  const payload = {
    ...waiver,
    signature: {
      ...(waiver.signature || {}),
      value: '',
    },
  };

  return crypto
    .createHmac('sha256', String(secret || ''))
    .update(canonicalJson(payload), 'utf8')
    .digest('hex');
}

function evaluateBreakGlassWaiver(input) {
  const source = input && typeof input === 'object' ? input : {};
  const waiver = source.waiver;
  const controlId = String(source.controlId || '').trim();
  const policyVersion = String(source.policyVersion || '').trim();
  const secret = String(source.secret || '').trim();
  const nowMs = Number.isFinite(source.nowMs) ? Number(source.nowMs) : Date.now();

  if (!waiver || typeof waiver !== 'object' || Array.isArray(waiver)) {
    return { allowed: false, reason: 'waiver_missing' };
  }

  if (!Array.isArray(waiver.controls) || !controlId || !waiver.controls.includes(controlId)) {
    return { allowed: false, reason: 'scope_mismatch' };
  }

  if (policyVersion && String(waiver.policyVersion || '').trim() !== policyVersion) {
    return { allowed: false, reason: 'policy_version_mismatch' };
  }

  const expiresAt = Date.parse(String(waiver.expiresAt || ''));
  if (!Number.isFinite(expiresAt) || expiresAt <= nowMs) {
    return { allowed: false, reason: 'expired' };
  }

  if (!waiver.signature || typeof waiver.signature !== 'object') {
    return { allowed: false, reason: 'signature_missing' };
  }
  if (String(waiver.signature.algorithm || '') !== 'hmac-sha256') {
    return { allowed: false, reason: 'signature_algorithm_invalid' };
  }
  if (!secret) {
    return { allowed: false, reason: 'secret_missing' };
  }

  const expected = signWaiverPayload(waiver, secret);
  const provided = String(waiver.signature.value || '').toLowerCase();
  if (expected !== provided) {
    return { allowed: false, reason: 'signature_mismatch' };
  }

  return {
    allowed: true,
    reason: null,
  };
}

function createPolicyScanner(options = {}) {
  const cache = options.cache || new PolicyScanCache();
  const policyVersion = String(options.policyVersion || '');
  const runtimeMode = String(options.runtimeMode || '');
  const readText = options.readText || ((filePath) => fs.readFileSync(filePath, 'utf8'));
  const statFile = options.statFile || ((filePath) => fs.statSync(filePath));

  function scanFile(filePath) {
    const absPath = path.resolve(filePath);
    const stat = statFile(absPath);
    const cacheKey = buildPolicyCacheKey({
      filePath: absPath,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      policyVersion,
      runtimeMode,
    });

    const cached = cache.get(cacheKey);
    if (cached) {
      return {
        ...cached,
        fromCache: true,
        cacheKey,
      };
    }

    const content = readText(absPath);
    const result = {
      filePath: absPath,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      contentSha256: sha256Hex(content),
    };

    cache.set(cacheKey, result);
    return {
      ...result,
      fromCache: false,
      cacheKey,
    };
  }

  return {
    scanFile,
    clearCache: () => cache.clear(),
  };
}

module.exports = {
  createPolicyScanner,
  evaluateBreakGlassWaiver,
  signWaiverPayload,
};
