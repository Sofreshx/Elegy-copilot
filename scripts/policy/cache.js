#!/usr/bin/env node

const crypto = require('crypto');
const path = require('path');

function normalizePathKey(filePath) {
  const abs = path.resolve(String(filePath || ''));
  return process.platform === 'win32' ? abs.toLowerCase() : abs;
}

function stableNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function buildPolicyCacheKey(input) {
  const source = input && typeof input === 'object' ? input : {};
  const payload = {
    path: normalizePathKey(source.filePath),
    mtimeMs: stableNumber(source.mtimeMs),
    size: stableNumber(source.size),
    policyVersion: String(source.policyVersion || ''),
    runtimeMode: String(source.runtimeMode || ''),
  };

  return crypto
    .createHash('sha256')
    .update(JSON.stringify(payload), 'utf8')
    .digest('hex');
}

class PolicyScanCache {
  constructor() {
    this.entriesByKey = new Map();
  }

  get(key) {
    return this.entriesByKey.get(String(key || '')) || null;
  }

  set(key, value) {
    this.entriesByKey.set(String(key || ''), value);
  }

  clear() {
    this.entriesByKey.clear();
  }
}

module.exports = {
  buildPolicyCacheKey,
  PolicyScanCache,
};
