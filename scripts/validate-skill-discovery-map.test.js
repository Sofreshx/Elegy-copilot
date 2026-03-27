#!/usr/bin/env node
const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
	validateSkillMetadataParityGate,
} = require('./validate-skill-discovery-map.js');

const validatorPath = path.resolve(__dirname, 'validate-skill-discovery-map.js');
const repoRoot = path.resolve(__dirname, '..');

let passed = 0;

async function test(name, fn) {
	try {
		await fn();
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

async function withTempRepoFixture(files, fn) {
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-skill-discovery-parity-'));
	try {
		for (const [relativePath, content] of Object.entries(files)) {
			writeFile(tempRoot, relativePath, content);
		}
		return await fn(tempRoot);
	} finally {
		fs.rmSync(tempRoot, { recursive: true, force: true });
	}
}

async function main() {
	await test('validate-skill-discovery-map passes on current repository state', async () => {
		const result = childProcess.spawnSync(process.execPath, [validatorPath], {
			cwd: repoRoot,
			stdio: 'pipe',
			encoding: 'utf8',
		});

		assert.strictEqual(result.status, 0, `validator should pass: ${result.stderr}`);
		assert.match(String(result.stdout || ''), /Skill Metadata Parity Gate ok/);
	});

	await test('validate-skill-discovery-map uses repoRoot override for generated index creation', async () => {
		const committedIndex = {
			schemaVersion: 1,
			entries: [
				{
					skill: 'alpha',
					name: 'Alpha Skill',
					description: 'Alpha skill. Triggers on: repo override parity',
					triggersOn: ['repo override parity'],
					aliasKeys: ['alpha-alias'],
					frameworks: ['node'],
					stacks: ['tooling'],
					languages: ['javascript'],
					tags: ['parity'],
					manifest: {
						id: 'alpha-skill',
						loadMode: 'manual',
					},
				},
			],
		};

		await withTempRepoFixture(
			{
				'engine-assets/manifest.json': `${JSON.stringify({
					assets: [
						{
							type: 'skill',
							source: 'engine-assets/skills/alpha',
							id: 'alpha-skill',
							loadMode: 'manual',
						},
					],
				}, null, 2)}\n`,
				'engine-assets/skills/alpha/SKILL.md': [
					'---',
					'name: Alpha Skill',
					'description: "Alpha skill. Triggers on: repo override parity"',
					'metadata: {"aliasKeys":["alpha-alias"],"frameworks":["node"],"stacks":["tooling"],"languages":["javascript"],"tags":["parity"]}',
					'---',
					'',
					'# Alpha Skill',
				].join('\n'),
				'engine-assets/skills/skill-metadata-index.json': `${JSON.stringify(committedIndex, null, 2)}\n`,
			},
			async (tempRoot) => {
				const result = await validateSkillMetadataParityGate({
					repoRoot: tempRoot,
				});

				assert.deepStrictEqual(result.errors, []);
				assert.strictEqual(
					result.committedIndexPath,
					path.join(tempRoot, 'engine-assets', 'skills', 'skill-metadata-index.json')
				);
			}
		);
	});

	await test('validate-skill-discovery-map reports stale committed metadata index drift', async () => {
		const committedIndex = {
			schemaVersion: 1,
			entries: [
				{ skill: 'alpha', name: 'Alpha', triggersOn: [] },
			],
		};
		const expectedIndex = {
			schemaVersion: 1,
			entries: [
				{ skill: 'alpha', name: 'Alpha', triggersOn: ['metadata drift'] },
			],
		};

		await withTempRepoFixture(
			{
				'engine-assets/skills/skill-metadata-index.json': `${JSON.stringify(committedIndex, null, 2)}\n`,
				'temp-generator.mjs': `export function generateIndex() { return ${JSON.stringify(expectedIndex)}; }\n`,
			},
			async (tempRoot) => {
				const result = await validateSkillMetadataParityGate({
					repoRoot: tempRoot,
					committedIndexPath: path.join(tempRoot, 'engine-assets', 'skills', 'skill-metadata-index.json'),
					generatorModulePath: path.join(tempRoot, 'temp-generator.mjs'),
				});

				assert.ok(result.errors.length > 0, 'expected drift errors');
				assert.match(result.errors.join('\n'), /skill-metadata-index\.json is stale relative to skill frontmatter and manifest metadata/i);
				assert.match(result.errors.join('\n'), /changed entries: alpha/i);
				assert.match(result.errors.join('\n'), /Regenerate with: node scripts\/generate-skill-metadata-index\.mjs/i);
			}
		);
	});

	await test('validate-skill-discovery-map reports generator execution failures', async () => {
		const committedIndex = {
			schemaVersion: 1,
			entries: [],
		};

		await withTempRepoFixture(
			{
				'engine-assets/skills/skill-metadata-index.json': `${JSON.stringify(committedIndex, null, 2)}\n`,
				'temp-generator.mjs': 'export function generateIndex() { throw new Error("synthetic generator failure"); }\n',
			},
			async (tempRoot) => {
				const result = await validateSkillMetadataParityGate({
					repoRoot: tempRoot,
					committedIndexPath: path.join(tempRoot, 'engine-assets', 'skills', 'skill-metadata-index.json'),
					generatorModulePath: path.join(tempRoot, 'temp-generator.mjs'),
				});

				assert.ok(result.errors.length > 0, 'expected generator failure errors');
				assert.match(result.errors.join('\n'), /failed to load metadata generator: synthetic generator failure/i);
			}
		);
	});

	console.log(`\n${passed} tests passed`);
	if (process.exitCode) {
		console.error('Some tests FAILED');
	} else {
		console.log('All tests passed');
	}
}

main().catch((error) => {
	console.error(error.stack || error.message || String(error));
	process.exitCode = 1;
	console.error('Some tests FAILED');
});
