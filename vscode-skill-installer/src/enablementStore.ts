import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { existsFile } from './utils/fs';

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
	const configured = (config.get<string>('skillInstaller.registry.fileName') ?? '').trim();
	const fallback = '.instructions/registry.json';
	const fileName = configured || fallback;
	return path.isAbsolute(fileName) ? fileName : path.join(repoPath, fileName);
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

export function getRepoDisabledSet(kind: EnablementKind, repoPath: string): Set<string> {
	const config = vscode.workspace.getConfiguration();
	const settingsKey = getSettingsKey(kind);
	const settingsMap = config.get<Record<string, string[]>>(settingsKey) ?? {};
	const repoKey = normalizeRepoKey(repoPath);
	const fromSettings = settingsMap[repoKey] ?? [];
	const registry = readRegistry(repoPath, config);
	const fromRegistry = registry[kind]?.disabled ?? [];

	const disabled = new Set<string>();
	for (const entry of [...fromSettings, ...fromRegistry]) {
		const normalized = normalizeKey(entry);
		if (normalized) {
			disabled.add(normalized);
		}
	}

	return disabled;
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
	const settingsKey = getSettingsKey(kind);
	const settingsMap = config.get<Record<string, string[]>>(settingsKey) ?? {};
	const repoKey = normalizeRepoKey(repoPath);
	const current = new Set((settingsMap[repoKey] ?? []).map(normalizeKey));
	if (enabled) {
		current.delete(normalizedKey);
	} else {
		current.add(normalizedKey);
	}
	settingsMap[repoKey] = Array.from(current).sort();
	await config.update(settingsKey, settingsMap, vscode.ConfigurationTarget.Workspace);

	const registry = readRegistry(repoPath, config);
	const registrySection = registry[kind] ?? {};
	const registrySet = new Set((registrySection.disabled ?? []).map(normalizeKey));
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
