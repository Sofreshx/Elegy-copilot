const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SESSION_RETROSPECTIVE_SCHEMA_VERSION,
  computeSessionRetrospectiveArtifactChecksum,
  normalizeSessionRetrospectiveStructuredArtifact,
  parseSessionRetrospectiveMarkdownArtifact,
} = require('../dist');

function singleInput() {
  return {
    schemaVersion: '1',
    kind: 'session.retrospective.single',
    retrospectiveId: 'retro-1',
    generatedAt: '2026-08-01T10:00:00Z',
    source: {
      harness: 'codex',
      taskIds: ['task-b', 'task-b'],
      repoIds: ['repo-2', 'repo-2'],
      completeness: 'complete',
    },
    recap: {
      summary: 'Delivered the requested contract.',
      delivered: ['tests', 'contract', 'contract'],
      requested: ['follow-up'],
    },
    strengths: [
      {
        signalKey: 'validation_friction',
        summary: 'Focused checks were fast.',
        perspective: 'observed',
        confidence: 'high',
        evidenceRefs: ['test:2', 'test:1', 'test:1'],
      },
    ],
    frictions: [],
    improvementCandidates: [
      {
        candidateId: 'candidate-1',
        signalKey: 'validation_friction',
        proposal: 'Keep a focused contract test.',
        rationale: 'It catches malformed state early.',
        targetSurface: 'contracts',
        confidence: 'medium',
        evidenceRefs: ['test:1'],
        status: 'proposed',
      },
    ],
    uncertainty: { biggestMissing: null, leastConfident: 'aggregate recurrence' },
    requiresUserDecision: false,
  };
}

function v2SingleInput() {
  return {
    ...singleInput(),
    schemaVersion: '2',
    customizationInventory: [
      {
        surface: 'session-retrospective',
        status: 'available',
        scope: 'repo',
        owner: 'repo',
        evidenceRefs: ['inventory:2', 'inventory:1', 'inventory:1'],
        limitations: ['Requires a user request.', 'Requires a user request.'],
      },
    ],
    improvementCandidates: [
      {
        candidateId: 'candidate-1',
        signalKey: 'validation_friction',
        proposal: 'Keep a focused contract test.',
        target: {
          surface: 'contracts',
          scope: 'repo',
          owner: 'repo',
          action: 'modify',
          automation: 'advisory',
          feasibility: 'direct',
        },
        whyThisSurface: 'The contract owns validation behavior.',
        alternativesRejected: ['Changing the host does not validate input.'],
        expectedImpact: 'Malformed artifacts are rejected consistently.',
        risks: ['Consumers must adopt schema version 2.'],
        validation: ['Run the focused contract test.'],
        confidence: 'medium',
        evidenceRefs: ['test:2', 'test:1', 'test:1'],
        status: 'proposed',
      },
    ],
  };
}

test('session retrospective normalization is typed and deterministic', () => {
  assert.deepEqual(normalizeSessionRetrospectiveStructuredArtifact(singleInput()), {
    ...singleInput(),
    source: {
      ...singleInput().source,
      taskIds: ['task-b'],
      repoIds: ['repo-2'],
    },
    recap: {
      ...singleInput().recap,
      delivered: ['contract', 'tests'],
    },
    strengths: [{
      ...singleInput().strengths[0],
      evidenceRefs: ['test:1', 'test:2'],
    }],
  });
});

test('aggregate retrospective requires and normalizes children and repeated signals', () => {
  const aggregate = normalizeSessionRetrospectiveStructuredArtifact({
    ...singleInput(),
    kind: 'session.retrospective.aggregate',
    source: { ...singleInput().source, taskIds: ['task-b', 'task-a'] },
    children: [
      { retrospectiveId: 'retro-b', taskId: 'task-b', checksum: 'bbb' },
      { retrospectiveId: 'retro-a', taskId: 'task-a', checksum: 'aaa' },
    ],
    repeatedSignals: [
      { signalKey: 'tool_friction', count: 2, taskIds: ['task-b', 'task-a'] },
    ],
  });

  assert.equal(aggregate.kind, 'session.retrospective.aggregate');
  assert.deepEqual(aggregate.children.map((child) => child.taskId), ['task-a', 'task-b']);
  assert.deepEqual(aggregate.repeatedSignals[0].taskIds, ['task-a', 'task-b']);
  assert.throws(
    () => normalizeSessionRetrospectiveStructuredArtifact({
      ...aggregate,
      repeatedSignals: [{ signalKey: 'tool_friction', count: 3, taskIds: ['task-a', 'task-b'] }],
    }),
    (error) => error.code === 'invalid_artifact_shape',
  );
  assert.throws(
    () => normalizeSessionRetrospectiveStructuredArtifact({
      ...aggregate,
      children: [{ retrospectiveId: 'retro-a', taskId: 'task-a', checksum: 'aaa' }, { retrospectiveId: 'retro-x', taskId: 'task-x', checksum: 'xxx' }],
    }),
    (error) => error.code === 'invalid_artifact_shape',
  );
});

test('session retrospective markdown parser returns checksum and rejects malformed input', () => {
  const markdown = `# Retrospective\n\n## Structured State\n\n\`\`\`json\n${JSON.stringify(singleInput(), null, 2)}\n\`\`\``;
  const parsed = parseSessionRetrospectiveMarkdownArtifact(markdown);

  assert.equal(parsed.artifact.retrospectiveId, 'retro-1');
  assert.equal(parsed.checksum, computeSessionRetrospectiveArtifactChecksum(markdown));
  assert.throws(
    () => parseSessionRetrospectiveMarkdownArtifact('# Missing state'),
    (error) => error.code === 'missing_structured_state',
  );
  assert.throws(
    () => normalizeSessionRetrospectiveStructuredArtifact({ ...singleInput(), requiresUserDecision: 'no' }),
    (error) => error.code === 'invalid_artifact_shape',
  );
  assert.throws(
    () => normalizeSessionRetrospectiveStructuredArtifact({ ...singleInput(), kind: 'session.retrospective.unknown' }),
    (error) => error.code === 'invalid_artifact_kind',
  );
});

test('v2 retrospective normalization is deterministic and preserves its customization inventory', () => {
  const normalized = normalizeSessionRetrospectiveStructuredArtifact(v2SingleInput());

  assert.equal(SESSION_RETROSPECTIVE_SCHEMA_VERSION, '2');
  assert.equal(normalized.schemaVersion, '2');
  assert.deepEqual(normalized.customizationInventory, [{
    surface: 'session-retrospective',
    status: 'available',
    scope: 'repo',
    owner: 'repo',
    evidenceRefs: ['inventory:1', 'inventory:2'],
    limitations: ['Requires a user request.'],
  }]);
  assert.deepEqual(normalized.improvementCandidates[0].target, {
    surface: 'contracts',
    scope: 'repo',
    owner: 'repo',
    action: 'modify',
    automation: 'advisory',
    feasibility: 'direct',
  });
  assert.deepEqual(normalized.improvementCandidates[0], {
    ...v2SingleInput().improvementCandidates[0],
    evidenceRefs: ['test:1', 'test:2'],
  });
});

test('v2 retrospective rejects unsupported customization and improvement target enums', () => {
  assert.throws(
    () => normalizeSessionRetrospectiveStructuredArtifact({
      ...v2SingleInput(),
      customizationInventory: [{ ...v2SingleInput().customizationInventory[0], status: 'enabled' }],
    }),
    (error) => error.code === 'invalid_artifact_shape',
  );
  assert.throws(
    () => normalizeSessionRetrospectiveStructuredArtifact({
      ...v2SingleInput(),
      improvementCandidates: [{
        ...v2SingleInput().improvementCandidates[0],
        target: { ...v2SingleInput().improvementCandidates[0].target, feasibility: 'eventually' },
      }],
    }),
    (error) => error.code === 'invalid_artifact_shape',
  );
});

test('v2 markdown parsing round-trips normalized state while v1 remains parseable', () => {
  const v2Markdown = `# Retrospective\n\n## Structured State\n\n\`\`\`json\n${JSON.stringify(v2SingleInput(), null, 2)}\n\`\`\``;
  const v1Markdown = `# Retrospective\n\n## Structured State\n\n\`\`\`json\n${JSON.stringify(singleInput(), null, 2)}\n\`\`\``;

  assert.deepEqual(
    parseSessionRetrospectiveMarkdownArtifact(v2Markdown).artifact,
    normalizeSessionRetrospectiveStructuredArtifact(v2SingleInput()),
  );
  assert.equal(parseSessionRetrospectiveMarkdownArtifact(v1Markdown).artifact.schemaVersion, '1');
});
