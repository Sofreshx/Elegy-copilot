'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const childProcess = require('child_process');

const contracts = require('@elegy-copilot/contracts');

const SPEC_KIT_SOURCE_ID = 'spec-kit';
const SPEC_KIT_INSTALLABLE_ID = 'cli:specify';
const HOST_TARGET = 'host';
const INTERNAL_SPEC_DRIVEN_MARKER = 'instruction-engine:begin spec-driven';

function fallbackNormalizeExternalInstallableRecord(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value;
  const installableId = typeof record.installableId === 'string' ? record.installableId.trim() : '';
  const kind = typeof record.kind === 'string' ? record.kind.trim() : '';
  if (!installableId || !kind) {
    return null;
  }

  const normalizeList = (input) => Array.isArray(input)
    ? input.map((entry) => (typeof entry === 'string' ? entry.trim() : '')).filter(Boolean)
    : [];

  return {
    installableId,
    kind,
    name: typeof record.name === 'string' && record.name.trim() ? record.name.trim() : undefined,
    title: typeof record.title === 'string' && record.title.trim() ? record.title.trim() : undefined,
    description: typeof record.description === 'string' && record.description.trim() ? record.description.trim() : undefined,
    relativePath: typeof record.relativePath === 'string' && record.relativePath.trim() ? record.relativePath.trim() : undefined,
    sourcePath: typeof record.sourcePath === 'string' && record.sourcePath.trim() ? record.sourcePath.trim() : undefined,
    status: typeof record.status === 'string' && record.status.trim() ? record.status.trim() : undefined,
    hiddenByDefault: record.hiddenByDefault === true,
    deprecated: record.deprecated === true,
    setupHints: normalizeList(record.setupHints),
    targetSupport: normalizeList(record.targetSupport),
    installCommand: typeof record.installCommand === 'string' && record.installCommand.trim() ? record.installCommand.trim() : undefined,
    verifyCommand: typeof record.verifyCommand === 'string' && record.verifyCommand.trim() ? record.verifyCommand.trim() : undefined,
    bootstrapCommand: typeof record.bootstrapCommand === 'string' && record.bootstrapCommand.trim() ? record.bootstrapCommand.trim() : undefined,
    runtimeChecks: normalizeList(record.runtimeChecks),
    metadata: record.metadata && typeof record.metadata === 'object' && !Array.isArray(record.metadata)
      ? record.metadata
      : undefined,
  };
}

function fallbackNormalizeExternalSourceId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function fallbackNormalizeExternalSourceRecord(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value;
  const sourceId = fallbackNormalizeExternalSourceId(record.sourceId || record.id || record.repo);
  const title = typeof record.title === 'string' ? record.title.trim() : '';
  const url = typeof record.url === 'string' ? record.url.trim() : '';
  const sourceType = typeof record.sourceType === 'string' && record.sourceType.trim() ? record.sourceType.trim() : 'github-repo';
  if (!sourceId || !title || !url) {
    return null;
  }

  const normalizeList = (input) => Array.isArray(input)
    ? input.map((entry) => (typeof entry === 'string' ? entry.trim() : '')).filter(Boolean)
    : [];

  return {
    sourceId,
    title,
    description: typeof record.description === 'string' && record.description.trim() ? record.description.trim() : undefined,
    url,
    sourceType,
    owner: typeof record.owner === 'string' && record.owner.trim() ? record.owner.trim() : undefined,
    repo: typeof record.repo === 'string' && record.repo.trim() ? record.repo.trim() : undefined,
    defaultRef: typeof record.defaultRef === 'string' && record.defaultRef.trim() ? record.defaultRef.trim() : undefined,
    includeSkills: record.includeSkills !== false,
    includeMcp: record.includeMcp === true,
    preferredSkillPathPrefixes: normalizeList(record.preferredSkillPathPrefixes),
    hiddenPathPrefixes: normalizeList(record.hiddenPathPrefixes),
    deprecatedPathPrefixes: normalizeList(record.deprecatedPathPrefixes),
    mcpManifestPath: typeof record.mcpManifestPath === 'string' && record.mcpManifestPath.trim() ? record.mcpManifestPath.trim() : undefined,
    setupHints: normalizeList(record.setupHints),
    installables: Array.isArray(record.installables)
      ? record.installables.map((entry) => fallbackNormalizeExternalInstallableRecord(entry)).filter(Boolean)
      : undefined,
    metadata: record.metadata && typeof record.metadata === 'object' && !Array.isArray(record.metadata)
      ? record.metadata
      : undefined,
    editable: record.editable === true,
  };
}

function fallbackNormalizeExternalSourcesCatalogDocument(value) {
  if (!value || typeof value !== 'object') {
    return {
      schemaVersion: 1,
      sources: [],
    };
  }

  return {
    schemaVersion: Number(value.schemaVersion) || 1,
    sources: Array.isArray(value.sources)
      ? value.sources
        .map((entry) => fallbackNormalizeExternalSourceRecord(entry))
        .filter(Boolean)
      : [],
  };
}

const normalizeExternalSourceId = typeof contracts.normalizeExternalSourceId === 'function'
  ? contracts.normalizeExternalSourceId
  : fallbackNormalizeExternalSourceId;

const normalizeExternalSourcesCatalogDocument = typeof contracts.normalizeExternalSourcesCatalogDocument === 'function'
  ? contracts.normalizeExternalSourcesCatalogDocument
  : fallbackNormalizeExternalSourcesCatalogDocument;

const DEFAULT_EXTERNAL_SOURCES_CATALOG = contracts.DEFAULT_EXTERNAL_SOURCES_CATALOG
  && typeof contracts.DEFAULT_EXTERNAL_SOURCES_CATALOG === 'object'
  ? contracts.DEFAULT_EXTERNAL_SOURCES_CATALOG
  : {
    schemaVersion: 1,
    sources: [],
  };

const EXTERNAL_SOURCES_SCHEMA_VERSION = 1;
const USER_SOURCES_FILE = 'user-sources.json';
const STATE_FILE = 'state.json';
const SHIPPED_CATALOG_PATH = path.join('engine-assets', 'external-sources.json');
const CONTEXT7_DEFAULT_COMMAND = 'npx';
const CONTEXT7_DEFAULT_ARGS = ['-y', '@upstash/context7-mcp'];
const EXTERNAL_SOURCE_TARGET_ALIASES = Object.freeze({
  'antigravity-cli': 'gemini-cli',
});

const SPEC_KIT_EXPECTED_REPO_PATHS = Object.freeze([
  '.specify',
  '.github/agents',
  '.github/prompts',
  '.github/copilot-instructions.md',
  '.vscode/settings.json',
]);

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStringList(value) {
  return Array.isArray(value)
    ? value.map((entry) => normalizeString(entry)).filter(Boolean)
    : [];
}

function normalizeExternalSourceTarget(value) {
  const normalized = normalizeString(value).toLowerCase();
  return EXTERNAL_SOURCE_TARGET_ALIASES[normalized] || normalized;
}

function normalizeExternalSourceTargetList(value) {
  const normalizedTargets = Array.isArray(value) ? value : [];
  const seen = new Set();
  const result = [];
  for (const entry of normalizedTargets) {
    const normalized = normalizeExternalSourceTarget(entry);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJsonIfExists(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      return null;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeJsonAtomic(filePath, value) {
  const dirPath = path.dirname(filePath);
  ensureDir(dirPath);
  const tempPath = path.join(
    dirPath,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
  );
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2) + '\n', 'utf8');
  fs.renameSync(tempPath, filePath);
}

function safeRemove(absPath) {
  try {
    fs.rmSync(absPath, { recursive: true, force: true });
  } catch {
    // ignore cleanup failures
  }
}

function normalizeRelativePath(value) {
  const normalized = String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
    .replace(/\/+$/g, '');
  return normalized === '.' ? '' : normalized;
}

function slugifyName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function resolveCatalogRoot(copilotHome) {
  return path.join(path.resolve(copilotHome), 'catalog', 'external-sources');
}

function resolveUserSourcesPath(copilotHome) {
  return path.join(resolveCatalogRoot(copilotHome), USER_SOURCES_FILE);
}

function resolveStatePath(copilotHome) {
  return path.join(resolveCatalogRoot(copilotHome), STATE_FILE);
}

function resolveCacheRoot(copilotHome) {
  return path.join(resolveCatalogRoot(copilotHome), 'cache');
}

function parseGitHubUrl(url) {
  const raw = normalizeString(url);
  if (!raw) {
    return null;
  }

  const httpsMatch = raw.match(/^https?:\/\/github\.com\/([^/]+)\/([^/#?]+?)(?:\.git)?(?:[/?#].*)?$/i);
  if (httpsMatch) {
    return {
      owner: httpsMatch[1],
      repo: httpsMatch[2],
    };
  }

  const shortMatch = raw.match(/^github:([^/]+)\/([^/#?]+)$/i);
  if (shortMatch) {
    return {
      owner: shortMatch[1],
      repo: shortMatch[2],
    };
  }

  const slugMatch = raw.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (slugMatch) {
    return {
      owner: slugMatch[1],
      repo: slugMatch[2],
    };
  }

  return null;
}

function buildGitHubArchiveUrl(source, ref) {
  const owner = normalizeString(source.owner);
  const repo = normalizeString(source.repo);
  const resolvedRef = normalizeString(ref) || normalizeString(source.defaultRef) || 'main';
  return `https://codeload.github.com/${owner}/${repo}/tar.gz/${resolvedRef}`;
}

function readTextIfExists(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function stripJsonComments(text) {
  let out = '';
  let i = 0;
  let inString = false;
  let stringQuote = '"';
  let inLineComment = false;
  let inBlockComment = false;
  let escaped = false;

  while (i < text.length) {
    const ch = text[i];
    const next = i + 1 < text.length ? text[i + 1] : '';

    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false;
        out += ch;
      }
      i += 1;
      continue;
    }

    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }

    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === stringQuote) {
        inString = false;
      }
      i += 1;
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      stringQuote = ch;
      out += ch;
      i += 1;
      continue;
    }

    if (ch === '/' && next === '/') {
      inLineComment = true;
      i += 2;
      continue;
    }

    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i += 2;
      continue;
    }

    out += ch;
    i += 1;
  }

  return out;
}

function removeTrailingCommas(text) {
  let previous = null;
  let current = text;
  while (current !== previous) {
    previous = current;
    current = current.replace(/,\s*([}\]])/g, '$1');
  }
  return current;
}

function parseJsonc(text) {
  const stripped = stripJsonComments(String(text || ''));
  const withoutTrailingCommas = removeTrailingCommas(stripped);
  return JSON.parse(withoutTrailingCommas);
}

function readMetadataRecord(input) {
  return input && typeof input === 'object' && !Array.isArray(input) ? input : {};
}

function shellSplit(commandText) {
  const source = normalizeString(commandText);
  if (!source) {
    return [];
  }

  const tokens = [];
  let current = '';
  let quote = null;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const ch = source[index];
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }

  if (escaped) {
    current += '\\';
  }
  if (current) {
    tokens.push(current);
  }
  return tokens;
}

function formatShellCommand(command, args) {
  const values = [normalizeString(command), ...(Array.isArray(args) ? args : []).map((entry) => normalizeString(entry))]
    .filter(Boolean)
    .map((entry) => (/\s|"/.test(entry) ? `"${entry.replace(/"/g, '\\"')}"` : entry));
  return values.join(' ');
}

function resolveInstallableCommandSourcePaths(installable) {
  const metadata = readMetadataRecord(installable?.metadata);
  const candidates = [];
  for (const entry of [metadata.bridgeScriptPath, installable?.sourcePath]) {
    const normalized = normalizeRelativePath(entry);
    if (!normalized || candidates.includes(normalized)) {
      continue;
    }
    candidates.push(normalized);
  }
  return candidates;
}

function installableRequiresCachedSourceFiles(installable) {
  if (normalizeString(installable?.kind) === 'skill') {
    return true;
  }

  const sourcePaths = resolveInstallableCommandSourcePaths(installable);
  if (sourcePaths.length === 0) {
    return false;
  }

  const metadata = readMetadataRecord(installable?.metadata);
  const commandTokens = [
    ...(Array.isArray(metadata.commandTemplate)
      ? metadata.commandTemplate.map((entry) => normalizeString(entry)).filter(Boolean)
      : []),
    ...shellSplit(installable?.verifyCommand),
  ];
  return commandTokens.some((token) => sourcePaths.includes(normalizeRelativePath(token)));
}

function resolveCachedInstallableSourceFile(sourceId, installable, cached, relativePath) {
  const normalizedPath = normalizeRelativePath(relativePath);
  if (!normalizedPath) {
    return null;
  }

  const extractedRoot = cached ? resolveCachedExtractedRoot(cached.sourceCacheRoot) : null;
  const normalizedSourceId = normalizeExternalSourceId(sourceId) || 'the source';
  if (!extractedRoot) {
    throw Object.assign(new Error(`Cached source contents for ${normalizedSourceId} are unavailable. Refresh the source and try again.`), {
      statusCode: 409,
    });
  }

  const absolutePath = path.join(extractedRoot, normalizedPath);
  if (!fs.existsSync(absolutePath)) {
    throw Object.assign(new Error(`Expected ${normalizedPath} in the cached contents for ${normalizedSourceId}. Refresh the source and try again.`), {
      statusCode: 409,
    });
  }

  return absolutePath;
}

function replaceInstallableCommandSourceTokens(sourceId, installable, tokens, cached) {
  if (!Array.isArray(tokens) || tokens.length === 0) {
    return [];
  }

  const sourcePaths = resolveInstallableCommandSourcePaths(installable);
  if (sourcePaths.length === 0) {
    return [...tokens];
  }

  const replacements = new Map();
  return tokens.map((token) => {
    const matchedSourcePath = sourcePaths.find((entry) => entry === normalizeRelativePath(token));
    if (!matchedSourcePath) {
      return token;
    }

    if (!replacements.has(matchedSourcePath)) {
      replacements.set(
        matchedSourcePath,
        resolveCachedInstallableSourceFile(sourceId, installable, cached, matchedSourcePath),
      );
    }
    return replacements.get(matchedSourcePath);
  });
}

function escapeTomlBasicString(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
}

function hasCliInstallerMetadata(metadata) {
  return Boolean(
    normalizeString(metadata.preferredInstaller)
    || normalizeString(metadata.fallbackInstaller)
    || normalizeString(metadata.installer)
    || normalizeString(metadata.installCommandUv)
    || normalizeString(metadata.installCommandPipx)
    || normalizeString(metadata.reinstallCommandUv)
    || normalizeString(metadata.reinstallCommandPipx),
  );
}

function inferInstallerReinstallCommand(installer, installCommand) {
  const normalizedInstaller = normalizeString(installer).toLowerCase();
  const tokens = shellSplit(installCommand);
  if (tokens.length === 0) {
    return '';
  }

  if (normalizedInstaller === 'uv' && tokens[0] === 'uv' && tokens[1] === 'tool' && tokens[2] === 'install') {
    if (!tokens.includes('--reinstall') && !tokens.includes('--force-reinstall')) {
      tokens.splice(3, 0, '--reinstall');
    }
    return formatShellCommand(tokens[0], tokens.slice(1));
  }

  if (normalizedInstaller === 'pipx' && tokens[0] === 'pipx' && tokens[1] === 'install') {
    if (!tokens.includes('--force')) {
      tokens.splice(2, 0, '--force');
    }
    return formatShellCommand(tokens[0], tokens.slice(1));
  }

  return installCommand;
}

function resolveCliInstallCommandForInstaller(installable, metadata, installer, force) {
  const normalizedInstaller = normalizeString(installer).toLowerCase();
  const defaultInstallCommand = normalizeString(installable.installCommand);
  let installCommand = '';
  let reinstallCommand = '';

  if (normalizedInstaller === 'uv') {
    installCommand = normalizeString(metadata.installCommandUv)
      || (defaultInstallCommand.startsWith('uv ') ? defaultInstallCommand : '');
    reinstallCommand = normalizeString(metadata.reinstallCommandUv)
      || inferInstallerReinstallCommand(normalizedInstaller, installCommand)
      || installCommand;
  } else if (normalizedInstaller === 'pipx') {
    installCommand = normalizeString(metadata.installCommandPipx)
      || (defaultInstallCommand.startsWith('pipx ') ? defaultInstallCommand : '');
    reinstallCommand = normalizeString(metadata.reinstallCommandPipx)
      || inferInstallerReinstallCommand(normalizedInstaller, installCommand)
      || installCommand;
  } else {
    installCommand = defaultInstallCommand;
    reinstallCommand = defaultInstallCommand;
  }

  return {
    installer: normalizedInstaller || null,
    installCommand,
    reinstallCommand,
    commandText: force ? reinstallCommand || installCommand : installCommand,
  };
}

async function probeInstallerAvailability(command, options) {
  const normalizedCommand = normalizeString(command);
  if (!normalizedCommand) {
    return {
      ok: false,
      exitCode: 0,
      stdout: '',
      stderr: '',
      error: 'missing command',
      command: '',
      args: [],
      commandText: '',
      cwd: null,
    };
  }

  return runCommand({
    command: normalizedCommand,
    args: ['--version'],
    cwd: normalizeString(options.cwd) || process.cwd(),
    env: options.env && typeof options.env === 'object'
      ? { ...process.env, ...options.env }
      : process.env,
    commandText: formatShellCommand(normalizedCommand, ['--version']),
    timeoutMs: Number.isFinite(options.timeoutMs) ? Number(options.timeoutMs) : 10_000,
  }, options);
}

async function resolveCliInstallerSelection(installable, options) {
  const metadata = readMetadataRecord(installable.metadata);
  const defaultInstallCommand = normalizeString(installable.installCommand);
  if (!hasCliInstallerMetadata(metadata)) {
    if (!defaultInstallCommand) {
      throw Object.assign(new Error(`Installable ${installable.installableId} is missing an install command.`), { statusCode: 400 });
    }
    return {
      installer: null,
      installCommand: defaultInstallCommand,
      reinstallCommand: defaultInstallCommand,
      commandText: defaultInstallCommand,
      probeResults: [],
    };
  }

  const candidates = [];
  for (const installer of [
    normalizeString(metadata.preferredInstaller) || (normalizeString(metadata.installCommandUv) ? 'uv' : ''),
    normalizeString(metadata.fallbackInstaller) || (normalizeString(metadata.installCommandPipx) ? 'pipx' : ''),
  ]) {
    if (!installer || candidates.includes(installer)) {
      continue;
    }
    candidates.push(installer);
  }

  const candidateCommands = candidates
    .map((installer) => resolveCliInstallCommandForInstaller(installable, metadata, installer, options.force === true))
    .filter((entry) => Boolean(entry.commandText));
  if (candidateCommands.length === 0) {
    if (!defaultInstallCommand) {
      throw Object.assign(new Error(`Installable ${installable.installableId} is missing an install command.`), { statusCode: 400 });
    }
    return {
      installer: null,
      installCommand: defaultInstallCommand,
      reinstallCommand: defaultInstallCommand,
      commandText: defaultInstallCommand,
      probeResults: [],
    };
  }

  const probeResults = [];
  for (const candidate of candidateCommands) {
    const probe = await probeInstallerAvailability(candidate.installer, options);
    probeResults.push({ installer: candidate.installer, result: probe });
    if (probe.ok) {
      return {
        ...candidate,
        probeResults,
      };
    }
  }

  const installerLabels = candidateCommands.map((entry) => `\`${entry.installer}\``);
  const unavailableDetail = installerLabels.length > 1
    ? `Neither ${installerLabels.join(' nor ')} is available on PATH.`
    : `${installerLabels[0]} is not available on PATH.`;
  const retryDetail = installerLabels.length > 1
    ? `Install one of them and retry.`
    : `Install ${installerLabels[0]} and retry.`;
  throw Object.assign(new Error(`Unable to install ${resolveInstallableLabel(installable)}. ${unavailableDetail} ${retryDetail}`), {
    statusCode: 500,
    probeResults,
  });
}

function buildCommandInvocation(commandText, options = {}) {
  const metadata = readMetadataRecord(options.metadata);
  const splitTokens = shellSplit(commandText);
  let command = splitTokens[0] || '';
  let args = splitTokens.slice(1);

  const commandTemplate = Array.isArray(metadata.commandTemplate)
    ? metadata.commandTemplate.map((entry) => normalizeString(entry)).filter(Boolean)
    : [];
  if (!command && commandTemplate.length > 0) {
    command = commandTemplate[0] || '';
    args = commandTemplate.slice(1);
  }

  if (!command) {
    throw Object.assign(new Error('Command text is required'), { statusCode: 400 });
  }

  if (options.installable && typeof options.installable === 'object') {
    const resolvedTokens = replaceInstallableCommandSourceTokens(
      options.sourceId,
      options.installable,
      [command, ...args],
      options.cached,
    );
    command = resolvedTokens[0] || command;
    args = resolvedTokens.slice(1);
  }

  const env = options.env && typeof options.env === 'object'
    ? { ...process.env, ...options.env }
    : process.env;
  const cwd = normalizeString(options.cwd) || undefined;
  return {
    command,
    args,
    cwd,
    env,
    commandText: formatShellCommand(command, args),
    timeoutMs: Number.isFinite(options.timeoutMs) ? Number(options.timeoutMs) : 15_000,
  };
}

function runCommand(invocation, options = {}) {
  const childProcessImpl = options.childProcess || childProcess;
  return new Promise((resolve) => {
    childProcessImpl.execFile(
      invocation.command,
      invocation.args,
      {
        cwd: invocation.cwd,
        env: invocation.env,
        windowsHide: true,
        timeout: invocation.timeoutMs,
        maxBuffer: 1024 * 1024,
      },
      (error, stdout, stderr) => {
        const stdoutText = typeof stdout === 'string' ? stdout : String(stdout || '');
        const stderrText = typeof stderr === 'string' ? stderr : String(stderr || '');
        const exitCode = typeof error?.code === 'number' ? error.code : 0;
        resolve({
          ok: !error,
          exitCode,
          stdout: stdoutText,
          stderr: stderrText,
          error: error ? String(error.message || error) : null,
          command: invocation.command,
          args: invocation.args,
          commandText: invocation.commandText,
          cwd: invocation.cwd || null,
        });
      },
    );
  });
}

function createCheck(type, name, status, detail, extra = {}) {
  return {
    type,
    name,
    status,
    detail: normalizeString(detail) || null,
    ...extra,
  };
}

function isSuccessfulStatus(status) {
  return status === 'ok' || status === 'ready' || status === 'installed' || status === 'active';
}

function finalizeCheckCollection(checks) {
  const normalizedChecks = Array.isArray(checks) ? checks.filter(Boolean) : [];
  if (normalizedChecks.length === 0) {
    return 'unknown';
  }
  if (normalizedChecks.every((entry) => isSuccessfulStatus(normalizeString(entry.status)))) {
    return 'ready';
  }
  if (normalizedChecks.some((entry) => normalizeString(entry.status) === 'error')) {
    return 'needs-attention';
  }
  return 'partial';
}

function collectWarningsAndErrors(checks) {
  const warnings = [];
  const errors = [];
  for (const check of Array.isArray(checks) ? checks : []) {
    const status = normalizeString(check?.status);
    const detail = normalizeString(check?.detail);
    if (!detail) {
      continue;
    }
    if (status === 'warning' || status === 'partial') {
      warnings.push(detail);
    }
    if (status === 'error') {
      errors.push(detail);
    }
  }
  return { warnings, errors };
}

function describeInstallableLifecycle(installable) {
  const kind = normalizeString(installable?.kind);
  if (kind === 'cli-tool') {
    return 'cli-tool';
  }
  if (kind === 'mcp-server') {
    return 'mcp-server';
  }
  return 'skill';
}

function resolveInstallableLabel(installable) {
  return normalizeString(installable?.title || installable?.name || installable?.installableId) || 'installable';
}

function resolveInstallableStateEntry(sourceState, target, installableId) {
  const targets = sourceState && sourceState.targets && typeof sourceState.targets === 'object'
    ? sourceState.targets
    : {};
  const targetState = targets[target] && typeof targets[target] === 'object'
    ? targets[target]
    : {};
  const installables = targetState.installables && typeof targetState.installables === 'object'
    ? targetState.installables
    : {};
  return installables[installableId] && typeof installables[installableId] === 'object'
    ? installables[installableId]
    : {};
}

function cloneSourceTargets(sourceState) {
  const previousTargets = sourceState.targets && typeof sourceState.targets === 'object'
    ? sourceState.targets
    : {};
  const nextTargets = {};
  for (const [target, targetState] of Object.entries(previousTargets)) {
    const installables = targetState && typeof targetState === 'object' && targetState.installables && typeof targetState.installables === 'object'
      ? targetState.installables
      : {};
    nextTargets[target] = {
      ...(targetState && typeof targetState === 'object' ? targetState : {}),
      installables: { ...installables },
    };
  }
  return nextTargets;
}

function readInstalledPathState(absPath) {
  if (!absPath) {
    return { exists: false, isDirectory: false, isFile: false };
  }
  try {
    const stat = fs.statSync(absPath);
    return {
      exists: true,
      isDirectory: stat.isDirectory(),
      isFile: stat.isFile(),
    };
  } catch {
    return {
      exists: false,
      isDirectory: false,
      isFile: false,
    };
  }
}

function hasInternalSpecDrivenScaffold(repoPath) {
  if (!normalizeString(repoPath)) {
    return false;
  }
  const probePaths = [
    path.join(repoPath, '.github', 'copilot-instructions.md'),
    path.join(repoPath, 'AGENTS.md'),
    path.join(repoPath, 'GEMINI.md'),
  ];
  return probePaths.some((probePath) => String(readTextIfExists(probePath) || '').includes(INTERNAL_SPEC_DRIVEN_MARKER));
}

function walkFiles(dirPath) {
  const results = [];
  const stack = [dirPath];

  while (stack.length > 0) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      entries = [];
    }

    for (const entry of entries) {
      const nextPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(nextPath);
        continue;
      }
      if (entry.isFile()) {
        results.push(nextPath);
      }
    }
  }

  results.sort((left, right) => left.localeCompare(right));
  return results;
}

function copyDirectory(sourcePath, targetPath) {
  if (typeof fs.cpSync === 'function') {
    ensureDir(path.dirname(targetPath));
    fs.cpSync(sourcePath, targetPath, { recursive: true, force: true });
    return;
  }
  ensureDir(targetPath);
  for (const filePath of walkFiles(sourcePath)) {
    const relPath = path.relative(sourcePath, filePath);
    const destinationPath = path.join(targetPath, relPath);
    ensureDir(path.dirname(destinationPath));
    fs.copyFileSync(filePath, destinationPath);
  }
}

function readShippedSources(engineRoot) {
  const shippedPath = path.join(path.resolve(engineRoot), SHIPPED_CATALOG_PATH);
  const loaded = normalizeExternalSourcesCatalogDocument(readJsonIfExists(shippedPath));
  return {
    shippedPath,
    document: loaded.sources.length > 0 ? loaded : DEFAULT_EXTERNAL_SOURCES_CATALOG,
  };
}

function readUserSources(copilotHome) {
  const userSourcesPath = resolveUserSourcesPath(copilotHome);
  const loaded = normalizeExternalSourcesCatalogDocument(readJsonIfExists(userSourcesPath));
  return {
    userSourcesPath,
    document: loaded,
  };
}

function readExternalSourcesState(copilotHome) {
  const statePath = resolveStatePath(copilotHome);
  const raw = readJsonIfExists(statePath);
  return {
    statePath,
    state: raw && typeof raw === 'object'
      ? {
        schemaVersion: Number(raw.schemaVersion) || EXTERNAL_SOURCES_SCHEMA_VERSION,
        sources: raw.sources && typeof raw.sources === 'object' && !Array.isArray(raw.sources) ? raw.sources : {},
      }
      : {
        schemaVersion: EXTERNAL_SOURCES_SCHEMA_VERSION,
        sources: {},
      },
  };
}

function writeExternalSourcesState(copilotHome, state) {
  const statePath = resolveStatePath(copilotHome);
  writeJsonAtomic(statePath, state);
  return statePath;
}

function writeUserSources(copilotHome, document) {
  const userSourcesPath = resolveUserSourcesPath(copilotHome);
  writeJsonAtomic(userSourcesPath, document);
  return userSourcesPath;
}

function mergeSources(shippedDocument, userDocument) {
  const bySourceId = new Map();
  for (const entry of shippedDocument.sources) {
    bySourceId.set(entry.sourceId, { ...entry, editable: false });
  }
  for (const entry of userDocument.sources) {
    bySourceId.set(entry.sourceId, { ...entry, editable: true });
  }
  return Array.from(bySourceId.values()).sort((left, right) => String(left.sourceId || '').localeCompare(String(right.sourceId || '')));
}

function parseGitHubSourceInput(payload) {
  const url = normalizeString(payload?.url);
  const parsed = parseGitHubUrl(url);
  if (!url || !parsed) {
    throw Object.assign(new Error('A valid GitHub repository URL or owner/repo is required.'), { statusCode: 400 });
  }

  const sourceId = normalizeExternalSourceId(payload?.sourceId || payload?.title || parsed.repo);
  if (!sourceId) {
    throw Object.assign(new Error('Unable to derive a valid sourceId.'), { statusCode: 400 });
  }

  return {
    sourceId,
    title: normalizeString(payload?.title) || parsed.repo,
    description: normalizeString(payload?.description) || undefined,
    url: url.startsWith('http') ? url : `https://github.com/${parsed.owner}/${parsed.repo}`,
    sourceType: 'github-repo',
    owner: parsed.owner,
    repo: parsed.repo,
    defaultRef: normalizeString(payload?.ref || payload?.defaultRef) || 'main',
    includeSkills: payload?.includeSkills !== false,
    includeMcp: payload?.includeMcp === true,
    preferredSkillPathPrefixes: normalizeStringList(payload?.preferredSkillPathPrefixes),
    hiddenPathPrefixes: normalizeStringList(payload?.hiddenPathPrefixes),
    deprecatedPathPrefixes: normalizeStringList(payload?.deprecatedPathPrefixes),
    mcpManifestPath: normalizeString(payload?.mcpManifestPath) || undefined,
    editable: true,
  };
}

function resolveSourceStateEntry(state, sourceId) {
  return state && state.sources && typeof state.sources === 'object' ? state.sources[sourceId] || {} : {};
}

function hasEnabledTargetInstalls(sourceState) {
  const targets = sourceState && sourceState.targets && typeof sourceState.targets === 'object'
    ? sourceState.targets
    : {};
  return Object.values(targets).some((targetState) => {
    const installables = targetState && typeof targetState === 'object' && targetState.installables && typeof targetState.installables === 'object'
      ? targetState.installables
      : {};
    return Object.values(installables).some((entry) => entry && typeof entry === 'object' && entry.enabled === true);
  });
}

function normalizeFetchedInstallable(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const kind = normalizeString(entry.kind);
  const installableId = normalizeString(entry.installableId);
  if (!kind || !installableId) {
    return null;
  }

  return {
    installableId,
    kind,
    name: normalizeString(entry.name) || installableId,
    title: normalizeString(entry.title) || normalizeString(entry.name) || installableId,
    description: normalizeString(entry.description) || undefined,
    relativePath: normalizeRelativePath(entry.relativePath || ''),
    sourcePath: normalizeRelativePath(entry.sourcePath || ''),
    status: normalizeString(entry.status) || 'active',
    hiddenByDefault: entry.hiddenByDefault === true,
    deprecated: entry.deprecated === true,
    setupHints: normalizeStringList(entry.setupHints),
    installCommand: normalizeString(entry.installCommand) || undefined,
    verifyCommand: normalizeString(entry.verifyCommand) || undefined,
    bootstrapCommand: normalizeString(entry.bootstrapCommand) || undefined,
    runtimeChecks: normalizeStringList(entry.runtimeChecks),
    metadata: entry.metadata && typeof entry.metadata === 'object' && !Array.isArray(entry.metadata)
      ? entry.metadata
      : {},
    targetSupport: Array.isArray(entry.targetSupport)
      ? normalizeExternalSourceTargetList(entry.targetSupport)
      : undefined,
  };
}

function normalizeFetchedDocument(document) {
  const installables = Array.isArray(document?.installables)
    ? document.installables
      .map((entry) => normalizeFetchedInstallable(entry))
      .filter((entry) => Boolean(entry))
    : [];

  return {
    schemaVersion: Number(document?.schemaVersion) || 1,
    sourceId: normalizeString(document?.sourceId),
    source: document?.source && typeof document.source === 'object' ? document.source : {},
    fetchedAt: normalizeString(document?.fetchedAt) || new Date().toISOString(),
    resolvedRef: normalizeString(document?.resolvedRef) || undefined,
    installables,
  };
}

function deriveSkillInstallableTitle(skillText, fallbackName) {
  const firstHeading = String(skillText || '').match(/^#\s+(.+)$/m);
  return normalizeString(firstHeading?.[1]) || fallbackName;
}

function deriveSkillInstallableDescription(skillText) {
  const lines = String(skillText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith('#'));
  return normalizeString(lines[0]) || undefined;
}

function isPathUnderPrefixes(relativePath, prefixes) {
  const normalizedPath = normalizeRelativePath(relativePath).toLowerCase();
  return normalizeStringList(prefixes).some((prefix) => {
    const normalizedPrefix = normalizeRelativePath(prefix).toLowerCase();
    return normalizedPrefix && (normalizedPath === normalizedPrefix || normalizedPath.startsWith(`${normalizedPrefix}/`));
  });
}

function discoverSkillInstallables(source, extractedRoot) {
  if (source.includeSkills === false) {
    return [];
  }

  const files = walkFiles(extractedRoot);
  const preferredPrefixes = normalizeStringList(source.preferredSkillPathPrefixes);
  const hiddenPrefixes = normalizeStringList(source.hiddenPathPrefixes);
  const deprecatedPrefixes = normalizeStringList(source.deprecatedPathPrefixes);
  const installables = [];

  for (const filePath of files) {
    if (path.basename(filePath).toUpperCase() !== 'SKILL.MD') {
      continue;
    }

    const relativePath = normalizeRelativePath(path.relative(extractedRoot, filePath));
    if (preferredPrefixes.length > 0 && !isPathUnderPrefixes(relativePath, preferredPrefixes)) {
      continue;
    }

    const directoryRelativePath = normalizeRelativePath(path.dirname(relativePath));
    const skillText = readTextIfExists(filePath) || '';
    const pathSegments = directoryRelativePath.split('/').filter(Boolean);
    const fallbackName = pathSegments[pathSegments.length - 1] || path.basename(path.dirname(filePath));
    const installableSlug = slugifyName(pathSegments.join('-')) || slugifyName(fallbackName) || 'skill';
    const installableId = `skill:${installableSlug}`;

    installables.push({
      installableId,
      kind: 'skill',
      name: fallbackName,
      title: deriveSkillInstallableTitle(skillText, fallbackName),
      description: deriveSkillInstallableDescription(skillText),
      relativePath: directoryRelativePath,
      sourcePath: directoryRelativePath,
      status: 'active',
      hiddenByDefault: isPathUnderPrefixes(relativePath, hiddenPrefixes),
      deprecated: isPathUnderPrefixes(relativePath, deprecatedPrefixes),
      setupHints: fallbackName === 'setup-matt-pocock-skills'
        ? ['Run setup-matt-pocock-skills in your target harness after enabling this source.']
        : [],
      targetSupport: ['codex', 'opencode', 'antigravity'],
      metadata: {
        relativeSkillFilePath: relativePath,
      },
    });
  }

  return installables;
}

function normalizeContext7McpManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    return null;
  }
  return manifest;
}

function discoverMcpInstallables(source, extractedRoot) {
  if (source.includeMcp !== true) {
    return [];
  }

  const manifestPath = path.join(extractedRoot, normalizeRelativePath(source.mcpManifestPath || 'server.json'));
  const manifestText = readTextIfExists(manifestPath);
  if (!manifestText) {
    return [];
  }

  let manifest = null;
  try {
    manifest = normalizeContext7McpManifest(JSON.parse(manifestText));
  } catch {
    manifest = null;
  }

  if (!manifest) {
    return [];
  }

  const remotes = Array.isArray(manifest.remotes) ? manifest.remotes : [];
  const packages = Array.isArray(manifest.packages) ? manifest.packages : [];
  const preferredPackage = packages.find((entry) => normalizeString(entry.registryType) === 'npm') || packages[0] || null;
  const preferredRemote = remotes[0] || null;
  const title = normalizeString(manifest.title || manifest.name || source.title || source.sourceId) || source.sourceId;
  const description = normalizeString(manifest.description) || source.description || undefined;
  const installableId = 'mcp:context7';

  return [{
    installableId,
    kind: 'mcp-server',
    name: 'context7',
    title,
    description,
    relativePath: normalizeRelativePath(source.mcpManifestPath || 'server.json'),
    sourcePath: normalizeRelativePath(source.mcpManifestPath || 'server.json'),
    status: 'active',
    hiddenByDefault: false,
    deprecated: false,
    setupHints: [
      'Store CONTEXT7_API_KEY outside the repository if you need authenticated access.',
    ],
    targetSupport: ['codex', 'opencode', 'gemini-cli'],
    metadata: {
      manifest,
      preferredPackage,
      preferredRemote,
      commandTemplate: [CONTEXT7_DEFAULT_COMMAND, ...CONTEXT7_DEFAULT_ARGS],
      verifyEnvVars: ['CONTEXT7_API_KEY'],
    },
  }];
}

function resolveShippedInstallables(source) {
  return Array.isArray(source?.installables)
    ? source.installables.map((entry) => normalizeFetchedInstallable(entry)).filter(Boolean)
    : [];
}

function resolveSourceInstallables(source, cachedSnapshot) {
  const cachedInstallables = Array.isArray(cachedSnapshot?.snapshot?.installables)
    ? cachedSnapshot.snapshot.installables
    : [];
  if (cachedInstallables.length > 0) {
    return cachedInstallables;
  }
  return resolveShippedInstallables(source);
}

function resolveSourceSyncStatus(source, sourceState, cachedSnapshot) {
  const explicitStatus = normalizeString(sourceState.syncStatus);
  if (explicitStatus) {
    return explicitStatus;
  }
  if (cachedSnapshot) {
    return 'cached';
  }
  if (resolveShippedInstallables(source).length > 0) {
    return 'ready';
  }
  return 'not-synced';
}

function resolveSourceLastSyncedAt(sourceState, cachedSnapshot) {
  return normalizeString(sourceState.lastSyncedAt)
    || normalizeString(cachedSnapshot?.snapshot?.fetchedAt)
    || null;
}

function updateSourceState(options, sourceId, mutate) {
  const stateScan = readExternalSourcesState(options.copilotHome);
  const previousSourceState = resolveSourceStateEntry(stateScan.state, sourceId);
  const nextSourceState = mutate(previousSourceState, stateScan.state) || previousSourceState;
  const nextState = {
    schemaVersion: stateScan.state.schemaVersion,
    sources: {
      ...stateScan.state.sources,
      [sourceId]: nextSourceState,
    },
  };
  writeExternalSourcesState(options.copilotHome, nextState);
  return {
    state: nextState,
    sourceState: nextSourceState,
  };
}

function persistVerificationResult(options, sourceId, verification) {
  const lastVerifiedAt = new Date().toISOString();
  return updateSourceState(options, sourceId, (previousSourceState) => {
    const nextTargets = cloneSourceTargets(previousSourceState);
    const target = normalizeExternalSourceTarget(verification?.target);
    const installableId = normalizeString(verification?.installableId);
    if (target && installableId) {
      const targetState = nextTargets[target] && typeof nextTargets[target] === 'object'
        ? nextTargets[target]
        : { installables: {} };
      const installablesState = targetState.installables && typeof targetState.installables === 'object'
        ? { ...targetState.installables }
        : {};
      installablesState[installableId] = {
        ...(installablesState[installableId] || {}),
        overallStatus: normalizeString(verification?.overallStatus) || null,
        sourceStatus: normalizeString(verification?.sourceStatus) || null,
        lastVerifiedAt,
        checks: Array.isArray(verification?.checks) ? verification.checks : [],
        warnings: Array.isArray(verification?.warnings) ? verification.warnings : [],
        errors: Array.isArray(verification?.errors) ? verification.errors : [],
      };
      nextTargets[target] = {
        ...targetState,
        installables: installablesState,
      };
    }

    return {
      ...previousSourceState,
      lastVerifiedAt,
      verificationStatus: normalizeString(verification?.overallStatus) || null,
      verificationWarnings: Array.isArray(verification?.warnings) ? verification.warnings : [],
      verificationErrors: Array.isArray(verification?.errors) ? verification.errors : [],
      targets: nextTargets,
    };
  });
}

function fetchGitHubSourceArchive(source, cacheRoot, fetchImpl) {
  const sourceCacheRoot = path.join(cacheRoot, source.sourceId);
  safeRemove(sourceCacheRoot);
  ensureDir(sourceCacheRoot);

  const archivePath = path.join(sourceCacheRoot, 'source.tar.gz');
  const extractRoot = path.join(sourceCacheRoot, 'extracted');
  const resolvedRef = normalizeString(source.defaultRef) || 'main';
  const archiveUrl = buildGitHubArchiveUrl(source, resolvedRef);
  const fetchSource = typeof fetchImpl === 'function' ? fetchImpl : globalThis.fetch;

  if (typeof fetchSource !== 'function') {
    throw Object.assign(new Error('Global fetch is unavailable for external source sync.'), { statusCode: 500 });
  }

  return Promise.resolve(fetchSource(archiveUrl))
    .then(async (response) => {
      if (!response || !response.ok) {
        throw Object.assign(new Error(`Unable to download ${archiveUrl} (${response ? response.status : 'network_error'})`), {
          statusCode: 502,
        });
      }

      const arrayBuffer = await response.arrayBuffer();
      fs.writeFileSync(archivePath, Buffer.from(arrayBuffer));

      ensureDir(extractRoot);
      childProcess.execFileSync('tar', ['-xzf', archivePath, '-C', extractRoot], {
        windowsHide: true,
      });

      const extractedEntries = fs.readdirSync(extractRoot, { withFileTypes: true });
      const rootDirectory = extractedEntries.find((entry) => entry.isDirectory());
      if (!rootDirectory) {
        throw Object.assign(new Error('Downloaded archive did not contain an extracted root directory.'), { statusCode: 502 });
      }

      const extractedRoot = path.join(extractRoot, rootDirectory.name);
      const installables = [
        ...discoverSkillInstallables(source, extractedRoot),
        ...discoverMcpInstallables(source, extractedRoot),
      ];

      const snapshot = {
        schemaVersion: 1,
        sourceId: source.sourceId,
        source: {
          owner: source.owner,
          repo: source.repo,
          resolvedRef,
          url: source.url,
        },
        fetchedAt: new Date().toISOString(),
        resolvedRef,
        installables,
      };

      const snapshotPath = path.join(sourceCacheRoot, 'snapshot.json');
      writeJsonAtomic(snapshotPath, snapshot);

      return {
        sourceCacheRoot,
        extractedRoot,
        archivePath,
        snapshotPath,
        snapshot,
      };
    })
    .catch((error) => {
      safeRemove(sourceCacheRoot);
      throw error;
    });
}

function loadCachedSnapshot(copilotHome, sourceId) {
  const sourceCacheRoot = path.join(resolveCacheRoot(copilotHome), sourceId);
  const snapshotPath = path.join(sourceCacheRoot, 'snapshot.json');
  const raw = readJsonIfExists(snapshotPath);
  if (!raw) {
    return null;
  }
  return {
    sourceCacheRoot,
    snapshotPath,
    snapshot: normalizeFetchedDocument(raw),
  };
}

function resolveCachedExtractedRoot(sourceCacheRoot) {
  const extractedRoot = path.join(sourceCacheRoot, 'extracted');
  try {
    const entries = fs.readdirSync(extractedRoot, { withFileTypes: true });
    const rootDirectory = entries.find((entry) => entry.isDirectory());
    return rootDirectory ? path.join(extractedRoot, rootDirectory.name) : null;
  } catch {
    return null;
  }
}

function ensureShippedUserDocuments(engineRoot, copilotHome) {
  const shipped = readShippedSources(engineRoot);
  const user = readUserSources(copilotHome);
  return {
    shipped,
    user,
  };
}

function listSources(options) {
  const { engineRoot, copilotHome } = options;
  const { shipped, user } = ensureShippedUserDocuments(engineRoot, copilotHome);
  const { statePath, state } = readExternalSourcesState(copilotHome);
  const mergedSources = mergeSources(shipped.document, user.document);

  return {
    catalogPath: shipped.shippedPath,
    userSourcesPath: user.userSourcesPath,
    statePath,
    sources: mergedSources.map((source) => {
      const sourceState = resolveSourceStateEntry(state, source.sourceId);
      const cachedSnapshot = loadCachedSnapshot(copilotHome, source.sourceId);
      const installables = resolveSourceInstallables(source, cachedSnapshot);
      return {
        ...source,
        sync: {
          status: resolveSourceSyncStatus(source, sourceState, cachedSnapshot),
          lastSyncedAt: resolveSourceLastSyncedAt(sourceState, cachedSnapshot),
          lastError: normalizeString(sourceState.lastError) || null,
          resolvedRef: normalizeString(sourceState.resolvedRef || cachedSnapshot?.snapshot?.resolvedRef) || null,
          lastVerifiedAt: normalizeString(sourceState.lastVerifiedAt) || null,
          verificationStatus: normalizeString(sourceState.verificationStatus) || null,
          verificationWarnings: Array.isArray(sourceState.verificationWarnings) ? sourceState.verificationWarnings : [],
          verificationErrors: Array.isArray(sourceState.verificationErrors) ? sourceState.verificationErrors : [],
        },
        installables,
        activation: sourceState.targets && typeof sourceState.targets === 'object' ? sourceState.targets : {},
      };
    }),
  };
}

function addSource(options, payload) {
  const { copilotHome, engineRoot } = options;
  ensureShippedUserDocuments(engineRoot, copilotHome);
  const user = readUserSources(copilotHome);
  const nextSource = parseGitHubSourceInput(payload);

  const existingIndex = user.document.sources.findIndex((entry) => entry.sourceId === nextSource.sourceId);
  const nextSources = [...user.document.sources];
  if (existingIndex >= 0) {
    nextSources[existingIndex] = nextSource;
  } else {
    nextSources.push(nextSource);
  }

  const nextDocument = {
    schemaVersion: EXTERNAL_SOURCES_SCHEMA_VERSION,
    sources: nextSources.sort((left, right) => left.sourceId.localeCompare(right.sourceId)),
  };
  const userSourcesPath = writeUserSources(copilotHome, nextDocument);

  return {
    userSourcesPath,
    source: nextSource,
  };
}

function removeSource(options, sourceId) {
  const { copilotHome } = options;
  const normalizedSourceId = normalizeExternalSourceId(sourceId);
  if (!normalizedSourceId) {
    throw Object.assign(new Error('sourceId is required'), { statusCode: 400 });
  }

  const user = readUserSources(copilotHome);
  const stateScan = readExternalSourcesState(copilotHome);
  const existing = user.document.sources.find((entry) => entry.sourceId === normalizedSourceId);
  if (!existing) {
    throw Object.assign(new Error(`Unknown editable sourceId: ${normalizedSourceId}`), { statusCode: 404 });
  }

  const sourceState = resolveSourceStateEntry(stateScan.state, normalizedSourceId);
  if (hasEnabledTargetInstalls(sourceState)) {
    throw Object.assign(new Error(`Source ${normalizedSourceId} still has active target installs. Deactivate them before removing the source.`), {
      statusCode: 409,
    });
  }

  const nextDocument = {
    schemaVersion: EXTERNAL_SOURCES_SCHEMA_VERSION,
    sources: user.document.sources.filter((entry) => entry.sourceId !== normalizedSourceId),
  };
  writeUserSources(copilotHome, nextDocument);

  const nextState = {
    schemaVersion: stateScan.state.schemaVersion,
    sources: { ...stateScan.state.sources },
  };
  delete nextState.sources[normalizedSourceId];
  writeExternalSourcesState(copilotHome, nextState);

  safeRemove(path.join(resolveCacheRoot(copilotHome), normalizedSourceId));

  return {
    sourceId: normalizedSourceId,
    removed: true,
  };
}

function resolveSourceById(options, sourceId) {
  const sourcesList = listSources(options);
  const normalizedSourceId = normalizeExternalSourceId(sourceId);
  const source = sourcesList.sources.find((entry) => entry.sourceId === normalizedSourceId);
  if (!source) {
    throw Object.assign(new Error(`Unknown sourceId: ${normalizedSourceId}`), { statusCode: 404 });
  }
  return {
    ...sourcesList,
    source,
  };
}

async function refreshSource(options, sourceId) {
  const { engineRoot, copilotHome, fetch } = options;
  const sourceRecord = resolveSourceById({ engineRoot, copilotHome }, sourceId).source;
  const shippedInstallables = resolveShippedInstallables(sourceRecord);
  const usesShippedInstallablesOnly = shippedInstallables.length > 0
    && sourceRecord.includeSkills !== true
    && sourceRecord.includeMcp !== true;
  if (usesShippedInstallablesOnly && !shippedInstallables.some((entry) => installableRequiresCachedSourceFiles(entry))) {
    const fetchedAt = new Date().toISOString();
    const snapshot = {
      schemaVersion: 1,
      sourceId: sourceRecord.sourceId,
      source: {
        owner: sourceRecord.owner,
        repo: sourceRecord.repo,
        resolvedRef: normalizeString(sourceRecord.defaultRef) || null,
        url: sourceRecord.url,
      },
      fetchedAt,
      resolvedRef: normalizeString(sourceRecord.defaultRef) || null,
      installables: shippedInstallables,
    };
    const sourceCacheRoot = path.join(resolveCacheRoot(copilotHome), sourceRecord.sourceId);
    ensureDir(sourceCacheRoot);
    const snapshotPath = path.join(sourceCacheRoot, 'snapshot.json');
    writeJsonAtomic(snapshotPath, snapshot);

    updateSourceState(options, sourceRecord.sourceId, (previousSourceState) => ({
      ...previousSourceState,
      syncStatus: 'ready',
      lastSyncedAt: fetchedAt,
      lastError: null,
      resolvedRef: snapshot.resolvedRef,
    }));

    return {
      source: sourceRecord,
      snapshot,
    };
  }

  const cacheRoot = resolveCacheRoot(copilotHome);
  ensureDir(cacheRoot);
  try {
    const fetched = await fetchGitHubSourceArchive(sourceRecord, cacheRoot, fetch);
    if (usesShippedInstallablesOnly) {
      fetched.snapshot = {
        ...fetched.snapshot,
        installables: shippedInstallables,
      };
      writeJsonAtomic(fetched.snapshotPath, fetched.snapshot);
    }
    updateSourceState(options, sourceRecord.sourceId, (previousSourceState) => ({
      ...previousSourceState,
      syncStatus: 'ready',
      lastSyncedAt: fetched.snapshot.fetchedAt,
      lastError: null,
      resolvedRef: fetched.snapshot.resolvedRef,
    }));

    return {
      source: sourceRecord,
      snapshot: fetched.snapshot,
    };
  } catch (error) {
    updateSourceState(options, sourceRecord.sourceId, (previousSourceState) => ({
      ...previousSourceState,
      syncStatus: 'error',
      lastError: String(error && error.message ? error.message : error),
    }));
    throw error;
  }
}

function resolveManagedSkillName(sourceId, installable) {
  const name = slugifyName(installable.name || installable.installableId.replace(/^skill:/, ''))
    || slugifyName(installable.installableId.replace(/^skill:/, ''))
    || 'skill';
  return `external--${normalizeExternalSourceId(sourceId)}--${name}`;
}

function resolveManagedMcpName(sourceId, installable) {
  const base = slugifyName(installable.name || installable.installableId.replace(/^mcp:/, ''))
    || slugifyName(installable.installableId.replace(/^mcp:/, ''))
    || 'mcp';
  return `external-${normalizeExternalSourceId(sourceId)}-${base}`;
}

function resolveManagedCliName(sourceId, installable) {
  const base = slugifyName(installable.name || installable.installableId.replace(/^cli:/, ''))
    || slugifyName(installable.installableId.replace(/^cli:/, ''))
    || 'tool';
  return `external-${normalizeExternalSourceId(sourceId)}-${base}`;
}

function resolveMcpCommandSpec(sourceId, installable, cached) {
  const metadata = readMetadataRecord(installable?.metadata);
  const template = Array.isArray(metadata.commandTemplate)
    ? metadata.commandTemplate.map((entry) => normalizeString(entry)).filter(Boolean)
    : [];
  if (template.length > 0) {
    const resolvedTemplate = replaceInstallableCommandSourceTokens(sourceId, installable, template, cached);
    return {
      command: resolvedTemplate[0],
      args: resolvedTemplate.slice(1),
      envVars: normalizeStringList(metadata.verifyEnvVars || metadata.envVars),
    };
  }

  if (normalizeString(installable?.installableId) === 'mcp:context7') {
    return {
      command: CONTEXT7_DEFAULT_COMMAND,
      args: CONTEXT7_DEFAULT_ARGS,
      envVars: ['CONTEXT7_API_KEY'],
    };
  }

  throw Object.assign(new Error(`Installable ${installable?.installableId || '<unknown>'} is missing command metadata.`), {
    statusCode: 400,
  });
}

function buildCodexMcpBlock(sourceId, installable, cached) {
  const name = resolveManagedMcpName(sourceId, installable);
  const commandSpec = resolveMcpCommandSpec(sourceId, installable, cached);

  const lines = [];
  lines.push(`[mcp_servers.${name}]`);
  lines.push(`command = "${escapeTomlBasicString(commandSpec.command)}"`);
  lines.push(`args = [${commandSpec.args.map((value) => `"${escapeTomlBasicString(value)}"`).join(', ')}]`);
  if (commandSpec.envVars.length > 0) {
    lines.push(`env_vars = [${commandSpec.envVars.map((value) => `"${escapeTomlBasicString(value)}"`).join(', ')}]`);
  }
  return lines.join('\n');
}

function stripManagedCodexMcpBlock(text, sourceId, installable) {
  const name = resolveManagedMcpName(sourceId, installable);
  const pattern = new RegExp(`\\n?\\[mcp_servers\\.${name.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\][\\s\\S]*?(?=\\n\\[|$)`, 'g');
  return String(text || '').replace(pattern, '\n').replace(/\n{3,}/g, '\n\n').trimEnd();
}

function patchCodexMcpConfig(configPath, sourceId, installable, enabled, cached) {
  const existing = readTextIfExists(configPath) || '';
  const stripped = stripManagedCodexMcpBlock(existing, sourceId, installable);
  const nextText = enabled
    ? `${stripped.trimEnd()}${stripped.trim() ? '\n\n' : ''}${buildCodexMcpBlock(sourceId, installable, cached)}\n`
    : `${stripped.trimEnd()}${stripped.trim() ? '\n' : ''}`;
  const changed = String(existing).replace(/\r\n/g, '\n') !== nextText.replace(/\r\n/g, '\n');
  if (changed) {
    ensureDir(path.dirname(configPath));
    fs.writeFileSync(configPath, nextText, 'utf8');
  }
  return { changed, path: configPath };
}

function patchJsonObjectFile(filePath, mutate) {
  const existingText = readTextIfExists(filePath);
  const existing = existingText
    ? parseJsonc(existingText)
    : {};
  const nextValue = mutate(existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {});
  const nextText = JSON.stringify(nextValue, null, 2) + '\n';
  const changed = String(existingText || '') !== nextText;
  if (changed) {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, nextText, 'utf8');
  }
  return { changed, path: filePath };
}

function upsertOpencodeMcpConfig(opencodeConfigPath, sourceId, installable, enabled, cached) {
  const name = resolveManagedMcpName(sourceId, installable);
  const commandSpec = enabled ? resolveMcpCommandSpec(sourceId, installable, cached) : null;

  return patchJsonObjectFile(opencodeConfigPath, (existing) => {
    const next = { ...existing };
    const currentMcp = next.mcp && typeof next.mcp === 'object' && !Array.isArray(next.mcp) ? { ...next.mcp } : {};
    if (!enabled) {
      delete currentMcp[name];
      next.mcp = currentMcp;
      return next;
    }

    currentMcp[name] = {
      type: 'local',
      command: [commandSpec.command, ...commandSpec.args],
      enabled: true,
    };
    if (Array.isArray(commandSpec.envVars) && commandSpec.envVars.length > 0) {
      currentMcp[name].environment = commandSpec.envVars.reduce((acc, envVar) => ({
        ...acc,
        [envVar]: `\${env:${envVar}}`,
      }), {});
    }
    next.mcp = currentMcp;
    return next;
  });
}

function upsertGeminiCliMcpConfig(settingsPath, sourceId, installable, enabled, cached) {
  const name = resolveManagedMcpName(sourceId, installable);
  const commandSpec = enabled ? resolveMcpCommandSpec(sourceId, installable, cached) : null;

  return patchJsonObjectFile(settingsPath, (existing) => {
    const next = { ...existing };
    const currentMcpServers = next.mcpServers && typeof next.mcpServers === 'object' && !Array.isArray(next.mcpServers)
      ? { ...next.mcpServers }
      : {};
    if (!enabled) {
      delete currentMcpServers[name];
      next.mcpServers = currentMcpServers;
      return next;
    }

    currentMcpServers[name] = {
      command: commandSpec.command,
      args: commandSpec.args,
      trust: false,
    };
    if (Array.isArray(commandSpec.envVars) && commandSpec.envVars.length > 0) {
      currentMcpServers[name].env = commandSpec.envVars.reduce((acc, envVar) => ({
        ...acc,
        [envVar]: `$${envVar}`,
      }), {});
    }
    next.mcpServers = currentMcpServers;
    return next;
  });
}

function applySkillInstallable(target, sourceId, installable, sourceRoot, targetHomes) {
  const sourcePath = path.join(sourceRoot, installable.sourcePath);
  const skillName = resolveManagedSkillName(sourceId, installable);
  let targetSkillsHome = null;

  if (target === 'codex') {
    targetSkillsHome = targetHomes.codexSkillsHome || path.join(targetHomes.codexHome, 'skills');
  } else if (target === 'opencode') {
    targetSkillsHome = targetHomes.opencodeSkillsHome || path.join(targetHomes.opencodeHome, 'skills');
  } else if (target === 'antigravity') {
    targetSkillsHome = targetHomes.antigravitySkillsHome || path.join(targetHomes.antigravityHome, 'skills');
  }

  if (!targetSkillsHome) {
    throw Object.assign(new Error(`Target ${target} does not support skill materialization.`), { statusCode: 400 });
  }

  const destinationPath = path.join(targetSkillsHome, skillName);
  safeRemove(destinationPath);
  copyDirectory(sourcePath, destinationPath);
  return {
    kind: 'skill',
    target,
    path: destinationPath,
    managedName: skillName,
  };
}

function applyMcpInstallable(target, sourceId, installable, cached, targetHomes) {
  if (target === 'codex') {
    const configPath = path.join(targetHomes.codexHome, 'config.toml');
    const configPatch = patchCodexMcpConfig(configPath, sourceId, installable, true, cached);
    return {
      kind: 'mcp-server',
      target,
      path: configPath,
      managedName: resolveManagedMcpName(sourceId, installable),
      changed: configPatch.changed,
    };
  }

  if (target === 'opencode') {
    const configPath = path.join(targetHomes.opencodeHome, 'opencode.json');
    const configPatch = upsertOpencodeMcpConfig(configPath, sourceId, installable, true, cached);
    return {
      kind: 'mcp-server',
      target,
      path: configPath,
      managedName: resolveManagedMcpName(sourceId, installable),
      changed: configPatch.changed,
    };
  }

  if (target === 'gemini-cli') {
    const settingsPath = path.join(targetHomes.geminiHome, 'settings.json');
    const configPatch = upsertGeminiCliMcpConfig(settingsPath, sourceId, installable, true, cached);
    return {
      kind: 'mcp-server',
      target,
      path: settingsPath,
      managedName: resolveManagedMcpName(sourceId, installable),
      changed: configPatch.changed,
    };
  }

  throw Object.assign(new Error(`Target ${target} does not support MCP materialization.`), { statusCode: 400 });
}

async function applyCliInstallable(target, sourceId, installable, options) {
  if (target !== HOST_TARGET) {
    throw Object.assign(new Error(`Target ${target} does not support CLI tool materialization.`), { statusCode: 400 });
  }

  const metadata = readMetadataRecord(installable.metadata);
  const selection = await resolveCliInstallerSelection(installable, options);
  const commandToRun = selection.commandText;
  if (!commandToRun) {
    throw Object.assign(new Error(`Installable ${installable.installableId} is missing an install command.`), { statusCode: 400 });
  }

  const invocation = buildCommandInvocation(commandToRun, {
    metadata,
    cwd: normalizeString(options.cwd) || process.cwd(),
    env: options.env,
    timeoutMs: options.timeoutMs,
    sourceId,
    installable,
    cached: options.cached,
  });
  const commandResult = await runCommand(invocation, options);
  if (!commandResult.ok) {
    throw Object.assign(new Error(commandResult.stderr.trim() || commandResult.stdout.trim() || commandResult.error || `Failed to install ${resolveInstallableLabel(installable)}.`), {
      statusCode: 500,
      commandResult,
    });
  }

  return {
    kind: 'cli-tool',
    target,
    path: normalizeString(commandResult.stdout).split(/\r?\n/)[0] || null,
    managedName: resolveManagedCliName(sourceId, installable),
    changed: true,
    installer: selection.installer,
    commandResult,
  };
}

function removeSkillInstallable(target, sourceId, installable, targetHomes) {
  const skillName = resolveManagedSkillName(sourceId, installable);
  let targetSkillsHome = null;

  if (target === 'codex') {
    targetSkillsHome = targetHomes.codexSkillsHome || path.join(targetHomes.codexHome, 'skills');
  } else if (target === 'opencode') {
    targetSkillsHome = targetHomes.opencodeSkillsHome || path.join(targetHomes.opencodeHome, 'skills');
  } else if (target === 'antigravity') {
    targetSkillsHome = targetHomes.antigravitySkillsHome || path.join(targetHomes.antigravityHome, 'skills');
  }

  if (!targetSkillsHome) {
    throw Object.assign(new Error(`Target ${target} does not support skill removal.`), { statusCode: 400 });
  }

  const destinationPath = path.join(targetSkillsHome, skillName);
  safeRemove(destinationPath);
  return {
    kind: 'skill',
    target,
    path: destinationPath,
    managedName: skillName,
  };
}

function removeMcpInstallable(target, sourceId, installable, targetHomes) {
  if (target === 'codex') {
    const configPath = path.join(targetHomes.codexHome, 'config.toml');
    const configPatch = patchCodexMcpConfig(configPath, sourceId, installable, false);
    return {
      kind: 'mcp-server',
      target,
      path: configPath,
      managedName: resolveManagedMcpName(sourceId, installable),
      changed: configPatch.changed,
    };
  }

  if (target === 'opencode') {
    const configPath = path.join(targetHomes.opencodeHome, 'opencode.json');
    const configPatch = upsertOpencodeMcpConfig(configPath, sourceId, installable, false);
    return {
      kind: 'mcp-server',
      target,
      path: configPath,
      managedName: resolveManagedMcpName(sourceId, installable),
      changed: configPatch.changed,
    };
  }

  if (target === 'gemini-cli') {
    const settingsPath = path.join(targetHomes.geminiHome, 'settings.json');
    const configPatch = upsertGeminiCliMcpConfig(settingsPath, sourceId, installable, false);
    return {
      kind: 'mcp-server',
      target,
      path: settingsPath,
      managedName: resolveManagedMcpName(sourceId, installable),
      changed: configPatch.changed,
    };
  }

  throw Object.assign(new Error(`Target ${target} does not support MCP removal.`), { statusCode: 400 });
}

function removeCliInstallable(target, sourceId, installable) {
  if (target !== HOST_TARGET) {
    throw Object.assign(new Error(`Target ${target} does not support CLI tool removal.`), { statusCode: 400 });
  }
  return {
    kind: 'cli-tool',
    target,
    path: null,
    managedName: resolveManagedCliName(sourceId, installable),
    changed: false,
  };
}

function resolveTargetHomes(options = {}) {
  const homeDir = os.homedir();
  const codexHome = path.resolve(options.codexHome || process.env.CODEX_HOME || path.join(homeDir, '.codex'));
  const opencodeHome = path.resolve(
    options.opencodeHome
      || process.env.OPENCODE_HOME
      || path.join(process.env.XDG_CONFIG_HOME || path.join(homeDir, '.config'), 'opencode'),
  );
  const geminiHome = path.resolve(options.geminiHome || process.env.GEMINI_HOME || path.join(homeDir, '.gemini'));
  const antigravityHome = path.resolve(
    options.antigravityHome || process.env.INSTRUCTION_ENGINE_ANTIGRAVITY_HOME || path.join(geminiHome, 'antigravity'),
  );

  return {
    codexHome,
    codexSkillsHome: options.codexSkillsHome || process.env.INSTRUCTION_ENGINE_CODEX_SKILLS_HOME || path.join(codexHome, 'skills'),
    opencodeHome,
    opencodeSkillsHome: options.opencodeSkillsHome || process.env.INSTRUCTION_ENGINE_OPENCODE_SKILLS_HOME || path.join(opencodeHome, 'skills'),
    geminiHome,
    antigravityHome,
    antigravitySkillsHome: options.antigravitySkillsHome || process.env.INSTRUCTION_ENGINE_ANTIGRAVITY_SKILLS_HOME || path.join(antigravityHome, 'skills'),
  };
}

function resolveSupportedTargets(installable) {
  if (Array.isArray(installable?.targetSupport) && installable.targetSupport.length > 0) {
    return normalizeExternalSourceTargetList(installable.targetSupport);
  }
  if (installable?.kind === 'skill') {
    return ['codex', 'opencode', 'antigravity'];
  }
  if (installable?.kind === 'cli-tool') {
    return [HOST_TARGET];
  }
  return ['codex', 'opencode', 'gemini-cli'];
}

function resolveMaterializeInstallable(options, source, installable, target, cached) {
  const targetHomes = resolveTargetHomes(options);
  const extractedRoot = cached ? resolveCachedExtractedRoot(cached.sourceCacheRoot) : null;
  if (installable.kind === 'skill') {
    if (!extractedRoot) {
      throw Object.assign(new Error(`Cached source contents for ${source.sourceId} are unavailable. Refresh the source and try again.`), {
        statusCode: 409,
      });
    }
    return Promise.resolve(applySkillInstallable(target, source.sourceId, installable, extractedRoot, targetHomes));
  }
  if (installable.kind === 'mcp-server') {
    return Promise.resolve(applyMcpInstallable(target, source.sourceId, installable, cached, targetHomes));
  }
  if (installable.kind === 'cli-tool') {
    return applyCliInstallable(target, source.sourceId, installable, { ...options, cached });
  }
  throw Object.assign(new Error(`Unsupported installable kind: ${installable.kind}`), { statusCode: 400 });
}

function resolveRemoveInstallable(options, source, installable, target) {
  const targetHomes = resolveTargetHomes(options);
  if (installable.kind === 'skill') {
    return removeSkillInstallable(target, source.sourceId, installable, targetHomes);
  }
  if (installable.kind === 'mcp-server') {
    return removeMcpInstallable(target, source.sourceId, installable, targetHomes);
  }
  if (installable.kind === 'cli-tool') {
    return removeCliInstallable(target, source.sourceId, installable);
  }
  throw Object.assign(new Error(`Unsupported installable kind: ${installable.kind}`), { statusCode: 400 });
}

function resolveInstallableFromSource(options, sourceId, installableId) {
  const sourceList = resolveSourceById(options, sourceId);
  const source = sourceList.source;
  const cached = loadCachedSnapshot(options.copilotHome, source.sourceId);
  const installables = resolveSourceInstallables(source, cached);
  const installable = installables.find((entry) => entry.installableId === installableId);
  if (!installable) {
    throw Object.assign(new Error(`Unknown installableId: ${installableId}`), { statusCode: 404 });
  }
  return {
    source,
    cached,
    installable,
  };
}

async function activateInstallable(options, payload) {
  const normalizedSourceId = normalizeExternalSourceId(payload?.sourceId);
  const installableId = normalizeString(payload?.installableId);
  const target = normalizeExternalSourceTarget(payload?.target);
  if (!normalizedSourceId || !installableId || !target) {
    throw Object.assign(new Error('sourceId, installableId, and target are required'), { statusCode: 400 });
  }

  const { source, cached, installable } = resolveInstallableFromSource(options, normalizedSourceId, installableId);
  const supportedTargets = resolveSupportedTargets(installable);
  if (!supportedTargets.includes(target)) {
    throw Object.assign(new Error(`Installable ${installableId} does not support target ${target}.`), { statusCode: 400 });
  }

  const materialized = await resolveMaterializeInstallable(options, source, installable, target, cached);
  const now = new Date().toISOString();
  const updatedState = updateSourceState(options, source.sourceId, (previousSourceState) => {
    const nextTargets = cloneSourceTargets(previousSourceState);
    const targetState = nextTargets[target] && typeof nextTargets[target] === 'object'
      ? nextTargets[target]
      : { installables: {} };
    const installablesState = targetState.installables && typeof targetState.installables === 'object'
      ? { ...targetState.installables }
      : {};
    installablesState[installable.installableId] = {
      ...(installablesState[installable.installableId] || {}),
      enabled: true,
      installed: true,
      installedAt: now,
      managedName: materialized.managedName,
      installedPath: materialized.path,
      kind: installable.kind,
      overallStatus: 'installed',
    };
    nextTargets[target] = {
      ...targetState,
      installables: installablesState,
    };
    return {
      ...previousSourceState,
      syncStatus: normalizeString(previousSourceState.syncStatus) || 'ready',
      lastSyncedAt: previousSourceState.lastSyncedAt || cached?.snapshot?.fetchedAt || now,
      lastError: null,
      resolvedRef: previousSourceState.resolvedRef || cached?.snapshot?.resolvedRef || normalizeString(source.defaultRef) || null,
      targets: nextTargets,
    };
  });

  return {
    source,
    installable,
    target,
    materialized,
    state: updatedState.sourceState,
  };
}

function deactivateInstallable(options, payload) {
  const normalizedSourceId = normalizeExternalSourceId(payload?.sourceId);
  const installableId = normalizeString(payload?.installableId);
  const target = normalizeExternalSourceTarget(payload?.target);
  if (!normalizedSourceId || !installableId || !target) {
    throw Object.assign(new Error('sourceId, installableId, and target are required'), { statusCode: 400 });
  }

  const { source, installable } = resolveInstallableFromSource(options, normalizedSourceId, installableId);
  const removed = resolveRemoveInstallable(options, source, installable, target);
  const now = new Date().toISOString();
  const updatedState = updateSourceState(options, source.sourceId, (previousSourceState) => {
    const nextTargets = cloneSourceTargets(previousSourceState);
    const targetState = nextTargets[target] && typeof nextTargets[target] === 'object'
      ? nextTargets[target]
      : { installables: {} };
    const installablesState = targetState.installables && typeof targetState.installables === 'object'
      ? { ...targetState.installables }
      : {};

    installablesState[installable.installableId] = {
      ...(installablesState[installable.installableId] || {}),
      enabled: false,
      installed: false,
      lastRemovedAt: now,
      managedName: removed.managedName,
      installedPath: removed.path,
      kind: installable.kind,
      overallStatus: 'inactive',
    };

    nextTargets[target] = {
      ...targetState,
      installables: installablesState,
    };

    return {
      ...previousSourceState,
      targets: nextTargets,
    };
  });

  return {
    source,
    installable,
    target,
    removed,
    state: updatedState.sourceState,
  };
}

function getSourceDetail(options, sourceId) {
  const normalizedSourceId = normalizeExternalSourceId(sourceId);
  const listed = listSources(options);
  const source = listed.sources.find((entry) => entry.sourceId === normalizedSourceId);
  if (!source) {
    throw Object.assign(new Error(`Unknown sourceId: ${normalizedSourceId}`), { statusCode: 404 });
  }

  return {
    ...listed,
    source,
  };
}

async function verifyInstallableTarget(options, source, installable, target) {
  const sourceState = resolveSourceStateEntry(readExternalSourcesState(options.copilotHome).state, source.sourceId);
  const installableState = resolveInstallableStateEntry(sourceState, target, installable.installableId);
  const cached = loadCachedSnapshot(options.copilotHome, source.sourceId);
  const checks = [];
  const warnings = [];
  const errors = [];
  const metadata = readMetadataRecord(installable.metadata);
  const kind = describeInstallableLifecycle(installable);

  checks.push(createCheck(
    'target-support',
    `${resolveInstallableLabel(installable)} target support`,
    resolveSupportedTargets(installable).includes(target) ? 'ok' : 'error',
    resolveSupportedTargets(installable).includes(target)
      ? `${resolveInstallableLabel(installable)} supports ${target}.`
      : `${resolveInstallableLabel(installable)} does not support ${target}.`,
    { target }
  ));

  if (kind === 'skill') {
    const installedPath = normalizeString(installableState.installedPath);
    const pathState = readInstalledPathState(installedPath);
    const status = installableState.enabled === true && pathState.exists ? 'ready' : installableState.enabled === true ? 'warning' : 'inactive';
    checks.push(createCheck(
      'materialized',
      `${resolveInstallableLabel(installable)} files`,
      status,
      pathState.exists
        ? `Managed skill files are present at ${installedPath}.`
        : installableState.enabled === true
          ? `Expected managed skill files at ${installedPath || '(missing path)'} but they were not found.`
          : 'Skill is not active for this target.',
      { target, installedPath: installedPath || null }
    ));
  } else if (kind === 'mcp-server') {
    const installedPath = normalizeString(installableState.installedPath);
    const pathState = readInstalledPathState(installedPath);
    const configured = installableState.enabled === true;
    checks.push(createCheck(
      'configured',
      `${resolveInstallableLabel(installable)} target config`,
      configured && pathState.exists ? 'ready' : configured ? 'warning' : 'inactive',
      configured
        ? `Managed MCP configuration recorded at ${installedPath || '(unknown path)'}.`
        : 'MCP server is not active for this target.',
      { target, installedPath: installedPath || null }
    ));

    const verifyCommand = normalizeString(installable.verifyCommand);
    if (verifyCommand) {
      const invocation = buildCommandInvocation(verifyCommand, {
        metadata,
        cwd: process.cwd(),
        env: options.env,
        timeoutMs: options.timeoutMs,
        sourceId: source.sourceId,
        installable,
        cached,
      });
      const result = await runCommand(invocation, options);
      checks.push(createCheck(
        'runtime',
        `${resolveInstallableLabel(installable)} command`,
        result.ok ? 'ready' : 'warning',
        result.ok
          ? `${invocation.commandText} succeeded.`
          : `${invocation.commandText} failed: ${normalizeString(result.stderr || result.stdout || result.error) || 'command failed'}`,
        { target, command: invocation.commandText, exitCode: result.exitCode }
      ));
    }

    if (normalizeString(metadata.defaultGhidraServerUrl)) {
      const serverUrl = normalizeString(metadata.defaultGhidraServerUrl);
      try {
        const response = await Promise.resolve((typeof options.fetch === 'function' ? options.fetch : globalThis.fetch)(serverUrl, { method: 'GET' }));
        checks.push(createCheck(
          'runtime',
          `${resolveInstallableLabel(installable)} upstream server`,
          response && response.ok ? 'ready' : 'warning',
          response && response.ok
            ? `Upstream server responded at ${serverUrl}.`
            : `Upstream server did not respond successfully at ${serverUrl}. Start GhidraMCP inside Ghidra and verify the HTTP server port.`,
          { target, url: serverUrl, statusCode: response ? response.status : null }
        ));
      } catch (error) {
        checks.push(createCheck(
          'runtime',
          `${resolveInstallableLabel(installable)} upstream server`,
          'warning',
          `Unable to reach ${serverUrl}. Start GhidraMCP inside Ghidra and verify the HTTP server port.`,
          { target, url: serverUrl, error: String(error && error.message ? error.message : error) }
        ));
      }
    }
  } else if (kind === 'cli-tool') {
    const prerequisites = [
      ['git', ['--version'], 'Git is required for Spec Kit installs.'],
      ['python', ['--version'], 'Python 3.11+ is required for Spec Kit installs.'],
    ];
    const installers = [
      ['uv', ['--version'], 'uv is the recommended installer for Spec Kit.'],
      ['pipx', ['--version'], 'pipx can install Spec Kit when uv is unavailable.'],
    ];
    for (const [command, args, detail] of prerequisites) {
      const result = await runCommand({
        command,
        args,
        cwd: process.cwd(),
        env: options.env || process.env,
        commandText: formatShellCommand(command, args),
        timeoutMs: options.timeoutMs || 10_000,
      }, options);
      checks.push(createCheck(
        'prerequisite',
        command,
        result.ok ? 'ok' : 'error',
        result.ok ? `${command} is available.` : detail,
        { target, command: formatShellCommand(command, args), exitCode: result.exitCode }
      ));
    }

    let installerAvailable = false;
    for (const [command, args, detail] of installers) {
      const result = await runCommand({
        command,
        args,
        cwd: process.cwd(),
        env: options.env || process.env,
        commandText: formatShellCommand(command, args),
        timeoutMs: options.timeoutMs || 10_000,
      }, options);
      if (result.ok) {
        installerAvailable = true;
      }
      checks.push(createCheck(
        'prerequisite',
        command,
        result.ok ? 'ok' : 'warning',
        result.ok ? `${command} is available.` : detail,
        { target, command: formatShellCommand(command, args), exitCode: result.exitCode }
      ));
    }

    if (!installerAvailable) {
      warnings.push('Neither uv nor pipx is available. Install one of them to manage Spec Kit.');
    }

    const verifyCommand = normalizeString(installable.verifyCommand) || 'specify version';
    const verifyInvocation = buildCommandInvocation(verifyCommand, {
      metadata,
      cwd: process.cwd(),
      env: options.env,
      timeoutMs: options.timeoutMs,
      sourceId: source.sourceId,
      installable,
      cached,
    });
    const verifyResult = await runCommand(verifyInvocation, options);
    checks.push(createCheck(
      'installed',
      `${resolveInstallableLabel(installable)} CLI`,
      verifyResult.ok ? 'installed' : 'warning',
      verifyResult.ok
        ? `${verifyInvocation.commandText} succeeded.`
        : `${verifyInvocation.commandText} failed. Install or repair the Spec Kit CLI.`,
      { target, command: verifyInvocation.commandText, exitCode: verifyResult.exitCode }
    ));

    const repoPath = normalizeString(options.repoPath);
    if (repoPath) {
      const expectedPaths = Array.isArray(metadata.expectedPaths) && metadata.expectedPaths.length > 0
        ? metadata.expectedPaths.map((entry) => normalizeRelativePath(entry)).filter(Boolean)
        : SPEC_KIT_EXPECTED_REPO_PATHS;
      const existingPaths = expectedPaths.filter((relativePath) => fs.existsSync(path.join(repoPath, relativePath)));
      const initialized = fs.existsSync(path.join(repoPath, '.specify'));
      const conflictingScaffold = hasInternalSpecDrivenScaffold(repoPath);
      checks.push(createCheck(
        'repo',
        `${resolveInstallableLabel(installable)} repo scaffold`,
        !verifyResult.ok
          ? 'inactive'
          : initialized && existingPaths.length >= 4
            ? 'ready'
            : 'warning',
        !verifyResult.ok
          ? 'CLI is not installed yet, so repo bootstrap cannot be verified.'
          : initialized && existingPaths.length >= 4
            ? `Repo contains .specify and Copilot command files.`
            : 'CLI is installed, but the selected repo is not initialized with Spec Kit yet.',
        { target, repoPath, expectedPaths, existingPaths }
      ));
      if (conflictingScaffold) {
        checks.push(createCheck(
          'repo',
          'internal-spec-driven-scaffold',
          'warning',
          'This repo already has the internal spec-driven scaffold. Spec Kit is an additional upstream workflow, not the same contract.',
          { target, repoPath }
        ));
      }
    }
  }

  const derived = collectWarningsAndErrors(checks);
  warnings.push(...derived.warnings.filter((entry) => !warnings.includes(entry)));
  errors.push(...derived.errors.filter((entry) => !errors.includes(entry)));

  const overallStatus = finalizeCheckCollection(checks);
  const sourceStatus = overallStatus;
  return {
    sourceId: source.sourceId,
    installableId: installable.installableId,
    target,
    overallStatus,
    sourceStatus,
    checks,
    warnings,
    errors,
  };
}

async function syncInstallVerifySource(options, payload) {
  const sourceId = normalizeExternalSourceId(payload?.sourceId);
  if (!sourceId) {
    throw Object.assign(new Error('sourceId is required'), { statusCode: 400 });
  }

  const force = payload?.force === true;
  const repoPath = normalizeString(payload?.repoPath);
  const source = resolveSourceById(options, sourceId).source;
  const refreshed = await refreshSource(options, sourceId);
  const installables = resolveSourceInstallables(source, loadCachedSnapshot(options.copilotHome, sourceId));
  const requestedInstallableIds = normalizeStringList(payload?.installableIds);
  const selectedInstallables = requestedInstallableIds.length > 0
    ? installables.filter((entry) => requestedInstallableIds.includes(entry.installableId))
    : installables;
  if (requestedInstallableIds.length > 0 && selectedInstallables.length !== requestedInstallableIds.length) {
    const knownIds = new Set(selectedInstallables.map((entry) => entry.installableId));
    const missingId = requestedInstallableIds.find((entry) => !knownIds.has(entry));
    throw Object.assign(new Error(`Unknown installableId: ${missingId}`), { statusCode: 404 });
  }

  const targets = normalizeExternalSourceTargetList(payload?.targets);
  const perInstallableResults = [];
  const allChecks = [];
  const warnings = [];
  const errors = [];

  for (const installable of selectedInstallables) {
    const supportedTargets = resolveSupportedTargets(installable);
    const targetList = targets.length > 0 ? targets : supportedTargets;
    const targetResults = [];
    for (const target of targetList) {
      if (!supportedTargets.includes(target)) {
        throw Object.assign(new Error(`Installable ${installable.installableId} does not support target ${target}.`), { statusCode: 400 });
      }
      if (force || (targets.length > 0 ? targets.includes(target) : true)) {
        await activateInstallable({ ...options, force, repoPath }, {
          sourceId,
          installableId: installable.installableId,
          target,
        });
      }
      const verification = await verifyInstallableTarget({ ...options, repoPath }, source, installable, target);
      persistVerificationResult(options, sourceId, verification);
      targetResults.push(verification);
      allChecks.push(...verification.checks);
      warnings.push(...verification.warnings.filter((entry) => !warnings.includes(entry)));
      errors.push(...verification.errors.filter((entry) => !errors.includes(entry)));
    }
    perInstallableResults.push({
      installableId: installable.installableId,
      kind: installable.kind,
      overallStatus: finalizeCheckCollection(targetResults.flatMap((entry) => entry.checks)),
      sourceStatus: refreshed?.snapshot ? 'ready' : resolveSourceSyncStatus(source, resolveSourceStateEntry(readExternalSourcesState(options.copilotHome).state, source.sourceId), null),
      targets: targetResults,
      checks: targetResults.flatMap((entry) => entry.checks),
      warnings: targetResults.flatMap((entry) => entry.warnings),
      errors: targetResults.flatMap((entry) => entry.errors),
    });
  }

  return {
    source,
    snapshot: refreshed.snapshot,
    overallStatus: errors.length > 0 ? 'needs-attention' : warnings.length > 0 ? 'partial' : 'ready',
    sourceStatus: resolveSourceSyncStatus(source, resolveSourceStateEntry(readExternalSourcesState(options.copilotHome).state, source.sourceId), loadCachedSnapshot(options.copilotHome, source.sourceId)),
    installables: perInstallableResults,
    targets: perInstallableResults.flatMap((entry) => entry.targets),
    checks: allChecks,
    warnings,
    errors,
  };
}

async function bootstrapSpecKitRepo(options, payload) {
  const integration = normalizeString(payload?.integration) || 'copilot';
  const script = normalizeString(payload?.script) || (process.platform === 'win32' ? 'ps' : 'sh');
  const repoPath = normalizeString(payload?.repoPath);
  if (!repoPath) {
    throw Object.assign(new Error('repoPath is required'), { statusCode: 400 });
  }

  const { source, installable } = resolveInstallableFromSource(options, SPEC_KIT_SOURCE_ID, SPEC_KIT_INSTALLABLE_ID);
  const repoAbsPath = path.resolve(repoPath);
  const stat = fs.existsSync(repoAbsPath) ? fs.statSync(repoAbsPath) : null;
  if (!stat || !stat.isDirectory()) {
    throw Object.assign(new Error(`Repo path is not a directory: ${repoAbsPath}`), { statusCode: 400 });
  }

  const verifyResult = await verifyInstallableTarget({ ...options, repoPath: repoAbsPath }, source, installable, HOST_TARGET);
  const verifyChecks = Array.isArray(verifyResult.checks) ? verifyResult.checks : [];
  const cliInstalled = verifyChecks.some((entry) => normalizeString(entry.type) === 'installed' && normalizeString(entry.status) === 'installed');
  if (!cliInstalled) {
    throw Object.assign(new Error('Spec Kit CLI is not installed. Run sync / install / verify for Spec Kit first.'), { statusCode: 409 });
  }

  const commandParts = ['specify', 'init', '--here', '--integration', integration, '--script', script];
  if (payload?.force === true) {
    commandParts.push('--force');
  }
  if (payload?.ignoreAgentTools === true) {
    commandParts.push('--ignore-agent-tools');
  }
  const invocation = {
    command: commandParts[0],
    args: commandParts.slice(1),
    cwd: repoAbsPath,
    env: options.env || process.env,
    commandText: formatShellCommand(commandParts[0], commandParts.slice(1)),
    timeoutMs: Number.isFinite(options.timeoutMs) ? Number(options.timeoutMs) : 120_000,
  };
  const commandResult = await runCommand(invocation, options);
  if (!commandResult.ok) {
    throw Object.assign(new Error(commandResult.stderr.trim() || commandResult.stdout.trim() || commandResult.error || 'Spec Kit bootstrap failed.'), {
      statusCode: 500,
      commandResult,
    });
  }

  const postVerify = await verifyInstallableTarget({ ...options, repoPath: repoAbsPath }, source, installable, HOST_TARGET);
  persistVerificationResult(options, source.sourceId, postVerify);
  const conflictingScaffold = hasInternalSpecDrivenScaffold(repoAbsPath);
  const warnings = Array.from(new Set([
    ...postVerify.warnings,
    ...(conflictingScaffold
      ? ['This repo already has the internal spec-driven scaffold. Spec Kit is an additional upstream workflow, not the same contract.']
      : []),
  ]));
  const errors = Array.from(new Set(postVerify.errors));

  return {
    source,
    installable,
    repoPath: repoAbsPath,
    integration,
    script,
    command: invocation.commandText,
    overallStatus: errors.length > 0 ? 'needs-attention' : warnings.length > 0 ? 'partial' : 'ready',
    sourceStatus: postVerify.sourceStatus,
    checks: postVerify.checks,
    warnings,
    errors,
    bootstrap: {
      ran: true,
      command: invocation.commandText,
      cwd: repoAbsPath,
      stdout: commandResult.stdout,
      stderr: commandResult.stderr,
      exitCode: commandResult.exitCode,
    },
  };
}

module.exports = {
  resolveCatalogRoot,
  resolveUserSourcesPath,
  resolveStatePath,
  resolveCacheRoot,
  resolveTargetHomes,
  parseGitHubUrl,
  listSources,
  addSource,
  removeSource,
  getSourceDetail,
  refreshSource,
  activateInstallable,
  deactivateInstallable,
  syncInstallVerifySource,
  bootstrapSpecKitRepo,
};
