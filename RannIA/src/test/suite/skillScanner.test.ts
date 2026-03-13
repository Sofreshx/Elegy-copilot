import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildRepoSkills, listSkillsInDir } from '../../skillScanner';
import {
	createCatalogEntry,
	createCatalogScope,
	groupEntriesByAssetKey,
} from '../../catalogAdapter';
import { writePointerContent } from '../../skillPointer';

suite('skillScanner', () => {
	test('repo contexts include global skills and preserve repo-local overrides', () => {
		const userScope = createCatalogScope('user', '/tmp/user-home');
		const repoScope = createCatalogScope('repo', '/tmp/repo', 'repo');
		const globalEntries = [
			createCatalogEntry({
				kind: 'skill',
				assetKey: 'global-skill',
				title: 'global-skill',
				layer: 'user-installed',
				scope: userScope,
				contentPath: '/tmp/user-home/skills/global-skill',
				installState: {
					availability: 'installed',
					materialization: 'materialized',
					loadMode: 'always',
					isInstalled: true
				},
				metadata: {
					openPath: '/tmp/user-home/skills/global-skill/SKILL.md',
					kind: 'full'
				}
			}),
			createCatalogEntry({
				kind: 'skill',
				assetKey: 'shared-skill',
				title: 'shared-skill',
				layer: 'user-installed',
				scope: userScope,
				contentPath: '/tmp/user-home/skills/shared-skill',
				installState: {
					availability: 'installed',
					materialization: 'materialized',
					loadMode: 'always',
					isInstalled: true
				},
				metadata: {
					openPath: '/tmp/user-home/skills/shared-skill/SKILL.md',
					kind: 'full'
				}
			})
		];
		const repoEntries = [
			createCatalogEntry({
				kind: 'skill',
				assetKey: 'shared-skill',
				title: 'shared-skill',
				layer: 'repo-local',
				scope: repoScope,
				contentPath: '/tmp/repo/.github/skills/shared-skill',
				installState: {
					availability: 'repo-local',
					materialization: 'materialized',
					loadMode: 'always',
					isInstalled: true
				},
				metadata: {
					openPath: '/tmp/repo/.github/skills/shared-skill/SKILL.md',
					kind: 'full'
				}
			})
		];

		const skills = buildRepoSkills(
			groupEntriesByAssetKey(globalEntries),
			repoEntries,
			repoScope,
			new Set(['global-skill']),
			'target-repo',
			'/tmp/repo'
		);

		assert.deepStrictEqual(
			skills.map((skill) => skill.name),
			['global-skill', 'shared-skill']
		);

		const globalSkill = skills.find((skill) => skill.name === 'global-skill');
		assert.ok(globalSkill);
		assert.strictEqual(globalSkill?.path, '/tmp/user-home/skills/global-skill');
		assert.strictEqual(globalSkill?.catalogLayer, 'user-installed');
		assert.strictEqual(globalSkill?.enabled, false);

		const sharedSkill = skills.find((skill) => skill.name === 'shared-skill');
		assert.ok(sharedSkill);
		assert.strictEqual(sharedSkill?.path, '/tmp/repo/.github/skills/shared-skill');
		assert.strictEqual(sharedSkill?.catalogLayer, 'repo-local');
		assert.strictEqual(sharedSkill?.enabled, true);
	});

	test('provider-qualified asset keys remain distinct and expose provenance metadata', () => {
		const userScope = createCatalogScope('user', '/tmp/user-home');
		const providerEntry = createCatalogEntry({
			kind: 'skill',
			assetKey: 'superpowers-copilot-superpowers-brainstorming',
			title: 'Brainstorming',
			layer: 'user-installed',
			scope: userScope,
			contentPath: '/tmp/user-home/skills/providers/superpowers/brainstorming',
			installState: {
				availability: 'installed',
				materialization: 'materialized',
				loadMode: 'always',
				isInstalled: true
			},
			provenance: {
				providerId: 'superpowers-copilot',
				namespace: 'superpowers',
				readOnly: true,
				discoveryMode: 'managed-import'
			},
			metadata: {
				openPath: '/tmp/user-home/skills/providers/superpowers/brainstorming/SKILL.md',
				kind: 'full'
			}
		});
		const shippedEntry = createCatalogEntry({
			kind: 'skill',
			assetKey: 'brainstorming',
			title: 'Brainstorming',
			layer: 'user-installed',
			scope: userScope,
			contentPath: '/tmp/user-home/skills/brainstorming',
			installState: {
				availability: 'installed',
				materialization: 'materialized',
				loadMode: 'always',
				isInstalled: true
			},
			metadata: {
				openPath: '/tmp/user-home/skills/brainstorming/SKILL.md',
				kind: 'full'
			}
		});

		const skills = buildRepoSkills(
			groupEntriesByAssetKey([providerEntry, shippedEntry]),
			[],
			createCatalogScope('repo', '/tmp/repo', 'repo'),
			new Set(),
			'target-repo',
			'/tmp/repo'
		);

		assert.deepStrictEqual(
			skills.map((skill) => skill.assetKey).sort(),
			['brainstorming', 'superpowers-copilot-superpowers-brainstorming']
		);
		const providerSkill = skills.find(
			(skill) => skill.assetKey === 'superpowers-copilot-superpowers-brainstorming'
		);
		assert.ok(providerSkill);
		assert.strictEqual(providerSkill?.provider, 'superpowers-copilot');
		assert.strictEqual(providerSkill?.namespace, 'superpowers');
		assert.strictEqual(providerSkill?.readOnly, true);
	});

	test('discovers vault-only and pointer-backed provider skills with provider-qualified identity', () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-scan-'));
		try {
			const skillsDir = path.join(tmpDir, 'skills');
			const vaultDir = path.join(tmpDir, 'skills-vault');
			fs.mkdirSync(path.join(skillsDir, 'incident-kit-pointer'), { recursive: true });
			fs.mkdirSync(path.join(vaultDir, 'providers', 'superpowers', 'incident-kit'), { recursive: true });
			fs.mkdirSync(path.join(vaultDir, 'operations', 'release-drill'), { recursive: true });

			fs.writeFileSync(
				path.join(skillsDir, 'incident-kit-pointer', 'SKILL.md'),
				writePointerContent(
					'incident-kit-pointer',
					'Pointer to provider skill',
					'incident response',
					'skills-vault/providers/superpowers/incident-kit'
				),
				'utf8'
			);
			fs.writeFileSync(
				path.join(vaultDir, 'providers', 'superpowers', 'incident-kit', 'index.md'),
				'# Incident Kit\n\n> Provider-backed incident response.\n\nTriggers on: incident, outage',
				'utf8'
			);
			fs.writeFileSync(
				path.join(vaultDir, 'operations', 'release-drill', 'index.md'),
				'# Release Drill\n\n> Namespaced vault-only skill.\n\nTriggers on: release, rollback',
				'utf8'
			);

			const installed = listSkillsInDir(
				skillsDir,
				'instruction-engine',
				tmpDir,
				'user-installed',
				{ vaultRoot: vaultDir }
			);
			const vaulted = listSkillsInDir(vaultDir, 'instruction-engine', tmpDir, 'vault-only');

			const pointerEntry = installed.find(
				(entry) => entry.assetKey === 'superpowers-copilot-superpowers-incident-kit'
			);
			assert.ok(pointerEntry, 'expected pointer-backed provider skill to retain provider-qualified identity');
			assert.strictEqual(pointerEntry?.name, 'incident-kit');
			assert.strictEqual(pointerEntry?.kind, 'pointer');
			assert.strictEqual(pointerEntry?.provenance?.providerId, 'superpowers-copilot');
			assert.strictEqual(pointerEntry?.provenance?.namespace, 'superpowers');

			const providerVaultEntry = vaulted.find(
				(entry) => entry.assetKey === 'superpowers-copilot-superpowers-incident-kit'
			);
			assert.ok(providerVaultEntry, 'expected provider-backed vault entry to be discovered directly from skills-vault');
			assert.strictEqual(providerVaultEntry?.installState?.availability, 'vault-only');
			assert.strictEqual(providerVaultEntry?.kind, 'full');

			const namespacedVaultEntry = vaulted.find(
				(entry) => entry.assetKey === 'copilot-home-plugin-operations-release-drill'
			);
			assert.ok(namespacedVaultEntry, 'expected namespaced vault-only skill to be discovered');
			assert.strictEqual(namespacedVaultEntry?.provenance?.namespace, 'operations');
			assert.strictEqual(namespacedVaultEntry?.provenance?.providerId, 'copilot-home-plugin');
			assert.strictEqual(namespacedVaultEntry?.installState?.availability, 'vault-only');
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});
