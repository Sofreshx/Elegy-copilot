#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Set of documented Elegy CLI commands from elegy-planning/SKILL.md.
 * Each entry is the subcommand string after "elegy-planning ".
 */
const DOCUMENTED_COMMANDS = new Set([
  'goal create',
  'goal show',
  'goal list',
  'goal update-status',
  'goal search',
  'roadmap create',
  'roadmap show',
  'roadmap list',
  'roadmap add-work-point',
  'roadmap update-status',
  'roadmap search',
  'plan create',
  'plan show',
  'plan list',
  'plan revise',
  'plan update-status',
  'plan search',
  'todo create',
  'todo list',
  'todo update-status',
  'todo search',
  'issue record',
  'issue list',
  'issue update-status',
  'issue show',
  'issue search',
  'review-point record',
  'review-point update-status',
  'scope create',
  'scope show',
  'scope list',
  'search',
  'validate all',
  'health',
  'project render',
  'session init',
  'session use',
  'session show',
]);

/**
 * Forbidden command patterns (must NOT appear as backtick-quoted commands).
 */
const FORBIDDEN_PATTERNS = [
  { pattern: /goal\s+current/i, description: 'use goal list + filter instead' },
  { pattern: /lease\s+(?:create|list|release)/i, description: 'leases not a documented CLI surface' },
  { pattern: /work-point\s+(?:list|update)/i, description: 'use roadmap show, plan update-status instead' },
  { pattern: /evidence\s+add/i, description: 'use review-point record, issue record instead' },
  { pattern: /project\s+export/i, description: 'only project render is documented' },
];

function toPosix(filePath) {
  return String(filePath || '').replace(/\\/g, '/');
}

function toDisplayPath(filePath) {
  return toPosix(path.relative(process.cwd(), filePath) || path.basename(filePath));
}

/**
 * Extract all backtick-quoted strings from text content.
 */
function extractBacktickStrings(content) {
  const matches = [];
  const regex = /`([^`]+)`/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    matches.push(match[1]);
  }
  return matches;
}

/**
 * Extract the command portion from a backtick-quoted string that starts with
 * "elegy-planning ". Returns the subcommand string (e.g., "goal list") or null.
 */
function extractCommand(backtickString) {
  const trimmed = backtickString.trim();
  const prefix = 'elegy-planning ';
  if (!trimmed.startsWith(prefix)) {
    return null;
  }

  const rest = trimmed.slice(prefix.length).trim();

  // If there's nothing after 'elegy-planning ', skip
  if (!rest) {
    return null;
  }

  // Extract just the command part — split on flags (--) or space
  // The command is the first token(s) before any flag, option, or value argument
  const normalized = rest
    .replace(/\s+-{1,2}[\w-]+/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/"[^"]*"/g, '')
    .trim();

  // Get the first few words (for multi-word commands like "goal list", "validate all")
  // Filter to only alphabetic command tokens (exclude numbers, paths, etc.)
  const parts = normalized.split(/\s+/).filter(Boolean).filter((token) => /^[a-z-]+$/i.test(token));

  if (parts.length === 0) {
    return null;
  }

  // Known multi-word commands
  const knownMultiWord = new Set([
    'goal create', 'goal show', 'goal list', 'goal update-status', 'goal search',
    'roadmap create', 'roadmap show', 'roadmap list', 'roadmap add-work-point', 'roadmap update-status', 'roadmap search',
    'plan create', 'plan show', 'plan list', 'plan revise', 'plan update-status', 'plan search',
    'todo create', 'todo list', 'todo update-status', 'todo search',
    'issue record', 'issue list', 'issue update-status', 'issue show', 'issue search',
    'review-point record', 'review-point update-status',
    'scope create', 'scope show', 'scope list',
    'validate all',
    'project render',
    'session init', 'session use', 'session show',
  ]);

  // Try two-word match first
  if (parts.length >= 2) {
    const twoWord = parts.slice(0, 2).join(' ');
    if (knownMultiWord.has(twoWord)) {
      return twoWord;
    }
  }

  // Fall back to single-word command
  return parts[0];
}

/**
 * Check if a backtick-quoted string contains any forbidden patterns.
 */
function checkForbidden(backtickString, lineNumber, filePath) {
  const errors = [];
  for (const forbidden of FORBIDDEN_PATTERNS) {
    if (forbidden.pattern.test(backtickString)) {
      errors.push({
        line: lineNumber,
        message: `'${backtickString}' — ${forbidden.description}`,
      });
    }
  }
  return errors;
}

/**
 * Validate all elegy-planning commands in project.md against documented set.
 */
function validateProjectCommands(agentsDir) {
  const filePath = path.join(agentsDir, 'project.md');
  const errors = [];

  if (!fs.existsSync(filePath)) {
    errors.push({ line: 0, message: `project.md not found at ${toDisplayPath(filePath)}` });
    return errors;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const backtickStrings = extractBacktickStrings(content);

  for (const btString of backtickStrings) {
    // Find which line this backtick string is on
    let lineNumber = 0;
    for (let index = 0; index < lines.length; index += 1) {
      if (lines[index].includes('`' + btString + '`')) {
        lineNumber = index + 1;
        break;
      }
    }

    // Check for forbidden patterns
    errors.push(...checkForbidden(btString, lineNumber, filePath));

    // Check if it's an elegy-planning command reference
    const command = extractCommand(btString);
    if (!command) {
      continue;
    }

    // Validate against documented commands
    if (!DOCUMENTED_COMMANDS.has(command)) {
      errors.push({
        line: lineNumber,
        message: `undocumented command 'elegy-planning ${command}' in ${toDisplayPath(filePath)}`,
      });
    }
  }

  return errors;
}

function main() {
  const agentsDir = path.resolve(process.argv[2] || path.join(process.cwd(), 'opencode-assets', 'agents'));
  const errors = validateProjectCommands(agentsDir);

  if (errors.length > 0) {
    console.error('elegy-command-refs invalid:');
    for (const error of errors) {
      if (error.line > 0) {
        console.error(`  ${toDisplayPath(error.message ? '' : '')}${error.message}`);
      } else {
        console.error(`  ${error.message}`);
      }
    }
    process.exit(1);
  }

  console.log('elegy-command-refs ok');
}

if (require.main === module) {
  main();
}

module.exports = {
  DOCUMENTED_COMMANDS,
  FORBIDDEN_PATTERNS,
  extractBacktickStrings,
  extractCommand,
  checkForbidden,
  validateProjectCommands,
};
