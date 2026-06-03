#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function toPosix(filePath) {
  return String(filePath || '').replace(/\\/g, '/');
}

function toDisplayPath(filePath) {
  return toPosix(path.relative(process.cwd(), filePath) || path.basename(filePath));
}

/**
 * Parse simple YAML frontmatter from a markdown file.
 */
function parseFrontmatter(content) {
  if (!String(content || '').startsWith('---')) {
    return null;
  }

  const match = String(content).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    return null;
  }

  const meta = {};
  const lines = match[1].split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const line = rawLine.trim();

    if (!line || line.startsWith('#')) {
      continue;
    }

    const colonIndex = line.indexOf(':');
    if (colonIndex <= 0) {
      continue;
    }

    const key = line.slice(0, colonIndex).trim();
    let value = line.slice(colonIndex + 1).trim();

    if (value === '') {
      // Skip list values for frontmatter keys we care about
      continue;
    }

    value = value.replace(/^['"]|['"]$/g, '');
    meta[key] = value;
  }

  return meta;
}

/**
 * Discover all agent files in the agents directory and parse their frontmatter.
 */
function discoverAgents(agentsDir) {
  const agents = {};

  if (!fs.existsSync(agentsDir)) {
    return agents;
  }

  const entries = fs.readdirSync(agentsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) {
      continue;
    }

    const agentName = entry.name.slice(0, -3); // Remove .md
    const filePath = path.join(agentsDir, entry.name);
    const content = fs.readFileSync(filePath, 'utf8');
    const frontmatter = parseFrontmatter(content);

    agents[agentName] = {
      filePath,
      frontmatter,
    };
  }

  return agents;
}

/**
 * Read and parse profiles.json.
 */
function readProfiles(openCodeAssetsDir) {
  const profilesPath = path.join(openCodeAssetsDir, 'profiles.json');
  if (!fs.existsSync(profilesPath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(profilesPath, 'utf8'));
}

function main() {
  const openCodeAssetsDir = path.resolve(process.argv[2] || path.join(process.cwd(), 'opencode-assets'));
  const agentsDir = path.join(openCodeAssetsDir, 'agents');
  const errors = [];

  // Read profiles.json
  const profiles = readProfiles(openCodeAssetsDir);
  if (!profiles) {
    errors.push(`profiles.json not found at ${toDisplayPath(path.join(openCodeAssetsDir, 'profiles.json'))}`);
    console.error('profile-role-coverage invalid:');
    for (const error of errors) {
      console.error(`  ${error}`);
    }
    process.exit(1);
  }

  const agentRoles = profiles.agentRoles || {};

  // Discover agents
  const agents = discoverAgents(agentsDir);

  // 1. Check that every key in agentRoles has a corresponding agent file
  for (const roleKey of Object.keys(agentRoles)) {
    if (!agents[roleKey]) {
      errors.push(`agent role '${roleKey}' has no matching agent file (agents/${roleKey}.md)`);
    }
  }

  // 2 & 3. Check that every role-mapped agent has the required frontmatter
  for (const [agentName, agent] of Object.entries(agents)) {
    // Agent must have a role in agentRoles if it's in the agents directory
    if (!Object.prototype.hasOwnProperty.call(agentRoles, agentName)) {
      continue; // Not a role-mapped agent, skip
    }

    // Role-mapped agent must have model and reasoningEffort in frontmatter
    if (!agent.frontmatter) {
      errors.push(`${agentName} (${toDisplayPath(agent.filePath)}): missing frontmatter`);
    } else {
      if (!agent.frontmatter.model) {
        errors.push(`${agentName} (${toDisplayPath(agent.filePath)}): frontmatter missing 'model'`);
      }
      if (!agent.frontmatter.reasoningEffort) {
        errors.push(`${agentName} (${toDisplayPath(agent.filePath)}): frontmatter missing 'reasoningEffort'`);
      }
    }
  }

  if (errors.length > 0) {
    console.error('profile-role-coverage invalid:');
    for (const error of errors) {
      console.error(`  ${error}`);
    }
    process.exit(1);
  }

  console.log('profile-role-coverage ok');
}

if (require.main === module) {
  main();
}

module.exports = {
  parseFrontmatter,
  discoverAgents,
  readProfiles,
};
