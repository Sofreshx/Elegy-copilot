import { chunkText } from './chunking';

export const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

const MARKDOWN_V2_SPECIAL = /[_*\[\]()~>#+\-=|{}.!]/g;

export function escapeMarkdownV2(text: string): string {
	return text.replace(MARKDOWN_V2_SPECIAL, '\\$&');
}

export function formatCodeBlock(code: string, language?: string): string {
	const escaped = code.replace(/```/g, '\\`\\`\\`');
	const tag = language ? language : '';
	return `\`\`\`${tag}\n${escaped}\n\`\`\``;
}

export function truncateForTelegram(text: string, maxLength = TELEGRAM_MAX_MESSAGE_LENGTH): string {
	if (text.length <= maxLength) return text;
	const marker = '\n…(truncated)';
	const allowed = Math.max(0, maxLength - marker.length);
	return `${text.slice(0, allowed).trimEnd()}${marker}`.slice(0, maxLength);
}

export function chunkForTelegram(
	text: string,
	maxChunkLength = TELEGRAM_MAX_MESSAGE_LENGTH,
	maxChunks = 5,
): string[] {
	return chunkText(text, { maxChunkLength, maxChunks });
}

export interface InlineKeyboardButton {
	text: string;
	callback_data: string;
}

export interface InlineKeyboardMarkup {
	inline_keyboard: InlineKeyboardButton[][];
}

export function buildInlineKeyboard(
	buttons: Array<{ text: string; callbackData: string }>,
): InlineKeyboardMarkup {
	return {
		inline_keyboard: buttons.map((b) => [
			{
				text: b.text,
				callback_data: truncateUtf8(b.callbackData, 64),
			},
		]),
	};
}

function truncateUtf8(value: string, maxBytes: number): string {
	const buf = Buffer.from(value, 'utf-8');
	if (buf.length <= maxBytes) return value;
	// Slice bytes, then decode back — this may split a multi-byte char, so we
	// re-encode to drop the trailing incomplete character.
	const sliced = buf.subarray(0, maxBytes);
	return new TextDecoder('utf-8', { fatal: false }).decode(sliced).replace(/\uFFFD$/, '');
}
