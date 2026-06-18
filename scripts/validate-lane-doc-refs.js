#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const LANE_AGENT_NAMES = ['lane-quick', 'lane-project'];

function toPosix(filePath) {
  return String(filePath || '').replace(/\\/g, '/');
}

function toDisplayPath(filePath) {
  return toPosix(path.relative(process.cwd(), filePath) || path.basename(filePath));
}

function readLines(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return content.split(/\r?\n/);
}

/**
 * Check that the "- Primary skills:" line does NOT contain lane agent names.
 */
function checkPrimarySkillsLine(lines, filePath) {
  const errors = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed.startsWith('- Primary skills:')) {
      continue;
    }

    for (const agent of LANE_AGENT_NAMES) {
      if (trimmed.includes(agent)) {
        errors.push(`${toDisplayPath(filePath)}:${index + 1}: ${agent} listed as primary skill`);
      }
    }
    break; // Only check the first matching line
  }
  return errors;
}

/**
 * Check that the "Primary skills available:" list does NOT contain lane agent names.
 */
function checkPrimarySkillsAvailableList(lines, filePath) {
  const errors = [];
  let inPrimaryList = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (trimmed.startsWith('Primary skills available:')) {
      inPrimaryList = true;
      continue;
    }

    if (inPrimaryList) {
      // The list ends when we hit a non-bullet, non-empty line
      if (!trimmed || !trimmed.startsWith('-')) {
        inPrimaryList = false;
        continue;
      }

      for (const agent of LANE_AGENT_NAMES) {
        if (trimmed.includes(agent)) {
          errors.push(`${toDisplayPath(filePath)}:${index + 1}: ${agent} listed in primary skills`);
        }
      }
    }
  }
  return errors;
}

/**
 * Check that file does NOT contain the phrase "lane skill" (case-insensitive).
 */
function checkNoLaneSkillPhrase(lines, filePath) {
  const errors = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.toLowerCase().includes('lane skill')) {
      errors.push(`${toDisplayPath(filePath)}:${index + 1}: contains 'lane skill'`);
    }
  }
  return errors;
}

function validateGuideFile(targetDir) {
  const filePath = path.join(targetDir, 'docs', 'system', 'opencode-guide.md');
  const errors = [];

  if (!fs.existsSync(filePath)) {
    errors.push(`missing docs/system/opencode-guide.md`);
    return errors;
  }

  const lines = readLines(filePath);
  errors.push(...checkPrimarySkillsLine(lines, filePath));
  errors.push(...checkNoLaneSkillPhrase(lines, filePath));
  return errors;
}

function validateAgentsHomeFile(targetDir) {
  const filePath = path.join(targetDir, 'opencode-assets', 'home', 'AGENTS.md');
  const errors = [];

  if (!fs.existsSync(filePath)) {
    errors.push(`missing opencode-assets/home/AGENTS.md`);
    return errors;
  }

  const lines = readLines(filePath);
  errors.push(...checkPrimarySkillsAvailableList(lines, filePath));
  errors.push(...checkNoLaneSkillPhrase(lines, filePath));
  return errors;
}

function main() {
  const targetDir = path.resolve(process.argv[2] || process.cwd());
  const errors = [];

  errors.push(...validateGuideFile(targetDir));
  errors.push(...validateAgentsHomeFile(targetDir));

  if (errors.length > 0) {
    console.error('lane-doc-refs invalid:');
    for (const error of errors) {
      console.error(`  ${error}`);
    }
    process.exit(1);
  }

  console.log('lane-doc-refs ok');
}

if (require.main === module) {
  main();
}

module.exports = {
  LANE_AGENT_NAMES,
  checkPrimarySkillsLine,
  checkPrimarySkillsAvailableList,
  checkNoLaneSkillPhrase,
  validateGuideFile,
  validateAgentsHomeFile,
};
