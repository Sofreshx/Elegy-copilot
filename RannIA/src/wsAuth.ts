/**
 * JWT authentication for WebSocket connections.
 * Handles token verification and secret management.
 * 
 * Supports two authentication modes:
 * 1. Auto-generated JWT (dev mode) - uses local secret
 * 2. GitHub OAuth-based JWT (production) - validates against GitHub user
 */
import * as crypto from 'crypto';
import * as vscode from 'vscode';
import * as jwt from 'jsonwebtoken';

/** JWT payload structure (auto-generated mode) */
export interface WsJwtPayload {
	sub: string;      // Subject (user identifier)
	iat: number;      // Issued at
	exp: number;      // Expiration
	aud?: string;     // Audience (optional)
	github_id?: number;    // GitHub user ID (for OAuth tokens)
	github_login?: string; // GitHub username (for OAuth tokens)
}

/** Authentication result */
export interface AuthResult {
	valid: boolean;
	userId?: string;
	githubLogin?: string;
	githubId?: number;
	error?: string;
	mode?: 'local' | 'github';
}

/** Authentication mode */
export type AuthMode = 'local' | 'github' | 'both';

/** Secret storage key */
const SECRET_KEY = 'skillInstaller.ws.jwtSecret';

/**
 * Manages JWT authentication for the WebSocket server.
 * Supports both local (auto-generated) and GitHub OAuth-based tokens.
 */
export class WsAuthManager {
	private secret: string | undefined;
	private readonly output: vscode.OutputChannel;
	private readonly secretStorage: vscode.SecretStorage;

	constructor(secretStorage: vscode.SecretStorage, output: vscode.OutputChannel) {
		this.secretStorage = secretStorage;
		this.output = output;
	}

	/**
	 * Initialize the auth manager, loading or generating the secret.
	 */
	async initialize(): Promise<void> {
		// Check if user has configured a custom secret in settings
		const config = vscode.workspace.getConfiguration('skillInstaller.ws');
		const configuredSecret = config.get<string>('secret');

		if (configuredSecret && configuredSecret.trim().length > 0) {
			this.secret = configuredSecret.trim();
			this.output.appendLine('[WS Auth] Using configured secret from settings');
			return;
		}

		// Try to load from secure storage
		const storedSecret = await this.secretStorage.get(SECRET_KEY);
		if (storedSecret) {
			this.secret = storedSecret;
			this.output.appendLine('[WS Auth] Loaded secret from secure storage');
			return;
		}

		// Generate new secret and store it
		this.secret = this.generateSecret();
		await this.secretStorage.store(SECRET_KEY, this.secret);
		this.output.appendLine('[WS Auth] Generated and stored new secret');
	}

	/**
	 * Generate a cryptographically secure secret.
	 */
	private generateSecret(): string {
		return crypto.randomBytes(32).toString('base64');
	}

	/**
	 * Get the current secret (for display in pairing flow).
	 */
	getSecret(): string | undefined {
		return this.secret;
	}

	/**
	 * Generate a new token for a client (local/dev mode).
	 * @param userId Unique identifier for the user/device
	 * @param expiresInSeconds Token validity duration in seconds (default: 7 days)
	 */
	generateToken(userId: string, expiresInSeconds: number = 7 * 24 * 60 * 60): string {
		if (!this.secret) {
			throw new Error('Auth manager not initialized');
		}

		const now = Math.floor(Date.now() / 1000);
		const payload: WsJwtPayload = {
			sub: userId,
			iat: now,
			exp: now + expiresInSeconds,
		};

		return jwt.sign(payload, this.secret, { algorithm: 'HS256' });
	}

	/**
	 * Generate a token for a GitHub-authenticated user.
	 * @param githubId GitHub user ID
	 * @param githubLogin GitHub username
	 * @param expiresInSeconds Token validity duration in seconds (default: 1 hour)
	 */
	generateGitHubToken(githubId: number, githubLogin: string, expiresInSeconds: number = 60 * 60): string {
		if (!this.secret) {
			throw new Error('Auth manager not initialized');
		}

		const now = Math.floor(Date.now() / 1000);
		const payload: WsJwtPayload = {
			sub: `github:${githubLogin}`,
			github_id: githubId,
			github_login: githubLogin,
			iat: now,
			exp: now + expiresInSeconds,
		};

		return jwt.sign(payload, this.secret, { algorithm: 'HS256' });
	}

	/**
	 * Verify and decode a JWT token.
	 * Supports both local (auto-generated) and GitHub-based tokens.
	 * @param token The JWT token to verify
	 */
	verifyToken(token: string): AuthResult {
		if (!this.secret) {
			return { valid: false, error: 'Auth manager not initialized' };
		}

		try {
			const decoded = jwt.verify(token, this.secret, {
				algorithms: ['HS256'],
			}) as WsJwtPayload;

			// Determine auth mode based on token content
			const isGitHubToken = !!decoded.github_id && !!decoded.github_login;

			return {
				valid: true,
				userId: decoded.sub,
				githubId: decoded.github_id,
				githubLogin: decoded.github_login,
				mode: isGitHubToken ? 'github' : 'local',
			};
		} catch (err) {
			const error = err instanceof Error ? err.message : 'Token verification failed';
			this.output.appendLine(`[WS Auth] Token verification failed: ${error}`);
			return { valid: false, error };
		}
	}

	/**
	 * Extract token from WebSocket upgrade request.
	 * Supports both query parameter (?token=xxx) and Authorization header.
	 * @param url Request URL
	 * @param headers Request headers
	 */
	extractToken(url: string | undefined, headers: Record<string, string | string[] | undefined>): string | undefined {
		// Try query parameter first
		if (url) {
			try {
				const urlObj = new URL(url, 'http://localhost');
				const queryToken = urlObj.searchParams.get('token');
				if (queryToken) {
					return queryToken;
				}
			} catch {
				// Invalid URL, try headers
			}
		}

		// Try Authorization header (Bearer token)
		const authHeader = headers['authorization'] || headers['Authorization'];
		if (authHeader) {
			const headerValue = Array.isArray(authHeader) ? authHeader[0] : authHeader;
			if (headerValue?.startsWith('Bearer ')) {
				return headerValue.slice(7);
			}
		}

		// Try Sec-WebSocket-Protocol (for browsers that can't set headers)
		const protocol = headers['sec-websocket-protocol'] || headers['Sec-WebSocket-Protocol'];
		if (protocol) {
			const protocolValue = Array.isArray(protocol) ? protocol[0] : protocol;
			// Protocol format: "jwt, <token>"
			const parts = protocolValue?.split(',').map(p => p.trim());
			if (parts && parts.length === 2 && parts[0] === 'jwt') {
				return parts[1];
			}
		}

		return undefined;
	}

	/**
	 * Regenerate the secret (invalidates all existing tokens).
	 */
	async regenerateSecret(): Promise<void> {
		this.secret = this.generateSecret();
		await this.secretStorage.store(SECRET_KEY, this.secret);
		this.output.appendLine('[WS Auth] Secret regenerated - all existing tokens invalidated');
	}
}
