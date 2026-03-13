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

	test('provider-qualified agent identities stay distinct from shipped names', () => {
		const userScope = createCatalogScope('user', '/tmp/user-home');
		const providerAgent = createCatalogEntry({
			kind: 'agent',
			assetKey: 'superpowers-copilot-superpowers-code-reviewer',
			title: 'Code Reviewer',
			layer: 'user-installed',
			scope: userScope,
			contentPath: '/tmp/user-home/agents/providers--superpowers--code-reviewer.md',
			installState: {
				availability: 'installed',
				materialization: 'materialized',
				isInstalled: true
			},
			provenance: {
				providerId: 'superpowers-copilot',
				namespace: 'superpowers',
				readOnly: true,
				discoveryMode: 'managed-import'
			},
			metadata: {
				fileName: 'providers--superpowers--code-reviewer.md',
				openPath: '/tmp/user-home/agents/providers--superpowers--code-reviewer.md'
			}
		});
		const shippedNameAgent = createCatalogEntry({
			kind: 'agent',
			assetKey: 'code-reviewer.agent.md',
			title: 'Code Reviewer',
			layer: 'user-installed',
			scope: userScope,
			contentPath: '/tmp/user-home/agents/code-reviewer.agent.md',
			installState: {
				availability: 'installed',
				materialization: 'materialized',
				isInstalled: true
			},
			metadata: {
				fileName: 'code-reviewer.agent.md',
				openPath: '/tmp/user-home/agents/code-reviewer.agent.md'
			}
		});

		const agents = buildRepoAgents(
			groupEntriesByAssetKey([providerAgent, shippedNameAgent]),
			[],
			createCatalogScope('repo', '/tmp/repo', 'repo'),
			new Set(),
			'/tmp/repo'
		);

		assert.deepStrictEqual(
			agents.map((agent) => agent.assetKey).sort(),
			['code-reviewer.agent.md', 'superpowers-copilot-superpowers-code-reviewer']
		);
		const importedAgent = agents.find(
			(agent) => agent.assetKey === 'superpowers-copilot-superpowers-code-reviewer'
		);
		assert.ok(importedAgent);
		assert.strictEqual(importedAgent?.provider, 'superpowers-copilot');
		assert.strictEqual(importedAgent?.namespace, 'superpowers');
		assert.strictEqual(importedAgent?.readOnly, true);
	});
});
