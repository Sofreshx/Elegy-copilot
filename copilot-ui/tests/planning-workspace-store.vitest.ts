import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../ui/src/lib/api', async () => {
  const actual = await vi.importActual<typeof import('../ui/src/lib/api')>('../ui/src/lib/api');

  const DEFAULT_SOURCE = {
    id: 'snsrc_0123456789abcdef0123456789abcdef',
    provider: 'github',
    host: 'github.com',
    owner: 'InstructionEngine',
    repo: 'workspace',
    branch: 'main',
    notesPath: 'docs/planning/first.md',
  };
  const CREATED_SOURCE_IDS = [
    'snsrc_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'snsrc_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  ];
  const syncedNoteSourceState = {
    sources: [{ ...DEFAULT_SOURCE }],
    activeSourceId: '',
    createdCount: 0,
  };
  const resetSyncedNoteSourceState = () => {
    syncedNoteSourceState.sources = [{ ...DEFAULT_SOURCE }];
    syncedNoteSourceState.activeSourceId = '';
    syncedNoteSourceState.createdCount = 0;
  };
  const buildSourceResolution = () => {
    const availableSources = syncedNoteSourceState.sources.map((source) => ({ ...source }));
    const activeSourceConfigured = Boolean(syncedNoteSourceState.activeSourceId);
    const effectiveSource = activeSourceConfigured
      ? availableSources.find((source) => source.id === syncedNoteSourceState.activeSourceId) || null
      : null;

    if (effectiveSource) {
      return {
        availableSources,
        activeSourceConfigured,
        activeSourceId: syncedNoteSourceState.activeSourceId,
        activeSourceMatched: true,
        effectiveSource,
        requiresSource: true,
        resolved: true,
        reason: 'active_source_selected',
        message: 'Using the tracker synced-note source selected for this repo.',
      };
    }

    if (activeSourceConfigured) {
      return {
        availableSources,
        activeSourceConfigured,
        activeSourceId: syncedNoteSourceState.activeSourceId,
        activeSourceMatched: false,
        effectiveSource: null,
        requiresSource: true,
        resolved: false,
        reason: 'active_source_missing',
        message: 'The persisted synced-note source selection no longer exists in tracker.',
      };
    }

    if (availableSources.length === 0) {
      return {
        availableSources,
        activeSourceId: undefined,
        activeSourceMatched: false,
        effectiveSource: null,
        requiresSource: true,
        resolved: false,
        reason: 'no_tracker_sources',
        message: 'No tracker synced-note sources are available for this repo.',
      };
    }

    return {
      availableSources,
      activeSourceConfigured: false,
      activeSourceId: undefined,
      activeSourceMatched: false,
      effectiveSource: null,
      requiresSource: true,
      resolved: false,
      reason: 'explicit_source_selection_required',
      message: availableSources.length === 1
        ? 'A tracker synced-note source is available, but this repo must explicitly select it before an effective source is resolved.'
        : 'Tracker synced-note sources are available, but this repo must explicitly select one before an effective source is resolved.',
    };
  };
  const buildObsidianStatus = (overrides: Record<string, unknown> = {}) => {
    const sourceResolution = buildSourceResolution();
    return {
      state: 'ready',
      configured: true,
      readAvailable: true,
      syncAvailable: sourceResolution.resolved,
      external: true,
      canonicalAuthority: false,
      message: 'External Obsidian notes are available.',
      notesDirectoryPath: 'C:\\Vault\\Planning\\repo-1',
      sourceResolution,
      ...overrides,
    };
  };
  const cloneJson = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
  const INITIAL_BACKLOG_ITEMS = [
    {
      id: 'RB-001',
      title: 'Establish backlog/roadmap workflow',
      status: 'proposed',
      summary: 'Keep backlog authority explicit in Planning.',
      roadmapIds: ['RM-platform-foundation-001'],
      planRefs: ['plan-123'],
      keyPoints: [],
    },
  ];
  const INITIAL_BULLETS = [
    {
      kind: 'planning.bullet.artifact',
      schemaVersion: 1,
      id: 'PB-001',
      title: 'Establish backlog/roadmap workflow',
      state: 'pre-plan',
      repoId: 'repo-1',
      summary: 'Keep backlog authority explicit in Planning.',
      notes: ['Reuse existing backlog items when promoting to the roadmap.'],
      promotedPlanRefs: ['plan-123'],
      promotedBacklogRefs: ['RB-001'],
      promotedRoadmapRefs: [],
      filePath: 'C:\\Repos\\instruction-engine\\docs\\planning\\bullets.md',
      repoRelativePath: 'docs/planning/bullets.md',
    },
  ];
  const INITIAL_ROADMAPS = [
    {
      slug: 'platform-foundation',
      title: 'Platform Foundation',
      filePath: 'C:\\Repos\\instruction-engine\\docs\\roadmaps\\platform-foundation.md',
      repoRelativePath: 'docs/roadmaps/platform-foundation.md',
      overview: 'Stage repo work into phased outcomes.',
      items: [
        {
          id: 'RM-platform-foundation-001',
          title: 'Establish backlog/roadmap workflow',
          phase: 'foundation',
          status: 'queued',
          backlogIds: ['RB-001'],
          planRefs: [],
        },
      ],
    },
  ];
  const planningMutationState = {
    bullets: cloneJson(INITIAL_BULLETS),
    backlogItems: cloneJson(INITIAL_BACKLOG_ITEMS),
    roadmaps: cloneJson(INITIAL_ROADMAPS),
    nextBacklogNumber: 2,
  };
  const resetPlanningMutationState = () => {
    planningMutationState.bullets = cloneJson(INITIAL_BULLETS);
    planningMutationState.backlogItems = cloneJson(INITIAL_BACKLOG_ITEMS);
    planningMutationState.roadmaps = cloneJson(INITIAL_ROADMAPS);
    planningMutationState.nextBacklogNumber = 2;
  };
  const buildBulletsResponse = () => ({
    exists: true,
    filePath: 'C:\\Repos\\instruction-engine\\docs\\planning\\bullets.md',
    repoRelativePath: 'docs/planning/bullets.md',
    stableIdPattern: 'PB-###',
    supportedStates: ['idea', 'research', 'pre-plan'],
    bulletCount: planningMutationState.bullets.length,
  });
  const buildBacklogSummary = () => ({
    backlogPath: 'C:\\Repos\\instruction-engine\\docs\\backlog.md',
    repoRelativePath: 'docs/backlogs',
    primaryDirectoryPath: 'C:\\Repos\\instruction-engine\\docs\\backlogs',
    primaryRepoRelativePath: 'docs/backlogs',
    primaryFamilyRepoRelativePath: 'docs/backlogs/*.md',
    legacyBacklogPath: 'C:\\Repos\\instruction-engine\\docs\\backlog.md',
    legacyRepoRelativePath: 'docs/backlog.md',
    resolvedBacklogPaths: ['C:\\Repos\\instruction-engine\\docs\\backlog.md'],
    resolvedRepoRelativePaths: ['docs/backlog.md'],
    exists: true,
    stableIdPattern: 'RB-###',
    description: 'Repo-scoped intake and queued work for the selected repo.',
    itemCount: planningMutationState.backlogItems.length,
    items: cloneJson(planningMutationState.backlogItems),
  });
  const buildRoadmaps = () => cloneJson(planningMutationState.roadmaps).map((roadmap) => {
    const statusCounts = roadmap.items.reduce<Record<string, number>>((acc, item) => {
      const status = String(item.status || '').trim() || 'planned';
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {});
    return {
      ...roadmap,
      itemCount: roadmap.items.length,
      statusCounts,
    };
  });

  return {
    ...actual,
    getPlanningIntakeArtifacts: vi.fn(async () => ({
      count: 1,
      intake: {
        directoryPath: 'C:\\Repos\\instruction-engine\\docs\\planning\\intake',
        repoRelativePath: 'docs/planning/intake',
        exists: true,
        artifactCount: 1,
        stableIdPattern: 'PI-###',
        supportedCategories: ['idea', 'research', 'refactor-candidate', 'design-complaint', 'audit-request', 'roadmap-request', 'review-prep', 'commit-prep'],
      },
      artifacts: [
        {
          kind: 'planning.intake.artifact',
          schemaVersion: 1,
          id: 'PI-001',
          category: 'idea',
          title: 'Capture planning intake',
          summary: 'Persist repo-backed intake artifacts.',
          acceptanceCriteria: ['Write tests'],
          targetRepoIds: ['repo-1'],
          planningState: 'thought',
          createdAt: '2026-03-18T00:00:00.000Z',
          updatedAt: '2026-03-18T00:00:00.000Z',
          filePath: 'C:\\Repos\\instruction-engine\\docs\\planning\\intake\\PI-001.json',
          repoRelativePath: 'docs/planning/intake/PI-001.json',
        },
      ],
      repo: {
        repoId: 'repo-1',
        repoPath: 'C:\\Repos\\instruction-engine',
        repoLabel: 'Instruction Engine',
      },
    })),
    getPlanningBullets: vi.fn(async () => ({
      count: planningMutationState.bullets.length,
      bullets: buildBulletsResponse(),
      artifacts: cloneJson(planningMutationState.bullets),
      repo: {
        repoId: 'repo-1',
        repoPath: 'C:\Repos\instruction-engine',
        repoLabel: 'Instruction Engine',
      },
    })),
    getPlanningRoadmaps: vi.fn(async () => ({
      count: buildRoadmaps().length,
      roadmaps: buildRoadmaps(),
      repo: {
        repoId: 'repo-1',
        repoPath: 'C:\\Repos\\instruction-engine',
        repoLabel: 'Instruction Engine',
      },
    })),
    getPlanningBacklog: vi.fn(async () => ({
      repo: {
        repoId: 'repo-1',
        repoPath: 'C:\Repos\instruction-engine',
        repoLabel: 'Instruction Engine',
      },
      backlog: buildBacklogSummary(),
    })),
    getPlanningObsidianStatus: vi.fn(async () => ({
      repo: {
        repoId: 'repo-1',
        repoPath: 'C:\\Repos\\instruction-engine',
        repoLabel: 'Instruction Engine',
      },
      status: buildObsidianStatus({
        cli: {
          state: 'ready',
          message: 'Obsidian CLI probe succeeded.',
        },
        remoteSync: {
          state: 'idle',
          configured: true,
          pollEnabled: true,
          pollIntervalMs: 60000,
          message: 'Remote pull sync is configured and waiting for the next poll.',
          conflictCount: 0,
          appliedCount: 0,
          deletedCount: 0,
          skippedCount: 0,
        },
      }),
    })),
    getPlanningObsidianRepresentationsStatus: vi.fn(async () => ({
      repo: {
        repoId: 'repo-1',
        repoPath: 'C:\\Repos\\instruction-engine',
        repoLabel: 'Instruction Engine',
      },
      status: {
        state: 'ready',
        configured: true,
        readAvailable: true,
        syncAvailable: true,
        external: true,
        canonicalAuthority: false,
        message: 'External Obsidian notes are available.',
        notesDirectoryPath: 'C:\\Vault\\Planning\\repo-1',
      },
      representationsStatus: {
        totalCount: 2,
        writeAvailable: true,
        currentCount: 1,
        staleCount: 1,
        missingCount: 0,
        invalidCount: 0,
        sourceMissingCount: 0,
        message: 'Deterministic Obsidian planning mirrors are available for generation and freshness checks.',
      },
    })),
    listPlanningObsidianNotes: vi.fn(async () => ({
      count: 1,
      repo: {
        repoId: 'repo-1',
        repoPath: 'C:\\Repos\\instruction-engine',
        repoLabel: 'Instruction Engine',
      },
      status: buildObsidianStatus({
        cli: {
          state: 'ready',
          message: 'Obsidian CLI probe succeeded.',
        },
        remoteSync: {
          state: 'idle',
          configured: true,
          pollEnabled: true,
          pollIntervalMs: 60000,
          message: 'Remote pull sync is configured and waiting for the next poll.',
          conflictCount: 0,
          appliedCount: 0,
          deletedCount: 0,
          skippedCount: 0,
        },
      }),
      notes: [
        {
          kind: 'synced-note',
          provider: 'obsidian',
          id: 'obsnote_1234',
          title: 'External planning note',
          summary: 'Review external planning context.',
          repoId: 'repo-1',
          targetRepoIds: ['repo-1'],
          vaultName: 'Planning',
          notePath: 'Planning/repo-1/external-planning-note.md',
          filePath: 'C:\\Vault\\Planning\\repo-1\\external-planning-note.md',
          lastModifiedAt: '2026-03-23T00:00:00.000Z',
          external: true,
          canonicalAuthority: false,
        },
      ],
    })),
    listPlanningObsidianRepresentations: vi.fn(async () => ({
      count: 2,
      repo: {
        repoId: 'repo-1',
        repoPath: 'C:\\Repos\\instruction-engine',
        repoLabel: 'Instruction Engine',
      },
      status: {
        state: 'ready',
        configured: true,
        readAvailable: true,
        syncAvailable: true,
        external: true,
        canonicalAuthority: false,
        message: 'External Obsidian notes are available.',
        notesDirectoryPath: 'C:\\Vault\\Planning\\repo-1',
      },
      representationsStatus: {
        totalCount: 2,
        writeAvailable: true,
        currentCount: 1,
        staleCount: 1,
        missingCount: 0,
        invalidCount: 0,
        sourceMissingCount: 0,
        message: 'Deterministic Obsidian planning mirrors are available for generation and freshness checks.',
      },
      representations: [
        {
          kind: 'planning-representation',
          provider: 'obsidian',
          id: 'obsrep_bullets',
          representationKind: 'bullets',
          title: 'Planning Bullets Mirror',
          summary: 'Deterministic Obsidian mirror of docs/planning/bullets.md.',
          repoId: 'repo-1',
          targetRepoIds: ['repo-1'],
          sourceExists: true,
          sourceFilePath: 'C:\\Repos\\instruction-engine\\docs\\planning\\bullets.md',
          sourceRepoRelativePath: 'docs/planning/bullets.md',
          sourceUpdatedAt: '2026-03-23T00:00:00.000Z',
          sourceContentHash: 'hash-bullets',
          notePath: 'Planning/repo-1/_instruction-engine/planning-mirrors/bullets.md',
          filePath: 'C:\\Vault\\Planning\\repo-1\\_instruction-engine\\planning-mirrors\\bullets.md',
          noteExists: true,
          noteUpdatedAt: '2026-03-23T00:05:00.000Z',
          generatedAt: '2026-03-23T00:05:00.000Z',
          freshness: 'current',
          metadataValid: true,
          external: true,
          canonicalAuthority: false,
          message: 'Mirror matches the current canonical repo artifact.',
          bulletCount: 1,
        },
        {
          kind: 'planning-representation',
          provider: 'obsidian',
          id: 'obsrep_roadmap',
          representationKind: 'roadmap',
          title: 'Roadmap Mirror — Platform Foundation',
          summary: 'Deterministic Obsidian mirror of docs/roadmaps/platform-foundation.md.',
          repoId: 'repo-1',
          targetRepoIds: ['repo-1'],
          roadmapSlug: 'platform-foundation',
          sourceExists: true,
          sourceFilePath: 'C:\\Repos\\instruction-engine\\docs\\roadmaps\\platform-foundation.md',
          sourceRepoRelativePath: 'docs/roadmaps/platform-foundation.md',
          sourceUpdatedAt: '2026-03-23T00:00:00.000Z',
          sourceContentHash: 'hash-roadmap',
          notePath: 'Planning/repo-1/_instruction-engine/planning-mirrors/roadmaps/platform-foundation.md',
          filePath: 'C:\\Vault\\Planning\\repo-1\\_instruction-engine\\planning-mirrors\\roadmaps\\platform-foundation.md',
          noteExists: true,
          noteUpdatedAt: '2026-03-23T00:05:00.000Z',
          generatedAt: '2026-03-23T00:05:00.000Z',
          freshness: 'stale',
          metadataValid: true,
          external: true,
          canonicalAuthority: false,
          message: 'Canonical repo artifact changed since the mirror was generated.',
          itemCount: 1,
        },
      ],
    })),
    getPlanningObsidianNote: vi.fn(async () => ({
      repo: {
        repoId: 'repo-1',
        repoPath: 'C:\\Repos\\instruction-engine',
        repoLabel: 'Instruction Engine',
      },
      status: buildObsidianStatus({
        cli: {
          state: 'ready',
          message: 'Obsidian CLI probe succeeded.',
        },
        remoteSync: {
          state: 'idle',
          configured: true,
          pollEnabled: true,
          pollIntervalMs: 60000,
          message: 'Remote pull sync is configured and waiting for the next poll.',
          conflictCount: 0,
          appliedCount: 0,
          deletedCount: 0,
          skippedCount: 0,
        },
      }),
      note: {
        kind: 'synced-note',
        provider: 'obsidian',
        id: 'obsnote_1234',
        title: 'External planning note',
        summary: 'Review external planning context.',
        repoId: 'repo-1',
        targetRepoIds: ['repo-1'],
        vaultName: 'Planning',
        notePath: 'Planning/repo-1/external-planning-note.md',
        filePath: 'C:\\Vault\\Planning\\repo-1\\external-planning-note.md',
        lastModifiedAt: '2026-03-23T00:00:00.000Z',
        external: true,
        canonicalAuthority: false,
        content: '# External planning note\n\nReview external planning context.',
        headings: ['External planning note'],
      },
    })),
    triggerPlanningObsidianSync: vi.fn(async () => ({
      repo: {
        repoId: 'repo-1',
        repoPath: 'C:\\Repos\\instruction-engine',
        repoLabel: 'Instruction Engine',
      },
      status: buildObsidianStatus({
        cli: {
          state: 'ready',
          message: 'Obsidian CLI probe succeeded.',
        },
        remoteSync: {
          state: 'success',
          configured: true,
          pollEnabled: true,
          pollIntervalMs: 60000,
          message: 'Remote Obsidian sync applied 1 update(s) and 0 deletion(s).',
          conflictCount: 0,
          appliedCount: 1,
          deletedCount: 0,
          skippedCount: 0,
        },
      }),
      result: {
        state: 'success',
        appliedCount: 1,
        deletedCount: 0,
        skippedCount: 0,
        conflictCount: 0,
      },
    })),
    refreshPlanningObsidianRepresentations: vi.fn(async () => ({
      count: 2,
      repo: {
        repoId: 'repo-1',
        repoPath: 'C:\\Repos\\instruction-engine',
        repoLabel: 'Instruction Engine',
      },
      status: buildObsidianStatus(),
      representationsStatus: {
        totalCount: 2,
        writeAvailable: true,
        currentCount: 2,
        staleCount: 0,
        missingCount: 0,
        invalidCount: 0,
        sourceMissingCount: 0,
        message: 'Deterministic Obsidian planning mirrors are available for generation and freshness checks.',
      },
      representations: [
        {
          kind: 'planning-representation',
          provider: 'obsidian',
          id: 'obsrep_bullets',
          representationKind: 'bullets',
          title: 'Planning Bullets Mirror',
          summary: 'Deterministic Obsidian mirror of docs/planning/bullets.md.',
          repoId: 'repo-1',
          targetRepoIds: ['repo-1'],
          sourceExists: true,
          sourceRepoRelativePath: 'docs/planning/bullets.md',
          notePath: 'Planning/repo-1/_instruction-engine/planning-mirrors/bullets.md',
          noteExists: true,
          freshness: 'current',
          metadataValid: true,
          external: true,
          canonicalAuthority: false,
          message: 'Mirror matches the current canonical repo artifact.',
        },
        {
          kind: 'planning-representation',
          provider: 'obsidian',
          id: 'obsrep_roadmap',
          representationKind: 'roadmap',
          title: 'Roadmap Mirror — Platform Foundation',
          summary: 'Deterministic Obsidian mirror of docs/roadmaps/platform-foundation.md.',
          repoId: 'repo-1',
          targetRepoIds: ['repo-1'],
          roadmapSlug: 'platform-foundation',
          sourceExists: true,
          sourceRepoRelativePath: 'docs/roadmaps/platform-foundation.md',
          notePath: 'Planning/repo-1/_instruction-engine/planning-mirrors/roadmaps/platform-foundation.md',
          noteExists: true,
          freshness: 'current',
          metadataValid: true,
          external: true,
          canonicalAuthority: false,
          message: 'Mirror matches the current canonical repo artifact.',
        },
      ],
      result: {
        refreshedCount: 2,
        skippedCount: 0,
        skippedIds: [],
      },
    })),
    createPlanningBacklogItem: vi.fn(async (payload: import('../ui/src/lib/api').PlanningBacklogCreatePayload) => {
      const source = payload.item && typeof payload.item === 'object' ? payload.item : payload;
      const backlogId = `RB-${String(planningMutationState.nextBacklogNumber).padStart(3, '0')}`;
      planningMutationState.nextBacklogNumber += 1;
      const item = {
        id: backlogId,
        title: String(source.title || '').trim() || backlogId,
        status: String(source.status || 'proposed').trim() || 'proposed',
        summary: typeof source.summary === 'string' ? source.summary.trim() || undefined : undefined,
        roadmapIds: Array.isArray(source.roadmapIds) ? [...source.roadmapIds] : [],
        planRefs: Array.isArray(source.planRefs) ? [...source.planRefs] : [],
        keyPoints: Array.isArray(source.keyPoints) ? cloneJson(source.keyPoints) : [],
      };
      planningMutationState.backlogItems = [...planningMutationState.backlogItems, item];

      return {
        repo: {
          repoId: 'repo-1',
          repoPath: 'C:\\Repos\\instruction-engine',
          repoLabel: 'Instruction Engine',
        },
        backlog: buildBacklogSummary(),
        item,
      };
    }),
    updatePlanningBullet: vi.fn(async (bulletId: string, payload: import('../ui/src/lib/api').PlanningBulletUpdatePayload) => {
      const patch = payload.patch && typeof payload.patch === 'object'
        ? payload.patch
        : (payload.bullet && typeof payload.bullet === 'object' ? payload.bullet : payload);
      planningMutationState.bullets = planningMutationState.bullets.map((bullet) => (
        bullet.id !== bulletId
          ? bullet
          : {
            ...bullet,
            ...patch,
            title: typeof patch.title === 'string' && patch.title.trim() ? patch.title.trim() : bullet.title,
            state: typeof patch.state === 'string' && patch.state.trim() ? patch.state.trim() : bullet.state,
            repoId: typeof patch.repoId === 'string' && patch.repoId.trim() ? patch.repoId.trim() : bullet.repoId,
            summary: typeof patch.summary === 'string' ? patch.summary.trim() : bullet.summary,
            notes: Array.isArray(patch.notes) ? [...patch.notes] : bullet.notes,
            promotedPlanRefs: Array.isArray(patch.promotedPlanRefs) ? [...patch.promotedPlanRefs] : bullet.promotedPlanRefs,
            promotedBacklogRefs: Array.isArray(patch.promotedBacklogRefs) ? [...patch.promotedBacklogRefs] : bullet.promotedBacklogRefs,
            promotedRoadmapRefs: Array.isArray(patch.promotedRoadmapRefs) ? [...patch.promotedRoadmapRefs] : bullet.promotedRoadmapRefs,
          }
      ));

      return {
        count: planningMutationState.bullets.length,
        bullets: buildBulletsResponse(),
        artifact: cloneJson(planningMutationState.bullets.find((bullet) => bullet.id === bulletId) || null),
        artifacts: cloneJson(planningMutationState.bullets),
        repo: {
          repoId: 'repo-1',
          repoPath: 'C:\Repos\instruction-engine',
          repoLabel: 'Instruction Engine',
        },
      };
    }),
    updatePlanningRoadmap: vi.fn(async (
      roadmapSlug: string,
      payload: import('../ui/src/lib/api').PlanningRoadmapUpdatePayload,
    ) => {
      const roadmapIndex = planningMutationState.roadmaps.findIndex((roadmap) => roadmap.slug === roadmapSlug);
      const existingRoadmap = planningMutationState.roadmaps[roadmapIndex];
      const nextRoadmap = {
        ...existingRoadmap,
        title: typeof payload.title === 'string' && payload.title.trim() ? payload.title.trim() : existingRoadmap.title,
        overview: typeof payload.overview === 'string' && payload.overview.trim() ? payload.overview.trim() : existingRoadmap.overview,
        items: payload.replaceItems === true ? [] : existingRoadmap.items.map((item) => ({ ...item })),
      };
      const itemPayloads = [
        ...(payload.item ? [payload.item] : []),
        ...(Array.isArray(payload.items) ? payload.items : []),
      ];

      itemPayloads.forEach((rawItem) => {
        const explicitId = typeof rawItem.id === 'string' ? rawItem.id.trim() : '';
        const existingIndex = explicitId
          ? nextRoadmap.items.findIndex((item) => item.id === explicitId)
          : -1;

        if (existingIndex >= 0) {
          nextRoadmap.items[existingIndex] = {
            ...nextRoadmap.items[existingIndex],
            ...rawItem,
            id: nextRoadmap.items[existingIndex].id,
            title: typeof rawItem.title === 'string' && rawItem.title.trim()
              ? rawItem.title.trim()
              : nextRoadmap.items[existingIndex].title,
            phase: typeof rawItem.phase === 'string' && rawItem.phase.trim()
              ? rawItem.phase.trim()
              : nextRoadmap.items[existingIndex].phase,
            status: typeof rawItem.status === 'string' && rawItem.status.trim()
              ? rawItem.status.trim()
              : nextRoadmap.items[existingIndex].status,
            summary: typeof rawItem.summary === 'string'
              ? rawItem.summary.trim() || undefined
              : nextRoadmap.items[existingIndex].summary,
            backlogIds: Array.isArray(rawItem.backlogIds)
              ? [...rawItem.backlogIds]
              : nextRoadmap.items[existingIndex].backlogIds,
            planRefs: Array.isArray(rawItem.planRefs)
              ? [...rawItem.planRefs]
              : nextRoadmap.items[existingIndex].planRefs,
          };
          return;
        }

        const nextId = `RM-${roadmapSlug}-${String(nextRoadmap.items.length + 1).padStart(3, '0')}`;
        nextRoadmap.items.push({
          id: nextId,
          title: typeof rawItem.title === 'string' && rawItem.title.trim() ? rawItem.title.trim() : nextId,
          phase: typeof rawItem.phase === 'string' && rawItem.phase.trim() ? rawItem.phase.trim() : 'unscheduled',
          status: typeof rawItem.status === 'string' && rawItem.status.trim() ? rawItem.status.trim() : 'planned',
          summary: typeof rawItem.summary === 'string' ? rawItem.summary.trim() || undefined : undefined,
          backlogIds: Array.isArray(rawItem.backlogIds) ? [...rawItem.backlogIds] : [],
          planRefs: Array.isArray(rawItem.planRefs) ? [...rawItem.planRefs] : [],
        });
      });

      planningMutationState.roadmaps[roadmapIndex] = nextRoadmap;
      return {
        repo: {
          repoId: 'repo-1',
          repoPath: 'C:\\Repos\\instruction-engine',
          repoLabel: 'Instruction Engine',
        },
        roadmap: buildRoadmaps().find((roadmap) => roadmap.slug === roadmapSlug) || null,
      };
    }),
    updatePlanningBacklogItem: vi.fn(async (
      itemId: string,
      payload: import('../ui/src/lib/api').PlanningBacklogUpdatePayload,
    ) => {
      const patch = payload.item && typeof payload.item === 'object'
        ? payload.item
        : (payload.patch && typeof payload.patch === 'object' ? payload.patch : payload);
      planningMutationState.backlogItems = planningMutationState.backlogItems.map((item) => (
        item.id !== itemId
          ? item
          : {
            ...item,
            ...patch,
            title: typeof patch.title === 'string' && patch.title.trim() ? patch.title.trim() : item.title,
            status: typeof patch.status === 'string' && patch.status.trim() ? patch.status.trim() : item.status,
            summary: typeof patch.summary === 'string' ? patch.summary.trim() || undefined : item.summary,
            roadmapIds: Array.isArray(patch.roadmapIds) ? [...patch.roadmapIds] : item.roadmapIds,
            planRefs: Array.isArray(patch.planRefs) ? [...patch.planRefs] : item.planRefs,
            keyPoints: Array.isArray(patch.keyPoints) ? cloneJson(patch.keyPoints) : item.keyPoints,
          }
      ));

      return {
        repo: {
          repoId: 'repo-1',
          repoPath: 'C:\\Repos\\instruction-engine',
          repoLabel: 'Instruction Engine',
        },
        backlog: buildBacklogSummary(),
        item: buildBacklogSummary().items.find((item) => item.id === itemId) || null,
      };
    }),
    setPlanningObsidianSourceSelection: vi.fn(async (sourceId: string | null | undefined) => {
      syncedNoteSourceState.activeSourceId = typeof sourceId === 'string' ? sourceId.trim() : '';
      return {
        repo: {
          repoId: 'repo-1',
          repoPath: 'C:\Repos\instruction-engine',
          repoLabel: 'Instruction Engine',
        },
        status: buildObsidianStatus(),
        sourceSelection: buildSourceResolution(),
      };
    }),
    createTrackerSyncedNoteSource: vi.fn(async (payload: import('../ui/src/lib/types').SyncedNoteSourceLocator) => {
      const nextId = CREATED_SOURCE_IDS[syncedNoteSourceState.createdCount] || `snsrc_${'c'.repeat(32)}`;
      syncedNoteSourceState.createdCount += 1;
      const record = {
        id: nextId,
        ...payload,
        createdAt: '2026-03-24T00:00:00.000Z',
        updatedAt: '2026-03-24T00:00:00.000Z',
      };
      syncedNoteSourceState.sources = [...syncedNoteSourceState.sources, record];
      return record;
    }),
    updateTrackerSyncedNoteSource: vi.fn(async (
      sourceId: string,
      payload: import('../ui/src/lib/types').SyncedNoteSourceLocator,
    ) => {
      const existing = syncedNoteSourceState.sources.find((source) => source.id === sourceId);
      const record = {
        id: sourceId,
        ...payload,
        createdAt: existing?.createdAt || '2026-03-24T00:00:00.000Z',
        updatedAt: '2026-03-24T00:05:00.000Z',
      };
      syncedNoteSourceState.sources = syncedNoteSourceState.sources.map((source) => (
        source.id === sourceId ? record : source
      ));
      return record;
    }),
    deleteTrackerSyncedNoteSource: vi.fn(async (sourceId: string) => {
      syncedNoteSourceState.sources = syncedNoteSourceState.sources.filter((source) => source.id !== sourceId);
      if (syncedNoteSourceState.activeSourceId === sourceId) {
        syncedNoteSourceState.activeSourceId = '';
      }
      return {
        ok: true,
        id: sourceId,
      };
    }),
    __resetSyncedNoteSourceMocks: resetSyncedNoteSourceState,
    __resetPlanningMutationMocks: resetPlanningMutationState,
  };
});

import { createPlanningWorkspaceStore } from '../ui/src/tabs/Planning/planningWorkspaceStore';
import * as planningApi from '../ui/src/lib/api';

describe('planningWorkspaceStore', () => {
  beforeEach(() => {
    (planningApi as typeof planningApi & { __resetSyncedNoteSourceMocks?: () => void }).__resetSyncedNoteSourceMocks?.();
    (planningApi as typeof planningApi & { __resetPlanningMutationMocks?: () => void }).__resetPlanningMutationMocks?.();
  });

  it('derives canonical repository backlog and roadmap refs from Catalog repo context', () => {
    const store = createPlanningWorkspaceStore();

    store.syncCatalogRepoContext({
      repoId: 'repo-1',
      repoPath: 'C:\\Repos\\instruction-engine',
      repoLabel: 'Instruction Engine',
      sources: ['workspace', 'selected'],
    });

    expect(store.getState()).toMatchObject({
      catalogRepoContext: {
        repoId: 'repo-1',
        repoPath: 'C:\\Repos\\instruction-engine',
        repoLabel: 'Instruction Engine',
        sources: ['workspace', 'selected'],
      },
      intakeFilters: {
        category: '__all__',
        planningState: '__all__',
        targetRepoId: '__all__',
      },
      planningIntakeDirectory: {
        canonicalName: 'Planning Intake',
        directoryPath: 'C:\\Repos\\instruction-engine\\docs\\planning\\intake',
        stableIdPattern: 'PI-###',
        supportedCategories: ['idea', 'research', 'refactor-candidate', 'design-complaint', 'audit-request', 'roadmap-request', 'review-prep', 'commit-prep'],
      },
      repositoryBacklog: {
        canonicalName: 'Repository Backlog',
        filePath: 'C:\\Repos\\instruction-engine\\docs\\backlogs',
        repoRelativePath: 'docs/backlogs',
        primaryDirectoryPath: 'C:\\Repos\\instruction-engine\\docs\\backlogs',
        primaryRepoRelativePath: 'docs/backlogs',
        primaryFamilyRepoRelativePath: 'docs/backlogs/*.md',
        legacyFilePath: 'C:\\Repos\\instruction-engine\\docs\\backlog.md',
        legacyRepoRelativePath: 'docs/backlog.md',
        stableIdPattern: 'RB-###',
      },
      roadmapDirectory: {
        canonicalName: 'Roadmap',
        directoryPath: 'C:\\Repos\\instruction-engine\\docs\\roadmaps',
        stableIdPattern: 'RM-<roadmap-slug>-###',
      },
    });
  });

  it('loads roadmaps against the synced repo context and keeps roadmap selection in workspace state', async () => {
    const store = createPlanningWorkspaceStore();

    store.syncCatalogRepoContext({
      repoId: 'repo-1',
      repoPath: 'C:\\Repos\\instruction-engine',
      repoLabel: 'Instruction Engine',
      sources: ['workspace'],
    });

    await store.loadRoadmaps();
    await store.loadIntakeArtifacts();

    expect(store.getState().roadmaps).toHaveLength(1);
    expect(store.getState().intakeArtifacts).toHaveLength(1);
    expect(store.getState().selectedRoadmapSlug).toBe('platform-foundation');

    store.setSelectedRoadmapSlug('platform-foundation');
    expect(store.getState().selectedRoadmapSlug).toBe('platform-foundation');
  });

  it('loads external obsidian notes for the selected repo without changing canonical planning authority', async () => {
    const store = createPlanningWorkspaceStore();

    store.syncCatalogRepoContext({
      repoId: 'repo-1',
      repoPath: 'C:\\Repos\\instruction-engine',
      repoLabel: 'Instruction Engine',
      sources: ['workspace'],
    });

    await store.loadObsidianNotes();

    expect(store.getState().obsidianStatus).toMatchObject({
      state: 'ready',
      external: true,
      canonicalAuthority: false,
    });
    expect(store.getState().obsidianNotes).toHaveLength(1);
    expect(store.getState().selectedObsidianNoteId).toBe('obsnote_1234');
    expect(store.getState().selectedObsidianNote?.title).toBe('External planning note');
  });

  it('loads deterministic obsidian planning mirrors for canonical bullets and roadmaps', async () => {
    const store = createPlanningWorkspaceStore();

    store.syncCatalogRepoContext({
      repoId: 'repo-1',
      repoPath: 'C:\\Repos\\instruction-engine',
      repoLabel: 'Instruction Engine',
      sources: ['workspace'],
    });

    await store.loadObsidianRepresentations();

    expect(store.getState().obsidianRepresentationsStatus).toMatchObject({
      totalCount: 2,
      writeAvailable: true,
      currentCount: 1,
      staleCount: 1,
    });
    expect(store.getState().obsidianRepresentations).toHaveLength(2);
    expect(store.getState().obsidianRepresentations[0]).toMatchObject({
      external: true,
      canonicalAuthority: false,
    });
  });

  it('runs manual obsidian sync and refreshes the workspace note inventory', async () => {
    const store = createPlanningWorkspaceStore();

    store.syncCatalogRepoContext({
      repoId: 'repo-1',
      repoPath: 'C:\\Repos\\instruction-engine',
      repoLabel: 'Instruction Engine',
      sources: ['workspace'],
    });

    await store.syncObsidianNotes();

    expect(store.getState().obsidianNotes).toHaveLength(1);
    expect(store.getState().obsidianSyncing).toBe(false);
    expect(store.getState().obsidianStatus?.remoteSync?.state).toBe('idle');
  });

  it('refreshes deterministic obsidian planning mirrors from canonical repo artifacts', async () => {
    const store = createPlanningWorkspaceStore();

    store.syncCatalogRepoContext({
      repoId: 'repo-1',
      repoPath: 'C:\\Repos\\instruction-engine',
      repoLabel: 'Instruction Engine',
      sources: ['workspace'],
    });

    await store.refreshObsidianRepresentationsInVault();

    expect(store.getState().obsidianRepresentationsRefreshing).toBe(false);
    expect(store.getState().obsidianRepresentationsStatus?.currentCount).toBe(2);
    expect(store.getState().obsidianRepresentations).toHaveLength(2);
  });

  it('promotes an external obsidian note into the canonical backlog with explicit provenance', async () => {
    const store = createPlanningWorkspaceStore();

    store.syncCatalogRepoContext({
      repoId: 'repo-1',
      repoPath: 'C:\\Repos\\instruction-engine',
      repoLabel: 'Instruction Engine',
      sources: ['workspace'],
    });

    await store.loadObsidianNotes();

    const note = store.getState().selectedObsidianNote;
    const backlogId = await store.promoteObsidianNoteToBacklog(note!);

    expect(backlogId).toBe('RB-002');
    expect(vi.mocked(planningApi.createPlanningBacklogItem)).toHaveBeenCalledWith({
      repoId: 'repo-1',
      repoPath: 'C:\\Repos\\instruction-engine',
      item: {
        title: 'External planning note',
        summary: 'Promoted from external/non-canonical Obsidian note obsnote_1234 at Planning/repo-1/external-planning-note.md. External note summary: Review external planning context. Canonical backlog, roadmaps, and the active session plan remain authoritative.',
        status: 'proposed',
      },
    });
    expect(store.getState().backlogSummary?.items.some((item) => item.id === 'RB-002')).toBe(true);
    expect(store.getState().obsidianPromotionSaving).toBe(false);
  });

  it('promotes an external obsidian note into the selected roadmap via canonical backlog and roadmap mutations', async () => {
    const store = createPlanningWorkspaceStore();

    store.syncCatalogRepoContext({
      repoId: 'repo-1',
      repoPath: 'C:\\Repos\\instruction-engine',
      repoLabel: 'Instruction Engine',
      sources: ['workspace'],
    });

    await Promise.all([store.loadObsidianNotes(), store.loadRoadmaps()]);

    const note = store.getState().selectedObsidianNote;
    const promotion = await store.promoteObsidianNoteToRoadmap(note!);

    expect(promotion).toEqual({
      backlogId: 'RB-002',
      roadmapItemId: 'RM-platform-foundation-002',
    });
    expect(vi.mocked(planningApi.updatePlanningRoadmap)).toHaveBeenCalledWith('platform-foundation', {
      repoId: 'repo-1',
      repoPath: 'C:\\Repos\\instruction-engine',
      repoLabel: 'Instruction Engine',
      items: [
        {
          title: 'External planning note',
          phase: 'foundation',
          status: 'planned',
          summary: 'Promoted from external/non-canonical Obsidian note obsnote_1234. External note summary: Review external planning context.',
          backlogIds: ['RB-002'],
          planRefs: [],
        },
      ],
    });
    expect(vi.mocked(planningApi.updatePlanningBacklogItem)).toHaveBeenCalledWith('RB-002', {
      repoId: 'repo-1',
      repoPath: 'C:\\Repos\\instruction-engine',
      item: {
        roadmapIds: ['RM-platform-foundation-002'],
      },
    });
    expect(store.getState().backlogSummary?.items.find((item) => item.id === 'RB-002')?.roadmapIds).toEqual([
      'RM-platform-foundation-002',
    ]);
    expect(store.getState().roadmaps[0]?.items.some((item) => item.id === 'RM-platform-foundation-002')).toBe(true);
    expect(store.getState().obsidianPromotionSaving).toBe(false);
  });

  it('promotes a bullet into the selected roadmap while reusing linked backlog ids', async () => {
    const store = createPlanningWorkspaceStore();

    store.syncCatalogRepoContext({
      repoId: 'repo-1',
      repoPath: 'C:\\Repos\\instruction-engine',
      repoLabel: 'Instruction Engine',
      sources: ['workspace'],
    });

    await Promise.all([store.loadBullets(), store.loadBacklog(), store.loadRoadmaps()]);

    const promotion = await store.promoteBulletToRoadmap('PB-001');

    expect(promotion).toEqual({
      backlogId: 'RB-001',
      roadmapItemId: 'RM-platform-foundation-002',
    });
    expect(vi.mocked(planningApi.createPlanningBacklogItem)).not.toHaveBeenCalled();
    expect(vi.mocked(planningApi.updatePlanningRoadmap)).toHaveBeenCalledWith('platform-foundation', {
      repoId: 'repo-1',
      repoPath: 'C:\\Repos\\instruction-engine',
      repoLabel: 'Instruction Engine',
      items: [
        {
          title: 'Establish backlog/roadmap workflow',
          phase: 'foundation',
          status: 'planned',
          summary: 'Promoted from PB-001. Keep backlog authority explicit in Planning. Notes: Reuse existing backlog items when promoting to the roadmap.',
          backlogIds: ['RB-001'],
          planRefs: [],
        },
      ],
    });
    expect(store.getState().bullets[0]?.promotedBacklogRefs).toEqual(['RB-001']);
    expect(store.getState().bullets[0]?.promotedRoadmapRefs).toEqual(['RM-platform-foundation-002']);
    expect(store.getState().backlogSummary?.items.find((item) => item.id === 'RB-001')?.roadmapIds).toEqual([
      'RM-platform-foundation-001',
      'RM-platform-foundation-002',
    ]);
  });

  it('persists synced-note source selection changes and refreshes obsidian status afterward', async () => {
    const store = createPlanningWorkspaceStore();

    store.syncCatalogRepoContext({
      repoId: 'repo-1',
      repoPath: 'C:\Repos\instruction-engine',
      repoLabel: 'Instruction Engine',
      sources: ['workspace'],
    });

    const created = await store.createObsidianSource({
      provider: 'github',
      host: 'github.com',
      owner: 'InstructionEngine',
      repo: 'workspace',
      branch: 'main',
      notesPath: 'docs/planning/second.md',
    });

    const getStatusMock = vi.mocked(planningApi.getPlanningObsidianStatus);
    const listNotesMock = vi.mocked(planningApi.listPlanningObsidianNotes);
    const initialStatusCalls = getStatusMock.mock.calls.length;
    const initialListCalls = listNotesMock.mock.calls.length;

    const selected = await store.setObsidianSourceSelection(created?.id || null);

    expect(selected).toBe(true);
    expect(vi.mocked(planningApi.setPlanningObsidianSourceSelection)).toHaveBeenCalledWith(
      created?.id || null,
      {
        repoId: 'repo-1',
        repoPath: 'C:\Repos\instruction-engine',
        repoLabel: 'Instruction Engine',
      }
    );
    expect(getStatusMock.mock.calls.length).toBeGreaterThan(initialStatusCalls);
    expect(listNotesMock.mock.calls.length).toBeGreaterThan(initialListCalls);
    expect(store.getState().obsidianStatus?.sourceResolution?.activeSourceId).toBe(created?.id);
    expect(store.getState().obsidianSourceSelectionSaving).toBe(false);

    await store.setObsidianSourceSelection(null);

    expect(store.getState().obsidianStatus?.sourceResolution?.activeSourceConfigured).toBe(false);
    expect(store.getState().obsidianStatus?.sourceResolution?.reason).toBe('explicit_source_selection_required');
  });

  it('creates, updates, and deletes synced-note sources while refreshing obsidian source resolution', async () => {
    const store = createPlanningWorkspaceStore();

    store.syncCatalogRepoContext({
      repoId: 'repo-1',
      repoPath: 'C:\Repos\instruction-engine',
      repoLabel: 'Instruction Engine',
      sources: ['workspace'],
    });

    await store.loadObsidianNotes();
    expect(store.getState().obsidianStatus?.sourceResolution?.availableSources).toHaveLength(1);

    const created = await store.createObsidianSource({
      provider: 'github',
      host: 'github.com',
      owner: 'InstructionEngine',
      repo: 'workspace',
      branch: 'main',
      notesPath: 'docs/planning/second.md',
    });

    expect(created?.id).toBe('snsrc_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(store.getState().obsidianStatus?.sourceResolution?.availableSources).toHaveLength(2);
    expect(store.getState().obsidianStatus?.sourceResolution?.reason).toBe('explicit_source_selection_required');

    const updated = await store.updateObsidianSource(created?.id || '', {
      provider: 'github',
      host: 'github.com',
      owner: 'InstructionEngineTeam',
      repo: 'workspace',
      branch: 'main',
      notesPath: 'docs/planning/second.md',
    });

    expect(updated?.owner).toBe('InstructionEngineTeam');
    expect(store.getState().obsidianStatus?.sourceResolution?.availableSources.some((source) => (
      source.id === created?.id && source.owner === 'InstructionEngineTeam'
    ))).toBe(true);
    expect(store.getState().obsidianSourceSaving).toBe(false);

    const deleted = await store.deleteObsidianSource(created?.id || '');

    expect(deleted).toBe(true);
    expect(store.getState().obsidianStatus?.sourceResolution?.availableSources).toHaveLength(1);
    expect(store.getState().obsidianStatus?.sourceResolution?.reason).toBe('explicit_source_selection_required');
    expect(store.getState().obsidianSourceDeletingId).toBeNull();
    expect(vi.mocked(planningApi.deleteTrackerSyncedNoteSource)).toHaveBeenCalledWith(created?.id || '');
  });

  it('tracks intake filters and resets them after switching to a different repo context', () => {
    const store = createPlanningWorkspaceStore();

    store.syncCatalogRepoContext({
      repoId: 'repo-1',
      repoPath: 'C:\\Repos\\instruction-engine',
      repoLabel: 'Instruction Engine',
      sources: ['workspace'],
    });

    store.setIntakeCategoryFilter('idea');
    store.setIntakePlanningStateFilter('thought');
    store.setIntakeTargetFilter('repo-1');

    expect(store.getState().intakeFilters).toEqual({
      category: 'idea',
      planningState: 'thought',
      targetRepoId: 'repo-1',
    });

    store.syncCatalogRepoContext({
      repoId: 'repo-1',
      repoPath: 'C:\\Repos\\instruction-engine',
      repoLabel: 'Instruction Engine (renamed)',
      sources: ['workspace', 'selected'],
    });
    expect(store.getState().intakeFilters).toEqual({
      category: 'idea',
      planningState: 'thought',
      targetRepoId: 'repo-1',
    });

    store.syncCatalogRepoContext({
      repoId: 'repo-2',
      repoPath: 'C:\\Repos\\other-repo',
      repoLabel: 'Other Repo',
      sources: ['workspace'],
    });
    expect(store.getState().intakeFilters).toEqual({
      category: '__all__',
      planningState: '__all__',
      targetRepoId: '__all__',
    });
  });
});
