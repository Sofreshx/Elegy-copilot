'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const childProcess = require('child_process');

const contracts = require('@elegy-copilot/contracts');

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

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStringList(value) {
  return Array.isArray(value)
    ? value.map((entry) => normalizeString(entry)).filter(Boolean)
    : [];
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
  return Array.from(bySourceId.values()).sort((left, right) => left.sourceId.localeCompare(right.sourceId));
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
    metadata: entry.metadata && typeof entry.metadata === 'object' && !Array.isArray(entry.metadata)
      ? entry.metadata
      : {},
    targetSupport: Array.isArray(entry.targetSupport)
      ? normalizeStringList(entry.targetSupport)
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
    },
  }];
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
      const installables = cachedSnapshot ? cachedSnapshot.snapshot.installables : [];
      return {
        ...source,
        sync: {
          status: normalizeString(sourceState.syncStatus) || (cachedSnapshot ? 'cached' : 'not-synced'),
          lastSyncedAt: normalizeString(sourceState.lastSyncedAt) || null,
          lastError: normalizeString(sourceState.lastError) || null,
          resolvedRef: normalizeString(sourceState.resolvedRef || cachedSnapshot?.snapshot?.resolvedRef) || null,
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
  const cacheRoot = resolveCacheRoot(copilotHome);
  ensureDir(cacheRoot);
  try {
    const fetched = await fetchGitHubSourceArchive(sourceRecord, cacheRoot, fetch);
    const stateScan = readExternalSourcesState(copilotHome);
    const previousSourceState = resolveSourceStateEntry(stateScan.state, sourceRecord.sourceId);
    const nextSourceState = {
      ...previousSourceState,
      syncStatus: 'ready',
      lastSyncedAt: fetched.snapshot.fetchedAt,
      lastError: null,
      resolvedRef: fetched.snapshot.resolvedRef,
    };

    const nextState = {
      schemaVersion: stateScan.state.schemaVersion,
      sources: {
        ...stateScan.state.sources,
        [sourceRecord.sourceId]: nextSourceState,
      },
    };
    writeExternalSourcesState(copilotHome, nextState);

    return {
      source: sourceRecord,
      snapshot: fetched.snapshot,
    };
  } catch (error) {
    const stateScan = readExternalSourcesState(copilotHome);
    const previousSourceState = resolveSourceStateEntry(stateScan.state, sourceRecord.sourceId);
    const nextState = {
      schemaVersion: stateScan.state.schemaVersion,
      sources: {
        ...stateScan.state.sources,
        [sourceRecord.sourceId]: {
          ...previousSourceState,
          syncStatus: 'error',
          lastError: String(error && error.message ? error.message : error),
        },
      },
    };
    writeExternalSourcesState(copilotHome, nextState);
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

function buildCodexMcpBlock(sourceId, installable) {
  const name = resolveManagedMcpName(sourceId, installable);

  const lines = [];
  lines.push(`[mcp_servers.${name}]`);
  lines.push(`command = "${CONTEXT7_DEFAULT_COMMAND}"`);
  lines.push(`args = [${CONTEXT7_DEFAULT_ARGS.map((value) => `"${value}"`).join(', ')}]`);
  lines.push('env_vars = ["CONTEXT7_API_KEY"]');
  return lines.join('\n');
}

function stripManagedCodexMcpBlock(text, sourceId, installable) {
  const name = resolveManagedMcpName(sourceId, installable);
  const pattern = new RegExp(`\\n?\\[mcp_servers\\.${name.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\][\\s\\S]*?(?=\\n\\[|$)`, 'g');
  return String(text || '').replace(pattern, '\n').replace(/\n{3,}/g, '\n\n').trimEnd();
}

function patchCodexMcpConfig(configPath, sourceId, installable, enabled) {
  const existing = readTextIfExists(configPath) || '';
  const stripped = stripManagedCodexMcpBlock(existing, sourceId, installable);
  const nextText = enabled
    ? `${stripped.trimEnd()}${stripped.trim() ? '\n\n' : ''}${buildCodexMcpBlock(sourceId, installable)}\n`
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

function upsertOpencodeMcpConfig(opencodeConfigPath, sourceId, installable, enabled) {
  const name = resolveManagedMcpName(sourceId, installable);

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
      command: [CONTEXT7_DEFAULT_COMMAND, ...CONTEXT7_DEFAULT_ARGS],
      enabled: true,
      environment: {
        CONTEXT7_API_KEY: '${env:CONTEXT7_API_KEY}',
      },
    };
    next.mcp = currentMcp;
    return next;
  });
}

function upsertGeminiCliMcpConfig(settingsPath, sourceId, installable, enabled) {
  const name = resolveManagedMcpName(sourceId, installable);

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
      command: CONTEXT7_DEFAULT_COMMAND,
      args: CONTEXT7_DEFAULT_ARGS,
      env: {
        CONTEXT7_API_KEY: '$CONTEXT7_API_KEY',
      },
      trust: false,
    };
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

function applyMcpInstallable(target, sourceId, installable, targetHomes) {
  if (target === 'codex') {
    const configPath = path.join(targetHomes.codexHome, 'config.toml');
    const configPatch = patchCodexMcpConfig(configPath, sourceId, installable, true);
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
    const configPatch = upsertOpencodeMcpConfig(configPath, sourceId, installable, true);
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
    const configPatch = upsertGeminiCliMcpConfig(settingsPath, sourceId, installable, true);
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

function activateInstallable(options, payload) {
  const normalizedSourceId = normalizeExternalSourceId(payload?.sourceId);
  const installableId = normalizeString(payload?.installableId);
  const target = normalizeString(payload?.target).toLowerCase();
  if (!normalizedSourceId || !installableId || !target) {
    throw Object.assign(new Error('sourceId, installableId, and target are required'), { statusCode: 400 });
  }

  const sourceList = resolveSourceById(options, normalizedSourceId);
  const source = sourceList.source;
  const cached = loadCachedSnapshot(options.copilotHome, source.sourceId);
  if (!cached) {
    throw Object.assign(new Error(`Source ${source.sourceId} has not been refreshed yet.`), { statusCode: 409 });
  }

  const installable = cached.snapshot.installables.find((entry) => entry.installableId === installableId);
  if (!installable) {
    throw Object.assign(new Error(`Unknown installableId: ${installableId}`), { statusCode: 404 });
  }

  const supportedTargets = Array.isArray(installable.targetSupport) && installable.targetSupport.length > 0
    ? installable.targetSupport
    : installable.kind === 'skill'
      ? ['codex', 'opencode', 'antigravity']
      : ['codex', 'opencode', 'gemini-cli'];
  if (!supportedTargets.includes(target)) {
    throw Object.assign(new Error(`Installable ${installableId} does not support target ${target}.`), { statusCode: 400 });
  }

  const targetHomes = resolveTargetHomes(options);
  const extractedRoot = resolveCachedExtractedRoot(cached.sourceCacheRoot);
  if (installable.kind === 'skill' && !extractedRoot) {
    throw Object.assign(new Error(`Cached source contents for ${source.sourceId} are unavailable. Refresh the source and try again.`), {
      statusCode: 409,
    });
  }
  const materialized = installable.kind === 'skill'
    ? applySkillInstallable(target, source.sourceId, installable, extractedRoot || '', targetHomes)
    : applyMcpInstallable(target, source.sourceId, installable, targetHomes);

  const stateScan = readExternalSourcesState(options.copilotHome);
  const previousSourceState = resolveSourceStateEntry(stateScan.state, source.sourceId);
  const previousTargets = previousSourceState.targets && typeof previousSourceState.targets === 'object' ? previousSourceState.targets : {};
  const previousTargetState = previousTargets[target] && typeof previousTargets[target] === 'object' ? previousTargets[target] : {};
  const previousInstallables = previousTargetState.installables && typeof previousTargetState.installables === 'object'
    ? previousTargetState.installables
    : {};

  const nextState = {
    schemaVersion: stateScan.state.schemaVersion,
    sources: {
      ...stateScan.state.sources,
      [source.sourceId]: {
        ...previousSourceState,
        syncStatus: normalizeString(previousSourceState.syncStatus) || 'ready',
        lastSyncedAt: previousSourceState.lastSyncedAt || cached.snapshot.fetchedAt,
        lastError: null,
        resolvedRef: previousSourceState.resolvedRef || cached.snapshot.resolvedRef,
        targets: {
          ...previousTargets,
          [target]: {
            installables: {
              ...previousInstallables,
              [installable.installableId]: {
                enabled: true,
                installed: true,
                installedAt: new Date().toISOString(),
                managedName: materialized.managedName,
                installedPath: materialized.path,
                kind: installable.kind,
              },
            },
          },
        },
      },
    },
  };

  writeExternalSourcesState(options.copilotHome, nextState);

  return {
    source,
    installable,
    target,
    materialized,
    state: resolveSourceStateEntry(nextState, source.sourceId),
  };
}

function deactivateInstallable(options, payload) {
  const normalizedSourceId = normalizeExternalSourceId(payload?.sourceId);
  const installableId = normalizeString(payload?.installableId);
  const target = normalizeString(payload?.target).toLowerCase();
  if (!normalizedSourceId || !installableId || !target) {
    throw Object.assign(new Error('sourceId, installableId, and target are required'), { statusCode: 400 });
  }

  const sourceList = resolveSourceById(options, normalizedSourceId);
  const source = sourceList.source;
  const cached = loadCachedSnapshot(options.copilotHome, source.sourceId);
  if (!cached) {
    throw Object.assign(new Error(`Source ${source.sourceId} has not been refreshed yet.`), { statusCode: 409 });
  }

  const installable = cached.snapshot.installables.find((entry) => entry.installableId === installableId);
  if (!installable) {
    throw Object.assign(new Error(`Unknown installableId: ${installableId}`), { statusCode: 404 });
  }

  const targetHomes = resolveTargetHomes(options);
  const removed = installable.kind === 'skill'
    ? removeSkillInstallable(target, source.sourceId, installable, targetHomes)
    : removeMcpInstallable(target, source.sourceId, installable, targetHomes);

  const stateScan = readExternalSourcesState(options.copilotHome);
  const previousSourceState = resolveSourceStateEntry(stateScan.state, source.sourceId);
  const previousTargets = previousSourceState.targets && typeof previousSourceState.targets === 'object' ? { ...previousSourceState.targets } : {};
  const previousTargetState = previousTargets[target] && typeof previousTargets[target] === 'object' ? { ...previousTargets[target] } : {};
  const previousInstallables = previousTargetState.installables && typeof previousTargetState.installables === 'object'
    ? { ...previousTargetState.installables }
    : {};

  previousInstallables[installable.installableId] = {
    ...(previousInstallables[installable.installableId] || {}),
    enabled: false,
    installed: false,
    lastRemovedAt: new Date().toISOString(),
    managedName: removed.managedName,
    installedPath: removed.path,
    kind: installable.kind,
  };

  previousTargetState.installables = previousInstallables;
  previousTargets[target] = previousTargetState;

  const nextState = {
    schemaVersion: stateScan.state.schemaVersion,
    sources: {
      ...stateScan.state.sources,
      [source.sourceId]: {
        ...previousSourceState,
        targets: previousTargets,
      },
    },
  };
  writeExternalSourcesState(options.copilotHome, nextState);

  return {
    source,
    installable,
    target,
    removed,
    state: resolveSourceStateEntry(nextState, source.sourceId),
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
};
