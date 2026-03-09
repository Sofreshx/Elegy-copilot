'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  compareAssetCatalogEntries,
  resolveEffectiveAssetState,
} = require('@instruction-engine/contracts');

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

function resolveCopilotHome(inputPath) {
  return path.resolve(expandHome(inputPath || '~/.copilot'));
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
  };
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
  const copilotHome = resolveCopilotHome(options.copilotHome);
  const repoContext = resolveRepoContext(options);
  const snapshotName = repoContext?.repoId ? `repo-${repoContext.repoId}` : DEFAULT_SNAPSHOT_NAME;
  const catalogRoot = path.join(copilotHome, 'catalog');
  const snapshotPath = path.join(catalogRoot, 'projections', `${snapshotName}.json`);

  return {
    copilotHome,
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
  return { manifestPath, manifest };
}

function createSourceEntries(engineRoot, metadataBySkill, warnings) {
  const { manifestPath, manifest } = loadManifest(engineRoot);
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
          aliasKeys: buildAliasKeys(kind, assetKey, assetId),
        },
        targeting: buildTargeting(metadataEntry, parsedAsset, loadMode),
      }),
    );
  }

  return { manifestPath, entries };
}

function scanUserAgents(copilotHome) {
  const agentsDir = path.join(copilotHome, 'agents');
  return safeReadDir(agentsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.agent.md'))
    .map((entry) => {
      const contentPath = path.join(agentsDir, entry.name);
      const assetKey = normalizeAssetKey('agent', entry.name);
      const assetId = deriveAssetId('agent', assetKey);
      const parsedAsset = parseMarkdownAsset(contentPath);
      return createCatalogEntry({
        kind: 'agent',
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
          aliasKeys: buildAliasKeys('agent', assetKey, assetId),
        },
      });
    });
}

function scanUserPrompts(copilotHome) {
  const promptsDir = path.join(copilotHome, 'prompts');
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

function scanUserSkills(copilotHome, metadataBySkill, sourceIndex) {
  const skillsDir = path.join(copilotHome, 'skills');
  const vaultDir = path.join(copilotHome, 'skills-vault');
  const entries = [];

  for (const entry of safeReadDir(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const skillRoot = path.join(skillsDir, entry.name);
    const contentPath = path.join(skillRoot, 'SKILL.md');
    if (!safeStat(contentPath)?.isFile()) {
      continue;
    }

    const assetKey = normalizeAssetKey('skill', entry.name);
    const sourceEntry = sourceIndex.byKeyAndKind.get(`skill:${assetKey}`);
    const assetId = sourceEntry?.assetId || deriveAssetId('skill', assetKey);
    const parsedAsset = parseMarkdownAsset(contentPath);
    const metadataEntry = metadataBySkill.get(assetKey);
    const pointer = isPointerFile(contentPath);
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
          humanizeAssetKey(assetKey),
        description:
          parsedAsset.description ||
          String(metadataEntry?.description || '').trim() ||
          sourceEntry?.description ||
          undefined,
        contentPath,
        installState: {
          availability: 'installed',
          isInstalled: true,
          isAutoLoaded: loadMode === 'always',
          materialization: pointer ? 'pointer' : 'materialized',
          loadMode,
          contentHash: sha256PathHex(skillRoot) || undefined,
          installedPaths: {
            'user-installed': contentPath,
          },
        },
        metadata: {
          source: 'user-home',
          sourceRootPath: skillRoot,
          triggersOn: metadataEntry?.triggersOn || parsedAsset.triggers,
          aliasKeys: buildAliasKeys('skill', assetKey, assetId),
        },
        targeting: buildTargeting(metadataEntry, parsedAsset, loadMode),
      }),
    );
  }

  for (const entry of safeReadDir(vaultDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const skillRoot = path.join(vaultDir, entry.name);
    const contentPath = path.join(skillRoot, 'SKILL.md');
    if (!safeStat(contentPath)?.isFile()) {
      continue;
    }

    const assetKey = normalizeAssetKey('skill', entry.name);
    const sourceEntry = sourceIndex.byKeyAndKind.get(`skill:${assetKey}`);
    const assetId = sourceEntry?.assetId || deriveAssetId('skill', assetKey);
    const parsedAsset = parseMarkdownAsset(contentPath);
    const metadataEntry = metadataBySkill.get(assetKey);
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
          humanizeAssetKey(assetKey),
        description:
          parsedAsset.description ||
          String(metadataEntry?.description || '').trim() ||
          sourceEntry?.description ||
          undefined,
        contentPath,
        installState: {
          availability: 'vault-only',
          isInstalled: true,
          isAutoLoaded: false,
          materialization: 'vault-only',
          loadMode,
          contentHash: sha256PathHex(skillRoot) || undefined,
          installedPaths: {
            'vault-only': contentPath,
          },
        },
        metadata: {
          source: 'user-home',
          sourceRootPath: skillRoot,
          triggersOn: metadataEntry?.triggersOn || parsedAsset.triggers,
          aliasKeys: buildAliasKeys('skill', assetKey, assetId),
        },
        targeting: buildTargeting(metadataEntry, parsedAsset, loadMode),
      }),
    );
  }

  return entries;
}

function scanRepoLocalEntries(repoContext, metadataBySkill, sourceIndex) {
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

  for (const entry of safeReadDir(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const skillRoot = path.join(skillsDir, entry.name);
    const contentPath = path.join(skillRoot, 'SKILL.md');
    if (!safeStat(contentPath)?.isFile()) {
      continue;
    }

    const assetKey = normalizeAssetKey('skill', entry.name);
    const sourceEntry = sourceIndex.byKeyAndKind.get(`skill:${assetKey}`);
    const assetId = sourceEntry?.assetId || deriveAssetId('skill', assetKey);
    const parsedAsset = parseMarkdownAsset(contentPath);
    const metadataEntry = metadataBySkill.get(assetKey);
    const loadMode = resolveSkillLoadMode({
      layer: 'repo-local',
      hasPointerStub: false,
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
          humanizeAssetKey(assetKey),
        description:
          parsedAsset.description ||
          sourceEntry?.description ||
          String(metadataEntry?.description || '').trim() ||
          undefined,
        contentPath,
        installState: {
          availability: 'repo-local',
          isInstalled: true,
          isAutoLoaded: loadMode === 'always',
          materialization: 'materialized',
          loadMode,
          contentHash: sha256PathHex(skillRoot) || undefined,
          installedPaths: {
            'repo-local': contentPath,
          },
        },
        metadata: {
          source: 'repo-local',
          sourceRootPath: skillRoot,
          triggersOn: metadataEntry?.triggersOn || parsedAsset.triggers,
          aliasKeys: buildAliasKeys('skill', assetKey, assetId),
        },
        targeting: buildTargeting(metadataEntry, parsedAsset, loadMode),
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

function buildRepoOverlayEntries(copilotHome, repoContext, allEntries) {
  if (!repoContext?.repoId) {
    return { entries: [], registryPath: null };
  }

  const registryPath = path.join(copilotHome, 'repo-state', repoContext.repoId, 'registry.json');
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

function buildStats(entries, effectiveAssets) {
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
  };
}

function buildCatalogProjection(options = {}) {
  const engineRoot = path.resolve(options.engineRoot || process.cwd());
  const storage = resolveProjectionStorage(options);
  const repoContext = storage.repoContext;
  const warnings = [];

  const metadataIndex = buildMetadataIndex(engineRoot);
  warnings.push(...metadataIndex.warnings);

  const sourceScan = createSourceEntries(engineRoot, metadataIndex.metadataBySkill, warnings);
  const sourceIndex = buildSourceIndex(sourceScan.entries);
  const userEntries = [
    ...scanUserAgents(storage.copilotHome),
    ...scanUserPrompts(storage.copilotHome),
    ...scanUserSkills(storage.copilotHome, metadataIndex.metadataBySkill, sourceIndex),
  ];
  const repoLocalEntries = scanRepoLocalEntries(repoContext, metadataIndex.metadataBySkill, sourceIndex);
  const overlayScan = buildRepoOverlayEntries(storage.copilotHome, repoContext, [
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

  return {
    schemaVersion: CATALOG_PROJECTION_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    engineRoot,
    copilotHome: storage.copilotHome,
    repoContext,
    storage,
    inputs: {
      manifestPath: sourceScan.manifestPath,
      metadataIndexPath: metadataIndex.metadataIndexPath,
      registryPath: overlayScan.registryPath,
    },
    warnings,
    entries,
    effectiveAssets,
    stats: buildStats(entries, effectiveAssets),
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

function collectSearchTerms(asset) {
  const selectedEntry = asset.selectedEntry || asset;
  const terms = [
    asset.assetId,
    asset.assetKey,
    asset.kind,
    selectedEntry?.title,
    selectedEntry?.description,
  ];

  const tags = selectedEntry?.targeting?.tags;
  if (Array.isArray(tags)) {
    terms.push(...tags);
  }

  const triggers = selectedEntry?.metadata?.triggersOn;
  if (Array.isArray(triggers)) {
    terms.push(...triggers);
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

function getEffectiveAsset(snapshot, assetId) {
  return queryEffectiveCatalog(snapshot, { assetId })[0] || null;
}

module.exports = {
  CATALOG_PROJECTION_SCHEMA_VERSION,
  buildCatalogProjection,
  rebuildCatalogProjection,
  loadCatalogProjectionSnapshot,
  resolveProjectionStorage,
  resolveRepoContext,
  getRepoStateKey,
  queryCatalogEntries,
  queryEffectiveCatalog,
  getEffectiveAsset,
};
