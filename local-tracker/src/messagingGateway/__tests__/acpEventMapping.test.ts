import { mapAcpRequestPermissionToExtensionEventLike, mapAcpSessionUpdateToExtensionEventLike } from '../acpEventMapping';

describe('acpEventMapping', () => {
	it('maps tool_call + tool_call_update into tool_called events with stable tool title', () => {
		const toolTitles = new Map<string, string>();

		const ev1 = mapAcpSessionUpdateToExtensionEventLike(
			'sess-1',
			{ sessionUpdate: 'tool_call', toolCallId: 'call-1', title: 'Run tests', status: 'pending' },
			toolTitles,
		);
		expect(ev1?.type).toBe('tool_called');
		expect((ev1 as any)?.payload?.tool).toBe('Run tests');

		const ev2 = mapAcpSessionUpdateToExtensionEventLike(
			'sess-1',
			{ sessionUpdate: 'tool_call_update', toolCallId: 'call-1', status: 'completed' },
			toolTitles,
		);
		expect(ev2?.type).toBe('tool_called');
		expect((ev2 as any)?.payload?.tool).toBe('Run tests');
	});

	it('maps session/request_permission into a permission_requested event with callbackId', () => {
		const toolTitles = new Map<string, string>([['call-2', 'Read file']]);

		const ev = mapAcpRequestPermissionToExtensionEventLike(
			5,
			{
				sessionId: 'sess-2',
				toolCall: { toolCallId: 'call-2' },
				options: [
					{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
					{ optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
				],
			},
			toolTitles,
		);

		expect(ev?.type).toBe('permission_requested');
		expect(ev?.sessionId).toBe('sess-2');
		expect((ev as any)?.payload?.callbackId).toBe('5');
		expect((ev as any)?.payload?.toolName).toBe('Read file');
	});
});

