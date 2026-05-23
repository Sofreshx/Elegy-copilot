'use strict';

const fs = require('fs');
const path = require('path');

const REPOSITORY_BACKLOG_FORMAT_VERSION = '1';
const REPOSITORY_BACKLOG_FILE_RELATIVE_PATH = 'docs/backlog.md';
const REPOSITORY_BACKLOG_LEGACY_FILE_RELATIVE_PATH = REPOSITORY_BACKLOG_FILE_RELATIVE_PATH;
const REPOSITORY_BACKLOG_PRIMARY_DIRECTORY_REPO_RELATIVE_PATH = 'docs/backlogs';
const REPOSITORY_BACKLOG_PRIMARY_FAMILY_REPO_RELATIVE_PATH = 'docs/backlogs/*.md';
const REPOSITORY_BACKLOG_TITLE = 'Repository Backlog';
const REPOSITORY_BACKLOG_DESCRIPTION =
  'Repository-scoped intake and queued work for the selected repo.';
const REPOSITORY_BACKLOG_EMPTY_STATE = '_No backlog items yet._';

const REPOSITORY_BACKLOG_ID_PATTERN = /^RB-(\d{3,})$/;
const ROADMAP_ITEM_ID_PATTERN = /^RM-([a-z0-9]+(?:-[a-z0-9]+)*)-(\d{3,})$/;
const PLAN_REF_PATTERN = /^[A-Za-z0-9._:/-]{1,256}$/;
const REPOSITORY_BACKLOG_KEY_POINT_PATTERN = /^- (\d{4}-\d{2}-\d{2}):\s+(.+)$/;
const REPOSITORY_BACKLOG_ITEM_STATUSES = Object.freeze([
  'proposed',
  'planned',
  'in-progress',
  'blocked',
  'satisfied',
  'superseded',
  'abandoned',
]);
const REPOSITORY_BACKLOG_RECONCILE_OUTCOMES = Object.freeze([
  'completed',
  'superseded',
  'abandoned',
]);

function normalizeLineEndings(text) {
  return String(text == null ? '' : text).replace(/\r\n?/g, '\n');
}

function normalizeBlockText(text) {
  const normalized = normalizeLineEndings(text)
    .split('\n')
    .map((line) => line.replace(/\s+$/g, ''))
    .join('\n')
    .trim();

  return normalized;
}

function deterministicStringCompare(left, right) {
  const a = String(left == null ? '' : left);
  const b = String(right == null ? '' : right);
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
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
      .map((entry) => String(entry == null ? '' : entry).trim())
      .filter(Boolean)
  )].sort(deterministicStringCompare);
}

function assertRepoRoot(repoRoot) {
  if (typeof repoRoot !== 'string' || !repoRoot.trim()) {
    throw new Error('Repository root is required');
  }

  return path.resolve(repoRoot);
}

function normalizeRepoRelativePath(value) {
  return String(value == null ? '' : value)
    .trim()
    .replace(/\\+/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

function buildRepositoryBacklogArtifactDescriptor(repoRoot, repoRelativePath, kind) {
  const normalizedRepoRoot = assertRepoRoot(repoRoot);
  const normalizedRepoRelativePath = normalizeRepoRelativePath(repoRelativePath);

  return {
    kind,
    repoRelativePath: normalizedRepoRelativePath,
    backlogPath: path.join(normalizedRepoRoot, ...normalizedRepoRelativePath.split('/')),
  };
}

function resolveRepositoryBacklogArtifactPath(repoRoot, repoRelativePath) {
  return buildRepositoryBacklogArtifactDescriptor(repoRoot, repoRelativePath, 'artifact').backlogPath;
}

function resolveRepositoryBacklogPrimaryDirectoryPath(repoRoot) {
  return resolveRepositoryBacklogArtifactPath(
    repoRoot,
    REPOSITORY_BACKLOG_PRIMARY_DIRECTORY_REPO_RELATIVE_PATH,
  );
}

function resolveRepositoryBacklogPath(repoRoot) {
  return resolveRepositoryBacklogArtifactPath(repoRoot, REPOSITORY_BACKLOG_FILE_RELATIVE_PATH);
}

function listRepositoryBacklogArtifactDescriptors(repoRoot, options = {}) {
  const fsImpl = options.fsImpl || fs;
  const descriptors = [];
  const normalizedRepoRoot = assertRepoRoot(repoRoot);
  const primaryDirectory = resolveRepositoryBacklogPrimaryDirectoryPath(normalizedRepoRoot);

  if (fsImpl.existsSync(primaryDirectory)) {
    const entries = fsImpl.readdirSync(primaryDirectory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry || typeof entry.name !== 'string') {
        continue;
      }
      if (entry.isDirectory && entry.isDirectory()) {
        continue;
      }
      if (!entry.name.toLowerCase().endsWith('.md')) {
        continue;
      }

      descriptors.push(
        buildRepositoryBacklogArtifactDescriptor(
          normalizedRepoRoot,
          `${REPOSITORY_BACKLOG_PRIMARY_DIRECTORY_REPO_RELATIVE_PATH}/${entry.name}`,
          'primary',
        ),
      );
    }
  }

  const legacyDescriptor = buildRepositoryBacklogArtifactDescriptor(
    normalizedRepoRoot,
    REPOSITORY_BACKLOG_LEGACY_FILE_RELATIVE_PATH,
    'legacy',
  );
  if (fsImpl.existsSync(legacyDescriptor.backlogPath)) {
    descriptors.push(legacyDescriptor);
  }

  return descriptors.sort((left, right) => deterministicStringCompare(left.repoRelativePath, right.repoRelativePath));
}

function buildRepositoryBacklogFamilyMetadata(repoRoot, descriptors) {
  return {
    primaryDirectoryPath: resolveRepositoryBacklogPrimaryDirectoryPath(repoRoot),
    primaryDirectoryRepoRelativePath: REPOSITORY_BACKLOG_PRIMARY_DIRECTORY_REPO_RELATIVE_PATH,
    primaryFamilyRepoRelativePath: REPOSITORY_BACKLOG_PRIMARY_FAMILY_REPO_RELATIVE_PATH,
    legacyBacklogPath: resolveRepositoryBacklogPath(repoRoot),
    legacyRepoRelativePath: REPOSITORY_BACKLOG_LEGACY_FILE_RELATIVE_PATH,
    resolvedBacklogPaths: descriptors.map((descriptor) => descriptor.backlogPath),
    resolvedRepoRelativePaths: descriptors.map((descriptor) => descriptor.repoRelativePath),
    writeTargetPath: resolveRepositoryBacklogPath(repoRoot),
    writeTargetRepoRelativePath: REPOSITORY_BACKLOG_LEGACY_FILE_RELATIVE_PATH,
  };
}

function choosePreferredRepositoryBacklogDescriptor(descriptors, family) {
  const preferredPrimary = descriptors.find((descriptor) => descriptor.kind === 'primary');
  if (preferredPrimary) {
    return preferredPrimary;
  }

  const preferredLegacy = descriptors.find((descriptor) => descriptor.kind === 'legacy');
  if (preferredLegacy) {
    return preferredLegacy;
  }

  return {
    kind: 'primary-directory',
    backlogPath: family.primaryDirectoryPath,
    repoRelativePath: family.primaryDirectoryRepoRelativePath,
  };
}

function buildAggregateRepositoryBacklogState(repoRoot, artifacts) {
  const descriptors = Array.isArray(artifacts) ? artifacts : [];
  const family = buildRepositoryBacklogFamilyMetadata(repoRoot, descriptors);
  const preferred = choosePreferredRepositoryBacklogDescriptor(descriptors, family);
  const descriptionSource = descriptors.find((artifact) => artifact.kind === 'primary')
    || descriptors.find((artifact) => artifact.kind === 'legacy')
    || null;
  const aggregateItems = [];
  const itemSources = new Map();

  for (const artifact of descriptors) {
    const sourceItems = Array.isArray(artifact && artifact.backlog && artifact.backlog.items)
      ? artifact.backlog.items
      : [];
    for (const item of sourceItems) {
      aggregateItems.push(item);
      itemSources.set(item.id, {
        sourceBacklogPath: artifact.backlogPath,
        sourceRepoRelativePath: artifact.repoRelativePath,
        sourceKind: artifact.kind,
      });
    }
  }

  const aggregateBacklog = normalizeRepositoryBacklogDocument({
    description:
      descriptionSource && descriptionSource.backlog && descriptionSource.backlog.description
        ? descriptionSource.backlog.description
        : REPOSITORY_BACKLOG_DESCRIPTION,
    items: aggregateItems,
  });

  return {
    backlogPath: preferred.backlogPath,
    repoRelativePath: preferred.repoRelativePath,
    exists: descriptors.length > 0,
    text: descriptors.length ? formatRepositoryBacklogDocument(aggregateBacklog) : '',
    backlog: {
      ...aggregateBacklog,
      items: aggregateBacklog.items.map((item) => ({
        ...item,
        ...(itemSources.get(item.id) || {}),
      })),
    },
    family,
    artifacts: descriptors,
  };
}

function isRepositoryBacklogItemId(value) {
  return REPOSITORY_BACKLOG_ID_PATTERN.test(String(value || '').trim());
}

function parseRepositoryBacklogItemIdNumber(value) {
  const match = String(value || '').trim().match(REPOSITORY_BACKLOG_ID_PATTERN);
  if (!match) {
    throw new Error(`Invalid repository backlog item ID: ${value}`);
  }

  return Number.parseInt(match[1], 10);
}

function formatRepositoryBacklogItemId(value) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    throw new Error(`Invalid repository backlog item number: ${value}`);
  }

  return `RB-${String(numeric).padStart(3, '0')}`;
}

function normalizeImportanceScore(value) {
  if (value == null || value === '') {
    return null;
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(`Invalid importance score: ${value}`);
  }

  return numeric;
}

function normalizeRepositoryBacklogStatus(value, fallback = 'proposed') {
  const normalized = String(value == null ? '' : value).trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (!REPOSITORY_BACKLOG_ITEM_STATUSES.includes(normalized)) {
    throw new Error(`Invalid repository backlog status: ${value}`);
  }
  return normalized;
}

function normalizeIdList(value, pattern, errorPrefix) {
  const normalized = normalizeDeterministicStringList(value);
  for (const token of normalized) {
    if (!pattern.test(token)) {
      throw new Error(`${errorPrefix}: ${token}`);
    }
  }
  return normalized;
}

function normalizeNullablePlanRef(value) {
  const normalized = String(value == null ? '' : value).trim();
  if (!normalized || normalized.toLowerCase() === 'none') {
    return null;
  }
  if (!PLAN_REF_PATTERN.test(normalized)) {
    throw new Error(`Invalid repository backlog plan reference: ${value}`);
  }
  return normalized;
}

function normalizePlanRefList(value) {
  return normalizeIdList(
    value,
    PLAN_REF_PATTERN,
    'Invalid repository backlog plan reference',
  );
}

function normalizeRoadmapIdList(value) {
  return normalizeIdList(
    value,
    ROADMAP_ITEM_ID_PATTERN,
    'Invalid repository backlog roadmap item ID',
  );
}

function isIsoLocalDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return false;
  }

  const normalized = value.trim();
  const parsed = Date.parse(`${normalized}T00:00:00.000Z`);
  if (!Number.isFinite(parsed)) {
    return false;
  }

  return normalized === new Date(parsed).toISOString().slice(0, 10);
}

function normalizeRepositoryBacklogKeyPoint(keyPoint) {
  if (!isPlainObject(keyPoint)) {
    throw new Error('Repository backlog key point must be an object');
  }

  const date = String(keyPoint.date || '').trim();
  const text = normalizeBlockText(keyPoint.text);

  if (!isIsoLocalDate(date)) {
    throw new Error(`Invalid repository backlog key point date: ${keyPoint.date}`);
  }

  if (!text) {
    throw new Error('Repository backlog key point text is required');
  }

  return { date, text };
}

function compareRepositoryBacklogKeyPoints(left, right) {
  const dateDiff = deterministicStringCompare(left && left.date, right && right.date);
  if (dateDiff !== 0) {
    return dateDiff;
  }

  return deterministicStringCompare(left && left.text, right && right.text);
}

function dedupeSortedKeyPoints(keyPoints) {
  const result = [];
  let previousKey = '';

  for (const keyPoint of keyPoints) {
    const dedupeKey = `${keyPoint.date}\n${keyPoint.text}`;
    if (dedupeKey === previousKey) {
      continue;
    }

    result.push(keyPoint);
    previousKey = dedupeKey;
  }

  return result;
}

function normalizeRepositoryBacklogItem(item, options = {}) {
  if (!isPlainObject(item)) {
    throw new Error('Repository backlog item must be an object');
  }

  const generator =
    typeof options.generateId === 'function'
      ? options.generateId
      : () => {
          throw new Error('Repository backlog item ID is required');
        };

  const rawId = item.id == null || item.id === '' ? generator(item) : item.id;
  const id = String(rawId || '').trim().toUpperCase();
  if (!isRepositoryBacklogItemId(id)) {
    throw new Error(`Invalid repository backlog item ID: ${rawId}`);
  }

  const title = normalizeBlockText(item.title);
  if (!title) {
    throw new Error(`Repository backlog item ${id} is missing a title`);
  }

  const status = normalizeRepositoryBacklogStatus(item.status, 'proposed');
  const summary = normalizeBlockText(item.summary);
  const roadmapIds = normalizeRoadmapIdList(item.roadmapIds);
  const planRefs = normalizePlanRefList(item.planRefs);
  let satisfiedByPlanRef = normalizeNullablePlanRef(item.satisfiedByPlanRef);
  let supersededByPlanRef = normalizeNullablePlanRef(item.supersededByPlanRef);
  let abandonedByPlanRef = normalizeNullablePlanRef(item.abandonedByPlanRef);
  const importance = normalizeImportanceScore(item.importance);

  const keyPoints = dedupeSortedKeyPoints(
    (Array.isArray(item.keyPoints) ? item.keyPoints : [])
      .map((entry) => normalizeRepositoryBacklogKeyPoint(entry))
      .sort(compareRepositoryBacklogKeyPoints),
  );

  const referencedPlanRefs = [satisfiedByPlanRef, supersededByPlanRef, abandonedByPlanRef].filter(Boolean);
  const allPlanRefs = [...new Set([...planRefs, ...referencedPlanRefs])].sort(deterministicStringCompare);

  if (status === 'satisfied' && !satisfiedByPlanRef && allPlanRefs.length === 1) {
    satisfiedByPlanRef = allPlanRefs[0];
  }
  if (status === 'superseded' && !supersededByPlanRef && allPlanRefs.length === 1) {
    supersededByPlanRef = allPlanRefs[0];
  }
  if (status === 'abandoned' && !abandonedByPlanRef && allPlanRefs.length === 1) {
    abandonedByPlanRef = allPlanRefs[0];
  }

  return {
    id,
    title,
    status,
    summary,
    roadmapIds,
    planRefs: allPlanRefs,
    satisfiedByPlanRef,
    supersededByPlanRef,
    abandonedByPlanRef,
    importance,
    keyPoints,
  };
}

function compareRepositoryBacklogItems(left, right) {
  const idDiff =
    parseRepositoryBacklogItemIdNumber(left && left.id) -
    parseRepositoryBacklogItemIdNumber(right && right.id);
  if (idDiff !== 0) {
    return idDiff;
  }

  return deterministicStringCompare(left && left.title, right && right.title);
}

function normalizeRepositoryBacklogDocument(document) {
  const source = isPlainObject(document) ? document : {};
  const description = normalizeBlockText(
    source.description == null ? REPOSITORY_BACKLOG_DESCRIPTION : source.description,
  );

  const items = (Array.isArray(source.items) ? source.items : [])
    .map((item) => normalizeRepositoryBacklogItem(item))
    .sort(compareRepositoryBacklogItems);

  const seenIds = new Set();
  for (const item of items) {
    if (seenIds.has(item.id)) {
      throw new Error(`Duplicate repository backlog item ID: ${item.id}`);
    }
    seenIds.add(item.id);
  }

  return {
    formatVersion: REPOSITORY_BACKLOG_FORMAT_VERSION,
    title: REPOSITORY_BACKLOG_TITLE,
    description: description || REPOSITORY_BACKLOG_DESCRIPTION,
    items,
  };
}

function getNextRepositoryBacklogItemId(items) {
  const sourceItems = Array.isArray(items) ? items : [];
  let nextNumber = 1;

  for (const item of sourceItems) {
    const current = parseRepositoryBacklogItemIdNumber(item && item.id);
    if (current >= nextNumber) {
      nextNumber = current + 1;
    }
  }

  return formatRepositoryBacklogItemId(nextNumber);
}

function createRepositoryBacklogItem(document, item) {
  const normalizedDocument = normalizeRepositoryBacklogDocument(document);
  const nextId = getNextRepositoryBacklogItemId(normalizedDocument.items);
  const nextItems = normalizedDocument.items.concat(
    normalizeRepositoryBacklogItem(item, {
      generateId: () => nextId,
    }),
  );

  return normalizeRepositoryBacklogDocument({
    ...normalizedDocument,
    items: nextItems,
  });
}

function updateRepositoryBacklogItem(document, itemId, patch) {
  const normalizedDocument = normalizeRepositoryBacklogDocument(document);
  const normalizedId = String(itemId || '').trim().toUpperCase();
  if (!isRepositoryBacklogItemId(normalizedId)) {
    throw new Error(`Invalid repository backlog item ID: ${itemId}`);
  }

  const index = normalizedDocument.items.findIndex((entry) => entry.id === normalizedId);
  if (index < 0) {
    throw new Error(`Repository backlog item not found: ${normalizedId}`);
  }

  const current = cloneValue(normalizedDocument.items[index]);
  const candidate =
    typeof patch === 'function'
      ? patch(current)
      : {
          ...current,
          ...(isPlainObject(patch) ? patch : {}),
        };

  if (!isPlainObject(candidate)) {
    throw new Error(`Repository backlog update for ${normalizedId} must return an object`);
  }

  candidate.id = normalizedId;

  const nextItems = normalizedDocument.items.slice();
  nextItems[index] = normalizeRepositoryBacklogItem(candidate);

  return normalizeRepositoryBacklogDocument({
    ...normalizedDocument,
    items: nextItems,
  });
}

function removeRepositoryBacklogItem(document, itemId) {
  const normalizedDocument = normalizeRepositoryBacklogDocument(document);
  const normalizedId = String(itemId || '').trim().toUpperCase();
  if (!isRepositoryBacklogItemId(normalizedId)) {
    throw new Error(`Invalid repository backlog item ID: ${itemId}`);
  }

  const nextItems = normalizedDocument.items.filter((entry) => entry.id !== normalizedId);
  if (nextItems.length === normalizedDocument.items.length) {
    throw new Error(`Repository backlog item not found: ${normalizedId}`);
  }

  return normalizeRepositoryBacklogDocument({
    ...normalizedDocument,
    items: nextItems,
  });
}

function formatRepositoryBacklogDocument(document) {
  const normalized = normalizeRepositoryBacklogDocument(document);
  const sections = [
    `# ${REPOSITORY_BACKLOG_TITLE}`,
    '',
    `<!-- REPOSITORY_BACKLOG_FORMAT_VERSION: ${REPOSITORY_BACKLOG_FORMAT_VERSION} -->`,
    '',
    normalized.description,
    '',
  ];

  if (!normalized.items.length) {
    sections.push(REPOSITORY_BACKLOG_EMPTY_STATE, '');
    return sections.join('\n');
  }

  normalized.items.forEach((item, index) => {
    if (index > 0) {
      sections.push('');
    }

    sections.push(`## ${item.id} - ${item.title}`);
    sections.push(`- Status: ${item.status}`);
    sections.push(`- Roadmap IDs: ${item.roadmapIds.length ? item.roadmapIds.join(', ') : 'none'}`);
    sections.push(`- Plan Refs: ${item.planRefs.length ? item.planRefs.join(', ') : 'none'}`);
    sections.push(`- Satisfied By Plan Ref: ${item.satisfiedByPlanRef || 'none'}`);
    sections.push(`- Superseded By Plan Ref: ${item.supersededByPlanRef || 'none'}`);
    sections.push(`- Abandoned By Plan Ref: ${item.abandonedByPlanRef || 'none'}`);

    if (item.importance != null) {
      sections.push(`- Importance: ${String(item.importance)}`);
    }

    if (item.summary) {
      if (item.importance != null) {
        sections.push('');
      }
      sections.push(item.summary);
    }

    if (item.keyPoints.length) {
      if (item.importance != null || item.summary) {
        sections.push('');
      }
      sections.push('### Key Points');
      for (const keyPoint of item.keyPoints) {
        sections.push(`- ${keyPoint.date}: ${keyPoint.text}`);
      }
    }
  });

  sections.push('');
  return sections.join('\n');
}

function parseRepositoryBacklogDocument(text) {
  const normalizedText = normalizeLineEndings(text);
  if (!normalizedText.trim()) {
    return normalizeRepositoryBacklogDocument({ items: [] });
  }

  const titleMatch = normalizedText.match(/^#\s+(.+)\s*$/m);
  if (!titleMatch || titleMatch[1].trim() !== REPOSITORY_BACKLOG_TITLE) {
    throw new Error(`Repository backlog document must begin with "# ${REPOSITORY_BACKLOG_TITLE}"`);
  }

  const versionMatch = normalizedText.match(
    /<!--\s*REPOSITORY_BACKLOG_FORMAT_VERSION:\s*(\d+)\s*-->/i,
  );

  const itemMatches = Array.from(
    normalizedText.matchAll(/^##\s+(RB-\d{3,})\s+-\s+(.+?)\s*$/gm),
  );

  let introStart = 0;
  const formatMarkerMatch = normalizedText.match(
    /<!--\s*REPOSITORY_BACKLOG_FORMAT_VERSION:\s*\d+\s*-->/i,
  );
  if (formatMarkerMatch) {
    introStart = formatMarkerMatch.index + formatMarkerMatch[0].length;
  } else if (titleMatch) {
    introStart = titleMatch.index + titleMatch[0].length;
  }

  const introEnd = itemMatches.length ? itemMatches[0].index : normalizedText.length;
  const rawDescription = normalizedText
    .slice(introStart, introEnd)
    .replace(new RegExp(`^\\s*${escapeRegExp(REPOSITORY_BACKLOG_EMPTY_STATE)}\\s*$`, 'm'), '')
    .trim();

  const items = [];
  for (let index = 0; index < itemMatches.length; index += 1) {
    const match = itemMatches[index];
    const nextMatch = itemMatches[index + 1];
    const bodyStart = match.index + match[0].length;
    const bodyEnd = nextMatch ? nextMatch.index : normalizedText.length;
    const body = normalizedText.slice(bodyStart, bodyEnd).trim();

    items.push(
      parseRepositoryBacklogItemSection({
        id: match[1],
        title: match[2],
        body,
      }),
    );
  }

  return {
    formatVersion: versionMatch ? String(versionMatch[1]) : '0',
    title: REPOSITORY_BACKLOG_TITLE,
    description: rawDescription || REPOSITORY_BACKLOG_DESCRIPTION,
    items: normalizeRepositoryBacklogDocument({ items }).items,
  };
}

function parseRepositoryBacklogItemSection(section) {
  const lines = normalizeLineEndings(section.body).split('\n');
  let cursor = 0;
  let status = 'proposed';
  let roadmapIds = [];
  let planRefs = [];
  let satisfiedByPlanRef = null;
  let supersededByPlanRef = null;
  let abandonedByPlanRef = null;
  let importance = null;

  while (cursor < lines.length && !lines[cursor].trim()) {
    cursor += 1;
  }

  while (cursor < lines.length) {
    const line = lines[cursor].trim();
    if (!line) {
      cursor += 1;
      continue;
    }
    let consumed = true;
    const statusMatch = line.match(/^- Status:\s+(.+?)\s*$/);
    const roadmapIdsMatch = line.match(/^- Roadmap IDs:\s+(.+?)\s*$/);
    const planRefsMatch = line.match(/^- Plan Refs:\s+(.+?)\s*$/);
    const satisfiedByMatch = line.match(/^- Satisfied By Plan Ref:\s+(.+?)\s*$/);
    const supersededByMatch = line.match(/^- Superseded By Plan Ref:\s+(.+?)\s*$/);
    const abandonedByMatch = line.match(/^- Abandoned By Plan Ref:\s+(.+?)\s*$/);
    const importanceMatch = line.match(/^- Importance:\s+(.+?)\s*$/);

    if (statusMatch) {
      status = normalizeRepositoryBacklogStatus(statusMatch[1], 'proposed');
    } else if (roadmapIdsMatch) {
      roadmapIds = normalizeRoadmapIdList(parseListField(roadmapIdsMatch[1]));
    } else if (planRefsMatch) {
      planRefs = normalizePlanRefList(parseListField(planRefsMatch[1]));
    } else if (satisfiedByMatch) {
      satisfiedByPlanRef = normalizeNullablePlanRef(satisfiedByMatch[1]);
    } else if (supersededByMatch) {
      supersededByPlanRef = normalizeNullablePlanRef(supersededByMatch[1]);
    } else if (abandonedByMatch) {
      abandonedByPlanRef = normalizeNullablePlanRef(abandonedByMatch[1]);
    } else if (importanceMatch) {
      importance = normalizeImportanceScore(importanceMatch[1]);
    } else {
      consumed = false;
    }

    if (!consumed) {
      break;
    }
    cursor += 1;
  }

  const remaining = lines.slice(cursor).join('\n').trim();
  if (!remaining) {
    return normalizeRepositoryBacklogItem({
      id: section.id,
      title: section.title,
      status,
      roadmapIds,
      planRefs,
      satisfiedByPlanRef,
      supersededByPlanRef,
      abandonedByPlanRef,
      importance,
      summary: '',
      keyPoints: [],
    });
  }

  const keyPointsHeadingMatch = remaining.match(/^###\s+Key Points\s*$/m);
  let summary = remaining;
  let keyPointBlock = '';

  if (keyPointsHeadingMatch) {
    summary = remaining.slice(0, keyPointsHeadingMatch.index).trim();
    keyPointBlock = remaining
      .slice(keyPointsHeadingMatch.index + keyPointsHeadingMatch[0].length)
      .trim();
  }

  const keyPoints = [];
  if (keyPointBlock) {
    for (const line of keyPointBlock.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      const keyPointMatch = trimmed.match(REPOSITORY_BACKLOG_KEY_POINT_PATTERN);
      if (!keyPointMatch) {
        throw new Error(`Invalid repository backlog key point line: ${line}`);
      }

      keyPoints.push({
        date: keyPointMatch[1],
        text: keyPointMatch[2],
      });
    }
  }

  return normalizeRepositoryBacklogItem({
    id: section.id,
    title: section.title,
    status,
    roadmapIds,
    planRefs,
    satisfiedByPlanRef,
    supersededByPlanRef,
    abandonedByPlanRef,
    importance,
    summary,
    keyPoints,
  });
}

function parseListField(value) {
  const normalized = String(value == null ? '' : value).trim();
  if (!normalized || normalized.toLowerCase() === 'none') {
    return [];
  }
  return normalized.split(',').map((entry) => entry.trim()).filter(Boolean);
}

function readRepositoryBacklogFile(repoRoot, options = {}) {
  const fsImpl = options.fsImpl || fs;
  const descriptors = listRepositoryBacklogArtifactDescriptors(repoRoot, { fsImpl }).map((descriptor) => {
    const text = fsImpl.readFileSync(descriptor.backlogPath, 'utf8');
    return {
      ...descriptor,
      exists: true,
      text,
      backlog: parseRepositoryBacklogDocument(text),
    };
  });

  return buildAggregateRepositoryBacklogState(repoRoot, descriptors);
}

function ensureRepositoryBacklogFile(repoRoot, options = {}) {
  const fsImpl = options.fsImpl || fs;
  const state = readRepositoryBacklogFile(repoRoot, { fsImpl });
  if (state.exists) {
    return { ...state, created: false };
  }

  const backlogPath = state.family.writeTargetPath;
  fsImpl.mkdirSync(path.dirname(backlogPath), { recursive: true });
  const backlog = normalizeRepositoryBacklogDocument({ items: [] });
  const text = formatRepositoryBacklogDocument(backlog);
  fsImpl.writeFileSync(backlogPath, text, 'utf8');

  return {
    ...readRepositoryBacklogFile(repoRoot, { fsImpl }),
    created: true,
  };
}

function updateRepositoryBacklogFile(repoRoot, updater, options = {}) {
  const fsImpl = options.fsImpl || fs;
  const current = readRepositoryBacklogFile(repoRoot, { fsImpl });
  const working = cloneValue(current.backlog);

  const nextValue =
    typeof updater === 'function' ? updater(working) : updater == null ? working : updater;
  const nextBacklog = normalizeRepositoryBacklogDocument(nextValue);
  const sourceById = new Map(
    current.backlog.items.map((item) => [
      item.id,
      {
        backlogPath: item.sourceBacklogPath,
        repoRelativePath: item.sourceRepoRelativePath,
      },
    ]),
  );
  const documentsByPath = new Map(
    current.artifacts.map((artifact) => [
      artifact.backlogPath,
      {
        descriptor: artifact,
        backlog: normalizeRepositoryBacklogDocument({
          description: nextBacklog.description || artifact.backlog.description,
          items: [],
        }),
      },
    ]),
  );
  const defaultTarget = buildRepositoryBacklogArtifactDescriptor(
    repoRoot,
    current.family.writeTargetRepoRelativePath,
    'legacy',
  );

  for (const item of nextBacklog.items) {
    const existingSource = sourceById.get(item.id);
    const targetDescriptor = existingSource && existingSource.backlogPath
      ? buildRepositoryBacklogArtifactDescriptor(repoRoot, existingSource.repoRelativePath, 'existing')
      : defaultTarget;
    const existingDocument = documentsByPath.get(targetDescriptor.backlogPath);
    if (existingDocument) {
      existingDocument.backlog.items.push(item);
      continue;
    }

    documentsByPath.set(targetDescriptor.backlogPath, {
      descriptor: targetDescriptor,
      backlog: normalizeRepositoryBacklogDocument({
        description: nextBacklog.description,
        items: [item],
      }),
    });
  }

  let created = false;
  let changed = false;

  for (const { descriptor, backlog } of documentsByPath.values()) {
    const normalizedBacklog = normalizeRepositoryBacklogDocument(backlog);
    const nextText = formatRepositoryBacklogDocument(normalizedBacklog);
    const existed = fsImpl.existsSync(descriptor.backlogPath);
    const currentText = existed ? fsImpl.readFileSync(descriptor.backlogPath, 'utf8') : '';

    if (!existed) {
      created = true;
    }
    if (currentText === nextText) {
      continue;
    }

    fsImpl.mkdirSync(path.dirname(descriptor.backlogPath), { recursive: true });
    fsImpl.writeFileSync(descriptor.backlogPath, nextText, 'utf8');
    changed = true;
  }

  const nextState = readRepositoryBacklogFile(repoRoot, { fsImpl });
  return {
    ...nextState,
    created,
    changed,
  };
}

function reconcileRepositoryBacklogItem(document, input = {}) {
  const outcome = String(input && input.outcome ? input.outcome : '').trim().toLowerCase();
  if (!REPOSITORY_BACKLOG_RECONCILE_OUTCOMES.includes(outcome)) {
    throw new Error('Repository backlog reconciliation outcome must be completed, superseded, or abandoned');
  }

  const planRef = normalizeNullablePlanRef(input.planRef);
  if (!planRef) {
    throw new Error('Repository backlog reconciliation planRef is required');
  }

  const roadmapIds = normalizeRoadmapIdList(input.roadmapIds);
  if (!roadmapIds.length) {
    throw new Error('Repository backlog reconciliation roadmapIds are required');
  }

  const normalizedId = String(input.itemId || input.id || '').trim().toUpperCase();
  return updateRepositoryBacklogItem(document, normalizedId, (item) => ({
    ...item,
    status: outcome === 'completed'
      ? 'satisfied'
      : outcome === 'superseded'
        ? 'superseded'
        : 'abandoned',
    roadmapIds: [...new Set([...(Array.isArray(item.roadmapIds) ? item.roadmapIds : []), ...roadmapIds])]
      .sort(deterministicStringCompare),
    planRefs: [...new Set([...(Array.isArray(item.planRefs) ? item.planRefs : []), planRef])]
      .sort(deterministicStringCompare),
    satisfiedByPlanRef: outcome === 'completed' ? planRef : item.satisfiedByPlanRef,
    supersededByPlanRef: outcome === 'superseded' ? planRef : item.supersededByPlanRef,
    abandonedByPlanRef: outcome === 'abandoned' ? planRef : item.abandonedByPlanRef,
  }));
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  REPOSITORY_BACKLOG_FORMAT_VERSION,
  REPOSITORY_BACKLOG_FILE_RELATIVE_PATH,
  REPOSITORY_BACKLOG_LEGACY_FILE_RELATIVE_PATH,
  REPOSITORY_BACKLOG_PRIMARY_DIRECTORY_REPO_RELATIVE_PATH,
  REPOSITORY_BACKLOG_PRIMARY_FAMILY_REPO_RELATIVE_PATH,
  REPOSITORY_BACKLOG_TITLE,
  REPOSITORY_BACKLOG_DESCRIPTION,
  REPOSITORY_BACKLOG_EMPTY_STATE,
  resolveRepositoryBacklogPath,
  resolveRepositoryBacklogArtifactPath,
  resolveRepositoryBacklogPrimaryDirectoryPath,
  REPOSITORY_BACKLOG_ITEM_STATUSES,
  REPOSITORY_BACKLOG_RECONCILE_OUTCOMES,
  isRepositoryBacklogItemId,
  parseRepositoryBacklogItemIdNumber,
  formatRepositoryBacklogItemId,
  normalizeRepositoryBacklogKeyPoint,
  normalizeRepositoryBacklogItem,
  normalizeRepositoryBacklogDocument,
  compareRepositoryBacklogKeyPoints,
  compareRepositoryBacklogItems,
  parseRepositoryBacklogDocument,
  formatRepositoryBacklogDocument,
  getNextRepositoryBacklogItemId,
  createRepositoryBacklogItem,
  updateRepositoryBacklogItem,
  removeRepositoryBacklogItem,
  reconcileRepositoryBacklogItem,
  readRepositoryBacklogFile,
  ensureRepositoryBacklogFile,
  updateRepositoryBacklogFile,
};
