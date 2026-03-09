import * as assert from 'assert';
import {
	createCatalogEntry,
	createCatalogScope,
	createRepoOverlayEntry,
	resolveCatalogState,
} from '../../catalogAdapter';

suite('catalogAdapter', () => {
	test('prefers vault content over pointer stubs for on-demand skills', () => {
		const scope = createCatalogScope('user', '/tmp/user-home');
		const pointerEntry = createCatalogEntry({
			kind: 'skill',
			assetKey: 'firebase-auth',
			title: 'firebase-auth',
			layer: 'user-installed',
			scope,
			contentPath: '/tmp/user-home/skills/firebase-auth',
			installState: {
				availability: 'installed',
				materialization: 'pointer',
				loadMode: 'on-demand',
				isInstalled: true
			}
		});
		const vaultEntry = createCatalogEntry({
			kind: 'skill',
			assetKey: 'firebase-auth',
			title: 'firebase-auth',
			layer: 'vault-only',
			scope,
			contentPath: '/tmp/user-home/skills-vault/firebase-auth',
			installState: {
				availability: 'vault-only',
				materialization: 'vault-only',
				loadMode: 'on-demand',
				isInstalled: true
			}
		});

		const resolved = resolveCatalogState([pointerEntry, vaultEntry]);

		assert.strictEqual(resolved.selectedLayer, 'vault-only');
		assert.strictEqual(resolved.hiddenFromAutoLoad, true);
		assert.ok(resolved.overridden);
		assert.ok(resolved.reasons.some((reason) => reason.code === 'vault-preferred-over-pointer'));
	});

	test('applies repo overlay disable on top of repo-local overrides', () => {
		const userScope = createCatalogScope('user', '/tmp/user-home');
		const repoScope = createCatalogScope('repo', '/tmp/repo', 'repo');
		const globalEntry = createCatalogEntry({
			kind: 'skill',
			assetKey: 'linting',
			title: 'linting',
			layer: 'user-installed',
			scope: userScope,
			contentPath: '/tmp/user-home/skills/linting',
			installState: {
				availability: 'installed',
				materialization: 'materialized',
				loadMode: 'always',
				isInstalled: true
			}
		});
		const repoEntry = createCatalogEntry({
			kind: 'skill',
			assetKey: 'linting',
			title: 'linting',
			layer: 'repo-local',
			scope: repoScope,
			contentPath: '/tmp/repo/.github/skills/linting',
			installState: {
				availability: 'repo-local',
				materialization: 'materialized',
				isInstalled: true
			}
		});

		const resolved = resolveCatalogState([
			globalEntry,
			repoEntry,
			createRepoOverlayEntry('skill', 'linting', repoScope, false),
		]);

		assert.strictEqual(resolved.selectedLayer, 'repo-local');
		assert.strictEqual(resolved.enabled, false);
		assert.ok(resolved.overridden);
		assert.ok(resolved.labels.includes('disabled'));
		assert.ok(resolved.reasons.some((reason) => reason.code === 'selected-repo-local'));
		assert.ok(resolved.reasons.some((reason) => reason.code === 'repo-overlay-disabled'));
	});
});
