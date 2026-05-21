#!/usr/bin/env node
const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const scriptPath = path.resolve(__dirname, 'skill-forge.mjs');
const skillsRoot = path.resolve(repoRoot, 'engine-assets', 'skills');
const indexPath = path.resolve(skillsRoot, 'skill-metadata-index.json');
const manifestPath = path.resolve(repoRoot, 'engine-assets', 'manifest.json');

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

function run(...args) {
	return childProcess.spawnSync(process.execPath, [scriptPath, ...args], {
		cwd: repoRoot,
		stdio: 'pipe',
		encoding: 'utf8',
	});
}

function cleanup(skillName) {
	const skillDir = path.join(skillsRoot, skillName);
	if (fs.existsSync(skillDir)) {
		fs.rmSync(skillDir, { recursive: true, force: true });
	}

	const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
	const assetId = `skill-${skillName}`;
	const nextAssets = Array.isArray(manifest.assets)
		? manifest.assets.filter((asset) => asset && asset.id !== assetId)
		: [];
	if (nextAssets.length !== (Array.isArray(manifest.assets) ? manifest.assets.length : 0)) {
		manifest.assets = nextAssets;
		fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
	}
}

const testSkillName = 'test-forge-skill-tmp';

// Cleanup before and after
cleanup(testSkillName);

// --- Tests ---

test('dry-run prints skill content without writing', () => {
	const result = run(
		'--dry-run',
		'--name', testSkillName,
		'--description', 'A test skill for forge',
		'--triggers', 'test trigger,another trigger',
		'--constraints', 'scope:project',
		'--keywords', 'kw1,kw2',
	);
	assert.strictEqual(result.status, 0, `exit: ${result.status}, stderr: ${result.stderr}`);
	assert.ok(result.stdout.includes('[dry-run]'), 'expected dry-run marker');
	assert.ok(result.stdout.includes(testSkillName), 'expected skill name in output');
	assert.ok(result.stdout.includes('## Purpose'), 'expected Purpose section');
	assert.ok(!fs.existsSync(path.join(skillsRoot, testSkillName, 'SKILL.md')), 'file should not exist after dry-run');
});

test('rejects non-kebab-case name', () => {
	const result = run('--name', 'My Skill', '--description', 'Bad', '--triggers', 'x');
	assert.strictEqual(result.status, 1);
	assert.ok(result.stderr.includes('kebab-case'), `expected kebab-case error, got: ${result.stderr}`);
});

test('rejects missing name', () => {
	const result = run('--description', 'Missing name', '--triggers', 'x');
	assert.strictEqual(result.status, 1);
	assert.ok(result.stderr.includes('--name'), `expected name required error, got: ${result.stderr}`);
});

test('rejects missing triggers', () => {
	const result = run('--name', testSkillName, '--description', 'No triggers');
	assert.strictEqual(result.status, 1);
	assert.ok(result.stderr.includes('--triggers'), `expected triggers required error, got: ${result.stderr}`);
});

test('rejects missing description', () => {
	const result = run('--name', testSkillName, '--triggers', 'x');
	assert.strictEqual(result.status, 1);
	assert.ok(result.stderr.includes('--description'), `expected description required error, got: ${result.stderr}`);
});

test('creates skill and regenerates index', () => {
	cleanup(testSkillName);
	const indexBefore = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
	const countBefore = indexBefore.entries.length;

	const result = run(
		'--name', testSkillName,
		'--description', 'A temporary test skill',
		'--triggers', 'forge test,temp skill',
		'--keywords', 'testing',
	);
	assert.strictEqual(result.status, 0, `exit: ${result.status}, stderr: ${result.stderr}`);
	assert.ok(result.stdout.includes('Created:'), 'expected Created message');
	assert.ok(result.stdout.includes('Regenerated'), 'expected index regeneration message');

	// Verify file exists
	const skillMd = path.join(skillsRoot, testSkillName, 'SKILL.md');
	assert.ok(fs.existsSync(skillMd), 'SKILL.md should exist');

	// Verify content
	const content = fs.readFileSync(skillMd, 'utf8');
	assert.ok(content.includes('---'), 'expected frontmatter');
	assert.ok(content.includes(`name: ${testSkillName}`), 'expected name in frontmatter');
	assert.ok(content.includes('## Purpose'), 'expected Purpose section');
	assert.ok(content.includes('## When to Use'), 'expected When to Use section');

	// Verify index was updated
	const indexAfter = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
	assert.strictEqual(indexAfter.entries.length, countBefore + 1, 'expected one more entry in index');
	const newEntry = indexAfter.entries.find((e) => e.skill === testSkillName);
	assert.ok(newEntry, 'expected new entry in index');
	const manifestAfter = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
	assert.ok(manifestAfter.assets.some((asset) => asset && asset.id === `skill-${testSkillName}`), 'expected manifest asset entry');

	cleanup(testSkillName);
});

test('refuses to overwrite existing skill', () => {
	// Create a skill first
	const skillDir = path.join(skillsRoot, testSkillName);
	fs.mkdirSync(skillDir, { recursive: true });
	fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# existing', 'utf8');

	const result = run(
		'--name', testSkillName,
		'--description', 'Overwrite attempt',
		'--triggers', 'x',
	);
	assert.strictEqual(result.status, 1);
	assert.ok(result.stderr.includes('already exists'), `expected exists error, got: ${result.stderr}`);

	cleanup(testSkillName);
});

// Final cleanup and regenerate index to restore original state
cleanup(testSkillName);
try {
	childProcess.spawnSync(process.execPath, [path.resolve(__dirname, 'generate-skill-metadata-index.mjs')], {
		cwd: repoRoot,
		stdio: 'pipe',
	});
} catch { /* best effort */ }

console.log(`\nskill-forge tests: ${passed} passed`);
