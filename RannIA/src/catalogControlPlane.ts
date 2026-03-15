export const DEFAULT_CATALOG_CONTROL_PLANE_URL = 'http://127.0.0.1:3210/';

export type CatalogTabId = 'home-runtime' | 'catalog' | 'planning';
export type CatalogSectionId = 'overview' | 'assets' | 'skills' | 'agents';

export interface CatalogControlPlaneTarget {
	baseUrl?: string;
	tab?: CatalogTabId;
	catalogSection?: CatalogSectionId;
	repoPath?: string;
	source?: string;
	intent?: string;
}

function normalizeBaseUrl(baseUrl?: string): string {
	let candidate = (baseUrl ?? '').trim();
	if (!candidate) {
		candidate = DEFAULT_CATALOG_CONTROL_PLANE_URL;
	}

	if (!/^[a-z][a-z\d+\-.]*:\/\//i.test(candidate)) {
		candidate = `http://${candidate}`;
	}

	const url = new URL(candidate);
	if (!url.pathname) {
		url.pathname = '/';
	}

	return url.toString();
}

export function buildCatalogControlPlaneUrl(target: CatalogControlPlaneTarget = {}): string {
	const url = new URL(normalizeBaseUrl(target.baseUrl));
	const tab = target.tab ?? 'catalog';

	url.searchParams.set('tab', tab);

	if (tab === 'catalog') {
		url.searchParams.set('catalogSection', target.catalogSection ?? 'assets');
	}

	const repoPath = target.repoPath?.trim();
	if (repoPath) {
		url.searchParams.set('repoPath', repoPath);
	}

	const source = target.source?.trim();
	if (source) {
		url.searchParams.set('source', source);
	}

	const intent = target.intent?.trim();
	if (intent) {
		url.searchParams.set('intent', intent);
	}

	return url.toString();
}
