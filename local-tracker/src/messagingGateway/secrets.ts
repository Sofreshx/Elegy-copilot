import { deletePassword, getPassword, setPassword } from '@napi-rs/keyring/keytar';
import crypto from 'crypto';

export type GatewaySecretKind = 'discordBotToken' | 'gatewayHttpToken' | 'githubPrToken';

export interface PrTokenLease {
	leaseId: string;
	scope: string;
	expiresAtMs: number;
}

export interface GatewaySecretsStatus {
	serviceName: string;
	discordBotToken: { present: boolean; source: 'keychain' | 'env' | 'missing' };
	gatewayHttpToken: { present: boolean; source: 'keychain' | 'env' | 'missing' };
	githubPrToken: { present: boolean; source: 'keychain' | 'env' | 'missing' };
}

const SERVICE_NAME = 'instruction-engine.messaging-gateway';
const SECRET_ACCOUNT: Record<GatewaySecretKind, string> = {
	discordBotToken: 'discord.botToken',
	gatewayHttpToken: 'gateway.httpToken',
	githubPrToken: 'github.prToken',
};

const ENV_FALLBACKS: Record<GatewaySecretKind, string[]> = {
	discordBotToken: ['INSTRUCTION_ENGINE_DISCORD_BOT_TOKEN', 'DISCORD_BOT_TOKEN'],
	gatewayHttpToken: ['INSTRUCTION_ENGINE_GATEWAY_HTTP_TOKEN'],
	githubPrToken: ['INSTRUCTION_ENGINE_GITHUB_PR_TOKEN', 'GITHUB_PR_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN'],
};

const DEFAULT_PR_TOKEN_TTL_MS = 15 * 60 * 1000;

const prTokenLeases = new Map<string, {
	token: string;
	scope: string;
	expiresAtMs: number;
	issuedAtMs: number;
	revoked: boolean;
}>();

function getFromEnv(kind: GatewaySecretKind): string | undefined {
	for (const envKey of ENV_FALLBACKS[kind]) {
		const value = process.env[envKey];
		if (typeof value === 'string' && value.trim().length > 0) return value.trim();
	}
	return undefined;
}

export async function getGatewaySecret(kind: GatewaySecretKind): Promise<{ value?: string; source: 'keychain' | 'env' | 'missing' }> {
	try {
		const fromKeychain = await getPassword(SERVICE_NAME, SECRET_ACCOUNT[kind]);
		if (fromKeychain && fromKeychain.trim().length > 0) {
			return { value: fromKeychain, source: 'keychain' };
		}
	} catch {
		// Keychain failures should not leak secrets; we fall back to env.
	}

	const fromEnv = getFromEnv(kind);
	if (fromEnv) return { value: fromEnv, source: 'env' };
	return { source: 'missing' };
}

export async function storeGatewaySecretFromEnv(kind: GatewaySecretKind): Promise<void> {
	const envValue = getFromEnv(kind);
	if (!envValue) {
		throw new Error(
			`[Gateway] Cannot store ${kind}: missing env var (expected one of: ${ENV_FALLBACKS[kind].join(', ')})`,
		);
	}
	await setPassword(SERVICE_NAME, SECRET_ACCOUNT[kind], envValue);
}

export async function deleteGatewaySecret(kind: GatewaySecretKind): Promise<boolean> {
	return await deletePassword(SERVICE_NAME, SECRET_ACCOUNT[kind]);
}

export async function getGatewaySecretsStatus(): Promise<GatewaySecretsStatus> {
	const discord = await getGatewaySecret('discordBotToken');
	const httpToken = await getGatewaySecret('gatewayHttpToken');
	const githubPrToken = await getGatewaySecret('githubPrToken');

	return {
		serviceName: SERVICE_NAME,
		discordBotToken: { present: Boolean(discord.value), source: discord.source },
		gatewayHttpToken: { present: Boolean(httpToken.value), source: httpToken.source },
		githubPrToken: { present: Boolean(githubPrToken.value), source: githubPrToken.source },
	};
}

export async function ensureGatewayHttpToken(): Promise<{ value: string; source: 'keychain' | 'env' | 'generated' }> {
	// 1. Check keychain
	try {
		const fromKeychain = await getPassword(SERVICE_NAME, SECRET_ACCOUNT.gatewayHttpToken);
		if (fromKeychain && fromKeychain.trim().length > 0) {
			return { value: fromKeychain, source: 'keychain' };
		}
	} catch {
		// fall through
	}

	// 2. Check env
	const fromEnv = getFromEnv('gatewayHttpToken');
	if (fromEnv) return { value: fromEnv, source: 'env' };

	// 3. Generate new 256-bit secret and store in keychain
	const crypto = await import('crypto');
	const generated = crypto.randomBytes(32).toString('hex');
	try {
		await setPassword(SERVICE_NAME, SECRET_ACCOUNT.gatewayHttpToken, generated);
	} catch {
		// If keychain store fails, still return the generated token (it will work for this session).
		// The token won't persist across restarts without keychain, but env var fallback is available.
	}
	return { value: generated, source: 'generated' };
}

export function issuePrTokenLease(options: { token: string; ttlMs?: number; scope?: string }, nowMs: number = Date.now()): PrTokenLease {
	const token = String(options.token || '').trim();
	if (!token) throw new Error('[Gateway] Cannot issue PR token lease: token is required');

	const ttl = Number.isFinite(options.ttlMs) ? Number(options.ttlMs) : DEFAULT_PR_TOKEN_TTL_MS;
	if (!Number.isFinite(ttl) || ttl <= 0 || ttl > 24 * 60 * 60 * 1000) {
		throw new Error('[Gateway] Cannot issue PR token lease: ttlMs must be between 1 and 86400000');
	}

	const scope = String(options.scope || 'pr-open').trim() || 'pr-open';
	const leaseId = crypto.randomUUID();
	const expiresAtMs = nowMs + ttl;

	prTokenLeases.set(leaseId, {
		token,
		scope,
		expiresAtMs,
		issuedAtMs: nowMs,
		revoked: false,
	});

	return { leaseId, scope, expiresAtMs };
}

export function resolvePrTokenLease(leaseId: string, nowMs: number = Date.now()): string | undefined {
	const id = String(leaseId || '').trim();
	if (!id) return undefined;

	const lease = prTokenLeases.get(id);
	if (!lease) return undefined;
	if (lease.revoked) return undefined;
	if (lease.expiresAtMs <= nowMs) {
		prTokenLeases.delete(id);
		return undefined;
	}

	return lease.token;
}

export function revokePrTokenLease(leaseId: string): boolean {
	const id = String(leaseId || '').trim();
	if (!id) return false;

	const lease = prTokenLeases.get(id);
	if (!lease) return false;
	lease.revoked = true;
	prTokenLeases.set(id, lease);
	return true;
}

export function getPrTokenLeaseStatus(leaseId: string, nowMs: number = Date.now()): { state: 'missing' | 'active' | 'expired' | 'revoked'; scope?: string; expiresAtMs?: number } {
	const id = String(leaseId || '').trim();
	if (!id) return { state: 'missing' };

	const lease = prTokenLeases.get(id);
	if (!lease) return { state: 'missing' };
	if (lease.revoked) return { state: 'revoked', scope: lease.scope, expiresAtMs: lease.expiresAtMs };
	if (lease.expiresAtMs <= nowMs) return { state: 'expired', scope: lease.scope, expiresAtMs: lease.expiresAtMs };
	return { state: 'active', scope: lease.scope, expiresAtMs: lease.expiresAtMs };
}
