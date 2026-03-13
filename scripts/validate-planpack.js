#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

function escapeRegExp(value) {
	return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractH2Section(content, headingPrefix) {
	const headingRe = new RegExp(`^##\\s+${escapeRegExp(headingPrefix)}(?:\\b.*)?$`, 'mi');
	const startMatch = headingRe.exec(content);
	if (!startMatch) {
		return '';
	}

	const start = startMatch.index + startMatch[0].length;
	const rest = content.slice(start);
	const nextHeadingMatch = rest.match(/^##\s+/m);
	const end = nextHeadingMatch ? start + nextHeadingMatch.index : content.length;
	return content.slice(start, end);
}

function parseMarkdownTable(sectionText) {
	if (!sectionText) {
		return null;
	}

	function parseRowCells(line) {
		return line
			.replace(/^\|/, '')
			.replace(/\|$/, '')
			.split('|')
			.map(cell => cell.trim());
	}

	const lines = sectionText
		.split(/\r?\n/)
		.map(line => line.trim())
		.filter(Boolean);

	const firstTableLine = lines.findIndex(line => line.startsWith('|'));
	if (firstTableLine === -1 || firstTableLine + 1 >= lines.length) {
		return null;
	}

	const tableLines = [];
	for (let i = firstTableLine; i < lines.length; i++) {
		if (!lines[i].startsWith('|')) {
			break;
		}
		tableLines.push(lines[i]);
	}

	if (tableLines.length < 2) {
		return null;
	}

	const headers = parseRowCells(tableLines[0]);

	const rows = [];
	for (let i = 2; i < tableLines.length; i++) {
		const cells = parseRowCells(tableLines[i]);
		if (cells.length === 0) {
			continue;
		}

		const row = {};
		for (let j = 0; j < headers.length; j++) {
			row[headers[j]] = cells[j] || '';
		}
		rows.push(row);
	}

	return { headers, rows };
}

function normalizeFieldName(value) {
	return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeSubsectionName(value) {
	return String(value || '')
		.trim()
		.replace(/\s*\([^)]*\)\s*$/, '')
		.toLowerCase()
		.replace(/[^a-z0-9]/g, '');
}

function subsectionMatches(actualTitle, expectedTitle) {
	const actual = normalizeSubsectionName(actualTitle);
	const expected = normalizeSubsectionName(expectedTitle);
	return actual === expected || actual.startsWith(expected);
}

function wuHasSubsection(subsections, expectedTitle) {
	if (!(subsections instanceof Set)) {
		return false;
	}

	for (const subsection of subsections) {
		if (subsectionMatches(subsection, expectedTitle)) {
			return true;
		}
	}

	return false;
}

function getWuSubsectionLines(wuSubContent, wuId, expectedTitle) {
	if (!(wuSubContent instanceof Map) || !wuSubContent.has(wuId)) {
		return [];
	}

	const subsectionMap = wuSubContent.get(wuId);
	for (const [subsectionTitle, lines] of subsectionMap.entries()) {
		if (subsectionMatches(subsectionTitle, expectedTitle)) {
			return Array.isArray(lines) ? lines : [];
		}
	}

	return [];
}

function parseJsonArrayCell(value) {
	const trimmed = String(value || '').trim();
	if (!trimmed) {
		return { ok: false, reason: 'missing JSON array value' };
	}

	try {
		const parsed = JSON.parse(trimmed);
		if (!Array.isArray(parsed)) {
			return { ok: false, reason: 'value is not a JSON array' };
		}
		if (!parsed.every(item => typeof item === 'string')) {
			return { ok: false, reason: 'array items must be strings' };
		}
		return { ok: true, value: parsed };
	} catch (error) {
		return { ok: false, reason: 'invalid JSON array syntax' };
	}
}

function getRowValue(row, fieldNames) {
	if (!row || typeof row !== 'object') {
		return '';
	}

	const candidateKeys = Array.isArray(fieldNames) ? fieldNames.map(normalizeFieldName) : [];
	for (const [key, value] of Object.entries(row)) {
		if (candidateKeys.includes(normalizeFieldName(key))) {
			return String(value || '').trim();
		}
	}

	return '';
}

function hasGroupToken(value, groupId) {
	if (!value) {
		return false;
	}
	const tokenRe = new RegExp(`(^|[^A-Z0-9])${escapeRegExp(groupId)}([^0-9]|$)`, 'i');
	return tokenRe.test(String(value));
}

function rowHasPassedStatus(row) {
	const status = (row.Status || row.status || '').trim().toLowerCase();
	if (status === 'passed') {
		return true;
	}
	const notes = (row.Notes || row.notes || '').toLowerCase();
	return /status\s*:\s*passed/.test(notes);
}

function hasPassedMarkerForGroup(table, groupId) {
	if (!table) {
		return false;
	}

	for (const row of table.rows) {
		const groupCell = row.Group || row.group || '';
		if (!hasGroupToken(groupCell, groupId)) {
			continue;
		}
		if (rowHasPassedStatus(row)) {
			return true;
		}
	}

	return false;
}

function hasPassedStreamEvidenceForGroup(table, groupId) {
	if (!table) {
		return false;
	}

	for (const row of table.rows) {
		const groupCell = row.Group || row.group || '';
		if (!hasGroupToken(groupCell, groupId)) {
			continue;
		}

		if (!rowHasPassedStatus(row)) {
			continue;
		}

		const evidenceCell = String(row.Evidence || row.evidence || '').trim();
		if (!evidenceCell) {
			continue;
		}

		return true;
	}

	return false;
}

function hasExecutionLogCompletion(executionLogSection, groupId) {
	if (!executionLogSection) {
		return false;
	}

	const lines = executionLogSection
		.split(/\r?\n/)
		.map(line => line.trim())
		.filter(Boolean);

	for (const line of lines) {
		if (!hasGroupToken(line, groupId)) {
			continue;
		}
		if (/\b(failed|blocked|status\s*:\s*failed)\b/i.test(line)) {
			continue;
		}
		if (/\b(completed|complete|done|status\s*:\s*passed|status\s*=\s*passed)\b/i.test(line)) {
			return true;
		}
	}

	return false;
}

function hasControlScopeToken(value, controlId) {
	if (!value || !controlId) {
		return false;
	}

	const tokenRe = new RegExp(`(^|[\\s,;\\[\\]"'])${escapeRegExp(controlId)}($|[\\s,;\\[\\]"'])`, 'i');
	return tokenRe.test(String(value));
}

function normalizeRequiredStreamGroupId(value) {
	const token = String(value || '').trim();
	if (!token) {
		return '';
	}

	const match = token.match(/^(G-\d{2})(?:$|[^0-9])/i);
	if (!match) {
		return '';
	}

	return match[1].toUpperCase();
}

function deriveRequiredStreamGroups(progressContent) {
	const overviewSection = extractH2Section(progressContent, 'Work Unit Groups Overview');
	const overviewTable = parseMarkdownTable(overviewSection);
	if (!overviewTable) {
		return {
			requiredStreams: [],
			hasOverviewTable: false,
		};
	}

	const requiredStreams = [];
	for (const row of overviewTable.rows) {
		const rawGroup = getRowValue(row, ['Group']);
		const normalized = normalizeRequiredStreamGroupId(rawGroup);
		if (!normalized) {
			continue;
		}

		if (!requiredStreams.includes(normalized)) {
			requiredStreams.push(normalized);
		}
	}

	return {
		requiredStreams,
		hasOverviewTable: true,
	};
}

function parseCliArgs(argv) {
	const options = {
		filePath: '',
		phase: 'full',
		expectedCommit: '',
		expectedRelease: '',
		expectedChannel: '',
		maxEvidenceAgeHours: 168,
		maxFutureSkewMinutes: 5,
		nowIso: '',
		allowLegacyBestEffort: false,
		acEnforcement: 'warn',
	};

	for (let index = 0; index < argv.length; index++) {
		const arg = String(argv[index] || '');

		if (arg.startsWith('--phase=')) {
			const phase = arg.slice('--phase='.length).trim().toLowerCase();
			if (phase === 'planning' || phase === 'execution' || phase === 'full') {
				options.phase = phase;
			}
			continue;
		}
		if (arg === '--phase' && index + 1 < argv.length) {
			const phase = String(argv[index + 1] || '').trim().toLowerCase();
			if (phase === 'planning' || phase === 'execution' || phase === 'full') {
				options.phase = phase;
			}
			index++;
			continue;
		}

		if (arg.startsWith('--expected-commit=')) {
			options.expectedCommit = arg.slice('--expected-commit='.length).trim();
			continue;
		}
		if (arg === '--expected-commit' && index + 1 < argv.length) {
			options.expectedCommit = String(argv[index + 1] || '').trim();
			index++;
			continue;
		}

		if (arg.startsWith('--expected-release=')) {
			options.expectedRelease = arg.slice('--expected-release='.length).trim();
			continue;
		}
		if (arg === '--expected-release' && index + 1 < argv.length) {
			options.expectedRelease = String(argv[index + 1] || '').trim();
			index++;
			continue;
		}

		if (arg.startsWith('--expected-channel=')) {
			options.expectedChannel = arg.slice('--expected-channel='.length).trim();
			continue;
		}
		if (arg === '--expected-channel' && index + 1 < argv.length) {
			options.expectedChannel = String(argv[index + 1] || '').trim();
			index++;
			continue;
		}

		if (arg.startsWith('--max-evidence-age-hours=')) {
			const parsed = Number.parseFloat(arg.slice('--max-evidence-age-hours='.length));
			if (Number.isFinite(parsed) && parsed > 0) {
				options.maxEvidenceAgeHours = parsed;
			}
			continue;
		}
		if (arg === '--max-evidence-age-hours' && index + 1 < argv.length) {
			const parsed = Number.parseFloat(String(argv[index + 1] || ''));
			if (Number.isFinite(parsed) && parsed > 0) {
				options.maxEvidenceAgeHours = parsed;
			}
			index++;
			continue;
		}

		if (arg.startsWith('--now=')) {
			options.nowIso = arg.slice('--now='.length).trim();
			continue;
		}
		if (arg === '--now' && index + 1 < argv.length) {
			options.nowIso = String(argv[index + 1] || '').trim();
			index++;
			continue;
		}

		if (arg.startsWith('--max-future-skew-minutes=')) {
			const parsed = Number.parseFloat(arg.slice('--max-future-skew-minutes='.length));
			if (Number.isFinite(parsed) && parsed >= 0) {
				options.maxFutureSkewMinutes = parsed;
			}
			continue;
		}
		if (arg === '--max-future-skew-minutes' && index + 1 < argv.length) {
			const parsed = Number.parseFloat(String(argv[index + 1] || ''));
			if (Number.isFinite(parsed) && parsed >= 0) {
				options.maxFutureSkewMinutes = parsed;
			}
			index++;
			continue;
		}

		if (arg === '--allow-legacy-best-effort') {
			options.allowLegacyBestEffort = true;
			continue;
		}

		if (arg.startsWith('--ac-enforcement=')) {
			const mode = arg.slice('--ac-enforcement='.length).trim().toLowerCase();
			if (mode === 'warn' || mode === 'fail') {
				options.acEnforcement = mode;
			}
			continue;
		}
		if (arg === '--ac-enforcement' && index + 1 < argv.length) {
			const mode = String(argv[index + 1] || '').trim().toLowerCase();
			if (mode === 'warn' || mode === 'fail') {
				options.acEnforcement = mode;
			}
			index++;
			continue;
		}

		if (arg.startsWith('--')) {
			continue;
		}

		if (!options.filePath) {
			options.filePath = arg;
		}
	}

	return options;
}

function hasRequiredProgressSection(progressContent, headingPrefix) {
	if (headingPrefix === 'Execution Log') {
		return /^##\s+Execution Log\s*$/im.test(progressContent);
	}

	if (headingPrefix === 'Session Metadata') {
		return /^##\s+Session Metadata\s*$/im.test(progressContent);
	}

	const sectionText = extractH2Section(progressContent, headingPrefix);
	if (!sectionText) {
		return false;
	}

	if (headingPrefix === 'Work Unit Groups Overview' || headingPrefix === 'Work Unit Status Table' || headingPrefix === 'Checkpoints') {
		return Boolean(parseMarkdownTable(sectionText));
	}

	return true;
}

const AC_VAGUE_TOKEN_RE = /\b(quality|good|proper|appropriate|adequate|robust|clean|nice|better|improved|sufficient)\b/i;

function parseAcceptanceCriteriaQuality(lines, wuSubs) {
	const wuSpecRe = /^###\s+(WU-\d{3})\s+—\s+/;
	const h4Re = /^####\s+(.+)/;
	const bulletRe = /^\s*[-*]\s+(.+)$/;

	const acceptanceCriteria = new Map();
	let currentWU = null;
	let currentSubsection = '';

	for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
		const line = lines[lineIndex];

		const wuMatch = line.match(wuSpecRe);
		if (wuMatch) {
			currentWU = wuMatch[1];
			currentSubsection = '';
			if (!acceptanceCriteria.has(currentWU)) {
				acceptanceCriteria.set(currentWU, []);
			}
			continue;
		}

		if (/^##\s+/.test(line) || (/^###\s+/.test(line) && !wuSpecRe.test(line))) {
			currentWU = null;
			currentSubsection = '';
			continue;
		}

		if (!currentWU) {
			continue;
		}

		const h4Match = line.match(h4Re);
		if (h4Match) {
			currentSubsection = h4Match[1].trim();
			continue;
		}

		if (currentSubsection !== 'Acceptance Criteria') {
			continue;
		}

		const bulletMatch = line.match(bulletRe);
		if (!bulletMatch) {
			continue;
		}

		const criteria = bulletMatch[1].trim();
		if (!criteria) {
			continue;
		}

		acceptanceCriteria.get(currentWU).push({
			lineNumber: lineIndex + 1,
			text: criteria,
		});
	}

	const qualityDiagnostics = [];
	for (const wuId of wuSubs.keys()) {
		const entries = acceptanceCriteria.get(wuId) || [];
		if (entries.length < 2) {
			qualityDiagnostics.push(
				`${wuId} Acceptance Criteria must include at least 2 bullet items (found ${entries.length})`
			);
		}

		for (const entry of entries) {
			if (AC_VAGUE_TOKEN_RE.test(entry.text)) {
				qualityDiagnostics.push(
					`${wuId} Acceptance Criteria line ${entry.lineNumber} is vague: "${entry.text}"`
				);
			}
		}
	}

	return qualityDiagnostics;
}

function normalizeComparable(value) {
	return String(value || '').trim().toLowerCase();
}

function isTruthyValue(value) {
	const normalized = normalizeComparable(value);
	return normalized === 'true'
		|| normalized === 'yes'
		|| normalized === 'passed'
		|| normalized === 'attested'
		|| normalized === '1';
}

function findPolicyRow(table, policyAliases) {
	if (!table || !Array.isArray(table.rows)) {
		return null;
	}

	const normalizedAliases = policyAliases.map(normalizeComparable);
	for (const row of table.rows) {
		const policyValue = getRowValue(row, ['Policy', 'Artifact', 'Record']);
		if (normalizedAliases.includes(normalizeComparable(policyValue))) {
			return row;
		}
	}

	return null;
}

function validateTrustedEvidenceBindingAndRetention(progressContent, cliOptions) {
	const validationErrors = [];
	const nowTimestampMs = cliOptions.nowIso ? Date.parse(cliOptions.nowIso) : Date.now();

	if (cliOptions.nowIso && Number.isNaN(nowTimestampMs)) {
		validationErrors.push(`invalid --now timestamp: ${cliOptions.nowIso}`);
	}

	const trustedBindingSection = extractH2Section(progressContent, 'Trusted Evidence Binding');
	const trustedBindingTable = parseMarkdownTable(trustedBindingSection);

	if (!trustedBindingTable) {
		validationErrors.push('missing required progress section: ## Trusted Evidence Binding (markdown table required)');
	} else {
		const normalizedHeaders = trustedBindingTable.headers.map(normalizeFieldName);
		const hasCommitHeader = normalizedHeaders.includes('commitsha') || normalizedHeaders.includes('commit') || normalizedHeaders.includes('commitid');
		const hasReleaseHeader = normalizedHeaders.includes('releasetag') || normalizedHeaders.includes('release') || normalizedHeaders.includes('releaseid');
		const hasChannelHeader = normalizedHeaders.includes('channel') || normalizedHeaders.includes('releasechannel');
		const hasProducerHeader = normalizedHeaders.includes('produceridentity') || normalizedHeaders.includes('producer') || normalizedHeaders.includes('attestedproduceridentity');
		const hasAttestationHeader = normalizedHeaders.includes('attestationstatus') || normalizedHeaders.includes('attestation') || normalizedHeaders.includes('attested');
		const hasTimestampHeader = normalizedHeaders.includes('evidencetimestamp') || normalizedHeaders.includes('timestamp') || normalizedHeaders.includes('observedat') || normalizedHeaders.includes('capturedat');

		if (!hasCommitHeader) {
			validationErrors.push('invalid Trusted Evidence Binding table: missing Commit SHA column');
		}
		if (!hasReleaseHeader) {
			validationErrors.push('invalid Trusted Evidence Binding table: missing Release Tag column');
		}
		if (!hasChannelHeader) {
			validationErrors.push('invalid Trusted Evidence Binding table: missing Channel column');
		}
		if (!hasProducerHeader) {
			validationErrors.push('invalid Trusted Evidence Binding table: missing Producer Identity column');
		}
		if (!hasAttestationHeader) {
			validationErrors.push('invalid Trusted Evidence Binding table: missing Attestation Status column');
		}
		if (!hasTimestampHeader) {
			validationErrors.push('invalid Trusted Evidence Binding table: missing Evidence Timestamp column');
		}

		if (trustedBindingTable.rows.length === 0) {
			validationErrors.push('trusted evidence binding missing row data');
		} else {
			let rowCandidates = trustedBindingTable.rows;
			if (cliOptions.expectedRelease) {
				const matchingReleaseRows = trustedBindingTable.rows.filter((row) => {
					const releaseValue = getRowValue(row, ['Release Tag', 'Release', 'Release ID', 'ReleaseId']);
					return normalizeComparable(releaseValue) === normalizeComparable(cliOptions.expectedRelease);
				});

				if (matchingReleaseRows.length === 0) {
					validationErrors.push(
						`trusted evidence release mismatch: expected ${cliOptions.expectedRelease}, found no matching Trusted Evidence Binding row`
					);
				} else {
					if (matchingReleaseRows.length > 1) {
						validationErrors.push(
							`trusted evidence release match is ambiguous: expected ${cliOptions.expectedRelease}, found ${matchingReleaseRows.length} matching rows`
						);
					}
					rowCandidates = matchingReleaseRows;
				}
			}

			const trustedRow = rowCandidates[0] || trustedBindingTable.rows[0];
			const commitValue = getRowValue(trustedRow, ['Commit SHA', 'Commit', 'Commit ID', 'CommitId']);
			const releaseValue = getRowValue(trustedRow, ['Release Tag', 'Release', 'Release ID', 'ReleaseId']);
			const channelValue = getRowValue(trustedRow, ['Channel', 'Release Channel']);
			const producerIdentityValue = getRowValue(trustedRow, ['Producer Identity', 'Producer', 'Attested Producer Identity']);
			const attestationValue = getRowValue(trustedRow, ['Attestation Status', 'Attestation', 'Attested']);
			const timestampValue = getRowValue(trustedRow, ['Evidence Timestamp', 'Timestamp', 'Observed At', 'Captured At']);

			if (!commitValue) {
				validationErrors.push('trusted evidence missing required field: Commit SHA');
			}
			if (!releaseValue) {
				validationErrors.push('trusted evidence missing required field: Release Tag');
			}
			if (!channelValue) {
				validationErrors.push('trusted evidence missing required field: Channel');
			}
			if (!producerIdentityValue) {
				validationErrors.push('trusted evidence missing required field: Producer Identity');
			}
			if (!attestationValue) {
				validationErrors.push('trusted evidence missing required field: Attestation Status');
			} else if (!isTruthyValue(attestationValue)) {
				validationErrors.push(`trusted evidence attestation must be true; got ${attestationValue}`);
			}

			if (cliOptions.expectedCommit && commitValue && normalizeComparable(commitValue) !== normalizeComparable(cliOptions.expectedCommit)) {
				validationErrors.push(`trusted evidence commit mismatch: expected ${cliOptions.expectedCommit}, got ${commitValue}`);
			}
			if (cliOptions.expectedRelease && releaseValue && normalizeComparable(releaseValue) !== normalizeComparable(cliOptions.expectedRelease)) {
				validationErrors.push(`trusted evidence release mismatch: expected ${cliOptions.expectedRelease}, got ${releaseValue}`);
			}
			if (cliOptions.expectedChannel && channelValue && normalizeComparable(channelValue) !== normalizeComparable(cliOptions.expectedChannel)) {
				validationErrors.push(`trusted evidence channel mismatch: expected ${cliOptions.expectedChannel}, got ${channelValue}`);
			}

			if (!timestampValue) {
				validationErrors.push('trusted evidence missing required field: Evidence Timestamp');
			} else {
				const evidenceTimestampMs = Date.parse(timestampValue);
				if (Number.isNaN(evidenceTimestampMs)) {
					validationErrors.push(`trusted evidence timestamp is invalid: ${timestampValue}`);
				} else if (!Number.isNaN(nowTimestampMs)) {
					const evidenceAgeHours = (nowTimestampMs - evidenceTimestampMs) / (1000 * 60 * 60);
					const futureSkewHours = Math.max(0, Number(cliOptions.maxFutureSkewMinutes || 0)) / 60;
					if (evidenceAgeHours < (-1 * futureSkewHours)) {
						validationErrors.push(
							`trusted evidence timestamp is in the future: age ${evidenceAgeHours.toFixed(2)}h exceeds allowed skew ${futureSkewHours.toFixed(2)}h`
						);
					} else if (evidenceAgeHours > cliOptions.maxEvidenceAgeHours) {
						validationErrors.push(
							`trusted evidence is stale/replayed: age ${evidenceAgeHours.toFixed(2)}h exceeds max ${cliOptions.maxEvidenceAgeHours}h`
						);
					}
				}
			}
		}
	}

	const evidenceRetentionSection = extractH2Section(progressContent, 'Evidence Retention');
	const evidenceRetentionTable = parseMarkdownTable(evidenceRetentionSection);

	if (!evidenceRetentionTable) {
		validationErrors.push('missing required progress section: ## Evidence Retention (markdown table required)');
	} else {
		const normalizedHeaders = evidenceRetentionTable.headers.map(normalizeFieldName);
		const hasPolicyHeader = normalizedHeaders.includes('policy') || normalizedHeaders.includes('artifact') || normalizedHeaders.includes('record');
		const hasRetentionDaysHeader = normalizedHeaders.includes('retentiondays') || normalizedHeaders.includes('days');
		const hasRetainedHeader = normalizedHeaders.includes('retained') || normalizedHeaders.includes('present') || normalizedHeaders.includes('status');
		const hasEvidenceHeader = normalizedHeaders.includes('evidence') || normalizedHeaders.includes('evidenceref') || normalizedHeaders.includes('artifactref');

		if (!hasPolicyHeader) {
			validationErrors.push('invalid Evidence Retention table: missing Policy column');
		}
		if (!hasRetentionDaysHeader) {
			validationErrors.push('invalid Evidence Retention table: missing Retention Days column');
		}
		if (!hasRetainedHeader) {
			validationErrors.push('invalid Evidence Retention table: missing Retained column');
		}
		if (!hasEvidenceHeader) {
			validationErrors.push('invalid Evidence Retention table: missing Evidence column');
		}

		const opsLogsRow = findPolicyRow(evidenceRetentionTable, [
			'opsLogs',
			'ops-logs',
			'operationLogs',
			'operationsLogs',
		]);
		if (!opsLogsRow) {
			validationErrors.push('missing required Evidence Retention row: opsLogs');
		} else {
			const retentionDaysRaw = getRowValue(opsLogsRow, ['Retention Days', 'RetentionDays', 'Days']);
			const retentionDays = Number.parseInt(retentionDaysRaw, 10);
			if (!Number.isFinite(retentionDays)) {
				validationErrors.push(`ops logs retention days must be numeric; got ${retentionDaysRaw || 'missing'}`);
			} else if (retentionDays < 30) {
				validationErrors.push(`ops logs retention policy must be >= 30d; got ${retentionDays}d`);
			}

			const retainedRaw = getRowValue(opsLogsRow, ['Retained', 'Present', 'Status']);
			if (!isTruthyValue(retainedRaw)) {
				validationErrors.push(`ops logs retention must be present/true; got ${retainedRaw || 'missing'}`);
			}

			const evidenceRaw = getRowValue(opsLogsRow, ['Evidence', 'Evidence Ref', 'EvidenceRef', 'Artifact Ref', 'ArtifactRef']);
			if (!evidenceRaw) {
				validationErrors.push('ops logs retention row missing Evidence reference');
			}
		}

		const perReleaseRow = findPolicyRow(evidenceRetentionTable, [
			'perReleaseEvidence',
			'per-release-evidence',
			'releaseEvidence',
		]);
		if (!perReleaseRow) {
			validationErrors.push('missing required Evidence Retention row: perReleaseEvidence');
		} else {
			const retainedRaw = getRowValue(perReleaseRow, ['Retained', 'Present', 'Status']);
			if (!isTruthyValue(retainedRaw)) {
				validationErrors.push(`per-release evidence must be retained/present; got ${retainedRaw || 'missing'}`);
			}

			const releaseValue = getRowValue(perReleaseRow, ['Release Tag', 'Release', 'Release ID', 'ReleaseId']);
			if (!releaseValue) {
				validationErrors.push('per-release evidence row missing Release Tag');
			}

			if (cliOptions.expectedRelease && releaseValue && normalizeComparable(releaseValue) !== normalizeComparable(cliOptions.expectedRelease)) {
				validationErrors.push(`per-release evidence release mismatch: expected ${cliOptions.expectedRelease}, got ${releaseValue}`);
			}

			const evidenceRaw = getRowValue(perReleaseRow, ['Evidence', 'Evidence Ref', 'EvidenceRef', 'Artifact Ref', 'ArtifactRef']);
			if (!evidenceRaw) {
				validationErrors.push('per-release evidence row missing Evidence reference');
			}
		}
	}

	return validationErrors;
}

const cliOptions = parseCliArgs(process.argv.slice(2));
const filePath = cliOptions.filePath || path.join(process.cwd(), 'plan.md');

if (!fs.existsSync(filePath)) {
	console.error(`planpack invalid:\n  file not found: ${filePath}`);
	process.exit(1);
}

const content = fs.readFileSync(filePath, 'utf8');

// Stop parsing at progress tracker heading
const stopMarker = '# Plan-Pack Progress Tracker';
const stopIdx = content.indexOf(stopMarker);
const body = stopIdx !== -1 ? content.slice(0, stopIdx) : content;
const progressContent = stopIdx !== -1 ? content.slice(stopIdx) : '';

// Version marker check
const versionRe = /<!--\s*IE_PLAN_PACK_VERSION:\s*(\d+)\s*-->/;
const versionMatch = body.match(versionRe);
if (!versionMatch) {
	if (cliOptions.allowLegacyBestEffort) {
		console.log('planpack warning: no version marker found (legacy best-effort override active)');
		process.exit(0);
	}
	console.error('planpack invalid:\n  missing required version marker: <!-- IE_PLAN_PACK_VERSION: N -->');
	process.exit(1);
}

const planPackVersion = Number.parseInt(String(versionMatch[1] || ''), 10);
if (!Number.isFinite(planPackVersion) || planPackVersion !== 1) {
	console.error(`planpack invalid:\n  unsupported planpack version: ${versionMatch[1]} (supported: 1)`);
	process.exit(1);
}

const lines = body.split(/\r?\n/);
const errors = [];
const warnings = [];
const requiresExecutionGateChecks = cliOptions.phase !== 'planning';
const requiresPlanningBaseProgressChecks = cliOptions.phase === 'planning';

// --- 1. Required H2 headings ---
const requiredH2 = [
	'Goal + Success Criteria',
	'Context Loaded',
	'Assumptions + Constraints',
	'Decisions',
	'Dropped / Deferred',
	'Work Unit Groups',
	'Work Unit Graph',
	'Work Unit Index',
	'Work Unit Specs',
	'Execution Notes',
	'Risks / Rollback',
	'Validation',
];

const h2Re = /^##\s+(.+)/;
const foundH2 = [];
for (const line of lines) {
	const m = line.match(h2Re);
	if (m) foundH2.push(m[1].trim());
}

for (const req of requiredH2) {
	if (!foundH2.some(h => h === req || h.startsWith(req + ' '))) {
		errors.push(`missing required heading: ## ${req}`);
	}
}

// --- 2. Parse WU specs ---
const wuSpecRe = /^###\s+(WU-\d{3})\s+—\s+/;
const h4Re = /^####\s+(.+)/;
const requiredWuSubs = ['Context', 'Acceptance Criteria', 'Plan / Approach', 'Validation'];

const specWUs = [];
const seenWuIds = new Set();
let currentWU = null;
let currentSubsection = '';
const wuSubs = new Map(); // wuId -> Set of h4 titles
const wuSubContent = new Map(); // wuId -> Map<h4 title, lines[]>

for (const line of lines) {
	const wuMatch = line.match(wuSpecRe);
	if (wuMatch) {
		currentWU = wuMatch[1];
		currentSubsection = '';
		specWUs.push(currentWU);

		// Duplicate check
		if (seenWuIds.has(currentWU)) {
			errors.push(`duplicate WU-ID in specs: ${currentWU}`);
		}
		seenWuIds.add(currentWU);
		wuSubs.set(currentWU, new Set());
		wuSubContent.set(currentWU, new Map());
		continue;
	}

	// Reset current WU on next H2 or H3 that isn't a WU spec
	if (/^##\s+/.test(line) || (/^###\s+/.test(line) && !wuSpecRe.test(line))) {
		currentWU = null;
		currentSubsection = '';
		continue;
	}

	if (currentWU) {
		const h4Match = line.match(h4Re);
		if (h4Match) {
			currentSubsection = h4Match[1].trim();
			wuSubs.get(currentWU).add(currentSubsection);
			wuSubContent.get(currentWU).set(currentSubsection, []);
			continue;
		}

		if (currentSubsection && wuSubContent.has(currentWU) && wuSubContent.get(currentWU).has(currentSubsection)) {
			wuSubContent.get(currentWU).get(currentSubsection).push(line);
		}
	}
}

// --- 3. WU-ID format check ---
const wuIdFormatRe = /^WU-\d{3}$/;
for (const id of specWUs) {
	if (!wuIdFormatRe.test(id)) {
		errors.push(`invalid WU-ID format: ${id} (expected WU-NNN)`);
	}
}

// --- 4. Required WU subsections ---
for (const [wuId, subs] of wuSubs) {
	for (const req of requiredWuSubs) {
		if (!wuHasSubsection(subs, req)) {
			errors.push(`${wuId} missing required subsection: #### ${req}`);
		}
	}
}

// --- 4b. Acceptance Criteria quality enforcement ---
const acQualityDiagnostics = parseAcceptanceCriteriaQuality(lines, wuSubs);
if (acQualityDiagnostics.length > 0) {
	if (cliOptions.acEnforcement === 'fail') {
		for (const diagnostic of acQualityDiagnostics) {
			errors.push(`AC quality failed: ${diagnostic}`);
		}
	} else {
		for (const diagnostic of acQualityDiagnostics) {
			warnings.push(`AC quality warning: ${diagnostic}`);
		}
	}
}

// --- 5. Parse Work Unit Graph table for group IDs and WU IDs ---
const graphWUs = [];
const groupIds = new Set();
const graphParallelSafety = new Map();
const graphSection = extractH2Section(body, 'Work Unit Graph');
const graphTable = parseMarkdownTable(graphSection);

if (!graphTable) {
	errors.push('invalid Work Unit Graph table: markdown table required');
} else {
	const normalizedHeaders = graphTable.headers.map(normalizeFieldName);
	const requiredGraphHeaders = [
		'group',
		'workunitid',
		'title',
		'dependson',
		'nextunits',
		'parallelsafe',
	];

	for (const header of requiredGraphHeaders) {
		if (!normalizedHeaders.includes(header)) {
			errors.push(`invalid Work Unit Graph table: missing ${header} column`);
		}
	}

	const seenGraphWuIds = new Set();
	for (const row of graphTable.rows) {
		const groupId = getRowValue(row, ['Group']);
		const wuId = getRowValue(row, ['Work Unit ID', 'WorkUnitID']);
		const dependsOnRaw = getRowValue(row, ['Depends On', 'DependsOn']);
		const nextUnitsRaw = getRowValue(row, ['Next Units', 'NextUnits']);
		const parallelSafeRaw = normalizeComparable(getRowValue(row, ['Parallel Safe', 'ParallelSafe']));

		if (!groupId) {
			errors.push('Work Unit Graph row missing Group value');
		} else {
			groupIds.add(groupId);
		}

		if (!wuId) {
			errors.push('Work Unit Graph row missing Work Unit ID value');
			continue;
		}

		if (seenGraphWuIds.has(wuId)) {
			errors.push(`duplicate WU-ID in graph: ${wuId}`);
		} else {
			seenGraphWuIds.add(wuId);
		}

		graphWUs.push(wuId);

		const dependsOnParsed = parseJsonArrayCell(dependsOnRaw);
		if (!dependsOnParsed.ok) {
			errors.push(`${wuId} Work Unit Graph Depends On must be a JSON array (${dependsOnParsed.reason})`);
		} else {
			for (const dependencyId of dependsOnParsed.value) {
				if (!wuIdFormatRe.test(dependencyId)) {
					errors.push(`${wuId} Work Unit Graph Depends On contains invalid WU-ID: ${dependencyId}`);
				}
			}
		}

		const nextUnitsParsed = parseJsonArrayCell(nextUnitsRaw);
		if (!nextUnitsParsed.ok) {
			errors.push(`${wuId} Work Unit Graph Next Units must be a JSON array (${nextUnitsParsed.reason})`);
		} else {
			for (const nextUnitId of nextUnitsParsed.value) {
				if (!wuIdFormatRe.test(nextUnitId)) {
					errors.push(`${wuId} Work Unit Graph Next Units contains invalid WU-ID: ${nextUnitId}`);
				}
			}
		}

		if (parallelSafeRaw !== 'yes' && parallelSafeRaw !== 'no') {
			errors.push(`${wuId} Work Unit Graph Parallel Safe must be yes or no (got ${parallelSafeRaw || 'missing'})`);
		} else {
			graphParallelSafety.set(wuId, parallelSafeRaw);
		}
	}
}

// --- 6. Group-ID format check ---
const groupIdFormatRe = /^G-\d{2}-[a-z0-9-]+$/;
for (const gid of groupIds) {
	if (!groupIdFormatRe.test(gid)) {
		errors.push(`invalid Group-ID format: ${gid} (expected G-NN-slug)`);
	}
}

// --- 7. No orphan WUs ---
const graphWUSet = new Set(graphWUs);
for (const wuId of specWUs) {
	if (!graphWUSet.has(wuId)) {
		errors.push(`orphan WU spec (not in graph): ${wuId}`);
	}
}

// --- 7a. Parallel-safe WUs require ownership declaration ---
for (const wuId of graphWUs) {
	if (graphParallelSafety.get(wuId) !== 'yes') {
		continue;
	}

	const subsections = wuSubs.get(wuId);
	if (!wuHasSubsection(subsections, 'Expected Files')) {
		errors.push(`${wuId} marked Parallel Safe=yes must include subsection: #### Expected Files`);
		continue;
	}

	const expectedFileLines = getWuSubsectionLines(wuSubContent, wuId, 'Expected Files');
	const hasExpectedFileBullet = expectedFileLines.some(line => /^\s*[-*]\s+\S+/.test(line));
	if (!hasExpectedFileBullet) {
		errors.push(`${wuId} marked Parallel Safe=yes must list at least one expected file bullet`);
	}
}

// --- 7b. Planning/base progress tracker sections ---
if (requiresPlanningBaseProgressChecks) {
	const requiredBaseProgressSections = [
		'Session Metadata',
		'Work Unit Groups Overview',
		'Work Unit Status Table',
		'Next Unit',
		'Checkpoints',
		'Execution Log',
	];

	for (const sectionName of requiredBaseProgressSections) {
		if (!hasRequiredProgressSection(progressContent, sectionName)) {
			const descriptor = sectionName === 'Execution Log' || sectionName === 'Session Metadata'
				? `${sectionName} section required`
				: `${sectionName} section required${sectionName === 'Next Unit' ? '' : ' (markdown table required)'}`;
			errors.push(`missing required progress section: ## ${descriptor}`);
		}
	}
}

// --- 8. Evidence predicates (required streams from Work Unit Groups Overview) ---
if (requiresExecutionGateChecks) {
	const requiredStreamGroups = deriveRequiredStreamGroups(progressContent);
	if (!requiredStreamGroups.hasOverviewTable) {
		errors.push('missing required progress section: ## Work Unit Groups Overview (markdown table required)');
	}

	const requiredStreams = requiredStreamGroups.requiredStreams;
	if (requiredStreams.length === 0) {
		errors.push('missing required stream evidence: no valid Group IDs found in Work Unit Groups Overview');
	}

	const executionLogSection = extractH2Section(progressContent, 'Execution Log');
	const streamEvidenceTable = parseMarkdownTable(extractH2Section(progressContent, 'Stream Evidence'));

	for (const streamId of requiredStreams) {
		const hasExecutionEvidence = hasExecutionLogCompletion(executionLogSection, streamId);
		const hasStreamTableEvidence = hasPassedStreamEvidenceForGroup(streamEvidenceTable, streamId);

		if (!(hasExecutionEvidence && hasStreamTableEvidence)) {
			errors.push(
				`missing required stream evidence: ${streamId} (requires BOTH Execution Log completion evidence and Stream Evidence row with Status=passed plus non-empty Evidence)`
			);
		}
	}
}

// --- 9. Final gate controls (required controls + waiver precedence) ---
if (requiresExecutionGateChecks) {
	const finalRequiredControls = [
		'evidencePredicates',
		'finalGateWaiverPrecedence',
		'trustedEvidenceBindingRetention',
	];
	const finalGateSection = extractH2Section(progressContent, 'Final Gate Controls');
	const finalGateTable = parseMarkdownTable(finalGateSection);

	if (!finalGateTable) {
		errors.push('missing required progress section: ## Final Gate Controls (markdown table required)');
	} else {
		const normalizedHeaders = finalGateTable.headers.map(normalizeFieldName);
		const hasControlHeader = normalizedHeaders.includes('control') || normalizedHeaders.includes('controlid');
		const hasStatusHeader = normalizedHeaders.includes('status');
		const hasWaiverScopeHeader = normalizedHeaders.includes('waiverscope') || normalizedHeaders.includes('waivercontrols');
		const hasWaiverReleaseHeader = normalizedHeaders.includes('waiverrelease') || normalizedHeaders.includes('release') || normalizedHeaders.includes('releaseid');
		const hasWaiverAuditHeader = normalizedHeaders.includes('waiveraudit') || normalizedHeaders.includes('waiveraudittrail') || normalizedHeaders.includes('audittrail') || normalizedHeaders.includes('auditreference') || normalizedHeaders.includes('auditref') || normalizedHeaders.includes('auditlink');

		if (!hasControlHeader) {
			errors.push('invalid Final Gate Controls table: missing Control column');
		}
		if (!hasStatusHeader) {
			errors.push('invalid Final Gate Controls table: missing Status column');
		}
		if (!hasWaiverScopeHeader) {
			errors.push('invalid Final Gate Controls table: missing Waiver Scope column');
		}
		if (!hasWaiverReleaseHeader) {
			errors.push('invalid Final Gate Controls table: missing Waiver Release column');
		}
		if (!hasWaiverAuditHeader) {
			errors.push('invalid Final Gate Controls table: missing Waiver Audit column');
		}

		for (const controlId of finalRequiredControls) {
			const matchingRows = finalGateTable.rows.filter((row) => {
				const rowControlId = getRowValue(row, ['Control', 'Control ID', 'ControlId']);
				return rowControlId.toLowerCase() === controlId.toLowerCase();
			});

			if (matchingRows.length === 0) {
				errors.push(`missing required final gate control row: ${controlId}`);
				continue;
			}

			if (matchingRows.length > 1) {
				errors.push(`duplicate final gate control rows: ${controlId}`);
				continue;
			}

			const row = matchingRows[0];
			const statusValue = getRowValue(row, ['Status']).toLowerCase();
			const isPassed = ['passed', 'true', 'yes'].includes(statusValue);

			if (isPassed) {
				if (controlId.toLowerCase() === 'trustedevidencebindingretention') {
					const trustedEvidenceErrors = validateTrustedEvidenceBindingAndRetention(progressContent, cliOptions);
					for (const trustedEvidenceError of trustedEvidenceErrors) {
						errors.push(`final gate control failed: trustedEvidenceBindingRetention (${trustedEvidenceError})`);
					}
				}
				continue;
			}

			if (statusValue !== 'waived') {
				errors.push(
					`final gate control failed: ${controlId} (Status must be passed or waived; got ${statusValue || 'missing'})`
				);
				continue;
			}

			const waiverScope = getRowValue(row, [
				'Waiver Scope',
				'Scoped Controls',
				'Waiver Controls',
				'Waiver Control Scope',
			]);
			if (!hasControlScopeToken(waiverScope, controlId)) {
				errors.push(
					`final gate waiver scope mismatch: ${controlId} (Waiver Scope must explicitly include ${controlId})`
				);
			}

			const waiverRelease = getRowValue(row, ['Waiver Release', 'Release', 'Release ID', 'ReleaseId']);
			const waiverAudit = getRowValue(row, [
				'Waiver Audit',
				'Waiver Audit Trail',
				'Audit Trail',
				'Audit Reference',
				'Audit Ref',
				'Audit Link',
			]);
			if (!waiverRelease || !waiverAudit) {
				errors.push(
					`final gate waiver missing release-linked audit trail: ${controlId} (Waiver Release and Waiver Audit are required when Status=waived)`
				);
			}
		}
	}
}

for (const wuId of graphWUs) {
	if (!seenWuIds.has(wuId)) {
		errors.push(`orphan WU in graph (no spec heading): ${wuId}`);
	}
}

// --- Result ---
if (errors.length > 0) {
	console.error(`planpack invalid:\n${errors.map(e => '  ' + e).join('\n')}`);
	process.exit(1);
}

if (warnings.length > 0) {
	console.error(`planpack warning:\n${warnings.map(w => '  ' + w).join('\n')}`);
}

console.log(`planpack ok (${specWUs.length} work units)`);
