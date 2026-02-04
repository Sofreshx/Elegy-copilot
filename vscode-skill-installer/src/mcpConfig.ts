import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { getRepoDisabledSet } from './enablementStore';

export type McpTransport = 'stdio' | 'http' | 'custom';

export interface McpProviderConfig {
	label?: string;
	transport?: McpTransport | string;
	command?: string;
	args?: string[];
	url?: string;
	env?: Record<string, string>;
	headers?: Record<string, string>;
	notes?: string;
}

export interface McpProviderInfo {
	id: string;
	label: string;
	repoPath: string;
	enabled: boolean;
	config: McpProviderConfig;
	issues?: string[];
}

interface McpServerConfig {
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	url?: string;
	headers?: Record<string, string>;
}

const DEFAULT_PROVIDERS: Record<string, McpProviderConfig> = {
	supabase: {
		label: 'Supabase',
		transport: 'http',
		url: 'https://mcp.supabase.com/mcp',
		notes: 'Hosted MCP server. Use project scoping and read-only modes when possible.'
	},
	firebase: {
		label: 'Firebase',
		transport: 'stdio',
		command: 'npx',
		args: ['-y', 'firebase-tools@latest', 'mcp'],
		notes: 'Uses Firebase CLI auth. Add --dir and --only via args to scope usage.'
	},
	vultr: {
		label: 'Vultr',
		transport: 'stdio',
		command: 'vultr-mcp-server',
		args: [],
		env: {
			VULTR_API_KEY: '${env:VULTR_API_KEY}'
		},
		notes: 'Requires mcp-vultr installed locally.'
	},
	cloudflare: {
		label: 'Cloudflare',
		transport: 'custom',
		notes: 'Add a Cloudflare MCP server configuration when selected.'
	}
};

function normalizeString(value: unknown): string | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed ? trimmed : undefined;
}

function normalizeStringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	const result = value
		.map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
		.filter((entry) => entry.length > 0);
	return result.length > 0 ? result : undefined;
}

function normalizeRecord(value: unknown): Record<string, string> | undefined {
	if (!value || typeof value !== 'object') {
		return undefined;
	}
	const record: Record<string, string> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (typeof entry !== 'string') {
			continue;
		}
		const trimmed = entry.trim();
		if (!trimmed) {
			continue;
		}
		record[key] = trimmed;
	}
	return Object.keys(record).length > 0 ? record : undefined;
}

function normalizeProviderConfig(
	value: unknown,
	fallback?: McpProviderConfig
): McpProviderConfig | undefined {
	const base: McpProviderConfig = fallback ? { ...fallback } : {};
	if (!value || typeof value !== 'object') {
		return fallback ? base : undefined;
	}

	const data = value as Record<string, unknown>;
	const label = normalizeString(data.label);
	const transport = normalizeString(data.transport);
	const command = normalizeString(data.command);
	const url = normalizeString(data.url);
	const notes = normalizeString(data.notes);
	const args = normalizeStringArray(data.args);
	const env = normalizeRecord(data.env);
	const headers = normalizeRecord(data.headers);

	if (label) {
		base.label = label;
	}
	if (transport) {
		base.transport = transport;
	}
	if (command) {
		base.command = command;
	}
	if (url) {
		base.url = url;
	}
	if (notes) {
		base.notes = notes;
	}
	if (args) {
		base.args = args;
	}
	if (env) {
		base.env = env;
	}
	if (headers) {
		base.headers = headers;
	}

	return base;
}

export function getMcpProvidersConfig(): Record<string, McpProviderConfig> {
	const config = vscode.workspace.getConfiguration();
	const raw = config.get<Record<string, unknown>>('skillInstaller.mcp.providers') ?? {};
	const merged: Record<string, McpProviderConfig> = { ...DEFAULT_PROVIDERS };

	for (const [key, value] of Object.entries(raw)) {
		const normalized = normalizeProviderConfig(value, DEFAULT_PROVIDERS[key]);
		if (normalized) {
			merged[key] = normalized;
		} else if (!merged[key]) {
			merged[key] = { label: key };
		}
	}

	return merged;
}

function getMcpConfigPath(repoPath: string): string {
	const config = vscode.workspace.getConfiguration();
	const configured = (config.get<string>('skillInstaller.mcp.configPath') ?? '').trim();
	const fallback = '.vscode/mcp.json';
	const relativePath = configured || fallback;
	return path.isAbsolute(relativePath) ? relativePath : path.join(repoPath, relativePath);
}

function buildServerConfig(provider: McpProviderConfig): McpServerConfig | undefined {
	if (provider.url) {
		const headers = normalizeRecord(provider.headers ?? {});
		return {
			url: provider.url,
			headers: headers
		};
	}

	if (provider.command) {
		const args = normalizeStringArray(provider.args ?? []);
		const env = normalizeRecord(provider.env ?? {});
		return {
			command: provider.command,
			args,
			env
		};
	}

	return undefined;
}

function writeMcpConfig(filePath: string, payload: { mcpServers: Record<string, McpServerConfig> }): boolean {
	const dir = path.dirname(filePath);
	fs.mkdirSync(dir, { recursive: true });

	const content = JSON.stringify(payload, null, 2) + '\n';
	try {
		const existing = fs.readFileSync(filePath, 'utf8');
		if (existing === content) {
			return false;
		}
	} catch {
		// ignore missing file
	}

	fs.writeFileSync(filePath, content, 'utf8');
	return true;
}

export function getMcpProviderInfos(repoPath: string): McpProviderInfo[] {
	const providers = getMcpProvidersConfig();
	const disabled = getRepoDisabledSet('mcpProviders', repoPath);
	const infos: McpProviderInfo[] = [];

	for (const [id, config] of Object.entries(providers)) {
		const label = config.label ?? id;
		const enabled = !disabled.has(id.toLowerCase());
		const issues: string[] = [];
		if (!config.url && !config.command) {
			issues.push('missing-config');
		}
		infos.push({
			id,
			label,
			repoPath,
			enabled,
			config,
			issues: issues.length ? issues : undefined
		});
	}

	return infos;
}

export async function syncMcpConfigForRepo(
	repoPath: string,
	output?: vscode.OutputChannel
): Promise<void> {
	const providerInfos = getMcpProviderInfos(repoPath).filter((p) => p.enabled);
	const mcpServers: Record<string, McpServerConfig> = {};
	const skipped: string[] = [];

	for (const provider of providerInfos) {
		const serverConfig = buildServerConfig(provider.config);
		if (!serverConfig) {
			skipped.push(provider.id);
			continue;
		}
		mcpServers[provider.id] = serverConfig;
	}

	const configPath = getMcpConfigPath(repoPath);
	const changed = writeMcpConfig(configPath, { mcpServers });

	if (output) {
		const status = changed ? 'updated' : 'unchanged';
		output.appendLine(`[MCP] ${status} ${configPath}`);
		if (skipped.length > 0) {
			output.appendLine(`[MCP] Skipped providers missing config: ${skipped.join(', ')}`);
		}
	}
}

export async function syncMcpConfigForWorkspace(
	output?: vscode.OutputChannel
): Promise<void> {
	const folders = vscode.workspace.workspaceFolders ?? [];
	for (const folder of folders) {
		await syncMcpConfigForRepo(folder.uri.fsPath, output);
	}
}
