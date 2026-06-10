'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const {
  buildActivationStateDocument,
  deriveDefaultsFromEngineRoot,
  resolveGlobalActivationStatePath,
  resolveRepoActivationStatePath,
} = require('./catalogActivationState');
const { appendCatalogAuditEvent } = require('./catalogAuditAnalytics');
const { getRepoStateKey } = require('./catalogProjectionService');

const SUPPORTED_KINDS = new Set(['agent', 'skill']);
const SUPPORTED_AUTHORING_SCOPES = new Set(['shared', 'user-global', 'repo-local']);
const SUPPORTED_LOAD_MODES = new Set(['always', 'on-demand']);

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeArray(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => normalizeString(entry))
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeKind(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (!SUPPORTED_KINDS.has(normalized)) {
    throw Object.assign(new Error('kind must be "agent" or "skill"'), { statusCode: 400 });
  }
  return normalized;
}

function inferKind(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (normalized === 'agent' || normalized.startsWith('agent-')) {
    return 'agent';
  }
  if (normalized === 'skill' || normalized.startsWith('skill-')) {
    return 'skill';
  }
  throw Object.assign(new Error('kind must be "agent" or "skill"'), { statusCode: 400 });
}

function normalizeAuthoringScope(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (!SUPPORTED_AUTHORING_SCOPES.has(normalized)) {
    throw Object.assign(
      new Error('authoringScope must be "shared", "user-global", or "repo-local"'),
      { statusCode: 400 },
    );
  }
  return normalized;
}

function normalizeLoadMode(value, defaultValue = 'on-demand') {
  const normalized = normalizeString(value).toLowerCase() || defaultValue;
  if (!SUPPORTED_LOAD_MODES.has(normalized)) {
    throw Object.assign(new Error('loadMode must be "always" or "on-demand"'), { statusCode: 400 });
  }
  return normalized;
}

function humanizeAssetKey(assetKey) {
  return String(assetKey || '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function normalizeAssetKey(kind, value) {
  const raw = normalizeString(value);
  if (!raw) {
    throw Object.assign(new Error('assetKey is required'), { statusCode: 400 });
  }
  if (/[\\/]/.test(raw)) {
    throw Object.assign(new Error('assetKey must be a flat name and may not contain path separators'), { statusCode: 400 });
  }

  if (kind === 'agent') {
    return raw.replace(/\.agent\.md$/i, '').replace(/^agent-/, '');
  }
  return raw.replace(/[\\/]+$/, '').replace(/^skill-/, '');
}

function deriveAssetId(kind, assetKey) {
  return `${kind}-${normalizeAssetKey(kind, assetKey)}`;
}

function ensureAbsolutePath(value, fieldName) {
  const resolved = normalizeString(value);
  if (!resolved) {
    throw Object.assign(new Error(`${fieldName} is required`), { statusCode: 400 });
  }
  if (!path.isAbsolute(resolved)) {
    throw Object.assign(new Error(`${fieldName} must be an absolute path`), { statusCode: 400 });
  }
  return path.resolve(resolved);
}

function resolveUnder(baseAbs, relPath) {
  const base = path.resolve(baseAbs);
  const absolute = path.resolve(base, relPath);
  const prefix = base.endsWith(path.sep) ? base : base + path.sep;
  if (!absolute.startsWith(prefix)) {
    throw Object.assign(new Error(`Resolved path escapes base directory: ${relPath}`), { statusCode: 400 });
  }
  return absolute;
}

function safeStat(absPath) {
  try {
    return fs.statSync(absPath);
  } catch {
    return null;
  }
}

function pathExists(absPath) {
  return Boolean(safeStat(absPath));
}

function safeRemove(absPath) {
  const stat = safeStat(absPath);
  if (!stat) {
    return;
  }
  if (stat.isDirectory()) {
    fs.rmSync(absPath, { recursive: true, force: true });
    return;
  }
  fs.unlinkSync(absPath);
}

function walkFilesRecursive(dirAbs) {
  const files = [];
  const stack = [dirAbs];

  while (stack.length > 0) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      entries = [];
    }
    for (const entry of entries) {
      const absPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absPath);
      } else if (entry.isFile()) {
        files.push(absPath);
      }
    }
  }

  files.sort((a, b) => a.localeCompare(b));
  return files;
}

function sha256FileHex(absPath) {
  try {
    const hash = crypto.createHash('sha256');
    const fd = fs.openSync(absPath, 'r');
    try {
      const buffer = Buffer.allocUnsafe(64 * 1024);
      while (true) {
        const bytes = fs.readSync(fd, buffer, 0, buffer.length, null);
        if (!bytes) {
          break;
        }
        hash.update(buffer.subarray(0, bytes));
      }
    } finally {
      fs.closeSync(fd);
    }
    return hash.digest('hex');
  } catch {
    return null;
  }
}

function sha256PathHex(absPath) {
  const stat = safeStat(absPath);
  if (!stat) {
    return null;
  }
  if (stat.isFile()) {
    return sha256FileHex(absPath);
  }
  if (!stat.isDirectory()) {
    return null;
  }

  const base = path.resolve(absPath);
  const files = walkFilesRecursive(base);
  const hash = crypto.createHash('sha256');

  for (const filePath of files) {
    const relPath = path.relative(base, filePath).split(path.sep).join('/');
    const fileHash = sha256FileHex(filePath);
    if (!fileHash) {
      return null;
    }
    hash.update(relPath);
    hash.update('\0');
    hash.update(fileHash);
    hash.update('\n');
  }

  return hash.digest('hex');
}

function assertHashMatches(absPath, expectedHash, fieldName = 'expectedHash') {
  if (expectedHash == null || expectedHash === '') {
    return;
  }
  const actualHash = sha256PathHex(absPath);
  if (actualHash !== String(expectedHash)) {
    throw Object.assign(
      new Error(`${fieldName} does not match current content`),
      { statusCode: 409, code: 'content_conflict', actualHash },
    );
  }
}

function createTempSibling(absPath, suffix) {
  const dir = path.dirname(absPath);
  const base = path.basename(absPath);
  return path.join(
    dir,
    `.${base}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.${suffix}`,
  );
}

function copyPathContents(sourceAbs, destinationAbs) {
  const stat = safeStat(sourceAbs);
  if (!stat) {
    throw Object.assign(new Error(`Source path not found: ${sourceAbs}`), { statusCode: 404 });
  }

  if (stat.isDirectory()) {
    fs.mkdirSync(destinationAbs, { recursive: true });
    if (typeof fs.cpSync === 'function') {
      for (const entry of fs.readdirSync(sourceAbs, { withFileTypes: true })) {
        const sourceEntryAbs = path.join(sourceAbs, entry.name);
        const destinationEntryAbs = path.join(destinationAbs, entry.name);
        fs.cpSync(sourceEntryAbs, destinationEntryAbs, { recursive: true, force: true });
      }
      return;
    }

    for (const filePath of walkFilesRecursive(sourceAbs)) {
      const relPath = path.relative(sourceAbs, filePath);
      const outPath = path.join(destinationAbs, relPath);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.copyFileSync(filePath, outPath);
    }
    return;
  }

  fs.mkdirSync(path.dirname(destinationAbs), { recursive: true });
  fs.copyFileSync(sourceAbs, destinationAbs);
}

function replaceTempWithTarget(targetAbs, tempAbs, rollbackSteps, finalizeSteps) {
  const existed = pathExists(targetAbs);
  if (existed) {
    const backupAbs = createTempSibling(targetAbs, 'bak');
    fs.renameSync(targetAbs, backupAbs);
    try {
      fs.renameSync(tempAbs, targetAbs);
    } catch (error) {
      if (!pathExists(targetAbs) && pathExists(backupAbs)) {
        fs.renameSync(backupAbs, targetAbs);
      }
      throw error;
    }

    rollbackSteps.unshift(() => {
      safeRemove(targetAbs);
      if (pathExists(backupAbs)) {
        fs.renameSync(backupAbs, targetAbs);
      }
    });
    finalizeSteps.push(() => safeRemove(backupAbs));
    return;
  }

  fs.renameSync(tempAbs, targetAbs);
  rollbackSteps.unshift(() => safeRemove(targetAbs));
}

function createMutationLedger() {
  const rollbackSteps = [];
  const finalizeSteps = [];
  const scratchPaths = new Set();

  function registerScratch(absPath) {
    scratchPaths.add(absPath);
  }

  function unregisterScratch(absPath) {
    scratchPaths.delete(absPath);
  }

  return {
    replaceFile(targetAbs, content, options = {}) {
      const stat = safeStat(targetAbs);
      if (options.mustExist && !stat) {
        throw Object.assign(new Error('Asset content was not found'), { statusCode: 404 });
      }
      if (options.mustNotExist && stat) {
        throw Object.assign(new Error('Asset already exists'), { statusCode: 409 });
      }
      if (stat) {
        assertHashMatches(targetAbs, options.expectedHash);
      }

      const tempAbs = createTempSibling(targetAbs, 'tmp');
      registerScratch(tempAbs);
      fs.mkdirSync(path.dirname(targetAbs), { recursive: true });
      fs.writeFileSync(tempAbs, String(content), 'utf8');
      replaceTempWithTarget(targetAbs, tempAbs, rollbackSteps, finalizeSteps);
      unregisterScratch(tempAbs);
    },

    mutateDirectory(targetAbs, mutateTemp, options = {}) {
      const stat = safeStat(targetAbs);
      if (options.mustExist && !stat) {
        throw Object.assign(new Error('Asset content was not found'), { statusCode: 404 });
      }
      if (options.mustNotExist && stat) {
        throw Object.assign(new Error('Asset already exists'), { statusCode: 409 });
      }
      if (stat) {
        assertHashMatches(targetAbs, options.expectedHash);
      }

      const tempAbs = createTempSibling(targetAbs, 'tmpdir');
      registerScratch(tempAbs);
      fs.mkdirSync(path.dirname(targetAbs), { recursive: true });
      fs.mkdirSync(tempAbs, { recursive: true });

      const seedFrom = options.seedFrom && pathExists(options.seedFrom) ? options.seedFrom : (stat ? targetAbs : null);
      if (seedFrom) {
        copyPathContents(seedFrom, tempAbs);
      }

      mutateTemp(tempAbs);
      replaceTempWithTarget(targetAbs, tempAbs, rollbackSteps, finalizeSteps);
      unregisterScratch(tempAbs);
    },

    deletePath(targetAbs, options = {}) {
      const stat = safeStat(targetAbs);
      if (!stat) {
        if (options.allowMissing) {
          return false;
        }
        throw Object.assign(new Error('Asset content was not found'), { statusCode: 404 });
      }

      assertHashMatches(targetAbs, options.expectedHash);

      const backupAbs = createTempSibling(targetAbs, 'bak');
      fs.renameSync(targetAbs, backupAbs);
      rollbackSteps.unshift(() => {
        if (!pathExists(targetAbs) && pathExists(backupAbs)) {
          fs.renameSync(backupAbs, targetAbs);
        }
      });
      finalizeSteps.push(() => safeRemove(backupAbs));
      return true;
    },

    rollback() {
      for (const step of rollbackSteps) {
        try {
          step();
        } catch {
          // Best effort rollback.
        }
      }
      for (const scratchPath of scratchPaths) {
        safeRemove(scratchPath);
      }
      scratchPaths.clear();
    },

    finalize() {
      for (const step of finalizeSteps) {
        step();
      }
      for (const scratchPath of scratchPaths) {
        safeRemove(scratchPath);
      }
      scratchPaths.clear();
    },
  };
}

function withTrailingNewline(value) {
  const text = String(value || '').replace(/\r\n/g, '\n');
  return text.endsWith('\n') ? text : `${text}\n`;
}

function escapeFrontmatterValue(value) {
  return JSON.stringify(String(value));
}

function buildMarkdownDocument({ kind, assetKey, title, description, loadMode, content, triggersOn }) {
  const bodyInput = normalizeString(content);
  if (bodyInput.startsWith('---')) {
    return withTrailingNewline(bodyInput);
  }

  const effectiveTitle = normalizeString(title) || humanizeAssetKey(assetKey);
  const lines = ['---', `name: ${assetKey}`];
  if (normalizeString(description)) {
    lines.push(`description: ${escapeFrontmatterValue(normalizeString(description))}`);
  }
  if (kind === 'skill' && normalizeString(loadMode)) {
    lines.push(`load-mode: ${normalizeLoadMode(loadMode)}`);
  }
  lines.push('---', '', `# ${effectiveTitle}`);

  if (normalizeString(description)) {
    lines.push('', normalizeString(description));
  }
  const triggers = normalizeArray(triggersOn);
  if (kind === 'skill' && triggers.length > 0) {
    lines.push('', `Triggers on: ${triggers.join(', ')}`);
  }
  if (bodyInput) {
    lines.push('', bodyInput);
  }

  return withTrailingNewline(lines.join('\n'));
}

function readJson(absPath) {
  try {
    return JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch (error) {
    throw Object.assign(new Error(`Invalid JSON at ${absPath}: ${error.message}`), { statusCode: 500 });
  }
}

function loadManifestState(engineRoot) {
  const manifestPath = path.join(path.resolve(engineRoot), 'engine-assets', 'manifest.json');
  const manifest = readJson(manifestPath);
  if (!manifest || !Array.isArray(manifest.assets)) {
    throw Object.assign(new Error('engine-assets/manifest.json is invalid'), { statusCode: 500 });
  }
  return { manifestPath, manifest };
}

function findManifestAsset(manifest, kind, assetKey) {
  const desiredId = deriveAssetId(kind, assetKey);
  return (manifest.assets || []).find((entry) => entry && entry.id === desiredId) || null;
}

function buildManifestEntry(kind, assetKey, loadMode) {
  if (kind === 'agent') {
    return {
      id: deriveAssetId(kind, assetKey),
      type: 'agent',
      source: `engine-assets/agents/${assetKey}.agent.md`,
      destination: `agents/${assetKey}.agent.md`,
    };
  }

  return {
    id: deriveAssetId(kind, assetKey),
    type: 'skill',
    source: `engine-assets/skills/${assetKey}`,
    destination: `skills/${assetKey}`,
    loadMode: normalizeLoadMode(loadMode),
  };
}

function stringifyJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function resolveSharedAuthoring(engineRoot, kind, assetKey, authoringRepoPath) {
  const selectedRepoPath = ensureAbsolutePath(authoringRepoPath, 'authoringRepoPath');
  const engineRootAbs = path.resolve(engineRoot);
  if (selectedRepoPath !== engineRootAbs) {
    throw Object.assign(
      new Error('Shared shipped assets may only be authored when instruction-engine is the selected repo/workspace'),
      { statusCode: 400 },
    );
  }

  if (kind === 'agent') {
    const primaryFilePath = path.join(engineRootAbs, 'engine-assets', 'agents', `${assetKey}.agent.md`);
    return {
      authoringScope: 'shared',
      assetRootPath: primaryFilePath,
      primaryFilePath,
      scope: { kind: 'global' },
    };
  }

  const assetRootPath = path.join(engineRootAbs, 'engine-assets', 'skills', assetKey);
  return {
    authoringScope: 'shared',
    assetRootPath,
    primaryFilePath: path.join(assetRootPath, 'SKILL.md'),
    scope: { kind: 'global' },
  };
}

function getUserGlobalSkillPaths(elegyHomeAbs, assetKey) {
  const skillsRoot = path.join(elegyHomeAbs, 'skills', assetKey);
  const vaultRoot = path.join(elegyHomeAbs, 'skills-vault', assetKey);
  const existingRoots = [skillsRoot, vaultRoot].filter((entry) => pathExists(entry));
  return { skillsRoot, vaultRoot, existingRoots };
}

function resolveUserGlobalAuthoring(elegyHomeAbs, kind, assetKey, loadMode) {
  if (kind === 'agent') {
    const primaryFilePath = path.join(elegyHomeAbs, 'agents', `${assetKey}.agent.md`);
    return {
      authoringScope: 'user-global',
      assetRootPath: primaryFilePath,
      primaryFilePath,
      scope: { kind: 'user' },
      loadMode: null,
    };
  }

  const effectiveLoadMode = normalizeLoadMode(loadMode);
  const paths = getUserGlobalSkillPaths(elegyHomeAbs, assetKey);
  const assetRootPath = effectiveLoadMode === 'always' ? paths.skillsRoot : paths.vaultRoot;

  return {
    authoringScope: 'user-global',
    assetRootPath,
    primaryFilePath: path.join(assetRootPath, 'SKILL.md'),
    alternateRootPath: effectiveLoadMode === 'always' ? paths.vaultRoot : paths.skillsRoot,
    existingRoots: paths.existingRoots,
    scope: { kind: 'user' },
    loadMode: effectiveLoadMode,
  };
}

function resolveRepoLocalAuthoring(kind, assetKey, repoPath) {
  const repoRoot = ensureAbsolutePath(repoPath, 'repoPath');
  const baseDir = kind === 'agent'
    ? path.join(repoRoot, '.github', 'agents')
    : path.join(repoRoot, '.github', 'skills', assetKey);
  const primaryFilePath = kind === 'agent'
    ? path.join(baseDir, `${assetKey}.agent.md`)
    : path.join(baseDir, 'SKILL.md');
  return {
    authoringScope: 'repo-local',
    repoPath: repoRoot,
    assetRootPath: kind === 'agent' ? primaryFilePath : baseDir,
    primaryFilePath,
    scope: {
      kind: 'repo',
      ...getRepoStateKey(repoRoot),
    },
  };
}

function resolveAuthoringTarget(runtime, body, defaultLoadMode) {
  const kind = normalizeKind(body.kind);
  const assetKey = normalizeAssetKey(kind, body.assetKey || body.assetId);
  const authoringScope = normalizeAuthoringScope(body.authoringScope);

  if (authoringScope === 'shared') {
    return {
      kind,
      assetKey,
      assetId: deriveAssetId(kind, assetKey),
      loadMode: kind === 'skill' ? normalizeLoadMode(body.loadMode || defaultLoadMode || 'on-demand') : null,
      ...resolveSharedAuthoring(runtime.engineRoot, kind, assetKey, body.authoringRepoPath || body.repoPath),
    };
  }

  if (authoringScope === 'user-global') {
    return {
      kind,
      assetKey,
      assetId: deriveAssetId(kind, assetKey),
      ...resolveUserGlobalAuthoring(runtime.elegyHomeAbs, kind, assetKey, body.loadMode || defaultLoadMode),
    };
  }

  return {
    kind,
    assetKey,
    assetId: deriveAssetId(kind, assetKey),
    ...resolveRepoLocalAuthoring(kind, assetKey, body.repoPath),
    loadMode: kind === 'skill' ? normalizeLoadMode(body.loadMode || defaultLoadMode) : null,
  };
}

function ensureSingleUserGlobalSkillLocation(target, mode) {
  if (target.kind !== 'skill' || target.authoringScope !== 'user-global') {
    return;
  }
  if ((target.existingRoots || []).length > 1) {
    throw Object.assign(
      new Error(`Refusing to ${mode} a user-global skill while both skills/ and skills-vault/ copies exist`),
      { statusCode: 409 },
    );
  }
}

function loadExistingSharedManifestEntry(engineRoot, kind, assetKey) {
  const { manifestPath, manifest } = loadManifestState(engineRoot);
  return {
    manifestPath,
    manifest,
    existing: findManifestAsset(manifest, kind, assetKey),
  };
}

function buildMutationResult(target, action, contentHash, extra = {}) {
  return {
    action,
    authoringScope: target.authoringScope,
    assetId: target.assetId,
    assetKey: target.assetKey,
    assetKind: target.kind,
    scope: target.scope,
    loadMode: target.loadMode || null,
    contentHash,
    ...extra,
  };
}

function uniqueSelectors(selectors) {
  const seen = new Set();
  const result = [];
  for (const selector of selectors || []) {
    const normalized = selector && typeof selector === 'object' ? selector : {};
    const key = JSON.stringify({
      repoPath: normalized.repoPath || null,
      repoId: normalized.repoId || null,
    });
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function finalizeMutation(runtime, options, ledger, result, auditInput) {
  const refreshSelectors = uniqueSelectors(result.refreshSelectors && result.refreshSelectors.length > 0
    ? result.refreshSelectors
    : [{}]);

  let refreshes = [];
  try {
    refreshes = typeof options.refreshProjections === 'function'
      ? options.refreshProjections(refreshSelectors, result.refreshReason || 'catalog_mutation')
      : [];
  } catch (error) {
    ledger.rollback();
    try {
      if (typeof options.refreshProjections === 'function') {
        options.refreshProjections(refreshSelectors, 'catalog_mutation_rollback');
      }
    } catch {
      // ignore rollback refresh failures
    }
    throw error;
  }

  ledger.finalize();

  const audit = appendCatalogAuditEvent(runtime.elegyHomeAbs, auditInput, options.auditDeps || {});
  return {
    ...result,
    refreshes,
    audit,
  };
}

function createAsset(runtime, body, options = {}) {
  const defaultLoadMode = normalizeKind(body.kind) === 'skill' ? normalizeLoadMode(body.loadMode) : undefined;
  const target = resolveAuthoringTarget(runtime, body, defaultLoadMode);
  ensureSingleUserGlobalSkillLocation(target, 'create');

  const ledger = createMutationLedger();
  try {
    const document = buildMarkdownDocument({
      kind: target.kind,
      assetKey: target.assetKey,
      title: body.title,
      description: body.description,
      loadMode: target.loadMode,
      content: body.content,
      triggersOn: body.triggersOn,
    });

    if (target.kind === 'agent') {
      ledger.replaceFile(target.primaryFilePath, document, { mustNotExist: true });
    } else {
      ledger.mutateDirectory(
        target.assetRootPath,
        (tempRoot) => {
          fs.mkdirSync(tempRoot, { recursive: true });
          fs.writeFileSync(path.join(tempRoot, 'SKILL.md'), document, 'utf8');
        },
        { mustNotExist: true },
      );
    }

    if (target.authoringScope === 'shared') {
      const { manifestPath, manifest, existing } = loadExistingSharedManifestEntry(runtime.engineRoot, target.kind, target.assetKey);
      if (existing) {
        throw Object.assign(new Error('Manifest already contains this shared asset'), { statusCode: 409 });
      }
      manifest.assets.push(buildManifestEntry(target.kind, target.assetKey, target.loadMode));
      ledger.replaceFile(manifestPath, stringifyJson(manifest), { mustExist: true });
    }

    const finalHash = sha256PathHex(target.kind === 'skill' ? target.assetRootPath : target.primaryFilePath);
    return finalizeMutation(
      runtime,
      options,
      ledger,
      buildMutationResult(target, 'created', finalHash, {
        refreshSelectors: target.authoringScope === 'repo-local' ? [{ repoPath: target.repoPath }] : [{}],
        refreshReason: 'catalog_asset_create',
      }),
      {
        actor: {
          kind: 'ui',
          id: 'copilot-ui-backend',
          label: 'copilot-ui-backend',
        },
        eventType: 'asset.created',
        assetId: target.assetId,
        assetKey: target.assetKey,
        assetKind: target.kind,
        scope: target.scope,
        repoId: target.scope?.repoId,
        details: {
          authoringScope: target.authoringScope,
          loadMode: target.loadMode || undefined,
        },
      },
    );
  } catch (error) {
    ledger.rollback();
    throw error;
  }
}

function updateAsset(runtime, body, options = {}) {
  const kind = normalizeKind(body.kind);
  const target = resolveAuthoringTarget(runtime, body, kind === 'skill' ? body.loadMode || 'on-demand' : undefined);
  ensureSingleUserGlobalSkillLocation(target, 'update');

  const ledger = createMutationLedger();
  try {
    let expectedHash = normalizeString(body.expectedHash) || undefined;
    let seedFrom = null;

    if (target.authoringScope === 'user-global' && target.kind === 'skill') {
      const { existingRoots } = getUserGlobalSkillPaths(runtime.elegyHomeAbs, target.assetKey);
      if (existingRoots.length > 1) {
        throw Object.assign(
          new Error('Refusing to update a user-global skill while both skills/ and skills-vault/ copies exist'),
          { statusCode: 409 },
        );
      }
      if (existingRoots.length === 0) {
        throw Object.assign(new Error('Asset content was not found'), { statusCode: 404 });
      }
      seedFrom = existingRoots[0];
    }

    const document = buildMarkdownDocument({
      kind: target.kind,
      assetKey: target.assetKey,
      title: body.title,
      description: body.description,
      loadMode: target.loadMode,
      content: body.content,
      triggersOn: body.triggersOn,
    });

    if (target.kind === 'agent') {
      ledger.replaceFile(target.primaryFilePath, document, {
        mustExist: true,
        expectedHash,
      });
    } else {
      ledger.mutateDirectory(
        target.assetRootPath,
        (tempRoot) => {
          fs.mkdirSync(tempRoot, { recursive: true });
          fs.writeFileSync(path.join(tempRoot, 'SKILL.md'), document, 'utf8');
        },
        {
          mustExist: !seedFrom,
          expectedHash,
          seedFrom,
        },
      );

      if (seedFrom && path.resolve(seedFrom) !== path.resolve(target.assetRootPath)) {
        ledger.deletePath(seedFrom, {
          expectedHash,
        });
      }
    }

    if (target.authoringScope === 'shared') {
      const { manifestPath, manifest, existing } = loadExistingSharedManifestEntry(runtime.engineRoot, target.kind, target.assetKey);
      if (!existing) {
        throw Object.assign(new Error('Manifest is missing this shared asset'), { statusCode: 404 });
      }
      const nextAssets = manifest.assets.map((entry) => {
        if (!entry || entry.id !== target.assetId) {
          return entry;
        }
        if (target.kind === 'skill') {
          return {
            ...entry,
            loadMode: target.loadMode,
          };
        }
        return entry;
      });
      manifest.assets = nextAssets;
      ledger.replaceFile(manifestPath, stringifyJson(manifest), { mustExist: true });
    }

    const finalHash = sha256PathHex(target.kind === 'skill' ? target.assetRootPath : target.primaryFilePath);
    return finalizeMutation(
      runtime,
      options,
      ledger,
      buildMutationResult(target, 'updated', finalHash, {
        refreshSelectors: target.authoringScope === 'repo-local' ? [{ repoPath: target.repoPath }] : [{}],
        refreshReason: 'catalog_asset_update',
      }),
      {
        actor: {
          kind: 'ui',
          id: 'copilot-ui-backend',
          label: 'copilot-ui-backend',
        },
        eventType: 'asset.updated',
        assetId: target.assetId,
        assetKey: target.assetKey,
        assetKind: target.kind,
        scope: target.scope,
        repoId: target.scope?.repoId,
        details: {
          authoringScope: target.authoringScope,
          loadMode: target.loadMode || undefined,
        },
      },
    );
  } catch (error) {
    ledger.rollback();
    throw error;
  }
}

function deleteAsset(runtime, body, options = {}) {
  const target = resolveAuthoringTarget(runtime, body, body.loadMode || 'on-demand');
  ensureSingleUserGlobalSkillLocation(target, 'delete');

  const ledger = createMutationLedger();
  try {
    const expectedHash = normalizeString(body.expectedHash) || undefined;
    let deleted = false;

    if (target.authoringScope === 'user-global' && target.kind === 'skill') {
      const { existingRoots } = getUserGlobalSkillPaths(runtime.elegyHomeAbs, target.assetKey);
      if (existingRoots.length > 1) {
        throw Object.assign(
          new Error('Refusing to delete a user-global skill while both skills/ and skills-vault/ copies exist'),
          { statusCode: 409 },
        );
      }
      if (existingRoots.length === 0) {
        throw Object.assign(new Error('Asset content was not found'), { statusCode: 404 });
      }
      assertHashMatches(existingRoots[0], expectedHash);
      deleted = ledger.deletePath(existingRoots[0], { expectedHash });
    } else {
      deleted = ledger.deletePath(target.kind === 'skill' ? target.assetRootPath : target.primaryFilePath, {
        expectedHash,
        allowMissing: target.authoringScope === 'shared',
      });
    }

    if (target.authoringScope === 'shared') {
      const { manifestPath, manifest, existing } = loadExistingSharedManifestEntry(runtime.engineRoot, target.kind, target.assetKey);
      if (!existing && !deleted) {
        throw Object.assign(new Error('Shared asset was not found'), { statusCode: 404 });
      }
      if (existing) {
        manifest.assets = manifest.assets.filter((entry) => entry && entry.id !== target.assetId);
        ledger.replaceFile(manifestPath, stringifyJson(manifest), { mustExist: true });
      }
    }

    return finalizeMutation(
      runtime,
      options,
      ledger,
      buildMutationResult(target, 'deleted', null, {
        refreshSelectors: target.authoringScope === 'repo-local' ? [{ repoPath: target.repoPath }] : [{}],
        refreshReason: 'catalog_asset_delete',
      }),
      {
        actor: {
          kind: 'ui',
          id: 'copilot-ui-backend',
          label: 'copilot-ui-backend',
        },
        eventType: 'asset.removed',
        assetId: target.assetId,
        assetKey: target.assetKey,
        assetKind: target.kind,
        scope: target.scope,
        repoId: target.scope?.repoId,
        details: {
          authoringScope: target.authoringScope,
        },
      },
    );
  } catch (error) {
    ledger.rollback();
    throw error;
  }
}

function installAsset(runtime, body, options = {}) {
  const assetId = normalizeString(body.assetId);
  if (!assetId) {
    throw Object.assign(new Error('assetId is required'), { statusCode: 400 });
  }

  const { manifest } = loadManifestState(runtime.engineRoot);
  const manifestAsset = (manifest.assets || []).find((entry) => entry && entry.id === assetId);
  if (!manifestAsset) {
    throw Object.assign(new Error(`Unknown assetId: ${assetId}`), { statusCode: 404 });
  }
  if (!SUPPORTED_KINDS.has(String(manifestAsset.type || '').trim())) {
    throw Object.assign(new Error('Only agent and skill assets can be installed'), { statusCode: 400 });
  }

  const sourceAbs = resolveUnder(runtime.engineRoot, manifestAsset.source);
  const sourceHash = sha256PathHex(sourceAbs);
  if (!sourceHash) {
    throw Object.assign(new Error('Source asset content is missing or unreadable'), { statusCode: 404 });
  }

  const force = Boolean(body.force);
  const ledger = createMutationLedger();
  try {
    const destinations = [];

    if (manifestAsset.type === 'agent') {
      destinations.push(path.join(runtime.elegyHomeAbs, manifestAsset.destination));
    } else {
      const assetKey = normalizeAssetKey('skill', path.basename(String(manifestAsset.source || '')));
      const loadMode = normalizeLoadMode(manifestAsset.loadMode || 'on-demand');
      destinations.push(path.join(runtime.elegyHomeAbs, 'skills-vault', assetKey));
      if (loadMode === 'always') {
        destinations.push(path.join(runtime.elegyHomeAbs, 'skills', assetKey));
      }
    }

    for (const destinationAbs of destinations) {
      const destinationHash = sha256PathHex(destinationAbs);
      if (!force && destinationHash && destinationHash !== sourceHash) {
        throw Object.assign(
          new Error(`Destination differs from source: ${destinationAbs}`),
          { statusCode: 409, code: 'install_conflict', destinationHash, sourceHash },
        );
      }

      if (safeStat(sourceAbs)?.isDirectory()) {
        ledger.mutateDirectory(
          destinationAbs,
          (tempRoot) => {
            safeRemove(tempRoot);
            fs.mkdirSync(tempRoot, { recursive: true });
            copyPathContents(sourceAbs, tempRoot);
          },
          {
            mustExist: false,
          },
        );
      } else {
        const tempContent = fs.readFileSync(sourceAbs, 'utf8');
        ledger.replaceFile(destinationAbs, tempContent, {});
      }
    }

    return finalizeMutation(
      runtime,
      options,
      ledger,
      {
        action: 'installed',
        assetId,
        assetKind: manifestAsset.type,
        loadMode: manifestAsset.type === 'skill' ? normalizeLoadMode(manifestAsset.loadMode || 'on-demand') : null,
        installedPaths: destinations,
        sourceHash,
        refreshSelectors: [{}],
        refreshReason: 'catalog_asset_install',
      },
      {
        actor: {
          kind: 'ui',
          id: 'copilot-ui-backend',
          label: 'copilot-ui-backend',
        },
        eventType: 'asset.installed',
        assetId,
        assetKey: assetId.replace(/^(agent|skill)-/, ''),
        assetKind: manifestAsset.type,
        scope: { kind: 'user' },
        details: {
          loadMode: manifestAsset.loadMode || undefined,
        },
      },
    );
  } catch (error) {
    ledger.rollback();
    throw error;
  }
}

function setAssetEnabled(runtime, body, enabled, options = {}) {
  const kind = inferKind(body.kind || body.assetId);
  const assetKey = normalizeAssetKey(kind, body.assetKey || body.assetId);
  const repoPath = ensureAbsolutePath(body.repoPath, 'repoPath');
  const repoStateKey = getRepoStateKey(repoPath);
  const registryPath = path.join(runtime.elegyHomeAbs, 'repo-state', repoStateKey.repoId, 'registry.json');
  const registry = pathExists(registryPath) ? readJson(registryPath) : {};

  const sectionKey = kind === 'skill' ? 'skills' : 'agents';
  const section = registry[sectionKey] && typeof registry[sectionKey] === 'object' ? registry[sectionKey] : {};
  const disabled = new Set(normalizeArray(section.disabled).map((entry) => normalizeAssetKey(kind, entry)));
  const explicitlyEnabled = new Set(normalizeArray(section.enabled).map((entry) => normalizeAssetKey(kind, entry)));

  if (enabled) {
    disabled.delete(assetKey);
    explicitlyEnabled.add(assetKey);
  } else {
    explicitlyEnabled.delete(assetKey);
    disabled.add(assetKey);
  }

  const nextRegistry = {
    ...registry,
    [sectionKey]: {
      ...Object.fromEntries(
        Object.entries(section).filter(([key]) => key !== 'enabled' && key !== 'disabled'),
      ),
      ...(explicitlyEnabled.size > 0 ? { enabled: Array.from(explicitlyEnabled).sort() } : {}),
      ...(disabled.size > 0 ? { disabled: Array.from(disabled).sort() } : {}),
    },
  };

  if (!nextRegistry[sectionKey].enabled) {
    delete nextRegistry[sectionKey].enabled;
  }
  if (!nextRegistry[sectionKey].disabled) {
    delete nextRegistry[sectionKey].disabled;
  }
  if (Object.keys(nextRegistry[sectionKey]).length === 0) {
    delete nextRegistry[sectionKey];
  }

  const expectedHash = normalizeString(body.expectedRegistryHash) || undefined;
  if (pathExists(registryPath)) {
    assertHashMatches(registryPath, expectedHash, 'expectedRegistryHash');
  } else if (expectedHash) {
    throw Object.assign(new Error('expectedRegistryHash does not match current content'), { statusCode: 409 });
  }

  const ledger = createMutationLedger();
  try {
    ledger.replaceFile(registryPath, stringifyJson(nextRegistry), {});
    const registryHash = sha256PathHex(registryPath);
    return finalizeMutation(
      runtime,
      options,
      ledger,
      {
        action: enabled ? 'enabled' : 'disabled',
        assetId: deriveAssetId(kind, assetKey),
        assetKey,
        assetKind: kind,
        registryHash,
        repoId: repoStateKey.repoId,
        refreshSelectors: [{ repoPath }],
        refreshReason: enabled ? 'catalog_asset_enable' : 'catalog_asset_disable',
      },
      {
        actor: {
          kind: 'ui',
          id: 'copilot-ui-backend',
          label: 'copilot-ui-backend',
        },
        eventType: enabled ? 'asset.enabled' : 'asset.disabled',
        assetId: deriveAssetId(kind, assetKey),
        assetKey,
        assetKind: kind,
        scope: {
          kind: 'repo',
          repoId: repoStateKey.repoId,
          displayName: repoStateKey.repoLabel,
        },
        repoId: repoStateKey.repoId,
      },
    );
  } catch (error) {
    ledger.rollback();
    throw error;
  }
}

function resolveManagedBundleMemberDestinations(elegyHomeAbs, manifestAsset) {
  if (!manifestAsset || typeof manifestAsset !== 'object') {
    return [];
  }

  if (manifestAsset.type === 'skill') {
    const assetKey = normalizeAssetKey('skill', path.basename(String(manifestAsset.source || '')));
    if (!assetKey) {
      return [];
    }
    return [
      path.join(elegyHomeAbs, 'skills', assetKey),
      path.join(elegyHomeAbs, 'skills-vault', assetKey),
    ];
  }

  if (manifestAsset.type === 'agent') {
    const destination = normalizeString(manifestAsset.destination);
    return destination ? [path.join(elegyHomeAbs, destination)] : [];
  }

  return [];
}

function omitEmptySections(document) {
  const nextDocument = document && typeof document === 'object' ? { ...document } : {};
  for (const [sectionKey, sectionValue] of Object.entries(nextDocument)) {
    if (Array.isArray(sectionValue)) {
      if (sectionValue.length === 0) {
        delete nextDocument[sectionKey];
      }
      continue;
    }
    if (!sectionValue || typeof sectionValue !== 'object') {
      continue;
    }
    if (Object.keys(sectionValue).length === 0) {
      delete nextDocument[sectionKey];
    }
  }
  return nextDocument;
}

function isPlainObjectEmpty(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0);
}

function writeJsonDocumentOrDelete(ledger, targetPath, value, options = {}) {
  if (isPlainObjectEmpty(value)) {
    return ledger.deletePath(targetPath, { allowMissing: true });
  }
  ledger.replaceFile(targetPath, stringifyJson(value), options);
  return true;
}

function uninstallBundle(runtime, body, options = {}) {
  const bundleId = normalizeString(body.bundleId);
  if (!bundleId) {
    throw Object.assign(new Error('bundleId is required'), { statusCode: 400 });
  }

  const repoPath = normalizeString(body.repoPath)
    ? ensureAbsolutePath(body.repoPath, 'repoPath')
    : null;
  const repoStateKey = repoPath ? getRepoStateKey(repoPath) : null;
  const registryPath = repoStateKey
    ? path.join(runtime.elegyHomeAbs, 'repo-state', repoStateKey.repoId, 'registry.json')
    : null;
  const repoActivationPath = repoPath
    ? resolveRepoActivationStatePath(runtime.elegyHomeAbs, repoPath).path
    : null;

  const { manifest } = loadManifestState(runtime.engineRoot);
  const bundle = Array.isArray(manifest.bundles)
    ? manifest.bundles.find((entry) => entry && (entry.id === bundleId || entry.bundleId === bundleId))
    : null;
  if (!bundle) {
    throw Object.assign(new Error(`Unknown bundleId: ${bundleId}`), { statusCode: 404 });
  }

  const manifestAssetsById = new Map(
    (Array.isArray(manifest.assets) ? manifest.assets : [])
      .filter((entry) => entry && entry.id)
      .map((entry) => [entry.id, entry])
  );

  const bundleMemberIds = normalizeArray(bundle.assetIds);
  const memberAssetKeysByKind = {
    skill: new Set(),
    agent: new Set(),
  };
  const removedPaths = [];
  const removedAssetIds = [];
  const skippedAssetIds = [];
  const managedMembers = [];

  const ledger = createMutationLedger();
  try {
    for (const assetId of bundleMemberIds) {
      const manifestAsset = manifestAssetsById.get(assetId) || null;
      if (!manifestAsset || !SUPPORTED_KINDS.has(String(manifestAsset.type || '').trim())) {
        skippedAssetIds.push(assetId);
        continue;
      }

      managedMembers.push(manifestAsset);
      if (manifestAsset.type === 'skill') {
        memberAssetKeysByKind.skill.add(
          normalizeAssetKey('skill', path.basename(String(manifestAsset.source || '')))
        );
      } else if (manifestAsset.type === 'agent') {
        memberAssetKeysByKind.agent.add(
          normalizeAssetKey('agent', path.basename(String(manifestAsset.destination || manifestAsset.source || '')))
        );
      }

      let removedForAsset = false;
      for (const destinationAbs of resolveManagedBundleMemberDestinations(runtime.elegyHomeAbs, manifestAsset)) {
        const deleted = ledger.deletePath(destinationAbs, { allowMissing: true });
        if (deleted) {
          removedPaths.push(destinationAbs);
          removedForAsset = true;
        }
      }
      if (removedForAsset) {
        removedAssetIds.push(assetId);
      }
    }

    const defaults = loadActivationDefaults(runtime);
    const globalActivationPath = resolveGlobalActivationStatePath(runtime.elegyHomeAbs);
    const existingGlobalState = pathExists(globalActivationPath) ? readJson(globalActivationPath) : {};
    const existingGlobalBundleIds = Array.isArray(existingGlobalState.activeBundleIds)
      ? existingGlobalState.activeBundleIds
      : defaults.activeBundleIds;
    const nextGlobalDocument = buildActivationStateDocument({
      ...existingGlobalState,
      activeBundleIds: existingGlobalBundleIds.filter((candidate) => candidate !== bundleId),
      plannerProfile: normalizeString(existingGlobalState.plannerProfile) || defaults.plannerProfile,
      orchestrationPolicy:
        normalizeString(existingGlobalState.orchestrationPolicy)
        || normalizeString(existingGlobalState.plannerProfile)
        || defaults.orchestrationPolicy,
    });
    ledger.replaceFile(globalActivationPath, stringifyJson(nextGlobalDocument), {});

    let repoActivationCleared = false;
    if (repoActivationPath) {
      const existingRepoState = pathExists(repoActivationPath) ? readJson(repoActivationPath) : null;
      if (existingRepoState) {
        const nextRepoBundleIds = normalizeArray(existingRepoState.activeBundleIds)
          .filter((candidate) => candidate !== bundleId);
        const nextRepoDocument = buildActivationStateDocument({
          ...existingRepoState,
          activeBundleIds: nextRepoBundleIds,
          repoId: repoStateKey.repoId,
          repoPath,
        });
        const repoDocumentWithoutEmptyBundles = { ...nextRepoDocument };
        if (nextRepoBundleIds.length === 0) {
          delete repoDocumentWithoutEmptyBundles.activeBundleIds;
        }
        if (!normalizeString(repoDocumentWithoutEmptyBundles.plannerProfile)) {
          delete repoDocumentWithoutEmptyBundles.plannerProfile;
        }
        if (!normalizeString(repoDocumentWithoutEmptyBundles.orchestrationPolicy)) {
          delete repoDocumentWithoutEmptyBundles.orchestrationPolicy;
        }
        delete repoDocumentWithoutEmptyBundles.updatedAt;
        delete repoDocumentWithoutEmptyBundles.schemaVersion;
        delete repoDocumentWithoutEmptyBundles.repoId;
        delete repoDocumentWithoutEmptyBundles.repoPath;

        if (Object.keys(repoDocumentWithoutEmptyBundles).length === 0) {
          repoActivationCleared = Boolean(ledger.deletePath(repoActivationPath, { allowMissing: true }));
        } else {
          ledger.replaceFile(repoActivationPath, stringifyJson(nextRepoDocument), {});
          repoActivationCleared = true;
        }
      }
    }

    let registryUpdated = false;
    if (registryPath && pathExists(registryPath)) {
      const registry = readJson(registryPath);
      const nextRegistry = omitEmptySections({
        ...registry,
        skills: registry.skills && typeof registry.skills === 'object'
          ? omitEmptySections({
            ...registry.skills,
            enabled: normalizeArray(registry.skills.enabled)
              .filter((entry) => !memberAssetKeysByKind.skill.has(normalizeAssetKey('skill', entry))),
            disabled: normalizeArray(registry.skills.disabled)
              .filter((entry) => !memberAssetKeysByKind.skill.has(normalizeAssetKey('skill', entry))),
          })
          : registry.skills,
        agents: registry.agents && typeof registry.agents === 'object'
          ? omitEmptySections({
            ...registry.agents,
            enabled: normalizeArray(registry.agents.enabled)
              .filter((entry) => !memberAssetKeysByKind.agent.has(normalizeAssetKey('agent', entry))),
            disabled: normalizeArray(registry.agents.disabled)
              .filter((entry) => !memberAssetKeysByKind.agent.has(normalizeAssetKey('agent', entry))),
          })
          : registry.agents,
      });

      registryUpdated = JSON.stringify(nextRegistry) !== JSON.stringify(registry);
      if (registryUpdated) {
        writeJsonDocumentOrDelete(ledger, registryPath, nextRegistry, {});
      }
    }

    const refreshSelectors = [{}];
    if (repoPath) {
      refreshSelectors.push({ repoPath });
    }

    return finalizeMutation(
      runtime,
      options,
      ledger,
      {
        action: 'bundle-uninstalled',
        bundleId,
        repoId: repoStateKey?.repoId || null,
        removedAssetIds,
        removedPaths,
        removedCount: removedPaths.length,
        skippedAssetIds,
        activationStateCleared: true,
        repoActivationCleared,
        overlayStateCleared: registryUpdated,
        preserveExternalPackages: true,
        refreshSelectors,
        refreshReason: 'catalog_bundle_uninstall',
      },
      {
        actor: {
          kind: 'ui',
          id: 'copilot-ui-backend',
          label: 'copilot-ui-backend',
        },
        eventType: 'catalog.bundle.uninstalled',
        repoId: repoStateKey?.repoId || null,
        scope: repoPath
          ? {
            kind: 'repo',
            repoId: repoStateKey.repoId,
            repoPath,
            displayName: repoStateKey.repoLabel,
          }
          : { kind: 'user' },
        details: {
          bundleId,
          memberAssetIds: managedMembers.map((entry) => entry.id),
          removedAssetIds,
          removedPaths,
          skippedAssetIds,
          preserveExternalPackages: true,
          repoActivationCleared,
          overlayStateCleared: registryUpdated,
        },
      },
    );
  } catch (error) {
    ledger.rollback();
    throw error;
  }
}

function normalizeActivationAction(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (!['activate-bundle', 'deactivate-bundle', 'set-profile', 'clear-repo-override'].includes(normalized)) {
    throw Object.assign(
      new Error('action must be "activate-bundle", "deactivate-bundle", "set-profile", or "clear-repo-override"'),
      { statusCode: 400 },
    );
  }
  return normalized;
}

function resolveActivationMutationTarget(runtime, body) {
  const repoPath = normalizeString(body.repoPath);
  if (!repoPath) {
    return {
      scope: { kind: 'user' },
      targetScope: 'user-global',
      statePath: resolveGlobalActivationStatePath(runtime.elegyHomeAbs),
      repoPath: null,
      repoStateKey: null,
    };
  }

  const absoluteRepoPath = ensureAbsolutePath(repoPath, 'repoPath');
  const repoStateKey = getRepoStateKey(absoluteRepoPath);
  const repoActivationPath = resolveRepoActivationStatePath(runtime.elegyHomeAbs, absoluteRepoPath);
  return {
    scope: {
      kind: 'repo',
      repoId: repoStateKey.repoId,
      displayName: repoStateKey.repoLabel,
    },
    targetScope: 'repo-override',
    statePath: repoActivationPath.path,
    repoPath: absoluteRepoPath,
    repoStateKey,
  };
}

function loadActivationDefaults(runtime) {
  return deriveDefaultsFromEngineRoot(runtime.engineRoot);
}

function updateCatalogActivation(runtime, body, options = {}) {
  const action = normalizeActivationAction(body.action);
  const target = resolveActivationMutationTarget(runtime, body);
  const defaults = loadActivationDefaults(runtime);
  const globalStatePath = resolveGlobalActivationStatePath(runtime.elegyHomeAbs);
  const globalState = pathExists(globalStatePath) ? buildActivationStateDocument(readJson(globalStatePath)) : null;
  const globalEffectivePlannerProfile = normalizeString(globalState?.plannerProfile) || defaults.plannerProfile;
  const globalEffectiveOrchestrationPolicy =
    normalizeString(globalState?.orchestrationPolicy) || globalEffectivePlannerProfile || defaults.orchestrationPolicy;
  const globalEffectiveBundleIds =
    Array.isArray(globalState?.activeBundleIds)
      ? globalState.activeBundleIds
      : defaults.activeBundleIds;

  const ledger = createMutationLedger();
  try {
    if (action === 'clear-repo-override') {
      if (!target.repoPath) {
        throw Object.assign(new Error('repoPath is required to clear a repo activation override'), { statusCode: 400 });
      }

      ledger.deletePath(target.statePath, { allowMissing: true });
      return finalizeMutation(
        runtime,
        options,
        ledger,
        {
          action: 'repo-override-cleared',
          scope: target.scope,
          repoId: target.repoStateKey?.repoId || null,
          refreshSelectors: [target.repoPath ? { repoPath: target.repoPath } : {}],
          refreshReason: 'catalog_activation_override_cleared',
        },
        {
          actor: {
            kind: 'ui',
            id: 'copilot-ui-backend',
            label: 'copilot-ui-backend',
          },
          eventType: 'catalog.activation.repo_override_cleared',
          repoId: target.repoStateKey?.repoId || null,
          scope: target.scope,
        },
      );
    }

    if (action === 'set-profile') {
      const plannerProfile = normalizeString(body.plannerProfile);
      if (!plannerProfile) {
        throw Object.assign(new Error('plannerProfile is required'), { statusCode: 400 });
      }
      const nextState = pathExists(target.statePath) ? readJson(target.statePath) : {};
      const nextDocument = buildActivationStateDocument({
        ...nextState,
        plannerProfile,
        orchestrationPolicy: plannerProfile,
        ...(target.repoStateKey
          ? {
            repoId: target.repoStateKey.repoId,
            repoPath: target.repoPath,
          }
          : {}),
      });
      ledger.replaceFile(target.statePath, stringifyJson(nextDocument), {});
      return finalizeMutation(
        runtime,
        options,
        ledger,
        {
          action: 'planner-profile-set',
          scope: target.scope,
          repoId: target.repoStateKey?.repoId || null,
          plannerProfile,
          orchestrationPolicy: plannerProfile,
          refreshSelectors: [target.repoPath ? { repoPath: target.repoPath } : {}],
          refreshReason: 'catalog_activation_profile_updated',
        },
        {
          actor: {
            kind: 'ui',
            id: 'copilot-ui-backend',
            label: 'copilot-ui-backend',
          },
          eventType: 'catalog.activation.profile_set',
          repoId: target.repoStateKey?.repoId || null,
          scope: target.scope,
          details: {
            plannerProfile,
            orchestrationPolicy: plannerProfile,
          },
        },
      );
    }

    const bundleId = normalizeString(body.bundleId);
    if (!bundleId) {
      throw Object.assign(new Error('bundleId is required'), { statusCode: 400 });
    }
    if (defaults.availableBundleIds.length > 0 && !defaults.availableBundleIds.includes(bundleId)) {
      throw Object.assign(new Error(`Unknown bundleId: ${bundleId}`), { statusCode: 404 });
    }

    const existingState = pathExists(target.statePath) ? readJson(target.statePath) : {};
    const currentBundleIds = Array.isArray(existingState.activeBundleIds)
      ? existingState.activeBundleIds
      : target.repoPath
        ? globalEffectiveBundleIds
        : globalEffectiveBundleIds;
    const bundleSet = new Set(currentBundleIds.filter((candidate) => defaults.availableBundleIds.includes(candidate)));
    if (action === 'activate-bundle') {
      bundleSet.add(bundleId);
    } else {
      bundleSet.delete(bundleId);
    }

    const nextDocument = buildActivationStateDocument({
      ...existingState,
      activeBundleIds: Array.from(bundleSet).sort(),
      ...(target.repoStateKey
        ? {
          repoId: target.repoStateKey.repoId,
          repoPath: target.repoPath,
        }
        : {}),
      ...(target.repoPath
        ? {}
        : {
          plannerProfile: normalizeString(existingState.plannerProfile) || globalEffectivePlannerProfile,
          orchestrationPolicy: normalizeString(existingState.orchestrationPolicy) || globalEffectiveOrchestrationPolicy,
        }),
    });
    ledger.replaceFile(target.statePath, stringifyJson(nextDocument), {});

    const activated = action === 'activate-bundle';
    return finalizeMutation(
      runtime,
      options,
      ledger,
      {
        action: activated ? 'bundle-activated' : 'bundle-deactivated',
        scope: target.scope,
        repoId: target.repoStateKey?.repoId || null,
        bundleId,
        activeBundleIds: nextDocument.activeBundleIds || [],
        refreshSelectors: [target.repoPath ? { repoPath: target.repoPath } : {}],
        refreshReason: activated ? 'catalog_bundle_activated' : 'catalog_bundle_deactivated',
      },
      {
        actor: {
          kind: 'ui',
          id: 'copilot-ui-backend',
          label: 'copilot-ui-backend',
        },
        eventType: activated ? 'catalog.activation.bundle_activated' : 'catalog.activation.bundle_deactivated',
        repoId: target.repoStateKey?.repoId || null,
        scope: target.scope,
        details: {
          bundleId,
        },
      },
    );
  } catch (error) {
    ledger.rollback();
    throw error;
  }
}

module.exports = {
  createAsset,
  updateAsset,
  deleteAsset,
  installAsset,
  uninstallBundle,
  setAssetEnabled,
  updateCatalogActivation,
  _internals: {
    buildMarkdownDocument,
    buildManifestEntry,
    deriveAssetId,
    normalizeAssetKey,
    sha256PathHex,
  },
};
