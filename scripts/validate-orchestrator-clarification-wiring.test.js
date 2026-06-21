const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

const expectations = [
  {
    relativePath: 'engine-assets/prompts/elegy-copilot-plan.prompt.md',
    requiredSnippets: [
      'use `vscode/askQuestions` only for the smallest set of clarifying questions needed to unblock when the unresolved branch materially changes scope, architecture, validation, or plan safety, then revise.',
      'Use `vscode/askQuestions` rather than a plain-text end-of-plan question when a blocking clarification or explicit proceed-anyway decision is still required.',
    ],
  },
  {
    relativePath: 'engine-assets/copilot-instructions.md',
    requiredSnippets: [
      'use `vscode/askQuestions` to ask a single, targeted question through the interactive tool instead of falling back to a plain-text end-of-plan question.',
      'If a reviewer cannot approve due to missing info, use `vscode/askQuestions` to ask the smallest set of clarifying questions through the interactive tool, then keep refining everything else first.',
    ],
    forbiddenSnippets: [
      'If a reviewer cannot approve due to missing info, propose the smallest set of clarifying questions, but keep refining everything else first.',
      'planReview',
    ],
  },
  {
    relativePath: '.github/copilot-instructions.md',
    requiredSnippets: [
      'use `vscode/askQuestions` to ask a single, targeted question through the interactive tool instead of falling back to a plain-text end-of-plan question.',
      'Ask **one** targeted question via `vscode/askQuestions`.',
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
