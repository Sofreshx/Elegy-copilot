#!/usr/bin/env node
/**
 * validate-guidelines-wiring.mjs
 *
 * Validates shared baseline content, banned-term absence, manifest wiring,
 * and appendix file existence.
 *
 * Usage:
 *   node scripts/validate-guidelines-wiring.mjs          # check only
 *   node scripts/validate-guidelines-wiring.mjs --json   # structured JSON output
 *
 * Exit codes: 0 = all pass, 1 = any fail
 */

'use strict';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASELINE_PATH = 'catalog-assets/instructions/agent-session-defaults.md';

const REQUIRED_SECTIONS = [
  '## Repo Discovery',
  '## Concise Instruction Contract',
  '## Clarification Contract',
  '## Planning Contract',
  '## Review Rule',
  '## Validation Rule',
];

const BANNED_TERMS = [
  { pattern: /instruction\s*engine/gi, name: 'Instruction Engine' },
  { pattern: /elegy\s*copilot/gi, name: 'Elegy Copilot' },
  { pattern: /docs\/system/gi, name: 'docs/system' },
  { pattern: /guidelines\.md/gi, name: 'guidelines.md' },
];

const MANIFESTS = [
  'codex-assets/manifest.json',
  'opencode-assets/manifest.json',
  'claude-assets/manifest.json',
  'antigravity-assets/manifest.json',
  'engine-assets/manifest.json',
];

const APPENDICES = [
  'codex-assets/home/AGENTS-appendix.md',
  'opencode-assets/home/AGENTS-appendix.md',
  'claude-assets/home/CLAUDE-appendix.md',
  'antigravity-assets/home/GEMINI-appendix.md',
  'engine-assets/copilot-instructions-appendix.md',
];

/** Walk up from `fromDir` looking for .git to find repo root. */
function findRepoRoot(fromDir) {
  let current = path.resolve(fromDir);
  while (true) {
    if (fs.existsSync(path.join(current, '.git'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/** Check the shared baseline exists, has required sections, and has no banned terms. */
function checkBaseline(repoRoot) {
  const fullPath = path.join(repoRoot, BASELINE_PATH);
  const checks = [];

  if (!fs.existsSync(fullPath)) {
    checks.push({ id: 'baseline-exists', status: 'missing', detail: `${BASELINE_PATH} not found` });
    return checks;
  }

  checks.push({ id: 'baseline-exists', status: 'ok', detail: `${BASELINE_PATH} exists` });

  const content = fs.readFileSync(fullPath, 'utf8');
  const missingSections = REQUIRED_SECTIONS.filter(s => !content.includes(s));

  checks.push({
    id: 'baseline-sections',
    status: missingSections.length === 0 ? 'ok' : 'missing',
    detail: missingSections.length === 0
      ? 'Contains all required portable sections'
      : `Missing ${missingSections.length} section(s): ${missingSections.join(', ')}`,
  });

  const violations = BANNED_TERMS.filter(t => t.pattern.test(content));
  checks.push({
    id: 'baseline-banned-terms',
    status: violations.length === 0 ? 'ok' : 'violation',
    detail: violations.length === 0
      ? 'No banned repo-specific terms found'
      : `Found: ${violations.map(v => v.name).join(', ')}`,
  });

  return checks;
}

/** Check each manifest's instructions-type asset points to the shared baseline with valid appendix. */
function checkManifestWiring(repoRoot) {
  const results = [];

  for (const manifestRel of MANIFESTS) {
    const manifestPath = path.join(repoRoot, manifestRel);
    const prefix = manifestRel.replace(/\.json$/, '').replace(/\//g, '-');

    if (!fs.existsSync(manifestPath)) {
      results.push({ id: `manifest-${prefix}`, status: 'missing', detail: `Manifest not found: ${manifestRel}` });
      continue;
    }

    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch {
      results.push({ id: `manifest-${prefix}`, status: 'error', detail: `Invalid JSON: ${manifestRel}` });
      continue;
    }

    const instAssets = (manifest.assets || []).filter(a => a.type === 'instructions');
    if (instAssets.length === 0) {
      results.push({ id: `manifest-${prefix}`, status: 'missing', detail: `${manifestRel}: no instructions-type assets` });
      continue;
    }

    for (const asset of instAssets) {
      const aid = asset.id || 'unknown';
      const id = `manifest-${prefix}-${aid}`;

      if (asset.source !== BASELINE_PATH) {
        results.push({ id, status: 'violation', detail: `${asset.id}: source is "${asset.source}", expected "${BASELINE_PATH}"` });
        continue;
      }

      if (!asset.appendix) {
        results.push({ id, status: 'violation', detail: `${asset.id}: missing appendix field` });
        continue;
      }

      const appPath = path.join(repoRoot, asset.appendix);
      if (!fs.existsSync(appPath)) {
        results.push({ id, status: 'missing', detail: `${asset.id}: appendix not found: ${asset.appendix}` });
        continue;
      }

      results.push({ id, status: 'ok', detail: `${asset.id}: source ✓, appendix ✓` });
    }
  }

  return results;
}

/** Check each standalone appendix file exists. */
function checkAppendixFiles(repoRoot) {
  return APPENDICES.map((rel) => {
    const id = rel.replace(/\.md$/, '').replace(/\//g, '-');
    const exists = fs.existsSync(path.join(repoRoot, rel));
    return { id, status: exists ? 'ok' : 'missing', detail: exists ? `${rel} exists` : `${rel} not found` };
  });
}

function main() {
  const useJson = process.argv.includes('--json');
  const repoRoot = findRepoRoot(__dirname);

  if (!repoRoot) {
    if (useJson) {
      console.log(JSON.stringify({ checks: [], summary: { total: 0, pass: 0, fail: 0 } }, null, 2));
      return;
    }
    console.error('ERROR: Could not find repo root (walking up from script directory).');
    process.exit(1);
  }

  const checks = [
    ...checkBaseline(repoRoot),
    ...checkManifestWiring(repoRoot),
    ...checkAppendixFiles(repoRoot),
  ];

  const hasFail = checks.some(c => c.status !== 'ok');

  if (useJson) {
    console.log(JSON.stringify({
      checks,
      summary: {
        total: checks.length,
        pass: checks.filter(c => c.status === 'ok').length,
        fail: checks.filter(c => c.status !== 'ok').length,
      },
    }, null, 2));
    return;
  }

  for (const c of checks) {
    console.log(`${c.id}: ${c.status} — ${c.detail}`);
  }

  if (hasFail) process.exit(1);
}

main();
