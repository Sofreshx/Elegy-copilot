'use strict';

const fs = require('fs');
const path = require('path');

const REPOSITORY_BACKLOG_FORMAT_VERSION = '1';
const REPOSITORY_BACKLOG_FILE_RELATIVE_PATH = path.join('docs', 'backlog.md');
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

function resolveRepositoryBacklogPath(repoRoot) {
  return path.join(assertRepoRoot(repoRoot), REPOSITORY_BACKLOG_FILE_RELATIVE_PATH);
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
  const backlogPath = resolveRepositoryBacklogPath(repoRoot);
  const exists = fsImpl.existsSync(backlogPath);

  if (!exists) {
    return {
      backlogPath,
      exists: false,
      text: '',
      backlog: normalizeRepositoryBacklogDocument({ items: [] }),
    };
  }

  const text = fsImpl.readFileSync(backlogPath, 'utf8');
  return {
    backlogPath,
    exists: true,
    text,
    backlog: parseRepositoryBacklogDocument(text),
  };
}

function ensureRepositoryBacklogFile(repoRoot, options = {}) {
  const fsImpl = options.fsImpl || fs;
  const state = readRepositoryBacklogFile(repoRoot, { fsImpl });
  if (state.exists) {
    return { ...state, created: false };
  }

  const backlogPath = state.backlogPath;
  fsImpl.mkdirSync(path.dirname(backlogPath), { recursive: true });
  const backlog = normalizeRepositoryBacklogDocument({ items: [] });
  const text = formatRepositoryBacklogDocument(backlog);
  fsImpl.writeFileSync(backlogPath, text, 'utf8');

  return {
    backlogPath,
    exists: true,
    created: true,
    text,
    backlog,
  };
}

function updateRepositoryBacklogFile(repoRoot, updater, options = {}) {
  const fsImpl = options.fsImpl || fs;
  const current = ensureRepositoryBacklogFile(repoRoot, { fsImpl });
  const working = cloneValue(current.backlog);

  const nextValue =
    typeof updater === 'function' ? updater(working) : updater == null ? working : updater;
  const nextBacklog = normalizeRepositoryBacklogDocument(nextValue);
  const nextText = formatRepositoryBacklogDocument(nextBacklog);
  const changed = current.text !== nextText;

  if (changed) {
    fsImpl.writeFileSync(current.backlogPath, nextText, 'utf8');
  }

  return {
    backlogPath: current.backlogPath,
    created: current.created,
    changed,
    text: nextText,
    backlog: nextBacklog,
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
  REPOSITORY_BACKLOG_TITLE,
  REPOSITORY_BACKLOG_DESCRIPTION,
  REPOSITORY_BACKLOG_EMPTY_STATE,
  resolveRepositoryBacklogPath,
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
