const route = (assetId, extra = {}) => ({
  assetId,
  ...extra,
});

export const TARGET_ROUTING_SCHEMA_VERSION = 1;

export const SHARED_G05_GOVERNANCE = {
  g05: {
    schemaVersion: '1.0.0',
    requiredControls: {
      early: [
        { id: 'safetyTokenParity', owner: 'Security Engineering' },
        { id: 'hookEnforcement', owner: 'Platform Engineering' },
        { id: 'telemetrySchemaValidation', owner: 'Observability Engineering' },
      ],
      final: [
        { id: 'evidencePredicates', owner: 'Release Engineering' },
        { id: 'finalGateWaiverPrecedence', owner: 'Security Engineering' },
        { id: 'trustedEvidenceBindingRetention', owner: 'Release Engineering' },
      ],
    },
  },
};

export const CLI_MANDATORY_ALLOWLIST_ITEMS = Object.freeze({
  agents: [],
  skills: ['core-guardrails'],
  prompts: [],
});

const ENGINE_ASSET_ROUTES = [
  route('agent-code-explorer'),
  route('agent-code-reviewer'),
  route('agent-execute'),
  route('agent-impl'),
  route('agent-search'),
  route('agent-test-runner'),
  route('hook-session-lifecycle'),
  route('hook-worktree-session-tracker'),
  route('copilot-instructions'),
  route('prompt-instruction-engine-plan'),
  route('skill-core-guardrails'),
  route('skill-discovery'),
  route('skill-documentation-authoring'),
  route('skill-documentation-structure-governance'),
  route('skill-guidelines-authoring'),
  route('skill-implementation-handoff'),
  route('skill-implementation-review'),
  route('skill-project-conventions-governance'),
  route('skill-project-guidelines'),
  route('skill-repo-setup-governance'),
  route('skill-roadmap-authoring'),
  route('skill-rubberduck-plan-review'),
  route('skill-security'),
  route('skill-spec-authoring'),
  route('skill-spec-dev'),
  route('skill-spec-review'),
  route('skill-spec-planning-bridge'),
  route('skill-ui-runtime-exploration'),
  route('skill-ui-system'),
  route('skill-commit-check-setup'),
  route('skill-commit-validation-governance'),
];

export const COMPATIBILITY_MANIFESTS = [
  {
    manifestId: 'engine',
    outputPath: 'engine-assets/manifest.json',
    package: {
      name: 'instruction-engine',
      version: '0.1.0',
      sourceCommitSha: '<REPLACE_WITH_GIT_SHA>',
    },
    installDefaults: {
      elegyHome: '~/.elegy',
      description:
        'Repo-scoped implementation agents and support skills for execution, testing, conventions bootstrap, and closure.',
      skillsDir: '~/.elegy/skills',
      promptsDir: '~/.elegy/prompts',
      instructionsFile: '~/.elegy/copilot-instructions.md',
    },
    installerHints: {
      preferExplicitDestinations: true,
      agentsAreFlat: true,
      skillsRequireFolderName: true,
      notes:
        'If the installer flattens source folders, it should still write files using each asset.destination path.',
    },
    skillPointer: {
      enabled: true,
      schemaVersion: 1,
      vaultDir: 'skills-vault',
      loadModes: {
        always: 'Installed to skills/ (Elegy scans and loads into context). Reserved for meta-skills and transversal skills.',
        'on-demand':
          'Installed to skills-vault/ only (NOT scanned by Elegy). Discovered via skill-discovery pattern. Default for domain-specific skills.',
      },
      notes:
        "When enabled, 'always' skills install full content to skills/. 'on-demand' skills install ONLY to skills-vault/ - no pointer stub in skills/. Agents use the skill-discovery skill to find and load on-demand skills at runtime.",
    },
    governance: SHARED_G05_GOVERNANCE,
    assetRoutes: ENGINE_ASSET_ROUTES,
    bundleIds: [
      'commit-validation-governance',
      'core-global',
      'instruction-engine-governance-lanes',
      'orchestrator-workflow',
      'repo-setup-governance-global',
      'roadmap-planning-lane',
      'spec-driven-development-lane',
      'ui-runtime-validation',
    ],
  },
  {
    manifestId: 'cli',
    outputPath: '.cli/manifest.json',
    package: {
      name: 'elegy-copilot',
      version: '0.1.0',
      sourceCommitSha: '<REPLACE_WITH_GIT_SHA>',
    },
    installDefaults: {
      elegyHome: '~/.elegy',
      agentsDir: '~/.elegy/agents',
      skillsDir: '~/.elegy/skills',
      promptsDir: '~/.elegy/prompts',
      instructionsFile: '~/.elegy/copilot-instructions.md',
    },
    installerHints: {
      preferExplicitDestinations: true,
      agentsAreFlat: true,
      skillsRequireFolderName: true,
      notes:
        'If the installer flattens source folders, it should still write files using each asset.destination path.',
    },
    governance: SHARED_G05_GOVERNANCE,
    inheritRoutesFromManifestId: 'engine',
    bundleIds: [
      'core-global',
      'repo-setup-governance-global',
      'orchestrator-workflow',
      'roadmap-planning-lane',
      'instruction-engine-governance-lanes',
      'spec-driven-development-lane',
    ],
    allowlistPath: '.cli/manifest.allowlist.json',
    mandatoryAllowlistItems: CLI_MANDATORY_ALLOWLIST_ITEMS,
    useAllowlist: true,
    sortAssets: 'type-id',
  },
  {
    manifestId: 'codex',
    outputPath: 'codex-assets/manifest.json',
    package: {
      name: 'instruction-engine-codex',
      version: '0.1.0',
      sourceCommitSha: '<REPLACE_WITH_GIT_SHA>',
    },
    installDefaults: {
      codexHome: '~/.codex',
      agentsDir: '~/.codex/agents',
      skillsDir: '~/.codex/skills',
      instructionsFile: '~/.codex/AGENTS.md',
      configFile: '~/.codex/config.toml',
      description: 'Home-installed Codex session assets for planning-first work, review, and minimal repository setup.',
    },
    installerHints: {
      preferExplicitDestinations: true,
      agentsAreFlat: true,
      skillsRequireFolderName: true,
      notes:
        'Install only Codex-native home instructions, a read-only reviewer agent, and the repo-setup skill under ~/.codex, then patch ~/.codex/config.toml conservatively. Do not bulk-install Copilot/engine assets into Codex.',
    },
    governance: SHARED_G05_GOVERNANCE,
    assetRoutes: [
      route('codex-global-instructions'),
      route('codex-reviewer-agent'),
      route('codex-repo-setup-skill'),
      route('codex-skill-discovery-skill', { sourceAssetId: 'skill-discovery' }),
      route('codex-rubberduck-plan-review-skill', { sourceAssetId: 'skill-rubberduck-plan-review' }),
      route('codex-implementation-review-skill', { sourceAssetId: 'skill-implementation-review' }),
      route('codex-implementation-handoff-skill', { sourceAssetId: 'skill-implementation-handoff' }),
      route('codex-spec-dev-skill', { sourceAssetId: 'skill-spec-dev' }),
      route('codex-spec-authoring-skill', { sourceAssetId: 'skill-spec-authoring' }),
      route('codex-spec-review-skill', { sourceAssetId: 'skill-spec-review' }),
      route('codex-spec-planning-bridge-skill', { sourceAssetId: 'skill-spec-planning-bridge' }),
      route('codex-elegy-planning-skill', { sourceAssetId: 'skill-elegy-planning' }),
      route('codex-repo-backed-obsidian-docs-skill', { sourceAssetId: 'skill-repo-backed-obsidian-docs' }),
      route('codex-ui-system-skill', { sourceAssetId: 'skill-ui-system' }),
      route('codex-commit-check-setup-skill', { sourceAssetId: 'skill-commit-check-setup' }),
    ],
  },
  {
    manifestId: 'opencode',
    outputPath: 'opencode-assets/manifest.json',
    package: {
      name: 'instruction-engine-opencode',
      version: '0.1.0',
      sourceCommitSha: '<REPLACE_WITH_GIT_SHA>',
    },
    installDefaults: {
      opencodeHome: '~/.config/opencode',
      agentsDir: '~/.config/opencode/agents',
      skillsDir: '~/.config/opencode/skills',
      instructionsFile: '~/.config/opencode/AGENTS.md',
      description:
        "Native-first OpenCode instructions plus curated planning, roadmap, review, security, and governance skills. Kept intentionally minimal to complement OpenCode's built-in harness.",
    },
    governance: SHARED_G05_GOVERNANCE,
    assetRoutes: [
      route('opencode-agent-explorer'),
      route('opencode-agent-impl'),
      route('opencode-agent-project'),
      route('opencode-agent-quick'),
      route('opencode-agent-reviewer'),
      route('opencode-agent-scout'),
      route('notes-enhance'),
      route('notes-reexamine'),
      route('notes-research'),
      route('notes-deduplicate'),
      route('opencode-code-review-skill'),
      route('opencode-commit-check-setup-skill', { sourceAssetId: 'skill-commit-check-setup' }),
      route('opencode-elegy-obsidian-skill', { sourceAssetId: 'skill-elegy-obsidian' }),
      route('opencode-elegy-planning-skill', { sourceAssetId: 'skill-elegy-planning' }),
      route('opencode-elegy-skills-discovery-skill', { sourceAssetId: 'skill-elegy-skills-discovery' }),
      route('opencode-global-instructions', { destination: 'AGENTS.md' }),
      route('opencode-implementation-handoff-skill', { sourceAssetId: 'skill-implementation-handoff' }),
      route('opencode-implementation-review-skill', { sourceAssetId: 'skill-implementation-review' }),
      route('opencode-planning-plugin'),
      route('opencode-planning-tools-skill'),
      route('opencode-plugins-package-json'),
      route('opencode-notify-plugin'),
      route('opencode-project-conventions-governance-skill'),
      route('opencode-repo-backed-obsidian-docs-skill', { sourceAssetId: 'skill-repo-backed-obsidian-docs' }),
      route('opencode-rubberduck-plan-review-skill', { sourceAssetId: 'skill-rubberduck-plan-review' }),
      route('opencode-security-skill'),
      route('opencode-skill-discovery-skill', { sourceAssetId: 'skill-discovery' }),
      route('opencode-spec-authoring-skill', { sourceAssetId: 'skill-spec-authoring' }),
      route('opencode-spec-dev-skill', { sourceAssetId: 'skill-spec-dev' }),
      route('opencode-spec-review-skill', { sourceAssetId: 'skill-spec-review' }),
      route('opencode-spec-planning-bridge-skill', { sourceAssetId: 'skill-spec-planning-bridge' }),
      route('opencode-ui-system-skill', { sourceAssetId: 'skill-ui-system' }),
      route('opencode-worktree-plugin', { destination: 'plugins/worktree.js' }),
      route('opencode-worktree-skill'),
      route('opencode-project-workflow-skill'),
    ],
  },
  {
    manifestId: 'antigravity',
    outputPath: 'antigravity-assets/manifest.json',
    package: {
      name: 'instruction-engine-antigravity',
      version: '0.1.0',
      sourceCommitSha: '<REPLACE_WITH_GIT_SHA>',
    },
    installDefaults: {
      geminiHome: '~/.gemini',
      antigravityHome: '~/.gemini/antigravity',
      skillsDir: '~/.gemini/antigravity/skills',
      instructionsFile: '~/.gemini/GEMINI.md',
      description:
        'Home-installed Antigravity 2 / Antigravity CLI assets using the current Gemini-compatible layout for shared skills plus a bounded instruction-engine block in GEMINI.md.',
    },
    installerHints: {
      preferExplicitDestinations: true,
      skillsRequireFolderName: true,
      notes:
        'Install shared skills under ~/.gemini/antigravity/skills and manage only the instruction-engine block inside the current Gemini-compatible ~/.gemini/GEMINI.md layout.',
    },
    governance: SHARED_G05_GOVERNANCE,
    assetRoutes: [
      route('antigravity-global-instructions'),
      route('antigravity-skill-discovery-skill', {
        sourceAssetId: 'skill-discovery',
        destination: 'antigravity/skills/skill-discovery',
      }),
      route('antigravity-rubberduck-plan-review-skill', {
        sourceAssetId: 'skill-rubberduck-plan-review',
        destination: 'antigravity/skills/rubberduck-plan-review',
      }),
      route('antigravity-implementation-review-skill', {
        sourceAssetId: 'skill-implementation-review',
        destination: 'antigravity/skills/implementation-review',
      }),
      route('antigravity-implementation-handoff-skill', {
        sourceAssetId: 'skill-implementation-handoff',
        destination: 'antigravity/skills/implementation-handoff',
      }),
      route('antigravity-spec-dev-skill', {
        sourceAssetId: 'skill-spec-dev',
        destination: 'antigravity/skills/spec-dev',
      }),
      route('antigravity-spec-authoring-skill', {
        sourceAssetId: 'skill-spec-authoring',
        destination: 'antigravity/skills/spec-authoring',
      }),
      route('antigravity-spec-review-skill', {
        sourceAssetId: 'skill-spec-review',
        destination: 'antigravity/skills/spec-review',
      }),
      route('antigravity-spec-planning-bridge-skill', {
        sourceAssetId: 'skill-spec-planning-bridge',
        destination: 'antigravity/skills/spec-planning-bridge',
      }),
      route('antigravity-commit-check-setup-skill', {
        sourceAssetId: 'skill-commit-check-setup',
        destination: 'antigravity/skills/commit-check-setup',
      }),
    ],
  },
  // claude-assets/manifest.json is maintained separately (not generated from targetRouting).
  // claude-commit-check-setup-skill must be added manually to claude-assets/manifest.json
  // when syncing new skills. See that file for the current entry.
];
