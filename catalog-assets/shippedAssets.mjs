const asset = (id, type, source, extra = {}) => ({
  id,
  type,
  source,
  ...extra,
});

const agent = (id, source, extra) => asset(id, 'agent', source, extra);
const instructions = (id, source, extra) => asset(id, 'instructions', source, extra);
const prompt = (id, source, extra) => asset(id, 'prompt', source, extra);
const skill = (id, source, extra) => asset(id, 'skill', source, extra);

export const SHIPPED_ASSET_CATALOG_VERSION = 1;

export const SHIPPED_ASSETS = [
  agent('agent-code-explorer', 'engine-assets/agents/code-explorer.agent.md'),
  agent('agent-code-reviewer', 'engine-assets/agents/code-reviewer.agent.md'),
  agent('agent-deep-researcher', 'engine-assets/agents/deep-researcher.agent.md'),
  agent('agent-doc-writer', 'engine-assets/agents/doc-writer.agent.md'),
  agent('agent-execute', 'engine-assets/agents/execute.agent.md'),
  agent('agent-impl', 'engine-assets/agents/impl.agent.md'),
  agent('agent-o-planner', 'engine-assets/agents/o-planner.agent.md'),
  agent('agent-o-reframer', 'engine-assets/agents/o-reframer.agent.md'),
  agent('agent-orchestrator', 'engine-assets/agents/orchestrator.agent.md'),
  agent('agent-orchestrator-claude', 'engine-assets/agents/orchestrator-claude.agent.md'),
  agent('agent-orchestrator-claude-cli', 'engine-assets/agents/orchestrator-claude-cli.agent.md'),
  agent('agent-orchestrator-cli', 'engine-assets/agents/orchestrator-cli.agent.md'),
  agent('agent-orchestrator-gpt', 'engine-assets/agents/orchestrator-gpt.agent.md'),
  agent('agent-orchestrator-gpt-cli', 'engine-assets/agents/orchestrator-gpt-cli.agent.md'),
  agent('agent-reviewer-gpt-5-4', 'engine-assets/agents/reviewer-gpt-5-4.agent.md'),
  agent('agent-reviewer-sonnet-4-6', 'engine-assets/agents/reviewer-sonnet-4-6.agent.md'),
  agent('agent-search', 'engine-assets/agents/search.agent.md'),
  agent('agent-test-runner', 'engine-assets/agents/test-runner.agent.md'),
  instructions('copilot-instructions', 'engine-assets/copilot-instructions.md'),
  prompt('prompt-instruction-engine-fleet', 'engine-assets/prompts/instruction-engine-fleet.prompt.md'),
  prompt('prompt-instruction-engine-plan', 'engine-assets/prompts/instruction-engine-plan.prompt.md'),
  prompt('prompt-instruction-engine-review', 'engine-assets/prompts/instruction-engine-review.prompt.md', {
    governance: {
      routingClass: 'deprecated-compatibility',
      routingNote:
        'Compatibility entrypoint only; broad review should follow the canonical code-reviewer/testing-quality/validation contract rather than a separate generic checklist.',
    },
  }),
  skill('skill-agent-browser', 'engine-assets/skills/agent-browser', { loadMode: 'on-demand' }),
  skill('skill-alba-integration-tests', 'engine-assets/skills/alba-integration-tests', { loadMode: 'on-demand' }),
  skill('skill-aspire-apphost', 'engine-assets/skills/aspire-apphost', { loadMode: 'on-demand' }),
  skill('skill-aspire-deployment', 'engine-assets/skills/aspire-deployment', { loadMode: 'on-demand' }),
  skill('skill-audit-report-formats', 'engine-assets/skills/audit-report-formats', { loadMode: 'on-demand' }),
  skill('skill-auth', 'engine-assets/skills/auth', {
    loadMode: 'on-demand',
    governance: {
      routingClass: 'deprecated-compatibility',
      routingNote: 'Informational only; approved posture is explicit or compatibility-driven use.',
    },
  }),
  skill('skill-code-review', 'engine-assets/skills/code-review', {
    loadMode: 'on-demand',
    governance: {
      routingClass: 'deprecated-compatibility',
      routingNote:
        'Compatibility entrypoint only; generic review routing must inherit the canonical code-reviewer lane and current testing-quality/validation governance.',
    },
  }),
  skill('skill-core-guardrails', 'engine-assets/skills/core-guardrails', { loadMode: 'always' }),
  skill('skill-critic', 'engine-assets/skills/critic', { loadMode: 'on-demand' }),
  skill('skill-csharp-expert', 'engine-assets/skills/csharp-expert', { loadMode: 'on-demand' }),
  skill('skill-discovery', 'engine-assets/skills/skill-discovery', { loadMode: 'always' }),
  skill('skill-documentation-structure-governance', 'engine-assets/skills/documentation-structure-governance', {
    loadMode: 'on-demand',
  }),
  skill('skill-documentation-authoring', 'engine-assets/skills/documentation-authoring', { loadMode: 'on-demand' }),
  skill('skill-e2e-workflow', 'engine-assets/skills/e2e-workflow', { loadMode: 'on-demand' }),
  skill('skill-firebase-auth', 'engine-assets/skills/firebase-auth', { loadMode: 'on-demand' }),
  skill('skill-friction-feedback', 'engine-assets/skills/friction-feedback', { loadMode: 'on-demand' }),
  skill('skill-frontend', 'engine-assets/skills/frontend', { loadMode: 'on-demand' }),
  skill('skill-github-troubleshooting', 'engine-assets/skills/github-troubleshooting', { loadMode: 'on-demand' }),
  skill('skill-implementation-friction', 'engine-assets/skills/implementation-friction', { loadMode: 'always' }),
  skill('skill-instruction-quality', 'engine-assets/skills/instruction-quality', { loadMode: 'on-demand' }),
  skill('skill-logging-observability', 'engine-assets/skills/logging-observability', { loadMode: 'on-demand' }),
  skill('skill-marten-documents', 'engine-assets/skills/marten-documents', { loadMode: 'on-demand' }),
  skill('skill-marten-events', 'engine-assets/skills/marten-events', { loadMode: 'on-demand' }),
  skill('skill-marten-linq-querying', 'engine-assets/skills/marten-linq-querying', { loadMode: 'on-demand' }),
  skill('skill-microsoft-agent-framework', 'engine-assets/skills/microsoft-agent-framework', {
    loadMode: 'on-demand',
  }),
  skill('skill-openai-compatible', 'engine-assets/skills/openai-compatible', { loadMode: 'on-demand' }),
  skill('skill-orleans', 'engine-assets/skills/orleans', { loadMode: 'on-demand' }),
  skill('skill-planning-feature', 'engine-assets/skills/planning-feature', { loadMode: 'on-demand' }),
  skill('skill-planpack-authoring', 'engine-assets/skills/planpack-authoring', { loadMode: 'on-demand' }),
  skill('skill-project-guidelines', 'engine-assets/skills/project-guidelines', { loadMode: 'always' }),
  skill('skill-project-conventions-governance', 'engine-assets/skills/project-conventions-governance', {
    loadMode: 'on-demand',
  }),
  skill('skill-guidelines-authoring', 'engine-assets/skills/guidelines-authoring', { loadMode: 'on-demand' }),
  skill('skill-react-query', 'engine-assets/skills/react-query', { loadMode: 'on-demand' }),
  skill('skill-refactor', 'engine-assets/skills/refactor', {
    loadMode: 'on-demand',
    governance: {
      routingClass: 'default-handled',
      routingNote:
        'Informational only; normal routing should handle this directly unless explicit or compatibility use is needed.',
    },
  }),
  skill('skill-repo-setup-governance', 'engine-assets/skills/repo-setup-governance', { loadMode: 'on-demand' }),
  skill('skill-roadmap-authoring', 'engine-assets/skills/roadmap-authoring', { loadMode: 'on-demand' }),
  skill('skill-security', 'engine-assets/skills/security', { loadMode: 'on-demand' }),
  skill('skill-signalr', 'engine-assets/skills/signalr', { loadMode: 'on-demand' }),
  skill('skill-skill-forge', 'engine-assets/skills/skill-forge', { loadMode: 'on-demand' }),
  skill('skill-stack-audit-patterns', 'engine-assets/skills/stack-audit-patterns', { loadMode: 'on-demand' }),
  skill('skill-stack-detector', 'engine-assets/skills/stack-detector', { loadMode: 'always' }),
  skill('skill-system-cleanup', 'engine-assets/skills/system-cleanup', {
    loadMode: 'on-demand',
    governance: {
      routingClass: 'deprecated-compatibility',
      routingNote: 'Informational only; approved posture is explicit or compatibility-driven use.',
    },
  }),
  skill('skill-test-caching-verification', 'engine-assets/skills/test-caching-verification', {
    loadMode: 'on-demand',
  }),
  skill('skill-testing-dotnet-unit', 'engine-assets/skills/testing-dotnet-unit', { loadMode: 'on-demand' }),
  skill('skill-testing-frontend-unit', 'engine-assets/skills/testing-frontend-unit', {
    loadMode: 'on-demand',
  }),
  skill('skill-truth-sync', 'engine-assets/skills/truth-sync', { loadMode: 'on-demand' }),
  skill('skill-wolverine-core', 'engine-assets/skills/wolverine-core', { loadMode: 'on-demand' }),
  skill('skill-wolverine-http', 'engine-assets/skills/wolverine-http', { loadMode: 'on-demand' }),

  skill('skill-rubberduck-plan-review', 'catalog-assets/shared-skills/rubberduck-plan-review', {
    loadMode: 'on-demand',
  }),
  skill('skill-implementation-review', 'catalog-assets/shared-skills/implementation-review', {
    loadMode: 'on-demand',
  }),
  skill('skill-implementation-handoff', 'catalog-assets/shared-skills/implementation-handoff', {
    loadMode: 'on-demand',
  }),
  skill('skill-roadmap-planning', 'catalog-assets/shared-skills/roadmap-planning', {
    loadMode: 'on-demand',
  }),
  skill('skill-spec-dev', 'catalog-assets/shared-skills/spec-dev', {
    loadMode: 'on-demand',
  }),
  skill('skill-spec-authoring', 'catalog-assets/shared-skills/spec-authoring', {
    loadMode: 'on-demand',
  }),
  skill('skill-spec-review', 'catalog-assets/shared-skills/spec-review', {
    loadMode: 'on-demand',
  }),

  instructions('codex-global-instructions', 'codex-assets/home/AGENTS.md'),
  agent('codex-reviewer-agent', 'codex-assets/agents/reviewer.toml'),
  skill('codex-repo-setup-skill', 'codex-assets/skills/repo-setup'),

  instructions('opencode-global-instructions', 'opencode-assets/home/AGENTS.md'),
  agent('opencode-code-explorer-agent', 'opencode-assets/agents/code-explorer.md'),
  agent('opencode-web-searcher-agent', 'opencode-assets/agents/web-searcher.md'),
  skill('opencode-code-review-skill', 'opencode-assets/skills/code-review'),
  skill('opencode-security-skill', 'opencode-assets/skills/security'),
  skill('opencode-refactor-skill', 'opencode-assets/skills/refactor'),
  skill('opencode-project-conventions-governance-skill', 'opencode-assets/skills/project-conventions-governance'),
  skill('opencode-stack-detector-skill', 'opencode-assets/skills/stack-detector'),

  instructions('antigravity-global-instructions', 'antigravity-assets/home/GEMINI.md'),
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
      'agent-reviewer-sonnet-4-6',
      'agent-reviewer-gpt-5-4',
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
    title: 'Orchestrator Workflow Agents',
    description:
      'Repo-scoped orchestration agents and support skills for flagship model-specific entrypoints, Claude-backed reframing, lean planning, implementation, research, consolidated testing, conventions bootstrap, and orchestrator-owned closure.',
    assetIds: [
      'agent-orchestrator-claude',
      'agent-orchestrator-gpt',
      'agent-orchestrator-claude-cli',
      'agent-orchestrator-gpt-cli',
      'agent-orchestrator',
      'agent-orchestrator-cli',
      'agent-deep-researcher',
      'agent-test-runner',
      'agent-o-reframer',
      'agent-o-planner',
      'skill-planning-feature',
      'skill-planpack-authoring',
      'skill-roadmap-authoring',
      'agent-doc-writer',
      'agent-impl',
      'skill-e2e-workflow',
      'skill-project-conventions-governance',
      'skill-documentation-structure-governance',
      'skill-documentation-authoring',
      'skill-truth-sync',
      'skill-project-guidelines',
      'skill-guidelines-authoring',
      'skill-friction-feedback',
    ],
    installTarget: 'repo-local',
    activationScope: 'repo',
    materialization: 'on-demand',
    classification: 'workflow',
    targeting: {
      scopeKinds: ['repo'],
      tags: ['workflow', 'orchestration', 'planning'],
    },
    tags: ['workflow', 'orchestration', 'planning'],
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
      'skill-truth-sync',
      'skill-project-guidelines',
      'skill-guidelines-authoring',
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
      'Repo-local spec routing, authoring, and adversarial review skills for durable specs under specs/ without creating a separate planner fleet.',
    assetIds: ['skill-spec-dev', 'skill-spec-authoring', 'skill-spec-review'],
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
