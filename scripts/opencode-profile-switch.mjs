#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { updateAgentModel } from './frontmatter-utils.mjs';
import { getUserHome } from './install-surface-utils.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

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
      const marker = name === profilesConfig.activeProfile ? ' [active]' : '';
      console.log(`  ${name}${marker}`);
      console.log(`    small:  ${profile.small}`);
      console.log(`    big:    ${profile.big}`);
      console.log(`    review: ${profile.review}`);
    }
    process.exit(0);
  }

  if (args[0] === '--current') {
    console.log(`Active profile: ${profilesConfig.activeProfile}`);
    const profile = availableProfiles[profilesConfig.activeProfile];
    if (profile) {
      console.log(`  small:  ${profile.small}`);
      console.log(`  big:    ${profile.big}`);
      console.log(`  review: ${profile.review}`);
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
    const result = updateAgentModel(agentPath, profile, agentRoles);
    if (result) {
      results.push(result);
      updated += 1;
    }
  }

  profilesConfig.activeProfile = targetProfile;
  fs.writeFileSync(profilesPath, `${JSON.stringify(profilesConfig, null, 2)}\n`, 'utf8');

  console.log(`Switched to profile: ${targetProfile}`);
  console.log('');
  for (const r of results) {
    console.log(`  ${r.agent.padEnd(12)} ${r.role.padEnd(8)} ${r.oldModel} → ${r.newModel}`);
  }
  console.log('');
  console.log(`${updated} agents updated. Restart OpenCode for changes to take effect.`);
}

main();
