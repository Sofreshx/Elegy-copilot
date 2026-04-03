'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const obsidianNotesLib = require('./obsidianNotes');
const planningBulletsLib = require('./planningBullets');
const roadmapArtifactsLib = require('./roadmapArtifacts');

const REPRESENTATION_SCHEMA_VERSION = 1;
const REPRESENTATION_NOTE_KIND = 'planning-obsidian-representation';
const REPRESENTATION_PROVIDER = 'obsidian';
const REPRESENTATION_ID_PREFIX = 'obsrep';
const REPRESENTATION_SUBDIRECTORY = '_instruction-engine/planning-mirrors';
const INFORMATIONAL_FRONTMATTER_KEYS = new Set([
  'ie_source_updated_at',
  'ie_generated_at',
]);

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function buildError(message, statusCode = 400, code = 'obsidian_planning_representation_error', extra = {}) {
  return Object.assign(new Error(message), {
    statusCode,
    code,
    reason: code,
    ...extra,
  });
}

function deterministicStringCompare(left, right) {
  const a = String(left == null ? '' : left);
  const b = String(right == null ? '' : right);
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function hashText(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function hashRepresentationIdentity(parts) {
  return `${REPRESENTATION_ID_PREFIX}_${
    crypto.createHash('sha256').update(parts.join('\n'), 'utf8').digest('hex').slice(0, 32)
  }`;
}

function normalizeBooleanToken(value) {
  if (typeof value === 'boolean') {
    return value;
  }
  const normalized = normalizeString(value).toLowerCase();
  if (normalized === 'true') {
    return true;
  }
  if (normalized === 'false') {
    return false;
  }
  return null;
}

function parseFrontmatter(text) {
  const normalized = String(text || '').replace(/\r\n?/g, '\n');
  if (!normalized.startsWith('---\n')) {
    return { attributes: {}, body: normalized };
  }

  const closingIndex = normalized.indexOf('\n---\n', 4);
  if (closingIndex < 0) {
    return { attributes: {}, body: normalized };
  }

  const frontmatterText = normalized.slice(4, closingIndex);
  const body = normalized.slice(closingIndex + 5);
  const attributes = {};
  for (const line of frontmatterText.split('\n')) {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex <= 0) {
      continue;
    }
    const key = normalizeString(line.slice(0, separatorIndex));
    const value = normalizeString(line.slice(separatorIndex + 1));
    if (key) {
      attributes[key] = value;
    }
  }

  return { attributes, body };
}

function serializeFrontmatter(attributes) {
  const orderedKeys = [
    'ie_kind',
    'ie_schema_version',
    'ie_representation_id',
    'ie_representation_kind',
    'ie_external',
    'ie_canonical_authority',
    'ie_repo_id',
    'ie_repo_label',
    'ie_roadmap_slug',
    'ie_source_repo_relative_path',
    'ie_source_content_hash',
    'ie_source_updated_at',
    'ie_generated_at',
    'ie_rendered_content_hash',
  ];
  const lines = ['---'];

  orderedKeys.forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(attributes, key)) {
      return;
    }
    const value = attributes[key];
    if (value == null || value === '') {
      return;
    }
    lines.push(`${key}: ${String(value)}`);
  });

  lines.push('---', '');
  return lines.join('\n');
}

function stripInformationalFrontmatterAttributes(attributes) {
  const next = {};
  Object.keys(attributes || {}).forEach((key) => {
    if (INFORMATIONAL_FRONTMATTER_KEYS.has(key)) {
      return;
    }
    next[key] = attributes[key];
  });
  return next;
}

function hashDeterministicRepresentationDocument(text) {
  const normalized = String(text || '').replace(/\r\n?/g, '\n');
  const parsed = parseFrontmatter(normalized);
  if (Object.keys(parsed.attributes).length === 0) {
    return hashText(normalized);
  }
  return hashText(`${serializeFrontmatter(stripInformationalFrontmatterAttributes(parsed.attributes))}${parsed.body}`);
}

function removeLeadingFrontmatter(text) {
  return parseFrontmatter(text).body.replace(/^\n+/, '');
}

function resolveWriteContext(options = {}) {
  const repo = options.repo || null;
  const config = obsidianNotesLib.resolveObsidianConfig(options);
  const baseStatus = obsidianNotesLib.resolveObsidianStatus(options);
  const configured = Boolean(config && config.vaultPath);
  const vaultPath = configured ? path.resolve(config.vaultPath) : '';
  const vaultExists = Boolean(vaultPath && fs.existsSync(vaultPath) && fs.statSync(vaultPath).isDirectory());
  const notesDirectory = configured
    ? obsidianNotesLib.resolveNotesDirectory(config, repo)
    : null;

  return {
    repo,
    config,
    baseStatus,
    configured,
    vaultPath,
    vaultExists,
    notesDirectory,
    writeAvailable: Boolean(configured && vaultExists && notesDirectory && notesDirectory.absolute),
  };
}

function readFileMetadataIfPresent(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }
  const stat = fs.statSync(filePath);
  return {
    filePath,
    content: fs.readFileSync(filePath, 'utf8'),
    updatedAt: stat.mtime.toISOString(),
  };
}

function captureSourceSnapshot(filePath) {
  const sourceInfo = readFileMetadataIfPresent(filePath);
  if (!sourceInfo) {
    return {
      exists: false,
      filePath,
      updatedAt: undefined,
      contentHash: undefined,
    };
  }

  return {
    exists: true,
    filePath: sourceInfo.filePath,
    updatedAt: sourceInfo.updatedAt,
    contentHash: obsidianNotesLib.hashContent(sourceInfo.content),
  };
}

function stageTextAtomicWrite(absPath, content) {
  const dir = path.dirname(absPath);
  fs.mkdirSync(dir, { recursive: true });
  const tempPath = path.join(
    dir,
    `.${path.basename(absPath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
  );
  fs.writeFileSync(tempPath, String(content || ''), 'utf8');

  let committed = false;
  return {
    tempPath,
    commit() {
      fs.renameSync(tempPath, absPath);
      committed = true;
    },
    cleanup() {
      if (committed || !fs.existsSync(tempPath)) {
        return;
      }
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // best-effort
      }
    },
  };
}

function writeTextAtomic(absPath, content) {
  const stagedWrite = stageTextAtomicWrite(absPath, content);
  try {
    stagedWrite.commit();
  } finally {
    stagedWrite.cleanup();
  }
}

function buildBulletsRepresentationSpec(writeContext) {
  const bulletsState = planningBulletsLib.readPlanningBulletsFile(writeContext.repo.repoPath);
  const repo = writeContext.repo;
  const noteRelativePath = obsidianNotesLib.normalizeRelativePath(
    `${REPRESENTATION_SUBDIRECTORY}/bullets.md`
  );
  const notePath = writeContext.notesDirectory
    ? obsidianNotesLib.normalizeRelativePath(`${writeContext.notesDirectory.relative}/${noteRelativePath}`)
    : noteRelativePath;
  const filePath = writeContext.notesDirectory
    ? path.join(writeContext.notesDirectory.absolute, ...noteRelativePath.split('/'))
    : '';
  const sourceSnapshot = captureSourceSnapshot(bulletsState.filePath);

  return {
    id: hashRepresentationIdentity([
      'kind=bullets',
      `repoId=${normalizeString(repo.repoId) || '_'}`,
      `repoPath=${normalizeString(repo.repoPath) || '_'}`,
    ]),
    kind: 'planning-representation',
    provider: REPRESENTATION_PROVIDER,
    representationKind: 'bullets',
    title: 'Planning Bullets Mirror',
    summary: `Deterministic Obsidian mirror of ${bulletsState.repoRelativePath}.`,
    repoId: normalizeString(repo.repoId) || undefined,
    repoLabel: normalizeString(repo.repoLabel) || undefined,
    targetRepoIds: normalizeString(repo.repoId) ? [repo.repoId] : [],
    roadmapSlug: undefined,
    sourceExists: sourceSnapshot.exists,
    sourceFilePath: bulletsState.filePath,
    sourceRepoRelativePath: bulletsState.repoRelativePath,
    sourceUpdatedAt: sourceSnapshot.updatedAt,
    sourceContentHash: sourceSnapshot.contentHash,
    sourceSnapshot,
    notePath,
    filePath,
    artifact: bulletsState.bulletsDoc,
    sourceType: 'bullets',
    bulletCount: bulletsState.bulletsDoc.bullets.length,
  };
}

function buildRoadmapRepresentationSpec(writeContext, roadmap) {
  const repo = writeContext.repo;
  const roadmapSlug = normalizeString(roadmap && roadmap.slug);
  const noteRelativePath = obsidianNotesLib.normalizeRelativePath(
    `${REPRESENTATION_SUBDIRECTORY}/roadmaps/${roadmapSlug}.md`
  );
  const notePath = writeContext.notesDirectory
    ? obsidianNotesLib.normalizeRelativePath(`${writeContext.notesDirectory.relative}/${noteRelativePath}`)
    : noteRelativePath;
  const filePath = writeContext.notesDirectory
    ? path.join(writeContext.notesDirectory.absolute, ...noteRelativePath.split('/'))
    : '';
  const sourceSnapshot = captureSourceSnapshot(roadmap.filePath);

  return {
    id: hashRepresentationIdentity([
      'kind=roadmap',
      `repoId=${normalizeString(repo.repoId) || '_'}`,
      `repoPath=${normalizeString(repo.repoPath) || '_'}`,
      `roadmapSlug=${roadmapSlug}`,
    ]),
    kind: 'planning-representation',
    provider: REPRESENTATION_PROVIDER,
    representationKind: 'roadmap',
    title: `Roadmap Mirror — ${roadmap.title}`,
    summary: `Deterministic Obsidian mirror of ${roadmap.repoRelativePath}.`,
    repoId: normalizeString(repo.repoId) || undefined,
    repoLabel: normalizeString(repo.repoLabel) || undefined,
    targetRepoIds: normalizeString(repo.repoId) ? [repo.repoId] : [],
    roadmapSlug,
    sourceExists: sourceSnapshot.exists,
    sourceFilePath: roadmap.filePath,
    sourceRepoRelativePath: roadmap.repoRelativePath,
    sourceUpdatedAt: sourceSnapshot.updatedAt,
    sourceContentHash: sourceSnapshot.contentHash,
    sourceSnapshot,
    notePath,
    filePath,
    artifact: roadmap,
    sourceType: 'roadmap',
    itemCount: Array.isArray(roadmap.items) ? roadmap.items.length : 0,
  };
}

function slugToTitle(slug) {
  return normalizeString(slug)
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function resolveRoadmapMirrorDirectory(writeContext) {
  if (!writeContext.notesDirectory || !writeContext.notesDirectory.absolute) {
    return '';
  }
  return path.join(
    writeContext.notesDirectory.absolute,
    ...obsidianNotesLib.normalizeRelativePath(`${REPRESENTATION_SUBDIRECTORY}/roadmaps`).split('/'),
  );
}

function readOrphanedRoadmapMirrorMetadata(filePath, fallbackSlug) {
  const existing = readFileMetadataIfPresent(filePath);
  if (!existing) {
    return {
      slug: fallbackSlug,
      title: slugToTitle(fallbackSlug),
      itemCount: 0,
    };
  }

  const parsed = parseFrontmatter(existing.content);
  const body = String(parsed.body || '').replace(/\r\n?/g, '\n');
  const titleMatch = body.match(/^#\s+Roadmap Mirror\s+[—-]\s+(.+)$/m);
  const itemCountMatch = body.match(/^- Item count:\s+(\d+)\s*$/m);

  return {
    slug: normalizeString(parsed.attributes.ie_roadmap_slug) || fallbackSlug,
    title: normalizeString(titleMatch && titleMatch[1]) || slugToTitle(fallbackSlug),
    itemCount: itemCountMatch ? Number.parseInt(itemCountMatch[1], 10) : 0,
  };
}

function buildMissingRoadmapRepresentationSpec(writeContext, roadmapSlug, filePath) {
  const repo = writeContext.repo;
  const noteRelativePath = obsidianNotesLib.normalizeRelativePath(
    `${REPRESENTATION_SUBDIRECTORY}/roadmaps/${roadmapSlug}.md`
  );
  const notePath = writeContext.notesDirectory
    ? obsidianNotesLib.normalizeRelativePath(`${writeContext.notesDirectory.relative}/${noteRelativePath}`)
    : noteRelativePath;
  const sourceRepoRelativePath = `docs/roadmaps/${roadmapSlug}.md`;
  const mirrorMetadata = readOrphanedRoadmapMirrorMetadata(filePath, roadmapSlug);

  return {
    id: hashRepresentationIdentity([
      'kind=roadmap',
      `repoId=${normalizeString(repo.repoId) || '_'}`,
      `repoPath=${normalizeString(repo.repoPath) || '_'}`,
      `roadmapSlug=${roadmapSlug}`,
    ]),
    kind: 'planning-representation',
    provider: REPRESENTATION_PROVIDER,
    representationKind: 'roadmap',
    title: `Roadmap Mirror — ${mirrorMetadata.title}`,
    summary: `Deterministic Obsidian mirror of ${sourceRepoRelativePath}.`,
    repoId: normalizeString(repo.repoId) || undefined,
    repoLabel: normalizeString(repo.repoLabel) || undefined,
    targetRepoIds: normalizeString(repo.repoId) ? [repo.repoId] : [],
    roadmapSlug,
    sourceExists: false,
    sourceFilePath: path.join(writeContext.repo.repoPath, ...sourceRepoRelativePath.split('/')),
    sourceRepoRelativePath,
    sourceUpdatedAt: undefined,
    sourceContentHash: undefined,
    sourceSnapshot: {
      exists: false,
      filePath: path.join(writeContext.repo.repoPath, ...sourceRepoRelativePath.split('/')),
      updatedAt: undefined,
      contentHash: undefined,
    },
    notePath,
    filePath,
    artifact: {
      slug: roadmapSlug,
      title: mirrorMetadata.title,
      overview: 'TBD',
      items: [],
    },
    sourceType: 'roadmap',
    itemCount: Number.isFinite(mirrorMetadata.itemCount) ? mirrorMetadata.itemCount : 0,
  };
}

function listOrphanedRoadmapRepresentationSpecs(writeContext, canonicalRoadmapSpecs) {
  const roadmapsMirrorDir = resolveRoadmapMirrorDirectory(writeContext);
  if (!roadmapsMirrorDir) {
    return [];
  }

  let entries = [];
  try {
    entries = fs.readdirSync(roadmapsMirrorDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const canonicalSlugs = new Set(
    canonicalRoadmapSpecs
      .map((spec) => normalizeString(spec && spec.roadmapSlug))
      .filter(Boolean),
  );

  return entries
    .filter((entry) => entry && entry.isFile && entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name.replace(/\.md$/i, ''))
    .filter((slug) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
    .filter((slug) => !canonicalSlugs.has(slug))
    .sort(deterministicStringCompare)
    .map((slug) => buildMissingRoadmapRepresentationSpec(
      writeContext,
      slug,
      path.join(roadmapsMirrorDir, `${slug}.md`),
    ));
}

function buildRepresentationSpecs(options = {}) {
  const writeContext = resolveWriteContext(options);
  if (!writeContext.repo || !writeContext.repo.repoPath) {
    throw buildError('Catalog repo selection is required for planning representations', 409, 'catalog_repo_not_selected');
  }

  const bulletsSpec = buildBulletsRepresentationSpec(writeContext);
  const roadmaps = roadmapArtifactsLib.listRoadmapDocuments(writeContext.repo.repoPath);
  const roadmapSpecs = roadmaps.map((roadmap) => buildRoadmapRepresentationSpec(writeContext, roadmap));
  const orphanedRoadmapSpecs = listOrphanedRoadmapRepresentationSpecs(writeContext, roadmapSpecs);
  const specs = [bulletsSpec, ...roadmapSpecs, ...orphanedRoadmapSpecs]
    .sort((left, right) => deterministicStringCompare(left.notePath, right.notePath));

  return {
    writeContext,
    specs,
  };
}

function renderBulletsBody(spec, repo) {
  const bullets = Array.isArray(spec.artifact && spec.artifact.bullets) ? spec.artifact.bullets : [];
  const lines = [
    '# Planning Bullets Mirror',
    '',
    `> External/non-canonical Obsidian mirror generated from \`${spec.sourceRepoRelativePath}\`.`,
    '> Canonical authority remains in repo docs. Refresh this mirror from Planning after canonical updates.',
    '',
    `- Repo: ${normalizeString(repo && repo.repoId) || normalizeString(repo && repo.repoLabel) || 'selected repo'}`,
    `- Canonical source: \`${spec.sourceRepoRelativePath}\``,
    `- Bullet count: ${bullets.length}`,
    '',
    '## Summary',
    spec.artifact && spec.artifact.description
      ? String(spec.artifact.description)
      : 'Repository-scoped bullet seeds for future planning sessions.',
    '',
    '## Bullets',
  ];

  if (bullets.length === 0) {
    lines.push('_No planning bullets are currently present in the canonical repo file._');
    lines.push('');
    return lines.join('\n');
  }

  bullets.forEach((bullet, index) => {
    lines.push(`### ${bullet.id} — ${bullet.title}`);
    lines.push(`- State: ${bullet.state}`);
    lines.push(`- Repo: ${bullet.repoId}`);
    lines.push(`- Summary: ${bullet.summary || 'none'}`);
    lines.push('- Notes:');
    if (Array.isArray(bullet.notes) && bullet.notes.length > 0) {
      bullet.notes.forEach((note) => {
        lines.push(`  - ${note}`);
      });
    } else {
      lines.push('  - none');
    }
    lines.push(`- Promoted to plan: ${Array.isArray(bullet.promotedPlanRefs) && bullet.promotedPlanRefs.length > 0 ? bullet.promotedPlanRefs.join(', ') : 'none'}`);
    lines.push(`- Promoted to backlog: ${Array.isArray(bullet.promotedBacklogRefs) && bullet.promotedBacklogRefs.length > 0 ? bullet.promotedBacklogRefs.join(', ') : 'none'}`);
    if (Array.isArray(bullet.promotedRoadmapRefs) && bullet.promotedRoadmapRefs.length > 0) {
      lines.push(`- Promoted to roadmap: ${bullet.promotedRoadmapRefs.join(', ')}`);
    }
    if (index < bullets.length - 1) {
      lines.push('');
    }
  });
  lines.push('');
  return lines.join('\n');
}

function renderRoadmapBody(spec, repo) {
  const roadmap = spec.artifact || {};
  const lines = [
    `# Roadmap Mirror — ${roadmap.title || spec.roadmapSlug}`,
    '',
    `> External/non-canonical Obsidian mirror generated from \`${spec.sourceRepoRelativePath}\`.`,
    '> Canonical authority remains in repo docs. Refresh this mirror from Planning after canonical updates.',
    '',
    `- Repo: ${normalizeString(repo && repo.repoId) || normalizeString(repo && repo.repoLabel) || 'selected repo'}`,
    `- Canonical source: \`${spec.sourceRepoRelativePath}\``,
    `- Roadmap slug: ${spec.roadmapSlug}`,
    `- Item count: ${Array.isArray(roadmap.items) ? roadmap.items.length : 0}`,
    '',
    '## Overview',
    roadmap.overview || 'TBD',
    '',
    '## Roadmap Items',
  ];

  if (!Array.isArray(roadmap.items) || roadmap.items.length === 0) {
    lines.push('_No roadmap items are currently present in the canonical repo file._');
    lines.push('');
    return lines.join('\n');
  }

  roadmap.items.forEach((item, index) => {
    lines.push(`### ${item.id} — ${item.title}`);
    lines.push(`- Phase: ${item.phase}`);
    lines.push(`- Status: ${item.status}`);
    lines.push(`- Summary: ${item.summary || 'none'}`);
    lines.push(`- Backlog IDs: ${Array.isArray(item.backlogIds) && item.backlogIds.length > 0 ? item.backlogIds.join(', ') : 'none'}`);
    lines.push(`- Plan Refs: ${Array.isArray(item.planRefs) && item.planRefs.length > 0 ? item.planRefs.join(', ') : 'none'}`);
    lines.push(`- Satisfied By Plan Ref: ${normalizeString(item.satisfiedByPlanRef) || 'none'}`);
    lines.push(`- Superseded By Plan Ref: ${normalizeString(item.supersededByPlanRef) || 'none'}`);
    lines.push(`- Abandoned By Plan Ref: ${normalizeString(item.abandonedByPlanRef) || 'none'}`);
    if (index < roadmap.items.length - 1) {
      lines.push('');
    }
  });
  lines.push('');
  return lines.join('\n');
}

function renderRepresentationContent(spec, repo) {
  const effectiveRepo = repo || {
    repoId: spec.repoId,
    repoLabel: spec.repoLabel,
  };
  const body = spec.representationKind === 'bullets'
    ? renderBulletsBody(spec, effectiveRepo)
    : renderRoadmapBody(spec, effectiveRepo);
  const renderedContentHash = hashText(body);
  const frontmatter = serializeFrontmatter({
    ie_kind: REPRESENTATION_NOTE_KIND,
    ie_schema_version: REPRESENTATION_SCHEMA_VERSION,
    ie_representation_id: spec.id,
    ie_representation_kind: spec.representationKind,
    ie_external: 'true',
    ie_canonical_authority: 'false',
    ie_repo_id: normalizeString(effectiveRepo && effectiveRepo.repoId) || undefined,
    ie_repo_label: normalizeString(effectiveRepo && effectiveRepo.repoLabel) || undefined,
    ie_roadmap_slug: spec.roadmapSlug || undefined,
    ie_source_repo_relative_path: spec.sourceRepoRelativePath,
    ie_source_content_hash: spec.sourceContentHash || undefined,
    ie_rendered_content_hash: renderedContentHash,
  });

  return {
    content: `${frontmatter}${body}`,
    generatedAt: undefined,
    renderedContentHash,
  };
}

function validateRepresentationFile(spec, noteContent) {
  const { attributes, body } = parseFrontmatter(noteContent);
  const metadataErrors = [];
  const externalToken = normalizeBooleanToken(attributes.ie_external);
  const canonicalAuthorityToken = normalizeBooleanToken(attributes.ie_canonical_authority);
  const schemaVersion = normalizeString(attributes.ie_schema_version);
  const sourceRepoRelativePath = normalizeString(attributes.ie_source_repo_relative_path);
  const sourceContentHash = normalizeString(attributes.ie_source_content_hash);
  const renderedContentHash = normalizeString(attributes.ie_rendered_content_hash);

  if (normalizeString(attributes.ie_kind) !== REPRESENTATION_NOTE_KIND) {
    metadataErrors.push('ie_kind mismatch');
  }
  if (!schemaVersion) {
    metadataErrors.push('ie_schema_version is required');
  } else if (schemaVersion !== String(REPRESENTATION_SCHEMA_VERSION)) {
    metadataErrors.push('ie_schema_version mismatch');
  }
  if (normalizeString(attributes.ie_representation_id) !== spec.id) {
    metadataErrors.push('ie_representation_id mismatch');
  }
  if (normalizeString(attributes.ie_representation_kind) !== spec.representationKind) {
    metadataErrors.push('ie_representation_kind mismatch');
  }
  if (!sourceRepoRelativePath) {
    metadataErrors.push('ie_source_repo_relative_path is required');
  } else if (sourceRepoRelativePath !== spec.sourceRepoRelativePath) {
    metadataErrors.push('ie_source_repo_relative_path mismatch');
  }
  if ((spec.roadmapSlug || '') !== normalizeString(attributes.ie_roadmap_slug)) {
    if (spec.representationKind === 'roadmap') {
      metadataErrors.push('ie_roadmap_slug mismatch');
    }
  }
  if (externalToken !== true) {
    metadataErrors.push('ie_external must be true');
  }
  if (canonicalAuthorityToken !== false) {
    metadataErrors.push('ie_canonical_authority must be false');
  }

  if (!sourceContentHash) {
    metadataErrors.push('ie_source_content_hash is required');
  }
  if (!renderedContentHash) {
    metadataErrors.push('ie_rendered_content_hash is required');
  } else if (renderedContentHash !== hashText(body)) {
    metadataErrors.push('ie_rendered_content_hash mismatch');
  }

  return {
    attributes,
    body,
    metadataValid: metadataErrors.length === 0,
    metadataErrors,
  };
}

function summarizeRepresentation(spec, noteState) {
  const noteExists = Boolean(noteState && noteState.exists);
  const freshness = noteState && noteState.freshness ? noteState.freshness : (
    !spec.sourceExists ? 'source-missing' : noteExists ? 'invalid' : 'missing'
  );

  return {
    id: spec.id,
    kind: 'planning-representation',
    provider: REPRESENTATION_PROVIDER,
    representationKind: spec.representationKind,
    title: spec.title,
    summary: spec.summary,
    repoId: spec.repoId,
    targetRepoIds: spec.targetRepoIds.slice(),
    roadmapSlug: spec.roadmapSlug,
    sourceExists: spec.sourceExists,
    sourceFilePath: spec.sourceFilePath,
    sourceRepoRelativePath: spec.sourceRepoRelativePath,
    sourceUpdatedAt: spec.sourceUpdatedAt,
    sourceContentHash: spec.sourceContentHash,
    notePath: spec.notePath,
    filePath: spec.filePath || undefined,
    noteExists,
    noteUpdatedAt: noteState && noteState.noteUpdatedAt ? noteState.noteUpdatedAt : undefined,
    generatedAt: noteState && noteState.generatedAt ? noteState.generatedAt : undefined,
    freshness,
    metadataValid: noteState ? noteState.metadataValid !== false : false,
    external: true,
    canonicalAuthority: false,
    message: noteState && noteState.message
      ? noteState.message
      : (!spec.sourceExists
        ? 'Canonical source file is missing; no Obsidian mirror can be generated yet.'
        : 'Deterministic mirror note has not been generated yet.'),
    bulletCount: Number.isFinite(spec.bulletCount) ? spec.bulletCount : undefined,
    itemCount: Number.isFinite(spec.itemCount) ? spec.itemCount : undefined,
  };
}

function inspectRepresentationState(spec) {
  const existing = spec.filePath ? readFileMetadataIfPresent(spec.filePath) : null;
  if (!existing) {
    return {
      spec,
      noteState: {
        exists: false,
        freshness: spec.sourceExists ? 'missing' : 'source-missing',
        metadataValid: false,
        message: spec.sourceExists
          ? 'Deterministic mirror note has not been generated yet.'
          : 'Canonical source file is missing; no Obsidian mirror can be generated yet.',
      },
      snapshot: {
        exists: false,
        filePath: spec.filePath,
      },
    };
  }

  const validation = validateRepresentationFile(spec, existing.content);
  if (!validation.metadataValid) {
    return {
      spec,
      noteState: {
        exists: true,
        freshness: 'invalid',
        metadataValid: false,
        noteUpdatedAt: existing.updatedAt,
        generatedAt: normalizeString(validation.attributes.ie_generated_at) || undefined,
        message: `Mirror metadata is invalid: ${validation.metadataErrors.join('; ')}`,
      },
      snapshot: {
        exists: true,
        filePath: existing.filePath,
        updatedAt: existing.updatedAt,
        contentHash: hashText(existing.content),
        metadataValid: false,
      },
    };
  }

  const sourceContentHash = normalizeString(validation.attributes.ie_source_content_hash);
  const renderedContentHash = normalizeString(validation.attributes.ie_rendered_content_hash);
  if (!spec.sourceExists) {
    return {
      spec,
      noteState: {
        exists: true,
        freshness: 'source-missing',
        metadataValid: true,
        noteUpdatedAt: existing.updatedAt,
        generatedAt: normalizeString(validation.attributes.ie_generated_at) || undefined,
        message: 'Canonical source file is missing; refresh is blocked until it exists again.',
      },
      snapshot: {
        exists: true,
        filePath: existing.filePath,
        updatedAt: existing.updatedAt,
        contentHash: hashText(existing.content),
        metadataValid: true,
        sourceContentHash,
        renderedContentHash,
      },
    };
  }

  const expected = renderRepresentationContent(spec);
  const currentContentHash = hashText(existing.content);
  const mirrorMatchesExpectedRepresentation = (
    hashDeterministicRepresentationDocument(existing.content)
    === hashDeterministicRepresentationDocument(expected.content)
  );
  const freshness = !spec.sourceExists
    ? 'source-missing'
    : (
      sourceContentHash
      && sourceContentHash === spec.sourceContentHash
      && mirrorMatchesExpectedRepresentation
        ? 'current'
        : 'stale'
    );

  return {
    spec,
    noteState: {
      exists: true,
      freshness,
      metadataValid: true,
      noteUpdatedAt: existing.updatedAt,
      generatedAt: normalizeString(validation.attributes.ie_generated_at) || undefined,
      message:
        freshness === 'current'
          ? 'Mirror matches the current canonical repo artifact.'
          : freshness === 'stale'
            ? (
              sourceContentHash && sourceContentHash === spec.sourceContentHash
                ? 'Deterministic mirror rendering changed since this note was generated.'
                : 'Canonical repo artifact changed since the mirror was generated.'
            )
            : 'Canonical source file is missing; refresh is blocked until it exists again.',
    },
    snapshot: {
      exists: true,
      filePath: existing.filePath,
      updatedAt: existing.updatedAt,
      contentHash: currentContentHash,
      metadataValid: true,
      sourceContentHash,
      renderedContentHash,
    },
  };
}

function assertRepresentationSnapshotUnchanged(spec, snapshot) {
  const current = spec.filePath ? readFileMetadataIfPresent(spec.filePath) : null;
  if (!snapshot || !snapshot.exists) {
    if (current) {
      throw buildError(
        `Refusing to overwrite planning mirror after concurrent creation or edit: ${spec.notePath}`,
        409,
        'obsidian_representation_conflict',
      );
    }
    return;
  }

  if (!current) {
    throw buildError(
      `Refusing to overwrite planning mirror after concurrent deletion or move: ${spec.notePath}`,
      409,
      'obsidian_representation_conflict',
    );
  }

  const currentContentHash = hashText(current.content);
  if (currentContentHash !== snapshot.contentHash) {
    throw buildError(
      `Refusing to overwrite planning mirror after concurrent edits changed the file contents: ${spec.notePath}`,
      409,
      'obsidian_representation_conflict',
    );
  }

  const validation = validateRepresentationFile(spec, current.content);
  if (!validation.metadataValid) {
    throw buildError(
      `Refusing to overwrite planning mirror after concurrent metadata drift: ${spec.notePath}`,
      409,
      'obsidian_representation_conflict',
    );
  }

  if (
    normalizeString(validation.attributes.ie_source_content_hash) !== normalizeString(snapshot.sourceContentHash)
    || normalizeString(validation.attributes.ie_rendered_content_hash) !== normalizeString(snapshot.renderedContentHash)
  ) {
    throw buildError(
      `Refusing to overwrite planning mirror after concurrent metadata changes: ${spec.notePath}`,
      409,
      'obsidian_representation_conflict',
    );
  }
}

function assertRepresentationSourceSnapshotUnchanged(spec, sourceSnapshot) {
  const snapshot = sourceSnapshot || {
    exists: Boolean(spec && spec.sourceExists),
    filePath: spec && spec.sourceFilePath,
    updatedAt: spec && spec.sourceUpdatedAt,
    contentHash: spec && spec.sourceContentHash,
  };
  const current = snapshot && snapshot.filePath ? readFileMetadataIfPresent(snapshot.filePath) : null;

  if (!snapshot || !snapshot.exists) {
    if (current) {
      throw buildError(
        `Refusing to refresh planning mirror after canonical source appeared or changed during refresh planning: ${spec.sourceRepoRelativePath}`,
        409,
        'obsidian_representation_conflict',
      );
    }
    return;
  }

  if (!current) {
    throw buildError(
      `Refusing to refresh planning mirror after canonical source disappeared during refresh: ${spec.sourceRepoRelativePath}`,
      409,
      'obsidian_representation_conflict',
    );
  }

  const currentContentHash = hashText(current.content);
  if (currentContentHash !== normalizeString(snapshot.contentHash)) {
    throw buildError(
      `Refusing to refresh planning mirror after canonical source changed during refresh: ${spec.sourceRepoRelativePath}`,
      409,
      'obsidian_representation_conflict',
    );
  }
}

function summarizeRepresentationCollection(representations, writeContext) {
  const counts = {
    currentCount: 0,
    staleCount: 0,
    missingCount: 0,
    invalidCount: 0,
    sourceMissingCount: 0,
  };

  representations.forEach((representation) => {
    switch (representation.freshness) {
      case 'current':
        counts.currentCount += 1;
        break;
      case 'stale':
        counts.staleCount += 1;
        break;
      case 'invalid':
        counts.invalidCount += 1;
        break;
      case 'source-missing':
        counts.sourceMissingCount += 1;
        break;
      default:
        counts.missingCount += 1;
        break;
    }
  });

  let message = 'Deterministic Obsidian planning mirrors are unavailable.';
  if (writeContext.writeAvailable) {
    message = 'Deterministic Obsidian planning mirrors are available for generation and freshness checks.';
  } else if (writeContext.baseStatus && writeContext.baseStatus.state === 'notes-unavailable') {
    message = 'Obsidian vault is configured, but the repo note folder does not exist yet. Refreshing planning mirrors can create it deterministically.';
  } else if (writeContext.baseStatus && writeContext.baseStatus.state === 'ready') {
    message = 'Deterministic Obsidian planning mirrors are readable, but refreshes may fail if the resolved mirror path is unwritable.';
  }

  return {
    totalCount: representations.length,
    writeAvailable: writeContext.writeAvailable,
    ...counts,
    message,
  };
}

function listPlanningRepresentations(options = {}) {
  const { writeContext, specs } = buildRepresentationSpecs(options);

  const inspections = specs.map((spec) => inspectRepresentationState(spec));
  const representations = inspections.map((inspection) => summarizeRepresentation(inspection.spec, inspection.noteState));

  return {
    status: writeContext.baseStatus,
    representations,
    representationsStatus: summarizeRepresentationCollection(representations, writeContext),
  };
}

function getPlanningRepresentationStatus(options = {}) {
  const result = listPlanningRepresentations(options);
  return {
    status: result.status,
    representationsStatus: result.representationsStatus,
  };
}

function refreshPlanningRepresentations(options = {}) {
  const { writeContext, specs } = buildRepresentationSpecs(options);
  if (!writeContext.configured) {
    throw buildError(
      'External Obsidian notes are not configured. Configure a vault before generating deterministic planning mirrors.',
      409,
      'obsidian_not_configured',
    );
  }
  if (!writeContext.vaultExists) {
    throw buildError(
      'External Obsidian vault path is configured but unavailable.',
      409,
      'obsidian_vault_unavailable',
    );
  }
  if (!writeContext.notesDirectory) {
    throw buildError(
      'Obsidian notes directory could not be resolved for the selected repo.',
      409,
      'obsidian_notes_unavailable',
    );
  }

  const inspections = specs.map((spec) => inspectRepresentationState(spec));
  const invalidRepresentations = inspections
    .filter((inspection) => inspection.noteState.freshness === 'invalid')
    .map((inspection) => summarizeRepresentation(inspection.spec, inspection.noteState));
  if (invalidRepresentations.length > 0) {
    throw buildError(
      `Refusing to overwrite malformed planning mirror metadata: ${invalidRepresentations.map((entry) => entry.notePath).join(', ')}`,
      409,
      'obsidian_representation_metadata_invalid',
    );
  }

  const result = {
    refreshedCount: 0,
    skippedCount: 0,
    skippedIds: [],
  };
  const inspectionById = new Map(inspections.map((inspection) => [inspection.spec.id, inspection]));
  const writableRefreshes = [];

  specs.forEach((spec) => {
    if (!spec.sourceExists) {
      result.skippedCount += 1;
      result.skippedIds.push(spec.id);
      return;
    }

    writableRefreshes.push({
      spec,
      rendered: renderRepresentationContent(spec, writeContext.repo),
      snapshot: inspectionById.get(spec.id) ? inspectionById.get(spec.id).snapshot : null,
      sourceSnapshot: spec.sourceSnapshot || null,
    });
  });

  writableRefreshes.forEach(({ spec, snapshot, sourceSnapshot }) => {
    assertRepresentationSnapshotUnchanged(spec, snapshot);
    assertRepresentationSourceSnapshotUnchanged(spec, sourceSnapshot);
  });

  const stagedWrites = [];
  const pendingRefreshes = [];

  try {
    writableRefreshes.forEach(({ spec, rendered }) => {
      const renderedContentHash = hashText(rendered.content);
      const snapshot = inspectionById.get(spec.id) ? inspectionById.get(spec.id).snapshot : null;
      if (snapshot && snapshot.exists && snapshot.contentHash === renderedContentHash) {
        result.skippedCount += 1;
        result.skippedIds.push(spec.id);
        return;
      }

      const stagedWrite = stageTextAtomicWrite(spec.filePath, rendered.content);
      stagedWrites.push(stagedWrite);
      pendingRefreshes.push({
        spec,
        snapshot,
        sourceSnapshot: spec.sourceSnapshot || null,
        stagedWrite,
      });
    });

    pendingRefreshes.forEach(({ spec, snapshot, sourceSnapshot }) => {
      assertRepresentationSnapshotUnchanged(spec, snapshot);
      assertRepresentationSourceSnapshotUnchanged(spec, sourceSnapshot);
    });

    pendingRefreshes.forEach(({ stagedWrite }) => {
      stagedWrite.commit();
      result.refreshedCount += 1;
    });
  } finally {
    stagedWrites.forEach((stagedWrite) => stagedWrite.cleanup());
  }

  const refreshed = listPlanningRepresentations(options);
  return {
    status: refreshed.status,
    representationsStatus: refreshed.representationsStatus,
    representations: refreshed.representations,
    result,
  };
}

module.exports = {
  REPRESENTATION_SCHEMA_VERSION,
  REPRESENTATION_NOTE_KIND,
  REPRESENTATION_SUBDIRECTORY,
  parseFrontmatter,
  getPlanningRepresentationStatus,
  listPlanningRepresentations,
  refreshPlanningRepresentations,
};
