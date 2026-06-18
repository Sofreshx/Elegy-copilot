#!/usr/bin/env node

import crypto from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const Database = require('better-sqlite3');

const SCRIPT_VERSION = '1.0.0';

const OPENCODE_DATA_DIR = path.join(os.homedir(), '.local', 'share', 'opencode');
const DB_PATH = path.join(OPENCODE_DATA_DIR, 'opencode.db');

let dryRun = false;
let verbose = false;

for (let i = 0; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '--dry-run') dryRun = true;
  else if (arg === '--verbose') verbose = true;
  else if (arg === '--db' && i + 1 < process.argv.length) {
    // override not needed but accepted for flexibility
    i++;
  }
}

function normalizePath(p) {
  return path.resolve(p).replace(/\\/g, '/').toLowerCase();
}

function computeRepoId(absPath) {
  const normalized = normalizePath(absPath);
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex').slice(0, 12);
}

function run() {
  if (!dryRun && !process.env.OPENCODE_SESSION_ID) {
    console.log('Note: OPENCODE_SESSION_ID is not set — running outside an OpenCode session.');
  }

  const db = new Database(DB_PATH, { readonly: dryRun });

  const projects = db.prepare('SELECT project_id, directory, type FROM project_directory').all();
  const globalSessions = db.prepare(
    "SELECT id, project_id, directory, title FROM session WHERE project_id = 'global'"
  ).all();

  if (verbose) {
    console.log(`Registered projects: ${projects.length}`);
    for (const p of projects) {
      console.log(`  ${p.project_id}  ${p.directory}`);
    }
  }

  console.log(`Global sessions found: ${globalSessions.length}`);

  for (const s of globalSessions) {
    const sessionDir = normalizePath(s.directory);
    let matched = false;

    for (const p of projects) {
      const projectDir = normalizePath(p.directory);
      if (sessionDir === projectDir || sessionDir.startsWith(projectDir + '/')) {
        if (dryRun) {
          console.log(`  WOULD FIX: ${s.id} "${s.title}" → project ${p.project_id} (${p.directory})`);
        } else {
          db.prepare('UPDATE session SET project_id = ? WHERE id = ?').run(p.project_id, s.id);
          console.log(`  FIXED: ${s.id} "${s.title}" → project ${p.project_id}`);
        }
        matched = true;
        break;
      }
    }

    if (!matched && verbose) {
      console.log(`  UNMATCHED: ${s.id} "${s.title}" at ${sessionDir}`);
    }
  }

  db.close();

  if (dryRun) {
    console.log('\nDry run complete. Re-run without --dry-run to apply fixes.');
  } else {
    console.log('\nDone.');
  }
}

try {
  run();
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
