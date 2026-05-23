'use strict';

const fs = require('fs');
const path = require('path');

const ROADMAP_DOC_KIND = 'roadmap';
const ROADMAP_SCHEMA_VERSION = 1;
const ROADMAP_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ROADMAP_ITEM_ID_RE = /^RM-([a-z0-9]+(?:-[a-z0-9]+)*)-(\d{3})$/;
const BACKLOG_ITEM_ID_RE = /^RB-\d{3}$/;
const PLAN_REF_RE = /^[A-Za-z0-9._:/-]{1,256}$/;
const ROADMAP_ITEM_STATUSES = Object.freeze([
  'planned',
  'in-progress',
  'blocked',
  'done',
  'superseded',
  'abandoned',
]);
const ROADMAP_RECONCILE_OUTCOMES = Object.freeze([
  'completed',
  'superseded',
  'abandoned',
]);

function deterministicStringCompare(a, b) {
  const left = String(a == null ? '' : a);
  const right = String(b == null ? '' : b);
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeTextBlock(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const normalized = value
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+$/g, ''));

  while (normalized.length > 0 && !normalized[0].trim()) {
    normalized.shift();
  }
  while (normalized.length > 0 && !normalized[normalized.length - 1].trim()) {
    normalized.pop();
  }

  return normalized.join('\n');
}

function normalizeSingleLineText(value) {
  return normalizeString(typeof value === 'string' ? value.replace(/\s+/g, ' ') : '');
}

function slugToTitle(slug) {
  return normalizeString(slug)
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function buildError(message, statusCode, code, extra = {}) {
  return Object.assign(new Error(message), {
    statusCode,
    code,
    reason: code,
    ...extra,
  });
}

function assertRoadmapSlug(slug) {
  const normalized = normalizeString(slug).toLowerCase();
  if (!ROADMAP_SLUG_RE.test(normalized)) {
    throw buildError('roadmap slug must be lowercase kebab-case', 400, 'invalid_roadmap_slug');
  }
  return normalized;
}

function normalizeListInput(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === 'string') {
    return value.split(',');
  }
  return [];
}

function normalizeDeterministicStringList(value) {
  return [...new Set(
    normalizeListInput(value)
      .map((entry) => normalizeString(entry))
      .filter(Boolean)
  )].sort(deterministicStringCompare);
}

function normalizeIdList(value, pattern, code) {
  const normalized = normalizeDeterministicStringList(value);
  for (const token of normalized) {
    if (!pattern.test(token)) {
      throw buildError(`invalid identifier: ${token}`, 400, code);
    }
  }
  return normalized;
}

function normalizeNullablePlanRef(value) {
  const normalized = normalizeString(value);
  if (!normalized || normalized.toLowerCase() === 'none') {
    return null;
  }
  if (!PLAN_REF_RE.test(normalized)) {
    throw buildError(`invalid plan reference: ${normalized}`, 400, 'invalid_plan_ref');
  }
  return normalized;
}

function normalizePlanRefList(value) {
  const normalized = normalizeDeterministicStringList(value);
  for (const token of normalized) {
    if (!PLAN_REF_RE.test(token)) {
      throw buildError(`invalid plan reference: ${token}`, 400, 'invalid_plan_ref');
    }
  }
  return normalized;
}

function normalizeRoadmapStatus(value, fallback = 'planned') {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (!ROADMAP_ITEM_STATUSES.includes(normalized)) {
    throw buildError(`unsupported roadmap status: ${value}`, 400, 'invalid_roadmap_status');
  }
  return normalized;
}

function assertRoadmapItemIdForSlug(itemId, slug) {
  const normalized = normalizeString(itemId);
  const match = normalized.match(ROADMAP_ITEM_ID_RE);
  if (!match) {
    throw buildError('roadmap item id must use format RM-<roadmap-slug>-###', 400, 'invalid_roadmap_item_id');
  }
  if (assertRoadmapSlug(match[1]) !== slug) {
    throw buildError(`roadmap item id ${normalized} does not match roadmap slug ${slug}`, 400, 'roadmap_item_slug_mismatch');
  }
  return normalized;
}

function buildNextRoadmapItemId(items, slug) {
  let max = 0;
  for (const item of Array.isArray(items) ? items : []) {
    const normalizedId = normalizeString(item && item.id);
    const match = normalizedId.match(ROADMAP_ITEM_ID_RE);
    if (!match || match[1] !== slug) {
      continue;
    }
    const numeric = Number.parseInt(match[2], 10);
    if (Number.isFinite(numeric) && numeric > max) {
      max = numeric;
    }
  }
  return `RM-${slug}-${String(max + 1).padStart(3, '0')}`;
}

function finalizeRoadmapItem(item, slug) {
  const normalizedSlug = assertRoadmapSlug(slug);
  const normalizedId = assertRoadmapItemIdForSlug(item.id, normalizedSlug);
  const title = normalizeString(item.title);
  if (!title) {
    throw buildError(`title is required for roadmap item ${normalizedId}`, 400, 'roadmap_item_title_required');
  }
  const phase = normalizeString(item.phase) || 'unscheduled';
  const status = normalizeRoadmapStatus(item.status, 'planned');
  const summary = normalizeSingleLineText(item.summary);
  const backlogIds = normalizeIdList(item.backlogIds, BACKLOG_ITEM_ID_RE, 'invalid_backlog_item_id');
  const planRefs = normalizePlanRefList(item.planRefs);
  let satisfiedByPlanRef = normalizeNullablePlanRef(item.satisfiedByPlanRef);
  let supersededByPlanRef = normalizeNullablePlanRef(item.supersededByPlanRef);
  let abandonedByPlanRef = normalizeNullablePlanRef(item.abandonedByPlanRef);

  const referencedPlanRefs = [satisfiedByPlanRef, supersededByPlanRef, abandonedByPlanRef].filter(Boolean);
  const allPlanRefs = [...new Set([...planRefs, ...referencedPlanRefs])].sort(deterministicStringCompare);

  if (status === 'done' && !satisfiedByPlanRef && allPlanRefs.length === 1) {
    satisfiedByPlanRef = allPlanRefs[0];
  }
  if (status === 'superseded' && !supersededByPlanRef && allPlanRefs.length === 1) {
    supersededByPlanRef = allPlanRefs[0];
  }
  if (status === 'abandoned' && !abandonedByPlanRef && allPlanRefs.length === 1) {
    abandonedByPlanRef = allPlanRefs[0];
  }

  return {
    id: normalizedId,
    title,
    phase,
    status,
    summary,
    backlogIds,
    planRefs: allPlanRefs,
    satisfiedByPlanRef,
    supersededByPlanRef,
    abandonedByPlanRef,
  };
}

function normalizeRoadmapItem(input, options = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const slug = assertRoadmapSlug(options.slug || source.slug || source.roadmapSlug);
  const explicitId = normalizeString(source.id || source.itemId);
  const itemId = explicitId
    ? assertRoadmapItemIdForSlug(explicitId, slug)
    : options.defaultId || buildNextRoadmapItemId(options.existingItems, slug);

  return finalizeRoadmapItem({
    id: itemId,
    title: source.title,
    phase: source.phase,
    status: source.status,
    summary: source.summary,
    backlogIds: source.backlogIds,
    planRefs: source.planRefs,
    satisfiedByPlanRef: source.satisfiedByPlanRef,
    supersededByPlanRef: source.supersededByPlanRef,
    abandonedByPlanRef: source.abandonedByPlanRef,
  }, slug);
}

function normalizeRoadmapDocument(input, options = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const slug = assertRoadmapSlug(options.slug || source.slug || source.roadmapSlug);
  const title = normalizeString(source.title) || slugToTitle(slug);
  const overview = normalizeTextBlock(source.overview) || 'TBD';
  const inputItems = Array.isArray(source.items) ? source.items : [];
  const seenIds = new Set();
  const items = [];

  for (const rawItem of inputItems) {
    const normalizedItem = normalizeRoadmapItem(rawItem, {
      slug,
      existingItems: items,
    });
    if (seenIds.has(normalizedItem.id)) {
      throw buildError(`duplicate roadmap item id: ${normalizedItem.id}`, 400, 'duplicate_roadmap_item_id');
    }
    seenIds.add(normalizedItem.id);
    items.push(normalizedItem);
  }

  items.sort((left, right) => deterministicStringCompare(left.id, right.id));

  return {
    docKind: ROADMAP_DOC_KIND,
    schemaVersion: ROADMAP_SCHEMA_VERSION,
    slug,
    title,
    overview,
    items,
  };
}

function formatList(values) {
  const list = Array.isArray(values) ? values : [];
  return list.length ? list.join(', ') : 'none';
}

function formatNullableToken(value) {
  return normalizeString(value) || 'none';
}

function serializeRoadmapItem(item) {
  return [
    `### ${item.id} — ${item.title}`,
    `- Phase: ${item.phase}`,
    `- Status: ${item.status}`,
    `- Summary: ${formatNullableToken(item.summary)}`,
    `- Backlog IDs: ${formatList(item.backlogIds)}`,
    `- Plan Refs: ${formatList(item.planRefs)}`,
    `- Satisfied By Plan Ref: ${formatNullableToken(item.satisfiedByPlanRef)}`,
    `- Superseded By Plan Ref: ${formatNullableToken(item.supersededByPlanRef)}`,
    `- Abandoned By Plan Ref: ${formatNullableToken(item.abandonedByPlanRef)}`,
  ].join('\n');
}

function serializeRoadmapDocument(input) {
  const document = normalizeRoadmapDocument(input);
  const itemSection = document.items.length
    ? document.items.map((item) => serializeRoadmapItem(item)).join('\n\n')
    : '_No roadmap items yet._';

  return [
    '---',
    `doc_kind: ${ROADMAP_DOC_KIND}`,
    `roadmap_slug: ${document.slug}`,
    `title: ${document.title}`,
    `version: ${ROADMAP_SCHEMA_VERSION}`,
    '---',
    '',
    `# ${document.title}`,
    '',
    '## Overview',
    document.overview,
    '',
    '## Roadmap Items',
    itemSection,
    '',
  ].join('\n');
}

function parseFrontMatter(text) {
  const normalized = String(text || '').replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    return { attributes: {}, body: normalized };
  }
  const closingIndex = normalized.indexOf('\n---\n', 4);
  if (closingIndex < 0) {
    return { attributes: {}, body: normalized };
  }
  const frontMatterText = normalized.slice(4, closingIndex);
  const body = normalized.slice(closingIndex + 5);
  const attributes = {};
  for (const line of frontMatterText.split('\n')) {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex <= 0) continue;
    const key = normalizeString(line.slice(0, separatorIndex));
    const value = normalizeString(line.slice(separatorIndex + 1));
    if (key) {
      attributes[key] = value;
    }
  }
  return { attributes, body };
}

function readSection(body, heading) {
  const normalizedBody = String(body || '').replace(/\r\n/g, '\n');
  const marker = `## ${heading}\n`;
  const startIndex = normalizedBody.indexOf(marker);
  if (startIndex < 0) {
    return '';
  }
  const contentStart = startIndex + marker.length;
  const nextSectionIndex = normalizedBody.indexOf('\n## ', contentStart);
  const contentEnd = nextSectionIndex >= 0 ? nextSectionIndex : normalizedBody.length;
  return normalizeTextBlock(normalizedBody.slice(contentStart, contentEnd));
}

function parseListField(value) {
  const normalized = normalizeString(value);
  if (!normalized || normalized.toLowerCase() === 'none') {
    return [];
  }
  return normalized.split(',').map((entry) => entry.trim()).filter(Boolean);
}

function parseNullableField(value) {
  const normalized = normalizeString(value);
  if (!normalized || normalized.toLowerCase() === 'none') {
    return null;
  }
  return normalized;
}

function parseRoadmapItems(sectionText, slug) {
  const normalized = normalizeTextBlock(sectionText);
  if (!normalized || normalized === '_No roadmap items yet._') {
    return [];
  }

  const blocks = normalized
    .split(/^### /m)
    .map((block, index) => (index === 0 ? block : `### ${block}`))
    .filter((block) => normalizeString(block));

  return blocks.map((block) => {
    const lines = block.split('\n');
    const header = normalizeString(lines.shift());
    const headerMatch = header.match(/^###\s+(\S+)\s+(?:—|-)\s+(.+)$/);
    if (!headerMatch) {
      throw buildError(`invalid roadmap item header: ${header}`, 400, 'invalid_roadmap_markdown');
    }
    const fields = {};
    for (const line of lines) {
      const match = line.match(/^- ([^:]+):\s*(.*)$/);
      if (!match) continue;
      fields[normalizeString(match[1]).toLowerCase()] = match[2];
    }

    return normalizeRoadmapItem({
      id: headerMatch[1],
      title: headerMatch[2],
      phase: fields.phase,
      status: fields.status,
      summary: parseNullableField(fields.summary),
      backlogIds: parseListField(fields['backlog ids']),
      planRefs: parseListField(fields['plan refs']),
      satisfiedByPlanRef: parseNullableField(fields['satisfied by plan ref']),
      supersededByPlanRef: parseNullableField(fields['superseded by plan ref']),
      abandonedByPlanRef: parseNullableField(fields['abandoned by plan ref']),
    }, { slug });
  });
}

function parseRoadmapMarkdown(markdown, options = {}) {
  const { attributes, body } = parseFrontMatter(markdown);
  const slug = assertRoadmapSlug(options.slug || attributes.roadmap_slug || options.roadmapSlug);
  const titleMatch = body.match(/^# (.+)$/m);
  const title = normalizeString(attributes.title) || normalizeString(titleMatch && titleMatch[1]) || slugToTitle(slug);
  const overview = readSection(body, 'Overview') || 'TBD';
  const items = parseRoadmapItems(readSection(body, 'Roadmap Items'), slug);

  return normalizeRoadmapDocument({
    slug,
    title,
    overview,
    items,
  });
}

function resolveRoadmapsDir(repoRoot, pathImpl = path) {
  return pathImpl.join(pathImpl.resolve(String(repoRoot || '')), 'docs', 'planning');
}

function resolveRetiredRoadmapsDir(repoRoot, pathImpl = path) {
  return pathImpl.join(pathImpl.resolve(String(repoRoot || '')), 'docs', 'roadmaps');
}

function buildRepoRelativeRoadmapPath(slug, pathImpl = path) {
  return pathImpl.join('docs', 'planning', assertRoadmapSlug(slug), 'index.md').replace(/\\/g, '/');
}

function resolveRoadmapFilePath(repoRoot, slug, pathImpl = path) {
  return pathImpl.join(resolveRoadmapsDir(repoRoot, pathImpl), assertRoadmapSlug(slug), 'index.md');
}

function buildLegacyRepoRelativeRoadmapPath(slug, pathImpl = path) {
  return pathImpl.join('docs', 'planning', `${assertRoadmapSlug(slug)}.md`).replace(/\\/g, '/');
}

function resolveLegacyRoadmapFilePath(repoRoot, slug, pathImpl = path) {
  return pathImpl.join(resolveRoadmapsDir(repoRoot, pathImpl), `${assertRoadmapSlug(slug)}.md`);
}

function buildRetiredRepoRelativeRoadmapPath(slug, pathImpl = path) {
  return pathImpl.join('docs', 'roadmaps', `${assertRoadmapSlug(slug)}.md`).replace(/\\/g, '/');
}

function resolveRetiredRoadmapFilePath(repoRoot, slug, pathImpl = path) {
  return pathImpl.join(resolveRetiredRoadmapsDir(repoRoot, pathImpl), `${assertRoadmapSlug(slug)}.md`);
}

function isFile(fsImpl, filePath) {
  try {
    return fsImpl.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function resolveExistingRoadmapFilePath(repoRoot, slug, deps = {}) {
  const fsImpl = deps.fs || fs;
  const pathImpl = deps.path || path;
  const normalizedSlug = assertRoadmapSlug(slug);
  const canonicalFilePath = resolveRoadmapFilePath(repoRoot, normalizedSlug, pathImpl);
  if (isFile(fsImpl, canonicalFilePath)) {
    return canonicalFilePath;
  }
  const legacyFilePath = resolveLegacyRoadmapFilePath(repoRoot, normalizedSlug, pathImpl);
  if (isFile(fsImpl, legacyFilePath)) {
    return legacyFilePath;
  }
  const retiredFilePath = resolveRetiredRoadmapFilePath(repoRoot, normalizedSlug, pathImpl);
  return isFile(fsImpl, retiredFilePath) ? retiredFilePath : null;
}

function buildRoadmapRepoRelativePathForFile(repoRoot, slug, filePath, pathImpl = path) {
  const normalizedSlug = assertRoadmapSlug(slug);
  const normalizedFilePath = pathImpl.resolve(String(filePath || ''));
  if (normalizedFilePath === pathImpl.resolve(resolveLegacyRoadmapFilePath(repoRoot, normalizedSlug, pathImpl))) {
    return buildLegacyRepoRelativeRoadmapPath(normalizedSlug, pathImpl);
  }
  if (normalizedFilePath === pathImpl.resolve(resolveRetiredRoadmapFilePath(repoRoot, normalizedSlug, pathImpl))) {
    return buildRetiredRepoRelativeRoadmapPath(normalizedSlug, pathImpl);
  }
  return buildRepoRelativeRoadmapPath(normalizedSlug, pathImpl);
}

function readRoadmapDocument(repoRoot, slug, deps = {}) {
  const fsImpl = deps.fs || fs;
  const pathImpl = deps.path || path;
  const normalizedSlug = assertRoadmapSlug(slug);
  const filePath = resolveExistingRoadmapFilePath(repoRoot, normalizedSlug, { fs: fsImpl, path: pathImpl })
    || resolveRoadmapFilePath(repoRoot, normalizedSlug, pathImpl);
  const markdown = fsImpl.readFileSync(filePath, 'utf8');
  return {
    ...parseRoadmapMarkdown(markdown, { slug: normalizedSlug }),
    filePath,
    repoRelativePath: buildRoadmapRepoRelativePathForFile(repoRoot, normalizedSlug, filePath, pathImpl),
  };
}

function writeRoadmapDocument(repoRoot, input, deps = {}) {
  const fsImpl = deps.fs || fs;
  const pathImpl = deps.path || path;
  const document = normalizeRoadmapDocument(input);
  const filePath = resolveRoadmapFilePath(repoRoot, document.slug, pathImpl);
  fsImpl.mkdirSync(pathImpl.dirname(filePath), { recursive: true });
  fsImpl.writeFileSync(filePath, serializeRoadmapDocument(document), 'utf8');
  return {
    ...document,
    filePath,
    repoRelativePath: buildRepoRelativeRoadmapPath(document.slug, pathImpl),
  };
}

function listRoadmapDocuments(repoRoot, deps = {}) {
  const fsImpl = deps.fs || fs;
  const pathImpl = deps.path || path;
  const roadmapsDir = resolveRoadmapsDir(repoRoot, pathImpl);
  const retiredRoadmapsDir = resolveRetiredRoadmapsDir(repoRoot, pathImpl);

  let entries = [];
  try {
    entries = fsImpl.readdirSync(roadmapsDir, { withFileTypes: true });
  } catch {
    entries = [];
  }

  const canonicalSlugs = entries
    .filter((entry) => entry && entry.isDirectory && entry.isDirectory() && ROADMAP_SLUG_RE.test(entry.name))
    .map((entry) => entry.name)
    .filter((slug) => {
      try {
        return fsImpl.statSync(resolveRoadmapFilePath(repoRoot, slug, pathImpl)).isFile();
      } catch {
        return false;
      }
    });

  const legacySlugs = entries
    .filter((entry) => entry && entry.isFile && entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name.replace(/\.md$/i, ''))
    .filter((slug) => ROADMAP_SLUG_RE.test(slug) && !canonicalSlugs.includes(slug))
    .filter((slug) => {
      try {
        const markdown = fsImpl.readFileSync(resolveLegacyRoadmapFilePath(repoRoot, slug, pathImpl), 'utf8');
        return normalizeString(parseFrontMatter(markdown).attributes.doc_kind) === ROADMAP_DOC_KIND;
      } catch {
        return false;
      }
    });

  let retiredEntries = [];
  try {
    retiredEntries = fsImpl.readdirSync(retiredRoadmapsDir, { withFileTypes: true });
  } catch {
    retiredEntries = [];
  }

  const retiredLegacySlugs = retiredEntries
    .filter((entry) => entry && entry.isFile && entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name.replace(/\.md$/i, ''))
    .filter((slug) => ROADMAP_SLUG_RE.test(slug) && !canonicalSlugs.includes(slug) && !legacySlugs.includes(slug))
    .filter((slug) => {
      try {
        const markdown = fsImpl.readFileSync(resolveRetiredRoadmapFilePath(repoRoot, slug, pathImpl), 'utf8');
        return normalizeString(parseFrontMatter(markdown).attributes.doc_kind) === ROADMAP_DOC_KIND;
      } catch {
        return false;
      }
    });

  return [...canonicalSlugs, ...legacySlugs, ...retiredLegacySlugs]
    .sort(deterministicStringCompare)
    .map((slug) => readRoadmapDocument(repoRoot, slug, { fs: fsImpl, path: pathImpl }));
}

function mergeRoadmapDocument(document, updates = {}) {
  const source = normalizeRoadmapDocument(document);
  const updateSource = updates && typeof updates === 'object' ? updates : {};
  const merged = {
    slug: source.slug,
    title: Object.prototype.hasOwnProperty.call(updateSource, 'title')
      ? normalizeString(updateSource.title) || source.title
      : source.title,
    overview: Object.prototype.hasOwnProperty.call(updateSource, 'overview')
      ? normalizeTextBlock(updateSource.overview) || source.overview
      : source.overview,
    items: source.items.slice(),
  };

  if (updateSource.replaceItems === true) {
    merged.items = [];
  }

  const itemsToApply = [];
  if (updateSource.item && typeof updateSource.item === 'object') {
    itemsToApply.push(updateSource.item);
  }
  if (Array.isArray(updateSource.items)) {
    itemsToApply.push(...updateSource.items);
  }

  for (const rawItem of itemsToApply) {
    const itemSource = rawItem && typeof rawItem === 'object' ? rawItem : {};
    const explicitId = normalizeString(itemSource.id || itemSource.itemId);
    const existingIndex = explicitId
      ? merged.items.findIndex((entry) => entry.id === explicitId)
      : -1;

    if (existingIndex >= 0) {
      const existing = merged.items[existingIndex];
      const nextItem = normalizeRoadmapItem({
        ...existing,
        ...itemSource,
        id: existing.id,
      }, {
        slug: source.slug,
        existingItems: merged.items,
      });
      merged.items[existingIndex] = nextItem;
      continue;
    }

    merged.items.push(normalizeRoadmapItem(itemSource, {
      slug: source.slug,
      existingItems: merged.items,
    }));
  }

  return normalizeRoadmapDocument(merged);
}

function reconcileRoadmapItem(document, input = {}) {
  const source = normalizeRoadmapDocument(document);
  const itemId = assertRoadmapItemIdForSlug(input.itemId || input.id, source.slug);
  const outcome = normalizeString(input.outcome).toLowerCase();
  if (!ROADMAP_RECONCILE_OUTCOMES.includes(outcome)) {
    throw buildError('outcome must be completed, superseded, or abandoned', 400, 'invalid_roadmap_reconcile_outcome');
  }
  const planRef = normalizeNullablePlanRef(input.planRef);
  if (!planRef) {
    throw buildError('planRef is required', 400, 'roadmap_reconcile_plan_ref_required');
  }

  const itemIndex = source.items.findIndex((entry) => entry.id === itemId);
  if (itemIndex < 0) {
    throw buildError(`roadmap item not found: ${itemId}`, 404, 'roadmap_item_not_found');
  }

  const existing = source.items[itemIndex];
  if (!existing.backlogIds.length) {
    throw buildError(
      `roadmap item ${itemId} has no linked backlog ids; reconciliation fails closed`,
      409,
      'roadmap_reconcile_backlog_ids_missing',
    );
  }

  const requestedBacklogIds = Object.prototype.hasOwnProperty.call(input, 'backlogIds')
    ? normalizeIdList(input.backlogIds, BACKLOG_ITEM_ID_RE, 'invalid_backlog_item_id')
    : existing.backlogIds.slice();

  if (!requestedBacklogIds.length) {
    throw buildError(
      'backlogIds are required for roadmap reconciliation',
      409,
      'roadmap_reconcile_backlog_ids_required',
    );
  }

  if (
    requestedBacklogIds.length !== existing.backlogIds.length
    || requestedBacklogIds.some((entry, index) => entry !== existing.backlogIds[index])
  ) {
    throw buildError(
      `backlog ids do not match roadmap item ${itemId}`,
      409,
      'roadmap_reconcile_backlog_id_mismatch',
      {
        expectedBacklogIds: existing.backlogIds.slice(),
        receivedBacklogIds: requestedBacklogIds,
      },
    );
  }

  const planRefs = [...new Set([...existing.planRefs, planRef])].sort(deterministicStringCompare);
  const nextItem = {
    ...existing,
    planRefs,
    satisfiedByPlanRef: outcome === 'completed' ? planRef : existing.satisfiedByPlanRef,
    supersededByPlanRef: outcome === 'superseded' ? planRef : existing.supersededByPlanRef,
    abandonedByPlanRef: outcome === 'abandoned' ? planRef : existing.abandonedByPlanRef,
    status: outcome === 'completed'
      ? 'done'
      : outcome === 'superseded'
        ? 'superseded'
        : 'abandoned',
  };

  const items = source.items.slice();
  items[itemIndex] = finalizeRoadmapItem(nextItem, source.slug);
  const roadmap = normalizeRoadmapDocument({
    ...source,
    items,
  });

  return {
    roadmap,
    item: roadmap.items.find((entry) => entry.id === itemId),
    outcome,
  };
}

module.exports = {
  BACKLOG_ITEM_ID_RE,
  PLAN_REF_RE,
  ROADMAP_DOC_KIND,
  ROADMAP_ITEM_ID_RE,
  ROADMAP_ITEM_STATUSES,
  ROADMAP_RECONCILE_OUTCOMES,
  ROADMAP_SCHEMA_VERSION,
  ROADMAP_SLUG_RE,
  assertRoadmapItemIdForSlug,
  assertRoadmapSlug,
  buildNextRoadmapItemId,
  buildRepoRelativeRoadmapPath,
  listRoadmapDocuments,
  mergeRoadmapDocument,
  normalizeRoadmapDocument,
  normalizeRoadmapItem,
  parseRoadmapMarkdown,
  readRoadmapDocument,
  reconcileRoadmapItem,
  resolveRoadmapFilePath,
  resolveExistingRoadmapFilePath,
  resolveLegacyRoadmapFilePath,
  resolveRetiredRoadmapFilePath,
  resolveRoadmapsDir,
  resolveRetiredRoadmapsDir,
  serializeRoadmapDocument,
  slugToTitle,
  writeRoadmapDocument,
};
