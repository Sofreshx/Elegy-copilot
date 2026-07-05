'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  defaultModelProfile: 'opencode-zen-free',
  roleProfiles: {},
  allowPaidModels: false,
  profilesPath: null,
  journalPath: null,
  timeoutSeconds: 900,
});

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
      || path.join(os.homedir(), '.elegy', 'opencode-workers', 'jobs.jsonl'),
  );
}

function normalizeConfig(input = {}) {
  const roleProfiles = input.roleProfiles && typeof input.roleProfiles === 'object' && !Array.isArray(input.roleProfiles)
    ? Object.fromEntries(Object.entries(input.roleProfiles)
      .filter(([role, profile]) => String(role || '').trim() && String(profile || '').trim())
      .map(([role, profile]) => [String(role).trim(), String(profile).trim()]))
    : {};
  const timeoutSeconds = Number(input.timeoutSeconds);
  return {
    enabled: typeof input.enabled === 'boolean' ? input.enabled : DEFAULT_CONFIG.enabled,
    defaultModelProfile: String(input.defaultModelProfile || DEFAULT_CONFIG.defaultModelProfile).trim() || DEFAULT_CONFIG.defaultModelProfile,
    roleProfiles,
    allowPaidModels: typeof input.allowPaidModels === 'boolean' ? input.allowPaidModels : DEFAULT_CONFIG.allowPaidModels,
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

function getStatus(options = {}) {
  const configPath = resolveConfigPath(options);
  const config = normalizeConfig(readJson(configPath, DEFAULT_CONFIG));
  const journalPath = resolveJournalPath(options, config);
  const profileCatalogPath = config.profilesPath
    || path.join(path.resolve(options.engineRoot || process.cwd()), 'opencode-assets', 'profiles.json');
  const profileCatalog = readJson(profileCatalogPath, { profiles: {} });
  return {
    installed: detectInstalled(options),
    enabled: config.enabled,
    configPath,
    journalPath,
    profileCatalogPath,
    config,
    profiles: Object.entries(profileCatalog.profiles || {}).map(([id, profile]) => ({
      id,
      label: profile.label || id,
      description: profile.description || '',
      tags: Array.isArray(profile.tags) ? profile.tags : [],
      roleModels: profile.roleModels || {},
    })),
  };
}

function detectInstalled(options = {}) {
  const codexHome = options.codexHome || path.join(os.homedir(), '.codex');
  const candidates = [
    path.join(codexHome, 'plugins', 'elegy-opencode-workers'),
    path.join(codexHome, 'marketplaces', 'elegy', 'plugins', 'elegy-opencode-workers'),
  ];
  return candidates.some((candidate) => {
    try {
      return fs.existsSync(candidate);
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
  const result = childProcess.spawnSync(command, fullArgs, {
    cwd: elegyRoot,
    encoding: 'utf8',
    timeout: 120_000,
    windowsHide: true,
  });
  return {
    ok: result.status === 0,
    status: result.status,
    command,
    args: fullArgs,
    cwd: elegyRoot,
    stdout: String(result.stdout || '').slice(-4000),
    stderr: String(result.stderr || result.error?.message || '').slice(-4000),
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
    '--output',
    output,
  ], options);
  return {
    ok: result.ok,
    action: 'install',
    output,
    result,
    status: getStatus(options),
  };
}

function removePlugin(options = {}) {
  const codexHome = options.codexHome || path.join(os.homedir(), '.codex');
  const targets = [
    path.join(codexHome, 'plugins', 'elegy-opencode-workers'),
    path.join(codexHome, 'marketplaces', 'elegy', 'plugins', 'elegy-opencode-workers'),
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
  const current = normalizeConfig(readJson(configPath, DEFAULT_CONFIG));
  const next = normalizeConfig({ ...current, ...configPatch });
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
  };
  const jobs = [];
  for (const record of readJournal(options)) {
    const result = record.result || null;
    if (!result?.job) continue;
    const job = result.job;
    jobs.push(job);
    summary.runs += 1;
    if (job.state === 'completed') summary.completed += 1;
    if (job.state === 'failed') summary.failed += 1;
    if (job.state === 'policy_violation') summary.policyViolations += 1;
    summary.permissionDenials += Array.isArray(result.permissionRequests) ? result.permissionRequests.length : 0;
    byModel.set(job.model || 'unknown', (byModel.get(job.model || 'unknown') || 0) + 1);
    byRole.set(job.role || 'unknown', (byRole.get(job.role || 'unknown') || 0) + 1);
    const usage = result.evidence?.usage || {};
    summary.tokens += Number(usage.used || usage.totalTokens || usage.total_tokens || 0);
    summary.cost += Number(usage.cost?.amount || 0);
  }
  return {
    generatedAt: new Date().toISOString(),
    source: { kind: 'opencode-workers-journal', path: status.journalPath },
    summary,
    byModel: countRows(byModel),
    byRole: countRows(byRole),
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
