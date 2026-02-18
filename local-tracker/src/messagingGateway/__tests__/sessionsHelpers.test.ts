import { formatSessionLine, isActiveSessionStatus, parseBridgeSessions } from '../sessionsHelpers';

describe('sessionsHelpers', () => {
	it('parses sessions from bridge result with common field names', () => {
		const sessions = parseBridgeSessions({
			sessions: [
				{ id: 's1', status: 'active', agentName: 'orchestrator', lastUpdatedIso: '2026-02-16T00:00:00.000Z' },
				{ session_id: 's2', state: 'running', agent: 'exec', updatedAt: '2026-02-16T00:01:00.000Z' },
			],
		});

		expect(sessions).toEqual([
			{ id: 's1', status: 'active', agentName: 'orchestrator', lastUpdatedIso: '2026-02-16T00:00:00.000Z' },
			{ id: 's2', status: 'running', agentName: 'exec', lastUpdatedIso: '2026-02-16T00:01:00.000Z' },
		]);
	});

	it('formats a session line including agent, updated time, and approvals', () => {
		const line = formatSessionLine(
			{ id: 's1', status: 'active', agentName: 'orchestrator', lastUpdatedIso: '2026-02-16T00:00:00.000Z' },
			2,
		);
		expect(line).toContain('- s1 [active]');
		expect(line).toContain('@orchestrator');
		expect(line).toContain('updated=2026-02-16T00:00:00.000Z');
		expect(line).toContain('approvals=2');
	});

	it.each([
		{ status: 'active', expected: true },
		{ status: 'running', expected: true },
		{ status: 'completed', expected: false },
		{ status: 'failed', expected: false },
	])('isActiveSessionStatus($status)=$expected', ({ status, expected }) => {
		expect(isActiveSessionStatus(status)).toBe(expected);
	});
});

