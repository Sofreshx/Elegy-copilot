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
      ],
    },
    {
      name: 'ordinary planning and review stays lightweight',
      checks: [
        {
          relativePath: 'engine-assets/prompts/instruction-engine-plan.prompt.md',
          requiredSnippets: ['Complexity alone does not justify a question barrage.'],
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
