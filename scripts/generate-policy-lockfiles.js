#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const POLICY_PATH = path.join(REPO_ROOT, 'engine-assets', 'policy', 'pipeline-policy.json');
const SCHEMA_PATH = path.join(REPO_ROOT, 'engine-assets', 'policy', 'policy.schema.json');
const LOCK_PATH = path.join(REPO_ROOT, '.cli', 'policy', 'pipeline-policy.lock.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
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

function sha256Hex(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function toPosixRelative(absPath) {
  return path.relative(REPO_ROOT, absPath).split(path.sep).join('/');
}

function ensureSemver(value, fieldName) {
  if (typeof value !== 'string' || !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(value)) {
    throw new Error(`${fieldName} must be a semantic version (x.y.z)`);
  }
  return value;
}

function main() {
  const policy = readJson(POLICY_PATH);
  const schema = readJson(SCHEMA_PATH);

  const policyVersion = ensureSemver(policy.policyVersion, 'pipeline-policy.policyVersion');
  const schemaVersion = ensureSemver(policy.schemaVersion, 'pipeline-policy.schemaVersion');

  const policyCanonical = canonicalJson(policy);
  const schemaCanonical = canonicalJson(schema);

  const lock = {
    lockSchemaVersion: '1.0.0',
    policy: {
      name: String(policy.name || 'pipeline-policy'),
      source: toPosixRelative(POLICY_PATH),
      schemaSource: toPosixRelative(SCHEMA_PATH),
      policyVersion,
      schemaVersion,
      policySha256: sha256Hex(policyCanonical),
      schemaSha256: sha256Hex(schemaCanonical),
    },
  };

  fs.mkdirSync(path.dirname(LOCK_PATH), { recursive: true });
  fs.writeFileSync(LOCK_PATH, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');

  console.log(`Generated lockfile: ${toPosixRelative(LOCK_PATH)}`);
}

main();
