#!/usr/bin/env node

/**
 * analyze-shipped-skill-quality.test.js
 *
 * Tests for the shipped-skill-quality analyzer using temp directory fixtures.
 *
 * Usage:
 *   node --test scripts/analyze-shipped-skill-quality.test.js
 *   node scripts/analyze-shipped-skill-quality.test.js
 */

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const analyzerPath = path.resolve(__dirname, 'analyze-shipped-skill-quality.mjs');

let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS: ${name}`);
  } catch (error) {
    console.error(`  FAIL: ${name}`);
    console.error(`    ${error.message}`);
    process.exitCode = 1;
  }
}

function writeFile(root, relativePath, content) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function withTempRepoFixture(files, fn) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-quality-test-'));
  try {
    for (const [relativePath, content] of Object.entries(files)) {
      writeFile(tempRoot, relativePath, content);
    }
    fn(tempRoot);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function runAnalyzer(repoRoot) {
  const result = childProcess.spawnSync(process.execPath, [
    analyzerPath, '--repoRoot', repoRoot, '--no-write-md',
  ], {
    cwd: repoRoot,
    stdio: 'pipe',
    encoding: 'utf8',
  });

  // Parse the JSON from stdout (there may be stderr messages about temp file paths)
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';

  // The JSON is the first thing on stdout
  const jsonStart = stdout.indexOf('{');
  const jsonEnd = stdout.lastIndexOf('}');
  if (jsonStart === -1 || jsonEnd === -1) {
    throw new Error(`No JSON found in stdout.\nstdout: ${stdout}\nstderr: ${stderr}`);
  }

  return {
    report: JSON.parse(stdout.slice(jsonStart, jsonEnd + 1)),
    status: result.status,
    stderr,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

test('empty directory produces empty results', () => {
  withTempRepoFixture({
    'engine-assets/skills/.gitkeep': '',
    'catalog-assets/shared-skills/.gitkeep': '',
    'codex-assets/skills/.gitkeep': '',
    'opencode-assets/skills/.gitkeep': '',
  }, (tempRoot) => {
    const { report, status } = runAnalyzer(tempRoot);
    assert.strictEqual(status, 0);
    assert.strictEqual(report.summary.totalSkills, 0);
    assert.strictEqual(report.skills.length, 0);
    assert.strictEqual(report.overlapClusters.length, 0);
  });
});

test('no frontmatter produces missing-metadata diagnostic', () => {
  withTempRepoFixture({
    'engine-assets/skills/no-frontmatter/SKILL.md': '# Just content\nNo frontmatter at all.\n',
  }, (tempRoot) => {
    const { report, status } = runAnalyzer(tempRoot);
    assert.strictEqual(status, 0);
    assert.strictEqual(report.summary.totalSkills, 1);
    assert.strictEqual(report.skills.length, 1);

    const skill = report.skills[0];
    assert.strictEqual(skill.name, null);
    assert.strictEqual(skill.description, null);

    const missingMetaDiags = skill.diagnostics.filter(d => d.kind === 'missing-metadata');
    assert.strictEqual(missingMetaDiags.length, 2, 'expected 2 missing-metadata diagnostics (name + description)');
    assert.ok(missingMetaDiags.some(d => d.message.includes('name')));
    assert.ok(missingMetaDiags.some(d => d.message.includes('description')));
  });
});

test('weak description (< 50 chars) produces weak-description diagnostic', () => {
  withTempRepoFixture({
    'engine-assets/skills/shortie/SKILL.md': [
      '---',
      'name: shortie',
      'description: "Too short."',
      '---',
      '# Shortie',
    ].join('\n'),
  }, (tempRoot) => {
    const { report, status } = runAnalyzer(tempRoot);
    assert.strictEqual(status, 0);
    assert.strictEqual(report.summary.totalSkills, 1);

    const skill = report.skills[0];
    assert.strictEqual(skill.name, 'shortie');
    assert.strictEqual(skill.descriptionLength, 10);

    const weakDiags = skill.diagnostics.filter(d => d.kind === 'weak-description');
    assert.strictEqual(weakDiags.length, 1);
    assert.ok(weakDiags[0].message.includes('10 chars'));
  });
});

test('two skills with same name produce duplicate-name diagnostics', () => {
  withTempRepoFixture({
    'engine-assets/skills/dupe/SKILL.md': [
      '---',
      'name: duplicate-skill',
      'description: "First copy of duplicate skill."',
      '---',
      '# Dupe 1',
    ].join('\n'),
    'opencode-assets/skills/dupe/SKILL.md': [
      '---',
      'name: duplicate-skill',
      'description: "Second copy of duplicate skill."',
      '---',
      '# Dupe 2',
    ].join('\n'),
  }, (tempRoot) => {
    const { report, status } = runAnalyzer(tempRoot);
    assert.strictEqual(status, 0);
    assert.strictEqual(report.summary.totalSkills, 2);

    // Both should have duplicate-name diagnostics
    const skillsWithDuplicateName = report.skills.filter(s =>
      s.diagnostics.some(d => d.kind === 'duplicate-name')
    );
    assert.strictEqual(skillsWithDuplicateName.length, 2);

    // Summary should count 2 duplicate name diagnostics
    assert.strictEqual(report.summary.duplicateNames, 2);
  });
});

test('two skills with overlapping triggers produce overlapping-triggers diagnostics', () => {
  withTempRepoFixture({
    'engine-assets/skills/detector/SKILL.md': [
      '---',
      'name: detector',
      'description: "Detects things. Triggers on: detect, analysis, scan, find patterns, identify issues."',
      '---',
      '# Detector',
    ].join('\n'),
    'opencode-assets/skills/scanner/SKILL.md': [
      '---',
      'name: scanner',
      'description: "Scans things. Triggers on: scan, analysis, detect, find anomalies, report findings."',
      '---',
      '# Scanner',
    ].join('\n'),
  }, (tempRoot) => {
    const { report, status } = runAnalyzer(tempRoot);
    assert.strictEqual(status, 0);
    assert.strictEqual(report.summary.totalSkills, 2);

    // Triggers: detector has "detect, analysis, scan, find patterns, identify issues"
    // scanner has "scan, analysis, detect, find anomalies, report findings"
    // Common tokens: detect, analysis, scan, find (also patterns vs anomalies)
    // Tokenize: detetc/analysis/scan/find/patterns/identify/issues and scan/analysis/detect/find/anomalies/report/findings
    // Jaccard: intersect {analysis, detect, find, scan} = 4, union {analysis, anomalies, detect, find, findings, identify, issues, patterns, report, scan} = 10
    // 4/10 = 0.4 > 0.3, and shared non-trivial words exist (analysis, detect, find, scan each >3 chars)
    // So there should be overlapping-triggers diagnostics

    const skillsWithTriggerOverlap = report.skills.filter(s =>
      s.diagnostics.some(d => d.kind === 'overlapping-triggers')
    );
    assert.strictEqual(skillsWithTriggerOverlap.length, 2,
      'expected both skills to have overlapping-triggers diagnostics');

    // Summary should count 2 overlapping trigger diagnostics (one per skill)
    assert.strictEqual(report.summary.overlappingTriggers, 2);
  });
});

test('two skills with weak trigger overlap (Jaccard=0.2) do NOT produce overlapping-triggers diagnostics', () => {
  withTempRepoFixture({
    'engine-assets/skills/alpha/SKILL.md': [
      '---',
      'name: alpha',
      'description: "Alpha skill. Triggers on: alpha, something, else."',
      '---',
      '# Alpha',
    ].join('\n'),
    'opencode-assets/skills/beta/SKILL.md': [
      '---',
      'name: beta',
      'description: "Beta skill. Triggers on: beta, another, thing, completely."',
      '---',
      '# Beta',
    ].join('\n'),
  }, (tempRoot) => {
    const { report, status } = runAnalyzer(tempRoot);
    assert.strictEqual(status, 0);
    assert.strictEqual(report.summary.totalSkills, 2);

    // Tokens: alpha/something/else vs beta/another/thing/completely
    // Jaccard = 0/7 = 0, no overlap
    const skillsWithTriggerOverlap = report.skills.filter(s =>
      s.diagnostics.some(d => d.kind === 'overlapping-triggers')
    );
    assert.strictEqual(skillsWithTriggerOverlap.length, 0);
  });
});

test('output is deterministic across identical inputs', () => {
  const files = {
    'engine-assets/skills/a/SKILL.md': [
      '---',
      'name: skill-a',
      'description: "First test skill. Triggers on: alpha, beta, gamma."',
      '---',
      '# Skill A',
    ].join('\n'),
    'opencode-assets/skills/b/SKILL.md': [
      '---',
      'name: skill-b',
      'description: "Second test skill. Triggers on: delta, epsilon, zeta."',
      '---',
      '# Skill B',
    ].join('\n'),
  };

  let firstResult, secondResult;

  withTempRepoFixture(files, (tempRoot) => {
    firstResult = runAnalyzer(tempRoot);
  });

  withTempRepoFixture(files, (tempRoot) => {
    secondResult = runAnalyzer(tempRoot);
  });

  assert.strictEqual(firstResult.status, 0);
  assert.strictEqual(secondResult.status, 0);

  // Strip generatedAt (timestamp will differ) and compare the rest
  const firstNormalized = { ...firstResult.report, generatedAt: '' };
  const secondNormalized = { ...secondResult.report, generatedAt: '' };
  const firstJson = JSON.stringify(firstNormalized);
  const secondJson = JSON.stringify(secondNormalized);

  assert.strictEqual(firstJson, secondJson, 'output should be deterministic across identical inputs');
});

test('skills from different source roots are correctly attributed', () => {
  withTempRepoFixture({
    'engine-assets/skills/engine-skill/SKILL.md': [
      '---',
      'name: my-skill',
      'description: "Engine skill."',
      '---',
      '# Engine',
    ].join('\n'),
    'catalog-assets/shared-skills/catalog-skill/SKILL.md': [
      '---',
      'name: my-skill',
      'description: "Catalog skill."',
      '---',
      '# Catalog',
    ].join('\n'),
    'codex-assets/skills/codex-skill/SKILL.md': [
      '---',
      'name: codex-skill',
      'description: "Codex skill."',
      '---',
      '# Codex',
    ].join('\n'),
    'opencode-assets/skills/opencode-skill/SKILL.md': [
      '---',
      'name: opencode-skill',
      'description: "OpenCode skill."',
      '---',
      '# OpenCode',
    ].join('\n'),
  }, (tempRoot) => {
    const { report, status } = runAnalyzer(tempRoot);
    assert.strictEqual(status, 0);
    assert.strictEqual(report.summary.totalSkills, 4);

    for (const skill of report.skills) {
      if (skill.skillId.startsWith('engine-assets')) {
        assert.strictEqual(skill.sourceRoot, 'engine-assets/skills');
        assert.ok(skill.sourcePath.startsWith('engine-assets'));
      } else if (skill.skillId.startsWith('catalog-assets')) {
        assert.strictEqual(skill.sourceRoot, 'catalog-assets/shared-skills');
        assert.ok(skill.sourcePath.startsWith('catalog-assets'));
      } else if (skill.skillId.startsWith('codex-assets')) {
        assert.strictEqual(skill.sourceRoot, 'codex-assets/skills');
        assert.ok(skill.sourcePath.startsWith('codex-assets'));
      } else if (skill.skillId.startsWith('opencode-assets')) {
        assert.strictEqual(skill.sourceRoot, 'opencode-assets/skills');
        assert.ok(skill.sourcePath.startsWith('opencode-assets'));
      } else {
        assert.fail(`unexpected skillId: ${skill.skillId}`);
      }
    }
  });
});

test('duplicate aliases are detected', () => {
  withTempRepoFixture({
    'engine-assets/skills/skill-a/SKILL.md': [
      '---',
      'name: skill-a',
      'description: "Skill A with shared alias."',
      'metadata: {"aliasKeys":["shared-alias","unique-a"]}',
      '---',
      '# Skill A',
    ].join('\n'),
    'opencode-assets/skills/skill-b/SKILL.md': [
      '---',
      'name: skill-b',
      'description: "Skill B with shared alias."',
      'metadata: {"aliasKeys":["shared-alias","unique-b"]}',
      '---',
      '# Skill B',
    ].join('\n'),
  }, (tempRoot) => {
    const { report, status } = runAnalyzer(tempRoot);
    assert.strictEqual(status, 0);
    assert.strictEqual(report.summary.totalSkills, 2);

    const skillsWithDupAlias = report.skills.filter(s =>
      s.diagnostics.some(d => d.kind === 'duplicate-alias')
    );
    assert.strictEqual(skillsWithDupAlias.length, 2);
    assert.strictEqual(report.summary.duplicateAliases, 2);
  });
});

test('purpose overlap via similar names (Levenshtein < 3) is detected', () => {
  withTempRepoFixture({
    'engine-assets/skills/tool/SKILL.md': [
      '---',
      'name: tool',
      'description: "A tool skill."',
      '---',
      '# Tool',
    ].join('\n'),
    'opencode-assets/skills/tools/SKILL.md': [
      '---',
      'name: tools',
      'description: "A tools skill."',
      '---',
      '# Tools',
    ].join('\n'),
  }, (tempRoot) => {
    const { report, status } = runAnalyzer(tempRoot);
    assert.strictEqual(status, 0);
    assert.strictEqual(report.summary.totalSkills, 2);

    // Levenshtein('tool', 'tools') = 1 < 3
    const purposeOverlapDiags = report.skills.filter(s =>
      s.diagnostics.some(d => d.kind === 'purpose-overlap' && d.detail?.reason === 'similar-names')
    );
    assert.strictEqual(purposeOverlapDiags.length, 2);

    // Should also appear in overlapClusters
    const nameClusters = report.overlapClusters.filter(c => c.reason === 'similar-names');
    assert.ok(nameClusters.length >= 1, 'expected similar-names overlap cluster');
  });
});

test('BOM in SKILL.md is handled correctly', () => {
  withTempRepoFixture({
    'engine-assets/skills/bom-skill/SKILL.md': '\ufeff---\nname: bom-skill\ndescription: "Skill with BOM in file."\n---\n# BOM Skill\n',
  }, (tempRoot) => {
    const { report, status } = runAnalyzer(tempRoot);
    assert.strictEqual(status, 0);
    assert.strictEqual(report.summary.totalSkills, 1);
    assert.strictEqual(report.skills[0].name, 'bom-skill');
    assert.strictEqual(report.skills[0].description, 'Skill with BOM in file.');
  });
});

test('YAML trigger list in frontmatter is parsed', () => {
  withTempRepoFixture({
    'engine-assets/skills/yaml-triggers/SKILL.md': [
      '---',
      'name: yaml-triggers',
      'description: "Skill with YAML list triggers."',
      'triggers:',
      '  - trigger-one',
      '  - trigger-two',
      '  - trigger-three',
      '---',
      '# YAML Triggers',
    ].join('\n'),
  }, (tempRoot) => {
    const { report, status } = runAnalyzer(tempRoot);
    assert.strictEqual(status, 0);
    assert.strictEqual(report.summary.totalSkills, 1);

    const skill = report.skills[0];
    assert.deepStrictEqual(skill.triggers, ['trigger-one', 'trigger-three', 'trigger-two']);
  });
});

test('JSON schema version is always 1', () => {
  withTempRepoFixture({
    'engine-assets/skills/s/SKILL.md': [
      '---',
      'name: schema-test',
      'description: "Testing schema version."',
      '---',
      '# Test',
    ].join('\n'),
  }, (tempRoot) => {
    const { report, status } = runAnalyzer(tempRoot);
    assert.strictEqual(status, 0);
    assert.strictEqual(report.schemaVersion, 1);
    assert.ok(report.generatedAt, 'generatedAt should be present');
    assert.ok(Date.parse(report.generatedAt), 'generatedAt should be valid ISO timestamp');
  });
});

test('empty directories in some scan roots work fine', () => {
  withTempRepoFixture({
    'engine-assets/skills/some-skill/SKILL.md': [
      '---',
      'name: some-skill',
      'description: "A skill in engine-assets only."',
      '---',
      '# Some Skill',
    ].join('\n'),
    // Other scan roots don't exist at all
  }, (tempRoot) => {
    const { report, status } = runAnalyzer(tempRoot);
    assert.strictEqual(status, 0);
    assert.strictEqual(report.summary.totalSkills, 1);
    assert.strictEqual(report.skills[0].name, 'some-skill');
    assert.strictEqual(report.skills[0].sourceRoot, 'engine-assets/skills');
  });
});

console.log(`\n${passed} tests passed`);
if (process.exitCode) {
  console.error('Some tests FAILED');
} else {
  console.log('All tests passed');
}
