import {
	TELEGRAM_MAX_MESSAGE_LENGTH,
	escapeMarkdownV2,
	formatCodeBlock,
	truncateForTelegram,
	chunkForTelegram,
	buildInlineKeyboard,
} from '../telegramFormatting';

describe('escapeMarkdownV2', () => {
	it('escapes all MarkdownV2 special characters', () => {
		const input = '_*[]()~>#+-=|{}.!';
		const escaped = escapeMarkdownV2(input);
		expect(escaped).toBe('\\_\\*\\[\\]\\(\\)\\~\\>\\#\\+\\-\\=\\|\\{\\}\\.\\!');
	});

	it('does NOT escape backticks', () => {
		expect(escapeMarkdownV2('`code`')).toBe('`code`');
		expect(escapeMarkdownV2('```block```')).toBe('```block```');
	});

	it('handles empty string', () => {
		expect(escapeMarkdownV2('')).toBe('');
	});

	it('handles string with no special characters', () => {
		expect(escapeMarkdownV2('hello world 123')).toBe('hello world 123');
	});
});

describe('formatCodeBlock', () => {
	it('wraps code in triple backticks', () => {
		expect(formatCodeBlock('const x = 1')).toBe('```\nconst x = 1\n```');
	});

	it('includes language tag when provided', () => {
		expect(formatCodeBlock('const x = 1', 'ts')).toBe('```ts\nconst x = 1\n```');
	});

	it('escapes internal triple backticks', () => {
		const code = 'before ``` after';
		const result = formatCodeBlock(code);
		expect(result).toBe('```\nbefore \\`\\`\\` after\n```');
		expect(result).not.toContain('``````');
	});
});

describe('truncateForTelegram', () => {
	it('returns text unchanged when it fits', () => {
		const text = 'short message';
		expect(truncateForTelegram(text)).toBe(text);
	});

	it('truncates long text with marker', () => {
		const text = 'a'.repeat(5000);
		const result = truncateForTelegram(text);
		expect(result.length).toBeLessThanOrEqual(TELEGRAM_MAX_MESSAGE_LENGTH);
		expect(result).toContain('…(truncated)');
	});

	it('respects custom maxLength', () => {
		const text = 'a'.repeat(200);
		const result = truncateForTelegram(text, 100);
		expect(result.length).toBeLessThanOrEqual(100);
		expect(result).toContain('…(truncated)');
	});

	it('returns text unchanged when exactly maxLength', () => {
		const text = 'a'.repeat(4096);
		expect(truncateForTelegram(text)).toBe(text);
	});
});

describe('chunkForTelegram', () => {
	it('returns single chunk for short text', () => {
		const result = chunkForTelegram('hello');
		expect(result).toEqual(['hello']);
	});

	it('splits long text into multiple chunks', () => {
		const text = 'word '.repeat(2000);
		const chunks = chunkForTelegram(text);
		expect(chunks.length).toBeGreaterThan(1);
		for (const chunk of chunks) {
			expect(chunk.length).toBeLessThanOrEqual(TELEGRAM_MAX_MESSAGE_LENGTH);
		}
	});

	it('respects maxChunks', () => {
		const text = 'a'.repeat(20000);
		const chunks = chunkForTelegram(text, 4096, 2);
		expect(chunks.length).toBeLessThanOrEqual(2);
	});

	it('returns single empty-ish chunk for empty string', () => {
		const result = chunkForTelegram('');
		expect(result).toEqual(['']);
	});
});

describe('buildInlineKeyboard', () => {
	it('creates keyboard with single button', () => {
		const result = buildInlineKeyboard([{ text: 'Click me', callbackData: 'action_1' }]);
		expect(result).toEqual({
			inline_keyboard: [[{ text: 'Click me', callback_data: 'action_1' }]],
		});
	});

	it('creates one row per button', () => {
		const result = buildInlineKeyboard([
			{ text: 'A', callbackData: 'a' },
			{ text: 'B', callbackData: 'b' },
			{ text: 'C', callbackData: 'c' },
		]);
		expect(result.inline_keyboard).toHaveLength(3);
		expect(result.inline_keyboard[0]).toHaveLength(1);
		expect(result.inline_keyboard[1]).toHaveLength(1);
		expect(result.inline_keyboard[2]).toHaveLength(1);
	});

	it('truncates callbackData exceeding 64 bytes', () => {
		const longData = 'x'.repeat(100);
		const result = buildInlineKeyboard([{ text: 'Test', callbackData: longData }]);
		const cb = result.inline_keyboard[0][0].callback_data;
		expect(Buffer.byteLength(cb, 'utf-8')).toBeLessThanOrEqual(64);
	});

	it('preserves callbackData within 64 bytes', () => {
		const data = 'short_data';
		const result = buildInlineKeyboard([{ text: 'Test', callbackData: data }]);
		expect(result.inline_keyboard[0][0].callback_data).toBe(data);
	});
});
