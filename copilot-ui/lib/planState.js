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

const {
  deriveExecutionStateFinality,
  deriveSessionClosureSummary,
  deriveSessionIntentFrame,
  parseHandoffText,
  parsePropositionText,
  parseReviewLedgerFromPlan,
  parseVerificationGuideText,
} = require('./sessionArtifacts');

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
function parseStructuredState(text, options = {}) {
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
  let planText = text;
  let trackerText = '';
  if (!trackerMatch) {
    result.warnings.push('No "# Plan-Pack Progress Tracker" heading found; treating as v0/unstructured');
  } else {
    const trackerStart = trackerMatch.index + trackerMatch[0].length;
    planText = text.slice(0, trackerMatch.index);
    trackerText = text.slice(trackerStart);

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
  }

  const reviewLedger = parseReviewLedgerFromPlan(planText);
  result.meta.reviewLedger = reviewLedger;
  result.warnings.push(...reviewLedger.warnings.map((warning) => `Review Ledger: ${warning}`));

  if (typeof options.handoffText === 'string' && options.handoffText.trim()) {
    const handoff = parseHandoffText(options.handoffText, { sessionId: options.sessionId });
    result.meta.handoff = handoff;
    result.warnings.push(...handoff.warnings.map((warning) => `Handoff: ${warning}`));
  } else if (options.requireHandoff) {
    result.meta.handoff = null;
    result.warnings.push('Handoff: missing handoff artifact');
  }

  const resumeBlockers = [];
  if (!reviewLedger.approved) {
    resumeBlockers.push('review_approval_missing');
  }
  if (result.meta.handoff == null) {
    if (options.requireHandoff) {
      resumeBlockers.push('handoff_missing');
    }
  } else if (Array.isArray(result.meta.handoff.warnings) && result.meta.handoff.warnings.length > 0) {
    resumeBlockers.push('handoff_invalid');
  }
  result.meta.resume = {
    ready: resumeBlockers.length === 0,
    blockers: resumeBlockers,
  };

  const proposition = typeof options.propositionText === 'string' && options.propositionText.trim()
    ? parsePropositionText(options.propositionText)
    : null;
  const verificationGuide = typeof options.verificationGuideText === 'string' && options.verificationGuideText.trim()
    ? parseVerificationGuideText(options.verificationGuideText)
    : null;

  if (verificationGuide) {
    result.warnings.push(...verificationGuide.warnings.map((warning) => `Verification Guide: ${warning}`));
  }

  if (typeof options.executionStateText === 'string' && options.executionStateText.trim()) {
    const overlay = parseExecutionState(options.executionStateText);
    result.meta.executionOverlay = {
      present: true,
      applied: Boolean(overlay.executionState),
      warnings: overlay.warnings,
    };

    if (overlay.executionState) {
      result.meta.executionState = overlay.executionState;
      if (overlay.executionState.nextUnit) {
        result.nextUnit = overlay.executionState.nextUnit;
      } else if (deriveExecutionStateFinality(overlay.executionState).terminal) {
        result.nextUnit = null;
      }
      result.groups = mergeExecutionOverlayIntoGroups(result.groups, overlay.executionState);
      result.workUnits = mergeExecutionOverlayIntoWorkUnits(result.workUnits, overlay.executionState);
      const finalizedRows = finalizeTerminalExecutionRows(result.groups, result.workUnits, overlay.executionState);
      result.groups = finalizedRows.groups;
      result.workUnits = finalizedRows.workUnits;
    }

    result.warnings.push(...overlay.warnings.map((warning) => `Execution State: ${warning}`));
  }

  result.meta.intentFrame = deriveSessionIntentFrame({
    handoff: result.meta.handoff,
    proposition,
    verificationGuide,
    reviewLedger,
    nextUnit: result.nextUnit,
    checkpoints: result.checkpoints,
    resume: result.meta.resume,
  });

  result.meta.closureSummary = deriveSessionClosureSummary({
    handoff: result.meta.handoff,
    proposition,
    verificationGuide,
    reviewLedger,
    nextUnit: result.nextUnit,
    checkpoints: result.checkpoints,
    resume: result.meta.resume,
    intentFrame: result.meta.intentFrame,
    executionState: result.meta.executionState,
  });

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
 * Expected format: **WU-XXX** — <rationale>, **WU-XXX, WU-YYY** — <rationale>, or NONE — <reason>
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
   const nextUnitMatch = sectionText.match(/\*\*([A-Z]+-\d+(?:\s*,\s*[A-Z]+-\d+)*)\*\*\s*[\u2014\u2013\-]\s*([^\r\n]{1,500})/i);
  if (nextUnitMatch) {
    const workUnitIds = nextUnitMatch[1]
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    return {
      workUnitId: workUnitIds[0] || nextUnitMatch[1],
      workUnitIds,
      parallelCandidate: workUnitIds.length > 1,
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

function parseExecutionState(text) {
  const warnings = [];

  if (typeof text !== 'string' || !text.trim()) {
    return { executionState: null, warnings };
  }

  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    warnings.push('invalid execution-state.json JSON payload');
    return { executionState: null, warnings };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    warnings.push('execution-state.json must contain a JSON object');
    return { executionState: null, warnings };
  }

  const schemaVersion = normalizeExecutionSchemaVersion(parsed);
  if (schemaVersion && schemaVersion !== 'execution-state-v1') {
    warnings.push(`unsupported execution-state.json schemaVersion: ${schemaVersion}`);
    return { executionState: null, warnings };
  }

  const executionState = normalizeExecutionState(parsed, warnings);
  if (!executionState) {
    warnings.push('execution-state.json did not include any usable execution-state fields');
    return { executionState: null, warnings };
  }

  return { executionState, warnings };
}

function normalizeExecutionState(value, warnings) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const executionState = {
    schemaVersion: normalizeExecutionSchemaVersion(value),
    updatedAt: normalizeOptionalString(value.updatedAt) || normalizeOptionalString(value.timestamp),
    lifecycle: normalizeOptionalString(value.lifecycle),
    status: normalizeOptionalString(value.status),
    mode: normalizeOptionalString(value.mode),
    summary: normalizeOptionalString(value.summary),
    activeGroup: normalizeExecutionRef(value.activeGroup || value.currentGroup),
    activeWorkUnit: normalizeExecutionRef(value.activeWorkUnit || value.currentWorkUnit),
    lastCompletedUnit: normalizeExecutionRef(value.lastCompletedUnit),
    nextUnit: normalizeExecutionNextUnit(value.nextUnit || value.upcomingUnit),
    blockers: normalizeExecutionBlockers(value.blockers),
    replanCount: normalizeExecutionCount(value.replanCount),
    tree: normalizeExecutionTree(value.tree, warnings),
  };

  if (executionState.schemaVersion == null) {
    warnings.push('missing schemaVersion; treating overlay as compatibility mode');
  }

  const hasUsefulFields = [
    executionState.updatedAt,
    executionState.lifecycle,
    executionState.status,
    executionState.mode,
    executionState.summary,
    executionState.activeGroup,
    executionState.activeWorkUnit,
    executionState.lastCompletedUnit,
    executionState.nextUnit,
    executionState.blockers.length > 0 ? executionState.blockers : null,
    executionState.replanCount,
    executionState.tree.length > 0 ? executionState.tree : null,
  ].some((entry) => entry != null && entry !== '');

  return hasUsefulFields ? executionState : null;
}

function normalizeExecutionSchemaVersion(value) {
  const normalized = normalizeOptionalString(
    value.schemaVersion
    || value.version
    || value.contractVersion
  );

  if (!normalized) {
    return null;
  }

  if (/^execution-state-v?1$/i.test(normalized)) {
    return 'execution-state-v1';
  }

  if (normalized === '1') {
    return 'execution-state-v1';
  }

  return normalized;
}

function normalizeOptionalString(value) {
  return typeof value === 'string' && value.trim()
    ? value.trim()
    : null;
}

function normalizeExecutionCount(value) {
  if (value == null || value === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeExecutionRef(value) {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    return {
      id: trimmed,
      label: trimmed,
      status: null,
      summary: null,
    };
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const id = normalizeOptionalString(
    value.id
    || value.group
    || value.groupId
    || value.workUnitId
    || value.unitId
    || value.nodeId
  );
  const label = normalizeOptionalString(
    value.label
    || value.title
    || value.name
    || id
  );
  const status = normalizeOptionalString(value.status || value.state);
  const summary = normalizeOptionalString(value.summary || value.notes || value.rationale);

  if (!id && !label) {
    return null;
  }

  return {
    id: id || label,
    label: label || id,
    status,
    summary,
  };
}

function normalizeExecutionNextUnit(value) {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    const workUnitId = value.trim();
    return workUnitId
      ? { workUnitId, rationale: null }
      : null;
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const workUnitIds = Array.isArray(value.workUnitIds)
    ? value.workUnitIds.filter((entry) => typeof entry === 'string' && entry.trim()).map((entry) => entry.trim())
    : [];
  const workUnitId = normalizeOptionalString(
    value.workUnitId
    || value.id
    || value.unitId
    || workUnitIds[0]
  );

  if (!workUnitId && workUnitIds.length === 0) {
    return null;
  }

  return {
    workUnitId: workUnitId || workUnitIds[0],
    workUnitIds,
    parallelCandidate: typeof value.parallelCandidate === 'boolean'
      ? value.parallelCandidate
      : workUnitIds.length > 1,
    rationale: normalizeOptionalString(value.rationale || value.summary || value.notes),
  };
}

function normalizeExecutionBlockers(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (typeof entry === 'string' && entry.trim()) {
        return {
          label: entry.trim(),
          details: null,
          severity: null,
        };
      }

      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return null;
      }

      const label = normalizeOptionalString(
        entry.label
        || entry.title
        || entry.blocker
        || entry.message
        || entry.reason
      );
      if (!label) {
        return null;
      }

      return {
        label,
        details: normalizeOptionalString(entry.details || entry.summary || entry.context),
        severity: normalizeOptionalString(entry.severity || entry.status),
      };
    })
    .filter(Boolean);
}

function normalizeExecutionTree(value, warnings) {
  if (!Array.isArray(value)) {
    return [];
  }

  const nodes = value
    .map((entry) => normalizeExecutionTreeNode(entry, warnings))
    .filter(Boolean);

  return nodes;
}

function normalizeExecutionTreeNode(value, warnings) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const id = normalizeOptionalString(
    value.id
    || value.nodeId
    || value.groupId
    || value.workUnitId
    || value.unitId
  );
  const label = normalizeOptionalString(value.label || value.title || value.name || id);

  if (!id && !label) {
    warnings.push('skipped execution tree node without an id or label');
    return null;
  }

  const children = Array.isArray(value.children)
    ? value.children
      .map((entry) => normalizeExecutionTreeNode(entry, warnings))
      .filter(Boolean)
    : [];

  const kind = normalizeOptionalString(value.kind || value.type) || inferExecutionNodeKind(id);

  return {
    id: id || label,
    kind,
    label: label || id,
    status: normalizeOptionalString(value.status || value.state),
    summary: normalizeOptionalString(value.summary || value.notes || value.rationale),
    active: Boolean(value.active || value.current),
    current: Boolean(value.current),
    next: Boolean(value.next),
    blocked: Boolean(value.blocked),
    children,
  };
}

function inferExecutionNodeKind(id) {
  const value = normalizeOptionalString(id);
  if (!value) {
    return 'node';
  }
  if (/^WU-/i.test(value)) {
    return 'work-unit';
  }
  if (/^G-/i.test(value)) {
    return 'group';
  }
  return 'node';
}

function collectExecutionTreeNodes(nodes, predicate, result = []) {
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (node && predicate(node)) {
      result.push(node);
    }
    if (Array.isArray(node?.children) && node.children.length > 0) {
      collectExecutionTreeNodes(node.children, predicate, result);
    }
  }
  return result;
}

function collectExecutionTreeWorkUnits(nodes, activeGroupId = null, result = []) {
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (!node) {
      continue;
    }

    if (node.kind === 'work-unit') {
      result.push({
        groupId: activeGroupId,
        node,
      });
    }

    const nextGroupId = node.kind === 'group'
      ? node.id
      : activeGroupId;
    if (Array.isArray(node.children) && node.children.length > 0) {
      collectExecutionTreeWorkUnits(node.children, nextGroupId, result);
    }
  }
  return result;
}

function isExecutionNodeDoneStatus(status) {
  return typeof status === 'string' && /^(done|completed|implemented|passed|resolved)$/i.test(status);
}

function createRuntimeOnlyGroup(groupNode, executionState) {
  const childWorkUnits = collectExecutionTreeNodes(
    groupNode.children,
    (node) => node.kind === 'work-unit'
  );
  const runtimeStatus = groupNode.status
    || (executionState.activeGroup?.id === groupNode.id ? executionState.activeGroup?.status : null)
    || null;

  return {
    group: groupNode.id,
    title: groupNode.label || groupNode.id,
    status: runtimeStatus || 'unknown',
    planStatus: null,
    runtimeStatus,
    active: executionState.activeGroup?.id === groupNode.id || Boolean(groupNode.active || groupNode.current),
    blocked: Boolean(groupNode.blocked),
    runtimeSummary: groupNode.summary
      || (executionState.activeGroup?.id === groupNode.id ? executionState.activeGroup?.summary : null)
      || null,
    wusDone: childWorkUnits.filter((node) => isExecutionNodeDoneStatus(node.status)).length,
    wusTotal: childWorkUnits.length,
    dependsOn: null,
  };
}

function createRuntimeOnlyWorkUnit(workUnitNode, groupId, executionState) {
  const isActive = executionState.activeWorkUnit?.id === workUnitNode.id || Boolean(workUnitNode.active || workUnitNode.current);
  const nextWorkUnitIds = Array.isArray(executionState.nextUnit?.workUnitIds) && executionState.nextUnit.workUnitIds.length > 0
    ? executionState.nextUnit.workUnitIds
    : (executionState.nextUnit?.workUnitId ? [executionState.nextUnit.workUnitId] : []);
  const isNext = nextWorkUnitIds.includes(workUnitNode.id) || Boolean(workUnitNode.next);
  const runtimeStatus = workUnitNode.status
    || (isActive ? executionState.activeWorkUnit?.status : null)
    || (isNext ? 'queued' : null)
    || null;

  return {
    group: groupId || executionState.activeGroup?.id || null,
    workUnitId: workUnitNode.id,
    status: runtimeStatus || 'unknown',
    planStatus: null,
    runtimeStatus,
    active: isActive,
    next: isNext,
    blocked: Boolean(workUnitNode.blocked),
    runtimeSummary: workUnitNode.summary
      || (isActive ? executionState.activeWorkUnit?.summary : null)
      || (isNext ? executionState.nextUnit?.rationale : null)
      || null,
    nextUnit: null,
    notes: '',
  };
}

function shouldFinalizeTerminalExecutionRows(executionState) {
  const finality = deriveExecutionStateFinality(executionState);
  if (!finality.terminal) {
    return false;
  }

  return (
    !executionState?.activeGroup?.id
    && !executionState?.activeWorkUnit?.id
    && (!Array.isArray(executionState?.tree) || executionState.tree.length === 0)
  );
}

function finalizeTerminalGroupStatus(group, executionState) {
  const currentStatus = normalizeOptionalString(group.runtimeStatus || group.status);
  if (!currentStatus || !/^(queued|in-progress|active|blocked)$/i.test(currentStatus)) {
    return group;
  }

  const finality = deriveExecutionStateFinality(executionState);
  const terminalStatus = finality.disposition === 'unsuccessful'
    ? 'failed'
    : 'implemented';

  return {
    ...group,
    planStatus: group.planStatus || group.status,
    status: terminalStatus,
    runtimeStatus: terminalStatus,
    active: false,
    blocked: false,
    runtimeSummary: group.runtimeSummary || executionState.summary || null,
  };
}

function finalizeTerminalWorkUnitStatus(workUnit, executionState) {
  const currentStatus = normalizeOptionalString(workUnit.runtimeStatus || workUnit.status);
  const liveState = Boolean(workUnit.active || workUnit.next) || Boolean(currentStatus && /^(queued|in-progress|active|blocked)$/i.test(currentStatus));
  if (!liveState) {
    return workUnit;
  }

  const finality = deriveExecutionStateFinality(executionState);
  const terminalStatus = finality.disposition === 'unsuccessful'
    ? 'failed'
    : 'done';

  return {
    ...workUnit,
    planStatus: workUnit.planStatus || workUnit.status,
    status: terminalStatus,
    runtimeStatus: terminalStatus,
    active: false,
    next: false,
    blocked: false,
    runtimeSummary: workUnit.runtimeSummary || executionState.summary || null,
    nextUnit: null,
  };
}

function finalizeTerminalExecutionRows(groups, workUnits, executionState) {
  if (!shouldFinalizeTerminalExecutionRows(executionState)) {
    return {
      groups,
      workUnits,
    };
  }

  return {
    groups: Array.isArray(groups)
      ? groups.map((group) => finalizeTerminalGroupStatus(group, executionState))
      : groups,
    workUnits: Array.isArray(workUnits)
      ? workUnits.map((workUnit) => finalizeTerminalWorkUnitStatus(workUnit, executionState))
      : workUnits,
  };
}

function mergeExecutionOverlayIntoGroups(groups, executionState) {
  if (!Array.isArray(groups) || !executionState) {
    return groups;
  }

  const groupNodes = collectExecutionTreeNodes(
    executionState.tree,
    (node) => node.kind === 'group'
  );
  const groupById = new Map(groupNodes.map((node) => [node.id, node]));
  const activeGroupId = executionState.activeGroup?.id || null;
  const knownGroupIds = new Set(groups.map((group) => group.group));

  const mergedGroups = groups.map((group) => {
    const overlayNode = groupById.get(group.group) || null;
    const overlayRef = activeGroupId === group.group
      ? executionState.activeGroup
      : null;
    if (!overlayNode && activeGroupId !== group.group) {
      return group;
    }

    return {
      ...group,
      planStatus: group.status,
      status: overlayNode?.status || overlayRef?.status || group.status,
      runtimeStatus: overlayNode?.status || overlayRef?.status || null,
      active: activeGroupId === group.group || Boolean(overlayNode?.active || overlayNode?.current),
      blocked: Boolean(overlayNode?.blocked),
      runtimeSummary: overlayNode?.summary || overlayRef?.summary || null,
    };
  });

  for (const groupNode of groupNodes) {
    if (!knownGroupIds.has(groupNode.id)) {
      mergedGroups.push(createRuntimeOnlyGroup(groupNode, executionState));
      knownGroupIds.add(groupNode.id);
    }
  }

  if (activeGroupId && !knownGroupIds.has(activeGroupId)) {
    mergedGroups.push({
      group: activeGroupId,
      title: executionState.activeGroup?.label || activeGroupId,
      status: executionState.activeGroup?.status || 'unknown',
      planStatus: null,
      runtimeStatus: executionState.activeGroup?.status || null,
      active: true,
      blocked: false,
      runtimeSummary: executionState.activeGroup?.summary || null,
      wusDone: 0,
      wusTotal: 0,
      dependsOn: null,
    });
  }

  return mergedGroups;
}

function mergeExecutionOverlayIntoWorkUnits(workUnits, executionState) {
  if (!Array.isArray(workUnits) || !executionState) {
    return workUnits;
  }

  const workUnitNodes = collectExecutionTreeWorkUnits(executionState.tree);
  const workUnitById = new Map(workUnitNodes.map((entry) => [entry.node.id, entry]));
  const activeWorkUnitId = executionState.activeWorkUnit?.id || null;
  const nextWorkUnitIds = Array.isArray(executionState.nextUnit?.workUnitIds) && executionState.nextUnit.workUnitIds.length > 0
    ? executionState.nextUnit.workUnitIds
    : (executionState.nextUnit?.workUnitId ? [executionState.nextUnit.workUnitId] : []);
  const knownWorkUnitIds = new Set(workUnits.map((workUnit) => workUnit.workUnitId));

  const mergedWorkUnits = workUnits.map((workUnit) => {
    const overlayEntry = workUnitById.get(workUnit.workUnitId) || null;
    const overlayNode = overlayEntry?.node || null;
    const isActive = activeWorkUnitId === workUnit.workUnitId || Boolean(overlayNode?.active || overlayNode?.current);
    const isNext = nextWorkUnitIds.includes(workUnit.workUnitId) || Boolean(overlayNode?.next);
    const activeWorkUnitRef = activeWorkUnitId === workUnit.workUnitId
      ? executionState.activeWorkUnit
      : null;
    const runtimeStatus = overlayNode?.status
      || (isActive ? activeWorkUnitRef?.status : null)
      || (isNext ? 'queued' : null)
      || null;
    const runtimeSummary = overlayNode?.summary
      || (isActive ? activeWorkUnitRef?.summary : null)
      || (isNext ? executionState.nextUnit?.rationale : null)
      || null;
    if (!overlayNode && !isActive && !isNext) {
      return workUnit;
    }

    return {
      ...workUnit,
      group: workUnit.group || overlayEntry?.groupId || workUnit.group,
      planStatus: workUnit.status,
      status: runtimeStatus || workUnit.status,
      runtimeStatus,
      active: isActive,
      next: isNext,
      blocked: Boolean(overlayNode?.blocked),
      runtimeSummary,
    };
  });

  for (const overlayEntry of workUnitNodes) {
    if (!knownWorkUnitIds.has(overlayEntry.node.id)) {
      mergedWorkUnits.push(createRuntimeOnlyWorkUnit(overlayEntry.node, overlayEntry.groupId, executionState));
      knownWorkUnitIds.add(overlayEntry.node.id);
    }
  }

  if (activeWorkUnitId && !knownWorkUnitIds.has(activeWorkUnitId)) {
    mergedWorkUnits.push({
      group: executionState.activeGroup?.id || null,
      workUnitId: activeWorkUnitId,
      status: executionState.activeWorkUnit?.status || 'unknown',
      planStatus: null,
      runtimeStatus: executionState.activeWorkUnit?.status || null,
      active: true,
      next: nextWorkUnitIds.includes(activeWorkUnitId),
      blocked: false,
      runtimeSummary: executionState.activeWorkUnit?.summary || null,
      nextUnit: null,
      notes: '',
    });
    knownWorkUnitIds.add(activeWorkUnitId);
  }

  for (const nextWorkUnitId of nextWorkUnitIds) {
    if (!knownWorkUnitIds.has(nextWorkUnitId)) {
      mergedWorkUnits.push({
        group: executionState.activeGroup?.id || null,
        workUnitId: nextWorkUnitId,
        status: 'queued',
        planStatus: null,
        runtimeStatus: null,
        active: false,
        next: true,
        blocked: false,
        runtimeSummary: executionState.nextUnit?.rationale || null,
        nextUnit: null,
        notes: '',
      });
      knownWorkUnitIds.add(nextWorkUnitId);
    }
  }

  return mergedWorkUnits;
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
  parseExecutionState,
  parseStructuredState,
};
