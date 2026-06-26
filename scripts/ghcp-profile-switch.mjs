#!/usr/bin/env node

/**
 * ghcp-profile-switch.mjs — Switch the active profile for ghcp harness.
 *
 * Usage:
 *   node scripts/ghcp-profile-switch.mjs <profile>
 *   node scripts/ghcp-profile-switch.mjs --list
 *   node scripts/ghcp-profile-switch.mjs --current
 *
 * Reads ghcp-assets/profiles.json, persists the active profile, and
 * prints the corresponding COPILOT_PROVIDER_* env vars for the user
 * or wrapper script to apply.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const profilesPath = path.join(repoRoot, 'ghcp-assets', 'profiles.json');

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log('Usage: node scripts/ghcp-profile-switch.mjs <profile>');
    console.log('');
    console.log('Commands:');
    console.log('  node scripts/ghcp-profile-switch.mjs <profile>   Switch to the named profile');
    console.log('  node scripts/ghcp-profile-switch.mjs --list       List available profiles');
    console.log('  node scripts/ghcp-profile-switch.mjs --current    Show active profile');
    console.log('');
    console.log('Profiles are defined in ghcp-assets/profiles.json');
    process.exit(0);
  }

  if (!fs.existsSync(profilesPath)) {
    console.error(`Profiles config not found: ${profilesPath}`);
    process.exit(1);
  }

  const profilesConfig = JSON.parse(fs.readFileSync(profilesPath, 'utf8'));
  const availableProfiles = profilesConfig.profiles || {};

  if (args[0] === '--list') {
    console.log('Available profiles:');
    for (const [name, profile] of Object.entries(availableProfiles)) {
      const marker = name === profilesConfig.activeProfile ? ' [active]' : '';
      console.log(`  ${name}${marker} — ${profile.label || name}`);
      if (profile.description) console.log(`    ${profile.description}`);
      if (Array.isArray(profile.tags) && profile.tags.length > 0) {
        console.log(`    tags: ${profile.tags.join(', ')}`);
      }
      if (profile.provider) {
        console.log(`    provider: ${profile.provider.type || 'openai'} → ${profile.provider.baseUrl || 'default'}`);
      }
      if (profile.roleModels && typeof profile.roleModels === 'object') {
        console.log('    roleModels:');
        for (const [role, model] of Object.entries(profile.roleModels)) {
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
      console.log(`  label: ${profile.label || profilesConfig.activeProfile}`);
      if (profile.provider) {
        console.log(`  provider: ${profile.provider.type || 'openai'} → ${profile.provider.baseUrl || 'default'}`);
        console.log(`  apiKeyEnv: ${profile.provider.apiKeyEnv || 'none'}`);
      }
      if (profile.roleModels && typeof profile.roleModels === 'object') {
        console.log('  roleModels:');
        for (const [role, model] of Object.entries(profile.roleModels)) {
          console.log(`    ${role.padEnd(16)} ${model || '-'}`);
        }
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

  // Persist active profile
  profilesConfig.activeProfile = targetProfile;
  fs.writeFileSync(profilesPath, `${JSON.stringify(profilesConfig, null, 2)}\n`, 'utf8');

  console.log(`Switched to profile: ${targetProfile}`);
  console.log('');

  // Print env vars the wrapper or user should set
  const provider = profile.provider || {};
  console.log('Environment variables for this profile:');
  console.log(`  export COPILOT_PROVIDER_TYPE="${provider.type || 'openai'}"`);
  if (provider.baseUrl) console.log(`  export COPILOT_PROVIDER_BASE_URL="${provider.baseUrl}"`);
  if (provider.apiKeyEnv) console.log(`  export COPILOT_PROVIDER_API_KEY="\$${provider.apiKeyEnv}"`);
  if (profile.roleModels && profile.roleModels.implementation) {
    console.log(`  export COPILOT_MODEL="${profile.roleModels.implementation}"`);
  }
  console.log('');
  console.log('Models by role:');
  if (profile.roleModels) {
    for (const [role, model] of Object.entries(profile.roleModels)) {
      console.log(`  ${role.padEnd(16)} ${model}`);
    }
  }
  console.log('');
  console.log('The ghcp wrapper script applies these automatically when invoking lanes.');
}

main();
