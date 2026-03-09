import * as assert from 'assert';
import { buildRepoAgents } from '../../agentScanner';
import {
	createCatalogEntry,
	createCatalogScope,
	groupEntriesByAssetKey,
} from '../../catalogAdapter';

suite('agentScanner', () => {
	test('repo contexts include user-installed agents without repo-local overrides', () => {
		const userScope = createCatalogScope('user', '/tmp/user-home');
		const repoScope = createCatalogScope('repo', '/tmp/repo', 'repo');
		const userEntries = [
			createCatalogEntry({
				kind: 'agent',
				assetKey: 'global.agent.md',
				title: 'Global Agent',
				layer: 'user-installed',
				scope: userScope,
				contentPath: '/tmp/user-home/agents/global.agent.md',
				installState: {
					availability: 'installed',
					materialization: 'materialized',
					isInstalled: true
				},
				metadata: {
					fileName: 'global.agent.md',
					openPath: '/tmp/user-home/agents/global.agent.md'
				}
			}),
			createCatalogEntry({
				kind: 'agent',
				assetKey: 'shared.agent.md',
				title: 'User Shared Agent',
				layer: 'user-installed',
				scope: userScope,
				contentPath: '/tmp/user-home/agents/shared.agent.md',
				installState: {
					availability: 'installed',
					materialization: 'materialized',
					isInstalled: true
				},
				metadata: {
					fileName: 'shared.agent.md',
					openPath: '/tmp/user-home/agents/shared.agent.md'
				}
			})
		];
		const repoEntries = [
			createCatalogEntry({
				kind: 'agent',
				assetKey: 'shared.agent.md',
				title: 'Repo Shared Agent',
				layer: 'repo-local',
				scope: repoScope,
				contentPath: '/tmp/repo/.github/agents/shared.agent.md',
				installState: {
					availability: 'repo-local',
					materialization: 'materialized',
					isInstalled: true
				},
				metadata: {
					fileName: 'shared.agent.md',
					openPath: '/tmp/repo/.github/agents/shared.agent.md'
				}
			})
		];

		const agents = buildRepoAgents(
			groupEntriesByAssetKey(userEntries),
			repoEntries,
			repoScope,
			new Set(['global.agent.md']),
			'/tmp/repo'
		);

		assert.deepStrictEqual(
			agents.map((agent) => agent.fileName),
			['global.agent.md', 'shared.agent.md']
		);

		const globalAgent = agents.find((agent) => agent.fileName === 'global.agent.md');
		assert.ok(globalAgent);
		assert.strictEqual(globalAgent?.path, '/tmp/user-home/agents/global.agent.md');
		assert.strictEqual(globalAgent?.catalogLayer, 'user-installed');
		assert.strictEqual(globalAgent?.enabled, false);

		const sharedAgent = agents.find((agent) => agent.fileName === 'shared.agent.md');
		assert.ok(sharedAgent);
		assert.strictEqual(sharedAgent?.name, 'Repo Shared Agent');
		assert.strictEqual(sharedAgent?.path, '/tmp/repo/.github/agents/shared.agent.md');
		assert.strictEqual(sharedAgent?.catalogLayer, 'repo-local');
		assert.strictEqual(sharedAgent?.enabled, true);
	});
});
