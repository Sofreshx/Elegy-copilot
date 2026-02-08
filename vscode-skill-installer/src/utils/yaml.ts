/**
 * Minimal YAML front matter parser for markdown files.
 * Supports simple "key: value" and "key: [a, b]" / multi-line lists.
 * Does NOT attempt to parse nested YAML structures.
 */

export interface YamlFrontMatterResult {
	fm: Record<string, unknown>;
	bodyStartIndex: number;
}

export function stripQuotes(value: string): string {
	const trimmed = value.trim();
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

export function tryParseYamlFrontMatter(text: string): YamlFrontMatterResult | undefined {
	if (!text.startsWith('---')) {
		return undefined;
	}

	const endMarker = '\n---';
	const endIdx = text.indexOf(endMarker, 3);
	if (endIdx === -1) {
		return undefined;
	}

	const yamlBlock = text.slice(3, endIdx).trim();
	const fm: Record<string, unknown> = {};

	const lines = yamlBlock.split(/\r?\n/);
	let currentListKey: string | undefined;

	for (const rawLine of lines) {
		const line = rawLine.trimEnd();
		if (!line.trim() || line.trimStart().startsWith('#')) {
			continue;
		}

		const listMatch = line.match(/^\s*-\s+(.*)$/);
		if (listMatch && currentListKey) {
			const item = listMatch[1].trim();
			const arr = (fm[currentListKey] as unknown[]) ?? [];
			arr.push(stripQuotes(item));
			fm[currentListKey] = arr;
			continue;
		}

		currentListKey = undefined;
		const kv = line.match(/^\s*([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
		if (!kv) {
			continue;
		}

		const key = kv[1];
		let value = kv[2].trim();
		if (value === '') {
			fm[key] = [];
			currentListKey = key;
			continue;
		}

		if (value.startsWith('[') && value.endsWith(']')) {
			const inside = value.slice(1, -1).trim();
			if (inside === '') {
				fm[key] = [];
			} else {
				fm[key] = inside
					.split(',')
					.map((s) => stripQuotes(s.trim()))
					.filter(Boolean);
			}
			continue;
		}

		fm[key] = stripQuotes(value);
	}

	return { fm, bodyStartIndex: endIdx + endMarker.length };
}
