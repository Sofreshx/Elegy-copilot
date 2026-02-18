import type { ExtensionEventLike } from './sessionThreadManager';

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function readString(obj: Record<string, unknown>, key: string): string | undefined {
	const v = obj[key];
	return typeof v === 'string' && v.trim().length > 0 ? v : undefined;
}

function safeTextPreview(input: string, max = 120): string {
	const trimmed = input.trim().replace(/\s+/g, ' ');
	if (trimmed.length <= max) return trimmed;
	return `${trimmed.slice(0, Math.max(0, max - 1))}…`;
}

export type AcpRpcId = string | number;

export function mapAcpSessionUpdateToExtensionEventLike(
	sessionId: string,
	updateUnknown: unknown,
	toolTitlesById: Map<string, string>,
): ExtensionEventLike | null {
	if (!isRecord(updateUnknown)) return null;
	const kind = readString(updateUnknown, 'sessionUpdate');
	if (!kind) return null;

	if (kind === 'tool_call') {
		const toolCallId = readString(updateUnknown, 'toolCallId');
		const title = readString(updateUnknown, 'title');
		if (toolCallId && title) toolTitlesById.set(toolCallId, title);

		return {
			type: 'tool_called',
			sessionId,
			payload: {
				tool: title ?? (toolCallId ? `tool:${toolCallId}` : 'tool'),
				toolCallId,
				status: readString(updateUnknown, 'status') ?? 'pending',
				kind: readString(updateUnknown, 'kind'),
			},
		};
	}

	if (kind === 'tool_call_update') {
		const toolCallId = readString(updateUnknown, 'toolCallId');
		if (!toolCallId) return null;
		const title = toolTitlesById.get(toolCallId);
		return {
			type: 'tool_called',
			sessionId,
			payload: {
				tool: title ?? `tool:${toolCallId}`,
				toolCallId,
				status: readString(updateUnknown, 'status'),
			},
		};
	}

	if (kind === 'agent_message_chunk') {
		const content = updateUnknown.content;
		if (isRecord(content) && content.type === 'text' && typeof content.text === 'string') {
			return {
				type: 'session_progress',
				sessionId,
				payload: {
					message: safeTextPreview(content.text),
				},
			};
		}
		return { type: 'session_progress', sessionId, payload: { message: 'agent_message' } };
	}

	if (kind === 'plan') {
		return { type: 'session_progress', sessionId, payload: { message: 'plan' } };
	}

	// Default: ignore other update types for the Discord live feed.
	return null;
}

export function mapAcpRequestPermissionToExtensionEventLike(
	rpcId: AcpRpcId,
	paramsUnknown: unknown,
	toolTitlesById: Map<string, string>,
): ExtensionEventLike | null {
	if (!isRecord(paramsUnknown)) return null;
	const sessionId = readString(paramsUnknown, 'sessionId');
	if (!sessionId) return null;

	let toolTitle: string | undefined;
	let toolCallId: string | undefined;
	if (isRecord(paramsUnknown.toolCall)) {
		toolTitle = readString(paramsUnknown.toolCall, 'title');
		toolCallId = readString(paramsUnknown.toolCall, 'toolCallId');
	}
	if (!toolTitle && toolCallId) toolTitle = toolTitlesById.get(toolCallId);

	const summary = toolTitle ? `tool=${toolTitle}` : 'Permission requested';

	return {
		type: 'permission_requested',
		sessionId,
		payload: {
			callbackId: String(rpcId),
			toolName: toolTitle ?? undefined,
			operation: toolTitle ?? undefined,
			description: toolCallId ? `toolCallId=${toolCallId}` : undefined,
			summary,
		},
	};
}

