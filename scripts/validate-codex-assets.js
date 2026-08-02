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

const requiredAgentFields = ['name', 'description', 'model', 'sandbox_mode', 'developer_instructions'];
const allowedReasoningEfforts = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
const REQUIRED_NATIVE_AGENT_IDS = [
  'codex-explorer-agent',
  'codex-reviewer-agent',
  'codex-reviewer-strong-agent',
  'codex-worker-agent',
  'codex-test-runner-agent',
  'codex-sweeper-agent',
];
const REQUIRED_COMPATIBILITY_SKILL_IDS = [
  'codex-repo-setup-skill',
  'codex-repo-backed-obsidian-docs-skill',
  'codex-sweeper-cleanup-skill',
  'codex-repo-quality-setup-skill',
  'codex-agents-md-authoring-skill',
  'codex-tdd-skill',
  'codex-goal-session-workflow-skill',
  'codex-evaluate-task-workflow-skill',
];

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

function addReceiptFindings(rootDir, findings) {
  const manifestPath = path.join(rootDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    findings.push({ relativePath: 'manifest.json', label: 'Codex manifest is missing' });
    return;
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    findings.push({ relativePath: 'manifest.json', label: `Codex manifest is invalid JSON: ${error.message}` });
    return;
  }

  const assets = Array.isArray(manifest.assets) ? manifest.assets : [];
  const agents = assets.filter((asset) => asset?.type === 'agent').map((asset) => asset.id);
  const skills = assets.filter((asset) => asset?.type === 'skill').map((asset) => asset.id);
  if (JSON.stringify(agents) !== JSON.stringify(REQUIRED_NATIVE_AGENT_IDS)) {
    findings.push({
      relativePath: 'manifest.json',
      label: `Codex native agent receipt must be exactly ${REQUIRED_NATIVE_AGENT_IDS.length}: ${REQUIRED_NATIVE_AGENT_IDS.join(', ')}`,
    });
  }
  if (JSON.stringify(skills) !== JSON.stringify(REQUIRED_COMPATIBILITY_SKILL_IDS)) {
    findings.push({
      relativePath: 'manifest.json',
      label: `Codex compatibility skill receipt must be exactly ${REQUIRED_COMPATIBILITY_SKILL_IDS.length}: ${REQUIRED_COMPATIBILITY_SKILL_IDS.join(', ')}`,
    });
  }

  for (const asset of assets) {
    const management = asset?.management;
    if (!management || typeof management !== 'object') {
      findings.push({ relativePath: 'manifest.json', label: `Codex asset is missing explicit management metadata: ${asset?.id || '<unknown>'}` });
      continue;
    }
    if (asset.type === 'agent') {
      if (management.owner !== 'harness' || management.sourceOfTruth !== 'codex' || management.readOnly !== true) {
        findings.push({ relativePath: 'manifest.json', label: `Native Codex agent must be harness-owned/read-only: ${asset.id}` });
      }
    } else if (asset.type === 'skill' && (management.owner !== 'elegy' || management.readOnly === true)) {
      findings.push({ relativePath: 'manifest.json', label: `Codex compatibility skill must be Elegy-managed: ${asset.id}` });
    }
  }
}

function runAudit(options = {}) {
  const rootDir = options.rootDir || defaultRoot;
  const findings = [];
  const files = listFiles(rootDir);

  if (options.enforceReceipt === true || (!options.rootDir && path.resolve(rootDir) === defaultRoot)) {
    addReceiptFindings(rootDir, findings);
  }

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
      if (/^\s*\[elegy\]\s*$/m.test(content)) {
        findings.push({
          relativePath,
          label: 'Unsupported Codex agent table: elegy',
        });
      }

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
  REQUIRED_NATIVE_AGENT_IDS,
  REQUIRED_COMPATIBILITY_SKILL_IDS,
  runAudit,
};
