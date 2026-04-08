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
	changedfiles: 'changedFiles',
	wheretoverify: 'whereToVerify',
	verificationsteps: 'verificationSteps',
	expectedoutcomes: 'expectedOutcomes',
	validationrequirements: 'validationRequirements',
	testedcoverage: 'validationCoverage',
	validationcoverage: 'validationCoverage',
	coveragegaps: 'coverageGaps',
	coveragegapslimitations: 'coverageGaps',
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

function parseArtifactSections(text, headingLevel = 2) {
	return extractLevelSections(text, headingLevel).map((section) => ({
		title: section.title,
		key: section.key,
		content: section.content,
		items: parseListItems(section.content),
	}));
}

function parseVerificationGuideText(text) {
	const sections = parseArtifactSections(text, 2);
	const warnings = [];
	const requiredKeys = [
		'summary',
		'changedFiles',
		'whereToVerify',
		'verificationSteps',
		'expectedOutcomes',
	];

	for (const requiredKey of requiredKeys) {
		if (!sections.some((section) => section.key === requiredKey)) {
			warnings.push(`missing verification guide section: ${requiredKey}`);
		}
	}

	return {
		sections,
		warnings,
	};
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
	const sections = parseArtifactSections(text, 2);
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

function firstNonEmptyString(...values) {
	for (const value of values) {
		const normalized = trimContent(value);
		if (normalized) {
			return normalized;
		}
	}
	return '';
}

function uniqueStrings(values) {
	const seen = new Set();
	const result = [];
	for (const value of Array.isArray(values) ? values : []) {
		const normalized = trimContent(value);
		if (!normalized) {
			continue;
		}
		const key = normalized.toLowerCase();
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		result.push(normalized);
	}
	return result;
}

function pickSection(sections, ...keys) {
	if (!Array.isArray(sections)) {
		return null;
	}

	for (const key of keys.flat()) {
		const match = sections.find((section) => section && section.key === key);
		if (match) {
			return match;
		}
	}

	return null;
}

function getSectionItems(sections, ...keys) {
	const section = pickSection(sections, ...keys);
	if (!section) {
		return [];
	}
	if (Array.isArray(section.items) && section.items.length > 0) {
		return uniqueStrings(section.items);
	}
	const content = trimContent(section.content);
	return content ? [content] : [];
}

function getSectionContent(sections, ...keys) {
	const section = pickSection(sections, ...keys);
	if (!section) {
		return '';
	}
	return trimContent(section.content);
}

function summarizeItems(items) {
	const values = uniqueStrings(items);
	if (values.length === 0) {
		return '';
	}
	return values.join(' ');
}

const VALIDATION_LAYER_DETECTORS = Object.freeze([
	{ layer: 'unit', pattern: /\bunit(?:[-\s]?tests?|[-\s]?coverage| validation)?\b/i },
	{ layer: 'integration', pattern: /\bintegration(?:[-\s]?tests?|[-\s]?coverage| validation)?\b/i },
	{ layer: 'e2e', pattern: /\be2e\b|\bend[-\s]?to[-\s]?end\b/i },
	{ layer: 'browser', pattern: /\bbrowser(?:[-\s]?(?:tests?|coverage|validation|verification|check|checks))?\b|\bagent-browser\b/i },
	{ layer: 'playwright', pattern: /\bplaywright\b/i },
	{ layer: 'manual', pattern: /\bmanual(?:[-\s]?(?:tests?|coverage|validation|verification|check|checks))?\b/i },
]);

const STRUCTURED_VALIDATION_LABELS = new Set([
	'unit',
	'integration',
	'e2e',
	'browser',
	'playwright',
	'manual',
]);

const NEGATED_VALIDATION_REQUIREMENT_RE = /\b(?:not required|not-required|optional|not needed|not necessary|unnecessary|not mandated|out of scope|not in scope)\b/i;
const MANDATORY_VALIDATION_REQUIREMENT_RE = /\b(?:required|mandatory|must\b|needs?\b|policy-driven)\b/i;

function normalizeStructuredValidationLabel(value) {
	const normalized = trimContent(value).toLowerCase();
	return STRUCTURED_VALIDATION_LABELS.has(normalized) ? normalized : '';
}

function parseStructuredValidationItem(value) {
	const text = trimContent(value);
	const match = text.match(/^([a-z0-9-]+)\s*:\s*(.+)$/i);
	if (!match) {
		return null;
	}

	const label = normalizeStructuredValidationLabel(match[1]);
	const detail = trimContent(match[2]);
	if (!label || !detail) {
		return null;
	}

	return {
		label,
		text: `${label}: ${detail}`,
	};
}

function getStructuredValidationSectionData(sections, ...keys) {
	const section = pickSection(sections, ...keys);
	if (!section) {
		return {
			present: false,
			items: [],
			unlabeledItems: [],
		};
	}

	const rawItems = Array.isArray(section.items) && section.items.length > 0
		? section.items
		: (() => {
			const content = trimContent(section.content);
			return content ? [content] : [];
		})();
	const items = [];
	const unlabeledItems = [];

	for (const rawItem of rawItems) {
		const normalized = trimContent(rawItem);
		if (!normalized) {
			continue;
		}

		const parsed = parseStructuredValidationItem(normalized);
		if (parsed) {
			items.push(parsed.text);
			continue;
		}

		unlabeledItems.push(normalized);
	}

	return {
		present: true,
		items: uniqueStrings(items),
		unlabeledItems: uniqueStrings(unlabeledItems),
	};
}

function hasUnlabeledMandatoryValidationRequirement(sections) {
	const validationRequirements = getStructuredValidationSectionData(sections, 'validationRequirements');
	return validationRequirements.unlabeledItems.some((entry) => isMandatoryValidationRequirement(entry));
}

function detectValidationLayers(value) {
	const text = trimContent(value);
	const layers = new Set();

	for (const detector of VALIDATION_LAYER_DETECTORS) {
		if (detector.pattern.test(text)) {
			layers.add(detector.layer);
		}
	}

	return layers;
}

function isMandatoryValidationRequirement(value) {
	const text = trimContent(value);
	if (!text || NEGATED_VALIDATION_REQUIREMENT_RE.test(text)) {
		return false;
	}

	return MANDATORY_VALIDATION_REQUIREMENT_RE.test(text);
}

function hasMissingMandatoryValidation(validationRequirements, validationCoverage, coverageGaps, options = {}) {
	if (options.unlabeledMandatoryRequirement === true) {
		return true;
	}

	const mandatoryRequirements = uniqueStrings(validationRequirements)
		.map((entry) => ({
			text: entry,
			layers: detectValidationLayers(entry),
		}))
		.filter((entry) => isMandatoryValidationRequirement(entry.text));
	const gapSignals = uniqueStrings(coverageGaps)
		.map((entry) => ({
			layers: detectValidationLayers(entry),
		}));

		if (mandatoryRequirements.length === 0) {
		return false;
	}

	const coveredLayers = new Set();
	for (const entry of uniqueStrings(validationCoverage)) {
		for (const layer of detectValidationLayers(entry)) {
			coveredLayers.add(layer);
		}
	}

	const genericGapPresent = gapSignals.some((entry) => entry.layers.size === 0);

	for (const requirement of mandatoryRequirements) {
		if (requirement.layers.size === 0) {
			return true;
		}

		for (const layer of requirement.layers) {
			if (gapSignals.some((entry) => entry.layers.has(layer))) {
				return true;
			}
				if (!coveredLayers.has(layer)) {
				return true;
			}
				if (genericGapPresent) {
					return true;
				}
		}
	}

	return false;
}

const TERMINAL_EXECUTION_STATE_TOKENS = new Set([
	'aborted',
	'canceled',
	'cancelled',
	'closed',
	'complete',
	'completed',
	'done',
	'error',
	'failed',
	'finished',
	'stopped',
	'terminated',
]);

const SUCCESSFUL_TERMINAL_EXECUTION_STATE_TOKENS = new Set([
	'closed',
	'complete',
	'completed',
	'done',
	'finished',
]);

const UNSUCCESSFUL_TERMINAL_EXECUTION_STATE_TOKENS = new Set([
	'aborted',
	'canceled',
	'cancelled',
	'error',
	'failed',
	'stopped',
	'terminated',
]);

const NON_BLOCKING_TERMINAL_RESUME_BLOCKERS = new Set([
	'handoff_invalid',
	'handoff_missing',
]);

function normalizeExecutionStateToken(value) {
	return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function deriveExecutionStateFinality(executionState) {
	if (!executionState || typeof executionState !== 'object') {
		return {
			status: null,
			lifecycle: null,
			terminal: false,
			disposition: null,
		};
	}

	const status = normalizeExecutionStateToken(executionState.status);
	const lifecycle = normalizeExecutionStateToken(executionState.lifecycle);
	const terminal = TERMINAL_EXECUTION_STATE_TOKENS.has(status) || TERMINAL_EXECUTION_STATE_TOKENS.has(lifecycle);
	const disposition = (
		UNSUCCESSFUL_TERMINAL_EXECUTION_STATE_TOKENS.has(status)
		|| UNSUCCESSFUL_TERMINAL_EXECUTION_STATE_TOKENS.has(lifecycle)
	)
		? 'unsuccessful'
		: (
			SUCCESSFUL_TERMINAL_EXECUTION_STATE_TOKENS.has(status)
			|| SUCCESSFUL_TERMINAL_EXECUTION_STATE_TOKENS.has(lifecycle)
		)
			? 'successful'
			: null;

	return {
		status: status || null,
		lifecycle: lifecycle || null,
		terminal,
		disposition,
	};
}

function getLatestReviewLedgerRow(reviewLedger) {
	if (!reviewLedger || !Array.isArray(reviewLedger.rows) || reviewLedger.rows.length === 0) {
		return null;
	}
	return reviewLedger.rows[reviewLedger.rows.length - 1] || null;
}

function formatNextSuggestedUnits(nextUnit) {
	if (!nextUnit || typeof nextUnit !== 'object') {
		return [];
	}

	const candidates = Array.isArray(nextUnit.workUnitIds) && nextUnit.workUnitIds.length > 0
		? nextUnit.workUnitIds
		: nextUnit.workUnitId
			? [nextUnit.workUnitId]
			: [];

	return uniqueStrings(candidates);
}

function formatCheckpointSignals(checkpoints) {
	if (!Array.isArray(checkpoints)) {
		return [];
	}

	return uniqueStrings(checkpoints.map((checkpoint) => {
		if (!checkpoint || typeof checkpoint !== 'object') {
			return '';
		}
		const label = trimContent(checkpoint.checkpoint);
		const trigger = trimContent(checkpoint.trigger);
		if (!label) {
			return '';
		}
		return trigger ? `${label} — ${trigger}` : label;
	}));
}

function formatPassedCheckpoints(checkpoints) {
	if (!Array.isArray(checkpoints)) {
		return [];
	}

	return uniqueStrings(checkpoints
		.filter((checkpoint) => checkpoint && typeof checkpoint === 'object' && String(checkpoint.status || '').toLowerCase() === 'passed')
		.map((checkpoint) => {
			const label = trimContent(checkpoint.checkpoint);
			const trigger = trimContent(checkpoint.trigger);
			if (!label) {
				return '';
			}
			return trigger ? `${label} passed (${trigger})` : `${label} passed`;
		}));
}

function formatVerificationEvidence(verificationGuide) {
	if (!verificationGuide || !Array.isArray(verificationGuide.sections)) {
		return [];
	}

	const steps = getSectionItems(verificationGuide.sections, 'verificationSteps');
	const outcomes = getSectionItems(verificationGuide.sections, 'expectedOutcomes');
	const verifyTargets = getSectionItems(verificationGuide.sections, 'whereToVerify');
	const validationRequirements = getStructuredValidationSectionData(verificationGuide.sections, 'validationRequirements').items;
	const validationCoverage = getStructuredValidationSectionData(verificationGuide.sections, 'validationCoverage').items;
	const coverageGaps = getStructuredValidationSectionData(verificationGuide.sections, 'coverageGaps').items;
	const evidence = [];

	if (steps.length > 0) {
		evidence.push(`Verification guide lists ${steps.length} verification step${steps.length === 1 ? '' : 's'}.`);
	}
	if (outcomes.length > 0) {
		evidence.push(`Expected outcomes captured: ${outcomes.join(' ')}`);
	}
	if (verifyTargets.length > 0) {
		evidence.push(`Verification targets captured: ${verifyTargets.join(' ')}`);
	}
	if (validationRequirements.length > 0) {
		evidence.push(`Validation requirements captured: ${validationRequirements.join(' ')}`);
	}
	if (validationCoverage.length > 0) {
		evidence.push(`Tested coverage captured: ${validationCoverage.join(' ')}`);
	}
	if (coverageGaps.length > 0) {
		evidence.push(`Coverage gaps captured: ${coverageGaps.join(' ')}`);
	}

	return uniqueStrings(evidence);
}

function deriveValidationRequirements(verificationGuide) {
	const sections = verificationGuide && Array.isArray(verificationGuide.sections)
		? verificationGuide.sections
		: [];
	const explicitRequirements = getStructuredValidationSectionData(sections, 'validationRequirements');
	return explicitRequirements.present ? explicitRequirements.items : [];
}

function deriveValidationCoverage(verificationGuide) {
	const sections = verificationGuide && Array.isArray(verificationGuide.sections)
		? verificationGuide.sections
		: [];
	return getStructuredValidationSectionData(sections, 'validationCoverage').items;
}

function deriveCoverageGaps(verificationGuide) {
	const sections = verificationGuide && Array.isArray(verificationGuide.sections)
		? verificationGuide.sections
		: [];
	return getStructuredValidationSectionData(sections, 'coverageGaps').items;
}

function deriveSessionIntentFrame(input = {}) {
	const warnings = [];
	const sourceArtifacts = ['plan'];
	const handoff = input.handoff && typeof input.handoff === 'object' ? input.handoff : null;
	const proposition = input.proposition && typeof input.proposition === 'object' ? input.proposition : null;
	const verificationGuide = input.verificationGuide && typeof input.verificationGuide === 'object' ? input.verificationGuide : null;
	const latestPropositionEntry = proposition && proposition.latestEntry && typeof proposition.latestEntry === 'object'
		? proposition.latestEntry
		: null;
	const propositionSections = Array.isArray(latestPropositionEntry && latestPropositionEntry.sections)
		? latestPropositionEntry.sections
		: [];
	const handoffSections = Array.isArray(handoff && handoff.sections) ? handoff.sections : [];

	if (handoff) {
		sourceArtifacts.push('handoff');
	}
	if (latestPropositionEntry) {
		sourceArtifacts.push('proposition');
	}
	if (verificationGuide && Array.isArray(verificationGuide.sections) && verificationGuide.sections.length > 0) {
		sourceArtifacts.push('verification-guide');
	}

	const summary = firstNonEmptyString(
		summarizeItems(getSectionItems(propositionSections, 'summary')),
		getSectionContent(propositionSections, 'details'),
		summarizeItems(getSectionItems(handoffSections, 'immediateNextActions')),
		summarizeItems(getSectionItems(handoffSections, 'keyDecisions'))
	) || null;
	const inScope = uniqueStrings([
		...getSectionItems(propositionSections, 'immediateNextActions'),
		...getSectionItems(handoffSections, 'immediateNextActions'),
	]);
	const outOfScope = uniqueStrings([
		...getSectionItems(propositionSections, 'nextPlanIdeas'),
		...getSectionItems(handoffSections, 'nextPlanIdeas'),
	]);
	const successSignals = uniqueStrings([
		...formatCheckpointSignals(input.checkpoints),
		...getSectionItems(verificationGuide && verificationGuide.sections, 'expectedOutcomes'),
	]);
	const validationRequirements = deriveValidationRequirements(verificationGuide);
	const constraints = getSectionItems(handoffSections, 'userConstraints');
	const risks = uniqueStrings([
		...getSectionItems(propositionSections, 'openRisks'),
		...getSectionItems(handoffSections, 'openRisks'),
	]);
	const watchOuts = uniqueStrings([
		...getSectionItems(propositionSections, 'watchOuts'),
		...getSectionItems(handoffSections, 'watchOuts'),
	]);
	const carryoverSignals = uniqueStrings([
		...getSectionItems(propositionSections, 'nextPlanIdeas'),
		...getSectionItems(handoffSections, 'nextPlanIdeas'),
	]);
	const keyDecisions = getSectionItems(handoffSections, 'keyDecisions');
	const contextSignals = getSectionItems(handoffSections, 'explorationSummary');
	const nextSuggestedUnits = formatNextSuggestedUnits(input.nextUnit);
	const resume = input.resume && typeof input.resume === 'object' ? input.resume : null;
	const reviewLedger = input.reviewLedger && typeof input.reviewLedger === 'object' ? input.reviewLedger : null;

	if (!summary) {
		warnings.push('unable to derive a concise intent summary from persisted artifacts');
	}
	if (inScope.length === 0) {
		warnings.push('no explicit in-scope actions were found');
	}
	if (!handoff) {
		warnings.push('handoff artifact missing; intent frame may be incomplete');
	}

	return {
		summary,
		inScope,
		outOfScope,
		successSignals,
		validationRequirements,
		constraints,
		risks,
		watchOuts,
		carryoverSignals,
		keyDecisions,
		contextSignals,
		nextSuggestedUnits,
		resumeReady: typeof (resume && resume.ready) === 'boolean' ? resume.ready : null,
		resumeBlockers: Array.isArray(resume && resume.blockers) ? uniqueStrings(resume.blockers) : [],
		reviewApproved: typeof (reviewLedger && reviewLedger.approved) === 'boolean' ? reviewLedger.approved : null,
		planStatus: handoff && handoff.manifest ? handoff.manifest.planStatus || null : null,
		sourceArtifacts: uniqueStrings(sourceArtifacts),
		warnings,
	};
}

function deriveSessionObjective(input = {}) {
	const source = input && typeof input === 'object' ? input : {};
	const intentFrame = source.intentFrame && typeof source.intentFrame === 'object' ? source.intentFrame : null;
	const closureSummary = source.closureSummary && typeof source.closureSummary === 'object' ? source.closureSummary : null;
	const handoff = source.handoff && typeof source.handoff === 'object' ? source.handoff : null;
	const executionState = source.executionState && typeof source.executionState === 'object' ? source.executionState : null;
	const proposition = source.proposition && typeof source.proposition === 'object' ? source.proposition : null;
	const latestPropositionEntry = proposition && proposition.latestEntry && typeof proposition.latestEntry === 'object'
		? proposition.latestEntry
		: null;
	const propositionSections = Array.isArray(latestPropositionEntry && latestPropositionEntry.sections)
		? latestPropositionEntry.sections
		: [];
	const handoffSections = Array.isArray(handoff && handoff.sections) ? handoff.sections : [];

	return firstNonEmptyString(
		intentFrame && intentFrame.summary,
		closureSummary && closureSummary.summary,
		summarizeItems(getSectionItems(propositionSections, 'summary')),
		getSectionContent(propositionSections, 'details'),
		summarizeItems(getSectionItems(handoffSections, 'immediateNextActions')),
		executionState && executionState.summary
	) || null;
}

function deriveSessionClosureSummary(input = {}) {
	const warnings = [];
	const sourceArtifacts = ['plan'];
	const proposition = input.proposition && typeof input.proposition === 'object' ? input.proposition : null;
	const handoff = input.handoff && typeof input.handoff === 'object' ? input.handoff : null;
	const verificationGuide = input.verificationGuide && typeof input.verificationGuide === 'object' ? input.verificationGuide : null;
	const latestPropositionEntry = proposition && proposition.latestEntry && typeof proposition.latestEntry === 'object'
		? proposition.latestEntry
		: null;
	const propositionSections = Array.isArray(latestPropositionEntry && latestPropositionEntry.sections)
		? latestPropositionEntry.sections
		: [];
	const handoffSections = Array.isArray(handoff && handoff.sections) ? handoff.sections : [];
	const verificationSections = Array.isArray(verificationGuide && verificationGuide.sections) ? verificationGuide.sections : [];
	const reviewLedger = input.reviewLedger && typeof input.reviewLedger === 'object' ? input.reviewLedger : null;
	const resume = input.resume && typeof input.resume === 'object' ? input.resume : null;
	const executionState = input.executionState && typeof input.executionState === 'object' ? input.executionState : null;
	const latestReviewRow = getLatestReviewLedgerRow(reviewLedger);
	const requested = input.intentFrame && Array.isArray(input.intentFrame.inScope)
		? uniqueStrings(input.intentFrame.inScope)
		: [];
	const propositionSummary = getSectionItems(propositionSections, 'summary');
	const verificationSummary = getSectionContent(verificationSections, 'summary');

	if (latestPropositionEntry) {
		sourceArtifacts.push('proposition');
	}
	if (handoff) {
		sourceArtifacts.push('handoff');
	}
	if (verificationSections.length > 0) {
		sourceArtifacts.push('verification-guide');
	}
	if (executionState) {
		sourceArtifacts.push('execution-state');
	}

	const executionFinality = deriveExecutionStateFinality(executionState);
	const summary = firstNonEmptyString(
		summarizeItems(propositionSummary),
		verificationSummary,
		getSectionContent(propositionSections, 'details'),
		executionState && executionState.summary
	) || null;
	const delivered = uniqueStrings([
		...propositionSummary,
		...(propositionSummary.length === 0 && verificationSummary ? [verificationSummary] : []),
	]);
	const changedFiles = getSectionItems(verificationSections, 'changedFiles');
	const whereToVerify = getSectionItems(verificationSections, 'whereToVerify');
	const validationRequirements = deriveValidationRequirements(verificationGuide);
	const validationCoverage = deriveValidationCoverage(verificationGuide);
	const coverageGaps = deriveCoverageGaps(verificationGuide);
	const missingMandatoryValidation = hasMissingMandatoryValidation(
		validationRequirements,
		validationCoverage,
		coverageGaps,
		{ unlabeledMandatoryRequirement: hasUnlabeledMandatoryValidationRequirement(verificationSections) }
	);
	const derivedActiveContinuation = uniqueStrings([
		...getSectionItems(propositionSections, 'immediateNextActions'),
		...getSectionItems(handoffSections, 'immediateNextActions'),
		...(formatNextSuggestedUnits(input.nextUnit).filter((unit) => unit && unit !== 'NONE')),
	]);
	const durableCarryover = uniqueStrings([
		...getSectionItems(propositionSections, 'nextPlanIdeas'),
		...getSectionItems(handoffSections, 'nextPlanIdeas'),
	]);
	const blockers = uniqueStrings([
		...(Array.isArray(resume && resume.blockers) ? resume.blockers : []),
		...getSectionItems(propositionSections, 'openRisks'),
			...(missingMandatoryValidation ? ['Mandatory validation is required but persisted validation coverage is incomplete.'] : []),
	]);
	const limitations = uniqueStrings([
		...getSectionItems(handoffSections, 'userConstraints'),
		...(verificationSections.length === 0 ? ['Verification guide missing or not persisted for this session.'] : []),
		...(reviewLedger && reviewLedger.approved === false ? ['Review ledger does not show a resumable approval verdict.'] : []),
	]);
	const passedCheckpointEvidence = formatPassedCheckpoints(input.checkpoints);
	const affirmativeValidationEvidence = uniqueStrings([
		...passedCheckpointEvidence,
		...validationCoverage,
	]);
	const validationEvidence = uniqueStrings([
		...(latestReviewRow && latestReviewRow.verdict
			? [`Review ledger verdict: ${latestReviewRow.verdict}${latestReviewRow.reviewer ? ` (${latestReviewRow.reviewer})` : ''}`]
			: []),
		...passedCheckpointEvidence,
		...formatVerificationEvidence(verificationGuide),
	]);

	let confidence = 'unknown';
	if (missingMandatoryValidation) {
		confidence = 'low';
	} else if (reviewLedger && reviewLedger.approved === true && affirmativeValidationEvidence.length > 0) {
		confidence = 'high';
	} else if ((reviewLedger && reviewLedger.approved === true) || affirmativeValidationEvidence.length > 0 || validationEvidence.length > 0) {
		confidence = 'medium';
	} else if (blockers.length > 0 || limitations.length > 0) {
		confidence = 'low';
	}

	const terminalExecutionHint = (
		executionFinality.terminal
		|| String(latestPropositionEntry && latestPropositionEntry.phase || '').toLowerCase() === 'after-execution'
		|| (input.nextUnit && input.nextUnit.workUnitId === 'NONE')
	);
	const blockingResumeBlockers = Array.isArray(resume && resume.blockers)
		? resume.blockers.filter((blocker) => !NON_BLOCKING_TERMINAL_RESUME_BLOCKERS.has(String(blocker || '').trim().toLowerCase()))
		: [];
	const closureBlocked = (
		missingMandatoryValidation
		|| (reviewLedger && reviewLedger.approved !== true)
		|| blockingResumeBlockers.length > 0
	);

	let outcome = 'unknown';
	if (terminalExecutionHint) {
		outcome = closureBlocked || executionFinality.disposition === 'unsuccessful'
			? 'paused'
			: 'completed';
	} else if (derivedActiveContinuation.length > 0 || (resume && resume.ready === false)) {
		outcome = 'paused';
	}
	const activeContinuation = outcome === 'completed' ? [] : derivedActiveContinuation;

	if (!summary) {
		warnings.push('unable to derive a closure summary from persisted artifacts');
	}
	if (validationEvidence.length === 0) {
		warnings.push('no explicit validation evidence was found');
	}

	return {
		summary,
		outcome,
		delivered,
		requested,
		changedFiles,
		whereToVerify,
		validationRequirements,
		validationCoverage,
		validationEvidence,
		followUps: {
			activeContinuation,
			durableCarryover,
		},
		blockers,
		coverageGaps,
		limitations,
		confidence,
		reviewApproved: typeof (reviewLedger && reviewLedger.approved) === 'boolean' ? reviewLedger.approved : null,
		reviewVerdict: latestReviewRow ? latestReviewRow.verdict || null : null,
		finality: executionFinality.terminal || terminalExecutionHint ? 'terminal' : null,
		executionStatus: executionFinality.status,
		executionLifecycle: executionFinality.lifecycle,
		sourceArtifacts: uniqueStrings(sourceArtifacts),
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

	const latestRow = rows[rows.length - 1] || null;
	const approved = !!(latestRow && ['APPROVED', 'USER_APPROVED_WITH_RISKS'].includes(latestRow.verdict));
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
	deriveExecutionStateFinality,
	deriveSessionClosureSummary,
	deriveSessionIntentFrame,
	deriveSessionObjective,
	parseArtifactSections,
	parsePropositionText,
	parseHandoffText,
	parseVerificationGuideText,
	parseReviewLedgerFromPlan,
};
