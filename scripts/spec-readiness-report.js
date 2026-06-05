#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { AC_VAGUE_TOKEN_RE } = require('./lib/ac-vague-tokens');

const VALID_STATUS = new Set(['draft', 'approved', 'implemented', 'superseded']);
const VALID_TYPES = new Set(['feature', 'workflow', 'contract', 'skill', 'agent', 'migration']);
const REQUIRED_FRONTMATTER_KEYS = ['spec_id', 'title', 'status', 'type', 'updated'];
const OPTIONAL_DATE_KEYS = ['created', 'approved_at', 'implemented_at', 'superseded_at'];
const REQUIRED_HEADINGS = [
  'Intent', 'Context Evidence', 'Requirements', 'Non-Goals',
  'Acceptance Checks', 'Implementation Links', 'Validation Evidence', 'Drift Notes',
];

const KNOWN_SOURCE_DIRS = new Set([
  'opencode-assets', 'catalog-assets', 'codex-assets', 'antigravity-assets',
  'engine-assets', 'scripts', 'docs', 'specs', 'contracts', 'copilot-ui',
  'local-tracker', 'elegy-assets',
]);

function matchFrontmatter(text) {
  if (!String(text || '').startsWith('---')) return null;
  const match = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return null;
  return { full: match[0], yaml: match[1] };
}

function parseFrontmatterYaml(yamlText) {
  const meta = {};
  const lines = String(yamlText || '').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const colonIndex = line.indexOf(':');
    if (colonIndex <= 0) continue;
    const key = line.slice(0, colonIndex).trim();
    meta[key] = line.slice(colonIndex + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return meta;
}

function extractH2Sections(markdownBody) {
  const sections = new Map();
  let currentHeading = '';
  let currentLines = [];
  for (const line of (String(markdownBody || '').split(/\r?\n/))) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) {
      if (currentHeading) sections.set(currentHeading, currentLines.join('\n').trim());
      currentHeading = m[1].trim();
      currentLines = [];
    } else if (currentHeading) {
      currentLines.push(line);
    }
  }
  if (currentHeading) sections.set(currentHeading, currentLines.join('\n').trim());
  return sections;
}

function hasMeaningfulContent(text) {
  const s = String(text || '').replace(/^\s*[-*]\s*/gm, '').replace(/`[^`]*`/g, '').replace(/\s+/g, ' ').trim();
  if (!s) return false;
  return !/^(?:none|n\/a|na|todo|tbd|pending|not yet|placeholder|none yet|fill me in)\.?$/i.test(s);
}

function countBulletItems(text) {
  return (String(text || '').match(/^\s*[-*]\s+\S/gm) || []).length;
}

function looksLikeFilePath(p) {
  const s = p.trim();
  if (/^https?:\/\//i.test(s) || /^\$/.test(s) || /^~/.test(s) || /^[A-Z]:\\/i.test(s)) return false;
  if (/\s/.test(s) || /^\w+\(/.test(s) || !/[/\\]/.test(s)) return false;
  if (!/\.[a-zA-Z]\w*$/.test(s)) {
    const firstSeg = s.split(/[/\\]/)[0];
    return KNOWN_SOURCE_DIRS.has(firstSeg);
  }
  return true;
}

function collectSpecFiles(rootPath) {
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fp = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(fp);
      else if (entry.isFile() && entry.name === 'spec.md') files.push(fp);
    }
  }
  walk(path.resolve(rootPath));
  return files.sort();
}

function assessSpec(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const fm = matchFrontmatter(content);
  if (!fm) return { filePath, score: 0, details: { errors: ['missing frontmatter'] } };

  const meta = parseFrontmatterYaml(fm.yaml);
  const body = content.slice(fm.full.length);
  const sections = extractH2Sections(body);
  const errors = [];

  // Structural checks
  for (const k of REQUIRED_FRONTMATTER_KEYS) {
    if (!String(meta[k] || '').trim()) errors.push(`missing frontmatter key: ${k}`);
  }
  const status = String(meta.status || '').trim();
  const type = String(meta.type || '').trim();
  if (status && !VALID_STATUS.has(status)) errors.push(`invalid status: ${status}`);
  if (type && !VALID_TYPES.has(type)) errors.push(`invalid type: ${type}`);

  for (const h of REQUIRED_HEADINGS) {
    if (!sections.has(h)) errors.push(`missing heading: ${h}`);
  }

  const intent = sections.get('Intent') || '';
  if (!hasMeaningfulContent(intent)) errors.push('empty Intent');

  const acceptanceChecks = sections.get('Acceptance Checks') || '';
  const acCount = countBulletItems(acceptanceChecks);
  if (acCount < 2) errors.push(`too few ACs: ${acCount}`);

  if (status === 'implemented' && !hasMeaningfulContent(sections.get('Validation Evidence') || '')) {
    errors.push('no validation evidence');
  }

  // Cross-ref checks
  const supersedes = String(meta.supersedes || '').trim();
  const supersededBy = String(meta.superseded_by || '').trim();
  if (supersedes && supersededBy) errors.push('both supersedes and superseded_by');
  if (status === 'superseded' && !supersededBy) errors.push('superseded without superseded_by');

  // Date key checks
  let optionalDatesPresent = 0;
  for (const key of OPTIONAL_DATE_KEYS) {
    const v = String(meta[key] || '').trim();
    if (v) {
      optionalDatesPresent++;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) errors.push(`invalid date format: ${key}=${v}`);
    }
  }

  // AC quality
  const acLines = acceptanceChecks.split(/\r?\n/);
  let acWithVerify = 0;
  let totalBullets = 0;
  for (let i = 0; i < acLines.length; i++) {
    if (/^\s*[-*]\s+\S/.test(acLines[i])) {
      totalBullets++;
      const nextLine = acLines[i + 1] || '';
      if (/^\s+→\s*verify:\s*\S/.test(nextLine)) acWithVerify++;
    }
  }

  // Freshness
  const updated = String(meta.updated || '').trim();
  let daysSinceUpdate = null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(updated)) {
    daysSinceUpdate = Math.floor((Date.now() - new Date(updated).getTime()) / 86400000);
  }

  // Liveness
  let missingPaths = 0;
  const repoRoot = process.cwd();
  for (const heading of ['Context Evidence', 'Implementation Links']) {
    const text = sections.get(heading) || '';
    const matches = text.match(/`([^`]+)`/g) || [];
    for (const raw of matches) {
      const p = raw.replace(/^`|`$/g, '').trim();
      if (!p || !looksLikeFilePath(p)) continue;
      const normalized = p.replace(/:\d+(-\d+)?$/, '').trim();
      if (!normalized) continue;
      if (!fs.existsSync(path.resolve(repoRoot, normalized))) missingPaths++;
    }
  }

  // Score: max 100
  let score = 100;

  // -10 per structural error (max -40)
  score -= Math.min(errors.length * 10, 40);

  // -5 if no optional dates
  if (optionalDatesPresent === 0) score -= 5;

  // -20 if ACs don't have verify lines
  if (totalBullets > 0 && acWithVerify < totalBullets) score -= 20;

  // -10 if stale draft (>90d) or stale implemented (>180d)
  if (daysSinceUpdate !== null) {
    if (status === 'draft' && daysSinceUpdate > 90) score -= 10;
    if (status === 'implemented' && daysSinceUpdate > 180) score -= 10;
  }

  // -5 per missing path (max -15)
  score -= Math.min(missingPaths * 5, 15);

  // Clamp
  score = Math.max(0, Math.min(100, score));

  return {
    filePath,
    specId: meta.spec_id || '?',
    title: meta.title || meta.spec_id || '?',
    status,
    type,
    updated,
    daysSinceUpdate,
    errors,
    acTotal: totalBullets,
    acWithVerify,
    optionalDatesPresent,
    missingPaths,
    score,
  };
}

function main() {
  const targetPath = path.resolve(process.argv[2] || path.join(process.cwd(), 'specs'));
  if (!fs.existsSync(targetPath)) {
    console.error(JSON.stringify({ error: 'specs directory not found', path: targetPath }, null, 2));
    process.exit(1);
  }

  const specFiles = collectSpecFiles(targetPath);
  const results = specFiles.map(assessSpec);
  const avgScore = results.length > 0
    ? Math.round(results.reduce((s, r) => s + r.score, 0) / results.length)
    : 0;

  const report = {
    totalSpecs: results.length,
    averageScore: avgScore,
    specs: results,
  };

  console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) {
  main();
}
