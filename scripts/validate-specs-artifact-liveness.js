#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const KNOWN_SOURCE_DIRS = new Set([
  'opencode-assets', 'catalog-assets', 'codex-assets', 'antigravity-assets',
  'engine-assets', 'scripts', 'docs', 'specs', 'contracts', 'copilot-ui',
  'local-tracker', 'elegy-assets',
]);

function toPosix(filePath) {
  return String(filePath || '').replace(/\\/g, '/');
}

function toDisplayPath(filePath) {
  return toPosix(path.relative(process.cwd(), filePath) || path.basename(filePath));
}

function looksLikeFilePath(p) {
  const s = p.trim();
  if (/^https?:\/\//i.test(s)) return false;
  if (/^\$/.test(s)) return false;
  if (/^~/.test(s)) return false;
  if (/^[A-Z]:\\/i.test(s)) return false;
  if (/\s/.test(s)) return false;
  if (/^\w+\(/.test(s)) return false;
  if (!/[/\\]/.test(s)) return false;
  if (!/\.[a-zA-Z]\w*$/.test(s)) {
    const firstSeg = s.split(/[/\\]/)[0];
    return KNOWN_SOURCE_DIRS.has(firstSeg);
  }
  return true;
}

function collectSpecFiles(targetPath) {
  const resolvedTarget = path.resolve(targetPath);
  if (!fs.existsSync(resolvedTarget)) return [];

  const stat = fs.statSync(resolvedTarget);
  if (stat.isFile()) return [resolvedTarget];

  const files = [];
  function walk(currentPath) {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name === 'spec.md') {
        files.push(fullPath);
      }
    }
  }
  walk(resolvedTarget);
  return files.sort((left, right) => left.localeCompare(right));
}

function extractH2Sections(markdownBody) {
  const lines = String(markdownBody || '').split(/\r?\n/);
  const sections = new Map();
  let currentHeading = '';
  let currentLines = [];

  function commitCurrent() {
    if (!currentHeading) return;
    sections.set(currentHeading, currentLines.join('\n').trim());
  }

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+?)\s*$/);
    if (headingMatch) {
      commitCurrent();
      currentHeading = headingMatch[1].trim();
      currentLines = [];
      continue;
    }
    if (currentHeading) {
      currentLines.push(line);
    }
  }
  commitCurrent();
  return sections;
}

function matchFrontmatter(text) {
  if (!String(text || '').startsWith('---')) return null;
  const match = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return null;
  return { full: match[0], yaml: match[1] };
}

function checkLivenessForSpec(specFilePath) {
  const errors = [];
  const content = fs.readFileSync(specFilePath, 'utf8');
  const frontmatter = matchFrontmatter(content);
  if (!frontmatter) {
    errors.push('missing frontmatter');
    return errors;
  }

  const body = content.slice(frontmatter.full.length);
  const sections = extractH2Sections(body);
  const repoRoot = process.cwd();

  for (const heading of ['Context Evidence', 'Implementation Links']) {
    const text = sections.get(heading) || '';
    const pathMatches = text.match(/`([^`]+)`/g) || [];
    for (const raw of pathMatches) {
      const p = raw.replace(/^`|`$/g, '').trim();
      if (!p || !looksLikeFilePath(p)) continue;
      const normalized = p.replace(/:\d+(-\d+)?$/, '').trim();
      if (!normalized) continue;
      const resolved = path.resolve(repoRoot, normalized);
      if (!fs.existsSync(resolved)) {
        errors.push(`${heading}: '${p}' not found`);
      }
    }
  }

  const acText = sections.get('Acceptance Checks') || '';
  const verifyRe = /→\s*verify:\s*`?\s*node\s+(scripts\/[^\s`]+)/gi;
  let m;
  while ((m = verifyRe.exec(acText)) !== null) {
    const scriptPath = m[1].trim().replace(/`+$/, '');
    if (!scriptPath) continue;
    const resolved = path.resolve(repoRoot, scriptPath);
    if (!fs.existsSync(resolved)) {
      errors.push(`Acceptance Checks: verify script '${scriptPath}' not found`);
    }
  }

  return errors;
}

function main() {
  const targetPath = path.resolve(process.argv[2] || path.join(process.cwd(), 'specs'));

  if (!fs.existsSync(targetPath)) {
    console.log(`specs ok (no specs directory at ${toDisplayPath(targetPath)})`);
    process.exit(0);
  }

  const specFiles = collectSpecFiles(targetPath);
  if (specFiles.length === 0) {
    console.log(`specs ok (0 specs found at ${toDisplayPath(targetPath)})`);
    process.exit(0);
  }

  const allErrors = [];
  for (const specFile of specFiles) {
    const errors = checkLivenessForSpec(specFile);
    for (const error of errors) {
      allErrors.push(`${toDisplayPath(specFile)}: ${error}`);
    }
  }

  if (allErrors.length > 0) {
    console.error(`artifact liveness failures:\n${allErrors.map((e) => `  ${e}`).join('\n')}`);
    process.exit(1);
  }

  console.log(`specs ok (${specFiles.length} specs, all paths resolve)`);
}

if (require.main === module) {
  main();
}

module.exports = {
  checkLivenessForSpec,
  collectSpecFiles,
  looksLikeFilePath,
};
