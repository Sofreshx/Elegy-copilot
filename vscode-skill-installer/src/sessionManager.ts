/**
 * Session manager for tracking Copilot agent sessions.
 * Provides in-memory session state that can be queried via WebSocket.
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { ExtensionEventEmitter } from './eventEmitter';

/** Session status lifecycle */
export type SessionStatus = 'pending' | 'active' | 'completed' | 'failed' | 'cancelled';

/** Session event emitted during agent execution */
export interface SessionEvent {
	timestamp: Date;
	type: 'started' | 'progress' | 'response' | 'completed' | 'error' | 'cancelled' | 'tool_call';
	data?: string;
}

/** Tool call tracked during agent execution */
export interface ToolCall {
	timestamp: Date;
	tool: string;                          // e.g., "read_file", "grep_search"
	args: Record<string, unknown>;         // sanitized arguments
	result?: string;                        // truncated result
	durationMs?: number;
	error?: string;
}

/** Agent session state */
export interface AgentSession {
	id: string;
	agentName: string;
	prompt: string;
	status: SessionStatus;
	startTime: Date;
	endTime?: Date;
	events: SessionEvent[];
	toolCalls: ToolCall[];
	error?: string;
	response?: string;
}

/** Session summary for WebSocket responses */
export interface SessionSummary {
	id: string;
	agentName: string;
	prompt: string;
	status: SessionStatus;
	startTime: string;
	endTime?: string;
	eventCount: number;
	error?: string;
}

/** Persisted session log format */
export interface SessionLog {
	session_id: string;
	agent: string;
	start_time: string;
	end_time?: string;
	status: SessionStatus;
	tool_calls: Array<{
		timestamp: string;
		tool: string;
		args: Record<string, unknown>;
		result?: string;
		durationMs?: number;
		error?: string;
	}>;
	messages: Array<{
		timestamp: string;
		type: string;
		content?: string;
	}>;
	response?: string;
	error?: string;
}

/**
 * Manages agent session state in memory.
 * Sessions are stored for the lifetime of the extension.
 */
export class SessionManager implements vscode.Disposable {
	private readonly sessions = new Map<string, AgentSession>();
	private readonly output: vscode.OutputChannel;
	private eventEmitter?: ExtensionEventEmitter;

	// Limit total sessions to prevent memory bloat
	private static readonly MAX_SESSIONS = 100;

	// Session log directory (relative to workspace)
	private static readonly LOG_DIR = '.instructions-output/sessions';

	constructor(output: vscode.OutputChannel) {
		this.output = output;
	}

	/**
	 * Set the event emitter for broadcasting session updates.
	 */
	setEventEmitter(emitter: ExtensionEventEmitter): void {
		this.eventEmitter = emitter;
	}

	/**
	 * Create a new session for an agent invocation.
	 */
	createSession(agentName: string, prompt: string): AgentSession {
		// Prune old sessions if at capacity
		if (this.sessions.size >= SessionManager.MAX_SESSIONS) {
			this.pruneOldestSessions(10);
		}

		const session: AgentSession = {
			id: crypto.randomUUID(),
			agentName,
			prompt,
			status: 'pending',
			startTime: new Date(),
			events: [],
			toolCalls: [],
		};

		this.sessions.set(session.id, session);
		this.output.appendLine(`[Session] Created: ${session.id} for @${agentName}`);

		return session;
	}

	/**
	 * Mark a session as active (agent started processing).
	 */
	startSession(sessionId: string): void {
		const session = this.sessions.get(sessionId);
		if (!session) {
			return;
		}

		session.status = 'active';
		this.addEvent(sessionId, { timestamp: new Date(), type: 'started' });

		// Emit typed session_started event
		this.eventEmitter?.emitSessionStarted(sessionId, session.agentName, session.prompt);

		this.output.appendLine(`[Session] Started: ${sessionId}`);
	}

	/**
	 * Add a progress event to the session.
	 */
	addProgress(sessionId: string, data: string): void {
		this.addEvent(sessionId, {
			timestamp: new Date(),
			type: 'progress',
			data,
		});

		// Emit typed session_progress event
		this.eventEmitter?.emitSessionProgress(sessionId, data);
	}

	/**
	 * Add a response chunk to the session.
	 */
	addResponse(sessionId: string, data: string): void {
		const session = this.sessions.get(sessionId);
		if (session) {
			session.response = (session.response ?? '') + data;
		}
		this.addEvent(sessionId, {
			timestamp: new Date(),
			type: 'response',
			data,
		});
	}

	/**
	 * Add a tool call to the session.
	 */
	addToolCall(sessionId: string, toolCall: ToolCall): void {
		const session = this.sessions.get(sessionId);
		if (!session) {
			return;
		}

		// Sanitize and truncate tool call data
		const sanitizedCall = this.sanitizeToolCall(toolCall);
		session.toolCalls.push(sanitizedCall);

		// Emit tool_call event (internal tracking)
		this.addEvent(sessionId, {
			timestamp: sanitizedCall.timestamp,
			type: 'tool_call',
			data: JSON.stringify({
				tool: sanitizedCall.tool,
				durationMs: sanitizedCall.durationMs,
				error: sanitizedCall.error,
			}),
		});

		// Emit typed tool_called event
		this.eventEmitter?.emitToolCalled(
			sessionId,
			sanitizedCall.tool,
			sanitizedCall.durationMs,
			sanitizedCall.error
		);

		this.output.appendLine(`[Session] Tool call: ${sanitizedCall.tool} (${sessionId})`);
	}

	/**
	 * Sanitize tool call data to prevent sensitive data exposure.
	 */
	private sanitizeToolCall(toolCall: ToolCall): ToolCall {
		const maxSize = this.getMaxLogSize();

		// Sanitize args - remove potentially sensitive keys
		const sanitizedArgs: Record<string, unknown> = {};
		const sensitiveKeys = ['password', 'secret', 'token', 'key', 'apiKey', 'api_key', 'authorization'];
		
		for (const [key, value] of Object.entries(toolCall.args)) {
			if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk))) {
				sanitizedArgs[key] = '[REDACTED]';
			} else if (typeof value === 'string' && value.length > 1000) {
				sanitizedArgs[key] = value.slice(0, 1000) + '...[truncated]';
			} else {
				sanitizedArgs[key] = value;
			}
		}

		// Truncate result if too large
		let truncatedResult = toolCall.result;
		if (truncatedResult && truncatedResult.length > maxSize) {
			truncatedResult = truncatedResult.slice(0, maxSize) + '...[truncated]';
		}

		return {
			...toolCall,
			args: sanitizedArgs,
			result: truncatedResult,
		};
	}

	/**
	 * Mark session as completed.
	 */
	completeSession(sessionId: string, finalResponse?: string): void {
		const session = this.sessions.get(sessionId);
		if (!session) {
			return;
		}

		session.status = 'completed';
		session.endTime = new Date();
		if (finalResponse) {
			session.response = finalResponse;
		}

		this.addEvent(sessionId, { timestamp: new Date(), type: 'completed' });

		// Emit typed session_completed event
		const durationMs = session.endTime.getTime() - session.startTime.getTime();
		this.eventEmitter?.emitSessionCompleted(
			sessionId,
			durationMs,
			session.toolCalls.length,
			session.response ? session.response.slice(0, 500) : undefined
		);

		this.output.appendLine(`[Session] Completed: ${sessionId}`);

		// Write session log to disk (non-blocking)
		this.writeSessionLog(sessionId).catch((err) => {
			this.output.appendLine(`[Session] Failed to write log: ${err}`);
		});
	}

	/**
	 * Mark session as failed.
	 */
	failSession(sessionId: string, error: string): void {
		const session = this.sessions.get(sessionId);
		if (!session) {
			return;
		}

		session.status = 'failed';
		session.endTime = new Date();
		session.error = error;

		this.addEvent(sessionId, {
			timestamp: new Date(),
			type: 'error',
			data: error,
		});

		// Emit typed session_error event
		this.eventEmitter?.emitSessionError(sessionId, error);

		this.output.appendLine(`[Session] Failed: ${sessionId} - ${error}`);

		// Write session log to disk (non-blocking)
		this.writeSessionLog(sessionId).catch((err) => {
			this.output.appendLine(`[Session] Failed to write log: ${err}`);
		});
	}

	/**
	 * Cancel a running session.
	 */
	cancelSession(sessionId: string): boolean {
		const session = this.sessions.get(sessionId);
		if (!session) {
			return false;
		}

		if (session.status !== 'pending' && session.status !== 'active') {
			return false; // Can't cancel a finished session
		}

		session.status = 'cancelled';
		session.endTime = new Date();

		this.addEvent(sessionId, { timestamp: new Date(), type: 'cancelled' });
		this.output.appendLine(`[Session] Cancelled: ${sessionId}`);

		return true;
	}

	/**
	 * Get a session by ID.
	 */
	getSession(sessionId: string): AgentSession | undefined {
		return this.sessions.get(sessionId);
	}

	/**
	 * Get all active sessions (pending or active).
	 */
	getActiveSessions(): AgentSession[] {
		return Array.from(this.sessions.values()).filter(
			(s) => s.status === 'pending' || s.status === 'active'
		);
	}

	/**
	 * Get all sessions.
	 */
	getAllSessions(): AgentSession[] {
		return Array.from(this.sessions.values());
	}

	/**
	 * Get session summaries (lightweight for WebSocket responses).
	 */
	getSessionSummaries(): SessionSummary[] {
		return Array.from(this.sessions.values()).map((s) => ({
			id: s.id,
			agentName: s.agentName,
			prompt: s.prompt.slice(0, 100) + (s.prompt.length > 100 ? '...' : ''),
			status: s.status,
			startTime: s.startTime.toISOString(),
			endTime: s.endTime?.toISOString(),
			eventCount: s.events.length,
			error: s.error,
		}));
	}

	/**
	 * Add an event to a session (internal tracking only, typed events emitted separately).
	 */
	private addEvent(sessionId: string, event: SessionEvent): void {
		const session = this.sessions.get(sessionId);
		if (!session) {
			return;
		}

		session.events.push(event);
	}

	/**
	 * Get session log settings.
	 */
	private isLoggingEnabled(): boolean {
		return vscode.workspace.getConfiguration('skillInstaller.session').get('loggingEnabled', true);
	}

	private getMaxLogSize(): number {
		return vscode.workspace.getConfiguration('skillInstaller.session').get('maxLogSize', 102400); // 100KB default
	}

	/**
	 * Get the workspace folder path for session logs.
	 */
	private getLogDirectory(): string | undefined {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		if (!workspaceFolder) {
			return undefined;
		}
		return path.join(workspaceFolder.uri.fsPath, SessionManager.LOG_DIR);
	}

	/**
	 * Write session log to disk.
	 * Called on session completion/failure.
	 */
	async writeSessionLog(sessionId: string): Promise<void> {
		if (!this.isLoggingEnabled()) {
			return;
		}

		const session = this.sessions.get(sessionId);
		if (!session) {
			return;
		}

		const logDir = this.getLogDirectory();
		if (!logDir) {
			this.output.appendLine('[Session] No workspace folder for session log');
			return;
		}

		// Ensure directory exists
		await fs.promises.mkdir(logDir, { recursive: true });

		const maxSize = this.getMaxLogSize();

		// Build session log
		const log: SessionLog = {
			session_id: session.id,
			agent: `@${session.agentName}`,
			start_time: session.startTime.toISOString(),
			end_time: session.endTime?.toISOString(),
			status: session.status,
			tool_calls: session.toolCalls.map((tc) => ({
				timestamp: tc.timestamp.toISOString(),
				tool: tc.tool,
				args: tc.args,
				result: tc.result,
				durationMs: tc.durationMs,
				error: tc.error,
			})),
			messages: session.events.map((e) => ({
				timestamp: e.timestamp.toISOString(),
				type: e.type,
				content: e.data,
			})),
			response: session.response ? this.truncateString(session.response, maxSize) : undefined,
			error: session.error,
		};

		const logPath = path.join(logDir, `${session.id}.json`);
		await fs.promises.writeFile(logPath, JSON.stringify(log, null, 2), 'utf-8');

		this.output.appendLine(`[Session] Log written: ${logPath}`);
	}

	/**
	 * Retrieve a persisted session log from disk.
	 */
	async getSessionLog(sessionId: string): Promise<SessionLog | undefined> {
		const logDir = this.getLogDirectory();
		if (!logDir) {
			return undefined;
		}

		const logPath = path.join(logDir, `${sessionId}.json`);
		try {
			const content = await fs.promises.readFile(logPath, 'utf-8');
			return JSON.parse(content) as SessionLog;
		} catch {
			// Log file doesn't exist or is invalid
			return undefined;
		}
	}

	/**
	 * Truncate a string to a maximum length.
	 */
	private truncateString(str: string, maxLength: number): string {
		if (str.length <= maxLength) {
			return str;
		}
		return str.slice(0, maxLength) + '...[truncated]';
	}

	/**
	 * Prune oldest completed sessions to free memory.
	 */
	private pruneOldestSessions(count: number): void {
		const completed = Array.from(this.sessions.entries())
			.filter(([, s]) => s.status !== 'pending' && s.status !== 'active')
			.sort((a, b) => a[1].startTime.getTime() - b[1].startTime.getTime());

		const toRemove = completed.slice(0, count);
		for (const [id] of toRemove) {
			this.sessions.delete(id);
		}

		if (toRemove.length > 0) {
			this.output.appendLine(`[Session] Pruned ${toRemove.length} old sessions`);
		}
	}

	dispose(): void {
		this.sessions.clear();
	}
}
