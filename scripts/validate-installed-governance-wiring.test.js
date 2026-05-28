const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

function normalizeWhitespace(value) {
	return value.replace(/\s+/g, ' ').trim();
}

const expectations = [
	{
		relativePath: 'engine-assets/copilot-instructions.md',
		requiredSnippets: [
			'Narrow candidate constraints to the minimum hard constraints needed for the active step;',
			'Use ADRs only for key architectural, workflow-authority, trust-boundary, or long-lived contract decisions;',
		],
	},
	{
		relativePath: '.github/copilot-instructions.md',
		requiredSnippets: [
			'Narrow candidate constraints to the minimum hard constraints needed for the active step;',
			'Use ADRs only for key architectural, workflow-authority, trust-boundary, or long-lived contract decisions;',
		],
	},
	{
		relativePath: 'codex-assets/home/AGENTS.md',
		requiredSnippets: [
			'Narrow candidate constraints to the minimum hard constraints needed for the active step.',
			'Use ADRs only for key architectural, workflow-authority, trust-boundary, or long-lived contract decisions.',
		],
	},
	{
		relativePath: 'opencode-assets/home/AGENTS.md',
		requiredSnippets: [
			'Narrow candidate constraints to the minimum hard constraints needed for the active step;',
			'Use ADRs only for key architectural, workflow-authority, trust-boundary, or long-lived contract decisions.',
		],
	},
	{
		relativePath: 'antigravity-assets/home/GEMINI.md',
		requiredSnippets: [
			'Narrow candidate constraints to the minimum hard constraints needed for the active step',
			'Use ADRs only for key architectural, workflow-authority, trust-boundary, or long-lived contract decisions.',
		],
	},
	{
		relativePath: 'catalog-assets/shared-skills/rubberduck-plan-review/SKILL.md',
		requiredSnippets: [
			'Check whether the plan narrowed candidate constraints to the minimum hard set needed for the active slice',
			'key architectural, trust-boundary, workflow-authority, or long-lived contract decision should be captured in an ADR',
		],
	},
	{
		relativePath: 'engine-assets/skills/project-conventions-governance/SKILL.md',
		requiredSnippets: [
			'Narrow candidate constraints to the minimum hard constraints needed for the active step; keep shaping context and open questions separate.',
			'Use ADRs only for key architectural, workflow-authority, trust-boundary, or long-lived contract decisions.',
		],
	},
	{
		relativePath: 'engine-assets/skills/documentation-authoring/SKILL.md',
		requiredSnippets: [
			'Narrow candidate constraints to the minimum hard constraints needed for the active step; keep shaping context and open questions separate.',
			'Use ADRs only for key architectural, workflow-authority, trust-boundary, or long-lived contract decisions.',
		],
	},
	{
		relativePath: 'engine-assets/skills/documentation-structure-governance/SKILL.md',
		requiredSnippets: [
			'Narrow candidate constraints to the minimum hard constraints needed for the active step; keep shaping context and open questions separate.',
			'Use ADRs only for key architectural, workflow-authority, trust-boundary, or long-lived contract decisions.',
		],
	},
	{
		relativePath: 'opencode-assets/skills/project-conventions-governance/SKILL.md',
		requiredSnippets: [
			'Narrow candidate constraints to the minimum hard constraints needed for the active step; keep shaping context and open questions separate.',
			'Use ADRs only for key architectural, workflow-authority, trust-boundary, or long-lived contract decisions.',
		],
	},
];

(function run() {
	for (const { relativePath, requiredSnippets } of expectations) {
		const absolutePath = path.join(repoRoot, relativePath);
		const content = normalizeWhitespace(fs.readFileSync(absolutePath, 'utf8'));
		for (const snippet of requiredSnippets) {
			assert.ok(
				content.includes(normalizeWhitespace(snippet)),
				`expected ${relativePath} to include: ${snippet}`,
			);
		}
	}

	console.log('installed governance wiring text checks passed');
})();
