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
  { label: 'Elegy home path: ~/.elegy', pattern: /~\/\.elegy/i },
];

const requiredAgentFields = ['name', 'description', 'model', 'model_reasoning_effort', 'sandbox_mode', 'developer_instructions'];
const allowedReasoningEfforts = new Set(['low', 'medium', 'high']);

function parseTomlScalar(content, key) {
  const match = content.match(new RegExp(`^${key}\\s*=\\s*([^\\r\\n]+)`, 'm'));
  if (!match) return null;
  return match[1].trim().replace(/^["']|["']$/g, '');
}

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

    if (relativePath.startsWith('agents/') && relativePath.endsWith('.toml')) {
      for (const field of requiredAgentFields) {
        if (!new RegExp(`^${field}\\s*=`, 'm').test(content)) {
          findings.push({
            relativePath,
            label: `Codex agent missing required field: ${field}`,
          });
        }
      }

      const effort = parseTomlScalar(content, 'model_reasoning_effort');
      if (effort && !allowedReasoningEfforts.has(effort)) {
        findings.push({
          relativePath,
          label: `Unsupported Codex reasoning effort: ${effort}`,
        });
      }

      if (!/Output contract:/i.test(content)) {
        findings.push({
          relativePath,
          label: 'Codex agent missing Output contract marker',
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
