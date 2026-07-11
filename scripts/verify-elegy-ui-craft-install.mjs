#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const codexHome = path.resolve(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'));
const codexCommand = process.env.CODEX_COMMAND || process.env.CODEX_CLI_PATH || 'codex';
const marketplaceRoot = path.join(codexHome, 'marketplaces', 'elegy');
const staleSkillNames = ['ui-system', 'ui-runtime-exploration', 'ui-visual-review', 'impeccable'];

function parseJson(stdout) {
  const text = String(stdout || '').trim();
  try {
    return JSON.parse(text);
  } catch {
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first >= 0 && last > first) return JSON.parse(text.slice(first, last + 1));
    throw new Error(`Codex returned non-JSON output: ${text}`);
  }
}

function runCodex(args) {
  const result = spawnSync(codexCommand, args, {
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, CODEX_HOME: codexHome },
  });
  if (result.status !== 0) {
    throw new Error(`Codex command failed (${args.join(' ')}): ${result.stderr || result.stdout || result.error?.message || 'unknown error'}`);
  }
  return parseJson(result.stdout);
}

function records(value, key) {
  const list = Array.isArray(value) ? value : value?.[key] || value?.plugins || [];
  return Array.isArray(list) ? list : [];
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const marketplaces = records(runCodex(['plugin', 'marketplace', 'list', '--json']), 'marketplaces');
const elegy = marketplaces.find((marketplace) => marketplace.name === 'elegy');
assert(elegy, 'Codex marketplace `elegy` is not registered.');
assert(path.resolve(elegy.root) === marketplaceRoot, `Codex marketplace elegy points to ${elegy.root}, expected ${marketplaceRoot}.`);

const available = runCodex(['plugin', 'list', '--marketplace', 'elegy', '--available', '--json']);
const installed = runCodex(['plugin', 'list', '--marketplace', 'elegy', '--json']);
const availablePlugins = [
  ...records(available, 'available'),
  ...records(available, 'installed'),
];
const installedPlugins = records(installed, 'installed');
const uiCraftAvailable = availablePlugins.find((plugin) => String(plugin.name || plugin.plugin || '').split('@')[0] === 'elegy-ui-craft');
const uiCraftInstalled = installedPlugins.find((plugin) => String(plugin.name || plugin.plugin || '').split('@')[0] === 'elegy-ui-craft');
assert(uiCraftAvailable, 'Elegy UI Craft is not available from the registered marketplace.');
assert(uiCraftInstalled, 'Elegy UI Craft is not installed in Codex.');
assert(uiCraftInstalled.enabled === true || uiCraftInstalled.status === 'enabled', 'Elegy UI Craft is installed but not enabled.');

const requiredPaths = [
  path.join(marketplaceRoot, '.agents', 'plugins', 'marketplace.json'),
  path.join(marketplaceRoot, 'plugins', 'elegy-ui-craft', '.codex-plugin', 'plugin.json'),
  path.join(marketplaceRoot, 'plugins', 'elegy-ui-craft', 'skills', 'elegy-ui-craft', 'SKILL.md'),
];
if (process.platform === 'win32') {
  requiredPaths.push(path.join(marketplaceRoot, 'plugins', 'elegy-ui-craft', 'bin', 'elegy-ui-craft.exe'));
}
for (const requiredPath of requiredPaths) {
  assert(fs.existsSync(requiredPath), `Installed Elegy UI Craft asset is missing: ${requiredPath}`);
}

for (const staleSkillName of staleSkillNames) {
  assert(!fs.existsSync(path.join(codexHome, 'skills', staleSkillName)), `Stale Codex UI skill remains installed: ${staleSkillName}`);
}

const agentsPath = path.join(codexHome, 'AGENTS.md');
const agents = fs.existsSync(agentsPath) ? fs.readFileSync(agentsPath, 'utf8') : '';
assert(agents.includes('elegy-ui-craft'), `${agentsPath} does not route UI work to Elegy UI Craft.`);
assert(!/^\|.*(?:ui-system|ui-runtime-exploration|ui-visual-review).*$/im.test(agents), `${agentsPath} still lists a stale standalone UI skill.`);
assert(!/For UI work, use(?! elegy-ui-craft@elegy)[^\n]*(?:ui-system|ui-runtime-exploration|ui-visual-review)/i.test(agents), `${agentsPath} still routes UI work to a stale standalone skill.`);

console.log(JSON.stringify({
  ok: true,
  codexCommand,
  codexHome,
  marketplaceRoot,
  plugin: 'elegy-ui-craft',
  staleSkillNames,
}, null, 2));
