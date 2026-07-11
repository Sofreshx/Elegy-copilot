#!/usr/bin/env node
/**
 * validate-instruction-wiring.mjs
 *
 * Validates the shared baseline (catalog-assets/instructions/agent-session-defaults.md),
 * the new skill-authoring and agents-md-authoring shared skills, manifest wiring
 * across target harnesses, and the appendix files.
 *
 * The legacy `guidelines.md` surface is fully deprecated; the validator also
 * asserts that no shipped instruction, appendix, or agent file references it.
 *
 * Usage:
 *   node scripts/validate-instruction-wiring.mjs          # check only
 *   node scripts/validate-instruction-wiring.mjs --json   # structured JSON output
 *
 * Exit codes: 0 = all pass, 1 = any fail
 */

'use strict';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { analyzeInstructionQuality } from './validate-instruction-quality.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASELINE_PATH = 'catalog-assets/instructions/agent-session-defaults.md';

const REQUIRED_SECTIONS = [
  '## Repo Discovery',
  '## Instruction Content',
  '## Clarification Contract',
  '## Planning Contract',
  '## Review Rule',
  '## Validation Rule',
];

const BANNED_TERMS = [
  { pattern: /instruction\s*engine/gi, name: 'Elegy Copilot' },
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
  'ghcp-assets/manifest.json',
];

const APPENDICES = [
  'codex-assets/home/AGENTS-appendix.md',
  'opencode-assets/home/AGENTS-appendix.md',
  'claude-assets/home/CLAUDE-appendix.md',
  'antigravity-assets/home/GEMINI-appendix.md',
  'engine-assets/copilot-instructions-appendix.md',
  'ghcp-assets/home/AGENTS-appendix.md',
];

const SHARED_SKILLS = [
  {
    id: 'skill-authoring',
    name: 'skill-authoring',
    path: 'catalog-assets/shared-skills/skill-authoring/SKILL.md',
  },
  {
    id: 'agents-md-authoring',
    name: 'agents-md-authoring',
    path: 'catalog-assets/shared-skills/agents-md-authoring/SKILL.md',
  },
];

const SHIPPED_SURFACES = [
  ...MANIFESTS,
  ...APPENDICES,
  'AGENTS.md',
  'engine-assets/copilot-instructions-appendix.md',
  'engine-assets/agents/code-reviewer.agent.md',
  'engine-assets/agents/impl.agent.md',
  'docs/system/concise-instruction-governance.md',
  'docs/system/harness-asset-flow.md',
  'docs/system/project-conventions-governance.md',
  'docs/system/progressive-constraint-narrowing.md',
  'docs/system/documentation-structure-governance.md',
  'docs/system/workspace-repo-features.md',
  'docs/system/skills-governance.md',
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

/** Parse simple YAML frontmatter without dependencies. */
function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) return null;
  const body = match[1];
  const fields = {};
  for (const line of body.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    fields[m[1]] = value;
  }
  return fields;
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

/** Check each appendix file exists. */
function checkAppendixFiles(repoRoot) {
  return APPENDICES.map((rel) => {
    const id = rel.replace(/\.md$/, '').replace(/\//g, '-');
    const exists = fs.existsSync(path.join(repoRoot, rel));
    return { id, status: exists ? 'ok' : 'missing', detail: exists ? `${rel} exists` : `${rel} not found` };
  });
}

/** Check each shared skill exists with agentskills.io-compliant frontmatter. */
function checkSharedSkills(repoRoot) {
  const results = [];

  for (const skill of SHARED_SKILLS) {
    const fullPath = path.join(repoRoot, skill.path);
    if (!fs.existsSync(fullPath)) {
      results.push({ id: `skill-${skill.id}`, status: 'missing', detail: `${skill.path} not found` });
      continue;
    }

    const content = fs.readFileSync(fullPath, 'utf8');
    const fm = parseFrontmatter(content);
    if (!fm) {
      results.push({ id: `skill-${skill.id}`, status: 'violation', detail: `${skill.path}: missing YAML frontmatter` });
      continue;
    }

    if (!fm.name) {
      results.push({ id: `skill-${skill.id}`, status: 'violation', detail: `${skill.path}: frontmatter missing name` });
      continue;
    }
    if (fm.name !== skill.name) {
      results.push({ id: `skill-${skill.id}`, status: 'violation', detail: `${skill.path}: frontmatter name "${fm.name}" != parent directory "${skill.name}"` });
      continue;
    }
    if (!/^[a-z0-9-]+$/.test(fm.name) || fm.name.length > 64) {
      results.push({ id: `skill-${skill.id}`, status: 'violation', detail: `${skill.path}: name "${fm.name}" violates agentskills.io name rules` });
      continue;
    }
    if (!fm.description || fm.description.length === 0) {
      results.push({ id: `skill-${skill.id}`, status: 'violation', detail: `${skill.path}: frontmatter missing description` });
      continue;
    }
    if (fm.description.length > 1024) {
      results.push({ id: `skill-${skill.id}`, status: 'violation', detail: `${skill.path}: description ${fm.description.length} chars exceeds 1024 limit` });
      continue;
    }
    const lineCount = content.split(/\r?\n/).length;
    if (lineCount > 500) {
      results.push({ id: `skill-${skill.id}`, status: 'violation', detail: `${skill.path}: ${lineCount} lines exceeds 500-line guideline` });
      continue;
    }

    results.push({ id: `skill-${skill.id}`, status: 'ok', detail: `${skill.path}: agentskills.io frontmatter valid (${lineCount} lines)` });
  }

  return results;
}

/** Check each manifest installs both new shared skills. */
function checkManifestSkillEntries(repoRoot) {
  const results = [];

  for (const manifestRel of MANIFESTS) {
    const manifestPath = path.join(repoRoot, manifestRel);
    const prefix = manifestRel.replace(/\.json$/, '').replace(/\//g, '-');

    if (!fs.existsSync(manifestPath)) continue;

    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch { continue; }

    const skills = (manifest.assets || []).filter(a => a.type === 'skill');

    for (const skill of SHARED_SKILLS) {
      const id = `manifest-skill-${prefix}-${skill.id}`;
      // ghcp ships lane agents and instructions only; no shared skill install surface.
      if (manifestRel.startsWith('ghcp')) {
        results.push({ id, status: 'ok', detail: `${manifestRel}: intentionally omits ${skill.id} (ghcp has no skill install surface)` });
        continue;
      }
      // skill-authoring is not installed to Codex — Codex has its own built-in
      if (manifestRel.startsWith('codex') && skill.id === 'skill-authoring') {
        results.push({ id, status: 'ok', detail: `${manifestRel}: intentionally omits ${skill.id} (Codex has native equivalent)` });
        continue;
      }
      const found = skills.find(s => (s.source || '').endsWith(`/shared-skills/${skill.id}`) || s.destination === `skills/${skill.id}`);
      if (found) {
        results.push({ id, status: 'ok', detail: `${manifestRel}: installs ${skill.id}` });
      } else {
        results.push({ id, status: 'violation', detail: `${manifestRel}: missing entry for ${skill.id}` });
      }
    }
  }

  return results;
}

/** Check no shipped surface references the deprecated guidelines.md. */
function checkNoLegacyGuidelinesRefs(repoRoot) {
  const results = [];
  const pattern = /guidelines\.md/;

  for (const rel of SHIPPED_SURFACES) {
    const fullPath = path.join(repoRoot, rel);
    if (!fs.existsSync(fullPath)) continue;
    const content = fs.readFileSync(fullPath, 'utf8');
    const id = rel.replace(/\//g, '-');
    if (pattern.test(content)) {
      results.push({ id: `no-legacy-${id}`, status: 'violation', detail: `${rel}: still references guidelines.md` });
    } else {
      results.push({ id: `no-legacy-${id}`, status: 'ok', detail: `${rel}: no guidelines.md reference` });
    }
  }

  return results;
}

/** Check each per-harness appendix lists both new skills in its skills inventory. */
function checkAppendixSkillMentions(repoRoot) {
  const results = [];

  for (const rel of APPENDICES) {
    const fullPath = path.join(repoRoot, rel);
    if (!fs.existsSync(fullPath)) continue;
    const content = fs.readFileSync(fullPath, 'utf8');
    const id = rel.replace(/\.md$/, '').replace(/\//g, '-');

    for (const skill of SHARED_SKILLS) {
      const checkId = `appendix-skill-${id}-${skill.id}`;
      // ghcp ships lane agents and instructions only; no shared skill inventory.
      if (rel.startsWith('ghcp')) {
        results.push({ id: checkId, status: 'ok', detail: `${rel}: intentionally omits ${skill.id} (ghcp has no skill install surface)` });
        continue;
      }
      // skill-authoring not listed in codex appendix — Codex has its own built-in
      if (rel.startsWith('codex') && skill.id === 'skill-authoring') {
        results.push({ id: checkId, status: 'ok', detail: `${rel}: intentionally omits ${skill.id} (Codex has native equivalent)` });
        continue;
      }
      if (content.includes(`\`${skill.id}\``)) {
        results.push({ id: checkId, status: 'ok', detail: `${rel}: lists ${skill.id}` });
      } else {
        results.push({ id: checkId, status: 'violation', detail: `${rel}: missing ${skill.id} in skills inventory` });
      }
    }
  }

  return results;
}

/** Check shipped instruction-like assets for vague, bloated, or pseudo-theory prompt content. */
function checkInstructionQuality(repoRoot) {
  const result = analyzeInstructionQuality(repoRoot);
  if (result.diagnostics.length === 0) {
    return [{
      id: 'instruction-quality',
      status: 'ok',
      detail: `Scanned ${result.assets.length} instruction assets`,
    }];
  }

  return result.diagnostics.map((diagnostic, index) => ({
    id: `instruction-quality-${index + 1}-${diagnostic.id}`,
    status: 'violation',
    detail: `${diagnostic.file}${diagnostic.line ? `:${diagnostic.line}` : ''}: ${diagnostic.detail}`,
  }));
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
    ...checkSharedSkills(repoRoot),
    ...checkManifestSkillEntries(repoRoot),
    ...checkNoLegacyGuidelinesRefs(repoRoot),
    ...checkAppendixSkillMentions(repoRoot),
    ...checkInstructionQuality(repoRoot),
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
