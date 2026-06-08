#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { normalizeProfile } from './lib/profile-normalizer.mjs';
import { updateAgentModel } from './frontmatter-utils.mjs';
import { getUserHome } from './install-surface-utils.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const { readConfig, writeConfig, getActiveProfileId, setActiveProfileId } = require('../copilot-ui/lib/opencodeConfig.js');

function resolveOpenCodeHome() {
  if (process.env.OPENCODE_HOME) return path.resolve(process.env.OPENCODE_HOME);
  const cfgDir = process.env.OPENCODE_CONFIG_DIR || process.env.XDG_CONFIG_HOME
    ? path.join(process.env.XDG_CONFIG_HOME || path.join(getUserHome(), '.config'), 'opencode')
    : path.join(getUserHome(), '.config', 'opencode');
  return cfgDir;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log('Usage: node scripts/opencode-profile-switch.mjs <profile>');
    console.log('');
    console.log('Available commands:');
    console.log('  node scripts/opencode-profile-switch.mjs <profile>   Switch to the named profile');
    console.log('  node scripts/opencode-profile-switch.mjs --list       List available profiles');
    console.log('  node scripts/opencode-profile-switch.mjs --current    Show active profile');
    console.log('');
    console.log('Profiles are defined in opencode-assets/profiles.json');
    process.exit(0);
  }

  const profilesPath = path.join(repoRoot, 'opencode-assets', 'profiles.json');
  if (!fs.existsSync(profilesPath)) {
    console.error(`Profiles config not found: ${profilesPath}`);
    process.exit(1);
  }

  const profilesConfig = JSON.parse(fs.readFileSync(profilesPath, 'utf8'));
  const availableProfiles = profilesConfig.profiles || {};
  const agentRoles = profilesConfig.agentRoles || {};

  if (args[0] === '--list') {
    console.log('Available profiles:');
    for (const [name, profile] of Object.entries(availableProfiles)) {
      const normalized = normalizeProfile(profile, name);
      const marker = name === profilesConfig.activeProfile ? ' [active]' : '';
      const label = normalized.label || name;
      console.log(`  ${name}${marker} — ${label}`);
      if (normalized.description) {
        console.log(`    ${normalized.description}`);
      }
      if (Array.isArray(normalized.tags) && normalized.tags.length > 0) {
        console.log(`    tags: ${normalized.tags.join(', ')}`);
      }
      // Show legacy model fields for backward compat
      if (profile.small || profile.big || profile.review) {
        console.log(`    small:  ${profile.small || '-'}`);
        console.log(`    big:    ${profile.big || '-'}`);
        console.log(`    review: ${profile.review || '-'}`);
      }
      // Show roleModels if present
      if (normalized.roleModels && typeof normalized.roleModels === 'object') {
        console.log('    roleModels:');
        for (const [role, model] of Object.entries(normalized.roleModels)) {
          console.log(`      ${role.padEnd(16)} ${model || '-'}`);
        }
      }
    }
    process.exit(0);
  }

  if (args[0] === '--current') {
    console.log(`Active profile: ${profilesConfig.activeProfile}`);
    const profile = availableProfiles[profilesConfig.activeProfile];
    if (profile) {
      const normalized = normalizeProfile(profile, profilesConfig.activeProfile);
      console.log(`  label: ${normalized.label}`);
      if (normalized.roleModels && typeof normalized.roleModels === 'object') {
        console.log('  roleModels:');
        for (const [role, model] of Object.entries(normalized.roleModels)) {
          console.log(`    ${role.padEnd(16)} ${model || '-'}`);
        }
      }
      if (profile.small || profile.big || profile.review) {
        console.log(`  small:  ${profile.small || '-'}`);
        console.log(`  big:    ${profile.big || '-'}`);
        console.log(`  review: ${profile.review || '-'}`);
      }
    }
    process.exit(0);
  }

  const targetProfile = args[0];
  const profile = availableProfiles[targetProfile];
  if (!profile) {
    console.error(`Unknown profile: "${targetProfile}"`);
    console.error(`Available: ${Object.keys(availableProfiles).join(', ')}`);
    process.exit(1);
  }

  const roleToAgent = profilesConfig.roleToAgent || null;
  const opencodeHome = resolveOpenCodeHome();
  const agentsDir = path.join(opencodeHome, 'agents');

  if (!fs.existsSync(agentsDir)) {
    console.error(`Agents directory not found: ${agentsDir}`);
    console.error('Run opencode-install first to install lane agents.');
    process.exit(1);
  }

  const results = [];
  let updated = 0;

  for (const entry of fs.readdirSync(agentsDir).sort()) {
    if (!entry.endsWith('.md')) continue;
    const agentPath = path.join(agentsDir, entry);
    const result = updateAgentModel(agentPath, profile, agentRoles, roleToAgent);
    if (result) {
      results.push(result);
      updated += 1;
    }
  }

  const configSyncResults = [];
  try {
    const config = readConfig(opencodeHome);

    // Write legacy agent.<name>.model (backward compat)
    if (!config.agent || typeof config.agent !== 'object') {
      config.agent = {};
    }

    // Provider config management:
    // - Both profiles use built-in providers (opencode-go or deepseek).
    // - Always clean stale custom "deepseek-direct" provider if present.
    if (!config.provider || typeof config.provider !== 'object') {
      config.provider = {};
    }
    delete config.provider['deepseek-direct'];
    if (Object.keys(config.provider).length === 0) {
      delete config.provider;
    }

    let configUpdated = 0;
    for (const [agentName, roleKey] of Object.entries(agentRoles)) {
      const modelValue = profile[roleKey];
      if (!modelValue) continue;
      const prevModel = config.agent[agentName]?.model;
      if (!config.agent[agentName] || typeof config.agent[agentName] !== 'object') {
        config.agent[agentName] = {};
      }
      config.agent[agentName].model = modelValue;
      configSyncResults.push({ agent: agentName, role: roleKey, oldModel: prevModel || 'none', newModel: modelValue });
      configUpdated += 1;
    }

    // Write agentRoleModels (new preferred API)
    const normalizedForSync = normalizeProfile(profile, targetProfile);
    if (normalizedForSync.roleModels && typeof normalizedForSync.roleModels === 'object') {
      if (!config.agentRoleModels || typeof config.agentRoleModels !== 'object') {
        config.agentRoleModels = {};
      }
      for (const [role, model] of Object.entries(normalizedForSync.roleModels)) {
        if (typeof model !== 'string' || !model.trim()) continue;
        if (!config.agentRoleModels[role] || typeof config.agentRoleModels[role] !== 'object') {
          config.agentRoleModels[role] = {};
        }
        config.agentRoleModels[role].model = model.trim();
        configUpdated += 1;
      }
    }

    if (configUpdated > 0) {
      writeConfig(opencodeHome, config);
    }
  } catch (err) {
    console.log(`[WARN] Could not sync opencode.jsonc: ${err.message}`);
  }

  // Persist active profile to profiles.json
  profilesConfig.activeProfile = targetProfile;
  fs.writeFileSync(profilesPath, `${JSON.stringify(profilesConfig, null, 2)}\n`, 'utf8');

  // Also sync activeProfileId to dashboard state file
  try {
    setActiveProfileId(opencodeHome, targetProfile);
  } catch (err) {
    console.log(`[WARN] Could not sync dashboard state: ${err.message}`);
  }

  console.log(`Switched to profile: ${targetProfile}`);
  console.log('');
  if (results.length > 0) {
    console.log('Agent frontmatter updated:');
    for (const r of results) {
      console.log(`  ${r.agent.padEnd(12)} ${r.role.padEnd(8)} ${r.oldModel} → ${r.newModel}`);
    }
    console.log('');
  }
  if (configSyncResults.length > 0) {
    console.log('opencode.jsonc synced:');
    for (const r of configSyncResults) {
      console.log(`  agent.${r.agent.padEnd(11)} ${r.role.padEnd(8)} ${r.oldModel} → ${r.newModel}`);
    }
    console.log('');
  }
  console.log(`${updated} agents updated. Restart OpenCode for changes to take effect.`);
}

main();
