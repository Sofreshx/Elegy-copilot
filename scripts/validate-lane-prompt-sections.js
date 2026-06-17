#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const LANE_AGENTS = ['quick', 'project'];

function toPosix(filePath) {
  return String(filePath || '').replace(/\\/g, '/');
}

function toDisplayPath(filePath) {
  return toPosix(path.relative(process.cwd(), filePath) || path.basename(filePath));
}

function readFile(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function mentionsEvidence(content) {
  return /evidence/i.test(content);
}

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

  if (!fs.existsSync(filePath)) {
    errors.push(`${agentName}.md: file not found at ${toDisplayPath(filePath)}`);
    return errors;
  }

  const content = readFile(filePath);

  if (!mentionsEvidence(content)) {
    errors.push(`${toDisplayPath(filePath)}: missing mention of 'evidence'`);
  }

  if (!mentionsGatesOrNoImplBeforeGates(content)) {
    errors.push(`${toDisplayPath(filePath)}: missing gates section or 'no implementation before gates' language`);
  }

  // UPPERCASE_BLOCK output contract
  const expectedBlock = agentName === 'quick' ? 'QUICK_LANE_RESULT' : 'PROJECT_LANE_RESULT';
  if (!content.includes(expectedBlock)) {
    errors.push(`${toDisplayPath(filePath)}: missing '${expectedBlock}' output contract block`);
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

  if (!/ambiguous/i.test(content)) {
    errors.push(`${toDisplayPath(filePath)}: missing 'ambiguous' text`);
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

  const rejectsUnfamiliar = 
    /exploration\s+of\s+unfamiliar/i.test(content) ||
    /do\s+not\s+explore\s+unfamiliar/i.test(content) ||
    /escalate\s+to\s+project.*unfamiliar/i.test(content) ||
    /escalate\s+to\s+project.*unknown/i.test(content);

  const instructsExploration = /explore\s+(the\s+)?(relevant\s+)?code\s+using/i.test(content) ||
    /explorer\s+for\s+(codebase\s+)?discovery\s+when\s+unfamiliar/i.test(content);

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

  const autoPatterns = [
    { regex: /auto(?:-| )(?:commit|merge|push|delete)/i, label: 'auto-commit/merge/push/delete' },
    { regex: /merging\s+.*\s+is\s+automatic/i, label: 'merge described as automatic' },
    { regex: /this\s+is\s+the\s+default\s*[–-]\s*merge/i, label: 'default-auto-merge' },
    { regex: /never\s+auto-commit.*but\s+merge.*is\s+automatic/i, label: 'contradictory auto-merge exception' },
  ];

  for (const { regex, label } of autoPatterns) {
    if (regex.test(content)) {
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
      break;
    }
  }

  return errors;
}

function main() {
  const agentsDir = path.resolve(process.argv[2] || path.join(process.cwd(), 'opencode-assets', 'agents'));
  const errors = [];

  for (const agentName of LANE_AGENTS) {
    errors.push(...validateAgentFile(agentsDir, agentName));
  }

  errors.push(...validateProjectSpecific(agentsDir));
  errors.push(...validateQuickSpecific(agentsDir));
  errors.push(...validateQuickExplorationContradiction(agentsDir));
  errors.push(...validateProjectNoAutoMutation(agentsDir));

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
  mentionsEvidence,
  validateAgentFile,
  validateProjectSpecific,
  validateQuickSpecific,
  validateQuickExplorationContradiction,
  validateProjectNoAutoMutation,
};
