'use strict';

const DASH_SPLIT_RE = /\s+[\u2014\u2013-]\s+/;

const SECTION_KEY_MAP = Object.freeze({
	handoffmanifest: 'handoffManifest',
	keydecisions: 'keyDecisions',
	explorationsummary: 'explorationSummary',
	userconstraints: 'userConstraints',
	immediatenextactions: 'immediateNextActions',
	nextplanideas: 'nextPlanIdeas',
	watchouts: 'watchOuts',
	openrisks: 'openRisks',
	summary: 'summary',
	details: 'details',
});

function normalizeSectionKey(title) {
	const normalized = String(title || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
	return SECTION_KEY_MAP[normalized] || normalized;
}

function normalizeVerdict(value) {
	const raw = String(value || '').trim();
	if (!raw) {
		return '';
	}

	return raw.replace(/^verdict\s*:\s*/i, '').trim().toUpperCase();
}

function trimContent(value) {
	return String(value || '').replace(/^\s+|\s+$/g, '');
}

function extractLevelSections(text, headingLevel) {
	const sections = [];
	const headingRe = new RegExp(`^${'#'.repeat(headingLevel)}\\s+(.+)$`, 'gm');
	const matches = [];
	let match;

	while ((match = headingRe.exec(String(text || '')))) {
		matches.push({ title: trimContent(match[1]), index: match.index, end: headingRe.lastIndex });
	}

	for (let index = 0; index < matches.length; index += 1) {
		const current = matches[index];
		const next = matches[index + 1];
		const contentStart = current.end;
		const contentEnd = next ? next.index : String(text || '').length;
		sections.push({
			title: current.title,
			key: normalizeSectionKey(current.title),
			content: trimContent(String(text || '').slice(contentStart, contentEnd)),
		});
	}

	return sections;
}

function parseListItems(content) {
	return String(content || '')
		.split(/\r?\n/)
		.map((line) => {
			const match = line.match(/^\s*[-*]\s+(.+)$/);
			return match ? trimContent(match[1]) : '';
		})
		.filter(Boolean);
}

function parseSubsections(content) {
	const subsections = extractLevelSections(content, 3);
	if (subsections.length === 0) {
		return [];
	}

	return subsections.map((section) => ({
		title: section.title,
		key: section.key,
		content: section.content,
		items: parseListItems(section.content),
	}));
}

function parseHandoffManifestSection(content) {
	const manifest = {
		session: null,
		plan: null,
		planStatus: null,
		reviewer: null,
	};

	for (const item of parseListItems(content)) {
		const separatorIndex = item.indexOf(':');
		if (separatorIndex === -1) {
			continue;
		}

		const label = item.slice(0, separatorIndex).trim().toLowerCase();
		const value = item.slice(separatorIndex + 1).trim();
		if (label === 'session') {
			manifest.session = value || null;
			continue;
		}
		if (label === 'plan') {
			manifest.plan = value || null;
			const statusMatch = value.match(/status\s*:\s*([^)]+)/i);
			manifest.planStatus = statusMatch ? trimContent(statusMatch[1]).toUpperCase() : null;
			continue;
		}
		if (label === 'reviewer') {
			manifest.reviewer = value || null;
		}
	}

	return manifest;
}

function parsePropositionText(text) {
	const entries = extractLevelSections(text, 2).map((section) => {
		const headingParts = section.title.split(DASH_SPLIT_RE).map(trimContent).filter(Boolean);
		const subsections = parseSubsections(section.content);
		return {
			heading: section.title,
			occurredAt: headingParts[0] || null,
			phase: headingParts[1] || null,
			agent: headingParts.slice(2).join(' - ') || null,
			sections: subsections,
		};
	});

	return {
		entries,
		latestEntry: entries.length > 0 ? entries[entries.length - 1] : null,
	};
}

function parseHandoffText(text, options = {}) {
	const sections = extractLevelSections(text, 2).map((section) => ({
		title: section.title,
		key: section.key,
		content: section.content,
		items: parseListItems(section.content),
	}));
	const warnings = [];
	const requiredKeys = [
		'handoffManifest',
		'keyDecisions',
		'explorationSummary',
		'userConstraints',
		'immediateNextActions',
		'nextPlanIdeas',
		'watchOuts',
		'openRisks',
	];

	for (const requiredKey of requiredKeys) {
		if (!sections.some((section) => section.key === requiredKey)) {
			warnings.push(`missing required handoff section: ${requiredKey}`);
		}
	}

	const manifestSection = sections.find((section) => section.key === 'handoffManifest');
	const manifest = manifestSection ? parseHandoffManifestSection(manifestSection.content) : null;

	if (!manifest) {
		warnings.push('missing required handoff manifest content');
	} else {
		if (!manifest.session) {
			warnings.push('handoff manifest missing Session');
		}
		if (options.sessionId && manifest.session && manifest.session !== options.sessionId) {
			warnings.push(`handoff manifest Session mismatch: expected ${options.sessionId}, got ${manifest.session}`);
		}
		if (!manifest.planStatus) {
			warnings.push('handoff manifest missing plan status');
		} else if (!['APPROVED', 'USER_APPROVED_WITH_RISKS'].includes(manifest.planStatus)) {
			warnings.push(`handoff manifest plan status is not resumable: ${manifest.planStatus}`);
		}
		if (!manifest.reviewer) {
			warnings.push('handoff manifest missing Reviewer');
		}
	}

	return {
		sections,
		manifest,
		warnings,
	};
}

function parseMarkdownTable(sectionText) {
	const lines = String(sectionText || '')
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
	const tableLines = lines.filter((line) => line.startsWith('|'));
	if (tableLines.length < 2) {
		return null;
	}

	function cells(line) {
		return line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => trimContent(cell));
	}

	const headers = cells(tableLines[0]);
	const rows = [];
	for (let index = 2; index < tableLines.length; index += 1) {
		const rowCells = cells(tableLines[index]);
		if (rowCells.length === 0) {
			continue;
		}
		const row = {};
		for (let cellIndex = 0; cellIndex < headers.length; cellIndex += 1) {
			row[headers[cellIndex]] = rowCells[cellIndex] || '';
		}
		rows.push(row);
	}

	return { headers, rows };
}

function parseReviewLedgerFromPlan(text) {
	const warnings = [];
	const section = extractLevelSections(text, 2).find((entry) => entry.key === 'reviewledger');
	if (!section) {
		warnings.push('missing review ledger section');
		return { rows: [], approved: false, warnings };
	}

	const table = parseMarkdownTable(section.content);
	if (!table) {
		warnings.push('review ledger section is not a parseable markdown table');
		return { rows: [], approved: false, warnings };
	}

	const rows = table.rows.map((row) => ({
		round: row.Round || '',
		reviewer: row.Reviewer || '',
		verdict: normalizeVerdict(row.Verdict || ''),
		requiredRevisions: row['Required Revisions'] || '',
		resolution: row.Resolution || '',
	}));

	if (rows.length === 0) {
		warnings.push('review ledger has no rows');
	}

	const approved = rows.some((row) => ['APPROVED', 'USER_APPROVED_WITH_RISKS'].includes(row.verdict));
	if (!approved) {
		warnings.push('review ledger missing resumable approval verdict');
	}

	return {
		rows,
		approved,
		warnings,
	};
}

module.exports = {
	parsePropositionText,
	parseHandoffText,
	parseReviewLedgerFromPlan,
};