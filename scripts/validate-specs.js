#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const VALID_STATUS = new Set(['draft', 'approved', 'implemented', 'superseded']);
const VALID_TYPES = new Set(['feature', 'workflow', 'contract', 'skill', 'agent', 'migration']);
const REQUIRED_FRONTMATTER_KEYS = ['spec_id', 'title', 'status', 'type', 'updated'];
const REQUIRED_HEADINGS = [
  'Intent',
  'Context Evidence',
  'Requirements',
  'Non-Goals',
  'Acceptance Checks',
  'Implementation Links',
  'Validation Evidence',
  'Drift Notes',
];

function toPosix(filePath) {
  return String(filePath || '').replace(/\\/g, '/');
}

function toDisplayPath(filePath) {
  return toPosix(path.relative(process.cwd(), filePath) || path.basename(filePath));
}

function parseArgs(argv) {
  const options = {
    require: false,
    targetPath: path.join(process.cwd(), 'specs'),
  };

  let explicitPath = '';

  for (let index = 0; index < argv.length; index += 1) {
    const value = String(argv[index] || '');
    if (value === '--require') {
      options.require = true;
      continue;
    }

    if (value.startsWith('--')) {
      throw new Error(`Unknown arg: ${value} (supported: --require [path])`);
    }

    if (explicitPath) {
      throw new Error(`Unexpected extra path argument: ${value}`);
    }

    explicitPath = value;
  }

  if (explicitPath) {
    options.targetPath = path.resolve(explicitPath);
  }

  return options;
}

function matchFrontmatter(text) {
  if (!String(text || '').startsWith('---')) {
    return null;
  }

  const match = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    return null;
  }

  return {
    full: match[0],
    yaml: match[1],
  };
}

function parseInlineList(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) {
    return null;
  }

  const inner = trimmed.slice(1, -1).trim();
  if (!inner) {
    return [];
  }

  return inner
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((item) => item.replace(/^['"]|['"]$/g, ''));
}

function parseFrontmatterYaml(yamlText) {
  const meta = {};
  const lines = String(yamlText || '').split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const line = rawLine.trim();

    if (!line || line.startsWith('#')) {
      continue;
    }

    const colonIndex = line.indexOf(':');
    if (colonIndex <= 0) {
      throw new Error(`Invalid YAML line (expected key: value): ${rawLine}`);
    }

    const key = line.slice(0, colonIndex).trim();
    let value = line.slice(colonIndex + 1).trim();
    if (!key) {
      throw new Error(`Invalid YAML key: ${rawLine}`);
    }

    if (Object.prototype.hasOwnProperty.call(meta, key)) {
      throw new Error(`Duplicate YAML key: ${key}`);
    }

    if (value === '') {
      const items = [];
      while (index + 1 < lines.length) {
        const nextRaw = lines[index + 1];
        const next = nextRaw.trim();
        if (!next) {
          index += 1;
          continue;
        }
        if (!next.startsWith('-')) {
          break;
        }
        const item = next.replace(/^-\s*/, '').trim().replace(/^['"]|['"]$/g, '');
        if (item) {
          items.push(item);
        }
        index += 1;
      }

      meta[key] = items;
      continue;
    }

    const inlineList = parseInlineList(value);
    if (inlineList !== null) {
      meta[key] = inlineList;
      continue;
    }

    value = value.replace(/^['"]|['"]$/g, '');
    meta[key] = value;
  }

  return meta;
}

function extractH2Sections(markdownBody) {
  const lines = String(markdownBody || '').split(/\r?\n/);
  const sections = new Map();
  let currentHeading = '';
  let currentLines = [];

  function commitCurrent() {
    if (!currentHeading) {
      return;
    }
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

function countBulletItems(sectionText) {
  return String(sectionText || '')
    .split(/\r?\n/)
    .filter((line) => /^\s*[-*]\s+\S/.test(line)).length;
}

function hasMeaningfulContent(sectionText) {
  const normalized = String(sectionText || '')
    .replace(/^\s*[-*]\s*/gm, '')
    .replace(/`[^`]*`/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) {
    return false;
  }

  return !/^(?:none|n\/a|na|todo|tbd|pending|not yet|placeholder|none yet|fill me in)\.?$/i.test(normalized);
}

function collectSpecFiles(targetPath) {
  const resolvedTarget = path.resolve(targetPath);
  if (!fs.existsSync(resolvedTarget)) {
    return [];
  }

  const stat = fs.statSync(resolvedTarget);
  if (stat.isFile()) {
    return [resolvedTarget];
  }

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

function validateSpecFile(filePath) {
  const errors = [];
  const content = fs.readFileSync(filePath, 'utf8');
  const frontmatter = matchFrontmatter(content);

  if (!frontmatter) {
    return {
      filePath,
      errors: ['missing YAML frontmatter'],
    };
  }

  let meta;
  try {
    meta = parseFrontmatterYaml(frontmatter.yaml);
  } catch (error) {
    return {
      filePath,
      errors: [`frontmatter parse error: ${error.message}`],
    };
  }

  for (const key of REQUIRED_FRONTMATTER_KEYS) {
    if (!String(meta[key] || '').trim()) {
      errors.push(`missing required frontmatter key '${key}'`);
    }
  }

  const status = String(meta.status || '').trim();
  if (status && !VALID_STATUS.has(status)) {
    errors.push(`invalid status '${status}' (expected: ${Array.from(VALID_STATUS).join(', ')})`);
  }

  const type = String(meta.type || '').trim();
  if (type && !VALID_TYPES.has(type)) {
    errors.push(`invalid type '${type}' (expected: ${Array.from(VALID_TYPES).join(', ')})`);
  }

  const updated = String(meta.updated || '').trim();
  if (updated && !/^\d{4}-\d{2}-\d{2}$/.test(updated)) {
    errors.push(`invalid updated '${updated}' (expected YYYY-MM-DD)`);
  }

  const body = content.slice(frontmatter.full.length);
  const sections = extractH2Sections(body);

  for (const heading of REQUIRED_HEADINGS) {
    if (!sections.has(heading)) {
      errors.push(`missing required heading '## ${heading}'`);
    }
  }

  const intent = sections.get('Intent') || '';
  if (!hasMeaningfulContent(intent)) {
    errors.push('Intent must be non-empty');
  }

  const acceptanceChecks = sections.get('Acceptance Checks') || '';
  const acceptanceCheckCount = countBulletItems(acceptanceChecks);
  if (acceptanceCheckCount < 2) {
    errors.push(`Acceptance Checks must include at least 2 bullet items (found ${acceptanceCheckCount})`);
  }

  const validationEvidence = sections.get('Validation Evidence') || '';
  if (status === 'implemented' && !hasMeaningfulContent(validationEvidence)) {
    errors.push('Validation Evidence must be non-empty when status is implemented');
  }

  return {
    filePath,
    errors,
  };
}

function validateSpecsRoot(options = {}) {
  const targetPath = path.resolve(options.targetPath || path.join(process.cwd(), 'specs'));
  const requireSpecs = Boolean(options.require);
  const errors = [];

  if (!fs.existsSync(targetPath)) {
    if (requireSpecs) {
      errors.push(`spec root not found: ${toDisplayPath(targetPath)}`);
      return {
        targetPath,
        specFiles: [],
        errors,
      };
    }

    return {
      targetPath,
      specFiles: [],
      errors,
      skipped: 'missing-root',
    };
  }

  const specFiles = collectSpecFiles(targetPath);
  if (requireSpecs && specFiles.length === 0) {
    errors.push(`no spec.md files found under ${toDisplayPath(targetPath)}`);
  }

  for (const specFile of specFiles) {
    const result = validateSpecFile(specFile);
    for (const error of result.errors) {
      errors.push(`${toDisplayPath(specFile)}: ${error}`);
    }
  }

  return {
    targetPath,
    specFiles,
    errors,
  };
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`specs invalid:\n  ${error.message}`);
    process.exit(1);
  }

  const result = validateSpecsRoot(options);
  if (result.errors.length > 0) {
    console.error(`specs invalid:\n${result.errors.map((error) => `  ${error}`).join('\n')}`);
    process.exit(1);
  }

  if (result.skipped === 'missing-root') {
    console.log(`specs ok (no specs directory at ${toDisplayPath(result.targetPath)})`);
    return;
  }

  console.log(`specs ok (${result.specFiles.length} specs)`);
}

if (require.main === module) {
  main();
}

module.exports = {
  REQUIRED_FRONTMATTER_KEYS,
  REQUIRED_HEADINGS,
  VALID_STATUS,
  VALID_TYPES,
  collectSpecFiles,
  parseArgs,
  parseFrontmatterYaml,
  validateSpecFile,
  validateSpecsRoot,
};
