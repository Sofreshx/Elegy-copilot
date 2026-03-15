import * as assert from 'assert';
import { buildCatalogControlPlaneUrl, DEFAULT_CATALOG_CONTROL_PLANE_URL } from '../../catalogControlPlane';

suite('catalogControlPlane', () => {
	test('builds a catalog assets handoff URL with the default control plane origin', () => {
		const url = new URL(
			buildCatalogControlPlaneUrl({
				source: 'rannia',
				intent: 'skill-mutation-handoff'
			})
		);
		const defaultUrl = new URL(DEFAULT_CATALOG_CONTROL_PLANE_URL);

		assert.strictEqual(url.origin, defaultUrl.origin);
		assert.strictEqual(url.searchParams.get('tab'), 'catalog');
		assert.strictEqual(url.searchParams.get('catalogSection'), 'assets');
		assert.strictEqual(url.searchParams.get('source'), 'rannia');
		assert.strictEqual(url.searchParams.get('intent'), 'skill-mutation-handoff');
	});

	test('normalizes bare host values and preserves repo context in query params', () => {
		const url = new URL(
			buildCatalogControlPlaneUrl({
				baseUrl: '127.0.0.1:4444',
				catalogSection: 'skills',
				repoPath: 'C:\\repo\\sample'
			})
		);

		assert.strictEqual(url.origin, 'http://127.0.0.1:4444');
		assert.strictEqual(url.searchParams.get('tab'), 'catalog');
		assert.strictEqual(url.searchParams.get('catalogSection'), 'skills');
		assert.strictEqual(url.searchParams.get('repoPath'), 'C:\\repo\\sample');
	});

	test('omits catalogSection when the handoff target is not the catalog tab', () => {
		const url = new URL(
			buildCatalogControlPlaneUrl({
				tab: 'planning',
				catalogSection: 'agents'
			})
		);

		assert.strictEqual(url.searchParams.get('tab'), 'planning');
		assert.strictEqual(url.searchParams.has('catalogSection'), false);
	});
});
