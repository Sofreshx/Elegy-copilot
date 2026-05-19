'use strict';

const childProcess = require('node:child_process');
const path = require('node:path');

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_CANDIDATES = 3;
const DEFAULT_SCOPE = 'workspace';
const DEFAULT_CLI_PATH = 'elegy-memory';
const DEFAULT_DB_FILENAME = 'elegy-memory.db';
const DEFAULT_PROVENANCE = 'imported';
const MAX_SUMMARY_CHARS = 800;
const MAX_FOLLOW_UPS = 5;

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.map((entry) => normalizeString(entry)).filter(Boolean))];
}

function clipText(value, limit = MAX_SUMMARY_CHARS) {
  const text = normalizeString(value);
  if (!text || text.length <= limit) {
    return text;
  }
  return `${text.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
}

function resolveStructuredState(artifact) {
  return artifact && artifact.structuredState && typeof artifact.structuredState === 'object'
    ? artifact.structuredState
    : {};
}

function normalizeMemoryCandidate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const kind = normalizeString(value.kind);
  const summary = clipText(value.summary);
  if (!kind || !summary) {
    return null;
  }

  return {
    kind,
    summary,
    tags: normalizeStringList(value.tags),
    pathPrefixes: normalizeStringList(value.pathPrefixes),
  };
}

function buildFallbackRoadmapWorkflowMemoryCandidate(artifact) {
  const structuredState = resolveStructuredState(artifact);
  const target = artifact.sliceId
    ? `${artifact.roadmapId} / ${artifact.sliceId}`
    : artifact.roadmapId;
  const followUps = normalizeStringList(structuredState.followUps).slice(0, MAX_FOLLOW_UPS);
  const failedChecks = structuredState.acceptance && typeof structuredState.acceptance === 'object'
    ? normalizeStringList(structuredState.acceptance.failedChecks)
    : [];
  const parts = [`${artifact.kind} for ${target} is ${artifact.status} in ${artifact.phase}.`];

  if (structuredState.requiresUserDecision === true) {
    parts.push('User decision is still required.');
  }

  if (normalizeString(structuredState.suggestedNextAction)) {
    parts.push(`Next action: ${normalizeString(structuredState.suggestedNextAction)}.`);
  }

  if (followUps.length > 0) {
    parts.push(`Follow-ups: ${followUps.join('; ')}.`);
  }

  if (failedChecks.length > 0) {
    parts.push(`Failed checks: ${failedChecks.join('; ')}.`);
  }

  return {
    kind: artifact.kind,
    summary: clipText(parts.join(' ')),
    tags: [
      'roadmap-workflow',
      normalizeString(artifact.phase),
      normalizeString(artifact.status),
    ].filter(Boolean),
    pathPrefixes: [],
  };
}

function selectRoadmapWorkflowMemoryCandidates(artifact, maxCandidates = DEFAULT_MAX_CANDIDATES) {
  const structuredState = resolveStructuredState(artifact);
  const configured = Array.isArray(structuredState.memoryCandidates)
    ? structuredState.memoryCandidates.map((candidate) => normalizeMemoryCandidate(candidate)).filter(Boolean)
    : [];

  if (configured.length > 0) {
    return configured.slice(0, Math.max(1, maxCandidates));
  }

  return [buildFallbackRoadmapWorkflowMemoryCandidate(artifact)];
}

function buildRoadmapWorkflowMemoryContent(artifact, candidate) {
  const structuredState = resolveStructuredState(artifact);
  const followUps = normalizeStringList(structuredState.followUps).slice(0, MAX_FOLLOW_UPS);
  const tags = normalizeStringList(candidate.tags);
  const pathPrefixes = normalizeStringList(candidate.pathPrefixes);
  const failedChecks = structuredState.acceptance && typeof structuredState.acceptance === 'object'
    ? normalizeStringList(structuredState.acceptance.failedChecks)
    : [];
  const lines = [
    'Roadmap workflow memory',
    normalizeString(artifact.artifactId) ? `artifactId: ${artifact.artifactId}` : null,
    normalizeString(artifact.repoId) ? `repoId: ${artifact.repoId}` : null,
    normalizeString(artifact.roadmapId) ? `roadmapId: ${artifact.roadmapId}` : null,
    normalizeString(artifact.sliceId) ? `sliceId: ${artifact.sliceId}` : null,
    normalizeString(artifact.kind) ? `artifactKind: ${artifact.kind}` : null,
    normalizeString(artifact.phase) ? `phase: ${artifact.phase}` : null,
    normalizeString(artifact.status) ? `status: ${artifact.status}` : null,
    normalizeString(artifact.sessionId) ? `sessionId: ${artifact.sessionId}` : null,
    normalizeString(artifact.sourceHarness) ? `sourceHarness: ${artifact.sourceHarness}` : null,
    normalizeString(artifact.sourceModel) ? `sourceModel: ${artifact.sourceModel}` : null,
    normalizeString(artifact.updatedAt) ? `artifactUpdatedAt: ${artifact.updatedAt}` : null,
    normalizeString(candidate.kind) ? `memoryKind: ${candidate.kind}` : null,
    tags.length > 0 ? `tags: ${tags.join(', ')}` : null,
    pathPrefixes.length > 0 ? `paths: ${pathPrefixes.join(', ')}` : null,
    '',
    `Summary: ${clipText(candidate.summary)}`,
  ];

  if (normalizeString(structuredState.suggestedNextAction)) {
    lines.push(`Next action: ${clipText(structuredState.suggestedNextAction)}`);
  }

  if (normalizeString(structuredState.roadmapImpact)) {
    lines.push(`Impact: ${clipText(structuredState.roadmapImpact)}`);
  }

  if (followUps.length > 0) {
    lines.push('Follow-ups:');
    for (const followUp of followUps) {
      lines.push(`- ${clipText(followUp)}`);
    }
  }

  if (structuredState.acceptance && typeof structuredState.acceptance === 'object') {
    if (structuredState.acceptance.allPassed === true) {
      lines.push('Acceptance: all recorded checks passed.');
    } else if (failedChecks.length > 0) {
      lines.push(`Acceptance: failed checks: ${failedChecks.join('; ')}`);
    }
  }

  if (structuredState.requiresUserDecision === true) {
    lines.push('User decision required: true');
  }

  return lines.filter(Boolean).join('\n').trim();
}

function deriveRoadmapWorkflowMemoryType(artifact) {
  const kind = normalizeString(artifact.kind);
  const phase = normalizeString(artifact.phase);

  if (kind === 'roadmap.definition') {
    return 'fact';
  }
  if (kind === 'roadmap.plan.result' || kind === 'roadmap.completion.result') {
    return 'decision';
  }
  if (phase === 'implementation') {
    return 'procedure';
  }
  return 'observation';
}

function deriveRoadmapWorkflowMemoryImportance(artifact) {
  const structuredState = resolveStructuredState(artifact);
  const status = normalizeString(artifact.status);
  let importance = 0.55;

  if (status === 'blocked' || status === 'fail') {
    importance = 0.9;
  } else if (status === 'pass' || status === 'done' || status === 'completed') {
    importance = 0.75;
  } else if (status === 'proposed' || status === 'in_progress') {
    importance = 0.65;
  }

  if (normalizeString(artifact.kind) === 'roadmap.completion.result') {
    importance = Math.max(importance, 0.8);
  }
  if (structuredState.requiresUserDecision === true) {
    importance = Math.max(importance, 0.85);
  }

  return Number(importance.toFixed(2));
}

function resolveCommandInvocation(command, processObject = process) {
  const normalizedCommand = normalizeString(command);
  const platform = normalizeString(processObject && processObject.platform) || process.platform;

  if (platform === 'win32' && /\.(cmd|bat)$/i.test(normalizedCommand)) {
    return {
      command: normalizeString(processObject && processObject.env && processObject.env.ComSpec) || 'cmd.exe',
      argsPrefix: ['/d', '/s', '/c', `"${normalizedCommand}"`],
    };
  }

  return {
    command: normalizedCommand,
    argsPrefix: [],
  };
}

function runCommand(config, args) {
  const execFile = typeof config.childProcess?.execFile === 'function'
    ? config.childProcess.execFile.bind(config.childProcess)
    : childProcess.execFile;
  const invocation = resolveCommandInvocation(config.cliPath, config.processObject);

  return new Promise((resolve, reject) => {
    execFile(
      invocation.command,
      [...invocation.argsPrefix, ...args],
      {
        timeout: config.timeoutMs,
        windowsHide: true,
        env: config.env,
        cwd: config.cwd || undefined,
        maxBuffer: 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(Object.assign(error, {
            stdout: String(stdout || ''),
            stderr: String(stderr || ''),
          }));
          return;
        }

        resolve({
          stdout: String(stdout || ''),
          stderr: String(stderr || ''),
        });
      },
    );
  });
}

function parseAddResponse(stdout) {
  try {
    const parsed = JSON.parse(String(stdout || '{}'));
    return normalizeString(parsed && parsed.data && parsed.data.memory && parsed.data.memory.id) || null;
  } catch (error) {
    throw Object.assign(new Error('Elegy memory add returned invalid JSON output.'), {
      code: 'elegy_memory_invalid_json',
    });
  }
}

function normalizeSyncError(error) {
  return {
    code: normalizeString(error && error.code) || 'elegy_memory_write_failed',
    message: normalizeString(error && error.message)
      || normalizeString(error && error.stderr)
      || normalizeString(error && error.stdout)
      || 'Elegy memory write failed.',
  };
}

function createRoadmapWorkflowMemoryBridge(options = {}) {
  const processObject = options.processObject && typeof options.processObject === 'object'
    ? options.processObject
    : process;
  const env = options.env && typeof options.env === 'object'
    ? options.env
    : (processObject.env && typeof processObject.env === 'object' ? processObject.env : process.env);
  const pathModule = options.pathModule && typeof options.pathModule.join === 'function'
    ? options.pathModule
    : path;
  const copilotHome = normalizeString(options.copilotHome);
  const cliPath = normalizeString(options.cliPath || env.INSTRUCTION_ENGINE_ELEGY_MEMORY_CLI_PATH) || DEFAULT_CLI_PATH;
  const dbPath = normalizeString(options.dbPath || env.INSTRUCTION_ENGINE_ELEGY_MEMORY_DB_PATH)
    || (copilotHome ? pathModule.join(copilotHome, DEFAULT_DB_FILENAME) : '');
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? Number(options.timeoutMs)
    : DEFAULT_TIMEOUT_MS;
  const maxCandidates = Number.isFinite(options.maxCandidates) && options.maxCandidates > 0
    ? Math.max(1, Math.floor(options.maxCandidates))
    : DEFAULT_MAX_CANDIDATES;
  const disabled = options.enabled === false || normalizeString(env.INSTRUCTION_ENGINE_ELEGY_MEMORY_DISABLED) === '1';
  const config = {
    childProcess: options.childProcess,
    processObject,
    env,
    cliPath,
    dbPath,
    cwd: copilotHome || undefined,
    timeoutMs,
    maxCandidates,
  };

  return {
    async persistArtifact(artifact) {
      if (disabled) {
        return {
          status: 'skipped',
          attempted: 0,
          synced: 0,
          reason: 'bridge_disabled',
        };
      }

      if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
        return {
          status: 'skipped',
          attempted: 0,
          synced: 0,
          reason: 'invalid_artifact',
        };
      }

      if (!normalizeString(config.cliPath) || !normalizeString(config.dbPath)) {
        return {
          status: 'skipped',
          attempted: 0,
          synced: 0,
          reason: 'bridge_unconfigured',
        };
      }

      const candidates = selectRoadmapWorkflowMemoryCandidates(artifact, config.maxCandidates);
      if (candidates.length === 0) {
        return {
          status: 'skipped',
          attempted: 0,
          synced: 0,
          reason: 'no_memory_candidates',
        };
      }

      const memoryIds = [];
      const errors = [];
      let synced = 0;

      for (const candidate of candidates) {
        const content = buildRoadmapWorkflowMemoryContent(artifact, candidate);
        const args = [
          '--format',
          'json',
          'add',
          content,
          '--db',
          config.dbPath,
          '--scope',
          DEFAULT_SCOPE,
          '--type',
          deriveRoadmapWorkflowMemoryType(artifact),
          '--importance',
          deriveRoadmapWorkflowMemoryImportance(artifact).toFixed(2),
          '--provenance',
          DEFAULT_PROVENANCE,
        ];

        try {
          const output = await runCommand(config, args);
          const memoryId = parseAddResponse(output.stdout);
          synced += 1;
          if (memoryId) {
            memoryIds.push(memoryId);
          }
        } catch (error) {
          errors.push(normalizeSyncError(error));
        }
      }

      if (errors.length === 0) {
        return {
          status: 'synced',
          attempted: candidates.length,
          synced,
          memoryIds,
        };
      }

      return {
        status: synced > 0 ? 'partial' : 'failed_open',
        attempted: candidates.length,
        synced,
        memoryIds,
        errors,
      };
    },
  };
}

module.exports = {
  buildFallbackRoadmapWorkflowMemoryCandidate,
  buildRoadmapWorkflowMemoryContent,
  createRoadmapWorkflowMemoryBridge,
  deriveRoadmapWorkflowMemoryImportance,
  deriveRoadmapWorkflowMemoryType,
  selectRoadmapWorkflowMemoryCandidates,
};
