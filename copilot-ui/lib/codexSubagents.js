'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const toml = require('toml');

const SETTINGS_FILE = '.elegy-copilot-codex-subagents.json';
const MANAGED_INVENTORY_FILE = '.elegy-copilot-codex-managed.json';
const CONFIG_FILE = 'config.toml';
const DEFAULT_SETTINGS = {
  routingMode: 'manual',
  maxThreads: 3,
  maxDepth: 1,
  jobMaxRuntimeSeconds: 1800,
  telemetryRetentionDays: 90,
};
const EDITABLE_AGENT_FIELDS = new Set([
  'model',
  'model_reasoning_effort',
  'sandbox_mode',
  'description',
  'developer_instructions',
]);
const BASELINE_SUBAGENT_MODEL = 'gpt-5.6-luna';
const BASELINE_SUBAGENT_EFFORTS = new Set(['low', 'medium', 'high', 'max']);

function shaText(text) {
  return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex');
}

function normalizeSlash(value) {
  return String(value || '').replace(/\\/g, '/');
}

function resolveCodexHome(explicit) {
  return path.resolve(explicit || process.env.CODEX_HOME || path.join(os.homedir(), '.codex'));
}

function repoRootFromOption(engineRoot) {
  return path.resolve(engineRoot || path.join(__dirname, '..', '..'));
}

function readJsonIfExists(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function readTextIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function normalizeText(text) {
  return String(text || '').replace(/\r\n/g, '\n');
}

function ensureTrailingNewline(text) {
  return String(text || '').endsWith('\n') ? String(text || '') : `${String(text || '')}\n`;
}

function asBoundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function normalizeSettingsShape(settings) {
  return {
    routingMode: typeof settings.routingMode === 'string' ? settings.routingMode : DEFAULT_SETTINGS.routingMode,
    maxThreads: asBoundedInteger(settings.maxThreads, DEFAULT_SETTINGS.maxThreads, 1, 8),
    maxDepth: asBoundedInteger(settings.maxDepth, DEFAULT_SETTINGS.maxDepth, 0, 2),
    jobMaxRuntimeSeconds: asBoundedInteger(settings.jobMaxRuntimeSeconds, DEFAULT_SETTINGS.jobMaxRuntimeSeconds, 60, 86400),
    telemetryRetentionDays: asBoundedInteger(settings.telemetryRetentionDays, DEFAULT_SETTINGS.telemetryRetentionDays, 1, 3650),
  };
}

function safeAgentFileName(name) {
  const normalized = String(name || '').trim();
  if (!/^[A-Za-z0-9_-]+$/.test(normalized)) {
    throw Object.assign(new Error('Agent name must use letters, numbers, hyphen, or underscore only'), { statusCode: 400 });
  }
  return `${normalized}.toml`;
}

function safeResolveAgentPath(agentsDir, name) {
  const base = path.resolve(agentsDir);
  const filePath = path.resolve(base, safeAgentFileName(name));
  const prefix = base.endsWith(path.sep) ? base : `${base}${path.sep}`;
  if (!filePath.startsWith(prefix)) {
    throw Object.assign(new Error('Agent path escapes agents directory'), { statusCode: 400 });
  }
  return filePath;
}

function parseAgentToml(content, filePath = '') {
  try {
    return toml.parse(String(content || ''));
  } catch (error) {
    return {
      name: path.basename(filePath || 'unknown.toml', '.toml'),
      description: 'Invalid TOML',
      _parseError: error.message,
    };
  }
}

function isTableHeaderLine(line) {
  return /^\s*\[\[?[^\]]+\]?\]\s*(?:#.*)?$/.test(String(line || '').trim());
}

function isAgentsTableHeader(line) {
  return /^\s*\[agents\]\s*(?:#.*)?$/.test(String(line || '').trim());
}

function upsertKeyLine(lines, key, line) {
  const pattern = new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=`);
  const index = lines.findIndex((candidate) => pattern.test(String(candidate || '')));
  if (index >= 0) {
    const next = [...lines];
    next[index] = line;
    return next;
  }
  return [...lines, line];
}

function patchNativeAgentsConfigText(originalText, settings) {
  const values = normalizeSettingsShape(settings);
  const normalized = normalizeText(originalText).trimEnd();
  const lines = normalized ? normalized.split('\n') : [];
  const headerIndex = lines.findIndex((line) => isAgentsTableHeader(line));
  const managedLines = [
    `max_threads = ${values.maxThreads}`,
    `max_depth = ${values.maxDepth}`,
    `job_max_runtime_seconds = ${values.jobMaxRuntimeSeconds}`,
  ];

  let patched;
  if (headerIndex === -1) {
    patched = ensureTrailingNewline([
      normalized,
      ['[agents]', ...managedLines].join('\n'),
    ].filter((section) => section.trim()).join('\n\n'));
  } else {
    let nextHeaderIndex = lines.length;
    for (let index = headerIndex + 1; index < lines.length; index += 1) {
      if (isTableHeaderLine(lines[index])) {
        nextHeaderIndex = index;
        break;
      }
    }
    let section = lines.slice(headerIndex + 1, nextHeaderIndex);
    section = upsertKeyLine(section, 'max_threads', managedLines[0]);
    section = upsertKeyLine(section, 'max_depth', managedLines[1]);
    section = upsertKeyLine(section, 'job_max_runtime_seconds', managedLines[2]);
    patched = ensureTrailingNewline([
      ...lines.slice(0, headerIndex + 1),
      ...section,
      ...lines.slice(nextHeaderIndex),
    ].join('\n').trimEnd());
  }

  try {
    toml.parse(patched.trim());
  } catch (error) {
    const validationError = new Error(`Codex config TOML validation failed after updating [agents]: ${error.message}`);
    validationError.statusCode = 422;
    throw validationError;
  }
  return patched;
}

function getNativeAgentsConfig(codexHome, settings = null) {
  const configPath = path.join(codexHome, CONFIG_FILE);
  const text = readTextIfExists(configPath) || '';
  let parsed = {};
  try {
    parsed = text.trim() ? toml.parse(text) : {};
  } catch (error) {
    return {
      path: configPath,
      parseError: error.message,
      changed: false,
      values: null,
      matchesSettings: false,
    };
  }
  const agents = parsed.agents && typeof parsed.agents === 'object' ? parsed.agents : {};
  const values = {
    maxThreads: Number.isFinite(Number(agents.max_threads)) ? Number(agents.max_threads) : null,
    maxDepth: Number.isFinite(Number(agents.max_depth)) ? Number(agents.max_depth) : null,
    jobMaxRuntimeSeconds: Number.isFinite(Number(agents.job_max_runtime_seconds)) ? Number(agents.job_max_runtime_seconds) : null,
  };
  const expected = settings ? normalizeSettingsShape(settings) : null;
  return {
    path: configPath,
    parseError: null,
    changed: false,
    values,
    matchesSettings: expected
      ? values.maxThreads === expected.maxThreads
        && values.maxDepth === expected.maxDepth
        && values.jobMaxRuntimeSeconds === expected.jobMaxRuntimeSeconds
      : null,
  };
}

function writeNativeAgentsConfig(codexHome, settings) {
  fs.mkdirSync(codexHome, { recursive: true });
  const configPath = path.join(codexHome, CONFIG_FILE);
  const existing = readTextIfExists(configPath) || '';
  const patched = patchNativeAgentsConfigText(existing, settings);
  const changed = normalizeText(existing) !== normalizeText(patched);
  if (changed) {
    fs.writeFileSync(configPath, patched, 'utf8');
  }
  return {
    ...getNativeAgentsConfig(codexHome, settings),
    changed,
  };
}

function loadManifestAgents(engineRoot) {
  const manifestPath = path.join(engineRoot, 'codex-assets', 'manifest.json');
  const manifest = readJsonIfExists(manifestPath, { assets: [] });
  const agents = new Map();
  for (const asset of Array.isArray(manifest.assets) ? manifest.assets : []) {
    if (!asset || asset.type !== 'agent' || !asset.source || !asset.destination) continue;
    const sourcePath = path.join(engineRoot, normalizeSlash(asset.source));
    const sourceText = readTextIfExists(sourcePath);
    if (sourceText == null) continue;
    const parsed = parseAgentToml(sourceText, sourcePath);
    const name = String(parsed.name || path.basename(asset.destination, '.toml'));
    agents.set(name, {
      id: asset.id || `codex-${name}-agent`,
      name,
      source: normalizeSlash(asset.source),
      destination: normalizeSlash(asset.destination),
      sourcePath,
      sourceText,
      sourceHash: shaText(sourceText),
      parsed,
    });
  }
  return agents;
}

function readInstalledAgents(agentsDir, scope) {
  const agents = [];
  if (!fs.existsSync(agentsDir)) return agents;
  for (const entry of fs.readdirSync(agentsDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || !entry.name.endsWith('.toml')) continue;
    const filePath = path.join(agentsDir, entry.name);
    const content = readTextIfExists(filePath);
    if (content == null) continue;
    const parsed = parseAgentToml(content, filePath);
    agents.push({
      name: String(parsed.name || path.basename(entry.name, '.toml')),
      fileName: entry.name,
      path: filePath,
      scope,
      content,
      contentHash: shaText(content),
      parsed,
    });
  }
  return agents;
}

function buildCapabilitySummary(parsed, usageByAgent) {
  const enforced = [];
  const configured = [];
  const inherited = [];
  const observed = [];

  if (parsed.sandbox_mode) enforced.push(`sandbox:${parsed.sandbox_mode}`);
  if (parsed.model) configured.push(`model:${parsed.model}`);
  if (parsed.model_reasoning_effort) configured.push(`reasoning:${parsed.model_reasoning_effort}`);
  if (parsed.skills && parsed.skills.config) configured.push('skills.config');
  if (parsed.mcp_servers) configured.push('mcp_servers');
  inherited.push('parent sandbox overrides');
  inherited.push('parent MCP servers may load');

  const usage = usageByAgent.get(String(parsed.name || '')) || null;
  if (usage) {
    for (const tool of usage.topTools || []) {
      observed.push(`tool:${tool.name}`);
    }
  }

  return { enforced, configured, inherited, observed };
}

function buildUsageSummary(name, usageByAgent) {
  const usage = usageByAgent.get(String(name || '')) || null;
  return {
    runs: Number(usage?.count || 0),
    tokens: Number(usage?.tokens || 0),
    toolEvents: Number(usage?.toolEvents || 0),
    errors: Number(usage?.errors || 0),
  };
}

function normalizeOperationalStatus({ managed, missing, drift, parseError, routingMode }) {
  if (parseError) return 'invalid';
  if (missing) return 'missing';
  if (String(routingMode || '').toLowerCase() === 'off') return 'disabled';
  if (drift) return 'overridden';
  if (managed) return 'ready';
  return 'unmanaged';
}

function normalizeAgentRecord(installed, source, usageByAgent) {
  const parsed = installed?.parsed || source?.parsed || {};
  const name = String(parsed.name || source?.name || installed?.name || '');
  const sourceHash = source?.sourceHash || null;
  const installedHash = installed?.contentHash || null;
  const managed = Boolean(source);
  const drift = Boolean(sourceHash && installedHash && sourceHash !== installedHash);
  const missing = Boolean(source && !installed);
  const parseError = parsed._parseError || null;
  const routingMode = parsed.elegy?.routing_mode || 'manual';
  const operationalStatus = normalizeOperationalStatus({ managed, missing, drift, parseError, routingMode });
  const usageSummary = buildUsageSummary(name, usageByAgent);

  return {
    name,
    description: String(parsed.description || ''),
    model: parsed.model || null,
    modelReasoningEffort: parsed.model_reasoning_effort || null,
    sandboxMode: parsed.sandbox_mode || null,
    nicknameCandidates: Array.isArray(parsed.nickname_candidates) ? parsed.nickname_candidates : [],
    routingMode,
    fastModel: parsed.elegy?.fast_model || null,
    allowSpark: parsed.elegy?.allow_spark === true,
    toolScopeNote: parsed.elegy?.tool_scope_note || 'MCP inheritance depends on the parent Codex session.',
    managed,
    scope: installed?.scope || (source ? 'global' : 'unknown'),
    missing,
    drift,
    operationalStatus,
    usable: operationalStatus === 'ready' || operationalStatus === 'overridden',
    parseError,
    sourcePath: source?.sourcePath || null,
    installedPath: installed?.path || null,
    sourceHash,
    installedHash,
    content: installed?.content || source?.sourceText || '',
    capabilities: buildCapabilitySummary(parsed, usageByAgent),
    usageSummary,
  };
}

function summarizeAgents(agents, projectAgents, settings, nativeConfig) {
  const rows = Array.isArray(agents) ? agents : [];
  const projectRows = Array.isArray(projectAgents) ? projectAgents : [];
  return {
    managed: rows.filter((agent) => agent.managed).length,
    installed: rows.filter((agent) => agent.managed && !agent.missing).length,
    missing: rows.filter((agent) => agent.missing).length,
    drifted: rows.filter((agent) => agent.drift).length,
    invalid: rows.filter((agent) => agent.parseError).length,
    usable: rows.filter((agent) => agent.usable).length,
    disabled: rows.filter((agent) => agent.operationalStatus === 'disabled').length,
    project: projectRows.length,
    routingMode: settings?.routingMode || DEFAULT_SETTINGS.routingMode,
    maxThreads: settings?.maxThreads ?? DEFAULT_SETTINGS.maxThreads,
    maxDepth: settings?.maxDepth ?? DEFAULT_SETTINGS.maxDepth,
    nativeConfigSynced: nativeConfig?.matchesSettings === true,
  };
}

function getSettings(codexHome) {
  const settingsPath = path.join(codexHome, SETTINGS_FILE);
  const raw = readJsonIfExists(settingsPath, {});
  return {
    ...normalizeSettingsShape({ ...DEFAULT_SETTINGS, ...raw }),
    settingsPath,
  };
}

function saveSettings(codexHome, updates) {
  fs.mkdirSync(codexHome, { recursive: true });
  const current = getSettings(codexHome);
  const next = normalizeSettingsShape({
    ...current,
    routingMode: typeof updates.routingMode === 'string' ? updates.routingMode : current.routingMode,
    maxThreads: updates.maxThreads !== undefined ? updates.maxThreads : current.maxThreads,
    maxDepth: updates.maxDepth !== undefined ? updates.maxDepth : current.maxDepth,
    jobMaxRuntimeSeconds: updates.jobMaxRuntimeSeconds !== undefined ? updates.jobMaxRuntimeSeconds : current.jobMaxRuntimeSeconds,
    telemetryRetentionDays: updates.telemetryRetentionDays !== undefined ? updates.telemetryRetentionDays : current.telemetryRetentionDays,
  });
  const settingsPath = path.join(codexHome, SETTINGS_FILE);
  const settings = { ...next, settingsPath };
  const nativeConfig = writeNativeAgentsConfig(codexHome, settings);
  fs.writeFileSync(settingsPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return {
    settings,
    nativeConfig,
  };
}

function listCodexSubagents(options = {}) {
  const codexHome = resolveCodexHome(options.codexHome);
  const agentsDir = path.join(codexHome, 'agents');
  const engineRoot = repoRootFromOption(options.engineRoot);
  const sourceAgents = loadManifestAgents(engineRoot);
  const installedAgents = readInstalledAgents(agentsDir, 'global');
  const usageByAgent = new Map();
  for (const row of options.usageByAgent || []) {
    if (row && row.name) usageByAgent.set(row.name, row);
  }

  const installedByName = new Map(installedAgents.map((agent) => [agent.name, agent]));
  const names = new Set([...sourceAgents.keys(), ...installedByName.keys()]);
  const agents = Array.from(names)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => normalizeAgentRecord(installedByName.get(name), sourceAgents.get(name), usageByAgent));

  const projectAgents = [];
  const repoPath = options.repoPath ? path.resolve(options.repoPath) : '';
  if (repoPath) {
    projectAgents.push(...readInstalledAgents(path.join(repoPath, '.codex', 'agents'), 'project')
      .map((agent) => normalizeAgentRecord(agent, null, usageByAgent)));
  }

  const settings = getSettings(codexHome);
  const nativeConfig = getNativeAgentsConfig(codexHome, settings);

  return {
    codexHome,
    agentsDir,
    inventoryPath: path.join(codexHome, MANAGED_INVENTORY_FILE),
    settings,
    nativeConfig,
    summary: summarizeAgents(agents, projectAgents, settings, nativeConfig),
    agents,
    projectAgents,
    capabilityLegend: {
      enforced: 'Codex/app setting prevents access.',
      configured: 'Agent TOML requests this behavior.',
      inherited: 'Parent Codex session may still provide this capability.',
      observed: 'Local telemetry saw this agent use it.',
    },
  };
}

function formatTomlString(value) {
  return JSON.stringify(String(value ?? ''));
}

function serializeAgentToml(agent) {
  const lines = [
    `name = ${formatTomlString(agent.name)}`,
    `description = ${formatTomlString(agent.description)}`,
  ];
  if (agent.model) lines.push(`model = ${formatTomlString(agent.model)}`);
  if (agent.model_reasoning_effort) lines.push(`model_reasoning_effort = ${formatTomlString(agent.model_reasoning_effort)}`);
  if (agent.sandbox_mode) lines.push(`sandbox_mode = ${formatTomlString(agent.sandbox_mode)}`);
  if (Array.isArray(agent.nickname_candidates) && agent.nickname_candidates.length > 0) {
    lines.push(`nickname_candidates = [${agent.nickname_candidates.map(formatTomlString).join(', ')}]`);
  }
  lines.push('');
  lines.push('[elegy]');
  lines.push('managed = true');
  lines.push(`routing_mode = ${formatTomlString(agent.elegy?.routing_mode || 'manual')}`);
  if (agent.elegy?.default_model) lines.push(`default_model = ${formatTomlString(agent.elegy.default_model)}`);
  if (agent.elegy?.fast_model) lines.push(`fast_model = ${formatTomlString(agent.elegy.fast_model)}`);
  if (typeof agent.elegy?.allow_spark === 'boolean') lines.push(`allow_spark = ${agent.elegy.allow_spark ? 'true' : 'false'}`);
  if (agent.elegy?.tool_scope_note) lines.push(`tool_scope_note = ${formatTomlString(agent.elegy.tool_scope_note)}`);
  lines.push('');
  lines.push('developer_instructions = """');
  lines.push(String(agent.developer_instructions || '').replace(/"""/g, '\\"\\"\\"').trim());
  lines.push('"""');
  lines.push('');
  return lines.join('\n');
}

function updateCodexSubagent(name, updates, options = {}) {
  const codexHome = resolveCodexHome(options.codexHome);
  const agentsDir = path.join(codexHome, 'agents');
  const engineRoot = repoRootFromOption(options.engineRoot);
  const source = loadManifestAgents(engineRoot).get(String(name || ''));
  const targetPath = safeResolveAgentPath(agentsDir, name);
  const currentText = readTextIfExists(targetPath) || source?.sourceText;
  if (!currentText) {
    throw Object.assign(new Error(`Unknown Codex subagent: ${name}`), { statusCode: 404 });
  }
  const parsed = parseAgentToml(currentText, targetPath);
  if (updates.model !== undefined && String(updates.model) !== BASELINE_SUBAGENT_MODEL) {
    throw Object.assign(new Error(`Managed Codex subagents must use ${BASELINE_SUBAGENT_MODEL}`), { statusCode: 422 });
  }
  if (updates.model_reasoning_effort !== undefined
    && !BASELINE_SUBAGENT_EFFORTS.has(String(updates.model_reasoning_effort))) {
    throw Object.assign(new Error('Managed Codex subagent effort must be low, medium, high, or max'), { statusCode: 422 });
  }
  if (updates.allowSpark === true) {
    throw Object.assign(new Error('Spark is disabled for the managed Codex subagent lane'), { statusCode: 422 });
  }
  for (const [key, value] of Object.entries(updates || {})) {
    if (EDITABLE_AGENT_FIELDS.has(key)) parsed[key] = value;
  }
  if (updates.routingMode) {
    parsed.elegy = parsed.elegy || {};
    parsed.elegy.routing_mode = String(updates.routingMode);
  }
  if (updates.allowSpark !== undefined) {
    parsed.elegy = parsed.elegy || {};
    parsed.elegy.allow_spark = updates.allowSpark === true;
  }
  fs.mkdirSync(agentsDir, { recursive: true });
  fs.writeFileSync(targetPath, serializeAgentToml(parsed), 'utf8');
  return listCodexSubagents(options);
}

function resetCodexSubagent(name, options = {}) {
  const codexHome = resolveCodexHome(options.codexHome);
  const agentsDir = path.join(codexHome, 'agents');
  const source = loadManifestAgents(repoRootFromOption(options.engineRoot)).get(String(name || ''));
  if (!source) {
    throw Object.assign(new Error(`No managed source for Codex subagent: ${name}`), { statusCode: 404 });
  }
  fs.mkdirSync(agentsDir, { recursive: true });
  fs.writeFileSync(safeResolveAgentPath(agentsDir, name), source.sourceText, 'utf8');
  return listCodexSubagents(options);
}

function uninstallCodexSubagent(name, options = {}) {
  const codexHome = resolveCodexHome(options.codexHome);
  const agentsDir = path.join(codexHome, 'agents');
  const targetPath = safeResolveAgentPath(agentsDir, name);
  const source = loadManifestAgents(repoRootFromOption(options.engineRoot)).get(String(name || ''));
  const currentText = readTextIfExists(targetPath);
  if (!currentText) return listCodexSubagents(options);
  if (source && source.sourceHash !== shaText(currentText) && options.force !== true) {
    throw Object.assign(new Error('Agent has local edits; pass force=true to uninstall'), { statusCode: 409 });
  }
  fs.unlinkSync(targetPath);
  return listCodexSubagents(options);
}

module.exports = {
  DEFAULT_SETTINGS,
  listCodexSubagents,
  saveSettings,
  updateCodexSubagent,
  resetCodexSubagent,
  uninstallCodexSubagent,
  _testing: {
    parseAgentToml,
    serializeAgentToml,
    loadManifestAgents,
    safeResolveAgentPath,
    patchNativeAgentsConfigText,
    getNativeAgentsConfig,
  },
};
