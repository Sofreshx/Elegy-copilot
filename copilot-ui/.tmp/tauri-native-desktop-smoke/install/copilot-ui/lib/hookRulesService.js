'use strict';

const fs = require('fs');
const path = require('path');

const HOOK_RULES_FILENAME = 'hook-rules.json';
const SCHEMA_VERSION = 1;

/**
 * Resolve the path to the user's hook rules config file.
 * Stored in copilotHome (~/.copilot/hook-rules.json) so it persists across sessions.
 */
function resolveHookRulesPath(copilotHome) {
  return path.join(copilotHome, HOOK_RULES_FILENAME);
}

/**
 * Load the default rule definitions shipped with the app.
 * These serve as the canonical rule catalog — user state is merged on top.
 */
function loadDefaultRules(options = {}) {
  const fsModule = options.fsModule || fs;
  const defaultsPath = options.defaultsPath || path.join(__dirname, '..', 'data', 'hook-rules.json');
  try {
    return JSON.parse(fsModule.readFileSync(defaultsPath, 'utf8'));
  } catch {
    return { schemaVersion: SCHEMA_VERSION, rules: [] };
  }
}

/**
 * Load user-specific rule overrides (just the enabled/disabled state).
 * Returns null if no user config exists yet.
 */
function loadUserOverrides(copilotHome, options = {}) {
  const fsModule = options.fsModule || fs;
  const configPath = resolveHookRulesPath(copilotHome);
  try {
    const stat = fsModule.statSync(configPath);
    if (!stat.isFile()) return null;
    return JSON.parse(fsModule.readFileSync(configPath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Save user rule overrides to disk.
 * Only persists { schemaVersion, overrides: { ruleId: boolean } } — minimal footprint.
 */
function saveUserOverrides(copilotHome, overrides, options = {}) {
  const fsModule = options.fsModule || fs;
  const configPath = resolveHookRulesPath(copilotHome);
  const data = {
    schemaVersion: SCHEMA_VERSION,
    overrides: overrides || {},
  };
  fsModule.mkdirSync(path.dirname(configPath), { recursive: true });
  const tmpPath = `${configPath}.tmp.${process.pid}`;
  fsModule.writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fsModule.renameSync(tmpPath, configPath);
}

/**
 * Get the merged rule list: defaults + user overrides applied.
 * Returns { schemaVersion, rules: [...] } where each rule has its current enabled state.
 */
function getEffectiveRules(copilotHome, options = {}) {
  const defaults = loadDefaultRules(options);
  const userConfig = loadUserOverrides(copilotHome, options);
  const overrides = (userConfig && userConfig.overrides) || {};

  const rules = (defaults.rules || []).map((rule) => ({
    ...rule,
    enabled: overrides.hasOwnProperty(rule.id) ? Boolean(overrides[rule.id]) : rule.enabled,
  }));

  return { schemaVersion: defaults.schemaVersion, rules };
}

/**
 * Toggle a single rule's enabled state. Returns the updated rule or null if not found.
 */
function toggleRule(copilotHome, ruleId, enabled, options = {}) {
  const defaults = loadDefaultRules(options);
  const rule = (defaults.rules || []).find((r) => r.id === ruleId);
  if (!rule) return null;

  const userConfig = loadUserOverrides(copilotHome, options) || { overrides: {} };
  const overrides = { ...(userConfig.overrides || {}) };
  overrides[ruleId] = Boolean(enabled);
  saveUserOverrides(copilotHome, overrides, options);

  return { ...rule, enabled: Boolean(enabled) };
}

/**
 * Batch toggle multiple rules. Returns the full updated rule list.
 */
function batchToggle(copilotHome, updates, options = {}) {
  const userConfig = loadUserOverrides(copilotHome, options) || { overrides: {} };
  const overrides = { ...(userConfig.overrides || {}) };

  for (const { id, enabled } of updates) {
    overrides[id] = Boolean(enabled);
  }

  saveUserOverrides(copilotHome, overrides, options);
  return getEffectiveRules(copilotHome, options);
}

/**
 * Get only the enabled rule IDs — used by hook scripts to decide what to enforce.
 */
function getEnabledRuleIds(copilotHome, options = {}) {
  const { rules } = getEffectiveRules(copilotHome, options);
  return rules.filter((r) => r.enabled).map((r) => r.id);
}

module.exports = {
  HOOK_RULES_FILENAME,
  SCHEMA_VERSION,
  resolveHookRulesPath,
  loadDefaultRules,
  loadUserOverrides,
  saveUserOverrides,
  getEffectiveRules,
  toggleRule,
  batchToggle,
  getEnabledRuleIds,
};
