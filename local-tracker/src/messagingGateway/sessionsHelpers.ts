function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function readString(obj: Record<string, unknown>, keys: string[]): string | undefined {
	for (const key of keys) {
		const value = obj[key];
		if (typeof value === 'string' && value.trim().length > 0) return value.trim();
	}
	return undefined;
}

export interface SessionListItem {
	id: string;
	status: string;
	agentName?: string;
	lastUpdatedIso?: string;
}

export function parseBridgeSessions(resUnknown: unknown): SessionListItem[] {
	if (!isRecord(resUnknown)) return [];
	const sessionsUnknown = (resUnknown as Record<string, unknown>).sessions;
	if (!Array.isArray(sessionsUnknown)) return [];

	return sessionsUnknown
		.filter((s) => isRecord(s))
		.map((s) => {
			const id = readString(s, ['id', 'sessionId', 'session_id']);
			const status = readString(s, ['status', 'state']) ?? '—';
			const agentName = readString(s, ['agentName', 'agent', 'agent_name']);
			const lastUpdatedIso = readString(s, ['lastUpdatedIso', 'last_updated_iso', 'updatedAtIso', 'updated_at_iso', 'updatedAt']);
			if (!id) return null;
			const out: SessionListItem = { id, status };
			if (agentName) out.agentName = agentName;
			if (lastUpdatedIso) out.lastUpdatedIso = lastUpdatedIso;
			return out;
		})
		.filter((s): s is SessionListItem => s !== null);
}

export function isActiveSessionStatus(status: string): boolean {
	const s = (status || '').trim().toLowerCase();
	return s === 'active' || s === 'running' || s === 'in_progress' || s === 'in-progress' || s === 'queued';
}

export function formatSessionLine(item: SessionListItem, pendingApprovals: number | undefined): string {
	const parts: string[] = [];
	parts.push(`- ${item.id} [${item.status || '—'}]`);
	if (item.agentName) parts.push(`@${item.agentName}`);
	if (item.lastUpdatedIso) parts.push(`updated=${item.lastUpdatedIso}`);
	if (pendingApprovals && pendingApprovals > 0) parts.push(`approvals=${pendingApprovals}`);
	return parts.join(' ');
}

