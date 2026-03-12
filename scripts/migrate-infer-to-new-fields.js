#!/usr/bin/env node
/*
 * migrate-infer-to-new-fields.js
 *
 * Scans `engine-assets/agents/*.agent.md` files and replaces deprecated `infer:`
 * front-matter entries with the new `user-invocable:` and
 * `disable-model-invocation:` keys. The script is idempotent and supports
 * --apply to write changes (default is dry-run).
 *
 * Usage:
 *   node scripts/migrate-infer-to-new-fields.js        # dry-run
 *   node scripts/migrate-infer-to-new-fields.js --apply
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');

function findAgentsDirs(startDir) {
  const results = [];
  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory() && e.name === 'engine-assets') {
        const agents = path.join(dir, e.name, 'agents');
        if (fs.existsSync(agents) && fs.statSync(agents).isDirectory()) {
          results.push(agents);
        }
      }
      if (e.isDirectory()) {
        // don't recurse into node_modules or .git to speed up
        if (e.name === 'node_modules' || e.name === '.git') continue;
        walk(path.join(dir, e.name));
      }
    }
  }
  walk(startDir);
  return results;
}

function parseFrontMatter(text) {
  if (!text.startsWith('---')) return null;
  const endMarker = '\n---';
  const endIdx = text.indexOf(endMarker, 3);
  if (endIdx === -1) return null;
  const yamlBlock = text.slice(3, endIdx).trim();
  const rest = text.slice(endIdx + endMarker.length);
  const lines = yamlBlock.split(/\r?\n/);
  const fm = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const m = trimmed.match(/^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let value = m[2];
    if (value === '') {
      fm[key] = '';
    } else if (value.startsWith('[') && value.endsWith(']')) {
      const inside = value.slice(1, -1).trim();
      if (!inside) fm[key] = [];
      else fm[key] = inside.split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
    } else {
      fm[key] = value.replace(/^['"]|['"]$/g, '');
    }
  }
  return { fm, rest, raw: text.slice(0, endIdx + endMarker.length) };
}

function buildFrontMatter(fm) {
  const keys = Object.keys(fm);
  // Keep a stable order: name, description, tools, user-invocable, disable-model-invocation, ...
  const preferredOrder = ['name', 'description', 'tools', 'user-invocable', 'disable-model-invocation'];
  keys.sort((a, b) => {
    const ai = preferredOrder.indexOf(a);
    const bi = preferredOrder.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b);
  });
  const lines = ['---'];
  for (const k of keys) {
    const v = fm[k];
    if (Array.isArray(v)) {
      lines.push(`${k}: [${v.join(', ')}]`);
    } else if (typeof v === 'string') {
      // keep as-is (no extra quoting unless needed)
      lines.push(`${k}: ${v}`);
    } else if (typeof v === 'boolean') {
      lines.push(`${k}: ${v}`);
    } else if (v == null) {
      lines.push(`${k}:`);
    } else {
      lines.push(`${k}: ${String(v)}`);
    }
  }
  lines.push('---');
  return lines.join('\n') + '\n\n';
}

function normalizeInferValue(raw) {
  if (raw == null) return undefined;
  if (typeof raw === 'boolean') return raw ? 'true' : 'false';
  const s = String(raw).trim().toLowerCase();
  if (!s) return undefined;
  if (s === 'true' || s === 'false' || s === 'agent' || s === 'user') return s;
  // accept 'yes'/'no'/'1'/'0' too
  if (s === 'yes' || s === '1') return 'true';
  if (s === 'no' || s === '0') return 'false';
  return s; // unknown - return raw string
}

function mapInferToNewFields(inferVal) {
  // returns object with keys to set
  // default conservative: not user-invocable, disable model invocation
  const result = {};
  if (inferVal === undefined) return result;
  switch (inferVal) {
    case 'agent':
      result['user-invocable'] = false;
      result['disable-model-invocation'] = false; // allow model invocation for subagents
      break;
    case 'user':
    case 'true':
      result['user-invocable'] = true; // visible to users
      result['disable-model-invocation'] = true; // do NOT allow model invocation unless explicitly agent
      break;
    case 'false':
      result['user-invocable'] = false;
      result['disable-model-invocation'] = true;
      break;
    default:
      // unknown - be safe
      result['user-invocable'] = false;
      result['disable-model-invocation'] = true;
      break;
  }
  return result;
}

function updateAgentFile(filePath, apply) {
  const content = fs.readFileSync(filePath, 'utf8');
  const parsed = parseFrontMatter(content);
  if (!parsed) return { changed: false, reason: 'no front-matter' };
  const { fm, rest, raw } = parsed;
  if (!('infer' in fm)) {
    // Nothing to migrate, but check if new fields present
    if (!('user-invocable' in fm) && !('disable-model-invocation' in fm)) {
      return { changed: false, reason: 'no infer, no new fields' };
    }
    return { changed: false, reason: 'already migrated' };
  }
  const inferRaw = fm['infer'];
  const inferVal = normalizeInferValue(inferRaw);
  const mapped = mapInferToNewFields(inferVal);

  // If new fields already exist, don't overwrite them
  for (const key of ['user-invocable', 'disable-model-invocation']) {
    if (!(key in fm) && (key in mapped)) {
      fm[key] = mapped[key];
    }
  }
  // Remove infer
  delete fm['infer'];

  const newFront = buildFrontMatter(fm);
  const newContent = newFront + rest.trimStart();

  if (apply) {
    fs.writeFileSync(filePath, newContent, 'utf8');
    return { changed: true, reason: 'applied', infer: inferRaw };
  }
  return { changed: true, reason: 'dry-run', infer: inferRaw, sample: newFront };
}

function run() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const rootArg = args.find(a => a.startsWith('--root='));
  const rootValue = rootArg ? rootArg.slice('--root='.length).trim() : '';
  const scanRoot = rootValue ? path.resolve(rootValue) : REPO_ROOT;
  console.log(`Scanning from ${scanRoot} ...`);
  const agentsDirs = findAgentsDirs(scanRoot);
  if (agentsDirs.length === 0) {
    console.log('No engine-assets/agents folders found. Exiting.');
    return;
  }
  let total = 0;
  const changes = [];
  for (const dir of agentsDirs) {
    const files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.agent.md'));
    for (const file of files) {
      total++;
      const fp = path.join(dir, file);
      try {
        const res = updateAgentFile(fp, apply);
        if (res.changed) {
          changes.push({ file: fp, ...res });
          console.log(`${apply ? 'Updated' : 'Would update'}: ${fp} (${res.reason})`);
        } else {
          console.log(`No change: ${fp} (${res.reason})`);
        }
      } catch (err) {
        console.error(`Error processing ${fp}: ${err.message}`);
      }
    }
  }
  console.log('\nSummary:\n');
  console.log(`Total agent files scanned: ${total}`);
  console.log(`Files to change: ${changes.length}`);
  if (!apply && changes.length > 0) {
    console.log('\nRun with --apply to write the changes.');
  }
}

if (require.main === module) {
  try {
    run();
  } catch (err) {
    process.stderr.write(`migrate-infer-to-new-fields: ${err.message}\n`);
    process.exit(1);
  }
}
