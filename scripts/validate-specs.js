#!/usr/bin/env node
/**
 * Spec-System Hardening — Core Validator (Layer 1 of 4)
 * ======================================================
 * This is the structural and semantic validator for durable repo specs.
 * It is the primary reliability gate in the spec-driven development system.
 * 
 * RELIABILITY LAYERS:
 *   Layer 1 (this file): Structural checks — frontmatter, headings, AC bullets,
 *     verify lines, vague language. Strict mode adds liveness, index integrity,
 *     cross-spec references, freshness warnings, and plan.md checks.
 *   Layer 2: scripts/validate-specs-precommit.mjs — pre-commit gate
 *   Layer 3: .github/workflows/repo-ci.yml — CI gate
 *   Layer 4: catalog-assets/shared-skills/spec-review/SKILL.md + reviewer agent
 * 
 * INVOKED BY:
 *   - Spec lane agent (Phase 2.2, 3.3, 4.2)
 *   - spec-authoring skill (readiness checklist)
 *   - CI (repo-ci.yml)
 *   - Pre-commit hook (validate-specs-precommit.mjs)
 * 
 * MODES:
 *   node scripts/validate-specs.js specs/          — structural checks only
 *   node scripts/validate-specs.js --strict specs/ — structural + liveness + R3/R4/R5/R7
 *   node scripts/validate-specs.js --json specs/   — machine-readable output
 * 
 * HARDENING VERSION: spec-system-hardening (2026-06-08)
 *   Added: R3 (index drift), R4 (cross-spec integrity), R5 (freshness),
 *          R7 (plan.md requirement), R11 (liveness_skip_paths)
 *   Refactored: shared libs extracted to scripts/lib/
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { AC_VAGUE_TOKEN_RE } = require('./lib/ac-vague-tokens');
const { parseInlineList, parseFrontmatterYaml } = require('./lib/spec-yaml.js');
const { collectSpecFiles } = require('./lib/spec-collector.js');
const { matchFrontmatter, extractH2Sections } = require('./lib/spec-headings.js');
const { looksLikeFilePath, KNOWN_SOURCE_DIRS } = require('./lib/spec-path-heuristics.js');

/**
 * Simple glob pattern matching (minimatch not available in this repo).
 * Supports:
 *   - `*`  — matches any characters (including path separators)
 *   - `**` — matches any characters (including path separators)
 *   - `?`  — matches any single character
 * All other characters are matched literally.
 *
 * @param {string} pattern — glob pattern (e.g. "C:\\Users\\*\\...")
 * @param {string} str     — the string to test (e.g. "C:\\Users\\lolzi\\.copilot\\elegy-planning.db")
 * @returns {boolean}
 */
function simpleGlobMatch(pattern, str) {
  // Escape regex-special characters, then convert glob wildcards
  let regexStr = '';
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === '*' && pattern[i + 1] === '*') {
      regexStr += '.*';
      i += 2;
    } else if (ch === '*') {
      regexStr += '.*';
      i += 1;
    } else if (ch === '?') {
      regexStr += '.';
      i += 1;
    } else if (/[.+^${}()|[\]\\]/.test(ch)) {
      regexStr += '\\' + ch;
      i += 1;
    } else {
      regexStr += ch;
      i += 1;
    }
  }
  // Start-anchored only — allows trailing characters to match
  // e.g. pattern "C:\\Users\\*\\" matches "C:\\Users\\lolzi\\.copilot\\file.db"
  // because .* backtracks to let the trailing \\ match the first \ after the username
  const re = new RegExp('^' + regexStr);
  return re.test(str);
}

/**
 * Extract liveness_skip_paths array from parsed frontmatter.
 *
 * @param {Object} meta — parsed frontmatter object
 * @returns {string[]} array of skip patterns (empty if none)
 */
function parseSkipPaths(meta) {
  if (!meta || !meta.liveness_skip_paths) return [];
  const raw = meta.liveness_skip_paths;
  if (Array.isArray(raw)) return raw.filter(Boolean).map(String);
  return [String(raw).trim()].filter(Boolean);
}

const VALID_STATUS = new Set(['draft', 'approved', 'implemented', 'superseded']);
const VALID_TYPES = new Set(['feature', 'workflow', 'contract', 'skill', 'agent', 'migration']);
const REQUIRED_FRONTMATTER_KEYS = ['spec_id', 'title', 'status', 'type', 'updated'];
const OPTIONAL_DATE_KEYS = ['created', 'approved_at', 'implemented_at', 'superseded_at'];
const REQUIRED_HEADINGS = [
  'Intent',
  'Context Evidence',
  'Requirements',
  'Non-Goals',
  'Acceptance Checks',
  'Implementation Links',
  'Validation Evidence',
  'Drift Notes',
];

function toPosix(filePath) {
  return String(filePath || '').replace(/\\/g, '/');
}

function toDisplayPath(filePath) {
  return toPosix(path.relative(process.cwd(), filePath) || path.basename(filePath));
}

function parseArgs(argv) {
  const options = {
    require: false,
    strict: false,
    json: false,
    targetPath: path.join(process.cwd(), 'specs'),
  };

  let explicitPath = '';

  for (let index = 0; index < argv.length; index += 1) {
    const value = String(argv[index] || '');
    if (value === '--require') {
      options.require = true;
      continue;
    }
    if (value === '--strict') {
      options.strict = true;
      continue;
    }
    if (value === '--json') {
      options.json = true;
      continue;
    }

    if (value.startsWith('--')) {
      throw new Error(`Unknown arg: ${value} (supported: --require --strict --json [path])`);
    }

    if (explicitPath) {
      throw new Error(`Unexpected extra path argument: ${value}`);
    }

    explicitPath = value;
  }

  if (explicitPath) {
    options.targetPath = path.resolve(explicitPath);
  }

  return options;
}

function countBulletItems(sectionText) {
  return String(sectionText || '')
    .split(/\r?\n/)
    .filter((line) => /^\s*[-*]\s+\S/.test(line)).length;
}

function parseAcceptanceChecksWithVerify(sectionText) {
  const lines = String(sectionText || '').split(/\r?\n/);
  const checks = [];
  let currentCheck = null;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const bulletMatch = line.match(/^\s*[-*]\s+(\S.*)/);

    if (bulletMatch) {
      if (currentCheck) {
        checks.push(currentCheck);
      }
      currentCheck = {
        bulletLineNumber: index + 1,
        bulletText: bulletMatch[1].trim(),
        verifyLines: [],
      };
      continue;
    }

    if (currentCheck) {
      const verifyMatch = line.match(/^\s+→\s*verify:\s*(.*)/i);
      if (verifyMatch) {
        currentCheck.verifyLines.push({
          lineNumber: index + 1,
          content: verifyMatch[1].trim(),
        });
        continue;
      }

      if (line.trim() === '') {
        checks.push(currentCheck);
        currentCheck = null;
        continue;
      }

      if (/^\s*#/.test(line)) {
        checks.push(currentCheck);
        currentCheck = null;
        continue;
      }
    }
  }

  if (currentCheck) {
    checks.push(currentCheck);
  }

  return checks;
}

function hasMeaningfulContent(sectionText) {
  const normalized = String(sectionText || '')
    .replace(/^\s*[-*]\s*/gm, '')
    .replace(/`[^`]*`/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) {
    return false;
  }

  return !/^(?:none|n\/a|na|todo|tbd|pending|not yet|placeholder|none yet|fill me in)\.?$/i.test(normalized);
}

function validateAcceptanceChecksQuality(sectionText) {
  const errors = [];
  const checks = parseAcceptanceChecksWithVerify(sectionText);

  for (const check of checks) {
    if (check.verifyLines.length === 0) {
      errors.push(
        `Acceptance check at line ${check.bulletLineNumber} lacks a verification method (→ verify: ...)`
      );
    }

    for (const verifyLine of check.verifyLines) {
      if (!verifyLine.content) {
        errors.push(
          `Acceptance check verify line at line ${verifyLine.lineNumber} has empty content`
        );
      }
    }

    const vagueTokenRE = new RegExp(AC_VAGUE_TOKEN_RE.source, 'gi');
    let vagueMatch;
    while ((vagueMatch = vagueTokenRE.exec(check.bulletText)) !== null) {
      errors.push(
        `Acceptance check at line ${check.bulletLineNumber} contains vague language: '${vagueMatch[1]}'`
      );
    }
  }

  return errors;
}

function normalizePathRef(p) {
  // Strip line/column annotations like :42 or :42-47
  return p.replace(/:\d+(-\d+)?$/, '').trim();
}

function checkLiveness(meta, sections, specFilePath) {
  const errors = [];
  const repoRoot = process.cwd();
  const skipPatterns = parseSkipPaths(meta);

  for (const heading of ['Context Evidence', 'Implementation Links']) {
    const text = sections.get(heading) || '';
    const pathMatches = text.match(/`([^`]+)`/g) || [];
    for (const raw of pathMatches) {
      const p = raw.replace(/^`|`$/g, '').trim();
      if (!p || !looksLikeFilePath(p)) continue;

      // Check liveness_skip_paths before doing existence check
      if (skipPatterns.length > 0) {
        let matched = false;
        for (const pattern of skipPatterns) {
          if (simpleGlobMatch(pattern, p)) {
            matched = true;
            break;
          }
        }
        if (matched) continue;
      }

      const normalized = normalizePathRef(p);
      if (!normalized) continue;
      const resolved = path.resolve(repoRoot, normalized);
      if (!fs.existsSync(resolved)) {
        errors.push(`${heading}: referenced path '${p}' not found`);
      }
    }
  }

  const acText = sections.get('Acceptance Checks') || '';
  const verifyRe = /→\s*verify:\s*`?\s*node\s+(scripts\/[^\s`]+)/gi;
  let m;
  while ((m = verifyRe.exec(acText)) !== null) {
    const scriptPath = m[1].trim().replace(/`+$/, '');
    if (!scriptPath) continue;
    const resolved = path.resolve(repoRoot, scriptPath);
    if (!fs.existsSync(resolved)) {
      errors.push(`Acceptance Checks: verify script '${scriptPath}' not found`);
    }
  }

  return errors;
}

/**
 * Build a Map of spec_id → filepath from all spec files (R4 preliminary pass).
 * @param {string[]} specFiles — array of absolute file paths
 * @returns {Map<string, string>}
 */
function buildSpecIdMap(specFiles) {
  const map = new Map();
  for (const filePath of specFiles) {
    const content = fs.readFileSync(filePath, 'utf8');
    const frontmatter = matchFrontmatter(content);
    if (!frontmatter) continue;
    try {
      const meta = parseFrontmatterYaml(frontmatter.yaml);
      if (meta.spec_id) {
        map.set(String(meta.spec_id).trim(), filePath);
      }
    } catch (e) {
      // Skip files with unparseable frontmatter
    }
  }
  return map;
}

/**
 * Check cross-spec integrity for a single spec (R4).
 * Verifies supersedes/superseded_by references, detects circular chains,
 * and validates bidirectionality.
 *
 * @param {Object} meta — parsed frontmatter
 * @param {string} filePath — absolute path of current spec
 * @param {Map<string, string>} specIdMap — spec_id → filepath map for ALL specs
 * @returns {string[]} error messages
 */
function checkCrossSpecReferences(meta, filePath, specIdMap) {
  const errors = [];
  const specId = String(meta.spec_id || '').trim();
  if (!specId) return errors;

  // Normalize supersedes to array
  const supersedes = meta.supersedes;
  let supersedesArr = [];
  if (supersedes) {
    supersedesArr = Array.isArray(supersedes) ? supersedes : [String(supersedes).trim()];
    supersedesArr = supersedesArr.filter(Boolean);
  }

  // Normalize superseded_by to array
  const supersededBy = meta.superseded_by;
  let supersededByArr = [];
  if (supersededBy) {
    supersededByArr = Array.isArray(supersededBy) ? supersededBy : [String(supersededBy).trim()];
    supersededByArr = supersededByArr.filter(Boolean);
  }

  // 2a. Check supersedes references exist
  for (const refId of supersedesArr) {
    if (refId && !specIdMap.has(refId)) {
      errors.push(`cross-spec: supersedes references unknown spec_id '${refId}'`);
    }
  }

  // 2b. Check superseded_by references exist
  for (const refId of supersededByArr) {
    if (refId && !specIdMap.has(refId)) {
      errors.push(`cross-spec: superseded_by references unknown spec_id '${refId}'`);
    }
  }

  // 2c. Circular chain detection
  // For each supersedes reference, walk the chain following first-element
  // supersedes. If any spec_id appears twice, report the cycle.
  for (const refId of supersedesArr) {
    if (!refId || !specIdMap.has(refId)) continue;
    const visited = [specId];
    let current = refId;

    while (current && specIdMap.has(current)) {
      if (visited.includes(current)) {
        visited.push(current);
        errors.push(`cross-spec: circular supersedes chain: ${visited.join(' -> ')}`);
        break;
      }
      visited.push(current);

      // Read the current spec's supersedes
      const currentContent = fs.readFileSync(specIdMap.get(current), 'utf8');
      const currentFm = matchFrontmatter(currentContent);
      if (!currentFm) break;

      let currentMeta;
      try { currentMeta = parseFrontmatterYaml(currentFm.yaml); } catch (e) { break; }

      const currentSupersedes = currentMeta.supersedes;
      if (!currentSupersedes) break;

      const currentArr = Array.isArray(currentSupersedes)
        ? currentSupersedes
        : [String(currentSupersedes).trim()];
      const validRefs = currentArr.filter(r => r && specIdMap.has(r));
      if (validRefs.length === 0) break;

      current = validRefs[0]; // follow first valid ref
    }
  }

  // 2d. Bidirectional check — A.supersedes(B) => B.superseded_by must be A
  for (const refId of supersedesArr) {
    if (!refId || !specIdMap.has(refId)) continue;
    const refContent = fs.readFileSync(specIdMap.get(refId), 'utf8');
    const refFm = matchFrontmatter(refContent);
    if (!refFm) continue;

    let refMeta;
    try { refMeta = parseFrontmatterYaml(refFm.yaml); } catch (e) { continue; }

    const refSupersededBy = refMeta.superseded_by;
    let refSupersededByArr = [];
    if (refSupersededBy) {
      refSupersededByArr = Array.isArray(refSupersededBy)
        ? refSupersededBy
        : [String(refSupersededBy).trim()];
    }
    if (!refSupersededByArr.includes(specId)) {
      errors.push(`cross-spec: supersedes '${refId}' but '${refId}' does not have superseded_by back-reference`);
    }
  }

  // 2d reverse — B.superseded_by(A) => A.supersedes must contain B
  for (const refId of supersededByArr) {
    if (!refId || !specIdMap.has(refId)) continue;
    const refContent = fs.readFileSync(specIdMap.get(refId), 'utf8');
    const refFm = matchFrontmatter(refContent);
    if (!refFm) continue;

    let refMeta;
    try { refMeta = parseFrontmatterYaml(refFm.yaml); } catch (e) { continue; }

    const refSupersedes = refMeta.supersedes;
    let refSupersedesArr = [];
    if (refSupersedes) {
      refSupersedesArr = Array.isArray(refSupersedes)
        ? refSupersedes
        : [String(refSupersedes).trim()];
    }
    if (!refSupersedesArr.includes(specId)) {
      errors.push(`cross-spec: superseded_by references '${refId}' but '${refId}' does not have supersedes back-reference`);
    }
  }

  return errors;
}

/**
 * Check freshness (staleness) of a spec (R5).
 * Draft specs older than 90 days and implemented specs older than 180 days
 * generate [WARN] messages. Opt out via freshness:ignore in frontmatter.
 *
 * @param {Object} meta — parsed frontmatter
 * @returns {string[]} warning messages (never errors)
 */
function checkFreshness(meta) {
  const warnings = [];
  if (meta.freshness === 'ignore') return warnings;

  const status = String(meta.status || '').trim();
  const updated = String(meta.updated || '').trim();
  if (!updated || !/^\d{4}-\d{2}-\d{2}$/.test(updated)) return warnings;

  const updatedDate = new Date(updated + 'T00:00:00Z');
  const now = new Date();
  const daysSince = Math.floor((now - updatedDate) / (1000 * 60 * 60 * 24));

  if (status === 'draft' && daysSince > 90) {
    warnings.push(`[WARN] stale draft (${daysSince} days since last update, consider promoting or superseding)`);
  }
  if (status === 'implemented' && daysSince > 180) {
    warnings.push(`[WARN] stale implemented spec (${daysSince} days, consider reviewing for drift)`);
  }

  return warnings;
}

/**
 * Check if a complex spec (≥5 requirements, draft/approved) has a plan.md (R7).
 *
 * @param {Object} meta — parsed frontmatter
 * @param {Map<string, string>} sections — extracted H2 sections
 * @param {string} filePath — absolute path of the spec file
 * @returns {string[]} warning messages (never errors)
 */
function checkPlanMd(meta, sections, filePath) {
  const warnings = [];
  const status = String(meta.status || '').trim();
  if (status !== 'draft' && status !== 'approved') return warnings;

  const requirements = sections.get('Requirements') || '';
  const reqCount = countBulletItems(requirements);
  if (reqCount >= 5) {
    const specDir = path.dirname(filePath);
    const planMdPath = path.join(specDir, 'plan.md');
    if (!fs.existsSync(planMdPath)) {
      warnings.push(`[WARN] complex spec without plan.md (${reqCount} requirements)`);
    }
  }
  return warnings;
}

/**
 * Check index integrity (R3) — compare index.md entries against actual spec files.
 * Scans for drift in both directions: index entries without files and files without index entries.
 *
 * @param {string} specsDir — absolute path to specs root directory
 * @param {string[]} specFiles — absolute paths of all spec files found on disk
 * @returns {Array<{ file: string|null, message: string }>} error descriptors
 */
function checkIndexIntegrity(specsDir, specFiles) {
  const errors = [];
  const indexFile = path.join(specsDir, 'index.md');

  if (!fs.existsSync(indexFile)) {
    errors.push({ file: null, message: 'index drift: specs/index.md not found' });
    return errors;
  }

  const content = fs.readFileSync(indexFile, 'utf8');
  const lines = content.split(/\r?\n/);

  // Collect markdown table rows
  const tableRows = [];
  let inTable = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('|')) {
      inTable = true;
      tableRows.push(trimmed);
    } else if (inTable) {
      break; // end of table
    }
  }

  if (tableRows.length < 3) {
    errors.push({ file: null, message: 'index drift: could not parse index.md table format — manual review needed' });
    return errors;
  }

  // Skip header (row 0), separator (row 1), and auto-generated comment rows
  const dataRows = tableRows.filter((row, i) => {
    if (i === 0) return false;
    if (i === 1) return false;
    if (row.includes('<!--') || row.includes('-->')) return false;
    return true;
  });

  // Extract listed spec paths from first column
  const listedPaths = new Set();
  for (const row of dataRows) {
    const cols = row.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
    if (cols.length === 0) continue;
    const firstCol = cols[0];
    const linkMatch = firstCol.match(/\[([^\]]*)\]\(([^)]+)\)/);
    if (linkMatch) {
      listedPaths.add(linkMatch[2].trim());
    } else {
      errors.push({ file: null, message: 'index drift: could not parse index.md table format — manual review needed' });
      return errors;
    }
  }

  // Build set of actual spec paths relative to specsDir
  const actualPaths = new Set(
    specFiles.map(f => toPosix(path.relative(specsDir, f)))
  );

  // Index entries without real files
  for (const listedPath of listedPaths) {
    if (!actualPaths.has(listedPath)) {
      errors.push({ file: null, message: `index drift: index lists '${listedPath}' but file not found` });
    }
  }

  // Real files without index entries
  for (const actualPath of actualPaths) {
    if (!listedPaths.has(actualPath)) {
      errors.push({ file: actualPath, message: `index drift: spec file '${actualPath}' not listed in index` });
    }
  }

  return errors;
}

function validateSpecFile(filePath, options, specIdMap) {
  const errors = [];
  const warnings = [];
  const content = fs.readFileSync(filePath, 'utf8');
  const frontmatter = matchFrontmatter(content);

  if (!frontmatter) {
    return {
      filePath,
      errors: ['missing YAML frontmatter'],
      warnings,
    };
  }

  let meta;
  try {
    meta = parseFrontmatterYaml(frontmatter.yaml);
  } catch (error) {
    return {
      filePath,
      errors: [`frontmatter parse error: ${error.message}`],
      warnings,
    };
  }

  for (const key of REQUIRED_FRONTMATTER_KEYS) {
    if (!String(meta[key] || '').trim()) {
      errors.push(`missing required frontmatter key '${key}'`);
    }
  }

  const status = String(meta.status || '').trim();
  if (status && !VALID_STATUS.has(status)) {
    errors.push(`invalid status '${status}' (expected: ${Array.from(VALID_STATUS).join(', ')})`);
  }

  const type = String(meta.type || '').trim();
  if (type && !VALID_TYPES.has(type)) {
    errors.push(`invalid type '${type}' (expected: ${Array.from(VALID_TYPES).join(', ')})`);
  }

  const updated = String(meta.updated || '').trim();
  if (updated && !/^\d{4}-\d{2}-\d{2}$/.test(updated)) {
    errors.push(`invalid updated '${updated}' (expected YYYY-MM-DD)`);
  }

  for (const key of OPTIONAL_DATE_KEYS) {
    const value = String(meta[key] || '').trim();
    if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      errors.push(`invalid '${key}' '${value}' (expected YYYY-MM-DD)`);
    }
  }

  const supersedes = String(meta.supersedes || '').trim();
  const supersededBy = String(meta.superseded_by || '').trim();

  if (supersedes && supersededBy) {
    errors.push(`contradiction: both 'supersedes' and 'superseded_by' are set`);
  }

  if (status === 'superseded' && !supersededBy) {
    errors.push(`status is 'superseded' but 'superseded_by' is missing or empty`);
  }

  const body = content.slice(frontmatter.full.length);
  const sections = extractH2Sections(body);

  for (const heading of REQUIRED_HEADINGS) {
    if (!sections.has(heading)) {
      errors.push(`missing required heading '## ${heading}'`);
    }
  }

  const intent = sections.get('Intent') || '';
  if (!hasMeaningfulContent(intent)) {
    errors.push('Intent must be non-empty');
  }

  const acceptanceChecks = sections.get('Acceptance Checks') || '';
  const acceptanceCheckCount = countBulletItems(acceptanceChecks);
  if (acceptanceCheckCount < 2) {
    errors.push(`Acceptance Checks must include at least 2 bullet items (found ${acceptanceCheckCount})`);
  }

  const acceptanceQualityErrors = validateAcceptanceChecksQuality(acceptanceChecks);
  for (const qualityError of acceptanceQualityErrors) {
    errors.push(qualityError);
  }

  const validationEvidence = sections.get('Validation Evidence') || '';
  if (status === 'implemented' && !hasMeaningfulContent(validationEvidence)) {
    errors.push('Validation Evidence must be non-empty when status is implemented');
  }

  if (options && options.strict) {
    // Existing liveness checks
    const livenessErrors = checkLiveness(meta, sections, filePath);
    for (const err of livenessErrors) {
      errors.push(err);
    }

    // R4 — Cross-spec integrity
    if (specIdMap) {
      const crossSpecErrors = checkCrossSpecReferences(meta, filePath, specIdMap);
      for (const err of crossSpecErrors) {
        errors.push(err);
      }
    }

    // R5 — Freshness warnings (never errors)
    const freshnessWarnings = checkFreshness(meta);
    for (const w of freshnessWarnings) {
      warnings.push(w);
    }

    // R7 — Plan.md requirement check (never errors)
    const planMdWarnings = checkPlanMd(meta, sections, filePath);
    for (const w of planMdWarnings) {
      warnings.push(w);
    }
  }

  return {
    filePath,
    errors,
    warnings,
  };
}

function validateSpecsRoot(options = {}) {
  const targetPath = path.resolve(options.targetPath || path.join(process.cwd(), 'specs'));
  const requireSpecs = Boolean(options.require);
  const errors = [];
  const warnings = [];

  if (!fs.existsSync(targetPath)) {
    if (requireSpecs) {
      errors.push(`spec root not found: ${toDisplayPath(targetPath)}`);
      return {
        targetPath,
        specFiles: [],
        errors,
        warnings,
      };
    }

    return {
      targetPath,
      specFiles: [],
      errors,
      warnings,
      skipped: 'missing-root',
    };
  }

  const specFiles = collectSpecFiles(targetPath);
  if (requireSpecs && specFiles.length === 0) {
    errors.push(`no spec.md files found under ${toDisplayPath(targetPath)}`);
  }

  // Build spec_id map for cross-spec checks (R4)
  let specIdMap = null;
  if (options && options.strict && specFiles.length > 0) {
    specIdMap = buildSpecIdMap(specFiles);
  }

  for (const specFile of specFiles) {
    const result = validateSpecFile(specFile, options, specIdMap);
    for (const error of result.errors) {
      errors.push(`${toDisplayPath(specFile)}: ${error}`);
    }
    for (const warning of (result.warnings || [])) {
      warnings.push(`${toDisplayPath(specFile)}: ${warning}`);
    }
  }

  // R3 — Index integrity check (only in strict mode against a specs directory,
  // not when validating a single spec file)
  if (options && options.strict && specFiles.length > 0 && !fs.statSync(targetPath).isFile()) {
    const indexErrors = checkIndexIntegrity(targetPath, specFiles);
    for (const idxErr of indexErrors) {
      if (idxErr.file) {
        errors.push(`${idxErr.file}: ${idxErr.message}`);
      } else {
        errors.push(idxErr.message);
      }
    }
  }

  return {
    targetPath,
    specFiles,
    errors,
    warnings,
  };
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`specs invalid:\n  ${error.message}`);
    process.exit(1);
  }

  const result = validateSpecsRoot(options);
  const hasErrors = result.errors.length > 0;

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    if (hasErrors) process.exit(1);
    return;
  }

  // Print warnings to stdout (informational, never cause exit code 1)
  for (const warning of (result.warnings || [])) {
    console.log(warning);
  }

  if (hasErrors) {
    console.error(`specs invalid:\n${result.errors.map((e) => `  ${e}`).join('\n')}`);
    process.exit(1);
  }

  if (result.skipped === 'missing-root') {
    console.log(`specs ok (no specs directory at ${toDisplayPath(result.targetPath)})`);
    return;
  }

  console.log(`specs ok (${result.specFiles.length} specs)`);
}

if (require.main === module) {
  main();
}

module.exports = {
  REQUIRED_FRONTMATTER_KEYS,
  REQUIRED_HEADINGS,
  VALID_STATUS,
  VALID_TYPES,
  OPTIONAL_DATE_KEYS,
  collectSpecFiles,
  parseArgs,
  parseFrontmatterYaml,
  validateAcceptanceChecksQuality,
  checkLiveness,
  looksLikeFilePath,
  validateSpecFile,
  validateSpecsRoot,
  buildSpecIdMap,
  checkCrossSpecReferences,
  checkFreshness,
  checkPlanMd,
  checkIndexIntegrity,
  simpleGlobMatch,
  parseSkipPaths,
};
