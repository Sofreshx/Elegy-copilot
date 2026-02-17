import fs from 'fs';
import os from 'os';
import path from 'path';

export interface MessagingGatewayStatusV1 {
	schemaVersion: 1;
	lastUpdatedUtc: string;

	config: {
		configPath: string;
		mode: 'connected' | 'disconnected';
		discord: {
			guildId: string;
			channelId: string;
			permissionsChannelId?: string;
		};
		allowlists: {
			discordUsersCount: number;
			workspaceRootsCount: number;
		};
		workspaces: {
			activeRoot: string;
		};
	};

	secrets: {
		discordBotToken: {
			present: boolean;
			fromKeychain: boolean;
			fromEnv: boolean;
		};
		extensionWsJwt: {
			present: boolean;
			fromKeychain: boolean;
			fromEnv: boolean;
		};
	};

	runtime: {
		discord: {
			connected: boolean;
			ready: boolean;
		};
		extensionWs?: {
			connected: boolean;
		};
		sessions?: {
			activeSessionThreadCount: number;
		};
	};
}

export function getDefaultMessagingGatewayStatusPath(): string {
	return path.join(os.homedir(), '.instruction-engine', 'messaging-gateway.status.json');
}

export function resolveMessagingGatewayStatusPath(configPath: string): string {
	// WU-014 requirement + extension reader both assume the default home-based path.
	// Keep the signature (configPath) for future evolution, but always write to default for now.
	void configPath;
	return getDefaultMessagingGatewayStatusPath();
}

function ensureParentDir(filePath: string): void {
	const dir = path.dirname(filePath);
	if (!dir) return;
	fs.mkdirSync(dir, { recursive: true });
}

function writeAtomicFile(destPath: string, contents: string): void {
	ensureParentDir(destPath);

	const dir = path.dirname(destPath);
	const tmpName = `${path.basename(destPath)}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
	const tmpPath = path.join(dir, tmpName);

	fs.writeFileSync(tmpPath, contents, 'utf8');

	try {
		fs.renameSync(tmpPath, destPath);
		return;
	} catch {
		// Some platforms cannot rename over an existing file.
		try {
			if (fs.existsSync(destPath)) {
				fs.unlinkSync(destPath);
			}
			fs.renameSync(tmpPath, destPath);
			return;
		} catch {
			// Best-effort cleanup.
			try {
				if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
			} catch {
				// ignore
			}
			throw new Error(`[Gateway] Failed to write status file: ${destPath}`);
		}
	}
}

export class MessagingGatewayStatusWriter {
	private heartbeatTimer: NodeJS.Timeout | undefined;

	constructor(
		private readonly statusPath: string,
		private readonly status: MessagingGatewayStatusV1,
	) {}

	getPath(): string {
		return this.statusPath;
	}

	stopHeartbeat(): void {
		if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
		this.heartbeatTimer = undefined;
	}

	startHeartbeat(intervalMs: number, onBeat: (status: MessagingGatewayStatusV1) => void): void {
		this.stopHeartbeat();
		this.heartbeatTimer = setInterval(() => {
			try {
				onBeat(this.status);
				this.writeNow();
			} catch {
				// Heartbeat is best-effort; do not crash the gateway.
			}
		}, intervalMs);
	}

	update(mutator: (status: MessagingGatewayStatusV1) => void): void {
		try {
			mutator(this.status);
			this.writeNow();
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error(`[Gateway] Status write failed: ${message}`);
		}
	}

	writeNow(): void {
		this.status.lastUpdatedUtc = new Date().toISOString();
		const json = JSON.stringify(this.status, null, 2);
		writeAtomicFile(this.statusPath, json);
	}
}
