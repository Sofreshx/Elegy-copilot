const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const {
  appendCatalogAuditEvent,
} = require('./catalogAuditAnalytics');
const {
  buildCatalogProjection,
} = require('./catalogProjectionService');

function toPosixRelPath(p) {
  return String(p || '').replace(/\\/g, '/');
}

function safeReadDir(dirAbs, opts) {
  try {
    return fs.readdirSync(dirAbs, opts);
  } catch {
    return [];
  }
}

function deriveAssetId(type, fileOrDirName) {
  const n = String(fileOrDirName || '').trim();
  if (!n) return null;
  if (type === 'agent') {
    const base = n.replace(/\.agent\.md$/i, '').replace(/^agent-/, '');
    return `agent-${base}`;
  }
  if (type === 'prompt') {
    const base = n.replace(/\.prompt\.md$/i, '');
    return `prompt-${base}`;
  }
  if (type === 'skill') {
    return `skill-${n}`;
  }
  return null;
}

function expandAssetsFromSourcePatterns(manifest, engineRootAbs) {
  if (!manifest || typeof manifest !== 'object') return manifest;

  const patterns = Array.isArray(manifest.sourcePatterns) ? manifest.sourcePatterns : [];
  if (!patterns.length) return manifest;

  const assets = Array.isArray(manifest.assets) ? [...manifest.assets] : [];
  const bySource = new Set();
  const byDestination = new Set();

  for (const a of assets) {
    if (!a || typeof a !== 'object') continue;
    if (typeof a.source === 'string' && a.source.trim()) bySource.add(toPosixRelPath(a.source.trim()));
    if (typeof a.destination === 'string' && a.destination.trim()) byDestination.add(toPosixRelPath(a.destination.trim()));
  }

  for (const p of patterns) {
    if (!p || typeof p !== 'object') continue;
    const type = String(p.type || '').trim();
    const sourceGlob = toPosixRelPath(String(p.sourceGlob || '').trim());
    const destinationDir = toPosixRelPath(String(p.destinationDir || '').trim()).replace(/\/$/, '');
    if (!type || !sourceGlob || !destinationDir) continue;

    // This is intentionally a minimal glob implementation: it supports only the simple
    // patterns we publish in engine-assets/manifest.json (flat "*" in final segment).
    if (sourceGlob === 'engine-assets/agents/*.agent.md' && type === 'agent') {
      const dirAbs = path.join(engineRootAbs, 'engine-assets', 'agents');
      const entries = safeReadDir(dirAbs, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isFile()) continue;
        if (!e.name.toLowerCase().endsWith('.agent.md')) continue;
        const fileName = e.name;

        const source = `engine-assets/agents/${fileName}`;
        const destination = `${destinationDir}/${fileName}`;
        if (bySource.has(source) || byDestination.has(destination)) continue;

        const id = deriveAssetId(type, fileName);
        if (!id) continue;
        assets.push({ id, type, source, destination });
        bySource.add(source);
        byDestination.add(destination);
      }
      continue;
    }

    if (sourceGlob === 'engine-assets/prompts/*.prompt.md' && type === 'prompt') {
      const dirAbs = path.join(engineRootAbs, 'engine-assets', 'prompts');
      const entries = safeReadDir(dirAbs, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isFile()) continue;
        if (!e.name.toLowerCase().endsWith('.prompt.md')) continue;
        const fileName = e.name;

        const source = `engine-assets/prompts/${fileName}`;
        const destination = `${destinationDir}/${fileName}`;
        if (bySource.has(source) || byDestination.has(destination)) continue;

        const id = deriveAssetId(type, fileName);
        if (!id) continue;
        assets.push({ id, type, source, destination });
        bySource.add(source);
        byDestination.add(destination);
      }
      continue;
    }

    if (sourceGlob === 'engine-assets/skills/*' && type === 'skill') {
      const dirAbs = path.join(engineRootAbs, 'engine-assets', 'skills');
      const entries = safeReadDir(dirAbs, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        const name = e.name;
        const source = `engine-assets/skills/${name}`;
        const destination = `${destinationDir}/${name}`;
        if (bySource.has(source) || byDestination.has(destination)) continue;
        const id = deriveAssetId(type, name);
        if (!id) continue;
        assets.push({ id, type, source, destination });
        bySource.add(source);
        byDestination.add(destination);
      }
      continue;
    }
  }

  assets.sort((a, b) => {
    const at = String(a.type || '');
    const bt = String(b.type || '');
    if (at !== bt) return at.localeCompare(bt);
    const ad = String(a.destination || '');
    const bd = String(b.destination || '');
    return ad.localeCompare(bd);
  });

  return { ...manifest, assets };
}

function resolveUnder(baseAbs, relPath) {
  if (typeof relPath !== 'string' || relPath.length === 0) {
    throw new Error('Path must be a non-empty string');
  }
  if (path.isAbsolute(relPath)) {
    throw new Error(`Expected relative path, got absolute: ${relPath}`);
  }

  const base = path.resolve(baseAbs);
  const abs = path.resolve(base, relPath);
  const prefix = base.endsWith(path.sep) ? base : base + path.sep;
  if (!abs.startsWith(prefix)) {
    throw new Error(`Resolved path escapes base directory: ${relPath}`);
  }
  return abs;
}

function sha256FileHex(absPath) {
  try {
    const hash = crypto.createHash('sha256');
    const fd = fs.openSync(absPath, 'r');
    try {
      const buf = Buffer.allocUnsafe(64 * 1024);
      while (true) {
        const bytes = fs.readSync(fd, buf, 0, buf.length, null);
        if (!bytes) break;
        hash.update(buf.subarray(0, bytes));
      }
    } finally {
      fs.closeSync(fd);
    }
    return hash.digest('hex');
  } catch {
    return null;
  }
}

function walkFilesRecursive(dirAbs) {
  const results = [];
  const stack = [dirAbs];

  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const abs = path.join(cur, e.name);
      if (e.isDirectory()) {
        stack.push(abs);
        continue;
      }
      if (e.isFile()) {
        results.push(abs);
      }
    }
  }

  results.sort((a, b) => a.localeCompare(b));
  return results;
}

function sha256PathHex(absPath) {
  try {
    const stat = fs.statSync(absPath);
    if (stat.isFile()) return sha256FileHex(absPath);
    if (!stat.isDirectory()) return null;

    const base = path.resolve(absPath);
    const files = walkFilesRecursive(base);
    const hash = crypto.createHash('sha256');
    for (const f of files) {
      const rel = path.relative(base, f).split(path.sep).join('/');
      const fh = sha256FileHex(f);
      if (!fh) return null;
      hash.update(rel);
      hash.update('\0');
      hash.update(fh);
      hash.update('\n');
    }
    return hash.digest('hex');
  } catch {
    return null;
  }
}

function readTextFileSafe(absPath, maxBytes) {
  try {
    const stat = fs.statSync(absPath);
    if (!stat.isFile()) return null;

    const limit = Number.isFinite(maxBytes) && maxBytes > 0 ? Math.floor(maxBytes) : 1024 * 1024;
    const fd = fs.openSync(absPath, 'r');
    try {
      const toRead = Math.min(limit, stat.size);
      const buf = Buffer.alloc(toRead);
      const bytesRead = fs.readSync(fd, buf, 0, toRead, 0);
      let text = buf.subarray(0, bytesRead).toString('utf8');
      if (stat.size > limit) text += '\n…(truncated)\n';
      return text;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

function loadManifest(engineRoot) {
  const rootAbs = path.resolve(engineRoot);
  const manifestPath = path.join(rootAbs, 'engine-assets', 'manifest.json');
  const raw = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(raw);

  if (!manifest || typeof manifest !== 'object') throw new Error('Invalid manifest JSON');
  if (!Array.isArray(manifest.assets)) throw new Error('Manifest missing assets[]');

  const expanded = expandAssetsFromSourcePatterns(manifest, rootAbs);
  return {
    ...expanded,
    _manifestPath: manifestPath,
    _engineRoot: rootAbs,
  };
}

function readJsonIfExists(absPath) {
  try {
    if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
      return null;
    }

    return JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch {
    return null;
  }
}

function getAssetPaths(engineRoot, destinationHome, asset, opts) {
  const engineAbs = path.resolve(engineRoot);
  const homeAbs = path.resolve(destinationHome);

  const sourceRel = asset.source;
  const sourceAbs = resolveUnder(engineAbs, sourceRel);
  const destinationAbs = resolveUnder(homeAbs, asset.destination);

  return { engineAbs, homeAbs, sourceAbs, destinationAbs, sourceRel };
}

function safeStat(absPath) {
  try {
    return fs.statSync(absPath);
  } catch {
    return null;
  }
}

function safeRealpath(absPath) {
  try {
    if (typeof fs.realpathSync.native === 'function') {
      return fs.realpathSync.native(absPath);
    }
    return fs.realpathSync(absPath);
  } catch {
    return null;
  }
}

function toPosixPath(inputPath) {
  return String(inputPath || '').replace(/\\/g, '/');
}

function toCopilotRelativePath(home, absPath) {
  const relativePath = path.relative(path.resolve(home), path.resolve(absPath));
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return null;
  }
  return toPosixPath(relativePath);
}

function isDirectoryLike(entry, absPath) {
  if (entry && typeof entry.isDirectory === 'function' && entry.isDirectory()) {
    return true;
  }
  return Boolean(safeStat(absPath)?.isDirectory());
}

function isFileLike(entry, absPath) {
  if (entry && typeof entry.isFile === 'function' && entry.isFile()) {
    return true;
  }
  return Boolean(safeStat(absPath)?.isFile());
}

function normalizeIdentityPart(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function inferExternalOrigin(absPath, options = {}) {
  const realPath = safeRealpath(absPath) || path.resolve(absPath);
  const normalizedRealPath = toPosixPath(realPath);
  const sourcePackageMatch = normalizedRealPath.match(/\/marketplace-cache\/([^/]+)\//i);
  const pluginNamespaceMatch = normalizedRealPath.match(/\/plugins\/([^/]+)\//i);
  const namespace = String(options.namespace || pluginNamespaceMatch?.[1] || '').trim();
  const sourcePackage = normalizeIdentityPart(sourcePackageMatch?.[1] || '');

  let provider = '';
  if (sourcePackage) {
    provider = 'copilot-marketplace-plugin';
  } else if (namespace) {
    provider = 'copilot-home-plugin';
  } else if (options.fileKind === 'plain-md') {
    provider = 'copilot-home-plain-agent';
  }

  return {
    isExternal: Boolean(provider),
    provider: provider || undefined,
    sourcePackage: sourcePackage || undefined,
    namespace: namespace || undefined,
  };
}

function buildProviderQualifiedId(type, logicalName, origin) {
  if (!origin?.isExternal) {
    return deriveAssetId(type, logicalName);
  }
  const parts = [
    normalizeIdentityPart(origin.provider),
    normalizeIdentityPart(origin.sourcePackage),
    normalizeIdentityPart(origin.namespace),
    normalizeIdentityPart(logicalName),
  ].filter(Boolean);
  return deriveAssetId(type, parts.join('-'));
}

function detectAgentFrontmatter(text) {
  const source = String(text || '');
  const frontmatterMatch = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!frontmatterMatch) {
    return { name: '', body: source };
  }

  let name = '';
  for (const line of frontmatterMatch[1].split(/\r?\n/)) {
    const match = line.match(/^name:\s*(.+?)\s*$/i);
    if (match) {
      name = match[1].trim();
      break;
    }
  }

  return {
    name,
    body: source.slice(frontmatterMatch[0].length),
  };
}

function isRecognizedAgentFile(entryName, absPath) {
  const normalizedFileName = String(entryName || '').trim().toLowerCase();
  if (normalizedFileName.endsWith('.agent.md')) {
    return {
      recognized: true,
      logicalName: entryName.slice(0, -'.agent.md'.length),
      fileKind: 'agent-md',
    };
  }
  if (!normalizedFileName.endsWith('.md') || normalizedFileName.endsWith('.prompt.md')) {
    return { recognized: false };
  }

  const text = readTextFileSafe(absPath, 128 * 1024);
  const parsed = detectAgentFrontmatter(text);
  if (!parsed.name.trim() || !parsed.body.trim()) {
    return { recognized: false };
  }

  return {
    recognized: true,
    logicalName: parsed.name.trim(),
    fileKind: 'plain-md',
  };
}

function discoverSkillInstallations(home, rootName) {
  const baseDir = path.join(path.resolve(home), rootName);
  const discovered = [];
  try {
    const entries = safeReadDir(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(baseDir, entry.name);
      if (!isDirectoryLike(entry, entryPath)) {
        continue;
      }

      const flatContentPath = path.join(entryPath, 'SKILL.md');
      if (safeStat(flatContentPath)?.isFile()) {
        discovered.push({
          name: entry.name,
          namespace: undefined,
          absPath: flatContentPath,
          viewPath: `${rootName}/${entry.name}/SKILL.md`,
        });
      }

      const childEntries = safeReadDir(entryPath, { withFileTypes: true });
      for (const childEntry of childEntries) {
        const childPath = path.join(entryPath, childEntry.name);
        if (!isDirectoryLike(childEntry, childPath)) {
          continue;
        }

        const childContentPath = path.join(childPath, 'SKILL.md');
        if (!safeStat(childContentPath)?.isFile()) {
          continue;
        }

        discovered.push({
          name: childEntry.name,
          namespace: entry.name,
          absPath: childContentPath,
          viewPath: `${rootName}/${entry.name}/${childEntry.name}/SKILL.md`,
        });
      }
    }
  } catch {
    return [];
  }

  return discovered.sort((left, right) => {
    const nameCompare = String(left.name || '').localeCompare(String(right.name || ''));
    if (nameCompare !== 0) {
      return nameCompare;
    }
    const namespaceCompare = String(left.namespace || '').localeCompare(String(right.namespace || ''));
    if (namespaceCompare !== 0) {
      return namespaceCompare;
    }
    return String(left.viewPath || '').localeCompare(String(right.viewPath || ''));
  });
}

function listInstalledAgents(home) {
  const agentsDir = path.join(path.resolve(home), 'agents');
  try {
    const entries = fs.readdirSync(agentsDir, { withFileTypes: true });
    return entries
      .filter((e) => isFileLike(e, path.join(agentsDir, e.name)))
      .map((e) => {
        const absPath = path.join(agentsDir, e.name);
        const detected = isRecognizedAgentFile(e.name, absPath);
        if (!detected.recognized) return null;
        const origin = inferExternalOrigin(absPath, {
          fileKind: detected.fileKind,
        });
        return {
          assetId: buildProviderQualifiedId('agent', detected.logicalName, origin),
          name: detected.logicalName,
          fileName: e.name,
          absPath,
          provider: origin.provider || 'user-home',
          sourcePackage: origin.sourcePackage,
          namespace: origin.namespace,
          readOnly: origin.isExternal,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

function listInstalledSkills(home) {
  return discoverSkillInstallations(home, 'skills').map((skill) => {
    const origin = inferExternalOrigin(skill.absPath, {
      namespace: skill.namespace,
    });
    return {
      assetId: buildProviderQualifiedId('skill', skill.name, origin),
      name: skill.name,
      namespace: skill.namespace,
      absPath: skill.absPath,
      kind: isPointerFile(skill.absPath) ? 'pointer' : 'full',
      viewPath: skill.viewPath,
      provider: origin.provider || 'user-home',
      sourcePackage: origin.sourcePackage,
      readOnly: origin.isExternal,
    };
  });
}

function listVaultSkills(home) {
  return discoverSkillInstallations(home, 'skills-vault').map((skill) => {
    const origin = inferExternalOrigin(skill.absPath, {
      namespace: skill.namespace,
    });
    return {
      assetId: buildProviderQualifiedId('skill', skill.name, origin),
      name: skill.name,
      namespace: skill.namespace,
      absPath: skill.absPath,
      viewPath: skill.viewPath,
      provider: origin.provider || 'user-home',
      sourcePackage: origin.sourcePackage,
      readOnly: origin.isExternal,
    };
  });
}

function loadSkillMetadataIndex(engineRoot) {
  const metadataIndexPath = path.join(
    path.resolve(engineRoot),
    'engine-assets',
    'skills',
    'skill-metadata-index.json',
  );
  const metadataIndex = readJsonIfExists(metadataIndexPath);
  const metadataBySkill = new Map();
  const entries = Array.isArray(metadataIndex?.entries) ? metadataIndex.entries : [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const skillKey = String(entry.skill || entry.name || '').trim();
    if (!skillKey) {
      continue;
    }
    metadataBySkill.set(skillKey, entry);
  }
  return metadataBySkill;
}

function buildManagedMissingSkillPreview(engineRoot, projectedAssetIds) {
  const manifest = loadManifest(engineRoot);
  const metadataBySkill = loadSkillMetadataIndex(engineRoot);

  return manifest.assets
    .filter((asset) => asset && asset.type === 'skill')
    .map((asset) => {
      const assetKey = path.basename(String(asset.destination || asset.source || '').trim()).replace(/[\\/]+$/, '');
      const assetId = String(asset.id || '').trim() || deriveAssetId('skill', assetKey);
      if (!assetKey || !assetId || projectedAssetIds.has(assetId)) {
        return null;
      }

      const metadataEntry = metadataBySkill.get(assetKey) || null;
      const triggers = Array.isArray(metadataEntry?.triggersOn)
        ? metadataEntry.triggersOn.map((value) => String(value || '').trim()).filter(Boolean)
        : [];

      return {
        assetId,
        name: String(metadataEntry?.name || assetKey).trim(),
        kind: 'missing',
        loadMode: String(asset.loadMode || metadataEntry?.manifest?.loadMode || 'on-demand').trim(),
        availability: 'not-installed',
        description: String(metadataEntry?.description || '').trim(),
        triggers: triggers.join(', '),
        managed: true,
      };
    })
    .filter(Boolean);
}

function getSkillCatalogPreview(engineRoot, home) {
  const snapshot = buildCatalogProjection({ engineRoot, copilotHome: home });
  const skills = Array.isArray(snapshot?.effectiveAssets)
    ? snapshot.effectiveAssets.filter((asset) => asset && asset.kind === 'skill')
    : [];
  const projectedAssetIds = new Set(skills.map((asset) => String(asset?.assetId || '').trim()).filter(Boolean));

  return skills
    .map((asset) => {
      const entry = asset.selectedEntry || {};
      const metadata = entry.metadata && typeof entry.metadata === 'object' ? entry.metadata : {};
      const installedPaths = asset.installState?.installedPaths || {};
      const triggers = Array.isArray(metadata.triggersOn)
        ? metadata.triggersOn.map((value) => String(value || '').trim()).filter(Boolean)
        : [];
      const logicalName = typeof metadata.logicalName === 'string' && metadata.logicalName.trim()
        ? metadata.logicalName.trim()
        : String(asset.assetKey || entry.title || '').trim();
      const explicitViewPath = typeof metadata.viewPath === 'string' && metadata.viewPath.trim()
        ? metadata.viewPath.trim()
        : null;
      const fallbackViewPath =
        explicitViewPath ||
        toCopilotRelativePath(home, installedPaths['vault-only']) ||
        toCopilotRelativePath(home, installedPaths['user-installed']) ||
        toCopilotRelativePath(home, entry.contentPath);

      let kind = 'missing';
      let availability = 'not-installed';
      if (asset.installed) {
        const materialization = String(entry.installState?.materialization || asset.installState?.materialization || '').trim();
        availability =
          installedPaths['user-installed'] && installedPaths['vault-only']
            ? 'scan+vault'
            : asset.selectedLayer === 'vault-only' || asset.installState?.availability === 'vault-only'
              ? 'vault-only'
              : 'scan-path';
        if (asset.selectedLayer === 'vault-only') {
          kind = 'vault';
        } else if (materialization === 'pointer') {
          kind = 'pointer';
        } else {
          kind = 'full';
        }
      }

      return {
        assetId: asset.assetId,
        name: logicalName,
        kind,
        loadMode: asset.installState?.loadMode || 'on-demand',
        availability,
        description: typeof entry.description === 'string' ? entry.description : '',
        triggers: triggers.join(', '),
        absPath: typeof entry.contentPath === 'string' ? entry.contentPath : undefined,
        vaultPath: typeof installedPaths['vault-only'] === 'string' ? installedPaths['vault-only'] : null,
        viewPath: fallbackViewPath || undefined,
        managed: Array.isArray(asset.contributingEntries)
          ? asset.contributingEntries.some((candidate) => candidate?.layer === 'source')
          : false,
        namespace: typeof metadata.namespace === 'string' ? metadata.namespace : undefined,
        provider: typeof metadata.provider === 'string' ? metadata.provider : undefined,
        sourcePackage: typeof metadata.sourcePackage === 'string' ? metadata.sourcePackage : undefined,
        readOnly: metadata.readOnly === true,
      };
    })
    .concat(buildManagedMissingSkillPreview(engineRoot, projectedAssetIds))
    .sort((left, right) => {
      const nameCompare = String(left.name || '').localeCompare(String(right.name || ''));
      if (nameCompare !== 0) {
        return nameCompare;
      }
      return String(left.assetId || '').localeCompare(String(right.assetId || ''));
    });
}

function listInstalledPrompts(home) {
  const promptsDir = path.join(path.resolve(home), 'prompts');
  try {
    const entries = fs.readdirSync(promptsDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.prompt.md'))
      .map((e) => ({
        name: e.name.replace(/\.prompt\.md$/i, ''),
        fileName: e.name,
        absPath: path.join(promptsDir, e.name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

function getInstalledInstructions(home) {
  const absPath = path.join(path.resolve(home), 'copilot-instructions.md');
  try {
    return fs.existsSync(absPath) && fs.statSync(absPath).isFile() ? { installed: true, absPath } : { installed: false, absPath };
  } catch {
    return { installed: false, absPath };
  }
}

function buildManagedAssetResult(asset, sourceRel, sourceAbs, destinationAbs, extras) {
  return {
    ...asset,
    managed: true,
    source: sourceRel,
    sourceAbs,
    destinationAbs,
    ...extras,
  };
}

function normalizeAuditAssetKey(asset) {
  if (!asset || typeof asset !== 'object') {
    return undefined;
  }
  const kind = String(asset.type || '').trim().toLowerCase();
  const destination = String(asset.destination || '').trim();
  if (kind === 'skill') {
    return path.basename(destination || String(asset.source || '').trim()).replace(/[\\/]+$/, '') || undefined;
  }
  if (kind === 'agent') {
    return path.basename(destination || String(asset.source || '').trim()).replace(/\.agent\.md$/i, '') || undefined;
  }
  if (kind === 'prompt') {
    return path.basename(destination || String(asset.source || '').trim()).replace(/\.prompt\.md$/i, '') || undefined;
  }
  return undefined;
}

function recordManagedAssetAuditEvent(destinationHome, asset, eventType, details = {}) {
  try {
    appendCatalogAuditEvent(destinationHome, {
      eventType,
      source: 'assets-lib',
      actor: {
        kind: 'system',
        id: 'assets-lib',
        label: 'assets-lib',
      },
      assetId: asset.id,
      assetKey: normalizeAuditAssetKey(asset),
      assetKind: asset.type,
      scope: { kind: 'user' },
      details,
    });
  } catch {
    // Best-effort audit logging must not block asset operations.
  }
}

function getManagedAssetStatuses(engineRoot, destinationHome) {
  const manifest = loadManifest(engineRoot);
  return manifest.assets.map((asset) => {
    const { sourceAbs, destinationAbs, sourceRel } = getAssetPaths(engineRoot, destinationHome, asset);
    const sourceHash = sha256PathHex(sourceAbs);
    const installed = fs.existsSync(destinationAbs);
    const destinationHash = installed ? sha256PathHex(destinationAbs) : null;
    const upToDate = Boolean(installed && sourceHash && destinationHash && sourceHash === destinationHash);

    return buildManagedAssetResult(asset, sourceRel, sourceAbs, destinationAbs, {
      installed,
      upToDate,
      sourceAvailable: Boolean(sourceHash),
      sourceHash,
      destinationHash,
    });
  });
}

function syncAsset(engineRoot, destinationHome, assetId, opts) {
  const { dryRun = false, force = false, pointerMode = true } = opts || {};
  const manifest = loadManifest(engineRoot);
  const asset = manifest.assets.find((a) => a.id === assetId);
  if (!asset) throw new Error(`Unknown assetId: ${assetId}`);

  const { sourceAbs, destinationAbs, sourceRel } = getAssetPaths(engineRoot, destinationHome, asset);
  const installed = fs.existsSync(destinationAbs);
  const destinationHash = installed ? sha256PathHex(destinationAbs) : null;
  const sourceHash = sha256PathHex(sourceAbs);
  if (!sourceHash) {
    return buildManagedAssetResult(asset, sourceRel, sourceAbs, destinationAbs, {
      action: 'skipped',
      reason: 'source_missing_or_unreadable',
      installed,
      upToDate: false,
      sourceAvailable: false,
      sourceHash: null,
      destinationHash,
    });
  }

  if (installed && destinationHash && destinationHash === sourceHash) {
    return buildManagedAssetResult(asset, sourceRel, sourceAbs, destinationAbs, {
      action: 'noop',
      installed: true,
      upToDate: true,
      sourceAvailable: true,
      sourceHash,
      destinationHash,
    });
  }

  if (installed && !force && !destinationHash) {
    return buildManagedAssetResult(asset, sourceRel, sourceAbs, destinationAbs, {
      action: 'skipped',
      reason: 'destination_unreadable',
      installed: true,
      upToDate: false,
      sourceAvailable: true,
      sourceHash,
      destinationHash,
    });
  }

  if (installed && !force && destinationHash && destinationHash !== sourceHash) {
    return buildManagedAssetResult(asset, sourceRel, sourceAbs, destinationAbs, {
      action: 'skipped',
      reason: 'destination_differs_from_source',
      installed: true,
      upToDate: false,
      sourceAvailable: true,
      sourceHash,
      destinationHash,
    });
  }

  const action = installed ? (dryRun ? 'would_update' : 'updated') : (dryRun ? 'would_install' : 'installed');

  if (!dryRun) {
    fs.mkdirSync(path.dirname(destinationAbs), { recursive: true });

    if (asset.type === 'skill' && pointerMode) {
      // Pointer mode: respect loadMode from manifest
      const skillBase = path.basename(asset.destination);
      const loadMode = asset.loadMode || 'on-demand';
      const vaultDir = getVaultDir(destinationHome);
      const vaultDest = path.join(vaultDir, skillBase);

      // Always copy to vault (for search index)
      fs.mkdirSync(vaultDest, { recursive: true });
      const st = fs.statSync(sourceAbs);
      if (st.isDirectory()) {
        fs.rmSync(vaultDest, { recursive: true, force: true });
        if (typeof fs.cpSync === 'function') {
          fs.cpSync(sourceAbs, vaultDest, { recursive: true, force: true });
        } else {
          const files = walkFilesRecursive(sourceAbs);
          for (const f of files) {
            const rel = path.relative(sourceAbs, f);
            const out = path.join(vaultDest, rel);
            fs.mkdirSync(path.dirname(out), { recursive: true });
            fs.copyFileSync(f, out);
          }
        }
      } else {
        fs.copyFileSync(sourceAbs, vaultDest);
      }

      if (loadMode === 'always') {
        // Always-loaded: also install full skill to skills/ (scanned by VS Code)
        const stSrc = fs.statSync(sourceAbs);
        if (stSrc.isDirectory()) {
          fs.rmSync(destinationAbs, { recursive: true, force: true });
          if (typeof fs.cpSync === 'function') {
            fs.cpSync(sourceAbs, destinationAbs, { recursive: true, force: true });
          } else {
            const files = walkFilesRecursive(sourceAbs);
            for (const f of files) {
              const rel = path.relative(sourceAbs, f);
              const out = path.join(destinationAbs, rel);
              fs.mkdirSync(path.dirname(out), { recursive: true });
              fs.copyFileSync(f, out);
            }
          }
        } else {
          fs.copyFileSync(sourceAbs, destinationAbs);
        }
      }
      // On-demand skills: vault only — no pointer or full copy in skills/
    } else {
      const st = fs.statSync(sourceAbs);
      if (st.isDirectory()) {
        fs.rmSync(destinationAbs, { recursive: true, force: true });
        if (typeof fs.cpSync === 'function') {
          fs.cpSync(sourceAbs, destinationAbs, { recursive: true, force: true });
        } else {
          // Fallback for older Node: naive recursive copy.
          const files = walkFilesRecursive(sourceAbs);
          for (const f of files) {
            const rel = path.relative(sourceAbs, f);
            const out = path.join(destinationAbs, rel);
            fs.mkdirSync(path.dirname(out), { recursive: true });
            fs.copyFileSync(f, out);
          }
        }
      } else {
        fs.copyFileSync(sourceAbs, destinationAbs);
      }
    }
  }

  const newDestinationHash = dryRun ? destinationHash : sha256PathHex(destinationAbs);

  const result = buildManagedAssetResult(asset, sourceRel, sourceAbs, destinationAbs, {
    action,
    installed: true,
    upToDate: Boolean(newDestinationHash && newDestinationHash === sourceHash),
    sourceAvailable: true,
    sourceHash,
    destinationHash: newDestinationHash,
  });
  if (action === 'installed' || action === 'updated') {
    recordManagedAssetAuditEvent(destinationHome, asset, `asset.${action}`, {
      managed: true,
      loadMode: asset.loadMode || undefined,
      pointerMode: Boolean(asset.type === 'skill' && pointerMode),
      materialization: asset.type === 'skill' && pointerMode
        ? (asset.loadMode === 'always' ? 'vault-and-installed' : 'vault-only')
        : 'direct-copy',
    });
  }
  return result;
}

function syncAll(engineRoot, destinationHome, opts) {
  const manifest = loadManifest(engineRoot);
  return manifest.assets
    .map((a) => syncAsset(engineRoot, destinationHome, a.id, opts))
    .filter((result) => !(result && result.reason === 'source_missing_or_unreadable'));
}

function tryRemoveEmptyDirsUp(startDirAbs, stopDirAbs) {
  const stop = path.resolve(stopDirAbs);
  let current = path.resolve(startDirAbs);
  const stopPrefix = stop.endsWith(path.sep) ? stop : stop + path.sep;

  while (current.startsWith(stopPrefix) && current !== stop) {
    try {
      const entries = fs.readdirSync(current);
      if (entries.length !== 0) break;
      fs.rmdirSync(current);
      current = path.dirname(current);
    } catch {
      break;
    }
  }
}

function removeAsset(destinationHome, asset, opts) {
  const { force = false } = opts || {};
  if (!asset || typeof asset !== 'object') throw new Error('asset must be an object');

  const homeAbs = path.resolve(destinationHome);
  let destinationAbs = asset.destinationAbs || asset.destinationPath;
  if (!destinationAbs) {
    const destinationRel = asset.destination || asset.destinationRel;
    if (!destinationRel) throw new Error('asset is missing destination info');
    destinationAbs = resolveUnder(homeAbs, destinationRel);
  } else {
    destinationAbs = path.resolve(destinationAbs);
  }

  const homePrefix = homeAbs.endsWith(path.sep) ? homeAbs : homeAbs + path.sep;
  if (!destinationAbs.startsWith(homePrefix)) {
    throw new Error('Refusing to delete outside destination home');
  }

  const isManaged = asset.managed === true;
  const differsFromSource = Boolean(
    asset.sourceHash &&
      asset.destinationHash &&
      asset.sourceHash !== asset.destinationHash
  );
  const canProveUpToDate = Boolean(asset.upToDate === true || (!differsFromSource && asset.sourceHash && asset.destinationHash));

  if (!force) {
    if (!isManaged) {
      return { action: 'blocked', reason: 'unmanaged_asset', destinationAbs };
    }
    if (!canProveUpToDate) {
      return { action: 'blocked', reason: 'destination_differs_or_unknown', destinationAbs };
    }
  }

  if (!fs.existsSync(destinationAbs)) {
    return { action: 'not_found', destinationAbs };
  }

  const stat = fs.statSync(destinationAbs);
  if (!(stat.isFile() || stat.isDirectory())) {
    return { action: 'blocked', reason: 'not_a_file_or_dir', destinationAbs };
  }

  const currentDestinationHash = sha256PathHex(destinationAbs);
  if (!force && asset.destinationHash && currentDestinationHash && currentDestinationHash !== asset.destinationHash) {
    return { action: 'blocked', reason: 'destination_changed_since_status', destinationAbs };
  }

  if (stat.isDirectory()) {
    fs.rmSync(destinationAbs, { recursive: true, force: true });
    tryRemoveEmptyDirsUp(path.dirname(destinationAbs), homeAbs);
  } else {
    fs.unlinkSync(destinationAbs);
    tryRemoveEmptyDirsUp(path.dirname(destinationAbs), homeAbs);
  }

  // Clean vault entry if this was a skill (best-effort)
  if (asset.type === 'skill' || (asset.destination && asset.destination.startsWith('skills/'))) {
    try {
      const skillBase = path.basename(asset.destination || '');
      if (skillBase) {
        const vaultDir = getVaultDir(homeAbs);
        const vaultEntry = path.join(vaultDir, skillBase);
        if (fs.existsSync(vaultEntry)) {
          fs.rmSync(vaultEntry, { recursive: true, force: true });
        }
      }
    } catch { /* best-effort vault cleanup */ }
  }

  const result = { action: 'removed', destinationAbs };
  recordManagedAssetAuditEvent(destinationHome, asset, 'asset.removed', {
    managed: true,
    force: Boolean(force),
  });
  return result;
}

function getVaultDir(home) {
  return path.join(path.resolve(home), 'skills-vault');
}

function isPointerFile(absPath) {
  try {
    const text = fs.readFileSync(absPath, 'utf8');
    return /^---\s*\n[\s\S]*?vault-ref:\s*\S+/m.test(text);
  } catch {
    return false;
  }
}

function generatePointer(name, description, triggers, vaultRef) {
  const lines = [
    '---',
    'schema-version: 1',
    `vault-ref: ${vaultRef}`,
    '---',
    `# ${name}`,
  ];
  if (description) lines.push(description);
  if (triggers) lines.push(`Triggers on: ${triggers}`);
  return lines.join('\n') + '\n';
}

module.exports = {
  
  loadManifest,
  listInstalledAgents,
  listInstalledSkills,
  listVaultSkills,
  getSkillCatalogPreview,
  listInstalledPrompts,
  getInstalledInstructions,
  getManagedAssetStatuses,
  readTextFileSafe,
  syncAsset,
  syncAll,
  removeAsset,
  generatePointer,
  isPointerFile,
  getVaultDir,
};

