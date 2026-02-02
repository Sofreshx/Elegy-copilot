/**
 * GitHub OAuth manager for VS Code extension authentication.
 * Handles OAuth flow, token storage, and user management.
 */
import * as vscode from 'vscode';
import * as crypto from 'crypto';

/** GitHub user information */
export interface GitHubUser {
	id: number;
	login: string;
	email?: string;
	avatarUrl?: string;
}

/** OAuth tokens */
export interface OAuthTokens {
	accessToken: string;
	tokenType: string;
	scope: string;
}

/** OAuth state for CSRF protection */
interface OAuthState {
	state: string;
	timestamp: number;
}

/** Secret storage keys */
const SECRETS = {
	ACCESS_TOKEN: 'skillInstaller.oauth.accessToken',
	USER_INFO: 'skillInstaller.oauth.userInfo',
};

/** OAuth configuration */
const OAUTH_CONFIG = {
	authorizationUrl: 'https://github.com/login/oauth/authorize',
	tokenUrl: 'https://github.com/login/oauth/access_token',
	userApiUrl: 'https://api.github.com/user',
	defaultScopes: 'read:user user:email',
	stateExpiry: 10 * 60 * 1000, // 10 minutes
};

/**
 * Manages GitHub OAuth authentication for the extension.
 */
export class GitHubOAuthManager implements vscode.Disposable {
	private readonly output: vscode.OutputChannel;
	private readonly secretStorage: vscode.SecretStorage;
	private readonly disposables: vscode.Disposable[] = [];
	
	/** Pending OAuth states for CSRF protection */
	private pendingStates: Map<string, OAuthState> = new Map();
	
	/** Cached user info (loaded from secrets on init) */
	private cachedUser: GitHubUser | null = null;
	
	/** Event emitter for auth state changes */
	private readonly _onAuthStateChanged = new vscode.EventEmitter<GitHubUser | null>();
	public readonly onAuthStateChanged = this._onAuthStateChanged.event;

	constructor(secretStorage: vscode.SecretStorage, output: vscode.OutputChannel) {
		this.secretStorage = secretStorage;
		this.output = output;
		this.disposables.push(this._onAuthStateChanged);
	}

	/**
	 * Initialize the OAuth manager, loading cached user info.
	 */
	async initialize(): Promise<void> {
		await this.loadCachedUser();
		this.output.appendLine(`[OAuth] Initialized${this.cachedUser ? ` (logged in as ${this.cachedUser.login})` : ' (not logged in)'}`);
	}

	/**
	 * Check if a client ID is configured.
	 */
	private getClientId(): string | undefined {
		const config = vscode.workspace.getConfiguration('skillInstaller.oauth');
		const clientId = config.get<string>('clientId')?.trim();
		return clientId && clientId.length > 0 ? clientId : undefined;
	}

	/**
	 * Get the configured redirect URI.
	 */
	private getRedirectUri(): string {
		const config = vscode.workspace.getConfiguration('skillInstaller.oauth');
		const customUri = config.get<string>('redirectUri')?.trim();
		if (customUri && customUri.length > 0) {
			return customUri;
		}
		// Default to VS Code URI scheme
		return 'vscode://sofreshx.skill-installer/auth/callback';
	}

	/**
	 * Initiate GitHub OAuth login flow.
	 * Opens browser to GitHub authorization page.
	 */
	async login(): Promise<void> {
		const clientId = this.getClientId();
		
		if (!clientId) {
			const action = await vscode.window.showErrorMessage(
				'GitHub OAuth not configured. Please set skillInstaller.oauth.clientId in settings.',
				'Open Settings',
				'Create OAuth App'
			);
			
			if (action === 'Open Settings') {
				await vscode.commands.executeCommand('workbench.action.openSettings', 'skillInstaller.oauth.clientId');
			} else if (action === 'Create OAuth App') {
				await vscode.env.openExternal(vscode.Uri.parse('https://github.com/settings/developers'));
			}
			return;
		}

		// Generate CSRF state
		const state = this.generateState();
		this.pendingStates.set(state, {
			state,
			timestamp: Date.now(),
		});
		
		// Clean up old pending states
		this.cleanupPendingStates();

		// Build authorization URL
		const redirectUri = this.getRedirectUri();
		const params = new URLSearchParams({
			client_id: clientId,
			redirect_uri: redirectUri,
			scope: OAUTH_CONFIG.defaultScopes,
			state: state,
		});

		const authUrl = `${OAUTH_CONFIG.authorizationUrl}?${params.toString()}`;
		
		this.output.appendLine(`[OAuth] Starting login flow (state: ${state.substring(0, 8)}...)`);
		
		// Open browser for authorization
		const opened = await vscode.env.openExternal(vscode.Uri.parse(authUrl));
		
		if (!opened) {
			void vscode.window.showErrorMessage('Failed to open browser for GitHub login.');
			this.pendingStates.delete(state);
			return;
		}

		void vscode.window.showInformationMessage('Complete the GitHub login in your browser. You will be redirected back to VS Code.');
	}

	/**
	 * Handle OAuth callback with authorization code.
	 * @param code Authorization code from GitHub
	 * @param state CSRF state token
	 */
	async handleCallback(code: string, state: string): Promise<GitHubUser> {
		this.output.appendLine(`[OAuth] Handling callback (state: ${state.substring(0, 8)}...)`);

		// Verify state (CSRF protection)
		const pendingState = this.pendingStates.get(state);
		if (!pendingState) {
			throw new Error('Invalid or expired state parameter. Please try logging in again.');
		}
		
		// Check state expiry
		if (Date.now() - pendingState.timestamp > OAUTH_CONFIG.stateExpiry) {
			this.pendingStates.delete(state);
			throw new Error('Login session expired. Please try again.');
		}
		
		// Remove used state
		this.pendingStates.delete(state);

		const clientId = this.getClientId();
		if (!clientId) {
			throw new Error('OAuth client ID not configured');
		}

		// Exchange code for access token
		// Note: In a production setup, this should go through a backend server
		// to keep the client secret secure. For development, we use a token-based approach.
		const tokens = await this.exchangeCodeForToken(code, clientId);
		
		// Fetch user info using the access token
		const user = await this.fetchUserInfo(tokens.accessToken);
		
		// Store tokens and user info securely
		await this.storeCredentials(tokens, user);
		
		// Update cached state
		this.cachedUser = user;
		this._onAuthStateChanged.fire(user);
		
		this.output.appendLine(`[OAuth] Login successful: ${user.login}`);
		void vscode.window.showInformationMessage(`Logged in as ${user.login}`);
		
		return user;
	}

	/**
	 * Exchange authorization code for access token.
	 * Note: This requires the OAuth App to be configured to allow implicit token exchange
	 * or a backend proxy to keep client_secret secure.
	 */
	private async exchangeCodeForToken(code: string, clientId: string): Promise<OAuthTokens> {
		const config = vscode.workspace.getConfiguration('skillInstaller.oauth');
		const clientSecret = config.get<string>('clientSecret')?.trim();
		
		// If no client secret is configured, we can't exchange tokens directly
		// The user should configure a token exchange proxy or use device flow
		if (!clientSecret) {
			throw new Error(
				'GitHub OAuth client secret not configured. ' +
				'For security, configure a token exchange proxy endpoint, ' +
				'or set skillInstaller.oauth.clientSecret for development use only.'
			);
		}

		const response = await fetch(OAUTH_CONFIG.tokenUrl, {
			method: 'POST',
			headers: {
				'Accept': 'application/json',
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				client_id: clientId,
				client_secret: clientSecret,
				code: code,
				redirect_uri: this.getRedirectUri(),
			}),
		});

		if (!response.ok) {
			const error = await response.text();
			this.output.appendLine(`[OAuth] Token exchange failed: ${response.status} ${error}`);
			throw new Error(`Failed to exchange code for token: ${response.statusText}`);
		}

		const data = await response.json() as Record<string, unknown>;
		
		if (data.error) {
			throw new Error(`GitHub OAuth error: ${data.error_description || data.error}`);
		}

		return {
			accessToken: data.access_token as string,
			tokenType: (data.token_type as string) || 'bearer',
			scope: (data.scope as string) || '',
		};
	}

	/**
	 * Fetch user information from GitHub API.
	 */
	private async fetchUserInfo(accessToken: string): Promise<GitHubUser> {
		const response = await fetch(OAUTH_CONFIG.userApiUrl, {
			headers: {
				'Accept': 'application/vnd.github+json',
				'Authorization': `Bearer ${accessToken}`,
				'X-GitHub-Api-Version': '2022-11-28',
			},
		});

		if (!response.ok) {
			throw new Error(`Failed to fetch user info: ${response.statusText}`);
		}

		const data = await response.json() as Record<string, unknown>;
		
		return {
			id: data.id as number,
			login: data.login as string,
			email: data.email as string | undefined,
			avatarUrl: data.avatar_url as string | undefined,
		};
	}

	/**
	 * Store OAuth credentials securely.
	 */
	private async storeCredentials(tokens: OAuthTokens, user: GitHubUser): Promise<void> {
		await this.secretStorage.store(SECRETS.ACCESS_TOKEN, tokens.accessToken);
		await this.secretStorage.store(SECRETS.USER_INFO, JSON.stringify(user));
	}

	/**
	 * Load cached user info from secure storage.
	 */
	private async loadCachedUser(): Promise<void> {
		const userJson = await this.secretStorage.get(SECRETS.USER_INFO);
		if (userJson) {
			try {
				this.cachedUser = JSON.parse(userJson) as GitHubUser;
			} catch {
				this.cachedUser = null;
			}
		}
	}

	/**
	 * Get the currently logged-in user.
	 */
	getUser(): GitHubUser | null {
		return this.cachedUser;
	}

	/**
	 * Check if user is logged in.
	 */
	isLoggedIn(): boolean {
		return this.cachedUser !== null;
	}

	/**
	 * Get the current access token (for API calls).
	 */
	async getAccessToken(): Promise<string | null> {
		return await this.secretStorage.get(SECRETS.ACCESS_TOKEN) || null;
	}

	/**
	 * Logout - clear all stored tokens and user info.
	 */
	async logout(): Promise<void> {
		const wasLoggedIn = this.isLoggedIn();
		const userName = this.cachedUser?.login;

		// Clear all stored credentials
		await this.secretStorage.delete(SECRETS.ACCESS_TOKEN);
		await this.secretStorage.delete(SECRETS.USER_INFO);
		
		// Clear cached state
		this.cachedUser = null;
		this.pendingStates.clear();
		
		// Fire event
		this._onAuthStateChanged.fire(null);
		
		if (wasLoggedIn) {
			this.output.appendLine(`[OAuth] Logged out: ${userName}`);
			void vscode.window.showInformationMessage(`Logged out from GitHub (${userName})`);
		}
	}

	/**
	 * Generate a secure random state for CSRF protection.
	 */
	private generateState(): string {
		return crypto.randomBytes(16).toString('hex');
	}

	/**
	 * Clean up expired pending states.
	 */
	private cleanupPendingStates(): void {
		const now = Date.now();
		for (const [state, data] of this.pendingStates) {
			if (now - data.timestamp > OAUTH_CONFIG.stateExpiry) {
				this.pendingStates.delete(state);
			}
		}
	}

	dispose(): void {
		for (const d of this.disposables) {
			d.dispose();
		}
	}
}

/**
 * URI handler for OAuth callbacks.
 * Handles URIs like: vscode://sofreshx.skill-installer/auth/callback?code=xxx&state=yyy
 */
export class OAuthUriHandler implements vscode.UriHandler {
	private readonly output: vscode.OutputChannel;
	private readonly oauthManager: GitHubOAuthManager;

	constructor(oauthManager: GitHubOAuthManager, output: vscode.OutputChannel) {
		this.oauthManager = oauthManager;
		this.output = output;
	}

	async handleUri(uri: vscode.Uri): Promise<void> {
		this.output.appendLine(`[OAuth] URI handler received: ${uri.path}`);

		// Handle auth callback
		if (uri.path === '/auth/callback') {
			const params = new URLSearchParams(uri.query);
			const code = params.get('code');
			const state = params.get('state');
			const error = params.get('error');
			const errorDescription = params.get('error_description');

			if (error) {
				this.output.appendLine(`[OAuth] Auth error: ${error} - ${errorDescription}`);
				void vscode.window.showErrorMessage(
					`GitHub login failed: ${errorDescription || error}`
				);
				return;
			}

			if (!code || !state) {
				void vscode.window.showErrorMessage(
					'Invalid OAuth callback. Missing code or state parameter.'
				);
				return;
			}

			try {
				await this.oauthManager.handleCallback(code, state);
			} catch (err) {
				const message = err instanceof Error ? err.message : 'Unknown error';
				this.output.appendLine(`[OAuth] Callback error: ${message}`);
				void vscode.window.showErrorMessage(`GitHub login failed: ${message}`);
			}
		} else {
			this.output.appendLine(`[OAuth] Unhandled URI path: ${uri.path}`);
		}
	}
}
