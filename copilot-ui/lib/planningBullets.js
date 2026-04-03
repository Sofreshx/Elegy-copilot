'use strict';

const fs = require('fs');
const path = require('path');

const PLANNING_BULLETS_FILE_REPO_RELATIVE_PATH = 'docs/planning/bullets.md';
const PLANNING_BULLETS_FILE_RELATIVE_PATH = path.join('docs', 'planning', 'bullets.md');
const PLANNING_BULLETS_TITLE = 'Planning Bullets';
const PLANNING_BULLETS_DESCRIPTION =
  'Repository-scoped bullet seeds for future planning sessions.';
const PLANNING_BULLET_ID_PATTERN = /^PB-(\d{3,})$/;
const PLANNING_BULLET_STATES = Object.freeze(['idea', 'research', 'pre-plan']);
const BACKLOG_ID_PATTERN = /^RB-\d{3,}$/;
const ROADMAP_ID_PATTERN = /^RM-([a-z0-9]+(?:-[a-z0-9]+)*)-(\d{3,})$/;
const PLAN_REF_PATTERN = /^[A-Za-z0-9._:/-]{1,256}$/;

function normalizeLineEndings(text) {
  return String(text == null ? '' : text).replace(/\r\n?/g, '\n');
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeSingleLineText(value) {
  return normalizeString(typeof value === 'string' ? value.replace(/\s+/g, ' ') : '');
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

function deterministicStringCompare(left, right) {
  const a = String(left == null ? '' : left);
  const b = String(right == null ? '' : right);
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function normalizeDeterministicStringList(value) {
  return [...new Set(
    normalizeListInput(value)
      .map((entry) => normalizeString(entry))
      .filter(Boolean)
  )].sort(deterministicStringCompare);
}

function buildError(message, statusCode = 400, code = 'planning_bullets_error', extra = {}) {
  return Object.assign(new Error(message), {
    statusCode,
    code,
    reason: code,
    ...extra,
  });
}

function assertRepoRoot(repoRoot) {
  const normalized = normalizeString(repoRoot);
  if (!normalized) {
    throw buildError('repository root is required', 400, 'planning_bullets_repo_root_required');
  }
  return path.resolve(normalized);
}

function resolvePlanningBulletsFilePath(repoRoot) {
  return path.join(assertRepoRoot(repoRoot), PLANNING_BULLETS_FILE_RELATIVE_PATH);
}

function isPlanningBulletId(value) {
  return PLANNING_BULLET_ID_PATTERN.test(normalizeString(value).toUpperCase());
}

function formatPlanningBulletId(value) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    throw buildError('planning bullet number must be a positive integer', 400, 'invalid_planning_bullet_number');
  }
  return `PB-${String(numeric).padStart(3, '0')}`;
}

function buildNextPlanningBulletId(existingBullets) {
  let max = 0;
  for (const bullet of Array.isArray(existingBullets) ? existingBullets : []) {
    const id = normalizeString(bullet && bullet.id).toUpperCase();
    const match = id.match(PLANNING_BULLET_ID_PATTERN);
    if (!match) {
      continue;
    }
    const numeric = Number.parseInt(match[1], 10);
    if (Number.isFinite(numeric) && numeric > max) {
      max = numeric;
    }
  }
  return formatPlanningBulletId(max + 1);
}

function normalizePlanningBulletState(value, fallback = 'idea') {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (!PLANNING_BULLET_STATES.includes(normalized)) {
    throw buildError(
      `unsupported planning bullet state: ${value}`,
      400,
      'invalid_planning_bullet_state',
    );
  }
  return normalized;
}

function normalizePlanRefList(value) {
  const normalized = normalizeDeterministicStringList(value);
  for (const token of normalized) {
    if (!PLAN_REF_PATTERN.test(token)) {
      throw buildError(`invalid plan reference: ${token}`, 400, 'invalid_planning_bullet_plan_ref');
    }
  }
  return normalized;
}

function normalizeBacklogRefList(value) {
  const normalized = normalizeDeterministicStringList(value);
  for (const token of normalized) {
    if (!BACKLOG_ID_PATTERN.test(token)) {
      throw buildError(`invalid backlog reference: ${token}`, 400, 'invalid_planning_bullet_backlog_ref');
    }
  }
  return normalized;
}

function normalizeRoadmapRefList(value) {
  const normalized = normalizeDeterministicStringList(value);
  for (const token of normalized) {
    if (!ROADMAP_ID_PATTERN.test(token)) {
      throw buildError(`invalid roadmap reference: ${token}`, 400, 'invalid_planning_bullet_roadmap_ref');
    }
  }
  return normalized;
}

function normalizeNotesList(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => normalizeSingleLineText(entry))
      .filter(Boolean);
  }

  if (typeof value === 'string') {
    return normalizeLineEndings(value)
      .split('\n')
      .map((entry) => entry.replace(/^\s*[-*]\s*/, ''))
      .map((entry) => normalizeSingleLineText(entry))
      .filter(Boolean);
  }

  return [];
}

function finalizePlanningBullet(input, options = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const generator = typeof options.generateId === 'function'
    ? options.generateId
    : () => {
        throw buildError('planning bullet id is required', 400, 'planning_bullet_id_required');
      };

  const rawId = source.id == null || source.id === '' ? generator(source) : source.id;
  const id = normalizeString(rawId).toUpperCase();
  if (!isPlanningBulletId(id)) {
    throw buildError('planning bullet id must use format PB-###', 400, 'invalid_planning_bullet_id');
  }

  const title = normalizeSingleLineText(source.title);
  if (!title) {
    throw buildError(`planning bullet ${id} is missing a title`, 400, 'planning_bullet_title_required');
  }

  const repoId = normalizeString(source.repoId);
  if (!repoId) {
    throw buildError(`planning bullet ${id} is missing a repo id`, 400, 'planning_bullet_repo_required');
  }

  return {
    id,
    title,
    state: normalizePlanningBulletState(source.state, 'idea'),
    repoId,
    summary: normalizeSingleLineText(source.summary),
    notes: normalizeNotesList(source.notes),
    promotedPlanRefs: normalizePlanRefList(source.promotedPlanRefs),
    promotedBacklogRefs: normalizeBacklogRefList(source.promotedBacklogRefs),
    promotedRoadmapRefs: normalizeRoadmapRefList(source.promotedRoadmapRefs),
  };
}

function createEmptyPlanningBulletsDocument() {
  return {
    title: PLANNING_BULLETS_TITLE,
    description: PLANNING_BULLETS_DESCRIPTION,
    bullets: [],
  };
}

function parseCommaOrNone(value) {
  const normalized = normalizeString(value);
  if (!normalized || normalized.toLowerCase() === 'none') {
    return [];
  }
  return normalized.split(',').map((entry) => normalizeString(entry)).filter(Boolean);
}

function expectFieldLine(lines, index, fieldName, bulletId) {
  const raw = lines[index] || '';
  const prefix = `- ${fieldName}:`;
  if (!raw.startsWith(prefix)) {
    throw buildError(
      `planning bullets entry ${bulletId} must include "${prefix}"`,
      409,
      'planning_bullets_file_invalid',
    );
  }
  return raw.slice(prefix.length).trim();
}

function parseBulletSection(id, title, sectionLines) {
  let index = 0;
  const state = expectFieldLine(sectionLines, index++, 'State', id);
  const repoId = expectFieldLine(sectionLines, index++, 'Repo', id);
  const summary = expectFieldLine(sectionLines, index++, 'Summary', id);

  const notesLabel = sectionLines[index] || '';
  if (notesLabel !== '- Notes:') {
    throw buildError(
      `planning bullets entry ${id} must include "- Notes:"`,
      409,
      'planning_bullets_file_invalid',
    );
  }
  index += 1;

  const notes = [];
  while (index < sectionLines.length && sectionLines[index].startsWith('  - ')) {
    const note = normalizeSingleLineText(sectionLines[index].slice(4));
    if (note && note.toLowerCase() !== 'none') {
      notes.push(note);
    }
    index += 1;
  }

  const promotedPlanRefs = parseCommaOrNone(expectFieldLine(sectionLines, index++, 'Promoted to plan', id));
  const promotedBacklogRefs = parseCommaOrNone(expectFieldLine(sectionLines, index++, 'Promoted to backlog', id));
  const promotedRoadmapRefs = index < sectionLines.length
    ? parseCommaOrNone(expectFieldLine(sectionLines, index++, 'Promoted to roadmap', id))
    : [];

  if (index !== sectionLines.length) {
    throw buildError(
      `planning bullets entry ${id} contains unexpected extra lines`,
      409,
      'planning_bullets_file_invalid',
    );
  }

  return finalizePlanningBullet({
    id,
    title,
    state,
    repoId,
    summary,
    notes,
    promotedPlanRefs,
    promotedBacklogRefs,
    promotedRoadmapRefs,
  });
}

function parsePlanningBulletsDocument(text) {
  const normalized = normalizeLineEndings(text);
  const lines = normalized.split('\n').map((line) => line.replace(/\s+$/g, ''));
  while (lines.length > 0 && !lines[lines.length - 1]) {
    lines.pop();
  }

  if (normalizeString(lines[0]) !== `# ${PLANNING_BULLETS_TITLE}`) {
    throw buildError(
      `planning bullets document must begin with "# ${PLANNING_BULLETS_TITLE}"`,
      409,
      'planning_bullets_file_invalid',
    );
  }

  const bullets = [];
  let lineIndex = 1;

  while (lineIndex < lines.length && !normalizeString(lines[lineIndex]).startsWith('## ')) {
    lineIndex += 1;
  }

  while (lineIndex < lines.length) {
    const heading = normalizeString(lines[lineIndex]);
    const match = heading.match(/^##\s+(PB-\d{3,})\s+—\s+(.+)$/);
    if (!match) {
      throw buildError(
        `invalid planning bullet heading: ${heading || '(empty line)'}`,
        409,
        'planning_bullets_file_invalid',
      );
    }

    const bulletId = match[1];
    const bulletTitle = normalizeSingleLineText(match[2]);
    lineIndex += 1;

    const sectionLines = [];
    while (lineIndex < lines.length && !normalizeString(lines[lineIndex]).startsWith('## ')) {
      if (normalizeString(lines[lineIndex])) {
        sectionLines.push(lines[lineIndex]);
      }
      lineIndex += 1;
    }

    const bullet = parseBulletSection(bulletId, bulletTitle, sectionLines);
    if (bullets.some((entry) => entry.id === bullet.id)) {
      throw buildError(
        `duplicate planning bullet id: ${bullet.id}`,
        409,
        'planning_bullets_file_invalid',
      );
    }
    bullets.push(bullet);
  }

  bullets.sort((left, right) => deterministicStringCompare(left.id, right.id));

  return {
    title: PLANNING_BULLETS_TITLE,
    description: PLANNING_BULLETS_DESCRIPTION,
    bullets,
  };
}

function serializePlanningBulletsDocument(input) {
  const source = input && typeof input === 'object' ? input : {};
  const bullets = Array.isArray(source.bullets) ? source.bullets.map((entry) => finalizePlanningBullet(entry)) : [];
  bullets.sort((left, right) => deterministicStringCompare(left.id, right.id));

  const lines = [
    `# ${PLANNING_BULLETS_TITLE}`,
    '',
    PLANNING_BULLETS_DESCRIPTION,
    '',
  ];

  if (bullets.length === 0) {
    lines.push('_No planning bullets yet._', '');
    return `${lines.join('\n')}\n`;
  }

  bullets.forEach((bullet, index) => {
    lines.push(`## ${bullet.id} — ${bullet.title}`);
    lines.push(`- State: ${bullet.state}`);
    lines.push(`- Repo: ${bullet.repoId}`);
    lines.push(`- Summary: ${bullet.summary}`);
    lines.push('- Notes:');

    if (bullet.notes.length > 0) {
      bullet.notes.forEach((note) => {
        lines.push(`  - ${note}`);
      });
    } else {
      lines.push('  - none');
    }

    lines.push(`- Promoted to plan: ${bullet.promotedPlanRefs.length > 0 ? bullet.promotedPlanRefs.join(', ') : 'none'}`);
    lines.push(`- Promoted to backlog: ${bullet.promotedBacklogRefs.length > 0 ? bullet.promotedBacklogRefs.join(', ') : 'none'}`);
    lines.push(`- Promoted to roadmap: ${bullet.promotedRoadmapRefs.length > 0 ? bullet.promotedRoadmapRefs.join(', ') : 'none'}`);

    if (index < bullets.length - 1) {
      lines.push('');
    }
  });

  lines.push('');
  return `${lines.join('\n')}\n`;
}

function readPlanningBulletsFile(repoRoot) {
  const filePath = resolvePlanningBulletsFilePath(repoRoot);
  if (!fs.existsSync(filePath)) {
    return {
      exists: false,
      filePath,
      repoRelativePath: PLANNING_BULLETS_FILE_REPO_RELATIVE_PATH,
      bulletsDoc: createEmptyPlanningBulletsDocument(),
    };
  }

  const text = fs.readFileSync(filePath, 'utf8');
  return {
    exists: true,
    filePath,
    repoRelativePath: PLANNING_BULLETS_FILE_REPO_RELATIVE_PATH,
    bulletsDoc: parsePlanningBulletsDocument(text),
  };
}

function writePlanningBulletsFile(repoRoot, documentInput) {
  const repoPath = assertRepoRoot(repoRoot);
  const filePath = resolvePlanningBulletsFilePath(repoPath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const text = serializePlanningBulletsDocument(documentInput);
  fs.writeFileSync(filePath, text, 'utf8');
  return readPlanningBulletsFile(repoPath);
}

function updatePlanningBulletsFile(repoRoot, updater) {
  const current = readPlanningBulletsFile(repoRoot);
  const nextDocument = typeof updater === 'function'
    ? updater({
        title: current.bulletsDoc.title,
        description: current.bulletsDoc.description,
        bullets: current.bulletsDoc.bullets.map((entry) => ({ ...entry })),
      })
    : current.bulletsDoc;
  return writePlanningBulletsFile(repoRoot, nextDocument);
}

function listPlanningBullets(repoRoot) {
  const state = readPlanningBulletsFile(repoRoot);
  return {
    exists: state.exists,
    filePath: state.filePath,
    repoRelativePath: state.repoRelativePath,
    stableIdPattern: 'PB-###',
    supportedStates: [...PLANNING_BULLET_STATES],
    bullets: state.bulletsDoc.bullets.map((entry) => ({
      ...entry,
      filePath: state.filePath,
      repoRelativePath: state.repoRelativePath,
    })),
  };
}

function createPlanningBullet(repoRoot, input) {
  const current = readPlanningBulletsFile(repoRoot);
  const nextBullet = finalizePlanningBullet(input, {
    generateId: () => buildNextPlanningBulletId(current.bulletsDoc.bullets),
  });

  const saved = writePlanningBulletsFile(repoRoot, {
    ...current.bulletsDoc,
    bullets: [...current.bulletsDoc.bullets, nextBullet],
  });

  return saved.bulletsDoc.bullets.find((entry) => entry.id === nextBullet.id) || nextBullet;
}

function updatePlanningBullet(repoRoot, bulletId, patch) {
  const normalizedBulletId = normalizeString(bulletId).toUpperCase();
  if (!isPlanningBulletId(normalizedBulletId)) {
    throw buildError('planning bullet id must use format PB-###', 400, 'invalid_planning_bullet_id');
  }

  const current = readPlanningBulletsFile(repoRoot);
  const bulletIndex = current.bulletsDoc.bullets.findIndex((entry) => entry.id === normalizedBulletId);
  if (bulletIndex < 0) {
    throw buildError(`planning bullet not found: ${normalizedBulletId}`, 404, 'planning_bullet_not_found');
  }

  const existing = current.bulletsDoc.bullets[bulletIndex];
  const nextBullet = finalizePlanningBullet({
    ...existing,
    ...(patch && typeof patch === 'object' ? patch : {}),
    id: normalizedBulletId,
  });

  const nextBullets = current.bulletsDoc.bullets.slice();
  nextBullets[bulletIndex] = nextBullet;
  const saved = writePlanningBulletsFile(repoRoot, {
    ...current.bulletsDoc,
    bullets: nextBullets,
  });

  return saved.bulletsDoc.bullets.find((entry) => entry.id === normalizedBulletId) || nextBullet;
}

module.exports = {
  PLANNING_BULLETS_FILE_REPO_RELATIVE_PATH,
  PLANNING_BULLETS_FILE_RELATIVE_PATH,
  PLANNING_BULLETS_TITLE,
  PLANNING_BULLETS_DESCRIPTION,
  PLANNING_BULLET_ID_PATTERN,
  PLANNING_BULLET_STATES,
  resolvePlanningBulletsFilePath,
  serializePlanningBulletsDocument,
  parsePlanningBulletsDocument,
  readPlanningBulletsFile,
  writePlanningBulletsFile,
  updatePlanningBulletsFile,
  listPlanningBullets,
  createPlanningBullet,
  updatePlanningBullet,
};
