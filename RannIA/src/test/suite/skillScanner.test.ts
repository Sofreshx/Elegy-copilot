import * as assert from 'assert';
import { buildRepoSkills } from '../../skillScanner';
import {
	createCatalogEntry,
	createCatalogScope,
	groupEntriesByAssetKey,
} from '../../catalogAdapter';

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
});
