const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

const expectations = [
  {
    relativePath: 'engine-assets/agents/o-reframer.agent.md',
    requiredSnippets: [
      'List only outcome-changing unknowns in `ambiguities`; branches deterministically answerable from the supplied context, canonical docs, or repo evidence do not belong there.',
      'Hard no-activate states for deeper/deep-grill behavior: `planning_surface: none`, `planning_surface: roadmap`, `execution_readiness: not-ready`.',
    ],
  },
  {
    relativePath: 'engine-assets/agents/orchestrator.agent.md',
    requiredSnippets: [
      'Escalate the smallest blocking user decision via `vscode/askQuestions` only for outcome-changing unknowns that affect scope, architecture, validation, verdict, or proceed-anyway posture.',
      'Complexity alone does not justify auto-escalating into deeper/deep-grill behavior.',
    ],
  },
  {
    relativePath: 'engine-assets/prompts/instruction-engine-plan.prompt.md',
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
  {
    relativePath: 'docs/system/orchestrator/user-guide.md',
    requiredSnippets: [
      'Answer interactive clarifications',
      'the orchestrator uses `vscode/askQuestions` through the interactive flow.',
      'Review the plan interactively',
      'When Phase 2 needs plan approval, blocking clarification, or an explicit proceed-anyway decision, use',
      '`vscode/askQuestions` through the interactive flow.',
      'Do not fall back to plain-text end-of-plan questions for those decisions.',
    ],
    forbiddenSnippets: [
      '2. **Answer any clarifications**: The orchestrator may ask about ambiguities.',
      '3. **Review the plan** (for non-trivial work): Approve, revise, or cancel.',
      'planReview',
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
