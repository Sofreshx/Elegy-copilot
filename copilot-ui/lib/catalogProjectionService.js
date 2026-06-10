'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  compareAssetCatalogEntries,
  buildLegacyProviderQualifiedAssetKey,
  buildProviderQualifiedAssetKey: buildSharedProviderQualifiedAssetKey,
  DEFAULT_PROVIDER_CATALOG,
  inferAssetProvenance,
  resolveEffectiveAssetState,
} = require('@elegy-copilot/contracts');
const {
  buildProviderProjection,
  loadProviderCatalog,
  loadProviderInstallState,
} = require('./providerCatalog');

const CATALOG_PROJECTION_SCHEMA_VERSION = 1;
const DEFAULT_SNAPSHOT_NAME = 'global';
const POINTER_FILE_PATTERN = /^---\s*\r?\n[\s\S]*?vault-ref:\s*\S+/m;

function normalizePathForKey(inputPath) {
  return String(inputPath || '').replace(/\\/g, '/').trim().toLowerCase();
}

function expandHome(inputPath) {
  const raw = String(inputPath || '').trim();
  if (!raw) {
    return raw;
  }
  if (raw === '~') {
    return os.homedir();
  }
  if (raw.startsWith('~/') || raw.startsWith('~\\')) {
    return path.join(os.homedir(), raw.slice(2));
  }
  return raw;
}

function resolveElegyHome(inputPath) {
  return path.resolve(expandHome(inputPath || '~/.elegy'));
}

function safeReadDir(dirAbs, options) {
  try {
    return fs.readdirSync(dirAbs, options);
  } catch {
    return [];
  }
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

function toCopilotRelativePath(elegyHome, absPath) {
  if (!absPath) {
    return null;
  }
  const relativePath = path.relative(path.resolve(elegyHome), path.resolve(absPath));
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return null;
  }
  return toPosixPath(relativePath);
}

function readTextIfExists(absPath, maxBytes = 256 * 1024) {
  try {
    const stat = fs.statSync(absPath);
    if (!stat.isFile()) {
      return null;
    }
    const bytesToRead = Math.min(stat.size, Math.max(1024, maxBytes));
    const fd = fs.openSync(absPath, 'r');
    try {
      const buffer = Buffer.alloc(bytesToRead);
      const bytesRead = fs.readSync(fd, buffer, 0, bytesToRead, 0);
      return buffer.subarray(0, bytesRead).toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

function readJsonIfExists(absPath) {
  try {
    const stat = fs.statSync(absPath);
    if (!stat.isFile()) {
      return null;
    }
    return JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch {
    return null;
  }
}

function walkFilesRecursive(dirAbs) {
  const files = [];
  const stack = [dirAbs];

  while (stack.length) {
    const current = stack.pop();
    const entries = safeReadDir(current, { withFileTypes: true });
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

function parseSimpleFrontmatter(text) {
  const source = String(text || '');
  if (!source.startsWith('---')) {
    return { attributes: {}, body: source };
  }

  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    return { attributes: {}, body: source };
  }

  const attributes = {};
  for (const line of match[1].split(/\r?\n/)) {
    const entry = line.match(/^([A-Za-z0-9_-]+):\s*(.+?)\s*$/);
    if (!entry) {
      continue;
    }
    attributes[entry[1]] = entry[2];
  }

  return {
    attributes,
    body: source.slice(match[0].length),
  };
}

function normalizeList(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .map((value) => String(value || '').trim())
    .filter(Boolean);
}

function uniqueStrings(values) {
  return Array.from(new Set(normalizeList(values)));
}

const SUPPORTED_BUNDLE_CLASSIFICATIONS = new Set(['language', 'scope', 'workflow', 'core']);
const SUPPORTED_SCOPE_KINDS = new Set(['global', 'user', 'repo', 'workspace', 'framework']);
const SUPPORTED_BUNDLE_LOAD_MODES = new Set(['always', 'on-demand', 'manual']);

function normalizeBundleClassification(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return SUPPORTED_BUNDLE_CLASSIFICATIONS.has(normalized) ? normalized : null;
}

function deriveBundleClassification(bundle) {
  const explicitClassification = normalizeBundleClassification(
    bundle?.classification || bundle?.bundleClassification || bundle?.kind
  );
  if (explicitClassification) {
    return explicitClassification;
  }

  const tags = normalizeList(bundle?.tags).map((value) => value.toLowerCase());
  if (tags.includes('core')) {
    return 'core';
  }
  if (tags.includes('workflow') || tags.includes('orchestration') || tags.includes('planning')) {
    return 'workflow';
  }
  if (tags.includes('repo') || tags.includes('workspace') || tags.includes('scope')) {
    return 'scope';
  }
  return null;
}

function normalizeBundleLoadMode(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return SUPPORTED_BUNDLE_LOAD_MODES.has(normalized) ? normalized : null;
}

function normalizeBundleTargeting(bundle) {
  const source = bundle?.targeting && typeof bundle.targeting === 'object' ? bundle.targeting : {};
  const frameworks = uniqueStrings(source.frameworks || bundle?.frameworks);
  const stacks = uniqueStrings(source.stacks || bundle?.stacks);
  const languages = uniqueStrings(source.languages || bundle?.languages);
  const tags = uniqueStrings([
    ...normalizeList(source.tags),
    ...normalizeList(bundle?.tags),
  ]);
  const scopeKinds = uniqueStrings(source.scopeKinds || bundle?.scopeKinds)
    .map((value) => value.toLowerCase())
    .filter((value) => SUPPORTED_SCOPE_KINDS.has(value));

  const targeting = {};
  if (frameworks.length > 0) {
    targeting.frameworks = frameworks;
  }
  if (stacks.length > 0) {
    targeting.stacks = stacks;
  }
  if (languages.length > 0) {
    targeting.languages = languages;
  }
  if (tags.length > 0) {
    targeting.tags = tags;
  }
  if (scopeKinds.length > 0) {
    targeting.scopeKinds = scopeKinds;
  }

  return Object.keys(targeting).length > 0 ? targeting : undefined;
}

function buildBundleUninstallPolicy(bundle, classification) {
  const source = bundle?.uninstallPolicy && typeof bundle.uninstallPolicy === 'object'
    ? bundle.uninstallPolicy
    : {};
  return {
    removesInstalledMembers: source.removesInstalledMembers !== false,
    clearsActivationState: source.clearsActivationState !== false,
    clearsRepoOverlayState: source.clearsRepoOverlayState !== false,
    preservesExternalPackages: source.preservesExternalPackages !== false,
  };
}

function splitCommaSeparated(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function humanizeAssetKey(assetKey) {
  return String(assetKey || '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function normalizeAssetKey(kind, rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) {
    return '';
  }
  if (kind === 'agent') {
    return raw.replace(/\.agent\.md$/i, '');
  }
  if (kind === 'prompt') {
    return raw.replace(/\.prompt\.md$/i, '');
  }
  return raw.replace(/[\\/]+$/, '');
}

function normalizeIdentityPart(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function inferExternalAssetOrigin(absPath, options = {}) {
  const namespaceInput = options.namespace || '';
  const realPath = safeRealpath(absPath) || path.resolve(absPath);
  const provenance = inferAssetProvenance({
    kind: options.kind === 'agent' ? 'agent' : 'skill',
    resolvedPath: toPosixPath(realPath),
    namespace:
      normalizeAssetKey(options.kind === 'agent' ? 'agent' : 'skill', namespaceInput) ||
      normalizeAssetKey(options.kind === 'agent' ? 'agent' : 'skill', options.detectedNamespace || ''),
    fileKind: options.fileKind,
    providers: options.providers || DEFAULT_PROVIDER_CATALOG,
  });

  return {
    isExternal: provenance.readOnly === true,
    provider: provenance.providerId,
    legacyProviderId: provenance.legacyProviderId,
    sourcePackage: provenance.sourcePackage,
    namespace: provenance.namespace,
    provenance,
    realPath,
  };
}

function buildProviderQualifiedAssetKey(kind, logicalName, origin) {
  return buildSharedProviderQualifiedAssetKey(kind, logicalName, origin?.provenance);
}

function mergeAliasKeys(...lists) {
  const aliases = new Set();
  for (const list of lists) {
    for (const value of Array.isArray(list) ? list : []) {
      const normalized = String(value || '').trim();
      if (normalized) {
        aliases.add(normalized);
      }
    }
  }
  return Array.from(aliases);
}

function buildAssetAliasKeys(kind, assetKey, assetId, logicalName, origin, extraAliasKeys = []) {
  const logicalAssetKey = normalizeAssetKey(kind, logicalName);
  const legacyQualifiedKey = buildLegacyProviderQualifiedAssetKey(kind, logicalName, origin?.provenance);
  return mergeAliasKeys(
    buildAliasKeys(kind, assetKey, assetId),
    logicalAssetKey ? [logicalAssetKey] : [],
    origin?.namespace && logicalAssetKey ? [`${origin.namespace}/${logicalAssetKey}`] : [],
    origin?.sourcePackage && logicalAssetKey ? [`${origin.sourcePackage}/${logicalAssetKey}`] : [],
    legacyQualifiedKey ? [legacyQualifiedKey] : [],
    extraAliasKeys,
  );
}

function deriveAssetId(kind, assetKey) {
  const normalizedKey = normalizeAssetKey(kind, assetKey);
  if (!normalizedKey) {
    return '';
  }
  if (normalizedKey.startsWith(`${kind}-`)) {
    return normalizedKey;
  }
  return `${kind}-${normalizedKey}`;
}

function buildAliasKeys(kind, assetKey, assetId) {
  const keys = new Set();
  const normalizedKey = normalizeAssetKey(kind, assetKey);
  const normalizedId = String(assetId || '').trim();
  if (normalizedKey) {
    keys.add(normalizedKey);
  }
  if (normalizedId) {
    keys.add(normalizedId);
  }
  if (kind === 'agent' && normalizedKey.startsWith('agent-')) {
    keys.add(normalizedKey.slice('agent-'.length));
  }
  if (kind === 'prompt' && normalizedKey.startsWith('prompt-')) {
    keys.add(normalizedKey.slice('prompt-'.length));
  }
  return Array.from(keys);
}

function parseMarkdownAsset(absPath) {
  const text = readTextIfExists(absPath);
  if (!text) {
    return {
      title: '',
      description: '',
      triggers: [],
      frontmatter: {},
      text: '',
      bodyText: '',
    };
  }

  const { attributes, body } = parseSimpleFrontmatter(text);
  const titleMatch = body.match(/^#\s+(.+?)\s*$/m);
  const triggerMatch = text.match(/Triggers?\s+on:\s*(.+)/i);
  const bodyLines = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  let description = '';
  for (const line of bodyLines) {
    if (line.startsWith('#')) {
      continue;
    }
    if (/^Triggers?\s+on:/i.test(line)) {
      continue;
    }
    description = line;
    break;
  }

  return {
    title:
      String(attributes.title || attributes.name || '').trim() ||
      (titleMatch ? titleMatch[1].trim() : ''),
    description: String(attributes.description || '').trim() || description,
    triggers: splitCommaSeparated(
      attributes['triggers-on'] || attributes.triggersOn || (triggerMatch ? triggerMatch[1] : ''),
    ),
    frontmatter: attributes,
    text,
    bodyText: body,
  };
}

function isRecognizedAgentMarkdownFile(fileName, parsedAsset) {
  const normalizedFileName = String(fileName || '').trim().toLowerCase();
  if (normalizedFileName.endsWith('.agent.md')) {
    return true;
  }
  if (!normalizedFileName.endsWith('.md') || normalizedFileName.endsWith('.prompt.md')) {
    return false;
  }
  return Boolean(
    String(parsedAsset?.frontmatter?.name || '').trim() &&
      String(parsedAsset?.bodyText || '').trim(),
  );
}

function parseSkillArtifact(relativeRoot, relativeSegments, skillRootPath) {
  if (!Array.isArray(relativeSegments) || relativeSegments.length === 0) {
    return null;
  }

  let logicalName = '';
  let namespace = null;
  if (relativeSegments.length === 1) {
    logicalName = normalizeAssetKey('skill', relativeSegments[0]);
  } else if (relativeSegments[0] === 'providers' && relativeSegments.length >= 3) {
    namespace = normalizeAssetKey('skill', relativeSegments[1]);
    logicalName = normalizeAssetKey('skill', relativeSegments[2]);
  } else if (relativeSegments.length >= 2) {
    namespace = normalizeAssetKey('skill', relativeSegments[0]);
    logicalName = normalizeAssetKey('skill', relativeSegments[1]);
  }

  if (!logicalName) {
    return null;
  }

  const skillContent =
    (safeStat(path.join(skillRootPath, 'SKILL.md'))?.isFile() && {
      contentPath: path.join(skillRootPath, 'SKILL.md'),
      fileName: 'SKILL.md',
    }) ||
    (safeStat(path.join(skillRootPath, 'index.md'))?.isFile() && {
      contentPath: path.join(skillRootPath, 'index.md'),
      fileName: 'index.md',
    });
  if (!skillContent) {
    return null;
  }

  return {
    logicalName,
    namespace,
    rootPath: skillRootPath,
    contentPath: skillContent.contentPath,
    viewPath: `${relativeRoot}/${relativeSegments.join('/')}/${skillContent.fileName}`,
  };
}

function discoverSkillArtifacts(baseDir, relativeRoot) {
  const discovered = [];
  const queue = [{ dirPath: baseDir, relativeSegments: [] }];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const entry of safeReadDir(current.dirPath, { withFileTypes: true })) {
      const entryPath = path.join(current.dirPath, entry.name);
      if (!isDirectoryLike(entry, entryPath)) {
        continue;
      }

      const relativeSegments = [...current.relativeSegments, entry.name];
      const artifact = parseSkillArtifact(relativeRoot, relativeSegments, entryPath);
      if (artifact) {
        discovered.push(artifact);
      }

      if (relativeSegments.length < 3) {
        queue.push({ dirPath: entryPath, relativeSegments });
      }
    }
  }

  return discovered.sort((left, right) => {
    const nameCompare = String(left.logicalName || '').localeCompare(String(right.logicalName || ''));
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

function isPointerFile(absPath) {
  const text = readTextIfExists(absPath, 64 * 1024);
  return Boolean(text && POINTER_FILE_PATTERN.test(text));
}

function getRepoStateKey(repoPath) {
  const normalized = normalizePathForKey(path.resolve(repoPath));
  const hash = crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
  return {
    repoId: hash.slice(0, 12),
    repoPath: path.resolve(repoPath),
    repoLabel: path.basename(path.resolve(repoPath)),
  };
}

function resolveRepoContext(options = {}) {
  const repoPath = options.repoPath ? path.resolve(options.repoPath) : undefined;
  if (repoPath) {
    const computed = getRepoStateKey(repoPath);
    return {
      repoId: String(options.repoId || computed.repoId),
      repoPath,
      repoLabel: computed.repoLabel,
    };
  }
  if (options.repoId) {
    return {
      repoId: String(options.repoId),
      repoPath: undefined,
      repoLabel: undefined,
    };
  }
  return null;
}

function resolveProjectionStorage(options = {}) {
  const elegyHome = resolveElegyHome(options.elegyHome || options.copilotHome);
  const repoContext = resolveRepoContext(options);
  const snapshotName = repoContext?.repoId ? `repo-${repoContext.repoId}` : DEFAULT_SNAPSHOT_NAME;
  const catalogRoot = path.join(elegyHome, 'catalog');
  const snapshotPath = path.join(catalogRoot, 'projections', `${snapshotName}.json`);

  return {
    elegyHome,
    catalogRoot,
    snapshotPath,
    repoContext,
  };
}

function writeJsonAtomic(absPath, value) {
  const dir = path.dirname(absPath);
  fs.mkdirSync(dir, { recursive: true });
  const tempPath = path.join(
    dir,
    `.${path.basename(absPath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
  );
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2) + '\n', 'utf8');
  fs.renameSync(tempPath, absPath);
}

function manifestTypeToKind(type) {
  const raw = String(type || '').trim().toLowerCase();
  if (raw === 'agent' || raw === 'skill' || raw === 'prompt') {
    return raw;
  }
  return null;
}

function buildScope(kind, repoContext) {
  if (kind === 'repo') {
    return {
      kind: 'repo',
      repoId: repoContext?.repoId,
      repoPath: repoContext?.repoPath,
      displayName: repoContext?.repoLabel,
    };
  }
  if (kind === 'user') {
    return { kind: 'user' };
  }
  return { kind: 'global' };
}

function buildManifestAssetDescriptor(asset) {
  const kind = manifestTypeToKind(asset?.type);
  const sourceLikePath = String(asset?.source || asset?.destination || '').trim().replace(/\\/g, '/');
  const assetKey = kind && sourceLikePath
    ? normalizeAssetKey(kind, path.posix.basename(sourceLikePath))
    : '';
  const assetId = String(asset?.id || '').trim() || deriveAssetId(kind, assetKey);

  return {
    assetId,
    assetKey,
    kind,
  };
}

function buildManifestAssetIndex(manifestAssets) {
  const byId = new Map();
  for (const asset of Array.isArray(manifestAssets) ? manifestAssets : []) {
    if (!asset || typeof asset !== 'object') {
      continue;
    }
    const descriptor = buildManifestAssetDescriptor(asset);
    if (!descriptor.assetId) {
      continue;
    }
    byId.set(descriptor.assetId, descriptor);
  }
  return byId;
}

function normalizeManifestBundles(manifest) {
  if (!Array.isArray(manifest?.bundles)) {
    return [];
  }

  return manifest.bundles
    .filter((bundle) => bundle && typeof bundle === 'object' && !Array.isArray(bundle))
    .map((bundle) => {
      const bundleId = String(bundle.id || bundle.bundleId || '').trim();
      const title = String(bundle.title || '').trim() || humanizeAssetKey(bundleId);
      const classification = deriveBundleClassification(bundle);
      const defaultMemberLoadMode = normalizeBundleLoadMode(bundle.defaultMemberLoadMode)
        || (classification === 'core' ? 'always' : null);
      return {
        bundleId,
        title,
        description: String(bundle.description || '').trim() || null,
        assetIds: normalizeList(bundle.assetIds),
        installTarget: String(bundle.installTarget || '').trim() || null,
        activationScope: String(bundle.activationScope || '').trim() || null,
        materialization: String(bundle.materialization || '').trim() || null,
        classification,
        targeting: normalizeBundleTargeting(bundle),
        tags: normalizeList(bundle.tags),
        defaultRecommended: bundle.defaultRecommended === true,
        dependsOn: normalizeList(bundle.dependsOn),
        defaultMemberLoadMode,
        uninstallPolicy: buildBundleUninstallPolicy(bundle, classification),
      };
    })
    .filter((bundle) => bundle.bundleId);
}

function buildTargeting(metadataEntry, parsedAsset, loadMode) {
  const targeting = {};
  const frameworks = normalizeList(metadataEntry?.frameworks || parsedAsset?.frontmatter?.frameworks);
  const stacks = normalizeList(metadataEntry?.stacks || parsedAsset?.frontmatter?.stacks);
  const languages = normalizeList(metadataEntry?.languages || parsedAsset?.frontmatter?.languages);
  const tags = normalizeList(
    metadataEntry?.tags ||
      metadataEntry?.keywords ||
      parsedAsset?.frontmatter?.tags ||
      parsedAsset?.triggers,
  );

  if (frameworks.length) {
    targeting.frameworks = frameworks;
  }
  if (stacks.length) {
    targeting.stacks = stacks;
  }
  if (languages.length) {
    targeting.languages = languages;
  }
  if (tags.length) {
    targeting.tags = tags;
  }
  if (loadMode) {
    targeting.loadMode = loadMode;
  }

  return Object.keys(targeting).length ? targeting : undefined;
}

function createCatalogEntry({
  kind,
  assetKey,
  assetId,
  layer,
  scope,
  title,
  description,
  contentPath,
  installState,
  lifecycle,
  metadata,
  targeting,
  provenance,
  activation,
  overlay,
}) {
  return {
    assetId,
    assetKey,
    kind,
    title,
    description,
    layer,
    scope,
    contentPath,
    installState,
    lifecycle,
    metadata,
    targeting,
    provenance,
    activation,
    overlay,
  };
}

function buildMetadataIndex(engineRoot) {
  const metadataIndexPath = path.join(path.resolve(engineRoot), 'engine-assets', 'skills', 'skill-metadata-index.json');
  const metadataIndex = readJsonIfExists(metadataIndexPath);
  const warnings = [];

  if (!metadataIndex) {
    warnings.push({
      code: 'skill_metadata_index_missing',
      message: 'Skill metadata index was not found; source skills will be cataloged with markdown-derived metadata only.',
      path: metadataIndexPath,
    });
    return { metadataIndexPath, metadataBySkill: new Map(), warnings };
  }

  const metadataBySkill = new Map();
  const entries = Array.isArray(metadataIndex.entries) ? metadataIndex.entries : [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const key = normalizeAssetKey('skill', entry.skill || entry.name);
    if (!key) {
      continue;
    }
    metadataBySkill.set(key, entry);
  }

  return { metadataIndexPath, metadataBySkill, warnings };
}

function loadManifest(engineRoot) {
  const manifestPath = path.join(path.resolve(engineRoot), 'engine-assets', 'manifest.json');
  const manifest = readJsonIfExists(manifestPath);
  if (!manifest || !Array.isArray(manifest.assets)) {
    throw new Error(`Invalid manifest JSON at ${manifestPath}`);
  }
  return {
    manifestPath,
    manifest,
    manifestAssetIndex: buildManifestAssetIndex(manifest.assets),
    bundles: normalizeManifestBundles(manifest),
  };
}

function buildProviderActivation(provider) {
  if (!provider || typeof provider !== 'object') {
    return undefined;
  }
  const defaults = provider.activationDefaults;
  if (!defaults || typeof defaults !== 'object') {
    return undefined;
  }
  return {
    eligible: true,
    scope: defaults.scope,
    repoOverrides: defaults.repoOverrides,
    plannerProfile: defaults.plannerProfile,
    orchestrationPolicy: defaults.orchestrationPolicy,
    defaultBundles: Array.isArray(defaults.defaultBundles)
      ? defaults.defaultBundles
      : Array.isArray(provider.defaultBundles)
        ? provider.defaultBundles
        : undefined,
    preferredLoadMode: defaults.preferredLoadMode,
  };
}

function createSourceEntries(engineRoot, metadataBySkill, warnings) {
  const { manifestPath, manifest, manifestAssetIndex, bundles } = loadManifest(engineRoot);
  const entries = [];

  for (const asset of manifest.assets) {
    if (!asset || typeof asset !== 'object') {
      continue;
    }

    const kind = manifestTypeToKind(asset.type);
    if (!kind) {
      continue;
    }

    const sourceRel = String(asset.source || '').trim();
    if (!sourceRel) {
      continue;
    }

    const sourceRootPath = path.resolve(engineRoot, sourceRel);
    const sourceStat = safeStat(sourceRootPath);
    if (!sourceStat) {
      warnings.push({
        code: 'manifest_source_missing',
        message: `Manifest asset points to missing source content: ${sourceRel}`,
        path: sourceRootPath,
        assetId: String(asset.id || ''),
      });
      continue;
    }

    const assetKey = normalizeAssetKey(
      kind,
      kind === 'skill'
        ? path.posix.basename(sourceRel.replace(/\\/g, '/'))
        : path.basename(sourceRel),
    );
    const assetId = String(asset.id || '').trim() || deriveAssetId(kind, assetKey);
    const primaryContentPath =
      kind === 'skill' && sourceStat.isDirectory()
        ? path.join(sourceRootPath, 'SKILL.md')
        : sourceRootPath;
    const parsedAsset = parseMarkdownAsset(primaryContentPath);
    const metadataEntry = kind === 'skill' ? metadataBySkill.get(assetKey) : undefined;
    const loadMode =
      kind === 'skill'
        ? String(
            asset.loadMode ||
              metadataEntry?.manifest?.loadMode ||
              parsedAsset.frontmatter['load-mode'] ||
              parsedAsset.frontmatter.loadMode ||
              'on-demand',
          ).trim()
        : undefined;

    entries.push(
      createCatalogEntry({
        kind,
        assetKey,
        assetId,
        layer: 'source',
        scope: buildScope('global'),
        title:
          parsedAsset.title ||
          String(metadataEntry?.name || '').trim() ||
          humanizeAssetKey(assetKey),
        description:
          String(metadataEntry?.description || '').trim() || parsedAsset.description || undefined,
        contentPath: primaryContentPath,
        installState: {
          availability: 'source-only',
          isInstalled: false,
          isAutoLoaded: loadMode === 'always',
          loadMode,
          sourcePath: sourceRootPath,
          contentHash: sha256PathHex(sourceRootPath) || undefined,
        },
        metadata: {
          source: 'engine-assets',
          sourceRootPath,
          manifestPath,
          manifestAssetId: assetId,
          manifestDestination: asset.destination,
          manifestLoadMode: asset.loadMode,
          triggersOn: metadataEntry?.triggersOn || parsedAsset.triggers,
          aliasKeys: mergeAliasKeys(buildAliasKeys(kind, assetKey, assetId), metadataEntry?.aliasKeys),
        },
        targeting: buildTargeting(metadataEntry, parsedAsset, loadMode),
      }),
    );
  }

  return { manifestPath, manifestAssetIndex, bundles, entries };
}

function scanUserAgents(elegyHome, providerCatalog = DEFAULT_PROVIDER_CATALOG) {
  const agentsDir = path.join(elegyHome, 'agents');
  return safeReadDir(agentsDir, { withFileTypes: true })
    .filter((entry) => isFileLike(entry, path.join(agentsDir, entry.name)))
    .map((entry) => {
      const contentPath = path.join(agentsDir, entry.name);
      const parsedAsset = parseMarkdownAsset(contentPath);
      if (!isRecognizedAgentMarkdownFile(entry.name, parsedAsset)) {
        return null;
      }

      const logicalName = normalizeAssetKey('agent', parsedAsset.frontmatter.name || entry.name);
        const origin = inferExternalAssetOrigin(contentPath, {
          kind: 'agent',
          fileKind: entry.name.toLowerCase().endsWith('.agent.md') ? 'agent-md' : 'plain-md',
          providers: providerCatalog,
        });
      const assetKey = origin.isExternal
        ? buildProviderQualifiedAssetKey('agent', logicalName, origin)
        : logicalName;
      const assetId = deriveAssetId('agent', assetKey);
      const viewPath = toCopilotRelativePath(elegyHome, contentPath) || `agents/${entry.name}`;

      return createCatalogEntry({
        kind: 'agent',
        assetKey,
        assetId,
        layer: 'user-installed',
        scope: buildScope('user'),
        title: parsedAsset.title || humanizeAssetKey(logicalName),
        description: parsedAsset.description || undefined,
        contentPath,
        installState: {
          availability: 'installed',
          isInstalled: true,
          materialization: 'materialized',
          contentHash: sha256PathHex(contentPath) || undefined,
          installedPaths: {
            'user-installed': contentPath,
          },
        },
        metadata: {
          source: origin.provider || 'user-home',
          provider: origin.provider || 'user-home',
          sourcePackage: origin.sourcePackage,
          namespace: origin.namespace,
          logicalName,
          readOnly: origin.isExternal,
          resolvedRealPath: origin.realPath,
          viewPath,
          aliasKeys: buildAssetAliasKeys('agent', assetKey, assetId, logicalName, origin),
        },
        provenance: origin.provenance,
        activation: buildProviderActivation(
          providerCatalog.providers.find((provider) => provider.id === origin.provenance?.providerId),
        ),
      });
    })
    .filter(Boolean)
    .sort((left, right) => String(left.assetId || '').localeCompare(String(right.assetId || '')));
}

function scanUserPrompts(elegyHome) {
  const promptsDir = path.join(elegyHome, 'prompts');
  return safeReadDir(promptsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.prompt.md'))
    .map((entry) => {
      const contentPath = path.join(promptsDir, entry.name);
      const assetKey = normalizeAssetKey('prompt', entry.name);
      const assetId = deriveAssetId('prompt', assetKey);
      const parsedAsset = parseMarkdownAsset(contentPath);
      return createCatalogEntry({
        kind: 'prompt',
        assetKey,
        assetId,
        layer: 'user-installed',
        scope: buildScope('user'),
        title: parsedAsset.title || humanizeAssetKey(assetKey),
        description: parsedAsset.description || undefined,
        contentPath,
        installState: {
          availability: 'installed',
          isInstalled: true,
          materialization: 'materialized',
          contentHash: sha256PathHex(contentPath) || undefined,
          installedPaths: {
            'user-installed': contentPath,
          },
        },
        metadata: {
          source: 'user-home',
          aliasKeys: buildAliasKeys('prompt', assetKey, assetId),
        },
      });
    });
}

function resolveSkillLoadMode({ layer, hasPointerStub, metadataEntry, parsedAsset, sourceEntry }) {
  return String(
    metadataEntry?.manifest?.loadMode ||
      parsedAsset?.frontmatter?.['load-mode'] ||
      parsedAsset?.frontmatter?.loadMode ||
      sourceEntry?.installState?.loadMode ||
      (layer === 'vault-only' || hasPointerStub ? 'on-demand' : 'always'),
  ).trim();
}

function buildSourceIndex(entries) {
  const byId = new Map();
  const byKeyAndKind = new Map();

  for (const entry of entries) {
    if (!entry || entry.layer !== 'source') {
      continue;
    }
    byId.set(entry.assetId, entry);
    byKeyAndKind.set(`${entry.kind}:${entry.assetKey}`, entry);
  }

  return { byId, byKeyAndKind };
}

function scanUserSkills(elegyHome, metadataBySkill, sourceIndex, providerCatalog = DEFAULT_PROVIDER_CATALOG) {
  const skillsDir = path.join(elegyHome, 'skills');
  const vaultDir = path.join(elegyHome, 'skills-vault');
  const entries = [];

  for (const skill of discoverSkillArtifacts(skillsDir, 'skills')) {
    const origin = inferExternalAssetOrigin(skill.contentPath, {
      kind: 'skill',
      namespace: skill.namespace,
      providers: providerCatalog,
    });
    const assetKey = origin.isExternal
      ? buildProviderQualifiedAssetKey('skill', skill.logicalName, origin)
      : skill.logicalName;
    const sourceEntry = origin.isExternal ? null : sourceIndex.byKeyAndKind.get(`skill:${assetKey}`);
    const assetId = sourceEntry?.assetId || deriveAssetId('skill', assetKey);
    const parsedAsset = parseMarkdownAsset(skill.contentPath);
    const metadataEntry = origin.isExternal ? null : metadataBySkill.get(skill.logicalName);
    const pointer = isPointerFile(skill.contentPath);
    const loadMode = resolveSkillLoadMode({
      layer: 'user-installed',
      hasPointerStub: pointer,
      metadataEntry,
      parsedAsset,
      sourceEntry,
    });

    entries.push(
      createCatalogEntry({
        kind: 'skill',
        assetKey,
        assetId,
        layer: 'user-installed',
        scope: buildScope('user'),
        title:
          parsedAsset.title ||
          sourceEntry?.title ||
          String(metadataEntry?.name || '').trim() ||
          humanizeAssetKey(skill.logicalName),
        description:
          parsedAsset.description ||
          String(metadataEntry?.description || '').trim() ||
          sourceEntry?.description ||
          undefined,
        contentPath: skill.contentPath,
        installState: {
          availability: 'installed',
          isInstalled: true,
          isAutoLoaded: loadMode === 'always',
          materialization: pointer ? 'pointer' : 'materialized',
          loadMode,
          contentHash: sha256PathHex(skill.rootPath) || undefined,
          installedPaths: {
            'user-installed': skill.contentPath,
          },
        },
        metadata: {
          source: origin.provider || 'user-home',
          provider: origin.provider || 'user-home',
          sourcePackage: origin.sourcePackage,
          namespace: origin.namespace,
          logicalName: skill.logicalName,
          readOnly: origin.isExternal,
          sourceRootPath: skill.rootPath,
          resolvedRealPath: origin.realPath,
          viewPath: skill.viewPath,
          triggersOn: metadataEntry?.triggersOn || parsedAsset.triggers,
          aliasKeys: buildAssetAliasKeys('skill', assetKey, assetId, skill.logicalName, origin, metadataEntry?.aliasKeys),
        },
        targeting: buildTargeting(metadataEntry, parsedAsset, loadMode),
        provenance: origin.provenance,
        activation: buildProviderActivation(
          providerCatalog.providers.find((provider) => provider.id === origin.provenance?.providerId),
        ),
      }),
    );
  }

  for (const skill of discoverSkillArtifacts(vaultDir, 'skills-vault')) {
    const origin = inferExternalAssetOrigin(skill.contentPath, {
      kind: 'skill',
      namespace: skill.namespace,
      providers: providerCatalog,
    });
    const assetKey = origin.isExternal
      ? buildProviderQualifiedAssetKey('skill', skill.logicalName, origin)
      : skill.logicalName;
    const sourceEntry = origin.isExternal ? null : sourceIndex.byKeyAndKind.get(`skill:${assetKey}`);
    const assetId = sourceEntry?.assetId || deriveAssetId('skill', assetKey);
    const parsedAsset = parseMarkdownAsset(skill.contentPath);
    const metadataEntry = origin.isExternal ? null : metadataBySkill.get(skill.logicalName);
    const loadMode = resolveSkillLoadMode({
      layer: 'vault-only',
      hasPointerStub: true,
      metadataEntry,
      parsedAsset,
      sourceEntry,
    });

    entries.push(
      createCatalogEntry({
        kind: 'skill',
        assetKey,
        assetId,
        layer: 'vault-only',
        scope: buildScope('user'),
        title:
          parsedAsset.title ||
          sourceEntry?.title ||
          String(metadataEntry?.name || '').trim() ||
          humanizeAssetKey(skill.logicalName),
        description:
          parsedAsset.description ||
          String(metadataEntry?.description || '').trim() ||
          sourceEntry?.description ||
          undefined,
        contentPath: skill.contentPath,
        installState: {
          availability: 'vault-only',
          isInstalled: true,
          isAutoLoaded: false,
          materialization: 'vault-only',
          loadMode,
          contentHash: sha256PathHex(skill.rootPath) || undefined,
          installedPaths: {
            'vault-only': skill.contentPath,
          },
        },
        metadata: {
          source: origin.provider || 'user-home',
          provider: origin.provider || 'user-home',
          sourcePackage: origin.sourcePackage,
          namespace: origin.namespace,
          logicalName: skill.logicalName,
          readOnly: origin.isExternal,
          sourceRootPath: skill.rootPath,
          resolvedRealPath: origin.realPath,
          viewPath: skill.viewPath,
          triggersOn: metadataEntry?.triggersOn || parsedAsset.triggers,
          aliasKeys: buildAssetAliasKeys('skill', assetKey, assetId, skill.logicalName, origin, metadataEntry?.aliasKeys),
        },
        targeting: buildTargeting(metadataEntry, parsedAsset, loadMode),
        provenance: origin.provenance,
        activation: buildProviderActivation(
          providerCatalog.providers.find((provider) => provider.id === origin.provenance?.providerId),
        ),
      }),
    );
  }

  return entries;
}

function scanRepoLocalEntries(
  repoContext,
  metadataBySkill,
  sourceIndex,
  providerCatalog = DEFAULT_PROVIDER_CATALOG,
) {
  if (!repoContext?.repoPath) {
    return [];
  }

  const entries = [];
  const agentsDir = path.join(repoContext.repoPath, '.github', 'agents');
  const skillsDir = path.join(repoContext.repoPath, '.github', 'skills');

  for (const entry of safeReadDir(agentsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.agent.md')) {
      continue;
    }

    const contentPath = path.join(agentsDir, entry.name);
    const assetKey = normalizeAssetKey('agent', entry.name);
    const sourceEntry = sourceIndex.byKeyAndKind.get(`agent:${assetKey}`);
    const assetId = sourceEntry?.assetId || deriveAssetId('agent', assetKey);
    const parsedAsset = parseMarkdownAsset(contentPath);

    entries.push(
      createCatalogEntry({
        kind: 'agent',
        assetKey,
        assetId,
        layer: 'repo-local',
        scope: buildScope('repo', repoContext),
        title: parsedAsset.title || sourceEntry?.title || humanizeAssetKey(assetKey),
        description: parsedAsset.description || sourceEntry?.description || undefined,
        contentPath,
        installState: {
          availability: 'repo-local',
          isInstalled: true,
          materialization: 'materialized',
          contentHash: sha256PathHex(contentPath) || undefined,
          installedPaths: {
            'repo-local': contentPath,
          },
        },
        metadata: {
          source: 'repo-local',
          aliasKeys: buildAliasKeys('agent', assetKey, assetId),
        },
      }),
    );
  }

  for (const skill of discoverSkillArtifacts(skillsDir, '.github/skills')) {
    const origin = inferExternalAssetOrigin(skill.contentPath, {
      kind: 'skill',
      namespace: skill.namespace,
      providers: providerCatalog,
    });
    const assetKey = origin.isExternal
      ? buildProviderQualifiedAssetKey('skill', skill.logicalName, origin)
      : skill.logicalName;
    const sourceEntry = origin.isExternal ? null : sourceIndex.byKeyAndKind.get(`skill:${assetKey}`);
    const assetId = sourceEntry?.assetId || deriveAssetId('skill', assetKey);
    const parsedAsset = parseMarkdownAsset(skill.contentPath);
    const metadataEntry = origin.isExternal ? null : metadataBySkill.get(skill.logicalName);
    const pointer = isPointerFile(skill.contentPath);
    const loadMode = resolveSkillLoadMode({
      layer: 'repo-local',
      hasPointerStub: pointer,
      metadataEntry,
      parsedAsset,
      sourceEntry,
    });

    entries.push(
      createCatalogEntry({
        kind: 'skill',
        assetKey,
        assetId,
        layer: 'repo-local',
        scope: buildScope('repo', repoContext),
        title:
          parsedAsset.title ||
          sourceEntry?.title ||
          String(metadataEntry?.name || '').trim() ||
          humanizeAssetKey(skill.logicalName),
        description:
          parsedAsset.description ||
          sourceEntry?.description ||
          String(metadataEntry?.description || '').trim() ||
          undefined,
        contentPath: skill.contentPath,
        installState: {
          availability: 'repo-local',
          isInstalled: true,
          isAutoLoaded: loadMode === 'always',
          materialization: pointer ? 'pointer' : 'materialized',
          loadMode,
          contentHash: sha256PathHex(skill.rootPath) || undefined,
          installedPaths: {
            'repo-local': skill.contentPath,
          },
        },
        metadata: {
          source: origin.provider || 'repo-local',
          provider: origin.provider || 'repo-local',
          sourcePackage: origin.sourcePackage,
          namespace: origin.namespace,
          logicalName: skill.logicalName,
          readOnly: origin.isExternal,
          sourceRootPath: skill.rootPath,
          resolvedRealPath: origin.realPath,
          viewPath: skill.viewPath,
          triggersOn: metadataEntry?.triggersOn || parsedAsset.triggers,
          aliasKeys: buildAssetAliasKeys('skill', assetKey, assetId, skill.logicalName, origin, metadataEntry?.aliasKeys),
        },
        targeting: buildTargeting(metadataEntry, parsedAsset, loadMode),
        provenance: origin.provenance,
        activation: buildProviderActivation(
          providerCatalog.providers.find((provider) => provider.id === origin.provenance?.providerId),
        ),
      }),
    );
  }

  return entries;
}

function buildAssetLookup(entries) {
  const lookup = {
    skills: new Map(),
    agents: new Map(),
    prompts: new Map(),
  };

  for (const entry of entries) {
    if (!entry || !entry.assetId) {
      continue;
    }
    const target =
      entry.kind === 'skill' ? lookup.skills : entry.kind === 'agent' ? lookup.agents : lookup.prompts;
    const aliases = Array.isArray(entry.metadata?.aliasKeys) ? entry.metadata.aliasKeys : [];
    for (const key of [entry.assetId, entry.assetKey, ...aliases]) {
      const normalized = String(key || '').trim().toLowerCase();
      if (normalized && !target.has(normalized)) {
        target.set(normalized, {
          assetId: entry.assetId,
          assetKey: entry.assetKey,
          kind: entry.kind,
        });
      }
    }
  }

  return lookup;
}

function buildRepoOverlayEntries(elegyHome, repoContext, allEntries) {
  if (!repoContext?.repoId) {
    return { entries: [], registryPath: null };
  }

  const registryPath = path.join(elegyHome, 'repo-state', repoContext.repoId, 'registry.json');
  const registry = readJsonIfExists(registryPath);
  if (!registry || typeof registry !== 'object') {
    return { entries: [], registryPath };
  }

  const lookup = buildAssetLookup(allEntries);
  const registryStat = safeStat(registryPath);
  const updatedAt = registryStat?.mtime?.toISOString();
  const overlayEntries = [];
  const sections = [
    { registryKey: 'skills', kind: 'skill', lookupMap: lookup.skills },
    { registryKey: 'agents', kind: 'agent', lookupMap: lookup.agents },
  ];

  for (const section of sections) {
    const data = registry[section.registryKey];
    if (!data || typeof data !== 'object') {
      continue;
    }

    for (const rawKey of normalizeList(data.enabled)) {
      const normalized = rawKey.toLowerCase();
      const resolved =
        section.lookupMap.get(normalized) ||
        section.lookupMap.get(`${section.kind}-${normalized}`) || {
          assetId: deriveAssetId(section.kind, rawKey),
          assetKey: normalizeAssetKey(section.kind, rawKey),
          kind: section.kind,
        };

      overlayEntries.push(
        createCatalogEntry({
          kind: section.kind,
          assetKey: resolved.assetKey,
          assetId: resolved.assetId,
          layer: 'repo-state-overlay',
          scope: buildScope('repo', repoContext),
          title: humanizeAssetKey(resolved.assetKey),
          overlay: {
            repoId: repoContext.repoId,
            repoPath: repoContext.repoPath,
            enabled: true,
            updatedAt,
          },
          metadata: {
            source: 'repo-state',
            registryPath,
            aliasKeys: buildAliasKeys(section.kind, resolved.assetKey, resolved.assetId),
          },
        }),
      );
    }

    for (const rawKey of normalizeList(data.disabled)) {
      const normalized = rawKey.toLowerCase();
      const resolved =
        section.lookupMap.get(normalized) ||
        section.lookupMap.get(`${section.kind}-${normalized}`) || {
          assetId: deriveAssetId(section.kind, rawKey),
          assetKey: normalizeAssetKey(section.kind, rawKey),
          kind: section.kind,
        };

      overlayEntries.push(
        createCatalogEntry({
          kind: section.kind,
          assetKey: resolved.assetKey,
          assetId: resolved.assetId,
          layer: 'repo-state-overlay',
          scope: buildScope('repo', repoContext),
          title: humanizeAssetKey(resolved.assetKey),
          overlay: {
            repoId: repoContext.repoId,
            repoPath: repoContext.repoPath,
            enabled: false,
            updatedAt,
          },
          metadata: {
            source: 'repo-state',
            registryPath,
            aliasKeys: buildAliasKeys(section.kind, resolved.assetKey, resolved.assetId),
          },
        }),
      );
    }
  }

  return { entries: overlayEntries, registryPath };
}

function sortEntries(entries) {
  return [...entries].sort((a, b) => {
    const precedence = compareAssetCatalogEntries(a, b);
    if (precedence !== 0) {
      return precedence;
    }
    const keyCompare = String(a.assetKey || '').localeCompare(String(b.assetKey || ''));
    if (keyCompare !== 0) {
      return keyCompare;
    }
    return String(a.contentPath || '').localeCompare(String(b.contentPath || ''));
  });
}

function buildEffectiveAssets(entries) {
  const byAssetId = new Map();
  for (const entry of entries) {
    if (!entry || !entry.assetId) {
      continue;
    }
    if (!byAssetId.has(entry.assetId)) {
      byAssetId.set(entry.assetId, []);
    }
    byAssetId.get(entry.assetId).push(entry);
  }

  return Array.from(byAssetId.values())
    .map((group) => resolveEffectiveAssetState(group))
    .sort((a, b) => {
      const kindCompare = String(a.kind || '').localeCompare(String(b.kind || ''));
      if (kindCompare !== 0) {
        return kindCompare;
      }
      return String(a.assetKey || '').localeCompare(String(b.assetKey || ''));
    });
}

function incrementCounter(target, key) {
  target[key] = (target[key] || 0) + 1;
}

function buildBundleMember(bundle, assetId, effectiveById, sourceEntriesById, manifestAssetIndex, warnings) {
  const effectiveAsset = effectiveById.get(assetId) || null;
  const sourceEntry = sourceEntriesById.get(assetId) || null;
  const manifestAsset = manifestAssetIndex.get(assetId) || null;

  if (!manifestAsset) {
    warnings.push({
      code: 'bundle_asset_unknown',
      message: `Bundle ${bundle.bundleId} references asset '${assetId}' that is not declared in the manifest asset list.`,
      bundleId: bundle.bundleId,
      assetId,
    });
  } else if (!effectiveAsset) {
    warnings.push({
      code: 'bundle_member_missing_source_state',
      message: `Bundle ${bundle.bundleId} references asset '${assetId}' but no projected source state was found.`,
      bundleId: bundle.bundleId,
      assetId,
    });
  }

  const assetKey = effectiveAsset?.assetKey || sourceEntry?.assetKey || manifestAsset?.assetKey || '';
  const kind = effectiveAsset?.kind || sourceEntry?.kind || manifestAsset?.kind || null;
  const title =
    effectiveAsset?.selectedEntry?.title ||
    sourceEntry?.title ||
    humanizeAssetKey(assetKey || assetId);
  const loadMode = effectiveAsset?.installState?.loadMode
    || sourceEntry?.installState?.loadMode
    || normalizeBundleLoadMode(manifestAsset?.loadMode)
    || null;
  const defaultLoadMode = bundle.defaultMemberLoadMode
    || normalizeBundleLoadMode(manifestAsset?.loadMode)
    || loadMode
    || null;

  return {
    assetId,
    assetKey,
    kind,
    title,
    available: Boolean(effectiveAsset?.available),
    installed: Boolean(effectiveAsset?.installed),
    enabled: Boolean(effectiveAsset?.enabled),
    selectedLayer: effectiveAsset?.selectedLayer || null,
    loadMode,
    defaultLoadMode,
    missing: !effectiveAsset,
  };
}

function buildBundleMemberStats(members) {
  return {
    memberCount: members.length,
    availableCount: members.filter((member) => member.available).length,
    installedCount: members.filter((member) => member.installed).length,
    enabledCount: members.filter((member) => member.enabled).length,
    missingCount: members.filter((member) => member.missing).length,
  };
}

function resolveBundleStatus(stats) {
  if (!stats.memberCount || stats.missingCount === stats.memberCount) {
    return 'missing';
  }
  if (stats.installedCount === stats.memberCount && stats.enabledCount === stats.memberCount) {
    return 'active';
  }
  if (stats.installedCount === stats.memberCount) {
    return 'installed';
  }
  if (stats.availableCount === stats.memberCount) {
    return 'available';
  }
  return 'partial';
}

function buildBundleProjection(manifestBundles, effectiveAssets, sourceEntriesById, manifestAssetIndex, warnings) {
  const effectiveById = new Map();
  for (const asset of Array.isArray(effectiveAssets) ? effectiveAssets : []) {
    if (asset?.assetId) {
      effectiveById.set(asset.assetId, asset);
    }
  }

  return (Array.isArray(manifestBundles) ? manifestBundles : []).map((bundle) => {
    const members = bundle.assetIds.map((assetId) =>
      buildBundleMember(bundle, assetId, effectiveById, sourceEntriesById, manifestAssetIndex, warnings)
    );
    const stats = buildBundleMemberStats(members);
    return {
      bundleId: bundle.bundleId,
      title: bundle.title,
      description: bundle.description,
      assetIds: [...bundle.assetIds],
      installTarget: bundle.installTarget,
      activationScope: bundle.activationScope,
      materialization: bundle.materialization,
      classification: bundle.classification,
      targeting: bundle.targeting ? { ...bundle.targeting } : undefined,
      tags: [...bundle.tags],
      defaultRecommended: bundle.defaultRecommended,
      dependsOn: [...bundle.dependsOn],
      defaultMemberLoadMode: bundle.defaultMemberLoadMode,
      uninstallPolicy: bundle.uninstallPolicy ? { ...bundle.uninstallPolicy } : undefined,
      status: resolveBundleStatus(stats),
      stats,
      members,
    };
  });
}

function buildBundleStats(bundles) {
  const statusCounts = {};
  let memberCount = 0;
  let availableMemberCount = 0;
  let installedMemberCount = 0;
  let enabledMemberCount = 0;
  let missingMemberCount = 0;

  for (const bundle of bundles) {
    incrementCounter(statusCounts, bundle.status);
    memberCount += bundle.stats.memberCount;
    availableMemberCount += bundle.stats.availableCount;
    installedMemberCount += bundle.stats.installedCount;
    enabledMemberCount += bundle.stats.enabledCount;
    missingMemberCount += bundle.stats.missingCount;
  }

  return {
    totalCount: bundles.length,
    defaultRecommendedCount: bundles.filter((bundle) => bundle.defaultRecommended).length,
    activeCount: statusCounts.active || 0,
    installedCount: statusCounts.installed || 0,
    availableCount: statusCounts.available || 0,
    partialCount: statusCounts.partial || 0,
    missingCount: statusCounts.missing || 0,
    memberCount,
    availableMemberCount,
    installedMemberCount,
    enabledMemberCount,
    missingMemberCount,
  };
}

function buildStats(entries, effectiveAssets, bundles) {
  const byLayer = {};
  const byKind = {};
  for (const entry of entries) {
    incrementCounter(byLayer, entry.layer);
    incrementCounter(byKind, entry.kind);
  }

  return {
    entryCount: entries.length,
    effectiveCount: effectiveAssets.length,
    byLayer,
    byKind,
    enabledCount: effectiveAssets.filter((asset) => asset.enabled).length,
    installedCount: effectiveAssets.filter((asset) => asset.installed).length,
    recommendedCount: effectiveAssets.filter((asset) => asset.recommended).length,
    overriddenCount: effectiveAssets.filter((asset) => asset.overridden).length,
    bundles: buildBundleStats(bundles),
  };
}

function buildCatalogProjection(options = {}) {
  const engineRoot = path.resolve(options.engineRoot || process.cwd());
  const storage = resolveProjectionStorage(options);
  const repoContext = storage.repoContext;
  const warnings = [];
  const providerCatalogScan = loadProviderCatalog(engineRoot);
  const providerStateScan = loadProviderInstallState(storage.elegyHome);

  const metadataIndex = buildMetadataIndex(engineRoot);
  warnings.push(...metadataIndex.warnings);

  const sourceScan = createSourceEntries(engineRoot, metadataIndex.metadataBySkill, warnings);
  const sourceIndex = buildSourceIndex(sourceScan.entries);
  const userEntries = [
    ...scanUserAgents(storage.elegyHome, providerCatalogScan.providerCatalog),
    ...scanUserPrompts(storage.elegyHome),
    ...scanUserSkills(
      storage.elegyHome,
      metadataIndex.metadataBySkill,
      sourceIndex,
      providerCatalogScan.providerCatalog,
    ),
  ];
  const repoLocalEntries = scanRepoLocalEntries(
    repoContext,
    metadataIndex.metadataBySkill,
    sourceIndex,
    providerCatalogScan.providerCatalog,
  );
  const overlayScan = buildRepoOverlayEntries(storage.elegyHome, repoContext, [
    ...sourceScan.entries,
    ...userEntries,
    ...repoLocalEntries,
  ]);

  const entries = sortEntries([
    ...sourceScan.entries,
    ...userEntries,
    ...repoLocalEntries,
    ...overlayScan.entries,
  ]);
  const effectiveAssets = buildEffectiveAssets(entries);
  const bundles = buildBundleProjection(
    sourceScan.bundles,
    effectiveAssets,
    sourceIndex.byId,
    sourceScan.manifestAssetIndex,
    warnings,
  );
  const providers = buildProviderProjection(
    providerCatalogScan.providerCatalog,
    providerStateScan.state,
    effectiveAssets,
  );

  return {
    schemaVersion: CATALOG_PROJECTION_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    engineRoot,
    elegyHome: storage.elegyHome,
    repoContext,
    storage,
    inputs: {
      manifestPath: sourceScan.manifestPath,
      metadataIndexPath: metadataIndex.metadataIndexPath,
      registryPath: overlayScan.registryPath,
      providerCatalogPath: providerCatalogScan.providerCatalogPath,
      providerStatePath: providerStateScan.statePath,
    },
    warnings,
    entries,
    effectiveAssets,
    bundles,
    providers,
    stats: buildStats(entries, effectiveAssets, bundles),
  };
}

function rebuildCatalogProjection(options = {}) {
  const snapshot = buildCatalogProjection(options);
  writeJsonAtomic(snapshot.storage.snapshotPath, snapshot);
  return snapshot;
}

function loadCatalogProjectionSnapshot(options = {}) {
  const storage = resolveProjectionStorage(options);
  return readJsonIfExists(storage.snapshotPath);
}

function resolveSnapshotChangeTimestamp(changeState) {
  const changedMs = Number(changeState?.lastChangedMs);
  return Number.isFinite(changedMs) ? changedMs : null;
}

function isCatalogProjectionSnapshotStale(snapshot, changeState) {
  if (!snapshot) {
    return false;
  }

  const changedMs = resolveSnapshotChangeTimestamp(changeState);
  if (!Number.isFinite(changedMs)) {
    return false;
  }

  const generatedMs = Date.parse(snapshot.generatedAt || '');
  if (!Number.isFinite(generatedMs)) {
    return true;
  }

  return changedMs > generatedMs;
}

function resolveCatalogProjectionSnapshot(options = {}) {
  const storage = resolveProjectionStorage(options);
  const persistedSnapshot = loadCatalogProjectionSnapshot(options);
  const stalePersistedSnapshot = isCatalogProjectionSnapshotStale(persistedSnapshot, options.changeState);
  const allowFallback = options.allowFallback !== false;

  if (persistedSnapshot && !stalePersistedSnapshot) {
    return {
      storage,
      persistedSnapshot,
      snapshot: persistedSnapshot,
      readMode: 'persisted-snapshot',
      buildError: null,
      stalePersistedSnapshot: false,
    };
  }

  if (!allowFallback) {
    return {
      storage,
      persistedSnapshot,
      snapshot: null,
      readMode: stalePersistedSnapshot ? 'stale-persisted-snapshot' : 'missing',
      buildError: null,
      stalePersistedSnapshot,
    };
  }

  try {
    return {
      storage,
      persistedSnapshot,
      snapshot: rebuildCatalogProjection(options),
      readMode: stalePersistedSnapshot ? 'change-tracker-rebuild' : 'filesystem-fallback',
      buildError: null,
      stalePersistedSnapshot,
    };
  } catch (error) {
    return {
      storage,
      persistedSnapshot,
      snapshot: null,
      readMode: stalePersistedSnapshot ? 'stale-persisted-snapshot' : 'missing',
      buildError: error,
      stalePersistedSnapshot,
    };
  }
}

function collectSearchTerms(asset) {
  const selectedEntry = asset.selectedEntry || asset;
  const terms = [
    asset.assetId,
    asset.assetKey,
    asset.kind,
    selectedEntry?.title,
    selectedEntry?.description,
    selectedEntry?.metadata?.provider,
    selectedEntry?.metadata?.sourcePackage,
    selectedEntry?.metadata?.namespace,
    selectedEntry?.metadata?.logicalName,
  ];

  const tags = selectedEntry?.targeting?.tags;
  if (Array.isArray(tags)) {
    terms.push(...tags);
  }

  const triggers = selectedEntry?.metadata?.triggersOn;
  if (Array.isArray(triggers)) {
    terms.push(...triggers);
  }

  const aliases = selectedEntry?.metadata?.aliasKeys;
  if (Array.isArray(aliases)) {
    terms.push(...aliases);
  }

  return terms
    .map((term) => String(term || '').trim().toLowerCase())
    .filter(Boolean);
}

function collectBundleSearchTerms(bundle) {
  const targeting = bundle?.targeting && typeof bundle.targeting === 'object' ? bundle.targeting : {};
  const terms = [
    bundle.bundleId,
    bundle.title,
    bundle.description,
    bundle.classification,
    bundle.status,
    ...(Array.isArray(bundle.tags) ? bundle.tags : []),
    ...normalizeList(targeting.languages),
    ...normalizeList(targeting.frameworks),
    ...normalizeList(targeting.stacks),
    ...normalizeList(targeting.tags),
    ...normalizeList(targeting.scopeKinds),
    ...(Array.isArray(bundle.assetIds) ? bundle.assetIds : []),
    ...(Array.isArray(bundle.dependsOn) ? bundle.dependsOn : []),
  ];

  for (const member of Array.isArray(bundle.members) ? bundle.members : []) {
    terms.push(member.assetId, member.assetKey, member.kind, member.title);
  }

  return terms
    .map((term) => String(term || '').trim().toLowerCase())
    .filter(Boolean);
}

function filterByCommonCriteria(items, filters = {}, options = {}) {
  const includeText = String(filters.text || '').trim().toLowerCase();
  const selectedLayerKey = options.selectedLayerKey || 'layer';

  return items.filter((item) => {
    if (filters.assetId && item.assetId !== filters.assetId) {
      return false;
    }
    if (filters.assetKey && item.assetKey !== filters.assetKey) {
      return false;
    }
    if (filters.kind && item.kind !== filters.kind) {
      return false;
    }
    if (filters.scopeKind && item.scope?.kind !== filters.scopeKind) {
      return false;
    }
    if (filters.repoId && item.scope?.repoId !== filters.repoId) {
      return false;
    }
    if (filters.layer && item[selectedLayerKey] !== filters.layer) {
      return false;
    }
    if (typeof filters.installed === 'boolean' && Boolean(item.installed) !== filters.installed) {
      return false;
    }
    if (typeof filters.enabled === 'boolean' && Boolean(item.enabled) !== filters.enabled) {
      return false;
    }
    if (typeof filters.recommended === 'boolean' && Boolean(item.recommended) !== filters.recommended) {
      return false;
    }
    if (typeof filters.available === 'boolean' && Boolean(item.available) !== filters.available) {
      return false;
    }
    if (includeText) {
      const terms = collectSearchTerms(item);
      if (!terms.some((term) => term.includes(includeText))) {
        return false;
      }
    }
    return true;
  });
}

function queryEffectiveCatalog(snapshot, filters = {}) {
  const effectiveAssets = Array.isArray(snapshot?.effectiveAssets) ? snapshot.effectiveAssets : [];
  return filterByCommonCriteria(effectiveAssets, filters, { selectedLayerKey: 'selectedLayer' });
}

function queryCatalogEntries(snapshot, filters = {}) {
  const entries = Array.isArray(snapshot?.entries) ? snapshot.entries : [];
  return filterByCommonCriteria(entries, filters, { selectedLayerKey: 'layer' });
}

function queryCatalogBundles(snapshot, filters = {}) {
  const bundles = Array.isArray(snapshot?.bundles) ? snapshot.bundles : [];
  const includeText = String(filters.text || '').trim().toLowerCase();
  const classificationFilter = String(filters.classification || '').trim().toLowerCase();
  const languageFilter = String(filters.language || '').trim().toLowerCase();
  const frameworkFilter = String(filters.framework || '').trim().toLowerCase();
  const stackFilter = String(filters.stack || '').trim().toLowerCase();
  const tagFilter = String(filters.tag || '').trim().toLowerCase();
  const scopeKindFilter = String(filters.scopeKind || '').trim().toLowerCase();

  return bundles.filter((bundle) => {
    const targeting = bundle?.targeting && typeof bundle.targeting === 'object' ? bundle.targeting : {};
    if (filters.bundleId && bundle.bundleId !== filters.bundleId) {
      return false;
    }
    if (classificationFilter && String(bundle.classification || '').trim().toLowerCase() !== classificationFilter) {
      return false;
    }
    if (languageFilter && !normalizeList(targeting.languages).some((value) => value.toLowerCase() === languageFilter)) {
      return false;
    }
    if (frameworkFilter && !normalizeList(targeting.frameworks).some((value) => value.toLowerCase() === frameworkFilter)) {
      return false;
    }
    if (stackFilter && !normalizeList(targeting.stacks).some((value) => value.toLowerCase() === stackFilter)) {
      return false;
    }
    if (tagFilter) {
      const tags = new Set([
        ...normalizeList(bundle.tags).map((value) => value.toLowerCase()),
        ...normalizeList(targeting.tags).map((value) => value.toLowerCase()),
      ]);
      if (!tags.has(tagFilter)) {
        return false;
      }
    }
    if (scopeKindFilter) {
      const scopeKinds = new Set([
        ...normalizeList(targeting.scopeKinds).map((value) => value.toLowerCase()),
        String(bundle.activationScope || '').trim().toLowerCase(),
      ]);
      if (!scopeKinds.has(scopeKindFilter)) {
        return false;
      }
    }
    if (includeText) {
      const terms = collectBundleSearchTerms(bundle);
      if (!terms.some((term) => term.includes(includeText))) {
        return false;
      }
    }
    return true;
  });
}

function getEffectiveAsset(snapshot, assetId) {
  return queryEffectiveCatalog(snapshot, { assetId })[0] || null;
}

function getCatalogBundle(snapshot, bundleId) {
  return queryCatalogBundles(snapshot, { bundleId })[0] || null;
}

module.exports = {
  CATALOG_PROJECTION_SCHEMA_VERSION,
  buildCatalogProjection,
  buildProviderQualifiedAssetKey,
  inferExternalAssetOrigin,
  rebuildCatalogProjection,
  loadCatalogProjectionSnapshot,
  isCatalogProjectionSnapshotStale,
  resolveCatalogProjectionSnapshot,
  parseMarkdownAsset,
  resolveProjectionStorage,
  resolveRepoContext,
  getRepoStateKey,
  toCopilotRelativePath,
  queryCatalogEntries,
  queryEffectiveCatalog,
  queryCatalogBundles,
  getEffectiveAsset,
  getCatalogBundle,
};
