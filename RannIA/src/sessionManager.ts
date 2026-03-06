/**
 * Session manager for tracking Copilot agent sessions.
 * Provides in-memory session state that can be queried via WebSocket.
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { ExtensionEventEmitter } from './eventEmitter';
import { getRepoStateKey, getSessionDir } from './enginePaths';

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

	// Best-effort artifact persistence (plan snapshots) during a running session.
	private readonly artifactWriteTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private readonly lastPlanSha256BySession = new Map<string, string>();
	private readonly lastPlanWriteMsBySession = new Map<string, number>();

	// Limit total sessions to prevent memory bloat
	private static readonly MAX_SESSIONS = 100;

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

		// Persist plan artifacts opportunistically during the session so they aren't lost on cancellation/crash.
		this.scheduleArtifactWrite(sessionId);
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

		// Finalize artifacts (plan verdict/status) before writing the session log.
		this.flushArtifactWrite(sessionId, { finalize: true });

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

		// Finalize artifacts (mark as dropped/not-approved) before writing the session log.
		this.flushArtifactWrite(sessionId, { finalize: true });

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

		// Persist whatever we have so far (including partial plan output).
		this.flushArtifactWrite(sessionId, { finalize: true });
		this.writeSessionLog(sessionId).catch((err) => {
			this.output.appendLine(`[Session] Failed to write log (cancelled): ${err}`);
		});

		return true;
	}

	private scheduleArtifactWrite(sessionId: string): void {
		const session = this.sessions.get(sessionId);
		if (!session) return;
		if (!session.response || session.response.length < 200) return;

		// Only attempt artifact persistence for responses that plausibly contain a plan.
		const agentHint = (session.agentName || '').toLowerCase();
		const responseHint = this.looksLikePlanText(session.response);
		if (!(responseHint || agentHint.includes('planner'))) return;

		const existing = this.artifactWriteTimers.get(sessionId);
		if (existing) clearTimeout(existing);

		const t = setTimeout(() => {
			this.artifactWriteTimers.delete(sessionId);
			this.flushArtifactWrite(sessionId, { finalize: false });
		}, 400);
		this.artifactWriteTimers.set(sessionId, t);
	}

	private flushArtifactWrite(sessionId: string, opts: { finalize: boolean }): void {
		const session = this.sessions.get(sessionId);
		if (!session || !session.response) return;

		try {
			const planText = this.extractPlanArtifactText(session.response);
			if (!planText) return;

			const sha = crypto.createHash('sha256').update(planText, 'utf8').digest('hex');
			const lastSha = this.lastPlanSha256BySession.get(sessionId);
			const now = Date.now();
			const lastWrite = this.lastPlanWriteMsBySession.get(sessionId) ?? 0;

			// Throttle writes: avoid hammering the disk on rapid streaming chunks.
			if (!opts.finalize && lastSha === sha && now - lastWrite < 1500) return;

			const sessionDir = getSessionDir(session.id);
			fs.mkdirSync(sessionDir, { recursive: true });

			this.writePlanArtifacts(sessionId, sessionDir, planText, { finalize: opts.finalize });
			this.lastPlanSha256BySession.set(sessionId, sha);
			this.lastPlanWriteMsBySession.set(sessionId, now);
		} catch {
			// best-effort persistence only
		}
	}

	private looksLikePlanText(text: string): boolean {
		const t = text;
		return (
			t.includes('# Plan Pack') ||
			t.includes('Plan Pack —') ||
			t.includes('# Plan-Pack Progress Tracker') ||
			t.includes('## Work Unit Specs')
		);
	}

	private extractPlanArtifactText(fullResponse: string): string | null {
		if (!this.looksLikePlanText(fullResponse)) return null;
		// For now: store the full response. The planner output is expected to be "Plan Pack" + "Progress Tracker" + handoff.
		// (We avoid brittle parsing here; the dashboard can still render a full markdown blob.)
		const maxBytes = 2 * 1024 * 1024; // 2MB cap
		const buf = Buffer.from(fullResponse, 'utf8');
		if (buf.length <= maxBytes) return fullResponse;
		return buf.subarray(0, maxBytes).toString('utf8') + '\n\n…(truncated)\n';
	}

	private extractPlanReviewVerdict(planText: string): string | null {
		const m = planText.match(/^[ \t]*Plan Review Verdict:[ \t]*([A-Z_\-]+)[ \t]*$/m);
		if (m && m[1]) return String(m[1]).trim();

		// Fallback heuristics.
		const approvedCount = (planText.match(/^[ \t]*Verdict:[ \t]*APPROVED\b/mg) || []).length;
		const blockedCount = (planText.match(/^[ \t]*Verdict:[ \t]*BLOCKED\b/mg) || []).length;
		const needsCount = (planText.match(/^[ \t]*Verdict:[ \t]*NEEDS_REVISION\b/mg) || []).length;
		if (approvedCount >= 2 && blockedCount === 0 && needsCount === 0) return 'APPROVED';
		if (blockedCount > 0) return 'NOT_APPROVED';
		if (needsCount > 0) return 'NOT_APPROVED';
		return null;
	}

	private writePlanArtifacts(sessionId: string, sessionDir: string, planText: string, opts: { finalize: boolean }): void {
		// Latest plan pointer
		try {
			fs.writeFileSync(path.join(sessionDir, 'plan.md'), planText, 'utf-8');
		} catch {
			// ignore
		}

		// Revisioned plan snapshots (for UI browsing / dropped plan recovery)
		const plansDir = path.join(sessionDir, 'plans');
		try {
			fs.mkdirSync(plansDir, { recursive: true });
		} catch {
			return;
		}

		const indexPath = path.join(plansDir, 'index.json');
		type PlanRecord = Record<string, unknown>;
		type PlanIndex = {
			schemaVersion: number;
			sessionId: string;
			updatedAt: string;
			plans: PlanRecord[];
		};
		let index: PlanIndex | null = null;
		try {
			if (fs.existsSync(indexPath) && fs.statSync(indexPath).isFile()) {
				const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf-8')) as unknown;
				if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
					const candidate = parsed as Record<string, unknown>;
					const plans = Array.isArray(candidate.plans)
						? candidate.plans.filter((p): p is PlanRecord => !!p && typeof p === 'object' && !Array.isArray(p))
						: [];
					index = {
						schemaVersion: typeof candidate.schemaVersion === 'number' ? candidate.schemaVersion : 1,
						sessionId: typeof candidate.sessionId === 'string' ? candidate.sessionId : sessionId,
						updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : new Date().toISOString(),
						plans,
					};
				}
			}
		} catch {
			index = null;
		}
		if (!index) {
			index = { schemaVersion: 1, sessionId, updatedAt: new Date().toISOString(), plans: [] };
		}
		if (!Array.isArray(index.plans)) index.plans = [];

		let active = index.plans.find((p) => p.status === 'active');
		if (!active) {
			const id = `rev-0001`;
			active = {
				id,
				file: `${id}.md`,
				status: 'active',
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				bytes: 0,
				sha256: null,
				verdict: null,
			};
			index.plans.push(active);
		}

		const outPath = path.join(plansDir, String(active.file || `${active.id}.md`));
		try {
			fs.writeFileSync(outPath, planText, 'utf-8');
			const sha = crypto.createHash('sha256').update(planText, 'utf8').digest('hex');
			active.sha256 = sha;
			active.bytes = Buffer.byteLength(planText, 'utf8');
			active.updatedAt = new Date().toISOString();
			if (opts.finalize) {
				const verdict = this.extractPlanReviewVerdict(planText);
				active.verdict = verdict;
				if (verdict === 'APPROVED') {
					active.status = 'approved';
				} else if (verdict === 'USER_APPROVED_WITH_RISKS') {
					active.status = 'user-approved-with-risks';
				} else {
					active.status = 'dropped';
				}
			}
		} catch {
			// ignore
		}

		index.updatedAt = new Date().toISOString();
		try {
			fs.writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n', 'utf-8');
		} catch {
			// ignore
		}
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
	private getRepoContext(): { repoPath: string | null; repoId: string | null; repoLabel: string | null } {
		const repoPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
		if (!repoPath) {
			return { repoPath: null, repoId: null, repoLabel: null };
		}
		const key = getRepoStateKey(repoPath);
		return { repoPath, repoId: key.repoId, repoLabel: key.repoLabel };
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

		const sessionDir = getSessionDir(session.id);
		await fs.promises.mkdir(sessionDir, { recursive: true });

		const maxSize = this.getMaxLogSize();

		const repo = this.getRepoContext();
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

		const meta = {
			id: session.id,
			source: 'vscode',
			createdAt: session.startTime.toISOString(),
			updatedAt: (session.endTime ?? new Date()).toISOString(),
			status: session.status,
			agent: `@${session.agentName}`,
			repoId: repo.repoId,
			repoLabel: repo.repoLabel,
			repoPath: repo.repoPath,
			promptPreview: session.prompt.slice(0, 500),
			promptLength: session.prompt.length,
			toolCallCount: session.toolCalls.length,
			responsePreview: session.response ? session.response.slice(0, 500) : undefined,
			error: session.error,
		};

		await fs.promises.writeFile(path.join(sessionDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8');
		await fs.promises.writeFile(path.join(sessionDir, 'session.json'), JSON.stringify(log, null, 2), 'utf-8');

		// Write events in a format the CLI dashboard parser already understands.
		const cwd = repo.repoPath;
		const startEvent = {
			type: 'session.start',
			ts: session.startTime.getTime(),
			payload: {
				repo: repo.repoLabel,
				branch: null,
				cwd,
				startTime: session.startTime.toISOString(),
			},
		};

		const events: unknown[] = [startEvent];
		for (const e of session.events) {
			events.push({
				type: `session.${e.type}`,
				ts: e.timestamp.getTime(),
				payload: e.data ? { data: this.truncateString(e.data, 2000) } : {},
			});
		}
		for (const tc of session.toolCalls) {
			events.push({
				type: 'tool.execution_start',
				ts: tc.timestamp.getTime(),
				payload: {
					toolName: tc.tool,
					arguments: tc.args,
				},
			});
			events.push({
				type: 'tool.execution_end',
				ts: tc.timestamp.getTime(),
				payload: {
					toolName: tc.tool,
					durationMs: tc.durationMs,
					error: tc.error,
				},
			});
		}
		if (session.endTime) {
			events.push({
				type: `session.${session.status}`,
				ts: session.endTime.getTime(),
				payload: {
					endTime: session.endTime.toISOString(),
					toolCalls: session.toolCalls.length,
				},
			});
		}

		await fs.promises.writeFile(
			path.join(sessionDir, 'events.jsonl'),
			events.map((x) => JSON.stringify(x)).join('\n') + '\n',
			'utf-8'
		);

		await fs.promises.writeFile(
			path.join(sessionDir, 'tool-calls.jsonl'),
			session.toolCalls.map((x) => JSON.stringify(x)).join('\n') + (session.toolCalls.length ? '\n' : ''),
			'utf-8'
		);

		if (session.response) {
			await fs.promises.writeFile(path.join(sessionDir, 'final.md'), session.response, 'utf-8');

			// Best-effort: also persist a plan artifact if the response contains one.
			try {
				const planText = this.extractPlanArtifactText(session.response);
				if (planText) {
					this.writePlanArtifacts(sessionId, sessionDir, planText, { finalize: true });
				}
			} catch {
				// ignore
			}
		}

		this.output.appendLine(`[Session] Log written: ${sessionDir.replace(/\\/g, '/')}`);
	}

	/**
	 * Retrieve a persisted session log from disk.
	 */
	async getSessionLog(sessionId: string): Promise<SessionLog | undefined> {
		const logPath = path.join(getSessionDir(sessionId), 'session.json');
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
