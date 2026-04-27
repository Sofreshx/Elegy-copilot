const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function assertIncludes(relativePath, snippets) {
  const content = read(relativePath);
  for (const snippet of snippets) {
    assert.ok(content.includes(snippet), `expected ${relativePath} to include: ${snippet}`);
  }
}

(function run() {
  const scenarios = [
    {
      name: 'deep/grill overlay stays off for non-plan-pack or not-ready routes',
      checks: [
        {
          relativePath: 'docs/system/calibrated-questioning-and-depth-governance.md',
          requiredSnippets: [
            'Hard no-activate states for deep/grill overlay behavior:',
            '- `planning_surface: none`',
            '- `planning_surface: roadmap`',
            '- `execution_readiness: not-ready`',
            'When any hard no-activate state applies, use the default questioning ladder and the existing route outcome. Do not manufacture a deeper planning or review mode.',
          ],
        },
        {
          relativePath: 'engine-assets/agents/o-planner.agent.md',
          requiredSnippets: [
            'Hard no-activate states for deeper/deep-grill style planning behavior: `planning_surface: none`, `planning_surface: roadmap`, and `execution_readiness: not-ready`.',
            'In those states, use the default evidence-bound ladder and keep the existing blocked or non-plan-pack route outcome.',
          ],
        },
      ],
    },
    {
      name: 'ordinary planning and review stays lightweight',
      checks: [
        {
          relativePath: 'engine-assets/prompts/instruction-engine-plan.prompt.md',
          requiredSnippets: ['Complexity alone does not justify a question barrage.'],
        },
        {
          relativePath: 'engine-assets/agents/reviewer-sonnet-4-6.agent.md',
          requiredSnippets: ['Complexity alone does not justify a question barrage.'],
        },
        {
          relativePath: 'engine-assets/agents/reviewer-gpt-5-4.agent.md',
          requiredSnippets: ['Complexity alone does not justify a question barrage.'],
        },
      ],
    },
    {
      name: 'CLI orchestrators inherit calibrated questioning without bypass',
      checks: [
        {
          relativePath: 'engine-assets/agents/orchestrator-cli.agent.md',
          requiredSnippets: [
            '`docs/system/calibrated-questioning-and-depth-governance.md`',
            'Rubber Duck review inherits `docs/system/calibrated-questioning-and-depth-governance.md` for the evidence-bound questioning ladder and route-first depth policy; it does not create a CLI-only review mode.',
            'Rubber Duck support does not authorize deeper/deep-grill behavior or bypass outcome-changing clarification through `vscode/askQuestions`.',
          ],
        },
        {
          relativePath: 'engine-assets/agents/orchestrator-gpt-cli.agent.md',
          requiredSnippets: [
            '`docs/system/calibrated-questioning-and-depth-governance.md`',
            'Model strengths can shape handling only after the route and calibrated questioning contract are fixed; they do not authorize deeper/deep-grill behavior by themselves.',
          ],
        },
        {
          relativePath: 'engine-assets/agents/orchestrator-claude-cli.agent.md',
          requiredSnippets: [
            '`docs/system/calibrated-questioning-and-depth-governance.md`',
            'Model strengths can shape handling only after the route and calibrated questioning contract are fixed; they do not authorize deeper/deep-grill behavior by themselves.',
          ],
        },
      ],
    },
  ];

  for (const { name, checks } of scenarios) {
    for (const { relativePath, requiredSnippets } of checks) {
      assertIncludes(relativePath, requiredSnippets);
    }
    console.log(`validated ${name}`);
  }

  console.log('calibrated questioning routing checks passed');
})();