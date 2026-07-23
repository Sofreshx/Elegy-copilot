const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

function normalizeWhitespace(value) {
	return value.replace(/\s+/g, ' ').trim();
}

const skillExpectations = [
	{
		relativePath: 'catalog-assets/shared-skills/rubberduck-plan-review/SKILL.md',
		requiredSnippets: [
			'Check whether the plan narrowed candidate constraints to the minimum hard set needed for the active slice',
		],
	},
	{
		relativePath: 'engine-assets/skills/project-conventions-governance/SKILL.md',
		requiredSnippets: [
			'Narrow candidate constraints to the minimum hard constraints needed for the active step',
		],
	},
	{
		relativePath: 'engine-assets/skills/documentation-authoring/SKILL.md',
		requiredSnippets: [
			'Narrow candidate constraints to the minimum hard constraints needed for the active step',
		],
	},
	{
		relativePath: 'engine-assets/skills/documentation-structure-governance/SKILL.md',
		requiredSnippets: [
			'Narrow candidate constraints to the minimum hard constraints needed for the active step',
		],
	},
	{
		relativePath: 'docs/system/adr-governance.md',
		requiredSnippets: [
			'ADRs are for key architectural, workflow-authority, trust-boundary, or long-lived contract',
		],
	},
];

(function run() {
	// Check skill files for candidate constraint governance phrase
	for (const { relativePath, requiredSnippets } of skillExpectations) {
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
