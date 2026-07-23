export const COMMIT_CHECK_CONFIG_SCHEMA_VERSION = 3;
export const COMMIT_CHECK_DISCOVERY_SCHEMA_VERSION = 1;

export const DEFAULT_COMMIT_CHECK_CONFIG = Object.freeze({
  threshold: 70,
  weights: Object.freeze({
    test: 0.30,
    lint: 0.20,
    format: 0.10,
    stylelint: 0.05,
    typecheck: 0.25,
    'build-contracts': 0.05,
    'build-ui': 0.05,
    'docs-pages': 0.05,
  }),
  gates: Object.freeze([]),
  defaultProfile: 'commit',
  profiles: Object.freeze({
    commit: Object.freeze({
      label: 'Commit',
      description: 'Fast mandatory local gate',
      cost: 'fast',
      opensWindow: false,
    }),
    push: Object.freeze({
      label: 'Push',
      description: 'Pre-push checks - test + typecheck',
      cost: 'medium',
      opensWindow: false,
    }),
    'ci-local': Object.freeze({
      label: 'CI Local',
      description: 'Full local CI parity gate',
      cost: 'medium',
      opensWindow: false,
    }),
    'desktop-preview': Object.freeze({
      label: 'Desktop Preview',
      description: 'Packaged runtime/build validation, skippable with reason',
      cost: 'medium',
      opensWindow: false,
    }),
    release: Object.freeze({
      label: 'Release',
      description: 'Release/native smoke validation, on-demand or CI by default',
      cost: 'heavy',
      opensWindow: true,
    }),
  }),
  groups: Object.freeze({
    commit: Object.freeze({ description: 'Pre-commit checks - must pass before committing' }),
    push: Object.freeze({ description: 'Pre-push checks - must pass before pushing' }),
    ci: Object.freeze({ description: 'CI-equivalent checks - mirrors GitHub required workflows' }),
    release: Object.freeze({ description: 'Full release blockers - heavy checks reserved for CI/release' }),
  }),
});

const DEFAULT_LANE_METADATA = Object.freeze({
  test: Object.freeze({
    group: 'push',
    description: 'Run all workspace tests',
    timeoutMs: 120000,
    blocking: true,
    required: true,
    skippable: false,
    requiresReasonOnSkip: false,
    defaultProfiles: Object.freeze(['push']),
    cost: 'medium',
    opensWindow: false,
  }),
  lint: Object.freeze({
    group: 'commit',
    description: 'Lint all source code',
    timeoutMs: 60000,
    blocking: true,
    required: true,
    skippable: false,
    requiresReasonOnSkip: false,
    defaultProfiles: Object.freeze(['commit']),
    cost: 'fast',
    opensWindow: false,
  }),
  format: Object.freeze({
    group: 'commit',
    description: 'Check code formatting',
    timeoutMs: 60000,
    blocking: true,
    required: true,
    skippable: false,
    requiresReasonOnSkip: false,
    defaultProfiles: Object.freeze(['commit']),
    cost: 'fast',
    opensWindow: false,
  }),
  typecheck: Object.freeze({
    group: 'commit',
    description: 'Type-check source code',
    timeoutMs: 60000,
    blocking: true,
    required: true,
    skippable: false,
    requiresReasonOnSkip: false,
    defaultProfiles: Object.freeze(['commit']),
    cost: 'fast',
    opensWindow: false,
  }),
  coverage: Object.freeze({
    group: 'ci',
    description: 'Run coverage checks',
    timeoutMs: 120000,
    blocking: false,
    required: false,
    skippable: true,
    requiresReasonOnSkip: true,
    defaultProfiles: Object.freeze(['ci-local']),
    cost: 'medium',
    opensWindow: false,
  }),
  'docs-pages': Object.freeze({
    group: 'ci',
    description: 'Build Docs Pages site',
    timeoutMs: 120000,
    blocking: true,
    required: true,
    skippable: false,
    requiresReasonOnSkip: false,
    defaultProfiles: Object.freeze(['ci-local']),
    cost: 'medium',
    opensWindow: false,
    ciWorkflow: 'docs-pages.yml',
    ciJob: 'build',
    ciRequired: true,
  }),
});

export function cloneDefaults() {
  return JSON.parse(JSON.stringify(DEFAULT_COMMIT_CHECK_CONFIG));
}

export function defaultLaneMetadata(name) {
  const specific = DEFAULT_LANE_METADATA[name] || {};
  return {
    group: 'ci',
    description: `${name} check`,
    cwd: '.',
    timeoutMs: 120000,
    blocking: true,
    required: true,
    skippable: false,
    requiresReasonOnSkip: false,
    defaultProfiles: ['ci-local'],
    cost: 'medium',
    opensWindow: false,
    ciWorkflow: '',
    ciJob: '',
    ciRequired: false,
    ...JSON.parse(JSON.stringify(specific)),
  };
}

export function normalizeLane(name, lane = {}) {
  const defaults = defaultLaneMetadata(name);
  const normalized = {
    ...defaults,
    ...lane,
    enabled: lane.enabled !== false,
    commands: Object.prototype.hasOwnProperty.call(lane, 'commands') ? lane.commands : [],
  };

  if (normalized.skippable === false) {
    normalized.requiresReasonOnSkip = false;
  }
  return normalized;
}

export function normalizeCommitCheckConfig(config = {}) {
  const defaults = cloneDefaults();
  const lanes = {};

  for (const [name, lane] of Object.entries(config.lanes || {})) {
    lanes[name] = normalizeLane(name, lane);
  }

  return {
    ...config,
    schemaVersion: COMMIT_CHECK_CONFIG_SCHEMA_VERSION,
    threshold: Number.isFinite(Number(config.threshold)) ? Number(config.threshold) : defaults.threshold,
    weights: { ...defaults.weights, ...(config.weights || {}) },
    gates: Array.isArray(config.gates) ? config.gates : defaults.gates,
    profiles: { ...defaults.profiles, ...(config.profiles || {}) },
    groups: { ...defaults.groups, ...(config.groups || {}) },
    lanes,
  };
}

export function validateCommitCheckConfig(config) {
  const errors = [];
  if (!config || typeof config !== 'object') {
    return { valid: false, errors: ['config must be an object'] };
  }
  if (Number(config.schemaVersion) !== COMMIT_CHECK_CONFIG_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${COMMIT_CHECK_CONFIG_SCHEMA_VERSION}`);
  }
  if (!config.lanes || typeof config.lanes !== 'object' || Array.isArray(config.lanes)) {
    errors.push('lanes must be an object');
  } else {
    for (const [name, lane] of Object.entries(config.lanes)) {
      if (!lane || typeof lane !== 'object' || Array.isArray(lane)) {
        errors.push(`lane "${name}" must be an object`);
        continue;
      }
      if (!Array.isArray(lane.commands)) {
        errors.push(`lane "${name}" commands must be an array`);
      }
      if (lane.defaultProfiles !== undefined && !Array.isArray(lane.defaultProfiles)) {
        errors.push(`lane "${name}" defaultProfiles must be an array`);
      }
      if (lane.blocking === false && lane.required === true) {
        errors.push(`lane "${name}" cannot be required when blocking is false`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}
