#!/usr/bin/env node

import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { getUserHome } from './install-surface-utils.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const exeSuffix = process.platform === 'win32' ? '.exe' : '';
const CLI_PATH = path.join(getUserHome(), '.elegy', 'managed-cli', 'planning', `elegy-planning${exeSuffix}`);

function usage() {
  console.log(`Usage: node scripts/elegy-planning-create.mjs [options]
  --db <path>         Path to elegy-planning DB (default: ~/.elegy/planning.db)
  --type <type>       Entity type: goal | roadmap (required)
  --id <id>           Entity ID (auto-generated if omitted)
  --title <title>     Entity title (required)
  --summary <summary> Entity summary (optional; maps to --description for goals)
  --status <status>   Entity status (default: draft)
  --goal-id <id>      Parent goal ID (required for roadmap)
  --tags <json>       Additional tags as JSON array (optional)
  --source <harness>  Source harness: codex | opencode | copilot | antigravity | human (default: human)
  --theme <token>     Theme token (optional)
  --phase <token>     Phase token (optional)
  --repo-id <hex>     Repo hash identifier (optional)
  --repo-label <str>  Repo label (optional)
  --dry-run           Print command without executing
  --help              Print this help

Examples:
  node scripts/elegy-planning-create.mjs --type goal --id "GOAL-MY-FEATURE-20260604" --title "My Feature" --source codex
  node scripts/elegy-planning-create.mjs --type roadmap --goal-id GOAL-MY-FEATURE-20260604 --title "Step 1" --repo-id 74af0f7b5cc4 --repo-label elegy-copilot --source codex --dry-run`);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--db': args.db = argv[++i]; break;
      case '--type': args.type = argv[++i]; break;
      case '--id': args.id = argv[++i]; break;
      case '--title': args.title = argv[++i]; break;
      case '--summary': args.summary = argv[++i]; break;
      case '--status': args.status = argv[++i]; break;
      case '--goal-id': args.goalId = argv[++i]; break;
      case '--tags': args.tags = argv[++i]; break;
      case '--source': args.source = argv[++i]; break;
      case '--theme': args.theme = argv[++i]; break;
      case '--phase': args.phase = argv[++i]; break;
      case '--repo-id': args.repoId = argv[++i]; break;
      case '--repo-label': args.repoLabel = argv[++i]; break;
      case '--dry-run': args.dryRun = true; break;
      case '--help': args.help = true; break;
      default:
        break;
    }
  }
  return args;
}

function slugify(text) {
  return text
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function formatDate() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function generateId(type, title) {
  const slug = slugify(title);
  const date = formatDate();
  return `${type.toUpperCase()}-${slug}-${date}`;
}

function buildTags(args) {
  const tags = [];

  if (args.repoId) {
    tags.push(`repo:${args.repoId}`);
  }

  if (args.repoLabel) {
    tags.push(`repo:${args.repoLabel}`);
  }

  const source = args.source || 'human';
  tags.push(`source:${source}`);

  if (args.theme) {
    tags.push(`theme:${args.theme}`);
  }

  if (args.phase) {
    tags.push(`phase:${args.phase}`);
  }

  if (args.tags) {
    try {
      const extraTags = JSON.parse(args.tags);
      if (Array.isArray(extraTags)) {
        tags.push(...extraTags);
      }
    } catch (e) {
      console.error(`[ERROR] Invalid --tags JSON: ${args.tags}`);
      process.exit(1);
    }
  }

  return tags;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  // --help or no args: print usage and exit 0
  if (args.help || Object.keys(args).length === 0) {
    usage();
    process.exit(0);
  }

  // Validate required arguments
  if (!args.type) {
    console.error('[ERROR] --type is required. Use "goal" or "roadmap".');
    process.exit(1);
  }
  if (!['goal', 'roadmap'].includes(args.type)) {
    console.error(`[ERROR] Invalid --type "${args.type}". Must be "goal" or "roadmap".`);
    process.exit(1);
  }
  if (!args.title) {
    console.error('[ERROR] --title is required.');
    process.exit(1);
  }
  if (args.type === 'roadmap' && !args.goalId) {
    console.error('[ERROR] --goal-id is required for type "roadmap".');
    process.exit(1);
  }

  // Set defaults
  const db = args.db || path.join(getUserHome(), '.elegy', 'planning.db');
  const id = args.id || generateId(args.type, args.title);
  const status = args.status || 'draft';

  // Build tags
  const tags = buildTags(args);
  const tagStr = tags.join(',');

  // Build command
  const escapedDb = `"${db}"`;
  const escapedTitle = `"${args.title}"`;

  let cmd = `${CLI_PATH} --db ${escapedDb} ${args.type} create --id ${id} --title ${escapedTitle} --tag "${tagStr}" --status ${status}`;

  // --summary maps to --description for goals, --summary for roadmaps
  if (args.summary) {
    const summaryFlag = args.type === 'goal' ? '--description' : '--summary';
    cmd += ` ${summaryFlag} "${args.summary}"`;
  }

  // --goal-id is only valid for roadmaps
  if (args.goalId) {
    cmd += ` --goal-id ${args.goalId}`;
  }

  // Dry-run: print the command and exit 0
  if (args.dryRun) {
    console.log(cmd);
    process.exit(0);
  }

  // Execute
  try {
    execSync(cmd, { stdio: 'inherit' });
  } catch (e) {
    process.exit(e.status || 1);
  }
}

main();
