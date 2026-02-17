export function normalizeString(value: unknown): string | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}
	const s = value.trim();
	return s ? s : undefined;
}
