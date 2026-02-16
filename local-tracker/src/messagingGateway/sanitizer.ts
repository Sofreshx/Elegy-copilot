const ZERO_WIDTH_SPACE = '\u200b';

function normalizeNewlines(text: string): string {
	return text.replace(/\r\n?/g, '\n');
}

function truncateWithMarker(text: string, maxLength: number, marker: string): string {
	if (maxLength <= 0) return '';
	if (text.length <= maxLength) return text;

	const clipped = text.slice(0, Math.max(0, maxLength - marker.length)).trimEnd();
	return `${clipped}${marker}`.slice(0, maxLength);
}

function collapseWhitespace(text: string): string {
	// Keep newlines, but collapse runs of spaces/tabs.
	return text.replace(/[\t ]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n');
}

function stripInboundMentions(text: string): string {
	return (
		text
			// User mentions: <@123>, <@!123>
			.replace(/<@!?\d+>/g, '')
			// Role mentions: <@&123>
			.replace(/<@&\d+>/g, '')
			// Channel mentions: <#123>
			.replace(/<#\d+>/g, '')
			// Everyone/here
			.replace(/@everyone\b/g, '')
			.replace(/@here\b/g, '')
	);
}

function neutralizeOutboundMentions(text: string): string {
	// Even if the Discord adapter disables mention parsing, we also defensively neutralize known patterns.
	return (
		text
			.replace(/<@&/g, `<${ZERO_WIDTH_SPACE}@&`)
			.replace(/<@/g, `<${ZERO_WIDTH_SPACE}@`)
			.replace(/<#/g, `<${ZERO_WIDTH_SPACE}#`)
			.replace(/@everyone\b/g, `@${ZERO_WIDTH_SPACE}everyone`)
			.replace(/@here\b/g, `@${ZERO_WIDTH_SPACE}here`)
	);
}

function redactPrivateKeyBlocks(text: string): string {
	const privateKeyBlock =
		/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g;
	return text.replace(privateKeyBlock, '[REDACTED_PRIVATE_KEY]');
}

function redactJwtLike(text: string): string {
	// JWTs are typically three base64url segments separated by dots.
	const jwtLike = /\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;
	return text.replace(jwtLike, '[REDACTED_JWT]');
}

function redactKnownTokenPrefixes(text: string): string {
	// GitHub classic + fine-grained PATs
	text = text.replace(/\bgh[pousr]_[A-Za-z0-9]{30,}\b/g, '[REDACTED_GITHUB_TOKEN]');
	text = text.replace(/\bgithub_pat_[A-Za-z0-9_]{30,}\b/g, '[REDACTED_GITHUB_TOKEN]');

	// Slack tokens
	text = text.replace(/\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g, '[REDACTED_SLACK_TOKEN]');

	// OpenAI-ish key prefix
	text = text.replace(/\bsk-[A-Za-z0-9]{20,}\b/g, '[REDACTED_API_KEY]');

	// AWS access key id
	text = text.replace(/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED_AWS_ACCESS_KEY_ID]');

	return text;
}

function redactBearerTokens(text: string): string {
	// Authorization: Bearer <token>
	text = text.replace(/\bAuthorization\s*:\s*Bearer\s+[^\s]+/gi, 'Authorization: Bearer [REDACTED_TOKEN]');
	// Bare "Bearer <token>" occurrences
	text = text.replace(/\bBearer\s+[A-Za-z0-9._-]{10,}\b/g, 'Bearer [REDACTED_TOKEN]');
	return text;
}

function redactKeyValueSecrets(text: string): string {
	// Redact common key/value patterns while keeping the key.
	// Examples:
	// - token=...
	// - access_token: ...
	// - apiKey = ...
	const keyValueSecret =
		/\b(token|access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|apikey|secret|password|jwt)\b\s*[:=]\s*([^\s,;\]]+)/gi;

	return text.replace(keyValueSecret, (_match, key: string) => `${key}=[REDACTED]`);
}

export function redactSecretsInText(text: string): string {
	let out = text;
	out = redactPrivateKeyBlocks(out);
	out = redactBearerTokens(out);
	out = redactJwtLike(out);
	out = redactKnownTokenPrefixes(out);
	out = redactKeyValueSecrets(out);
	return out;
}

export interface SanitizeTextOptions {
	maxLength?: number;
	truncationMarker?: string;
}

export function sanitizeInboundPrompt(text: string, options: SanitizeTextOptions = {}): string {
	const truncationMarker = options.truncationMarker ?? '\n…(truncated)';
	let out = normalizeNewlines(text);
	out = stripInboundMentions(out);
	out = redactSecretsInText(out);
	out = collapseWhitespace(out).trim();

	if (typeof options.maxLength === 'number') {
		out = truncateWithMarker(out, options.maxLength, truncationMarker);
	}
	return out;
}

export function sanitizeOutboundText(text: string, options: SanitizeTextOptions = {}): string {
	const truncationMarker = options.truncationMarker ?? '\n…(truncated)';
	let out = normalizeNewlines(text);
	out = out.replace(/\u0000/g, '');
	out = neutralizeOutboundMentions(out);
	out = redactSecretsInText(out);

	if (typeof options.maxLength === 'number') {
		out = truncateWithMarker(out, options.maxLength, truncationMarker);
	}
	return out;
}
