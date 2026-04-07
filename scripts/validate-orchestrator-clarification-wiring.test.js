const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

const expectations = [
  {
    relativePath: 'engine-assets/agents/orchestrator.agent.md',
    requiredSnippets: [
      'Escalate the smallest blocking user decision via `vscode/askQuestions` only when it changes the outcome.',
    ],
  },
  {
    relativePath: 'engine-assets/prompts/instruction-engine-plan.prompt.md',
    requiredSnippets: [
      'If a reviewer returns `Verdict: BLOCKED`, use `vscode/askQuestions` to ask the smallest set of clarifying questions needed to unblock, then revise.',
      'If the plan is not 100% confident (missing info, tradeoffs, risky assumptions), use `vscode/askQuestions` to ask whether to proceed anyway rather than falling back to a plain-text end-of-plan question.',
    ],
  },
  {
    relativePath: 'engine-assets/copilot-instructions.md',
    requiredSnippets: [
      'use `vscode/askQuestions` to ask a single, targeted question through the interactive tool instead of falling back to a plain-text end-of-plan question.',
      'If a reviewer cannot approve due to missing info, use `planReview` when available and `vscode/askQuestions` otherwise to ask the smallest set of clarifying questions, then keep refining everything else first.',
    ],
    forbiddenSnippets: [
      'If a reviewer cannot approve due to missing info, propose the smallest set of clarifying questions, but keep refining everything else first.',
    ],
  },
  {
    relativePath: '.github/copilot-instructions.md',
    requiredSnippets: [
      'use `vscode/askQuestions` to ask a single, targeted question through the interactive tool instead of falling back to a plain-text end-of-plan question.',
      'Ask **one** targeted question via `vscode/askQuestions`.',
    ],
  },
  {
    relativePath: 'docs/system/orchestrator/user-guide.md',
    requiredSnippets: [
      'Answer interactive clarifications',
      'the orchestrator uses `planReview` when available and `vscode/askQuestions` otherwise.',
      'Review the plan interactively',
      'When Phase 2 needs plan approval, blocking clarification, or an explicit proceed-anyway decision, use',
      'Do not fall back to plain-text end-of-plan questions for those decisions.',
    ],
    forbiddenSnippets: [
      '2. **Answer any clarifications**: The orchestrator may ask about ambiguities.',
      '3. **Review the plan** (for non-trivial work): Approve, revise, or cancel.',
    ],
  },
];

(function run() {
  for (const { relativePath, requiredSnippets, forbiddenSnippets = [] } of expectations) {
    const absolutePath = path.join(repoRoot, relativePath);
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