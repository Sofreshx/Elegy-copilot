const asset = (id, type, source, extra = {}) => ({
  id,
  type,
  source,
  ...extra,
});

const agent = (id, source, extra) => asset(id, 'agent', source, extra);
const instructions = (id, source, extra) => asset(id, 'instructions', source, extra);
const plugin = (id, source, extra) => asset(id, 'plugin', source, extra);
const prompt = (id, source, extra) => asset(id, 'prompt', source, extra);
const skill = (id, source, extra) => asset(id, 'skill', source, extra);
const hook = (id, source, extra) => asset(id, 'hook', source, extra);

export const SHIPPED_ASSET_CATALOG_VERSION = 1;

export const SHIPPED_ASSETS = [
  agent('agent-code-explorer', 'engine-assets/agents/code-explorer.agent.md'),
  agent('agent-code-reviewer', 'engine-assets/agents/code-reviewer.agent.md'),
  agent('agent-execute', 'engine-assets/agents/execute.agent.md'),
  agent('agent-impl', 'engine-assets/agents/impl.agent.md'),
  agent('agent-search', 'engine-assets/agents/search.agent.md'),
  agent('agent-test-runner', 'engine-assets/agents/test-runner.agent.md'),
  instructions('copilot-instructions', 'catalog-assets/instructions/agent-session-defaults.md', {
    appendix: 'engine-assets/copilot-instructions-appendix.md',
  }),
  prompt('prompt-instruction-engine-plan', 'engine-assets/prompts/instruction-engine-plan.prompt.md'),

  skill('skill-core-guardrails', 'engine-assets/skills/core-guardrails', { loadMode: 'always' }),
  skill('skill-discovery', 'engine-assets/skills/skill-discovery', { loadMode: 'always' }),
  skill('skill-documentation-authoring', 'engine-assets/skills/documentation-authoring', { loadMode: 'on-demand' }),
  skill('skill-documentation-structure-governance', 'engine-assets/skills/documentation-structure-governance', {
    loadMode: 'on-demand',
  }),
  skill('skill-project-conventions-governance', 'engine-assets/skills/project-conventions-governance', {
    loadMode: 'on-demand',
  }),
  skill('skill-repo-setup-governance', 'engine-assets/skills/repo-setup-governance', { loadMode: 'on-demand' }),
  skill('skill-roadmap-authoring', 'engine-assets/skills/roadmap-authoring', { loadMode: 'always' }),
  skill('skill-security', 'engine-assets/skills/security', { loadMode: 'on-demand' }),
  skill('skill-elegy-planning', 'catalog-assets/shared-skills/elegy-planning', { loadMode: 'always' }),
  skill('skill-elegy-skills-discovery', 'catalog-assets/shared-skills/elegy-skills-discovery', {
    loadMode: 'always',
  }),
  skill('skill-elegy-obsidian', 'catalog-assets/shared-skills/elegy-obsidian', { loadMode: 'on-demand' }),
  skill('skill-repo-backed-obsidian-docs', 'catalog-assets/shared-skills/repo-backed-obsidian-docs', { loadMode: 'on-demand' }),
  skill('skill-commit-check-setup', 'engine-assets/skills/commit-check-setup', { loadMode: 'on-demand' }),
  skill('skill-commit-validation-governance', 'engine-assets/skills/commit-validation-governance', {
    loadMode: 'on-demand',
  }),
  hook('hook-worktree-session-tracker', 'engine-assets/hooks/worktree-session-tracker/hook.md'),
  hook('hook-session-lifecycle', 'engine-assets/hooks/session-lifecycle/hook.md'),
  skill('skill-implementation-handoff', 'catalog-assets/shared-skills/implementation-handoff', {
    loadMode: 'on-demand',
  }),
  skill('skill-implementation-review', 'catalog-assets/shared-skills/implementation-review', {
    loadMode: 'on-demand',
  }),
  skill('skill-rubberduck-plan-review', 'catalog-assets/shared-skills/rubberduck-plan-review', {
    loadMode: 'on-demand',
  }),
  skill('skill-spec-authoring', 'catalog-assets/shared-skills/spec-authoring', { loadMode: 'on-demand' }),
  skill('skill-spec-dev', 'catalog-assets/shared-skills/spec-dev', { loadMode: 'on-demand' }),
  skill('skill-spec-review', 'catalog-assets/shared-skills/spec-review', { loadMode: 'on-demand' }),
  skill('skill-spec-planning-bridge', 'catalog-assets/shared-skills/spec-planning-bridge', { loadMode: 'on-demand' }),
  skill('skill-ui-runtime-exploration', 'engine-assets/skills/ui-runtime-exploration', {
    loadMode: 'on-demand',
  }),
  skill('skill-ui-system', 'catalog-assets/shared-skills/ui-system', { loadMode: 'on-demand' }),
  skill('skill-skill-authoring', 'catalog-assets/shared-skills/skill-authoring', { loadMode: 'on-demand' }),
  skill('skill-agents-md-authoring', 'catalog-assets/shared-skills/agents-md-authoring', { loadMode: 'on-demand' }),

  instructions('codex-global-instructions', 'catalog-assets/instructions/agent-session-defaults.md', {
    appendix: 'codex-assets/home/AGENTS-appendix.md',
  }),
  agent('codex-reviewer-agent', 'codex-assets/agents/reviewer.toml'),
  skill('codex-repo-setup-skill', 'codex-assets/skills/repo-setup'),

  instructions('opencode-global-instructions', 'catalog-assets/instructions/agent-session-defaults.md', {
    appendix: 'opencode-assets/home/AGENTS-appendix.md',
  }),
  skill('opencode-code-review-skill', 'opencode-assets/skills/code-review'),
  skill('opencode-project-conventions-governance-skill', 'engine-assets/skills/project-conventions-governance'),
  skill('opencode-security-skill', 'engine-assets/skills/security'),
  skill('opencode-worktree-skill', 'opencode-assets/skills/worktree'),
  skill('opencode-project-workflow-skill', 'opencode-assets/skills/project-workflow'),
  skill('opencode-runner-workflow-skill', 'opencode-assets/skills/runner-workflow'),
  plugin('opencode-worktree-plugin', 'opencode-assets/plugins/worktree.js'),

  // OpenCode native agents
  agent('opencode-agent-quick', 'opencode-assets/agents/quick.md'),
  agent('opencode-agent-project', 'opencode-assets/agents/project.md'),
  agent('opencode-agent-runner', 'opencode-assets/agents/runner.md'),
  agent('opencode-agent-runner-flash', 'opencode-assets/agents/runner-flash.md'),
  agent('opencode-agent-impl', 'opencode-assets/agents/impl.md'),
  agent('opencode-agent-impl-pro', 'opencode-assets/agents/impl-pro.md'),
  agent('opencode-agent-reviewer', 'opencode-assets/agents/reviewer.md'),
  agent('opencode-agent-explorer', 'opencode-assets/agents/explorer.md'),
  agent('opencode-agent-scout', 'opencode-assets/agents/scout.md'),
  agent('notes-enhance', 'opencode-assets/agents/notes-enhance.md'),
  agent('notes-reexamine', 'opencode-assets/agents/notes-reexamine.md'),
  agent('notes-research', 'opencode-assets/agents/notes-research.md'),
  agent('notes-deduplicate', 'opencode-assets/agents/notes-deduplicate.md'),
  // OpenCode plugins and skills
  plugin('opencode-plugins-package-json', 'opencode-assets/plugins/package.json'),
  plugin('opencode-planning-plugin', 'opencode-assets/plugins/planning.js'),
  plugin('opencode-notify-plugin', 'opencode-assets/plugins/notify.js'),
  skill('opencode-planning-tools-skill', 'opencode-assets/skills/planning-tools'),
  skill('opencode-planning-tools-read-skill', 'opencode-assets/skills/planning-tools-read'),
  skill('opencode-planning-tools-write-skill', 'opencode-assets/skills/planning-tools-write'),
  skill('opencode-planning-tools-run-skill', 'opencode-assets/skills/planning-tools-run'),

  instructions('antigravity-global-instructions', 'catalog-assets/instructions/agent-session-defaults.md', {
    appendix: 'antigravity-assets/home/GEMINI-appendix.md',
  }),
];

export const SHIPPED_BUNDLES = [
  {
    id: 'core-global',
    title: 'Core Global Agents',
    description: 'Broadly useful global agents for search, execution, and review.',
    assetIds: [
      'agent-search',
      'agent-execute',
      'agent-code-explorer',
      'agent-code-reviewer',
    ],
    installTarget: 'user-global',
    activationScope: 'global',
    materialization: 'always',
    classification: 'core',
    targeting: {
      tags: ['core', 'global', 'search', 'review'],
    },
    tags: ['core', 'global', 'search', 'review'],
    defaultRecommended: true,
    dependsOn: [],
  },
  {
    id: 'repo-setup-governance-global',
    title: 'Repo Setup Governance Skill',
    description: 'Shared repo-setup governance guidance kept as an on-demand skill rather than a dedicated agent lane.',
    assetIds: ['skill-repo-setup-governance'],
    installTarget: 'user-global',
    activationScope: 'global',
    materialization: 'on-demand',
    classification: 'workflow',
    targeting: {
      tags: ['repo-setup', 'governance', 'audit', 'workspace'],
    },
    tags: ['repo-setup', 'governance', 'audit', 'workspace'],
    defaultRecommended: false,
    dependsOn: [],
  },
  {
    id: 'orchestrator-workflow',
    title: 'Implementation Workflow Agents',
    description: 'Repo-scoped implementation agents and support skills for execution, testing, and governance.',
    assetIds: [
      'agent-test-runner',
      'agent-impl',
      'skill-roadmap-authoring',
      'skill-project-conventions-governance',
      'skill-documentation-structure-governance',
      'skill-documentation-authoring',
      'skill-skill-authoring',
      'skill-agents-md-authoring',
    ],
    installTarget: 'repo-local',
    activationScope: 'repo',
    materialization: 'on-demand',
    classification: 'workflow',
    targeting: {
      scopeKinds: ['repo'],
      tags: ['workflow', 'implementation'],
    },
    tags: ['workflow', 'implementation'],
    defaultRecommended: false,
    dependsOn: ['core-global'],
  },
  {
    id: 'roadmap-planning-lane',
    title: 'Repository Backlog & Roadmap Skills',
    description:
      'Repo-local planning guidance for per-session Repository Backlog artifacts and roadmap authoring without separate planner agents.',
    assetIds: ['skill-roadmap-authoring'],
    installTarget: 'repo-local',
    activationScope: 'repo',
    materialization: 'on-demand',
    classification: 'workflow',
    targeting: {
      scopeKinds: ['repo'],
      tags: ['planning', 'roadmap', 'backlog', 'instruction-engine'],
    },
    tags: ['planning', 'roadmap', 'backlog', 'instruction-engine'],
    defaultRecommended: false,
    dependsOn: ['orchestrator-workflow'],
  },
  {
    id: 'instruction-engine-governance-lanes',
    title: 'Instruction-Engine Governance Skills',
    description:
      'Repo-local governance and conventions/bootstrap skills for instruction-engine-first workflows. Explicit opt-in keeps default routing curated.',
    assetIds: [
      'skill-project-conventions-governance',
      'skill-documentation-structure-governance',
      'skill-documentation-authoring',
      'skill-skill-authoring',
      'skill-agents-md-authoring',
    ],
    installTarget: 'repo-local',
    activationScope: 'repo',
    materialization: 'on-demand',
    classification: 'scope',
    targeting: {
      scopeKinds: ['repo'],
      tags: ['instruction-engine', 'governance', 'review', 'follow-up'],
    },
    tags: ['instruction-engine', 'governance', 'review', 'follow-up'],
    defaultRecommended: false,
    dependsOn: ['orchestrator-workflow'],
  },
  {
    id: 'spec-driven-development-lane',
    title: 'Spec-Driven Development Skills',
    description:
      'Repo-local spec routing, authoring, adversarial review, and planning handoff skills for durable specs under docs/specs/ without creating a separate planner fleet.',
    assetIds: ['skill-spec-dev', 'skill-spec-authoring', 'skill-spec-review', 'skill-spec-planning-bridge'],
    installTarget: 'repo-local',
    activationScope: 'repo',
    materialization: 'on-demand',
    classification: 'workflow',
    targeting: {
      scopeKinds: ['repo'],
      tags: ['specs', 'requirements', 'design', 'validation'],
    },
    tags: ['specs', 'requirements', 'design', 'validation'],
    defaultRecommended: false,
    dependsOn: ['orchestrator-workflow'],
  },
  {
    id: 'commit-validation-governance',
    title: 'Commit Validation & Governance Skills',
    description: 'Commit check setup and governance validation skills for enforcing commit policies.',
    assetIds: ['skill-commit-validation-governance', 'skill-commit-check-setup'],
    installTarget: 'repo-local',
    activationScope: 'repo',
    materialization: 'on-demand',
    classification: 'workflow',
    targeting: {
      scopeKinds: ['repo'],
      tags: ['commit', 'validation', 'governance'],
    },
    tags: ['commit', 'validation', 'governance'],
    defaultRecommended: false,
    dependsOn: [],
  },
  {
    id: 'ui-runtime-validation',
    title: 'UI Runtime Validation Skills',
    description: 'Browser and desktop UI validation routing: Playwright for browser-mode regression, agent browser for AI investigation, tauri-driver plus WebDriver client for real Tauri desktop behavior, and cargo test plus Tauri mock runtime for Rust commands.',
    assetIds: ['skill-ui-runtime-exploration'],
    installTarget: 'repo-local',
    activationScope: 'repo',
    materialization: 'on-demand',
    classification: 'workflow',
    targeting: {
      scopeKinds: ['repo'],
      tags: ['ui', 'testing', 'e2e', 'browser', 'tauri', 'desktop'],
    },
    tags: ['ui', 'testing', 'e2e', 'browser', 'tauri', 'desktop'],
    defaultRecommended: false,
    dependsOn: [],
  },
];

export const SHIPPED_ASSET_CATALOG = {
  schemaVersion: SHIPPED_ASSET_CATALOG_VERSION,
  assets: SHIPPED_ASSETS,
  bundles: SHIPPED_BUNDLES,
};

const shippedAssetById = new Map(SHIPPED_ASSETS.map((entry) => [entry.id, entry]));
const shippedBundleById = new Map(SHIPPED_BUNDLES.map((entry) => [entry.id, entry]));

export function getShippedAsset(assetId) {
  return shippedAssetById.get(String(assetId || '').trim()) || null;
}

export function getShippedBundle(bundleId) {
  return shippedBundleById.get(String(bundleId || '').trim()) || null;
}
