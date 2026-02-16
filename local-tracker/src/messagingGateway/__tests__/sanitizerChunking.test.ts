import { chunkText } from '../chunking';
import { sanitizeInboundPrompt, sanitizeOutboundText } from '../sanitizer';

describe('sanitizer + chunking', () => {
	it('strips inbound mentions (@everyone/@here and <@...>/<@&...>/<#...>)', () => {
		const input = 'Hi <@123> <@!456> <@&789> <#321> @everyone @here  ok';
		const out = sanitizeInboundPrompt(input);

		expect(out).not.toContain('<@');
		expect(out).not.toContain('<#');
		expect(out).not.toContain('@everyone');
		expect(out).not.toContain('@here');
		expect(out).toContain('Hi');
		expect(out).toContain('ok');
	});

	it('redacts JWT-like strings and bearer/token secrets in outbound text', () => {
		const jwtLike = 'aaaaaaaaaaa.bbbbbbbbbbb.cccccccccccc';
		const input = `Authorization: Bearer ${jwtLike}\nBearer ${jwtLike}\ntoken=${jwtLike}`;
		const out = sanitizeOutboundText(input);

		expect(out).toContain('Authorization: Bearer [REDACTED_TOKEN]');
		expect(out).toContain('Bearer [REDACTED_TOKEN]');
		expect(out).toContain('token=[REDACTED]');
		// JWT-like patterns should be removed even outside bearer contexts
		expect(out).not.toContain(jwtLike);
	});

	it('caps outbound messages at 1800 chars, splits up to 3, then truncates with marker', () => {
		const input = 'a'.repeat(1800 * 3 + 100);
		const chunks = chunkText(input);

		expect(chunks).toHaveLength(3);
		for (const c of chunks) expect(c.length).toBeLessThanOrEqual(1800);
		expect(chunks[2]).toContain('…(truncated)');
	});
});
