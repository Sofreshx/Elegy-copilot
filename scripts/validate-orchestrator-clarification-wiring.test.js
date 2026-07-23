const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

const expectations = [
  {
    relativePath: 'engine-assets/prompts/elegy-copilot-plan.prompt.md',
    requiredSnippets: [
      'use `vscode/askQuestions` only for the smallest set of clarifying questions needed to unblock when the unresolved branch materially changes scope, architecture, validation, or plan safety, then revise.',
    ],
  },
  {
    relativePath: 'catalog-assets/instructions/agent-session-defaults.md',
    requiredSnippets: [
      '## Clarification Contract',
      'Never implement through ambiguity.',
      'Investigate discoverable facts first.',
    ],
  },
];

(function run() {
  for (const { relativePath, requiredSnippets, forbiddenSnippets = [] } of expectations) {
    const absolutePath = path.join(repoRoot, relativePath);
    if (!fs.existsSync(absolutePath)) {
      console.log(`skipping ${relativePath} (file not found)`);
      continue;
    }
    const content = fs.readFileSync(absolutePath, 'utf8');
    for (const snippet of requiredSnippets) {
      assert.ok(content.includes(snippet), `expected ${relativePath} to include: ${snippet}`);
    }
    for (const snippet of forbiddenSnippets) {
      assert.ok(!content.includes(snippet), `expected ${relativePath} to exclude: ${snippet}`);
    }
  }

  console.log('orchestrator clarification wiring text checks passed');
})();
