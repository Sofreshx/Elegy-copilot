import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHARED_SKILLS_DIR = join(__dirname, '..', 'catalog-assets', 'shared-skills');
const results = [];
let exitCode = 0;

function addResult(file, check, status, message) {
  results.push({ file, check, status, message });
  if (status === 'fail') exitCode = 1;
}

function parseFrontmatter(content) {
  // Strip BOM if present
  if (content.codePointAt(0) === 0xFEFF) {
    content = content.slice(1);
  }
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const fm = {};
  match[1].split(/\r?\n/).forEach(line => {
    const idx = line.indexOf(':');
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      let value = line.slice(idx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      fm[key] = value;
    }
  });
  return fm;
}

const skillDirs = readdirSync(SHARED_SKILLS_DIR, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => d.name);

const allNames = [];
const allAliasKeys = new Map();

for (const dir of skillDirs) {
  const skillFile = join(SHARED_SKILLS_DIR, dir, 'SKILL.md');
  if (!existsSync(skillFile)) {
    addResult(dir, 'file-exists', 'fail', 'SKILL.md not found');
    continue;
  }
  
  const content = readFileSync(skillFile, 'utf8');
  const fm = parseFrontmatter(content);
  
  if (!fm) {
    addResult(dir, 'frontmatter', 'fail', 'Could not parse YAML frontmatter');
    continue;
  }
  
  if (!fm.name) {
    addResult(dir, 'name-required', 'fail', 'name field is required');
  } else {
    if (fm.name.length > 64) addResult(dir, 'name-length', 'fail', `name too long: ${fm.name.length} chars (max 64)`);
    if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(fm.name) && fm.name.length > 2) {
      addResult(dir, 'name-format', 'warn', `name "${fm.name}" may not follow lowercase-hyphen convention`);
    }
    if (fm.name !== dir) {
      addResult(dir, 'name-match-dir', 'fail', `name "${fm.name}" does not match directory "${dir}"`);
    }
    allNames.push(fm.name);
  }
  
  if (!fm.description) {
    addResult(dir, 'description-required', 'fail', 'description field is required');
  } else {
    if (fm.description.length > 1024) addResult(dir, 'description-length', 'fail', `description too long: ${fm.description.length} chars (max 1024)`);
    if (fm.description.length < 10) addResult(dir, 'description-length', 'warn', `description very short: ${fm.description.length} chars`);
  }
  
  if (fm['disable-model-invocation']) {
    addResult(dir, 'disable-model-invocation', 'pass', 'User-invoked (disable-model-invocation: true)');
  }
  
  const refLinks = content.matchAll(/\[([^\]]*)\]\(references\/([^)]+)\)/g);
  for (const match of refLinks) {
    const refFile = join(SHARED_SKILLS_DIR, dir, 'references', match[2]);
    if (!existsSync(refFile)) {
      addResult(dir, 'reference-link', 'fail', `References link broken: references/${match[2]}`);
    } else {
      addResult(dir, 'reference-link', 'pass', `references/${match[2]} resolves`);
    }
  }
  
  if (fm.metadata) {
    try {
      let meta = {};
      try { meta = JSON.parse(fm.metadata.replace(/'/g, '"')); } catch {}
      if (meta.aliasKeys && Array.isArray(meta.aliasKeys)) {
        for (const ak of meta.aliasKeys) {
          if (!allAliasKeys.has(ak)) allAliasKeys.set(ak, []);
          allAliasKeys.get(ak).push(fm.name);
        }
      }
    } catch {}
  }
}

const nameCount = {};
for (const name of allNames) {
  nameCount[name] = (nameCount[name] || 0) + 1;
}
for (const [name, count] of Object.entries(nameCount)) {
  if (count > 1) {
    addResult('(global)', 'duplicate-name', 'fail', `Duplicate skill name: "${name}" appears ${count} times`);
  }
}

for (const [ak, skills] of allAliasKeys) {
  if (skills.length > 1) {
    addResult('(global)', 'duplicate-alias', 'fail', `Duplicate alias key "${ak}" used by: ${skills.join(', ')}`);
  }
}

const passes = results.filter(r => r.status === 'pass').length;
const fails = results.filter(r => r.status === 'fail').length;
const warns = results.filter(r => r.status === 'warn').length;
console.log(JSON.stringify({ summary: { total: results.length, passes, fails, warns }, results }, null, 2));
process.exit(exitCode);
