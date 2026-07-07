'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  defaultModelProfile: 'opencode-zen-free',
  roleProfiles: {},
  rolePolicies: {},
  writeEnabled: false,
  allowPaidModels: false,
  profilesPath: null,
  journalPath: null,
  timeoutSeconds: 900,
});

const PLUGIN_NAME = 'elegy-opencode-workers';
const REQUIRED_PLUGIN_FILES = Object.freeze([
  path.join('.codex-plugin', 'plugin.json'),
  path.join('bin', 'elegy-opencode-workers'),
  path.join('skills', 'opencode-worker-delegation', 'SKILL.md'),
]);

function resolveConfigPath(options = {}) {
  return path.resolve(
    options.env?.ELEGY_OPENCODE_WORKERS_CONFIG
      || process.env.ELEGY_OPENCODE_WORKERS_CONFIG
      || path.join(os.homedir(), '.elegy', 'opencode-workers', 'config.json'),
  );
}

function resolveJournalPath(options = {}, config = null) {
  return path.resolve(
    options.env?.ELEGY_OPENCODE_WORKERS_JOURNAL
      || process.env.ELEGY_OPENCODE_WORKERS_JOURNAL
      || config?.journalPath
      || (options.repoPath ? path.join(options.repoPath, '.opencode-workers', 'jobs.jsonl') : '')
      || path.join(os.homedir(), '.elegy', 'opencode-workers', 'jobs.jsonl'),
  );
}

function isPaidProfile(profile = {}) {
  const tags = Array.isArray(profile.tags) ? profile.tags.map((tag) => String(tag).toLowerCase()) : [];
  const roleModels = Object.values(profile.roleModels || {}).map((model) => String(model).toLowerCase());
  return tags.includes('direct') || tags.includes('paid') || tags.includes('mixed') || roleModels.some((model) => !model.includes('-free'));
}

function isAllowedProfile(profileId, profileCatalog = {}, allowPaidModels = false) {
  const id = String(profileId || '').trim();
  if (!id) return false;
  const profile = profileCatalog.profiles?.[id];
  if (!profile) return false;
  return allowPaidModels || !isPaidProfile(profile);
}

function normalizeRoleProfiles(input = {}, profileCatalog = {}, allowPaidModels = false) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  return Object.fromEntries(Object.entries(input)
    .filter(([role, profile]) => String(role || '').trim() && isAllowedProfile(profile, profileCatalog, allowPaidModels))
    .map(([role, profile]) => [String(role).trim(), String(profile).trim()]));
}

function normalizeRolePolicies(input = {}, legacyRoleProfiles = {}, profileCatalog = {}, allowPaidModels = false, writeEnabled = false) {
  const next = {};
  for (const [role, profile] of Object.entries(legacyRoleProfiles)) {
    next[role] = { profile, writeEnabled: false };
  }
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    for (const [rawRole, rawPolicy] of Object.entries(input)) {
      const role = String(rawRole || '').trim();
      if (!role || !rawPolicy || typeof rawPolicy !== 'object' || Array.isArray(rawPolicy)) continue;
      const profile = isAllowedProfile(rawPolicy.profile, profileCatalog, allowPaidModels)
        ? String(rawPolicy.profile).trim()
        : next[role]?.profile;
      next[role] = {
        ...(next[role] || {}),
        ...(profile ? { profile } : {}),
        writeEnabled: writeEnabled && rawPolicy.writeEnabled === true,
      };
    }
  }
  return Object.fromEntries(Object.entries(next)
    .filter(([role, policy]) => role && (policy.profile || policy.writeEnabled))
    .map(([role, policy]) => [role, {
      ...(policy.profile ? { profile: policy.profile } : {}),
      writeEnabled: writeEnabled && policy.writeEnabled === true,
    }]));
}

function normalizeConfig(input = {}, profileCatalog = { profiles: {} }) {
  const timeoutSeconds = Number(input.timeoutSeconds);
  const allowPaidModels = typeof input.allowPaidModels === 'boolean' ? input.allowPaidModels : DEFAULT_CONFIG.allowPaidModels;
  const writeEnabled = input.writeEnabled === true;
  const defaultModelProfile = isAllowedProfile(input.defaultModelProfile, profileCatalog, allowPaidModels)
    ? String(input.defaultModelProfile).trim()
    : DEFAULT_CONFIG.defaultModelProfile;
  const roleProfiles = normalizeRoleProfiles(input.roleProfiles, profileCatalog, allowPaidModels);
  const rolePolicies = normalizeRolePolicies(input.rolePolicies, roleProfiles, profileCatalog, allowPaidModels, writeEnabled);
  return {
    enabled: typeof input.enabled === 'boolean' ? input.enabled : DEFAULT_CONFIG.enabled,
    defaultModelProfile,
    roleProfiles: Object.fromEntries(Object.entries(rolePolicies)
      .filter(([, policy]) => policy.profile)
      .map(([role, policy]) => [role, policy.profile])),
    rolePolicies,
    writeEnabled,
    allowPaidModels,
    profilesPath: typeof input.profilesPath === 'string' && input.profilesPath.trim() ? input.profilesPath.trim() : null,
    journalPath: typeof input.journalPath === 'string' && input.journalPath.trim() ? input.journalPath.trim() : null,
    timeoutSeconds: Number.isFinite(timeoutSeconds) && timeoutSeconds > 0
      ? Math.trunc(timeoutSeconds)
      : DEFAULT_CONFIG.timeoutSeconds,
  };
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function readProfileCatalog(options = {}, rawConfig = {}) {
  const profileCatalogPath = rawConfig.profilesPath
    || path.join(path.resolve(options.engineRoot || process.cwd()), 'opencode-assets', 'profiles.json');
  return {
    profileCatalogPath,
    profileCatalog: readJson(profileCatalogPath, { profiles: {} }),
  };
}

function collectRoles(profileCatalog = {}) {
  const roles = new Set(['exploration', 'research', 'review', 'validation', 'implementation']);
  for (const profile of Object.values(profileCatalog.profiles || {})) {
    Object.keys(profile.roleModels || {}).forEach((role) => roles.add(role));
  }
  return Array.from(roles).sort();
}

function buildRoleModelMatrix(profileCatalog = {}) {
  const matrix = {};
  for (const role of collectRoles(profileCatalog)) {
    matrix[role] = {};
    for (const [profileId, profile] of Object.entries(profileCatalog.profiles || {})) {
      matrix[role][profileId] = profile.roleModels?.[role] || null;
    }
  }
  return matrix;
}

function buildEffectiveRoleProfiles(config, profileCatalog = {}) {
  const effective = {};
  for (const role of collectRoles(profileCatalog)) {
    effective[role] = config.rolePolicies[role]?.profile || config.defaultModelProfile;
  }
  return effective;
}

function buildEffectiveRolePolicies(config, profileCatalog = {}) {
  const policies = {};
  for (const role of collectRoles(profileCatalog)) {
    const profile = config.rolePolicies[role]?.profile || config.defaultModelProfile;
    const roleWriteEnabled = config.writeEnabled && config.rolePolicies[role]?.writeEnabled === true;
    policies[role] = {
      profile,
      writeEnabled: roleWriteEnabled,
      mode: roleWriteEnabled ? 'read-write' : 'read-only',
    };
  }
  return policies;
}

function getStatus(options = {}) {
  const configPath = resolveConfigPath(options);
  const rawConfig = readJson(configPath, DEFAULT_CONFIG);
  const { profileCatalogPath, profileCatalog } = readProfileCatalog(options, rawConfig);
  const config = normalizeConfig(rawConfig, profileCatalog);
  const journalPath = resolveJournalPath(options, config);
  const effectiveRoleProfiles = buildEffectiveRoleProfiles(config, profileCatalog);
  const effectiveRolePolicies = buildEffectiveRolePolicies(config, profileCatalog);
  const roleModelMatrix = buildRoleModelMatrix(profileCatalog);
  return {
    installed: detectInstalled(options),
    enabled: config.enabled,
    configPath,
    journalPath,
    journalScope: options.repoPath ? 'cwd' : 'global',
    profileCatalogPath,
    config,
    roles: collectRoles(profileCatalog),
    effectiveRoleProfiles,
    effectiveRolePolicies,
    roleModelMatrix,
    profiles: Object.entries(profileCatalog.profiles || {}).map(([id, profile]) => ({
      id,
      label: profile.label || id,
      description: profile.description || '',
      tags: Array.isArray(profile.tags) ? profile.tags : [],
      roleModels: profile.roleModels || {},
      paid: isPaidProfile(profile),
    })),
  };
}

function detectInstalled(options = {}) {
  const codexHome = options.codexHome || path.join(os.homedir(), '.codex');
  const candidates = [
    path.join(codexHome, 'plugins', PLUGIN_NAME),
    path.join(codexHome, 'marketplaces', 'elegy', 'plugins', PLUGIN_NAME),
  ];
  return candidates.some((candidate) => pluginProjectionReady(candidate));
}

function pluginProjectionReady(pluginRoot) {
  return REQUIRED_PLUGIN_FILES.every((relativePath) => {
    try {
      return fs.existsSync(path.join(pluginRoot, relativePath));
    } catch {
      return false;
    }
  });
}

function resolveElegyRoot(options = {}) {
  if (options.elegyRoot) return path.resolve(options.elegyRoot);
  if (options.env?.ELEGY_REPO) return path.resolve(options.env.ELEGY_REPO);
  const engineRoot = path.resolve(options.engineRoot || process.cwd());
  return path.resolve(engineRoot, '..', 'Elegy');
}

function runPackaging(args, options = {}) {
  const elegyRoot = resolveElegyRoot(options);
  const command = options.env?.ELEGY_PLUGIN_PACKAGING || process.env.ELEGY_PLUGIN_PACKAGING || 'cargo';
  const fullArgs = command === 'cargo'
    ? ['run', '-p', 'elegy-tooling', '--bin', 'elegy-plugin-packaging', '--', ...args]
    : args;
  let result;
  try {
    const shell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(command);
    result = childProcess.spawnSync(command, fullArgs, {
      cwd: elegyRoot,
      encoding: 'utf8',
      env: { ...process.env, ...(options.env || {}) },
      shell,
      timeout: 120_000,
      windowsHide: true,
    });
  } catch (error) {
    return {
      ok: false,
      status: null,
      command,
      args: fullArgs,
      cwd: elegyRoot,
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
      error: 'Elegy plugin packaging could not be launched.',
    };
  }
  return {
    ok: result.status === 0,
    status: result.status,
    command,
    args: fullArgs,
    cwd: elegyRoot,
    stdout: String(result.stdout || '').slice(-4000),
    stderr: String(result.stderr || result.error?.message || '').slice(-4000),
    error: result.status === 0 ? null : classifyPackagingFailure(result),
  };
}

function classifyPackagingFailure(result) {
  const text = `${result.stderr || ''}\n${result.stdout || ''}\n${result.error?.message || ''}`;
  if (/missing the public checksum artifact|checksum HTTP 404|checksum download failed/i.test(text)) {
    return 'OpenCode Workers public checksum artifact is missing or unreachable.';
  }
  if (/missing the public plugin artifact|Download failed: HTTP 404|artifact download failed/i.test(text)) {
    return 'OpenCode Workers public plugin artifact is missing or unreachable.';
  }
  if (/could not find `Cargo\.toml`|no such file|cannot find/i.test(text)) {
    return 'Elegy repository or plugin-packaging tooling could not be resolved.';
  }
  if (/Codex export is missing|missing bundled|projection/i.test(text)) {
    return 'Codex plugin projection is missing required files.';
  }
  return 'Elegy plugin packaging failed.';
}

function validateInstalledProjection(codexHome) {
  const pluginRoot = path.join(codexHome, 'marketplaces', 'elegy', 'plugins', PLUGIN_NAME);
  const missing = REQUIRED_PLUGIN_FILES
    .map((relativePath) => ({ relativePath, absolutePath: path.join(pluginRoot, relativePath) }))
    .filter((entry) => !fs.existsSync(entry.absolutePath));
  return {
    ok: missing.length === 0,
    pluginRoot,
    missing: missing.map((entry) => entry.relativePath.replace(/\\/g, '/')),
  };
}

function installPlugin(options = {}) {
  const codexHome = options.codexHome || path.join(os.homedir(), '.codex');
  const output = path.join(codexHome, 'marketplaces', 'elegy');
  const result = runPackaging([
    'marketplace',
    'export-codex',
    '--source',
    resolveElegyRoot(options),
    '--plugin',
    PLUGIN_NAME,
    '--output',
    output,
    '--overwrite',
  ], options);
  const projection = result.ok
    ? validateInstalledProjection(codexHome)
    : { ok: false, pluginRoot: path.join(output, 'plugins', PLUGIN_NAME), missing: [] };
  const ok = result.ok && projection.ok;
  return {
    ok,
    action: 'install',
    output,
    result,
    error: ok ? null : (result.error || `Codex plugin projection is missing required files: ${projection.missing.join(', ')}`),
    projection,
    status: getStatus(options),
  };
}

function removePlugin(options = {}) {
  const codexHome = options.codexHome || path.join(os.homedir(), '.codex');
  const targets = [
    path.join(codexHome, 'plugins', PLUGIN_NAME),
    path.join(codexHome, 'marketplaces', 'elegy', 'plugins', PLUGIN_NAME),
  ];
  const removed = [];
  for (const target of targets) {
    try {
      if (fs.existsSync(target)) {
        fs.rmSync(target, { recursive: true, force: true });
        removed.push(target);
      }
    } catch {
      // report best effort below
    }
  }
  return {
    ok: true,
    action: 'remove',
    removed,
    status: getStatus(options),
  };
}

function saveConfig(configPatch = {}, options = {}) {
  const configPath = resolveConfigPath(options);
  const rawCurrent = readJson(configPath, DEFAULT_CONFIG);
  const { profileCatalog } = readProfileCatalog(options, { ...rawCurrent, ...configPatch });
  const current = normalizeConfig(rawCurrent, profileCatalog);
  const next = normalizeConfig({ ...current, ...configPatch }, profileCatalog);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return getStatus(options);
}

function readJournal(options = {}) {
  const status = getStatus(options);
  try {
    if (!fs.existsSync(status.journalPath)) return [];
    return fs.readFileSync(status.journalPath, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        try {
          const record = JSON.parse(line);
          return record.entry || record;
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function countRows(map) {
  return Array.from(map.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function buildUsage(options = {}) {
  const status = getStatus(options);
  const byModel = new Map();
  const byRole = new Map();
  const summary = {
    runs: 0,
    completed: 0,
    failed: 0,
    policyViolations: 0,
    permissionDenials: 0,
    tokens: 0,
    cost: 0,
    permissionRequests: 0,
    writeAttempts: 0,
    changedFiles: 0,
    dirtyGitStates: 0,
  };
  const jobs = [];
  const permissionEvidence = [];
  for (const record of readJournal(options)) {
    const result = record.result || null;
    if (!result?.job) continue;
    const job = result.job;
    jobs.push(job);
    summary.runs += 1;
    if (job.state === 'completed') summary.completed += 1;
    if (job.state === 'failed') summary.failed += 1;
    if (job.state === 'policy_violation') summary.policyViolations += 1;
    const permissionRequests = Array.isArray(result.permissionRequests) ? result.permissionRequests : [];
    const permissionRequestCount = Number(result.permissionRequestCount ?? permissionRequests.length ?? 0);
    summary.permissionRequests += Number.isFinite(permissionRequestCount) ? permissionRequestCount : 0;
    summary.permissionDenials += permissionRequests.filter((request) => {
      const decision = String(request?.decision || request?.status || '').toLowerCase();
      return decision === 'denied' || decision === 'rejected';
    }).length;
    if (permissionRequests.length > 0 || permissionRequestCount > 0) {
      permissionEvidence.push({
        jobId: job.id || null,
        role: job.role || 'unknown',
        permissionRequestCount: Number.isFinite(permissionRequestCount) ? permissionRequestCount : permissionRequests.length,
        permissionRequests,
      });
    }
    const writeEvidence = result.writeEvidence || result.evidence?.write || {};
    const changedFiles = Array.isArray(writeEvidence.changedFiles)
      ? writeEvidence.changedFiles
      : Array.isArray(result.changedFiles)
        ? result.changedFiles
        : [];
    if (job.mode === 'read-write' || writeEvidence.attempted === true || changedFiles.length > 0) summary.writeAttempts += 1;
    summary.changedFiles += changedFiles.length;
    if (writeEvidence.gitDirty === true || result.gitDirty === true || result.evidence?.git?.dirty === true) summary.dirtyGitStates += 1;
    byModel.set(job.model || 'unknown', (byModel.get(job.model || 'unknown') || 0) + 1);
    byRole.set(job.role || 'unknown', (byRole.get(job.role || 'unknown') || 0) + 1);
    const usage = result.evidence?.usage || {};
    summary.tokens += Number(usage.used || usage.totalTokens || usage.total_tokens || 0);
    summary.cost += Number(usage.cost?.amount || 0);
  }
  return {
    generatedAt: new Date().toISOString(),
    source: { kind: 'opencode-workers-journal', path: status.journalPath },
    journalScope: status.journalScope,
    summary,
    byModel: countRows(byModel),
    byRole: countRows(byRole),
    permissionEvidence: permissionEvidence.slice(-20).reverse(),
    recentJobs: jobs.slice(-20).reverse(),
  };
}

function listJobs(options = {}) {
  return {
    source: { path: getStatus(options).journalPath },
    jobs: buildUsage(options).recentJobs,
  };
}

module.exports = {
  DEFAULT_CONFIG,
  getStatus,
  saveConfig,
  installPlugin,
  removePlugin,
  listJobs,
  buildUsage,
};
