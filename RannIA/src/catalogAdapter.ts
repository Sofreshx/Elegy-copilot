import {
	type AssetCatalogEntry,
	type AssetCatalogLayer,
	type AssetKind,
	type AssetScope,
	type EffectiveAssetState,
	resolveEffectiveAssetState,
} from '@instruction-engine/contracts';
import { getRepoStateKey } from './enginePaths';

export const USER_ASSET_HOME_LABEL = 'User Asset Home';

export function normalizeCatalogAssetKey(value: string): string {
	return value.trim().toLowerCase();
}

export function createCatalogScope(
	scopeKind: 'user' | 'repo',
	repoPath: string,
	displayName?: string
): AssetScope {
	const { repoId, repoLabel } = getRepoStateKey(repoPath);
	return {
		kind: scopeKind,
		repoId,
		repoPath,
		displayName: displayName ?? (scopeKind === 'user' ? USER_ASSET_HOME_LABEL : repoLabel)
	};
}

export interface CreateCatalogEntryOptions {
	kind: AssetKind;
	assetKey: string;
	title: string;
	layer: AssetCatalogLayer;
	scope: AssetScope;
	description?: string;
	contentPath?: string;
	installState?: AssetCatalogEntry['installState'];
	lifecycle?: AssetCatalogEntry['lifecycle'];
	metadata?: Record<string, unknown>;
}

function buildAssetId(
	kind: AssetKind,
	assetKey: string,
	layer: AssetCatalogLayer,
	scope: AssetScope
): string {
	const scopeRef = scope.repoId ?? scope.workspaceId ?? scope.displayName ?? scope.kind;
	return [kind, assetKey, scope.kind, scopeRef, layer].join(':');
}

export function createCatalogEntry(options: CreateCatalogEntryOptions): AssetCatalogEntry {
	const assetKey = normalizeCatalogAssetKey(options.assetKey);
	return {
		assetId: buildAssetId(options.kind, assetKey, options.layer, options.scope),
		assetKey,
		kind: options.kind,
		title: options.title,
		description: options.description,
		layer: options.layer,
		scope: options.scope,
		installState: options.installState,
		lifecycle: options.lifecycle,
		contentPath: options.contentPath,
		metadata: options.metadata
	};
}

export function createRepoOverlayEntry(
	kind: AssetKind,
	assetKey: string,
	scope: AssetScope,
	enabled: boolean
): AssetCatalogEntry {
	const normalizedKey = normalizeCatalogAssetKey(assetKey);
	return {
		assetId: buildAssetId(kind, normalizedKey, 'repo-state-overlay', scope),
		assetKey: normalizedKey,
		kind,
		title: normalizedKey,
		layer: 'repo-state-overlay',
		scope,
		overlay: {
			repoId: scope.repoId,
			repoPath: scope.repoPath,
			enabled
		},
		metadata: {
			origin: 'rannia-enablement-store'
		}
	};
}

export function resolveCatalogState(entries: readonly AssetCatalogEntry[]): EffectiveAssetState {
	return resolveEffectiveAssetState(entries);
}

export function groupEntriesByAssetKey(
	entries: readonly AssetCatalogEntry[]
): Map<string, AssetCatalogEntry[]> {
	const grouped = new Map<string, AssetCatalogEntry[]>();
	for (const entry of entries) {
		const key = normalizeCatalogAssetKey(entry.assetKey);
		const bucket = grouped.get(key);
		if (bucket) {
			bucket.push(entry);
		} else {
			grouped.set(key, [entry]);
		}
	}
	return grouped;
}
