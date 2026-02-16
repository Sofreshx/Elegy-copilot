export interface SummaryItem {
	key: string;
	value: string | number | boolean | null | undefined;
}

export interface FormatSummaryOptions {
	title?: string;
	maxLines?: number;
	maxKeyLength?: number;
	maxValueLength?: number;
	maxLineLength?: number;
	emptyValuePlaceholder?: string;
}

function toSingleLine(value: string): string {
	return value.replace(/\r\n?/g, '\n').replace(/\n+/g, ' ').replace(/[\t ]{2,}/g, ' ').trim();
}

function ellipsize(text: string, maxLength: number): string {
	if (maxLength <= 0) return '';
	if (text.length <= maxLength) return text;
	if (maxLength <= 1) return '…'.slice(0, maxLength);
	return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function formatValue(value: SummaryItem['value'], emptyValuePlaceholder: string): string {
	if (value === null || value === undefined) return emptyValuePlaceholder;
	if (typeof value === 'string') return value.length === 0 ? emptyValuePlaceholder : value;
	return String(value);
}

/**
 * Formats a compact, structured key/value summary suitable for chat output.
 * Intentionally keeps values short and line-oriented.
 */
export function formatSummary(items: SummaryItem[], options: FormatSummaryOptions = {}): string {
	const maxLines = options.maxLines ?? 30;
	const maxKeyLength = options.maxKeyLength ?? 36;
	const maxValueLength = options.maxValueLength ?? 240;
	const maxLineLength = options.maxLineLength ?? 300;
	const emptyValuePlaceholder = options.emptyValuePlaceholder ?? '—';

	const lines: string[] = [];
	if (options.title && options.title.trim().length > 0) {
		lines.push(toSingleLine(options.title.trim()));
	}

	for (const item of items.slice(0, maxLines)) {
		const key = ellipsize(toSingleLine(item.key), maxKeyLength);
		const rawValue = formatValue(item.value, emptyValuePlaceholder);
		const value = ellipsize(toSingleLine(rawValue), maxValueLength);
		const line = `- ${key}: ${value}`;
		lines.push(ellipsize(line, maxLineLength));
	}

	if (items.length > maxLines) {
		lines.push(`- … (${items.length - maxLines} more)`);
	}

	return lines.join('\n');
}
