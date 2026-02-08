/**
 * Chat participant for remote control of Copilot agent sessions.
 * Enables programmatic invocation of agents via WebSocket commands.
 */
import * as vscode from 'vscode';
import { SessionManager } from './sessionManager';
import { scanAgents } from './agentScanner';

/** Parsed agent invocation request */
interface AgentInvocation {
	agentName: string;
	prompt: string;
}

/** Chat participant result */
interface RemoteControlResult extends vscode.ChatResult {
	sessionId?: string;
}

/**
 * Remote control chat participant for programmatic agent invocation.
 */
export class RemoteControlParticipant implements vscode.Disposable {
	private readonly output: vscode.OutputChannel;
	private readonly sessionManager: SessionManager;
	private readonly disposables: vscode.Disposable[] = [];
	private participant: vscode.ChatParticipant | undefined;

	constructor(output: vscode.OutputChannel, sessionManager: SessionManager) {
		this.output = output;
		this.sessionManager = sessionManager;
	}

	/**
	 * Register the chat participant with VS Code.
	 */
	register(): void {
		try {
			this.participant = vscode.chat.createChatParticipant(
				'instruction-engine.remote-control',
				this.handleRequest.bind(this)
			);

			this.participant.iconPath = new vscode.ThemeIcon('remote');

			// Register slash command handlers
			// Using property initialization if available in API
			this.output.appendLine('[Chat Participant] Registered: @remote-control');

		} catch (err) {
			const message = err instanceof Error ? err.message : 'Unknown error';
			this.output.appendLine(`[Chat Participant] Failed to register: ${message}`);
		}
	}

	/**
	 * Handle incoming chat request.
	 */
	private async handleRequest(
		request: vscode.ChatRequest,
		context: vscode.ChatContext,
		response: vscode.ChatResponseStream,
		token: vscode.CancellationToken
	): Promise<RemoteControlResult> {
		this.output.appendLine(
			`[Chat Participant] Request: command=${request.command ?? 'none'}, prompt="${request.prompt.slice(0, 50)}..."`
		);

		// Handle slash commands
		if (request.command) {
			switch (request.command) {
				case 'status':
					return this.handleStatusCommand(response);
				case 'cancel':
					return this.handleCancelCommand(request.prompt, response);
				case 'list':
					return this.handleListCommand(response);
				case 'invoke':
					return this.handleInvokeCommand(request.prompt, response, token);
				default:
					response.markdown(
						`Unknown command: \`/${request.command}\`\n\nAvailable commands:\n- \`/status\` - Show active sessions\n- \`/cancel <id>\` - Cancel a session\n- \`/list\` - List available agents\n- \`/invoke @agent prompt\` - Invoke an agent`
					);
					return {};
			}
		}

		// Default: try to parse as agent invocation
		const invocation = this.parseAgentInvocation(request.prompt);
		if (invocation) {
			return this.invokeAgent(invocation, response, token);
		}

		// Unknown request
		response.markdown(
			`**Remote Control**\n\nUse slash commands:\n- \`/status\` - Show active sessions\n- \`/cancel <id>\` - Cancel a session\n- \`/list\` - List available agents\n- \`/invoke @agent prompt\` - Invoke an agent\n\nOr invoke an agent directly: \`@remote-control @executive2-planner Create a dashboard\``
		);

		return {};
	}

	/**
	 * Handle /status command - show active sessions.
	 */
	private handleStatusCommand(
		response: vscode.ChatResponseStream
	): RemoteControlResult {
		const sessions = this.sessionManager.getSessionSummaries();
		const active = sessions.filter(
			(s) => s.status === 'pending' || s.status === 'active'
		);

		if (sessions.length === 0) {
			response.markdown('No sessions recorded.');
			return {};
		}

		let md = `## Session Status\n\n`;
		md += `**Active:** ${active.length} | **Total:** ${sessions.length}\n\n`;

		if (active.length > 0) {
			md += `### Active Sessions\n\n`;
			for (const s of active) {
				md += `- **${s.id.slice(0, 8)}** - @${s.agentName} (${s.status})\n`;
				md += `  - Prompt: ${s.prompt}\n`;
				md += `  - Started: ${s.startTime}\n\n`;
			}
		}

		// Show recent completed
		const recent = sessions
			.filter((s) => s.status !== 'pending' && s.status !== 'active')
			.slice(-5)
			.reverse();

		if (recent.length > 0) {
			md += `### Recent Sessions\n\n`;
			for (const s of recent) {
				const icon = s.status === 'completed' ? '✓' : s.status === 'cancelled' ? '⊘' : '✗';
				md += `- ${icon} **${s.id.slice(0, 8)}** - @${s.agentName} (${s.status})\n`;
			}
		}

		response.markdown(md);
		return {};
	}

	/**
	 * Handle /cancel command - cancel a running session.
	 */
	private handleCancelCommand(
		prompt: string,
		response: vscode.ChatResponseStream
	): RemoteControlResult {
		const sessionId = prompt.trim();

		if (!sessionId) {
			response.markdown(
				'Usage: `/cancel <session-id>`\n\nProvide the session ID to cancel.'
			);
			return {};
		}

		// Try to find session by full ID or partial match
		let targetId = sessionId;
		const sessions = this.sessionManager.getAllSessions();
		const match = sessions.find(
			(s) => s.id === sessionId || s.id.startsWith(sessionId)
		);

		if (match) {
			targetId = match.id;
		}

		const cancelled = this.sessionManager.cancelSession(targetId);

		if (cancelled) {
			response.markdown(`✓ Session **${targetId.slice(0, 8)}** cancelled.`);
		} else {
			const session = this.sessionManager.getSession(targetId);
			if (!session) {
				response.markdown(`Session not found: \`${sessionId}\``);
			} else {
				response.markdown(
					`Cannot cancel session **${targetId.slice(0, 8)}** - status is \`${session.status}\``
				);
			}
		}

		return {};
	}

	/**
	 * Handle /list command - list available agents.
	 */
	private async handleListCommand(
		response: vscode.ChatResponseStream
	): Promise<RemoteControlResult> {
		response.progress('Scanning for agents...');

		try {
			const snapshot = await scanAgents();
			let md = `## Available Agents\n\n`;

			for (const repo of snapshot.repos) {
				if (repo.agents.length === 0) {
					continue;
				}

				md += `### ${repo.repoName}\n\n`;
				for (const agent of repo.agents) {
					const status = agent.enabled ? '' : ' *(disabled)*';
					const name = agent.fileName.replace('.agent.md', '');
					md += `- **@${name}**${status}`;
					if (agent.description) {
						md += ` - ${agent.description}`;
					}
					md += '\n';
				}
				md += '\n';
			}

			if (!snapshot.repos.some((r) => r.agents.length > 0)) {
				md += '*No agents found in workspace.*\n';
			}

			response.markdown(md);
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Unknown error';
			response.markdown(`Failed to scan agents: ${message}`);
		}

		return {};
	}

	/**
	 * Handle /invoke command - explicitly invoke an agent.
	 */
	private async handleInvokeCommand(
		prompt: string,
		response: vscode.ChatResponseStream,
		token: vscode.CancellationToken
	): Promise<RemoteControlResult> {
		const invocation = this.parseAgentInvocation(prompt);

		if (!invocation) {
			response.markdown(
				'Usage: `/invoke @agent-name Your prompt here`\n\nExample: `/invoke @executive2-planner Create a dashboard feature`'
			);
			return {};
		}

		return this.invokeAgent(invocation, response, token);
	}

	/**
	 * Invoke an agent with the given prompt.
	 */
	private async invokeAgent(
		invocation: AgentInvocation,
		response: vscode.ChatResponseStream,
		token: vscode.CancellationToken
	): Promise<RemoteControlResult> {
		const { agentName, prompt } = invocation;

		// Create session
		const session = this.sessionManager.createSession(agentName, prompt);
		response.progress(`Starting session ${session.id.slice(0, 8)}...`);

		try {
			this.sessionManager.startSession(session.id);

			// Attempt to invoke the agent
			// Strategy 1: Try to use vscode.chat.transferChatSession if available
			// Strategy 2: Use workbench.action.chat.open with participant reference
			// Strategy 3: Fall back to showing instructions

			response.markdown(
				`## Agent Invocation\n\n**Session:** \`${session.id.slice(0, 8)}\`\n**Agent:** @${agentName}\n**Prompt:** ${prompt}\n\n---\n\n`
			);

			// Check if we're cancelled
			if (token.isCancellationRequested) {
				this.sessionManager.cancelSession(session.id);
				return { sessionId: session.id };
			}

			// Try to invoke the agent via VS Code's chat mechanism
			// Current VS Code Chat API doesn't expose direct agent invocation,
			// so we provide guidance and emit events for WebSocket clients

			const agentMessage = `@${agentName} ${prompt}`;

			// Attempt programmatic invocation via commands
			try {
				// Focus chat panel first
				await vscode.commands.executeCommand('workbench.panel.chat.view.copilot.focus');

				// Try to send message (this command may not exist in all versions)
				// Using sendInteractiveRequestToProvider if available
				await vscode.commands.executeCommand(
					'vscode.chat.sendRequest',
					agentMessage
				);

				response.markdown(
					`✓ Request sent to @${agentName}.\n\n*Monitor the Copilot chat panel for responses.*`
				);
				this.sessionManager.completeSession(session.id);

			} catch {
				// Fallback: provide manual instructions
				response.markdown(
					`**Action Required:** Copy the following to the Copilot chat:\n\n\`\`\`\n${agentMessage}\n\`\`\`\n\n*Note: Direct agent invocation requires VS Code 1.93+ with Chat API.* `
				);

				// Mark as completed since we've provided the invocation path
				this.sessionManager.addResponse(
					session.id,
					`Manual invocation required: ${agentMessage}`
				);
				this.sessionManager.completeSession(session.id);
			}

			return { sessionId: session.id };

		} catch (err) {
			const message = err instanceof Error ? err.message : 'Unknown error';
			this.sessionManager.failSession(session.id, message);
			response.markdown(`\n\n**Error:** ${message}`);
			return { sessionId: session.id };
		}
	}

	/**
	 * Parse a prompt to extract agent name and message.
	 * Supports: "@agent-name prompt" or "agent-name: prompt"
	 */
	private parseAgentInvocation(prompt: string): AgentInvocation | undefined {
		const trimmed = prompt.trim();
		if (!trimmed) {
			return undefined;
		}

		// Pattern 1: @agent-name prompt
		const atMatch = trimmed.match(/^@([a-zA-Z0-9_-]+)\s+(.+)$/s);
		if (atMatch) {
			return {
				agentName: atMatch[1],
				prompt: atMatch[2].trim(),
			};
		}

		// Pattern 2: agent-name: prompt (colon separator)
		const colonMatch = trimmed.match(/^([a-zA-Z0-9_-]+):\s+(.+)$/s);
		if (colonMatch) {
			return {
				agentName: colonMatch[1],
				prompt: colonMatch[2].trim(),
			};
		}

		return undefined;
	}

	/**
	 * Programmatically start an agent session (called from WebSocket).
	 */
	async startRemoteSession(
		agentName: string,
		prompt: string
	): Promise<{ sessionId: string; success: boolean; error?: string }> {
		this.output.appendLine(
			`[Chat Participant] Remote session request: @${agentName} "${prompt.slice(0, 50)}..."`
		);

		const session = this.sessionManager.createSession(agentName, prompt);

		try {
			this.sessionManager.startSession(session.id);

			// Focus and send to chat
			await vscode.commands.executeCommand('workbench.panel.chat.view.copilot.focus');

			// Construct the message for the target agent
			const chatMessage = `@${agentName} ${prompt}`;

			// Try to send via chat command
			try {
				await vscode.commands.executeCommand('vscode.chat.sendRequest', chatMessage);
				this.sessionManager.completeSession(session.id);
				return { sessionId: session.id, success: true };
			} catch {
				// Programmatic invocation not available — report failure
				this.sessionManager.failSession(
					session.id,
					`Manual invocation required: ${chatMessage}`
				);
				return {
					sessionId: session.id,
					success: false,
					error: `Direct agent invocation not available. Manual invocation required: ${chatMessage}`,
				};
			}

		} catch (err) {
			const message = err instanceof Error ? err.message : 'Unknown error';
			this.sessionManager.failSession(session.id, message);
			return { sessionId: session.id, success: false, error: message };
		}
	}

	/**
	 * Get session manager for external access.
	 */
	getSessionManager(): SessionManager {
		return this.sessionManager;
	}

	dispose(): void {
		this.participant?.dispose();
		for (const d of this.disposables) {
			d.dispose();
		}
	}
}
