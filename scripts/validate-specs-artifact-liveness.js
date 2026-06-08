#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const { collectSpecFiles } = require('./lib/spec-collector.js');
const { matchFrontmatter, extractH2Sections } = require('./lib/spec-headings.js');
const { looksLikeFilePath, KNOWN_SOURCE_DIRS } = require('./lib/spec-path-heuristics.js');

function toPosix(filePath) {
  return String(filePath || '').replace(/\\/g, '/');
}

function toDisplayPath(filePath) {
  return toPosix(path.relative(process.cwd(), filePath) || path.basename(filePath));
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
};
