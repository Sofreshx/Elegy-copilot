const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { validateDocGraph } = require('./validate-doc-graph');

function writeFile(root, relPath, content) {
	const absPath = path.join(root, relPath);
	fs.mkdirSync(path.dirname(absPath), { recursive: true });
	fs.writeFileSync(absPath, content);
}

function writeMirroredInstructionFixtures(root) {
	const mirroredContent = `# Stub

## Temp File Safety Controls
<a id="temp-file-safety-controls-v1"></a>
TMP-CTRL-001
TMP-CTRL-002
TMP-CTRL-003
TMP-CTRL-004
TMP-CTRL-005
TMP-CTRL-006

## CRITICAL: run_in_terminal MUST NEVER USE isBackground=true
run_in_terminal(command: "make build", isBackground: true)
run_in_terminal(command: "git commit", isBackground: true)
run_in_terminal(command: "make build", isBackground: false)
run_in_terminal(command: "git commit", isBackground: false)
ALWAYS set \`isBackground: false\` for ALL commands
NEVER use \`isBackground: true\` for ANY command
`;

	writeFile(root, 'engine-assets/copilot-instructions.md', mirroredContent);
	writeFile(root, '.github/copilot-instructions.md', mirroredContent);
}

function writeSystemIndex(root) {
	writeFile(
		root,
		'docs/system/index.md',
		`---
created: 2026-03-15
updated: 2026-03-15
category: system
status: current
doc_kind: index
id: system-docs-index
summary: Minimal system index fixture for doc-graph validation tests.
---

# System Docs Index
`
	);
}

function createFixtureRepo() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-doc-graph-'));
	writeMirroredInstructionFixtures(root);
	writeSystemIndex(root);
	return root;
}

test('validate-doc-graph allows primary and legacy repo-backed backlog docs plus roadmap docs', () => {
	const root = createFixtureRepo();

	try {
		writeFile(
			root,
			'docs/backlogs/2026-04-03-session-close.md',
			`---
created: 2026-03-15
updated: 2026-03-15
category: meta
status: current
doc_kind: node
summary: Session backlog fixture.
---

# Session Backlog
`
		);
		writeFile(
			root,
			'docs/backlog.md',
			`---
created: 2026-03-15
updated: 2026-03-15
category: meta
status: current
doc_kind: node
summary: Repository backlog fixture.
---

# Backlog
`
		);
		writeFile(
			root,
			'docs/roadmaps/platform-foundation.md',
			`---
created: 2026-03-15
updated: 2026-03-15
category: meta
status: current
doc_kind: node
summary: Roadmap fixture.
---

# Platform Foundation
`
		);

		const { errors } = validateDocGraph({ repoRoot: root });
		assert.deepStrictEqual(errors, []);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test('validate-doc-graph keeps non-planning top-level docs restricted to redirect stubs', () => {
	const root = createFixtureRepo();

	try {
		writeFile(
			root,
			'docs/notes.md',
			`---
created: 2026-03-15
updated: 2026-03-15
category: meta
status: current
doc_kind: node
summary: Non-planning top-level doc fixture.
---

# Notes
`
		);

		const { errors } = validateDocGraph({ repoRoot: root });
		assert.ok(
			errors.includes('docs/notes.md: Top-level docs/*.md must be doc_kind: redirect.'),
			'Expected non-planning top-level docs/*.md files to remain restricted to redirect stubs.'
		);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test('validate-doc-graph requires core ADR headings for docs/system/*-adr.md files', () => {
	const root = createFixtureRepo();

	try {
		writeFile(
			root,
			'docs/system/sample-adr.md',
			`---
created: 2026-03-15
updated: 2026-03-15
category: system
status: current
doc_kind: node
id: sample-adr
summary: ADR fixture.
tags: [adr]
---

# Sample ADR

## Context

Context.

## Decision

Decision.
`
		);

		const { errors } = validateDocGraph({ repoRoot: root });
		assert.ok(
			errors.includes("docs/system/sample-adr.md: ADR docs must include required heading '## Consequences'."),
			'Expected ADR docs to require Context, Decision, and Consequences headings.'
		);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test('validate-doc-graph ignores spoofed ADR headings inside fenced code blocks', () => {
	const root = createFixtureRepo();

	try {
		writeFile(
			root,
			'docs/system/sample-adr.md',
			`---
created: 2026-03-15
updated: 2026-03-15
category: system
status: current
doc_kind: node
id: sample-adr
summary: ADR fixture.
tags: [adr]
---

# Sample ADR

\`\`\`
## Context

Context.

## Decision

Decision.

## Consequences

Consequences.
\`\`\`
`
		);

		const { errors } = validateDocGraph({ repoRoot: root });
		assert.deepStrictEqual(
			errors,
			[
				"docs/system/sample-adr.md: ADR docs must include required heading '## Context'.",
				"docs/system/sample-adr.md: ADR docs must include required heading '## Decision'.",
				"docs/system/sample-adr.md: ADR docs must include required heading '## Consequences'.",
			],
			'Expected fenced-code ADR heading text to not satisfy the real heading requirement.'
		);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test('validate-doc-graph rejects docs whose updated date is before created', () => {
	const root = createFixtureRepo();

	try {
		writeFile(
			root,
			'docs/system/sample-node.md',
			`---
created: 2026-06-24
updated: 2026-05-25
category: system
status: current
doc_kind: node
id: sample-node
summary: Sample node fixture.
---

# Sample Node
`
		);

		const { errors } = validateDocGraph({ repoRoot: root });
		assert.ok(
			errors.includes('docs/system/sample-node.md: updated must be on or after created.'),
			'Expected doc frontmatter chronology validation to reject updated dates earlier than created.'
		);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test('validate-doc-graph rejects impossible ISO calendar dates', () => {
	const root = createFixtureRepo();

	try {
		writeFile(
			root,
			'docs/system/sample-node.md',
			`---
created: 2026-02-31
updated: 2026-03-01
category: system
status: current
doc_kind: node
id: sample-node
summary: Sample node fixture.
---

# Sample Node
`
		);

		const { errors } = validateDocGraph({ repoRoot: root });
		assert.ok(
			errors.includes('docs/system/sample-node.md: created must be a valid ISO date in YYYY-MM-DD format.'),
			'Expected impossible calendar dates to be rejected even when they match YYYY-MM-DD shape.'
		);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});
