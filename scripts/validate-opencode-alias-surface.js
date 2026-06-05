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
 * Agents in the directory that are intentionally NOT declared in the manifest.
 * Empty by default; add entries only when there is an explicit reason.
 */
const ALLOWLIST = [];

/**
 * Read and parse the manifest to extract declared agent names from asset entries
 * of type "agent". Returns a Set of agent basenames (without .md extension).
 */
function readManifestAgentNames(openCodeAssetsDir) {
  const manifestPath = path.join(openCodeAssetsDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`manifest.json not found at ${toDisplayPath(manifestPath)}`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const assets = Array.isArray(manifest.assets) ? manifest.assets : [];
  const agentNames = new Set();

  for (const asset of assets) {
    if (asset.type === 'agent') {
      const basename = path.basename(asset.source || '', '.md');
      if (basename) {
        agentNames.add(basename);
      }
    }
  }

  return agentNames;
}

/**
 * Discover all .md agent files in the agents directory. Returns an array of
 * basenames (without .md extension).
 */
function discoverAgentFiles(agentsDir) {
  if (!fs.existsSync(agentsDir)) {
    return [];
  }

  return fs.readdirSync(agentsDir)
    .filter((entry) => entry.endsWith('.md'))
    .map((entry) => entry.slice(0, -3));
}

/**
 * Scan AGENTS.md for mentions of agent-like names (backtick-quoted names
 * that could be agent references like `@code-explorer` or `@web-searcher`).
 * Returns an array of names found.
 */
function findAgentMentionsInDoc(docPath) {
  if (!fs.existsSync(docPath)) {
    return [];
  }

  const content = fs.readFileSync(docPath, 'utf8');
  const mentions = new Set();

  // Match backtick-quoted strings that look like agent names (with @ prefix)
  const agentRefRegex = /`@([a-zA-Z][a-zA-Z0-9_-]*)`/g;
  let match;
  while ((match = agentRefRegex.exec(content)) !== null) {
    mentions.add(match[1]);
  }

  // Also match non-@ backtick-quoted names that might be agent references
  // in section headers or tables (e.g., `quick`, `standard`)
  const codeRefRegex = /`([a-zA-Z][a-zA-Z0-9_-]{2,})`/g;
  while ((match = codeRefRegex.exec(content)) !== null) {
    mentions.add(match[1]);
  }

  return Array.from(mentions);
}

function main() {
  const openCodeAssetsDir = path.resolve(process.argv[2] || path.join(process.cwd(), 'opencode-assets'));
  const agentsDir = path.join(openCodeAssetsDir, 'agents');
  const errors = [];

  // 1. Read the manifest
  let manifestAgentNames;
  try {
    manifestAgentNames = readManifestAgentNames(openCodeAssetsDir);
  } catch (err) {
    errors.push(err.message);
    console.error('opencode-alias-surface invalid:');
    for (const error of errors) {
      console.error(`  ${error}`);
    }
    process.exit(1);
  }

  // 2. Check every .md file in agents directory is declared or allowlisted
  const agentFiles = discoverAgentFiles(agentsDir);
  for (const agentName of agentFiles) {
    if (!manifestAgentNames.has(agentName) && !ALLOWLIST.includes(agentName)) {
      errors.push(
        `unmanifested agent file: agents/${agentName}.md is not declared in manifest.json ` +
        `(manifested agents: [${Array.from(manifestAgentNames).sort().join(', ')}])`
      );
    }
  }

  // 3. Check AGENTS.md doesn't reference undeclared agent names
  const docPath = path.join(openCodeAssetsDir, 'home', 'AGENTS.md');
  const docMentions = findAgentMentionsInDoc(docPath);

  // Check @-prefixed mentions specifically (like @code-explorer, @web-searcher)
  const content = fs.readFileSync(docPath, 'utf8');
  const atRefRegex = /`@([a-zA-Z][a-zA-Z0-9_-]*)`/g;
  let atMatch;
  while ((atMatch = atRefRegex.exec(content)) !== null) {
    const agentName = atMatch[1];
    if (!manifestAgentNames.has(agentName)) {
      errors.push(
        `AGENTS.md references undeclared agent '@${agentName}' which is not in manifest.json`
      );
    }
  }

  if (errors.length > 0) {
    console.error('opencode-alias-surface invalid:');
    for (const error of errors) {
      console.error(`  ${error}`);
    }
    process.exit(1);
  }

  console.log('opencode-alias-surface ok');
}

if (require.main === module) {
  main();
}

module.exports = {
  ALLOWLIST,
  readManifestAgentNames,
  discoverAgentFiles,
  findAgentMentionsInDoc,
};
