#!/usr/bin/env node

/**
 * migrate-superseded-specs.mjs
 *
 * One-shot idempotent migration: marks align-elegy-db-assets and
 * planning-explorer-view as superseded by planning-visibility-canonicalization.
 *
 * - Updates status: draft → status: superseded on the two superseded specs
 * - Adds superseded_by: planning-visibility-canonicalization to each
 * - Adds supersedes: [...] to planning-visibility-canonicalization
 * - Regenerates specs/index.md
 *
 * Safe to re-run (all operations are idempotent).
 *
 * Usage:
 *   node scripts/migrate-superseded-specs.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Spec file paths
// ---------------------------------------------------------------------------

const SPECS = {
  'align-elegy-db-assets': path.resolve(REPO_ROOT, 'specs/align-elegy-db-assets/spec.md'),
  'planning-explorer-view': path.resolve(REPO_ROOT, 'specs/planning-explorer-view/spec.md'),
  'planning-visibility-canonicalization': path.resolve(REPO_ROOT, 'specs/planning-visibility-canonicalization/spec.md'),
};

const SUPERSEDING_ID = 'planning-visibility-canonicalization';
const SUPERSEDED_IDS = ['align-elegy-db-assets', 'planning-explorer-view'];

const GENERATE_INDEX_SCRIPT = path.resolve(REPO_ROOT, 'scripts/generate-spec-index.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse the YAML frontmatter block from a spec.md file.
 * Returns { yamlLines: string[], body: string } or null if no frontmatter found.
 */
function parseFrontmatter(content) {
  if (!content.startsWith('---')) return null;
  const endIdx = content.indexOf('\n---', 3);
  if (endIdx === -1) return null;
  const yamlBlock = content.slice(3, endIdx).trim();
  const body = content.slice(endIdx + 4); // after the closing ---
  return { yamlLines: yamlBlock.split(/\r?\n/), body };
}

/**
 * Reconstruct the file content from frontmatter lines + body.
 */
function rebuildContent(yamlLines, body) {
  return '---\n' + yamlLines.join('\n') + '\n---\n\n' + body.trimStart();
}

/**
 * Find the index of a line in the frontmatter that matches `key: value` exactly (trimmed).
 */
function findLine(lines, key, value) {
  const target = `${key}: ${value}`;
  return lines.findIndex(l => l.trim() === target);
}

/**
 * Check if any line in the frontmatter starts with `key:` and contains `value`.
 * Used for array-style lines like `supersedes: [a, b]`.
 */
function lineContainsValue(lines, key, value) {
  const prefix = `${key}:`;
  return lines.some(l => {
    const trimmed = l.trim();
    if (!trimmed.startsWith(prefix)) return false;
    // Check if the value appears in the array
    const arrMatch = trimmed.match(/\[([^\]]*)\]/);
    if (!arrMatch) return trimmed === `${prefix} ${value}`;
    const items = arrMatch[1].split(',').map(s => s.trim());
    return items.includes(value);
  });
}

/**
 * Check if any line in the frontmatter is exactly `key: value`.
 */
function hasExactLine(lines, key, value) {
  return findLine(lines, key, value) !== -1;
}

/**
 * Apply changes to a spec file.
 * Returns an array of change descriptions (empty if no changes).
 */
function migrateSpec(filePath, changes) {
  const results = [];

  if (!fs.existsSync(filePath)) {
    results.push(`FILE NOT FOUND: ${filePath}`);
    return results;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const fm = parseFrontmatter(content);
  if (!fm) {
    results.push('ERROR: no valid frontmatter found');
    return results;
  }

  const { yamlLines, body } = fm;
  let modified = false;

  for (const change of changes) {
    const { action, key, oldValue, newValue, values } = change;

    if (action === 'replace_line') {
      // Replace status: oldValue → newValue
      if (hasExactLine(yamlLines, key, newValue)) {
        results.push(`already ${key}: ${newValue} — skipped`);
        continue;
      }
      const idx = findLine(yamlLines, key, oldValue);
      if (idx === -1) {
        results.push(`expected '${key}: ${oldValue}' not found — skipped`);
        continue;
      }
      yamlLines[idx] = `${key}: ${newValue}`;
      modified = true;
      results.push(`changed ${key}: ${oldValue} → ${newValue}`);

    } else if (action === 'add_line_after') {
      // Add `key: value` after a line matching `anchorKey: anchorValue`
      if (hasExactLine(yamlLines, key, newValue)) {
        results.push(`already ${key}: ${newValue} — skipped`);
        continue;
      }
      const anchorIdx = findLine(yamlLines, change.anchorKey, change.anchorValue);
      if (anchorIdx === -1) {
        results.push(`anchor '${change.anchorKey}: ${change.anchorValue}' not found — skipped`);
        continue;
      }
      yamlLines.splice(anchorIdx + 1, 0, `${key}: ${newValue}`);
      modified = true;
      results.push(`added ${key}: ${newValue}`);

    } else if (action === 'add_or_update_array') {
      // Add or update `key: [values...]`
      const prefix = `${key}:`;
      const existingIdx = yamlLines.findIndex(l => l.trim().startsWith(prefix));
      if (existingIdx !== -1) {
        const existingLine = yamlLines[existingIdx].trim();
        const arrMatch = existingLine.match(/^supersedes:\s*\[([^\]]*)\]/);
        if (arrMatch) {
          const existingItems = arrMatch[1].split(',').map(s => s.trim()).filter(Boolean);
          const newItems = values.filter(v => !existingItems.includes(v));
          if (newItems.length === 0) {
            results.push(`${key}: already contains all items — skipped`);
            continue;
          }
          const allItems = [...existingItems, ...newItems];
          const indent = yamlLines[existingIdx].match(/^\s*/)[0];
          yamlLines[existingIdx] = `${indent}${key}: [${allItems.join(', ')}]`;
          modified = true;
          results.push(`updated ${key}: added ${newItems.join(', ')}`);
        } else {
          // Single-value format, convert to array
          const existingVal = existingLine.slice(prefix.length).trim();
          const allItems = [existingVal, ...values.filter(v => v !== existingVal)];
          if (allItems.length === existingItems?.length) {
            results.push(`${key}: already contains all items — skipped`);
            continue;
          }
          const indent = yamlLines[existingIdx].match(/^\s*/)[0];
          yamlLines[existingIdx] = `${indent}${key}: [${allItems.join(', ')}]`;
          modified = true;
          results.push(`updated ${key}: converted to array with ${values.join(', ')}`);
        }
      } else {
        // Insert the array field after the first suitable anchor
        const anchors = ['updated', 'type', 'status', 'spec_id'];
        let insertIdx = -1;
        for (const anchor of anchors) {
          const idx = yamlLines.findIndex(l => l.trim().startsWith(`${anchor}:`));
          if (idx !== -1) {
            insertIdx = idx + 1;
            break;
          }
        }
        if (insertIdx === -1) {
          // Fallback: insert after the first line
          insertIdx = 1;
        }
        // Make sure we don't insert before an existing multi-line value indentation
        // Skip past any indented continuation lines
        while (insertIdx < yamlLines.length && yamlLines[insertIdx].startsWith(' ')) {
          insertIdx++;
        }
        yamlLines.splice(insertIdx, 0, `${key}: [${values.join(', ')}]`);
        modified = true;
        results.push(`added ${key}: [${values.join(', ')}]`);
      }
    }
  }

  if (!modified) {
    return results; // empty results means no changes
  }

  const newContent = rebuildContent(yamlLines, body);
  fs.writeFileSync(filePath, newContent, 'utf8');
  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  console.log('=== Migrate Superseded Specs ===\n');

  let anyChange = false;
  let anyError = false;

  // 1. Update align-elegy-db-assets — superseded by planning-visibility-canonicalization
  console.log('1. specs/align-elegy-db-assets/spec.md');
  const result1 = migrateSpec(SPECS['align-elegy-db-assets'], [
    { action: 'replace_line', key: 'status', oldValue: 'draft', newValue: 'superseded' },
    { action: 'add_line_after', key: 'superseded_by', newValue: SUPERSEDING_ID, anchorKey: 'status', anchorValue: 'superseded' },
  ]);
  for (const r of result1) {
    console.log(`   ${r}`);
    if (r.startsWith('ERROR')) anyError = true;
    if (!r.includes('skipped') && !r.includes('not found')) anyChange = true;
  }
  if (result1.length === 0) console.log('   (no changes needed)');

  // 2. Update planning-explorer-view — superseded by planning-visibility-canonicalization
  console.log('\n2. specs/planning-explorer-view/spec.md');
  const result2 = migrateSpec(SPECS['planning-explorer-view'], [
    { action: 'replace_line', key: 'status', oldValue: 'draft', newValue: 'superseded' },
    { action: 'add_line_after', key: 'superseded_by', newValue: SUPERSEDING_ID, anchorKey: 'status', anchorValue: 'superseded' },
  ]);
  for (const r of result2) {
    console.log(`   ${r}`);
    if (r.startsWith('ERROR')) anyError = true;
    if (!r.includes('skipped') && !r.includes('not found')) anyChange = true;
  }
  if (result2.length === 0) console.log('   (no changes needed)');

  // Note: planning-explorer-view does NOT reference any machine-local paths,
  // so no liveness_skip_paths is needed.

  // 3. Update planning-visibility-canonicalization — add supersedes
  console.log('\n3. specs/planning-visibility-canonicalization/spec.md');
  const result3 = migrateSpec(SPECS['planning-visibility-canonicalization'], [
    { action: 'add_or_update_array', key: 'supersedes', values: SUPERSEDED_IDS },
  ]);
  for (const r of result3) {
    console.log(`   ${r}`);
    if (r.startsWith('ERROR')) anyError = true;
    if (!r.includes('skipped') && !r.includes('not found')) anyChange = true;
  }
  if (result3.length === 0) console.log('   (no changes needed)');

  // Check liveness_skip_paths on planning-visibility-canonicalization — already present
  const pvcContent = fs.readFileSync(SPECS['planning-visibility-canonicalization'], 'utf8');
  if (pvcContent.includes('liveness_skip_paths:')) {
    console.log('   liveness_skip_paths: already present — ok');
  } else {
    console.log('   WARNING: liveness_skip_paths missing — Phase 2.5 should have added it');
  }

  // 4. Regenerate index
  console.log('\n4. Regenerating spec index...');
  try {
    execSync(`node "${GENERATE_INDEX_SCRIPT}"`, {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      encoding: 'utf8',
    });
    console.log('   Index regenerated successfully.');
  } catch (err) {
    console.error(`   ERROR: index regeneration failed: ${err.message}`);
    anyError = true;
  }

  // Summary
  console.log('\n=== Summary ===');
  if (anyError) {
    console.log('Completed with errors — see above.');
    process.exit(1);
  }
  if (anyChange) {
    console.log('Migration applied changes successfully.');
  } else {
    console.log('No changes needed (idempotent — already up to date).');
  }
}

main();
