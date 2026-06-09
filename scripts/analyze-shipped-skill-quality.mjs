#!/usr/bin/env node

/**
 * analyze-shipped-skill-quality.mjs
 *
 * Scans all shipped skill SKILL.md files across the four scan roots
 * and produces a quality diagnostic report in JSON format on stdout.
 * Also writes a markdown audit report to docs/research/shipped-skill-quality-audit.md.
 *
 * Usage:
 *   node scripts/analyze-shipped-skill-quality.mjs
 *
 * Options:
 *   --repoRoot <path>   Override repo root (default: directory of this script's parent)
 *   --no-write-md       Skip writing the markdown audit report
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

// ─── Paths ────────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const SCAN_ROOTS = [
  'engine-assets/skills',
  'catalog-assets/shared-skills',
  'codex-assets/skills',
  'opencode-assets/skills',
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Find all SKILL.md files recursively under a directory.
 */
function findSkillFiles(dirPath) {
  const results = [];
  if (!fs.existsSync(dirPath)) return results;

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...findSkillFiles(fullPath));
    } else if (entry.isFile() && entry.name === 'SKILL.md') {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Parse YAML-style frontmatter (between --- delimiters at top of file).
 *
 * Handles:
 * - Simple key: value pairs (quoted or unquoted)
 * - YAML list values for 'triggers' (lines starting with '  - ')
 * - Inline JSON in 'metadata' field
 * - 'triggers' embedded in description as "Triggers on: ..."
 */
function parseFrontmatter(content) {
  const frontmatter = {};
  // Strip BOM and normalize line endings
  let normalizedContent = content.replace(/^\ufeff/, '');
  normalizedContent = normalizedContent.replace(/\r\n/g, '\n');
  const match = normalizedContent.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return frontmatter;

  const raw = match[1];
  const lines = raw.split('\n');

  let currentListKey = null;
  const listValues = {};

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty/comment lines
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Detect YAML list items (e.g., "  - value")
    const listMatch = trimmed.match(/^-\s+(.*)/);
    if (listMatch && currentListKey) {
      if (!listValues[currentListKey]) listValues[currentListKey] = [];
      listValues[currentListKey].push(listMatch[1].trim());
      continue;
    }
    currentListKey = null;

    // Key: value
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex === -1) continue;

    const key = trimmed.slice(0, colonIndex).trim();
    if (!key) continue;

    let value = trimmed.slice(colonIndex + 1).trim();

    // Detect YAML list start (key with no value on same line, followed by - items)
    if (value === '') {
      currentListKey = key;
      continue;
    }

    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    frontmatter[key] = value;
  }

  // Merge YAML list values
  for (const [key, values] of Object.entries(listValues)) {
    if (frontmatter[key] !== undefined) {
      // If key already has a value, it's not a list
      continue;
    }
    frontmatter[key] = values;
  }

  return frontmatter;
}

/**
 * Parse the metadata field, which is inline JSON inside the frontmatter.
 */
function parseMetadata(metadataStr) {
  if (!metadataStr || metadataStr === '{}') return {};
  try {
    const parsed = JSON.parse(metadataStr);
    if (typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * Extract triggers from a skill's frontmatter and description.
 * - From `triggers` field (YAML list or comma-separated string)
 * - From `triggersOn` field
 * - From "Triggers on:" embedded in description
 */
function extractTriggers(frontmatter) {
  const triggers = new Set();

  // From triggers field (YAML list)
  const triggersField = frontmatter.triggers;
  if (Array.isArray(triggersField)) {
    for (const t of triggersField) {
      if (t && typeof t === 'string') triggers.add(t.trim());
    }
  } else if (typeof triggersField === 'string' && triggersField.trim()) {
    // Comma-separated string
    for (const t of triggersField.split(',')) {
      const trimmed = t.trim();
      if (trimmed) triggers.add(trimmed);
    }
  }

  // From triggersOn field
  const triggersOnField = frontmatter.triggersOn;
  if (Array.isArray(triggersOnField)) {
    for (const t of triggersOnField) {
      if (t && typeof t === 'string') triggers.add(t.trim());
    }
  } else if (typeof triggersOnField === 'string' && triggersOnField.trim()) {
    for (const t of triggersOnField.split(',')) {
      const trimmed = t.trim();
      if (trimmed) triggers.add(trimmed);
    }
  }

  // From "Triggers on:" embedded in description
  const desc = frontmatter.description || '';
  const triggersMatch = desc.match(/Triggers on:\s*(.+?)(?:\.\s*$|\.$|$)/i);
  if (triggersMatch) {
    const embeddedTriggers = triggersMatch[1].split(',').map(t => t.trim()).filter(Boolean);
    for (const t of embeddedTriggers) {
      triggers.add(t);
    }
  }

  return [...triggers].sort();
}

/**
 * Tokenize a string into lowercase words (removing punctuation).
 */
function tokenize(str) {
  if (!str) return [];
  return str
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Compute Jaccard similarity between two sets of tokens.
 */
function jaccardSimilarity(tokensA, tokensB) {
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  if (union.size === 0) return 0;
  return intersection.size / union.size;
}

/**
 * Compute Levenshtein distance between two strings.
 */
function levenshteinDistance(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }

  return dp[m][n];
}

/**
 * Determine the source root label from a file path.
 */
function getSourceRoot(filePath, repoRoot) {
  const rel = path.relative(repoRoot, filePath);
  const parsed = path.parse(rel);
  const parts = rel.split(path.sep);

  for (const root of SCAN_ROOTS) {
    const normalizedRoot = root.replace(/\//g, path.sep);
    if (rel.startsWith(normalizedRoot + path.sep) || rel === normalizedRoot) {
      return root;
    }
  }

  // Fallback: use the first directory component
  return parts[0] || 'unknown';
}

/**
 * Generate a skillId from sourceRoot and skill name.
 */
function makeSkillId(sourceRoot, name) {
  const rootTag = sourceRoot.replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return `${rootTag}::${name}`;
}

// ─── Analysis ────────────────────────────────────────────────────────────────

/**
 * Analyze all SKILL.md files and produce a quality report.
 */
function analyze(repoRoot) {
  const skills = [];
  const nameMap = new Map(); // name -> skillIds[]

  // Collect all SKILL.md files
  for (const scanRoot of SCAN_ROOTS) {
    const scanPath = path.join(repoRoot, scanRoot);
    const files = findSkillFiles(scanPath);
    for (const filePath of files) {
      const content = fs.readFileSync(filePath, 'utf8');
      const frontmatter = parseFrontmatter(content);
      const name = frontmatter.name || null;
      const description = frontmatter.description || null;
      const sourceRoot = getSourceRoot(filePath, repoRoot);

      // Build the skill entry
      const skillId = makeSkillId(sourceRoot, name || path.basename(path.dirname(filePath)));
      const descLength = description ? description.length : 0;
      const aliases = [];
      const metadata = parseMetadata(frontmatter.metadata);
      if (metadata.aliasKeys && Array.isArray(metadata.aliasKeys)) {
        aliases.push(...metadata.aliasKeys);
      }
      const triggers = extractTriggers(frontmatter);
      // Deduplicate aliases from name
      const uniqueAliases = [...new Set(aliases)];
      const diagnostics = [];

      // Check: missing metadata
      if (!name) {
        diagnostics.push({
          kind: 'missing-metadata',
          severity: 'error',
          message: `Missing 'name' field in frontmatter`,
          detail: {},
        });
      }
      if (!description) {
        diagnostics.push({
          kind: 'missing-metadata',
          severity: 'error',
          message: `Missing 'description' field in frontmatter`,
          detail: {},
        });
      }

      // Check: weak description
      if (description && descLength < 50) {
        diagnostics.push({
          kind: 'weak-description',
          severity: 'warning',
          message: `Description is too short (${descLength} chars, minimum 50)`,
          detail: { actualLength: descLength, minimumLength: 50 },
        });
      }

      skills.push({
        skillId,
        name,
        sourcePath: path.relative(repoRoot, filePath),
        sourceRoot,
        description,
        descriptionLength: descLength,
        aliases: uniqueAliases,
        triggers,
        diagnostics,
      });

      // Track name for duplicate detection
      if (name) {
        if (!nameMap.has(name)) nameMap.set(name, []);
        nameMap.get(name).push(skillId);
      }
    }
  }

  // Sort by skillId (deterministic)
  skills.sort((a, b) => a.skillId.localeCompare(b.skillId));

  // ── Cross-skill diagnostics ──

  // Duplicate names
  const duplicateNameIssues = [];
  for (const [name, skillIds] of nameMap.entries()) {
    if (skillIds.length > 1) {
      duplicateNameIssues.push({ name, skillIds: [...skillIds].sort() });
    }
  }
  for (const issue of duplicateNameIssues) {
    for (const skillId of issue.skillIds) {
      const skill = skills.find(s => s.skillId === skillId);
      if (skill) {
        skill.diagnostics.push({
          kind: 'duplicate-name',
          severity: 'warning',
          message: `Duplicate skill name '${issue.name}' shared with: ${issue.skillIds.filter(id => id !== skillId).join(', ')}`,
          detail: { duplicateName: issue.name, peerSkillIds: issue.skillIds.filter(id => id !== skillId) },
        });
      }
    }
  }

  // Duplicate aliases
  const aliasMap = new Map(); // alias -> skillIds[]
  for (const skill of skills) {
    for (const alias of skill.aliases) {
      if (!aliasMap.has(alias)) aliasMap.set(alias, []);
      aliasMap.get(alias).push(skill.skillId);
    }
  }
  const duplicateAliasIssues = [];
  for (const [alias, skillIds] of aliasMap.entries()) {
    if (skillIds.length > 1) {
      duplicateAliasIssues.push({ alias, skillIds: [...skillIds].sort() });
    }
  }
  for (const issue of duplicateAliasIssues) {
    for (const skillId of issue.skillIds) {
      const skill = skills.find(s => s.skillId === skillId);
      if (skill) {
        skill.diagnostics.push({
          kind: 'duplicate-alias',
          severity: 'warning',
          message: `Duplicate alias '${issue.alias}' shared with: ${issue.skillIds.filter(id => id !== skillId).join(', ')}`,
          detail: { duplicateAlias: issue.alias, peerSkillIds: issue.skillIds.filter(id => id !== skillId) },
        });
      }
    }
  }

  // Overlapping triggers and purpose overlaps
  const overlapClusters = [];
  for (let i = 0; i < skills.length; i++) {
    for (let j = i + 1; j < skills.length; j++) {
      const a = skills[i];
      const b = skills[j];

      // Trigger overlap
      const tokensA = a.triggers.flatMap(t => tokenize(t));
      const tokensB = b.triggers.flatMap(t => tokenize(t));
      const trigSim = jaccardSimilarity(tokensA, tokensB);

      if (trigSim > 0.3) {
        // Check that shared words include at least one non-trivial word (> 3 chars)
        const setA = new Set(tokensA);
        const setB = new Set(tokensB);
        const sharedWords = [...setA].filter(x => setB.has(x));
        const hasNonTrivial = sharedWords.some(w => w.length > 3);

        if (hasNonTrivial) {
          a.diagnostics.push({
            kind: 'overlapping-triggers',
            severity: 'info',
            message: `Trigger overlap (Jaccard=${trigSim.toFixed(3)}) with: ${b.skillId}`,
            detail: { peerSkillId: b.skillId, similarity: trigSim },
          });
          b.diagnostics.push({
            kind: 'overlapping-triggers',
            severity: 'info',
            message: `Trigger overlap (Jaccard=${trigSim.toFixed(3)}) with: ${a.skillId}`,
            detail: { peerSkillId: a.skillId, similarity: trigSim },
          });

          overlapClusters.push({
            skills: [a.skillId, b.skillId].sort(),
            reason: 'overlapping-triggers',
            score: trigSim,
          });
        }
      }

      // Purpose overlap via similar names
      if (a.name && b.name) {
        const dist = levenshteinDistance(a.name.toLowerCase(), b.name.toLowerCase());
        if (dist < 3) {
          a.diagnostics.push({
            kind: 'purpose-overlap',
            severity: 'info',
            message: `Similar name (Levenshtein distance=${dist}) with: ${b.skillId}`,
            detail: { peerSkillId: b.skillId, similarity: dist, reason: 'similar-names' },
          });
          b.diagnostics.push({
            kind: 'purpose-overlap',
            severity: 'info',
            message: `Similar name (Levenshtein distance=${dist}) with: ${a.skillId}`,
            detail: { peerSkillId: a.skillId, similarity: dist, reason: 'similar-names' },
          });
          overlapClusters.push({
            skills: [a.skillId, b.skillId].sort(),
            reason: 'similar-names',
            score: dist,
          });
        }
      }

      // Purpose overlap via similar descriptions
      if (a.description && b.description) {
        const descTokensA = tokenize(a.description);
        const descTokensB = tokenize(b.description);
        const descSim = jaccardSimilarity(descTokensA, descTokensB);
        if (descSim > 0.5) {
          a.diagnostics.push({
            kind: 'purpose-overlap',
            severity: 'info',
            message: `Similar description (Jaccard=${descSim.toFixed(3)}) with: ${b.skillId}`,
            detail: { peerSkillId: b.skillId, similarity: descSim, reason: 'similar-descriptions' },
          });
          b.diagnostics.push({
            kind: 'purpose-overlap',
            severity: 'info',
            message: `Similar description (Jaccard=${descSim.toFixed(3)}) with: ${a.skillId}`,
            detail: { peerSkillId: a.skillId, similarity: descSim, reason: 'similar-descriptions' },
          });
          overlapClusters.push({
            skills: [a.skillId, b.skillId].sort(),
            reason: 'similar-descriptions',
            score: descSim,
          });
        }
      }
    }
  }

  // Deduplicate diagnostics
  for (const skill of skills) {
    const seen = new Set();
    skill.diagnostics = skill.diagnostics.filter(d => {
      let key;
      if (d.kind === 'overlapping-triggers') {
        const peer = d.detail?.peerSkillId;
        key = peer ? [skill.skillId, peer].sort().join('::') + '::triggers' : d.message;
      } else if (d.kind === 'purpose-overlap') {
        const peer = d.detail?.peerSkillId;
        const reason = d.detail?.reason || '';
        key = peer ? [skill.skillId, peer].sort().join('::') + '::' + reason : d.message;
      } else {
        key = d.kind + d.message;
      }
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // Sort diagnostics by kind then message (deterministic)
  for (const skill of skills) {
    skill.diagnostics.sort((a, b) => {
      const kindCmp = a.kind.localeCompare(b.kind);
      if (kindCmp !== 0) return kindCmp;
      return a.message.localeCompare(b.message);
    });
  }

  // Deduplicate and sort overlap clusters
  const uniqueClusters = [];
  const clusterSeen = new Set();
  for (const cluster of overlapClusters) {
    const key = cluster.skills.join('::') + '::' + cluster.reason;
    if (clusterSeen.has(key)) continue;
    clusterSeen.add(key);
    uniqueClusters.push(cluster);
  }

  // Sort overlap clusters by score descending, then skill IDs
  uniqueClusters.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.skills.join(',').localeCompare(b.skills.join(','));
  });

  // ── Summary counts ──
  let missingMetadata = 0;
  let weakDescriptions = 0;
  let duplicateNames = 0;
  let duplicateAliases = 0;
  let overlappingTriggers = 0;
  let purposeOverlaps = 0;

  for (const skill of skills) {
    for (const d of skill.diagnostics) {
      switch (d.kind) {
        case 'missing-metadata': missingMetadata++; break;
        case 'weak-description': weakDescriptions++; break;
        case 'duplicate-name': duplicateNames++; break;
        case 'duplicate-alias': duplicateAliases++; break;
        case 'overlapping-triggers': overlappingTriggers++; break;
        case 'purpose-overlap': purposeOverlaps++; break;
      }
    }
  }

  const skillsWithIssues = skills.filter(s => s.diagnostics.length > 0);

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    summary: {
      totalSkills: skills.length,
      skillsWithIssues: skillsWithIssues.length,
      missingMetadata,
      weakDescriptions,
      duplicateNames,
      duplicateAliases,
      overlappingTriggers,
      purposeOverlaps,
    },
    skills,
    overlapClusters: uniqueClusters,
  };

  return report;
}

/**
 * Generate markdown audit report content.
 */
function generateMarkdownAudit(report) {
  const lines = [];

  // Title
  lines.push('# Shipped Skill Quality Audit');
  lines.push('');
  lines.push(`Generated at: ${report.generatedAt}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Total skills | ${report.summary.totalSkills} |`);
  lines.push(`| Skills with issues | ${report.summary.skillsWithIssues} |`);
  lines.push(`| Missing metadata diagnostics | ${report.summary.missingMetadata} |`);
  lines.push(`| Weak description diagnostics | ${report.summary.weakDescriptions} |`);
  lines.push(`| Duplicate name diagnostics | ${report.summary.duplicateNames} |`);
  lines.push(`| Duplicate alias diagnostics | ${report.summary.duplicateAliases} |`);
  lines.push(`| Overlapping trigger diagnostics | ${report.summary.overlappingTriggers} |`);
  lines.push(`| Purpose overlap diagnostics | ${report.summary.purposeOverlaps} |`);
  lines.push('');

  // Skills without issues
  const cleanSkills = report.skills.filter(s => s.diagnostics.length === 0);
  if (cleanSkills.length > 0) {
    lines.push('## Skills Without Issues');
    lines.push('');
    for (const skill of cleanSkills) {
      lines.push(`- \`${skill.skillId}\` — ${skill.sourcePath}`);
    }
    lines.push('');
  }

  // ── Diagnostic sections ──

  // Missing metadata
  const missingMeta = report.skills.filter(s =>
    s.diagnostics.some(d => d.kind === 'missing-metadata')
  );
  if (missingMeta.length > 0) {
    lines.push('## Missing Metadata');
    lines.push('');
    for (const skill of missingMeta) {
      lines.push(`- **\`${skill.skillId}\`** (\`${skill.sourcePath}\`)`);
      for (const d of skill.diagnostics.filter(d => d.kind === 'missing-metadata')) {
        lines.push(`  - ${d.severity.toUpperCase()}: ${d.message}`);
      }
    }
    lines.push('');
  }

  // Weak descriptions
  const weakDesc = report.skills.filter(s =>
    s.diagnostics.some(d => d.kind === 'weak-description')
  );
  if (weakDesc.length > 0) {
    lines.push('## Weak Descriptions');
    lines.push('');
    for (const skill of weakDesc) {
      lines.push(`- **\`${skill.skillId}\`** (\`${skill.sourcePath}\`) — ${skill.descriptionLength} chars`);
      lines.push(`  - Description: "${skill.description}"`);
    }
    lines.push('');
  }

  // Duplicate names
  const dupNames = report.skills.filter(s =>
    s.diagnostics.some(d => d.kind === 'duplicate-name')
  );
  if (dupNames.length > 0) {
    lines.push('## Duplicate Names');
    lines.push('');
    const groups = new Map();
    for (const skill of dupNames) {
      for (const d of skill.diagnostics.filter(d => d.kind === 'duplicate-name')) {
        const dupName = d.detail?.duplicateName || 'unknown';
        if (!groups.has(dupName)) groups.set(dupName, []);
        groups.get(dupName).push(skill);
      }
    }
    for (const [dupName, skills] of groups) {
      lines.push(`- Name: \`${dupName}\``);
      for (const skill of skills) {
        lines.push(`  - \`${skill.skillId}\` (\`${skill.sourcePath}\`)`);
      }
    }
    lines.push('');
  }

  // Duplicate aliases
  const dupAliases = report.skills.filter(s =>
    s.diagnostics.some(d => d.kind === 'duplicate-alias')
  );
  if (dupAliases.length > 0) {
    lines.push('## Duplicate Aliases');
    lines.push('');
    const aliasGroups = new Map();
    for (const skill of dupAliases) {
      for (const d of skill.diagnostics.filter(d => d.kind === 'duplicate-alias')) {
        const alias = d.detail?.duplicateAlias || 'unknown';
        if (!aliasGroups.has(alias)) aliasGroups.set(alias, []);
        aliasGroups.get(alias).push(skill);
      }
    }
    for (const [alias, skills] of aliasGroups) {
      lines.push(`- Alias: \`${alias}\``);
      for (const skill of skills) {
        lines.push(`  - \`${skill.skillId}\` (\`${skill.sourcePath}\`)`);
      }
    }
    lines.push('');
  }

  // Overlapping triggers
  const overlappingTriggerClusters = report.overlapClusters.filter(c => c.reason === 'overlapping-triggers');
  if (overlappingTriggerClusters.length > 0) {
    lines.push('## Overlapping Triggers');
    lines.push('');
    for (const cluster of overlappingTriggerClusters) {
      const [a, b] = cluster.skills;
      lines.push(`- **Pair**: \`${a}\` ↔ \`${b}\` (Jaccard similarity: ${cluster.score.toFixed(3)})`);
    }
    lines.push('');
  }

  // Purpose overlaps
  const similarNameClusters = report.overlapClusters.filter(c => c.reason === 'similar-names');
  const similarDescClusters = report.overlapClusters.filter(c => c.reason === 'similar-descriptions');

  if (similarNameClusters.length > 0 || similarDescClusters.length > 0) {
    lines.push('## Purpose Overlaps');
    lines.push('');

    if (similarNameClusters.length > 0) {
      lines.push('### Similar Names');
      lines.push('');
      for (const cluster of similarNameClusters) {
        const [a, b] = cluster.skills;
        lines.push(`- \`${a}\` ↔ \`${b}\` (Levenshtein distance: ${cluster.score})`);
      }
      lines.push('');
    }

    if (similarDescClusters.length > 0) {
      lines.push('### Similar Descriptions');
      lines.push('');
      for (const cluster of similarDescClusters) {
        const [a, b] = cluster.skills;
        lines.push(`- \`${a}\` ↔ \`${b}\` (Jaccard similarity: ${cluster.score.toFixed(3)})`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ─── CLI Entrypoint ──────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  let repoRoot = REPO_ROOT;
  let writeMd = true;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--repoRoot' && i + 1 < args.length) {
      repoRoot = path.resolve(args[++i]);
    } else if (args[i] === '--no-write-md') {
      writeMd = false;
    } else if (args[i] === '--help') {
      console.log(`Usage: node scripts/analyze-shipped-skill-quality.mjs [options]

Options:
  --repoRoot <path>   Override repo root (default: parent of scripts/)
  --no-write-md       Skip writing the markdown audit report
  --help              Show this help`);
      process.exit(0);
    }
  }

  const report = analyze(repoRoot);

  // Output JSON to stdout
  console.log(JSON.stringify(report, null, 2));

  // Write markdown audit
  if (writeMd) {
    const mdDir = path.join(repoRoot, 'docs', 'research');
    const mdPath = path.join(mdDir, 'shipped-skill-quality-audit.md');
    if (!fs.existsSync(mdDir)) {
      fs.mkdirSync(mdDir, { recursive: true });
    }
    const markdown = generateMarkdownAudit(report);
    fs.writeFileSync(mdPath, markdown, 'utf8');
    console.error(`\nMarkdown audit written to: ${mdPath}`);
  }

  // Also write JSON to temp file for reference
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-quality-'));
  const tmpJsonPath = path.join(tmpDir, 'skill-quality-report.json');
  fs.writeFileSync(tmpJsonPath, JSON.stringify(report, null, 2), 'utf8');
  console.error(`JSON report written to: ${tmpJsonPath}`);
}

main();
