#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const docsRoot = path.join(repoRoot, 'docs');

const markdownLinkRe = /\[([^\]]*)\]\(([^)]+)\)/g;

function walkDir(dir, out = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.vitepress' || entry.name === 'node_modules') continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(fullPath, out);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      out.push(fullPath);
    }
  }
  return out;
}

function toPosix(filePath) {
  return filePath.split(path.sep).join('/');
}

function normalizePath(value) {
  return value.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
}

function main() {
  const errors = [];
  const mdFiles = walkDir(docsRoot);

  const existingRel = new Set();
  for (const abs of mdFiles) {
    existingRel.add(toPosix(path.relative(repoRoot, abs)));
  }

  for (const abs of mdFiles) {
    const content = fs.readFileSync(abs, 'utf8');
    const relPath = toPosix(path.relative(repoRoot, abs));
    const fileDir = path.dirname(abs);

    let match;
    markdownLinkRe.lastIndex = 0;
    while ((match = markdownLinkRe.exec(content)) !== null) {
      const linkText = match[1];
      let linkTarget = match[2].trim();

      if (!linkTarget.endsWith('.md')) continue;
      if (linkTarget.startsWith('http://') || linkTarget.startsWith('https://') || linkTarget.startsWith('//')) continue;
      if (linkTarget.startsWith('#')) continue;

      let resolved;
      if (linkTarget.startsWith('/')) {
        resolved = path.join(repoRoot, 'docs', normalizePath(linkTarget).replace(/^\/+/, ''));
      } else if (linkTarget.startsWith('docs/')) {
        resolved = path.join(repoRoot, linkTarget);
      } else {
        resolved = path.resolve(fileDir, linkTarget);
      }

      const resolvedRel = toPosix(path.relative(repoRoot, resolved));
      if (!resolvedRel.startsWith('docs/')) continue;
      if (!existingRel.has(resolvedRel)) {
        errors.push(`${relPath}: Dead link '${linkText}' → '${linkTarget}' (target '${resolvedRel}' not found).`);
      }
    }
  }

  if (errors.length > 0) {
    console.error('Dead link errors:');
    for (const err of errors) {
      console.error(`  - ${err}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(`OK: no dead markdown links found (${mdFiles.length} files checked).`);
}

main();
