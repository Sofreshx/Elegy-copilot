#!/usr/bin/env node
/*
 * migrate-user-invokable-to-user-invocable.js
 *
 * Scans `engine-assets/agents/*.agent.md` files and renames front-matter key
 * `user-invokable:` to `user-invocable:`.
 *
 * Usage:
 *   node scripts/migrate-user-invokable-to-user-invocable.js        # dry-run
 *   node scripts/migrate-user-invokable-to-user-invocable.js --apply
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');

function listAgentFiles(rootDir) {
  const agentsDir = path.join(rootDir, 'engine-assets', 'agents');
  if (!fs.existsSync(agentsDir) || !fs.statSync(agentsDir).isDirectory()) {
    return [];
  }

  return fs
    .readdirSync(agentsDir)
    .filter((name) => name.toLowerCase().endsWith('.agent.md'))
    .map((name) => path.join(agentsDir, name));
}

function migrateFile(filePath, apply) {
  const content = fs.readFileSync(filePath, 'utf8');
  const frontMatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!frontMatterMatch) {
    return { changed: false, reason: 'no-frontmatter' };
  }

  const frontMatter = frontMatterMatch[1];
  if (!frontMatter.includes('user-invokable:')) {
    return { changed: false, reason: 'already-migrated-or-missing' };
  }

  const migratedFrontMatter = frontMatter.replace(/(^|\r?\n)(\s*)user-invokable\s*:/g, '$1$2user-invocable:');
  const next = content.replace(frontMatter, migratedFrontMatter);

  if (apply) {
    fs.writeFileSync(filePath, next, 'utf8');
  }

  return { changed: true, reason: apply ? 'applied' : 'dry-run' };
}

function main() {
  const apply = process.argv.includes('--apply');
  const rootArg = process.argv.find(a => a.startsWith('--root='));
  const rootDir = rootArg ? path.resolve(rootArg.slice('--root='.length)) : REPO_ROOT;
  const files = listAgentFiles(rootDir);

  if (files.length === 0) {
    console.log('No engine-assets/agents/*.agent.md files found.');
    process.exit(0);
  }

  let changed = 0;
  for (const filePath of files) {
    const result = migrateFile(filePath, apply);
    if (result.changed) {
      changed += 1;
      console.log(`${apply ? 'Updated' : 'Would update'}: ${path.relative(rootDir, filePath)}`);
    }
  }

  console.log(`Scanned ${files.length} agent files.`);
  console.log(`${apply ? 'Updated' : 'Would update'} ${changed} files.`);
  if (!apply && changed > 0) {
    console.log('Run with --apply to write changes.');
  }
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`migrate-user-invokable-to-user-invocable: ${err.message}\n`);
    process.exit(1);
  }
}