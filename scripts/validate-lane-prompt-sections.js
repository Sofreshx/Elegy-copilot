#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const LANE_AGENTS = ['quick', 'standard', 'spec', 'project'];

function toPosix(filePath) {
  return String(filePath || '').replace(/\\/g, '/');
}

function toDisplayPath(filePath) {
  return toPosix(path.relative(process.cwd(), filePath) || path.basename(filePath));
}

function readFile(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

/**
 * Find all heading lines matching `## When NOT To Use` (case-insensitive,
 * ignoring whitespace around 'NOT').
 */
function findWhenNotToUseHeading(lines) {
  const headingRegex = /^##\s+When\s+N\s*O\s*T\s+To\s+Use\s*$/i;
  for (let index = 0; index < lines.length; index += 1) {
    if (headingRegex.test(lines[index].trim())) {
      return index;
    }
  }
  return -1;
}

/**
 * Extract the body after a heading (lines after the heading until the next
 * heading of equal or higher level).
 */
function extractSectionBody(lines, headingIndex) {
  const body = [];
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    // Stop at next ## or higher heading (### is not a stop since it's lower)
    if (/^##\s/.test(line.trim())) {
      break;
    }
    body.push(line);
  }
  return body.join('\n');
}

/**
 * Check that a section body has at least one bullet item (`- ` or `* `).
 */
function hasBulletItems(body) {
  return /^\s*[-*]\s+\S/m.test(body);
}

/**
 * Check that content mentions "evidence" (case-insensitive).
 */
function mentionsEvidence(content) {
  return /evidence/i.test(content);
}

/**
 * Check that content has a gates section or no-implementation-before language.
 * Accepts: heading "## Gates", or text "before implementation", "implementation blocked", "plan review gate",
 * "spec is reviewed and signed off", "reviewed and approved".
 */
function mentionsGatesOrNoImplBeforeGates(content) {
  const lower = content.toLowerCase();
  if (/^##\s+gates\s*$/im.test(content)) return true;
  if (/before\s+implementation/i.test(lower) && /gate|review|approved/i.test(lower)) return true;
  if (/implementation\s+blocked/i.test(lower)) return true;
  if (/reviewed\s+and\s+signed\s+off/i.test(lower)) return true;
  if (/plan\s+review\s+gate/i.test(lower)) return true;
  if (/no\s+implementation\s+before\s+gate/i.test(lower)) return true;
  return false;
}

function validateAgentFile(agentsDir, agentName) {
  const errors = [];
  const filePath = path.join(agentsDir, `${agentName}.md`);

  // 1a. File must exist
  if (!fs.existsSync(filePath)) {
    errors.push(`${agentName}.md: file not found at ${toDisplayPath(filePath)}`);
    return errors;
  }

  const content = readFile(filePath);
  const lines = content.split(/\r?\n/);

  // 1b. Must contain ## When NOT To Use heading
  const headingIndex = findWhenNotToUseHeading(lines);
  if (headingIndex === -1) {
    errors.push(`${toDisplayPath(filePath)}: missing '## When NOT To Use' heading`);
    return errors; // Cannot proceed with further checks
  }

  // 1c. Body after heading must contain at least one bullet item
  const body = extractSectionBody(lines, headingIndex);
  if (!hasBulletItems(body)) {
    errors.push(`${toDisplayPath(filePath)}:${headingIndex + 1}: 'When NOT To Use' section has no bullet items`);
  }

  // 1d. Content must mention "evidence"
  if (!mentionsEvidence(content)) {
    errors.push(`${toDisplayPath(filePath)}: missing mention of 'evidence'`);
  }

  // 1e. Content must mention gates or no-implementation-before-gates language
  if (!mentionsGatesOrNoImplBeforeGates(content)) {
    errors.push(`${toDisplayPath(filePath)}: missing gates section or 'no implementation before gates' language`);
  }

  return errors;
}

function validateSpecSpecific(agentsDir) {
  const errors = [];
  const filePath = path.join(agentsDir, 'spec.md');

  if (!fs.existsSync(filePath)) {
    errors.push(`spec.md: file not found for spec-specific checks`);
    return errors;
  }

  const content = readFile(filePath);

  // spec.md must contain "elegy-skills-discovery"
  if (!content.includes('elegy-skills-discovery')) {
    errors.push(`${toDisplayPath(filePath)}: missing 'elegy-skills-discovery' text`);
  }

  return errors;
}

function validateProjectSpecific(agentsDir) {
  const errors = [];
  const filePath = path.join(agentsDir, 'project.md');

  if (!fs.existsSync(filePath)) {
    errors.push(`project.md: file not found for project-specific checks`);
    return errors;
  }

  const content = readFile(filePath);

  // project.md must contain "elegy-skills-discovery"
  if (!content.includes('elegy-skills-discovery')) {
    errors.push(`${toDisplayPath(filePath)}: missing 'elegy-skills-discovery' text`);
  }

  return errors;
}

function validateQuickSpecific(agentsDir) {
  const errors = [];
  const filePath = path.join(agentsDir, 'quick.md');

  if (!fs.existsSync(filePath)) {
    errors.push(`quick.md: file not found for quick-specific checks`);
    return errors;
  }

  const content = readFile(filePath);
  const lines = content.split(/\r?\n/);

  // quick.md must contain "ambiguous" in its When NOT To Use section
  const headingIndex = findWhenNotToUseHeading(lines);
  if (headingIndex === -1) {
    errors.push(`${toDisplayPath(filePath)}: missing '## When NOT To Use' heading (quick-specific check)`);
    return errors;
  }

  const body = extractSectionBody(lines, headingIndex);
  if (!/ambiguous/i.test(body)) {
    errors.push(`${toDisplayPath(filePath)}:${headingIndex + 1}: 'When NOT To Use' section missing 'ambiguous' text`);
  }

  return errors;
}

function validateQuickExplorationContradiction(agentsDir) {
  const errors = [];
  const filePath = path.join(agentsDir, 'quick.md');

  if (!fs.existsSync(filePath)) {
    errors.push(`quick.md: file not found for exploration-contradiction check`);
    return errors;
  }

  const content = readFile(filePath);
  const lower = content.toLowerCase();

  // Check 1: Does quick.md reject unfamiliar exploration?
  const rejectsUnfamiliar = 
    /exploration\s+of\s+unfamiliar/i.test(content) ||
    /do\s+not\s+explore\s+unfamiliar/i.test(content) ||
    /escalate\s+to\s+standard.*unfamiliar/i.test(content) ||
    /escalate\s+to\s+standard.*unknown/i.test(content);

  // Check 2: Does quick.md ALSO instruct exploration without narrow-lookup guard?
  const instructsExploration = /explore\s+(the\s+)?(relevant\s+)?code\s+using/i.test(content) ||
    /explorer\s+for\s+(codebase\s+)?discovery\s+when\s+unfamiliar/i.test(content);

  // Check 3: Does quick.md have the narrow-lookup safeguard?
  const hasNarrowLookupGuard = 
    /narrow[,]?\s+focused\s+lookup/i.test(content) ||
    /only\s+when\s+the\s+file\s+and\s+area\s+are/i.test(content) ||
    /do\s+not\s+use.*explorer.*unfamiliar/i.test(content) ||
    /only\s+for\s+narrow/i.test(content);

  if (rejectsUnfamiliar && instructsExploration && !hasNarrowLookupGuard) {
    errors.push(
      `${toDisplayPath(filePath)}: contradiction detected — quick.md rejects unfamiliar code exploration ` +
      `but also instructs exploration without a 'narrow lookup only' safeguard. ` +
      `Add the narrow-lookup distinction or remove the exploration instruction.`
    );
  }

  return errors;
}

function validateProjectNoAutoMutation(agentsDir) {
  const errors = [];
  const filePath = path.join(agentsDir, 'project.md');

  if (!fs.existsSync(filePath)) {
    errors.push(`project.md: file not found for auto-mutation check`);
    return errors;
  }

  const content = readFile(filePath);
  const lower = content.toLowerCase();

  // Patterns that indicate automatic git mutations without approval
  const autoPatterns = [
    { regex: /auto(?:-| )(?:commit|merge|push|delete)/i, label: 'auto-commit/merge/push/delete' },
    { regex: /merging\s+.*\s+is\s+automatic/i, label: 'merge described as automatic' },
    { regex: /this\s+is\s+the\s+default\s*[–-]\s*merge/i, label: 'default-auto-merge' },
    { regex: /never\s+auto-commit.*but\s+merge.*is\s+automatic/i, label: 'contradictory auto-merge exception' },
  ];

  for (const { regex, label } of autoPatterns) {
    if (regex.test(content)) {
      // Only flag if there's no explicit approval counter-language in the same section
      // Note: approval gating check operates on full file content, not just the matched
      // section. This is deliberate for defense-in-depth — any approval language anywhere
      // in the file counts as a gate. Future: consider section-scoping for precision.
      const hasApprovalGating = 
        /wait\s+for\s+(explicit\s+)?user\s+approval/i.test(content) ||
        /ask\s+(the\s+)?user\s+before/i.test(content) ||
        /require.*explicit.*approval/i.test(content) ||
        /propose.*merge.*wait/i.test(content) ||
        /all\s+durable\s+git\s+mutations/i.test(content);

      if (!hasApprovalGating) {
        errors.push(
          `${toDisplayPath(filePath)}: auto-mutation language detected ('${label}') ` +
          `without explicit user-approval gating language. Add 'wait for user approval' or equivalent.`
        );
      }
      break; // One error is enough for this check
    }
  }

  return errors;
}

function validateStandardEvidenceRequirement(agentsDir) {
  const errors = [];
  const filePath = path.join(agentsDir, 'standard.md');

  if (!fs.existsSync(filePath)) {
    errors.push(`standard.md: file not found for evidence-requirement check`);
    return errors;
  }

  const content = readFile(filePath);

  // Check: standard.md must mention diff inspection by parent before review
  const hasDiffInspection = /git\s+diff\s+--stat/i.test(content) &&
    (/inspect\s+relevant\s+diff/i.test(content) || /diff\s+summary/i.test(content));

  // Check: standard.md must mention passing validation evidence to reviewer
  const hasEvidenceToReviewer = /pass.*(?:complete|full)\s+(?:evidence\s+)?package\s+to\s+reviewer/i.test(content) ||
    /reviewer.*receive.*(?:evidence|diff|validation)/i.test(content) ||
    /evidence\s+package/i.test(content);

  if (!hasDiffInspection) {
    errors.push(
      `${toDisplayPath(filePath)}: missing requirement for parent lane to run 'git diff --stat' ` +
      `and inspect relevant diff hunks before final review`
    );
  }

  if (!hasEvidenceToReviewer) {
    errors.push(
      `${toDisplayPath(filePath)}: missing requirement to pass full evidence package (diff, ` +
      `validation results, impl evidence) to reviewer for final review`
    );
  }

  return errors;
}

function validateSpecMinorChangeException(agentsDir) {
  const errors = [];
  const filePath = path.join(agentsDir, 'spec.md');

  if (!fs.existsSync(filePath)) {
    errors.push(`spec.md: file not found for minor-change check`);
    return errors;
  }

  const content = readFile(filePath);
  const lower = content.toLowerCase();

  // Check: Does spec.md have a blanket "user-facing behavior" trigger?
  const hasBlanketUserFacing = /user-?facing\s+behavior/i.test(content) &&
    !/minor\s+(copy|layout|ui)\s+nits/i.test(content) &&
    !/do\s+not\s+force\s+spec\s+lane/i.test(content);

  // If there's a blanket trigger but ALSO a minor-change exception, that's fine
  const hasMinorChangeException = 
    /minor\s+(copy|layout|ui)\s+nits/i.test(content) ||
    /do\s+not\s+force\s+spec\s+lane/i.test(content) ||
    /non-?obvious\s+acceptance/i.test(content);

  if (hasBlanketUserFacing && !hasMinorChangeException) {
    errors.push(
      `${toDisplayPath(filePath)}: treats all user-facing behavior changes as spec-required ` +
      `without a minor-change exception (e.g., 'minor copy/layout/UI nits do not force spec lane')`
    );
  }

  return errors;
}

function main() {
  const agentsDir = path.resolve(process.argv[2] || path.join(process.cwd(), 'opencode-assets', 'agents'));
  const errors = [];

  // Check all four lane agents for common requirements
  for (const agentName of LANE_AGENTS) {
    errors.push(...validateAgentFile(agentsDir, agentName));
  }

  // Spec-specific checks
  errors.push(...validateSpecSpecific(agentsDir));

  // Project-specific checks
  errors.push(...validateProjectSpecific(agentsDir));

  // Quick-specific checks
  errors.push(...validateQuickSpecific(agentsDir));

  // New: Quick exploration contradiction check
  errors.push(...validateQuickExplorationContradiction(agentsDir));

  // New: Project no-auto-mutation check
  errors.push(...validateProjectNoAutoMutation(agentsDir));

  // New: Standard evidence requirement check
  errors.push(...validateStandardEvidenceRequirement(agentsDir));

  // New: Spec minor-change exception check
  errors.push(...validateSpecMinorChangeException(agentsDir));

  if (errors.length > 0) {
    console.error('lane-prompt-sections invalid:');
    for (const error of errors) {
      console.error(`  ${error}`);
    }
    process.exit(1);
  }

  console.log('lane-prompt-sections ok');
}

if (require.main === module) {
  main();
}

module.exports = {
  LANE_AGENTS,
  findWhenNotToUseHeading,
  extractSectionBody,
  hasBulletItems,
  mentionsEvidence,
  validateAgentFile,
  validateSpecSpecific,
  validateProjectSpecific,
  validateQuickSpecific,
  validateQuickExplorationContradiction,
  validateProjectNoAutoMutation,
  validateStandardEvidenceRequirement,
  validateSpecMinorChangeException,
};
