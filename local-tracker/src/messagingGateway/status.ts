import type { LoadedMessagingGatewayConfig, MessagingGatewayMode } from './config';
import type { GatewaySecretsStatus } from './secrets';

export interface GatewayStatusSummary {
	mode: Exclude<MessagingGatewayMode, 'auto'>;
	configPath: string;
	activeWorkspaceRoot: string;
	allowedWorkspaceRootsCount: number;
	allowlistedDiscordUsersCount: number;
	discordGuildId: string;
	discordChannelId: string;
	discordPermissionsChannelId?: string;
	secrets: GatewaySecretsStatus;
	extensionWsPort?: { port: number; source: 'env' | 'file' };
}

export function printGatewayStatusSummary(loaded: LoadedMessagingGatewayConfig, summary: GatewayStatusSummary) {
	console.log('[Gateway] Messaging gateway starting...');
	console.log(`[Gateway] Mode: ${summary.mode}`);
	console.log(`[Gateway] Config: ${loaded.configPath}`);
	console.log(`[Gateway] Active workspace: ${summary.activeWorkspaceRoot}`);
	console.log(`[Gateway] Workspace allowlist: ${summary.allowedWorkspaceRootsCount} roots`);
	console.log(`[Gateway] Discord allowlist: ${summary.allowlistedDiscordUsersCount} users`);
	console.log(`[Gateway] Discord scope: guild=${summary.discordGuildId} channel=${summary.discordChannelId}${summary.discordPermissionsChannelId ? ` permissions=${summary.discordPermissionsChannelId}` : ''}`);
	if (summary.extensionWsPort) {
		console.log(`[Gateway] Extension WS port: ${summary.extensionWsPort.port} (${summary.extensionWsPort.source})`);
	} else {
		console.log('[Gateway] Extension WS port: not configured');
	}

	console.log(
		`[Gateway] Secrets: discordBotToken=${summary.secrets.discordBotToken.present ? 'present' : 'missing'} (${summary.secrets.discordBotToken.source}), ` +
			`extensionWsJwt=${summary.secrets.extensionWsJwt.present ? 'present' : 'missing'} (${summary.secrets.extensionWsJwt.source})`,
	);
}
