import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { existsFile } from './utils/fs';
import { getRepoRegistryPath } from './enginePaths';

export type EnablementKind = 'skills' | 'agents' | 'mcpProviders';

interface RegistrySection {
	disabled?: string[];
}

interface RegistryData {
	skills?: RegistrySection;
	agents?: RegistrySection;
	mcpProviders?: RegistrySection;
}

function normalizeKey(value: string): string {
	return value.trim().toLowerCase();
}

function normalizeRepoKey(repoPath: string): string {
	return repoPath.replace(/\\/g, '/');
}

function getRegistryPath(repoPath: string, config: vscode.WorkspaceConfiguration): string {
	void config;
	void path;
	// Hard cutover: do not write enablement metadata into repos.
	return getRepoRegistryPath(repoPath);
}

function normalizeDisabledEntries(entries: readonly string[]): string[] {
	const normalized = new Set<string>();
	for (const entry of entries) {
		if (typeof entry !== 'string') {
			continue;
		}

		const value = normalizeKey(entry);
		if (value) {
			normalized.add(value);
		}
	}

	return Array.from(normalized).sort();
}

function readRegistry(repoPath: string, config: vscode.WorkspaceConfiguration): RegistryData {
	const registryPath = getRegistryPath(repoPath, config);
	if (!existsFile(registryPath)) {
		return {};
	}

	try {
		const raw = fs.readFileSync(registryPath, 'utf8');
		const data = JSON.parse(raw) as RegistryData;
		return data && typeof data === 'object' ? data : {};
	} catch {
		return {};
	}
}

function writeRegistry(repoPath: string, config: vscode.WorkspaceConfiguration, data: RegistryData): void {
	const registryPath = getRegistryPath(repoPath, config);
	const dir = path.dirname(registryPath);
	fs.mkdirSync(dir, { recursive: true });
	const payload = JSON.stringify(data, null, 2);
	fs.writeFileSync(registryPath, `${payload}\n`, 'utf8');
}

function getSettingsKey(kind: EnablementKind): string {
	return kind === 'skills'
		? 'skillInstaller.skills.disabledByRepo'
		: kind === 'agents'
			? 'skillInstaller.agents.disabledByRepo'
			: 'skillInstaller.mcp.providers.disabledByRepo';
}

function getSettingsDisabledEntries(
	kind: EnablementKind,
	repoPath: string,
	config: vscode.WorkspaceConfiguration
): string[] {
	const settingsKey = getSettingsKey(kind);
	const settingsMap = config.get<Record<string, unknown>>(settingsKey) ?? {};
	const repoKey = normalizeRepoKey(repoPath);
	const entries = settingsMap[repoKey];
	return Array.isArray(entries)
		? entries.filter((entry): entry is string => typeof entry === 'string')
		: [];
}

function getRegistryDisabledEntries(data: RegistryData, kind: EnablementKind): string[] {
	const disabled = data[kind]?.disabled;
	return Array.isArray(disabled)
		? disabled.filter((entry): entry is string => typeof entry === 'string')
		: [];
}

function importSettingsIfNeeded(
	kind: EnablementKind,
	repoPath: string,
	config: vscode.WorkspaceConfiguration,
	registry: RegistryData
): RegistryData {
	if (Array.isArray(registry[kind]?.disabled)) {
		return registry;
	}

	const settingsEntries = getSettingsDisabledEntries(kind, repoPath, config);
	if (settingsEntries.length === 0) {
		return registry;
	}

	registry[kind] = {
		disabled: normalizeDisabledEntries(settingsEntries)
	};
	writeRegistry(repoPath, config, registry);
	return registry;
}

export function getRepoDisabledSet(kind: EnablementKind, repoPath: string): Set<string> {
	const config = vscode.workspace.getConfiguration();
	const registry = importSettingsIfNeeded(kind, repoPath, config, readRegistry(repoPath, config));
	return new Set(normalizeDisabledEntries(getRegistryDisabledEntries(registry, kind)));
}

export async function setRepoItemEnabled(
	kind: EnablementKind,
	repoPath: string,
	itemKey: string,
	enabled: boolean
): Promise<void> {
	const normalizedKey = normalizeKey(itemKey);
	if (!normalizedKey) {
		return;
	}

	const config = vscode.workspace.getConfiguration();
	const registry = importSettingsIfNeeded(kind, repoPath, config, readRegistry(repoPath, config));
	const registrySet = new Set(normalizeDisabledEntries(getRegistryDisabledEntries(registry, kind)));
	if (enabled) {
		registrySet.delete(normalizedKey);
	} else {
		registrySet.add(normalizedKey);
	}

	registry[kind] = {
		disabled: Array.from(registrySet).sort()
	};

	writeRegistry(repoPath, config, registry);
}

export function resolveRepoPathFromEntry(repoPath: string | undefined, fallback?: string): string | undefined {
	if (repoPath) {
		return repoPath;
	}
	return fallback;
}
