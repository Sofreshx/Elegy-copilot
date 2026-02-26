/**
 * planState.js
 * 
 * Parser for Plan-Pack Progress Tracker format.
 * 
 * Extracts structured data from plan artifacts that follow the
 * canonical format defined in engine-assets/agents/o-planner.agent.md.
 * 
 * Returns partial results on parse errors (never throws).
 */

const PLANNING_STATES = Object.freeze([
  'thought',
  'research',
  'pre-plan',
  'queued',
  'implemented',
  'merged',
  'superseded',
]);

const TERMINAL_PLANNING_STATES = Object.freeze([
  'merged',
  'superseded',
]);

const PLANNING_TRANSITION_MATRIX = Object.freeze({
  thought: Object.freeze(['research', 'merged', 'superseded']),
  research: Object.freeze(['pre-plan', 'merged', 'superseded']),
  'pre-plan': Object.freeze(['queued', 'merged', 'superseded']),
  queued: Object.freeze(['implemented', 'merged', 'superseded']),
  implemented: Object.freeze(['merged', 'superseded']),
  merged: Object.freeze([]),
  superseded: Object.freeze([]),
});

const PLANNING_SCOPE_PRECEDENCE = Object.freeze({
  user: 3,
  repo: 2,
  global: 1,
});

const PLANNING_PRECEDENCE_CONTRACT_VERSION = '1';

const PLANNING_RECORD_PRECEDENCE_RULES = Object.freeze([
  'scope-precedence:user>repo>global',
  'score-desc:null-invalid=-1',
  'updatedAt-desc:null-invalid=epoch',
  'createdAt-desc:null-invalid=epoch',
  'recordId-asc',
]);

const PLANNING_SCOPES = Object.freeze(['user', 'repo', 'global']);

const PLANNING_STATE_SET = new Set(PLANNING_STATES);

function deterministicStringCompare(a, b) {
  const left = String(a == null ? '' : a);
  const right = String(b == null ? '' : b);
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function normalizePlanningState(state) {
  if (typeof state !== 'string') {
    return null;
  }

  let normalized = state.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  normalized = normalized.replace(/[_\s]+/g, '-');
  if (normalized === 'preplan') {
    normalized = 'pre-plan';
  }

  return PLANNING_STATE_SET.has(normalized) ? normalized : null;
}

function isValidPlanningTransition(fromState, toState) {
  const from = normalizePlanningState(fromState);
  const to = normalizePlanningState(toState);

  if (!from || !to || from === to) {
    return false;
  }

  const allowedTransitions = PLANNING_TRANSITION_MATRIX[from];
  return Array.isArray(allowedTransitions) && allowedTransitions.includes(to);
}

function normalizePlanningScope(valueOrRecord) {
  let scopeValue = valueOrRecord;
  if (valueOrRecord && typeof valueOrRecord === 'object') {
    scopeValue = valueOrRecord.scope != null ? valueOrRecord.scope : valueOrRecord.source;
  }

  if (typeof scopeValue !== 'string') {
    return '';
  }

  const normalized = scopeValue.trim().toLowerCase();
  return PLANNING_SCOPES.includes(normalized) ? normalized : '';
}

function getPlanningScopePrecedence(record) {
  return PLANNING_SCOPE_PRECEDENCE[normalizePlanningScope(record)] || 0;
}

function normalizePlanningScore(score) {
  if (score == null) {
    return -1;
  }

  const numeric = Number(score);
  return Number.isFinite(numeric) ? numeric : -1;
}

function normalizePlanningTimestamp(timestamp) {
  if (timestamp == null) {
    return 0;
  }

  if (timestamp instanceof Date) {
    const value = timestamp.getTime();
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof timestamp === 'number') {
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizePlanningRecordId(record) {
  if (!record || typeof record !== 'object' || record.recordId == null) {
    return '';
  }

  return String(record.recordId);
}

function comparePlanningRecords(a, b) {
  const precedenceDiff = getPlanningScopePrecedence(b) - getPlanningScopePrecedence(a);
  if (precedenceDiff !== 0) {
    return precedenceDiff;
  }

  const scoreDiff = normalizePlanningScore(b && b.score) - normalizePlanningScore(a && a.score);
  if (scoreDiff !== 0) {
    return scoreDiff;
  }

  const updatedAtDiff = normalizePlanningTimestamp(b && b.updatedAt) - normalizePlanningTimestamp(a && a.updatedAt);
  if (updatedAtDiff !== 0) {
    return updatedAtDiff;
  }

  const createdAtDiff = normalizePlanningTimestamp(b && b.createdAt) - normalizePlanningTimestamp(a && a.createdAt);
  if (createdAtDiff !== 0) {
    return createdAtDiff;
  }

  return deterministicStringCompare(normalizePlanningRecordId(a), normalizePlanningRecordId(b));
}

/**
 * Parse a plan artifact and extract structured progress data.
 * 
 * @param {string} text - Full plan.md content
 * @returns {object} Structured state with { groups, workUnits, checkpoints, nextUnit, meta, formatVersion, warnings }
 */
function parseStructuredState(text) {
  const result = {
    formatVersion: 0,
    warnings: [],
    groups: [],
    workUnits: [],
    checkpoints: [],
    nextUnit: null,
    meta: {},
  };

  if (!text || typeof text !== 'string') {
    result.warnings.push('Empty or invalid input text');
    return result;
  }

  // Check for format version marker
  const versionMatch = text.match(/<!--\s*IE_PROGRESS_TRACKER_VERSION:\s*(\d+)\s*-->/i);
  if (versionMatch) {
    result.formatVersion = parseInt(versionMatch[1], 10) || 0;
  }

  // Extract the Progress Tracker section
  const trackerMatch = text.match(/^#\s+Plan-Pack Progress Tracker\s*$/im);
  if (!trackerMatch) {
    result.warnings.push('No "# Plan-Pack Progress Tracker" heading found; treating as v0/unstructured');
    return result;
  }

  const trackerStart = trackerMatch.index + trackerMatch[0].length;
  let trackerText = text.slice(trackerStart);

  // Stop at next top-level heading (if any)
  const nextHeadingMatch = trackerText.match(/^#\s+[^#]/m);
  if (nextHeadingMatch) {
    trackerText = trackerText.slice(0, nextHeadingMatch.index);
  }

  // Parse Work Unit Groups Overview table
  result.groups = parseGroupsOverview(trackerText, result.warnings);

  // Parse Work Unit Status Table
  result.workUnits = parseWorkUnitStatus(trackerText, result.warnings);

  // Parse Next Unit
  result.nextUnit = parseNextUnit(trackerText, result.warnings);

  // Parse Checkpoints
  result.checkpoints = parseCheckpoints(trackerText, result.warnings);

  return result;
}

/**
 * Parse "## Work Unit Groups Overview" table
 * Expected columns: Group | Title | Status | WUs Done | WUs Total | Depends On
 */
function parseGroupsOverview(text, warnings) {
  const groups = [];
  const sectionMatch = text.match(/^##\s+Work Unit Groups Overview\s*$/im);
  if (!sectionMatch) {
    warnings.push('No "## Work Unit Groups Overview" section found');
    return groups;
  }

  const sectionStart = sectionMatch.index + sectionMatch[0].length;
  let sectionText = text.slice(sectionStart);

  // Stop at next section heading
  const nextSectionMatch = sectionText.match(/^##\s+/m);
  if (nextSectionMatch) {
    sectionText = sectionText.slice(0, nextSectionMatch.index);
  }

  // Find table rows (lines with |)
  const lines = sectionText.split('\n').filter((line) => line.includes('|'));
  if (lines.length < 3) {
    warnings.push('Work Unit Groups Overview: insufficient table rows');
    return groups;
  }

  // Skip header and separator
  const dataLines = lines.slice(2);

  for (const line of dataLines) {
    const cells = line.split('|').map((c) => c.trim()).filter((c) => c !== '');
    if (cells.length < 5) continue; // Need at least Group, Title, Status, WUs Done, WUs Total

    const group = cells[0] || '';
    const title = cells[1] || '';
    const status = cells[2] || 'not-started';
    const wusDone = parseInt(cells[3], 10) || 0;
    const wusTotal = parseInt(cells[4], 10) || 0;
    const dependsOn = cells[5] || '—';

    groups.push({
      group,
      title,
      status,
      wusDone,
      wusTotal,
      dependsOn: dependsOn === '—' || dependsOn === '-' ? null : dependsOn,
    });
  }

  return groups;
}

/**
 * Parse "## Work Unit Status Table"
 * Expected columns: Group | Work Unit ID | Status | Next Unit | Notes
 */
function parseWorkUnitStatus(text, warnings) {
  const workUnits = [];
  const sectionMatch = text.match(/^##\s+Work Unit Status Table\s*$/im);
  if (!sectionMatch) {
    warnings.push('No "## Work Unit Status Table" section found');
    return workUnits;
  }

  const sectionStart = sectionMatch.index + sectionMatch[0].length;
  let sectionText = text.slice(sectionStart);

  // Stop at next section heading
  const nextSectionMatch = sectionText.match(/^##\s+/m);
  if (nextSectionMatch) {
    sectionText = sectionText.slice(0, nextSectionMatch.index);
  }

  // Find table rows
  const lines = sectionText.split('\n').filter((line) => line.includes('|'));
  if (lines.length < 3) {
    warnings.push('Work Unit Status Table: insufficient table rows');
    return workUnits;
  }

  // Skip header and separator
  const dataLines = lines.slice(2);

  for (const line of dataLines) {
    const cells = line.split('|').map((c) => c.trim()).filter((c) => c !== '');
    if (cells.length < 3) continue; // Need at least Group, Work Unit ID, Status

    const group = cells[0] || '';
    const workUnitId = cells[1] || '';
    const status = cells[2] || 'not-started';
    const nextUnit = cells[3] || '—';
    const notes = cells[4] || '';

    workUnits.push({
      group,
      workUnitId,
      status,
      nextUnit: nextUnit === '—' || nextUnit === '-' ? null : nextUnit,
      notes,
    });
  }

  return workUnits;
}

/**
 * Parse "## Next Unit" section
 * Expected format: **WU-XXX** — <rationale> or NONE — <reason>
 */
function parseNextUnit(text, warnings) {
  const sectionMatch = text.match(/^##\s+Next Unit\s*$/im);
  if (!sectionMatch) {
    warnings.push('No "## Next Unit" section found');
    return null;
  }

  const sectionStart = sectionMatch.index + sectionMatch[0].length;
  let sectionText = text.slice(sectionStart);

  // Stop at next section heading
  const nextSectionMatch = sectionText.match(/^##\s+/m);
  if (nextSectionMatch) {
    sectionText = sectionText.slice(0, nextSectionMatch.index);
  }

  // Look for **WU-XXX** or NONE pattern
  // Support both regular dash (-), em dash (\u2014), and en dash (\u2013)
  // Use [^\r\n]+ to capture the rest of the line (handles leading whitespace in section)
   const nextUnitMatch = sectionText.match(/\*\*([A-Z]+-\d+)\*\*\s*[\u2014\u2013\-]\s*([^\r\n]{1,500})/i);
  if (nextUnitMatch) {
    return {
      workUnitId: nextUnitMatch[1],
      rationale: nextUnitMatch[2].trim(),
    };
  }

   const noneMatch = sectionText.match(/NONE\s*[\u2014\u2013\-]\s*([^\r\n]{1,500})/i);
  if (noneMatch) {
    return {
      workUnitId: 'NONE',
      rationale: noneMatch[1].trim(),
    };
  }

  warnings.push('Next Unit: unable to parse next unit from section text');
  return null;
}

/**
 * Parse "## Checkpoints" table
 * Expected columns: Group | Checkpoint | Trigger | Notes
 * Status is encoded in Notes as: status: passed|failed|pending|skipped
 */
function parseCheckpoints(text, warnings) {
  const checkpoints = [];
  const sectionMatch = text.match(/^##\s+Checkpoints\s*$/im);
  if (!sectionMatch) {
    warnings.push('No "## Checkpoints" section found');
    return checkpoints;
  }

  const sectionStart = sectionMatch.index + sectionMatch[0].length;
  let sectionText = text.slice(sectionStart);

  // Stop at next section heading
  const nextSectionMatch = sectionText.match(/^##\s+/m);
  if (nextSectionMatch) {
    sectionText = sectionText.slice(0, nextSectionMatch.index);
  }

  // Find table rows
  const lines = sectionText.split('\n').filter((line) => line.includes('|'));
  if (lines.length < 3) {
    warnings.push('Checkpoints: insufficient table rows');
    return checkpoints;
  }

  // Skip header and separator
  const dataLines = lines.slice(2);

  for (const line of dataLines) {
    const cells = line.split('|').map((c) => c.trim()).filter((c) => c !== '');
    if (cells.length < 3) continue; // Need at least Group, Checkpoint, Trigger

    const group = cells[0] || '';
    const checkpoint = cells[1] || '';
    const trigger = cells[2] || '';
    const notes = cells[3] || '';

    // Try to extract status from notes (format: "status: passed")
    let status = 'pending'; // default
    const statusMatch = notes.match(/status:\s*(passed|failed|pending|skipped)/i);
    if (statusMatch) {
      status = statusMatch[1].toLowerCase();
    }

    checkpoints.push({
      group,
      checkpoint,
      trigger,
      notes,
      status,
    });
  }

  return checkpoints;
}

module.exports = {
  PLANNING_PRECEDENCE_CONTRACT_VERSION,
  PLANNING_STATES,
  PLANNING_SCOPES,
  PLANNING_SCOPE_PRECEDENCE,
  PLANNING_RECORD_PRECEDENCE_RULES,
  TERMINAL_PLANNING_STATES,
  PLANNING_TRANSITION_MATRIX,
  normalizePlanningState,
  normalizePlanningScope,
  getPlanningScopePrecedence,
  isValidPlanningTransition,
  comparePlanningRecords,
  parseStructuredState,
};
