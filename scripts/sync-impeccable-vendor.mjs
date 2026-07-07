#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const vendorRoot = path.join(repoRoot, 'vendor-assets', 'impeccable');
const vendorConfigPath = path.join(vendorRoot, 'vendor.json');

const textFileExtensions = new Set([
  '.css',
  '.html',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.svg',
  '.ts',
  '.tsx',
  '.txt',
  '.yml',
  '.yaml',
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd || repoRoot,
    encoding: 'utf8',
    stdio: options.stdio || ['ignore', 'pipe', 'pipe'],
  });
}

function copyDirectory(source, destination) {
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, {
    recursive: true,
    filter: (src) => !src.split(path.sep).includes('.git'),
  });
}

function listFiles(root) {
  const entries = [];
  if (!fs.existsSync(root)) return entries;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      entries.push(...listFiles(fullPath));
    } else if (entry.isFile()) {
      entries.push(fullPath);
    }
  }
  return entries;
}

function isTextFile(filePath) {
  return textFileExtensions.has(path.extname(filePath).toLowerCase());
}

function replaceInTextFiles(root, replacements) {
  for (const filePath of listFiles(root)) {
    if (!isTextFile(filePath)) continue;
    let text = fs.readFileSync(filePath, 'utf8');
    const original = text;
    for (const [from, to] of replacements) {
      text = text.split(from).join(to);
    }
    if (text !== original) {
      fs.writeFileSync(filePath, text, 'utf8');
    }
  }
}

function removeFrontmatterKeys(skillPath, keys) {
  const filePath = path.join(skillPath, 'SKILL.md');
  const text = fs.readFileSync(filePath, 'utf8');
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return;

  const keySet = new Set(keys);
  const filteredLines = [];
  let skippingBlock = false;
  for (const line of match[1].split(/\r?\n/)) {
    const keyMatch = line.match(/^([A-Za-z0-9_.-]+):/);
    if (keyMatch) {
      skippingBlock = keySet.has(keyMatch[1]);
      if (!skippingBlock) {
        filteredLines.push(line);
      }
      continue;
    }
    if (skippingBlock && /^\s+/.test(line)) {
      continue;
    }
    skippingBlock = false;
    filteredLines.push(line);
  }
  const filtered = filteredLines.join('\n');
  fs.writeFileSync(filePath, `---\n${filtered}\n---\n\n${text.slice(match[0].length)}`, 'utf8');
}

function writeMetadata(targetDir, config, upstreamCommit, sourcePath, target) {
  const metadata = {
    schemaVersion: 1,
    vendor: config.vendor,
    upstream: config.upstream,
    license: config.license,
    version: config.version,
    pinnedRef: config.pinnedRef,
    pinnedCommit: upstreamCommit,
    sourcePath,
    target,
    generatedBy: 'scripts/sync-impeccable-vendor.mjs',
  };
  fs.writeFileSync(path.join(targetDir, 'VENDOR.json'), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
}

function assertSafeVendor(config) {
  if (config.vendor !== 'impeccable') {
    throw new Error(`Unexpected vendor: ${config.vendor}`);
  }
  if (config.license !== 'Apache-2.0') {
    throw new Error(`Impeccable must stay Apache-2.0, got ${config.license}`);
  }
  if (!config.pinnedRef || !config.pinnedCommit) {
    throw new Error('vendor.json must pin both pinnedRef and pinnedCommit');
  }
}

function main() {
  const config = readJson(vendorConfigPath);
  assertSafeVendor(config);

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-vendor-'));
  const sourceRoot = path.join(tempRoot, 'repo');
  try {
    run('git', ['clone', '--depth', '1', '--branch', config.pinnedRef, config.upstream, sourceRoot], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    const upstreamCommit = run('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot }).trim();
    if (upstreamCommit !== config.pinnedCommit) {
      throw new Error(`Pinned commit mismatch for ${config.pinnedRef}: expected ${config.pinnedCommit}, got ${upstreamCommit}`);
    }

    const licenseSource = path.join(sourceRoot, 'LICENSE');
    if (!fs.existsSync(licenseSource)) {
      throw new Error('Upstream LICENSE is missing');
    }
    fs.copyFileSync(licenseSource, path.join(vendorRoot, 'LICENSE'));

    const codexSource = path.join(sourceRoot, '.agents', 'skills', 'impeccable');
    const codexDest = path.join(vendorRoot, 'codex', 'impeccable');
    copyDirectory(codexSource, codexDest);
    replaceInTextFiles(codexDest, [
      ['.agents/skills/impeccable', '~/.codex/skills/impeccable'],
      ['Claude is capable of extraordinary work.', 'GPT is capable of extraordinary work.'],
    ]);
    removeFrontmatterKeys(codexDest, ['version']);
    writeMetadata(codexDest, config, upstreamCommit, '.agents/skills/impeccable', 'codex');

    const opencodeSource = path.join(sourceRoot, '.opencode', 'skills', 'impeccable');
    const opencodeDest = path.join(vendorRoot, 'opencode', 'impeccable');
    copyDirectory(opencodeSource, opencodeDest);
    replaceInTextFiles(opencodeDest, [
      ['.opencode/skills/impeccable', '~/.config/opencode/skills/impeccable'],
      ['.agents/skills/impeccable', '~/.config/opencode/skills/impeccable'],
      ['Claude is capable of extraordinary work.', 'OpenCode is capable of extraordinary work.'],
    ]);
    removeFrontmatterKeys(opencodeDest, ['version', 'user-invocable', 'argument-hint', 'license', 'allowed-tools']);
    writeMetadata(opencodeDest, config, upstreamCommit, '.opencode/skills/impeccable', 'opencode');

    console.log(`Synced Impeccable ${config.version} (${upstreamCommit})`);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main();
