#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const PRIMARY_LANES = {
  quick: ['impl', 'explorer'],
  standard: ['impl', 'explorer', 'reviewer'],
  spec: ['impl', 'explorer', 'reviewer'],
  project: ['impl', 'explorer', 'reviewer'],
};

const LEAF_SUBAGENTS = [
  'impl',
  'explorer',
  'reviewer',
  'notes-enhance',
  'notes-reexamine',
  'notes-research',
  'notes-deduplicate',
];

function toPosix(filePath) {
  return String(filePath || '').replace(/\\/g, '/');
}

function toDisplayPath(filePath) {
  return toPosix(path.relative(process.cwd(), filePath) || path.basename(filePath));
}

function readAgent(agentsDir, agentName) {
  const filePath = path.join(agentsDir, `${agentName}.md`);
  if (!fs.existsSync(filePath)) {
    return { filePath, content: null, frontmatter: null };
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  return {
    filePath,
    content,
    frontmatter: match ? match[1] : null,
  };
}

function hasTopLevelValue(frontmatter, key, expectedValue) {
  const regex = new RegExp(`^${key}:\\s*${expectedValue}\\s*$`, 'm');
  return regex.test(frontmatter || '');
}

function hasPermissionTaskDeny(frontmatter) {
  return /^permission:\s*$/m.test(frontmatter || '')
    && /^\s+task:\s*deny\s*$/m.test(frontmatter || '');
}

function hasTaskAllowlistDenyDefault(frontmatter) {
  return /^permission:\s*$/m.test(frontmatter || '')
    && /^\s+task:\s*$/m.test(frontmatter || '')
    && /^\s+["']?\*["']?:\s*deny\s*$/m.test(frontmatter || '');
}

function hasAllowedTask(frontmatter, agentName) {
  const escaped = agentName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`^\\s+${escaped}:\\s*allow\\s*$`, 'm');
  return regex.test(frontmatter || '');
}

function validateOpenCodeAgentTopology(options = {}) {
  const repoRoot = options.repoRoot || path.resolve(__dirname, '..');
  const agentsDir = options.agentsDir || path.join(repoRoot, 'opencode-assets', 'agents');
  const errors = [];

  for (const [laneName, allowedSubagents] of Object.entries(PRIMARY_LANES)) {
    const agent = readAgent(agentsDir, laneName);
    if (!agent.content) {
      errors.push(`${toDisplayPath(agent.filePath)}: missing primary lane agent`);
      continue;
    }
    if (!agent.frontmatter) {
      errors.push(`${toDisplayPath(agent.filePath)}: missing YAML frontmatter`);
      continue;
    }
    if (!hasTopLevelValue(agent.frontmatter, 'mode', 'primary')) {
      errors.push(`${toDisplayPath(agent.filePath)}: primary lane must declare mode: primary`);
    }
    if (!hasTaskAllowlistDenyDefault(agent.frontmatter)) {
      errors.push(`${toDisplayPath(agent.filePath)}: primary lane must deny all task delegation by default`);
    }
    for (const subagentName of allowedSubagents) {
      if (!hasAllowedTask(agent.frontmatter, subagentName)) {
        errors.push(`${toDisplayPath(agent.filePath)}: primary lane must explicitly allow task delegation to ${subagentName}`);
      }
    }
  }

  for (const subagentName of LEAF_SUBAGENTS) {
    const agent = readAgent(agentsDir, subagentName);
    if (!agent.content) {
      errors.push(`${toDisplayPath(agent.filePath)}: missing leaf subagent`);
      continue;
    }
    if (!agent.frontmatter) {
      errors.push(`${toDisplayPath(agent.filePath)}: missing YAML frontmatter`);
      continue;
    }
    if (!hasTopLevelValue(agent.frontmatter, 'mode', 'subagent')) {
      errors.push(`${toDisplayPath(agent.filePath)}: leaf agent must declare mode: subagent`);
    }
    if (!hasTopLevelValue(agent.frontmatter, 'hidden', 'true')) {
      errors.push(`${toDisplayPath(agent.filePath)}: leaf agent must declare hidden: true`);
    }
    if (!hasPermissionTaskDeny(agent.frontmatter)) {
      errors.push(`${toDisplayPath(agent.filePath)}: leaf agent must explicitly declare permission.task: deny`);
    }
  }

  return { errors };
}

function main() {
  const result = validateOpenCodeAgentTopology();
  if (result.errors.length > 0) {
    console.error('opencode-agent-topology invalid:');
    for (const error of result.errors) {
      console.error(`  ${error}`);
    }
    process.exit(1);
  }

  console.log('opencode-agent-topology ok');
}

if (require.main === module) {
  main();
}

module.exports = {
  validateOpenCodeAgentTopology,
};
