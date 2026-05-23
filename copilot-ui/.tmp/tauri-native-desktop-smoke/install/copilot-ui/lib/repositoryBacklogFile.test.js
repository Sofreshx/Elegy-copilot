'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  REPOSITORY_BACKLOG_DESCRIPTION,
  REPOSITORY_BACKLOG_EMPTY_STATE,
  REPOSITORY_BACKLOG_FILE_RELATIVE_PATH,
  REPOSITORY_BACKLOG_PRIMARY_DIRECTORY_REPO_RELATIVE_PATH,
  REPOSITORY_BACKLOG_PRIMARY_FAMILY_REPO_RELATIVE_PATH,
  REPOSITORY_BACKLOG_ITEM_STATUSES,
  formatRepositoryBacklogItemId,
  parseRepositoryBacklogDocument,
  formatRepositoryBacklogDocument,
  getNextRepositoryBacklogItemId,
  createRepositoryBacklogItem,
  reconcileRepositoryBacklogItem,
  updateRepositoryBacklogItem,
  removeRepositoryBacklogItem,
  ensureRepositoryBacklogFile,
  readRepositoryBacklogFile,
  updateRepositoryBacklogFile,
} = require('./repositoryBacklogFile');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  PASS: ${name}`);
  } catch (error) {
    console.error(`  FAIL: ${name}`);
    console.error(`    ${error.message}`);
    process.exitCode = 1;
  }
}

function withTempRepo(fn) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'repository-backlog-file-'));
  try {
    return fn(repoRoot);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
}

test('formatRepositoryBacklogDocument emits canonical empty backlog content', () => {
  const text = formatRepositoryBacklogDocument({ items: [] });

  assert.ok(text.startsWith('# Repository Backlog'));
  assert.ok(text.includes('<!-- REPOSITORY_BACKLOG_FORMAT_VERSION: 1 -->'));
  assert.ok(text.includes(REPOSITORY_BACKLOG_DESCRIPTION));
  assert.ok(text.includes(REPOSITORY_BACKLOG_EMPTY_STATE));

  const parsed = parseRepositoryBacklogDocument(text);
  assert.deepStrictEqual(parsed.items, []);
  assert.strictEqual(parsed.description, REPOSITORY_BACKLOG_DESCRIPTION);
});

test('parseRepositoryBacklogDocument round-trips importance and dated key points', () => {
  const source = {
    items: [
      {
        id: 'RB-002',
        title: 'Build repository backlog file engine',
        status: 'planned',
        importance: '9',
        summary: 'Implement parser and formatter helpers for docs/backlog.md.',
        roadmapIds: ['RM-platform-foundation-001'],
        planRefs: ['session:20260315_010203_ABCD'],
        satisfiedByPlanRef: 'session:20260315_010203_ABCD',
        keyPoints: [
          { date: '2026-03-15', text: 'Need deterministic updates.' },
          { date: '2026-03-14', text: 'Contract requires RB-### IDs.' },
        ],
      },
    ],
  };

  const formatted = formatRepositoryBacklogDocument(source);
  const parsed = parseRepositoryBacklogDocument(formatted);

  assert.deepStrictEqual(parsed.items, [
    {
      id: 'RB-002',
      title: 'Build repository backlog file engine',
      status: 'planned',
      roadmapIds: ['RM-platform-foundation-001'],
      planRefs: ['session:20260315_010203_ABCD'],
      satisfiedByPlanRef: 'session:20260315_010203_ABCD',
      supersededByPlanRef: null,
      abandonedByPlanRef: null,
      importance: 9,
      summary: 'Implement parser and formatter helpers for docs/backlog.md.',
      keyPoints: [
        { date: '2026-03-14', text: 'Contract requires RB-### IDs.' },
        { date: '2026-03-15', text: 'Need deterministic updates.' },
      ],
    },
  ]);
});

test('createRepositoryBacklogItem assigns the next stable RB id', () => {
  const next = createRepositoryBacklogItem(
    {
      items: [
        { id: 'RB-002', title: 'Second item', summary: '', keyPoints: [] },
        { id: 'RB-007', title: 'Seventh item', summary: '', keyPoints: [] },
      ],
    },
    {
      title: 'New item',
      summary: 'New summary',
      keyPoints: [{ date: '2026-03-14', text: 'Initial capture.' }],
    },
  );

  assert.strictEqual(next.items[2].id, 'RB-008');
  assert.strictEqual(getNextRepositoryBacklogItemId(next.items), 'RB-009');
});

test('updateRepositoryBacklogItem preserves stable ids and re-sorts key points deterministically', () => {
  const updated = updateRepositoryBacklogItem(
    {
      items: [
      {
          id: 'RB-001',
          title: 'Original title',
          status: 'proposed',
          summary: 'Original summary',
          keyPoints: [{ date: '2026-03-15', text: 'Later note.' }],
        },
      ],
    },
    'RB-001',
    (item) => ({
      ...item,
      title: 'Updated title',
      keyPoints: [
        { date: '2026-03-16', text: 'Another note.' },
        { date: '2026-03-14', text: 'Earlier note.' },
        { date: '2026-03-14', text: 'Earlier note.' },
      ],
    }),
  );

  assert.deepStrictEqual(updated.items, [
    {
      id: 'RB-001',
      title: 'Updated title',
      status: 'proposed',
      summary: 'Original summary',
      roadmapIds: [],
      planRefs: [],
      satisfiedByPlanRef: null,
      supersededByPlanRef: null,
      abandonedByPlanRef: null,
      importance: null,
      keyPoints: [
        { date: '2026-03-14', text: 'Earlier note.' },
        { date: '2026-03-16', text: 'Another note.' },
      ],
    },
  ]);
});

test('removeRepositoryBacklogItem deletes the targeted item and preserves canonical ordering', () => {
  const result = removeRepositoryBacklogItem(
    {
      items: [
        { id: 'RB-001', title: 'One', summary: '', keyPoints: [] },
        { id: 'RB-002', title: 'Two', summary: '', keyPoints: [] },
      ],
    },
    'RB-001',
  );

  assert.deepStrictEqual(result.items.map((item) => item.id), ['RB-002']);
});

test('ensureRepositoryBacklogFile safely creates docs/backlog.md when missing', () => {
  withTempRepo((repoRoot) => {
    const result = ensureRepositoryBacklogFile(repoRoot);
    const backlogPath = path.join(repoRoot, REPOSITORY_BACKLOG_FILE_RELATIVE_PATH);

    assert.strictEqual(result.created, true);
    assert.strictEqual(fs.existsSync(backlogPath), true);
    assert.strictEqual(result.backlog.items.length, 0);

    const persisted = fs.readFileSync(backlogPath, 'utf8');
    assert.strictEqual(persisted, result.text);
  });
});

test('readRepositoryBacklogFile reports empty canonical backlog when file is absent', () => {
  withTempRepo((repoRoot) => {
    const result = readRepositoryBacklogFile(repoRoot);

    assert.strictEqual(result.exists, false);
    assert.deepStrictEqual(result.backlog.items, []);
    assert.strictEqual(result.family.primaryFamilyRepoRelativePath, REPOSITORY_BACKLOG_PRIMARY_FAMILY_REPO_RELATIVE_PATH);
    assert.deepStrictEqual(result.family.resolvedRepoRelativePaths, []);
  });
});

test('readRepositoryBacklogFile aggregates primary backlog artifacts plus legacy compatibility file', () => {
  withTempRepo((repoRoot) => {
    const primaryPath = path.join(repoRoot, REPOSITORY_BACKLOG_PRIMARY_DIRECTORY_REPO_RELATIVE_PATH, 'session-close.md');
    const legacyPath = path.join(repoRoot, REPOSITORY_BACKLOG_FILE_RELATIVE_PATH);

    fs.mkdirSync(path.dirname(primaryPath), { recursive: true });
    fs.mkdirSync(path.dirname(legacyPath), { recursive: true });
    fs.writeFileSync(primaryPath, formatRepositoryBacklogDocument({
      items: [
        {
          id: 'RB-002',
          title: 'Session carryover',
          status: 'planned',
          summary: 'Carry work over into a session backlog artifact.',
          keyPoints: [],
        },
      ],
    }), 'utf8');
    fs.writeFileSync(legacyPath, formatRepositoryBacklogDocument({
      items: [
        {
          id: 'RB-001',
          title: 'Legacy compatibility item',
          status: 'proposed',
          summary: 'Keep older flows working.',
          keyPoints: [],
        },
      ],
    }), 'utf8');

    const result = readRepositoryBacklogFile(repoRoot);

    assert.strictEqual(result.exists, true);
    assert.deepStrictEqual(result.backlog.items.map((item) => item.id), ['RB-001', 'RB-002']);
    assert.strictEqual(result.backlog.items[1].sourceRepoRelativePath, 'docs/backlogs/session-close.md');
    assert.strictEqual(result.family.primaryFamilyRepoRelativePath, REPOSITORY_BACKLOG_PRIMARY_FAMILY_REPO_RELATIVE_PATH);
    assert.deepStrictEqual(result.family.resolvedRepoRelativePaths, [
      'docs/backlog.md',
      'docs/backlogs/session-close.md',
    ]);
  });
});

test('updateRepositoryBacklogFile writes deterministic canonical content and reports no-op updates', () => {
  withTempRepo((repoRoot) => {
    const first = updateRepositoryBacklogFile(repoRoot, (backlog) =>
      createRepositoryBacklogItem(backlog, {
        title: 'Backlog item',
        importance: 4,
        summary: 'Track repo-backed planning intake.',
        keyPoints: [
          { date: '2026-03-16', text: 'Second note.' },
          { date: '2026-03-14', text: 'First note.' },
        ],
      }),
    );

    assert.strictEqual(first.created, true);
    assert.strictEqual(first.changed, true);
    assert.deepStrictEqual(first.backlog.items.map((item) => item.id), ['RB-001']);

    const second = updateRepositoryBacklogFile(repoRoot, (backlog) => backlog);
    assert.strictEqual(second.created, false);
    assert.strictEqual(second.changed, false);
    assert.strictEqual(second.text, first.text);
  });
});

test('updateRepositoryBacklogFile updates an item in its owning primary backlog artifact without creating legacy fallback', () => {
  withTempRepo((repoRoot) => {
    const primaryPath = path.join(repoRoot, REPOSITORY_BACKLOG_PRIMARY_DIRECTORY_REPO_RELATIVE_PATH, 'session-close.md');
    const legacyPath = path.join(repoRoot, REPOSITORY_BACKLOG_FILE_RELATIVE_PATH);

    fs.mkdirSync(path.dirname(primaryPath), { recursive: true });
    fs.writeFileSync(primaryPath, formatRepositoryBacklogDocument({
      items: [
        {
          id: 'RB-001',
          title: 'Carryover item',
          status: 'planned',
          summary: 'Needs deterministic owner updates.',
          keyPoints: [],
        },
      ],
    }), 'utf8');

    const saved = updateRepositoryBacklogFile(repoRoot, (backlog) =>
      updateRepositoryBacklogItem(backlog, 'RB-001', { status: 'blocked' }));

    assert.strictEqual(saved.changed, true);
    assert.strictEqual(fs.existsSync(legacyPath), false);

    const primaryDocument = parseRepositoryBacklogDocument(fs.readFileSync(primaryPath, 'utf8'));
    assert.strictEqual(primaryDocument.items[0].status, 'blocked');
  });
});

test('parseRepositoryBacklogDocument rejects malformed key point lines', () => {
  assert.throws(
    () =>
      parseRepositoryBacklogDocument(`# Repository Backlog

<!-- REPOSITORY_BACKLOG_FORMAT_VERSION: 1 -->

${REPOSITORY_BACKLOG_DESCRIPTION}

## RB-001 - Broken Item
- Status: proposed
- Roadmap IDs: none
- Plan Refs: none
- Satisfied By Plan Ref: none
- Superseded By Plan Ref: none
- Abandoned By Plan Ref: none

### Key Points
- not-a-date: bad line
`),
    /Invalid repository backlog key point line/,
  );
});

test('formatRepositoryBacklogItemId keeps canonical RB-### formatting', () => {
  assert.strictEqual(formatRepositoryBacklogItemId(1), 'RB-001');
  assert.strictEqual(formatRepositoryBacklogItemId(12), 'RB-012');
  assert.strictEqual(formatRepositoryBacklogItemId(1001), 'RB-1001');
});

test('repository backlog status contract stays explicit for roadmap sync', () => {
  assert.deepStrictEqual(REPOSITORY_BACKLOG_ITEM_STATUSES, [
    'proposed',
    'planned',
    'in-progress',
    'blocked',
    'satisfied',
    'superseded',
    'abandoned',
  ]);
});

test('reconcileRepositoryBacklogItem records roadmap links and terminal plan refs deterministically', () => {
  const reconciled = reconcileRepositoryBacklogItem({
    items: [
      {
        id: 'RB-001',
        title: 'Bootstrap roadmap sync',
        status: 'planned',
        summary: 'Track repo-backed sync.',
        roadmapIds: ['RM-platform-foundation-001'],
        planRefs: ['group:G-01-platform-foundation'],
        keyPoints: [],
      },
    ],
  }, {
    itemId: 'RB-001',
    roadmapIds: ['RM-platform-foundation-001', 'RM-platform-foundation-002'],
    planRef: 'session:20260315_222222_ABCD',
    outcome: 'completed',
  });

  assert.deepStrictEqual(reconciled.items, [
    {
      id: 'RB-001',
      title: 'Bootstrap roadmap sync',
      status: 'satisfied',
      summary: 'Track repo-backed sync.',
      roadmapIds: ['RM-platform-foundation-001', 'RM-platform-foundation-002'],
      planRefs: ['group:G-01-platform-foundation', 'session:20260315_222222_ABCD'],
      satisfiedByPlanRef: 'session:20260315_222222_ABCD',
      supersededByPlanRef: null,
      abandonedByPlanRef: null,
      importance: null,
      keyPoints: [],
    },
  ]);
});

console.log(`\n${passed} tests passed`);
if (process.exitCode) {
  console.error('Some tests FAILED');
} else {
  console.log('All tests passed');
}
