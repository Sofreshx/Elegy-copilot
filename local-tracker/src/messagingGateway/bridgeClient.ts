export type BridgeClientStatus =
	| 'idle'
	| 'connecting'
	| 'connected'
	| 'reconnecting'
	| 'auth_failed'
	| 'failed'
	| 'stopped';

export type InvokeAgentParams = Record<string, unknown> & {
	agentName: string;
	prompt: string;
};

export type CancelSessionParams = Record<string, unknown> & {
	sessionId: string;
};

export type ResolvePermissionParams = Record<string, unknown> & {
	callbackId: string;
	approved: boolean;
	resolvedBy?: string;
};

export interface BridgeClient {
	start(): void;
	stop(): Promise<void>;
	getStatus(): BridgeClientStatus;

	get_sessions(): Promise<unknown>;
	invoke_agent(params: InvokeAgentParams): Promise<unknown>;
	cancel_session(params: CancelSessionParams): Promise<unknown>;
	resolve_permission(params: ResolvePermissionParams): Promise<unknown>;
}

