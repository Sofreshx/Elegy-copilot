#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function readJson(filePath) {
if (!fs.existsSync(filePath)) {
fail(`waiver file does not exist: ${filePath}`);
return null;
}
try {
return JSON.parse(fs.readFileSync(filePath, 'utf8'));
} catch (e) {
fail(`failed to parse JSON ${filePath}: ${e.message}`);
return null;
}
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

function fail(message) {
console.error(`Policy waiver validation failed: ${message}`);
process.exit(1);
}

function ensureString(value, fieldName) {
if (typeof value !== 'string' || !value.trim()) {
fail(`${fieldName} must be a non-empty string`);
}
return value.trim();
}

function ensureSemver(value, fieldName) {
const raw = ensureString(value, fieldName);
if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(raw)) {
fail(`${fieldName} must be semantic version x.y.z`);
}
return raw;
}

function ensureIsoDate(value, fieldName) {
const raw = ensureString(value, fieldName);
const ms = Date.parse(raw);
if (!Number.isFinite(ms)) fail(`${fieldName} must be a valid ISO date`);
return ms;
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
.createHmac('sha256', secret)
.update(canonicalJson(payload), 'utf8')
.digest('hex');
}

function validateStructure(waiver) {
if (!waiver || typeof waiver !== 'object' || Array.isArray(waiver)) {
fail('waiver root must be an object');
}

ensureSemver(waiver.schemaVersion, 'schemaVersion');
ensureString(waiver.waiverId, 'waiverId');
ensureSemver(waiver.policyVersion, 'policyVersion');
ensureString(waiver.reason, 'reason');

const issuedAtMs = ensureIsoDate(waiver.issuedAt, 'issuedAt');
const expiresAtMs = ensureIsoDate(waiver.expiresAt, 'expiresAt');
if (expiresAtMs <= issuedAtMs) {
fail('expiresAt must be after issuedAt');
}
if (expiresAtMs <= Date.now()) {
fail('waiver is expired');
}

if (!Array.isArray(waiver.controls) || waiver.controls.length === 0) {
fail('controls must be a non-empty array');
}
if (waiver.controls.some((c) => typeof c !== 'string' || !c.trim())) {
fail('controls must contain non-empty strings');
}

if (!waiver.signature || typeof waiver.signature !== 'object' || Array.isArray(waiver.signature)) {
fail('signature must be an object');
}

const algorithm = ensureString(waiver.signature.algorithm, 'signature.algorithm');
if (algorithm !== 'hmac-sha256') {
fail('signature.algorithm must be hmac-sha256');
}
ensureString(waiver.signature.keyId, 'signature.keyId');

const signatureValue = ensureString(waiver.signature.value, 'signature.value').toLowerCase();
if (!/^[a-f0-9]{64}$/.test(signatureValue)) {
fail('signature.value must be 64-character hex sha256');
}
}

function main() {
const waiverPathArg = process.argv[2];
const controlIdArg = process.argv[3] || null;
if (!waiverPathArg) {
fail('usage: node scripts/validate-policy-waiver.js <waiver-path> [control-id]');
}

const waiverPath = path.resolve(waiverPathArg);
const waiver = readJson(waiverPath);
if (!waiver) return;

validateStructure(waiver);

const controlId = controlIdArg ? String(controlIdArg).trim() : '';
if (controlId && !waiver.controls.includes(controlId)) {
fail(`scope mismatch: control '${controlId}' is not listed in waiver.controls`);
}

const secret = process.env.INSTRUCTION_ENGINE_POLICY_WAIVER_SECRET;
if (!secret || !secret.trim()) {
fail('INSTRUCTION_ENGINE_POLICY_WAIVER_SECRET must be set for signature verification');
}

const expected = signWaiverPayload(waiver, secret.trim());
const provided = String(waiver.signature.value || '').toLowerCase();
if (expected !== provided) {
fail('signature mismatch (waiver may be tampered)');
}

console.log('Policy waiver validation passed');
}

main();