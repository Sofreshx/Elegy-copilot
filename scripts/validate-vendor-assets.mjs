#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const vendorRoot = path.join(repoRoot, 'vendor-assets', 'impeccable');

function fail(message) {
  console.error(`vendor assets invalid: ${message}`);
  process.exitCode = 1;
}

function readJson(relativePath) {
  const fullPath = path.join(repoRoot, relativePath);
  return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
}

function exists(relativePath) {
  return fs.existsSync(path.join(repoRoot, relativePath));
}

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function listFiles(root) {
  const files = [];
  if (!fs.existsSync(root)) return files;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

const config = readJson('vendor-assets/impeccable/vendor.json');
if (config.vendor !== 'impeccable') fail('vendor.json vendor must be impeccable');
if (config.license !== 'Apache-2.0') fail('Impeccable must remain Apache-2.0');
if (!/^skill-v\d+\.\d+\.\d+$/.test(config.pinnedRef || '')) fail('pinnedRef must be a skill-vX.Y.Z tag');
if (!/^[0-9a-f]{40}$/.test(config.pinnedCommit || '')) fail('pinnedCommit must be a full Git SHA');

if (!exists('vendor-assets/impeccable/LICENSE')) fail('LICENSE missing');
if (!read('vendor-assets/impeccable/LICENSE').includes('Apache License')) fail('LICENSE is not Apache text');

for (const target of ['codex', 'opencode']) {
  const skillRoot = `vendor-assets/impeccable/${target}/impeccable`;
  if (!exists(`${skillRoot}/SKILL.md`)) fail(`${target} SKILL.md missing`);
  if (!exists(`${skillRoot}/VENDOR.json`)) fail(`${target} VENDOR.json missing`);
  const metadata = readJson(`${skillRoot}/VENDOR.json`);
  if (metadata.pinnedCommit !== config.pinnedCommit) fail(`${target} pinnedCommit does not match vendor.json`);
  const skillText = read(`${skillRoot}/SKILL.md`);
  if (!skillText.startsWith('---\nname: impeccable\n')) fail(`${target} SKILL.md frontmatter is not normalized`);
}

const allVendorTextFiles = ['codex', 'opencode']
  .flatMap((target) => listFiles(path.join(vendorRoot, target)))
  .filter((filePath) => /\.(md|mjs|js|json|txt|yml|yaml)$/i.test(filePath));
for (const filePath of allVendorTextFiles) {
  const text = fs.readFileSync(filePath, 'utf8');
  if (/ui\.sh|uidotsh|TypeUI/i.test(text)) {
    fail(`forbidden ui.sh/TypeUI reference in ${path.relative(repoRoot, filePath)}`);
  }
}

if (!process.exitCode) {
  console.log('vendor assets ok');
}
