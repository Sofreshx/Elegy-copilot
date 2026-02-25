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

function fail(message) {
  console.error(`Policy lockfile validation failed: ${message}`);
  process.exit(1);
}

function main() {
  if (!fs.existsSync(LOCK_PATH)) fail('missing .cli/policy/pipeline-policy.lock.json');

  const lock = readJson(LOCK_PATH);
  const policy = readJson(POLICY_PATH);
  const schema = readJson(SCHEMA_PATH);

  if (!lock || typeof lock !== 'object') fail('lockfile root must be an object');
  if (String(lock.lockSchemaVersion || '') !== '1.0.0') fail('lockSchemaVersion must be 1.0.0');

  const lockPolicy = lock.policy;
  if (!lockPolicy || typeof lockPolicy !== 'object') fail('lockfile.policy must be an object');

  const expectedSource = toPosixRelative(POLICY_PATH);
  const expectedSchemaSource = toPosixRelative(SCHEMA_PATH);
  if (lockPolicy.source !== expectedSource) fail(`source mismatch (${lockPolicy.source} != ${expectedSource})`);
  if (lockPolicy.schemaSource !== expectedSchemaSource) fail(`schemaSource mismatch (${lockPolicy.schemaSource} != ${expectedSchemaSource})`);

  if (lockPolicy.policyVersion !== policy.policyVersion) {
    fail(`policyVersion mismatch (${lockPolicy.policyVersion} != ${policy.policyVersion})`);
  }
  if (lockPolicy.schemaVersion !== policy.schemaVersion) {
    fail(`schemaVersion mismatch (${lockPolicy.schemaVersion} != ${policy.schemaVersion})`);
  }

  const currentPolicyHash = sha256Hex(canonicalJson(policy));
  const currentSchemaHash = sha256Hex(canonicalJson(schema));

  if (lockPolicy.policySha256 !== currentPolicyHash) {
    fail(`policySha256 mismatch (${lockPolicy.policySha256} != ${currentPolicyHash})`);
  }
  if (lockPolicy.schemaSha256 !== currentSchemaHash) {
    fail(`schemaSha256 mismatch (${lockPolicy.schemaSha256} != ${currentSchemaHash})`);
  }

  console.log('Policy lockfile validation passed');
}

main();
