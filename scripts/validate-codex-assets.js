#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const defaultRoot = path.resolve(__dirname, '..', 'codex-assets');
const gateName = 'Codex Asset Audit';
const bannedPatterns = [
  { label: 'Copilot tool reference: vscode/askQuestions', pattern: /vscode\/askQuestions/i },
  { label: 'Copilot tool reference: run_in_terminal', pattern: /run_in_terminal/i },
  { label: 'Copilot review pattern: Rubber Duck', pattern: /Rubber Duck/i },
  { label: 'Copilot home path: ~/.copilot', pattern: /~\/\.copilot/i },
];

function listFiles(rootDir) {
  const files = [];

  function walk(current) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
      } else if (entry.isFile()) {
        files.push(abs);
      }
    }
  }

  if (fs.existsSync(rootDir)) {
    walk(rootDir);
  }
  return files;
}

function runAudit(options = {}) {
  const rootDir = options.rootDir || defaultRoot;
  const findings = [];
  const files = listFiles(rootDir);

  for (const filePath of files) {
    const relativePath = path.relative(rootDir, filePath).replace(/\\/g, '/');
    const content = fs.readFileSync(filePath, 'utf8');

    for (const banned of bannedPatterns) {
      if (banned.pattern.test(content)) {
        findings.push({
          relativePath,
          label: banned.label,
        });
      }
    }
  }

  return {
    gateName,
    findings,
  };
}

function main() {
  const result = runAudit();
  if (result.findings.length > 0) {
    for (const finding of result.findings) {
      console.error(`${gateName} failed: ${finding.relativePath}: ${finding.label}`);
    }
    process.exit(1);
  }

  console.log(`${gateName} ok (${defaultRoot})`);
}

if (require.main === module) {
  main();
}

module.exports = {
  gateName,
  runAudit,
};
