import { deletePassword, getPassword, setPassword } from '@napi-rs/keyring/keytar';

export type GatewaySecretKind = 'discordBotToken' | 'gatewayHttpToken';

export interface GatewaySecretsStatus {
	serviceName: string;
	discordBotToken: { present: boolean; source: 'keychain' | 'env' | 'missing' };
	gatewayHttpToken: { present: boolean; source: 'keychain' | 'env' | 'missing' };
}

const SERVICE_NAME = 'instruction-engine.messaging-gateway';
const SECRET_ACCOUNT: Record<GatewaySecretKind, string> = {
	discordBotToken: 'discord.botToken',
	gatewayHttpToken: 'gateway.httpToken',
};

const ENV_FALLBACKS: Record<GatewaySecretKind, string[]> = {
	discordBotToken: ['INSTRUCTION_ENGINE_DISCORD_BOT_TOKEN', 'DISCORD_BOT_TOKEN'],
	gatewayHttpToken: ['INSTRUCTION_ENGINE_GATEWAY_HTTP_TOKEN'],
};

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

	return {
		serviceName: SERVICE_NAME,
		discordBotToken: { present: Boolean(discord.value), source: discord.source },
		gatewayHttpToken: { present: Boolean(httpToken.value), source: httpToken.source },
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
