export interface ChunkTextOptions {
	maxChunkLength?: number;
	maxChunks?: number;
	truncationMarker?: string;
	/** Prefer splitting on a newline when possible (default true). */
	preferNewline?: boolean;
}

function normalizeNewlines(text: string): string {
	return text.replace(/\r\n?/g, '\n');
}

function splitPoint(remaining: string, maxChunkLength: number, preferNewline: boolean): number {
	if (remaining.length <= maxChunkLength) return remaining.length;

	const minGood = Math.floor(maxChunkLength * 0.55);

	if (preferNewline) {
		const nl = remaining.lastIndexOf('\n', maxChunkLength);
		if (nl >= minGood) return nl;
	}

	const space = remaining.lastIndexOf(' ', maxChunkLength);
	if (space >= minGood) return space;

	return maxChunkLength;
}

function truncateWithMarker(text: string, maxLength: number, marker: string): string {
	if (maxLength <= 0) return '';
	if (text.length <= maxLength) return text;
	const allowed = Math.max(0, maxLength - marker.length);
	return `${text.slice(0, allowed).trimEnd()}${marker}`.slice(0, maxLength);
}

/**
 * Chunks text into up to `maxChunks` messages, each <= `maxChunkLength`.
 * If the input would exceed the chunk limit, the last chunk is truncated and marked.
 */
export function chunkText(text: string, options: ChunkTextOptions = {}): string[] {
	const maxChunkLength = options.maxChunkLength ?? 1800;
	const maxChunks = options.maxChunks ?? 3;
	const truncationMarker = options.truncationMarker ?? '\n…(truncated)';
	const preferNewline = options.preferNewline ?? true;

	let remaining = normalizeNewlines(text);
	if (remaining.length === 0) return [''];

	const chunks: string[] = [];
	while (remaining.length > 0 && chunks.length < maxChunks) {
		if (remaining.length <= maxChunkLength) {
			chunks.push(remaining);
			remaining = '';
			break;
		}

		const cut = splitPoint(remaining, maxChunkLength, preferNewline);
		const part = remaining.slice(0, cut).trimEnd();
		chunks.push(part);
		remaining = remaining.slice(cut).trimStart();
	}

	if (remaining.length > 0 && chunks.length > 0) {
		// We ran out of chunks; truncate the last chunk with a marker.
		chunks[chunks.length - 1] = truncateWithMarker(
			`${chunks[chunks.length - 1]}${truncationMarker}`,
			maxChunkLength,
			truncationMarker,
		);
	}

	// Ensure all chunks respect the max length (in case of odd marker settings).
	for (let i = 0; i < chunks.length; i++) {
		if (chunks[i].length > maxChunkLength) {
			chunks[i] = truncateWithMarker(chunks[i], maxChunkLength, truncationMarker);
		}
	}

	return chunks;
}
