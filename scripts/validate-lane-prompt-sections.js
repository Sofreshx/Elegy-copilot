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
};
