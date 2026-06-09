import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';

// ─── Pure function tests: provenance ───

import { normalizeProvenance, compareProvenanceGroups } from './provenance';

describe('provenance normalization', () => {
  it('maps engine-assets paths to Copilot core', () => {
    const result = normalizeProvenance('engine-assets/skills/test-skill/SKILL.md');
    expect(result.group).toBe('Copilot core');
    expect(result.groupKey).toBe('copilot-core');
    expect(typeof result.order).toBe('number');
  });

  it('maps engine-assets sourceId to Copilot core', () => {
    const result = normalizeProvenance('', 'engine-assets');
    expect(result.group).toBe('Copilot core');
  });

  it('maps catalog-assets paths to Shared skills', () => {
    const result = normalizeProvenance('catalog-assets/shared-skills/foo/SKILL.md');
    expect(result.group).toBe('Shared skills');
  });

  it('maps shared-skills sourceId to Shared skills', () => {
    const result = normalizeProvenance('', 'shared-skills');
    expect(result.group).toBe('Shared skills');
  });

  it('maps catalog-assets sourceId to Shared skills', () => {
    const result = normalizeProvenance('', 'catalog-assets');
    expect(result.group).toBe('Shared skills');
  });

  it('maps codex-assets to Codex-specific', () => {
    const result = normalizeProvenance('codex-assets/skills/foo/SKILL.md');
    expect(result.group).toBe('Codex-specific');
  });

  it('maps codex-assets sourceId to Codex-specific', () => {
    const result = normalizeProvenance('', 'codex-assets');
    expect(result.group).toBe('Codex-specific');
  });

  it('maps opencode-assets to OpenCode-specific', () => {
    const result = normalizeProvenance('opencode-assets/skills/foo/SKILL.md');
    expect(result.group).toBe('OpenCode-specific');
  });

  it('maps opencode-assets sourceId to OpenCode-specific', () => {
    const result = normalizeProvenance('', 'opencode-assets');
    expect(result.group).toBe('OpenCode-specific');
  });

  it('maps antigravity-assets to Antigravity-specific', () => {
    const result = normalizeProvenance('antigravity-assets/skills/foo/SKILL.md');
    expect(result.group).toBe('Antigravity-specific');
  });

  it('maps antigravity-assets sourceId to Antigravity-specific', () => {
    const result = normalizeProvenance('', 'antigravity-assets');
    expect(result.group).toBe('Antigravity-specific');
  });

  it('maps claude-assets to Claude-specific', () => {
    const result = normalizeProvenance('claude-assets/skills/foo/SKILL.md');
    expect(result.group).toBe('Claude-specific');
  });

  it('maps claude-assets sourceId to Claude-specific', () => {
    const result = normalizeProvenance('', 'claude-assets');
    expect(result.group).toBe('Claude-specific');
  });

  it('maps external sourceType to User / repo / external', () => {
    const result = normalizeProvenance('some/path', 'some-id', 'external-source');
    expect(result.group).toBe('User / repo / external');
  });

  it('maps user sourceType to User / repo / external', () => {
    const result = normalizeProvenance('some/path', null, 'user');
    expect(result.group).toBe('User / repo / external');
  });

  it('maps repo-local sourceType to User / repo / external', () => {
    const result = normalizeProvenance('some/path', null, 'repo-local');
    expect(result.group).toBe('User / repo / external');
  });

  it('falls back to User / repo / external for unknown paths', () => {
    const result = normalizeProvenance('unknown/path/to/file.md');
    expect(result.group).toBe('User / repo / external');
  });

  it('handles null sourceRoot gracefully', () => {
    const result = normalizeProvenance(null);
    expect(result.group).toBe('User / repo / external');
  });

  it('handles undefined sourceRoot gracefully', () => {
    const result = normalizeProvenance(undefined);
    expect(result.group).toBe('User / repo / external');
  });

  it('handles empty string sourceRoot gracefully', () => {
    const result = normalizeProvenance('');
    expect(result.group).toBe('User / repo / external');
  });

  it('matches case-insensitively', () => {
    const result = normalizeProvenance('ENGINE-ASSETS/skills/foo/SKILL.md');
    expect(result.group).toBe('Copilot core');
  });

  it('matches partial paths containing engine-assets', () => {
    const result = normalizeProvenance('/some/mirror/engine-assets/subdir/file.md');
    expect(result.group).toBe('Copilot core');
  });

  it('compareProvenanceGroups sorts Copilot core before Codex', () => {
    const a = normalizeProvenance('engine-assets/foo');
    const b = normalizeProvenance('codex-assets/foo');
    expect(compareProvenanceGroups(a, b)).toBeLessThan(0);
  });

  it('compareProvenanceGroups sorts Shared skills before Antigravity', () => {
    const a = normalizeProvenance('catalog-assets/foo');
    const b = normalizeProvenance('antigravity-assets/foo');
    expect(compareProvenanceGroups(a, b)).toBeLessThan(0);
  });

  it('compareProvenanceGroups sorts User / repo / external last', () => {
    const a = normalizeProvenance('engine-assets/foo');
    const b = normalizeProvenance('unknown/path');
    expect(compareProvenanceGroups(a, b)).toBeLessThan(0);
  });

  it('compareProvenanceGroups returns 0 for same group', () => {
    const a = normalizeProvenance('engine-assets/foo');
    const b = normalizeProvenance('engine-assets/bar');
    expect(compareProvenanceGroups(a, b)).toBe(0);
  });
});

// ─── Component tests ───

// Mock the API module so AssetReader doesn't make real HTTP calls
vi.mock('../../lib/api', () => ({
  getCatalogContent: vi.fn().mockResolvedValue('# Mocked content\n\nThis is mocked document content.'),
  getCatalogSummary: vi.fn().mockResolvedValue({ summary: null }),
  getSkillQuality: vi.fn().mockResolvedValue(null),
}));

import AssetGroupList from './AssetGroupList';
import StatusRail from './StatusRail';
import InventoryTab from './InventoryTab';

// ─── Test data helpers ───

function makeHarnessState(overrides: Record<string, unknown> = {}) {
  return {
    harnessId: 'copilot',
    title: 'Copilot',
    supported: true,
    expected: true,
    installed: true,
    active: true,
    syncStatus: 'synced',
    installPath: '/home/user/.copilot/skills/test-skill',
    actions: { canInstall: false, canActivate: false, canDeactivate: false, canSync: true },
    detail: null,
    metadata: null,
    ...overrides,
  };
}

function makeItem(overrides: Record<string, unknown> = {}) {
  return {
    itemId: 'test-skill-1',
    itemKey: 'test-skill',
    kind: 'skill',
    title: 'Test Skill',
    description: 'A test skill for testing purposes',
    sourceType: 'shipped',
    sourceId: 'engine-assets',
    providerId: 'elegy',
    readPath: 'engine-assets/skills/test-skill/SKILL.md',
    detail: null,
    actions: null,
    central: true,
    keyFeature: false,
    keyFeatureLabel: null,
    keyFeatureOrder: null,
    scopeKinds: ['global'],
    syncStatus: 'synced',
    expectedHarnessCount: 1,
    missingHarnessCount: 0,
    installedHarnessCount: 1,
    supportedHarnessCount: 1,
    harnessStates: [makeHarnessState()],
    ...overrides,
  };
}

function makeSection(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'skill',
    title: 'Skills',
    count: 1,
    items: [makeItem()],
    ...overrides,
  };
}

function makeHarness(overrides: Record<string, unknown> = {}) {
  return {
    harnessId: 'copilot',
    title: 'Copilot',
    homePath: '/home/user/.copilot',
    skillsHomePath: '/home/user/.copilot/skills',
    supportsMcp: true,
    ...overrides,
  };
}

// ─── AssetGroupList tests ───

describe('AssetGroupList', () => {
  beforeEach(() => {
    cleanup();
  });

  it('renders groups organized by provenance', () => {
    const sections = [
      makeSection({
        items: [
          makeItem({ itemId: 'skill-1', title: 'Skill One', readPath: 'engine-assets/skills/one/SKILL.md', sourceId: 'engine-assets' }),
          makeItem({ itemId: 'skill-2', title: 'Skill Two', readPath: 'codex-assets/skills/two/SKILL.md', sourceId: 'codex-assets' }),
        ],
      }),
    ];
    render(
      <AssetGroupList sections={sections} selectedItem={null} onSelectItem={() => {}} />
    );

    // Should render both items
    expect(screen.getByText('Skill One')).toBeDefined();
    expect(screen.getByText('Skill Two')).toBeDefined();
    // Group headers should be present
    const coreGroup = screen.getByTestId('assets-tools-prov-group-copilot-core');
    expect(coreGroup).toBeDefined();
    const codexGroup = screen.getByTestId('assets-tools-prov-group-codex-specific');
    expect(codexGroup).toBeDefined();
  });

  it('shows group total and installed counts', () => {
    const sections = [makeSection()];
    render(
      <AssetGroupList sections={sections} selectedItem={null} onSelectItem={() => {}} />
    );

    const groupHeader = screen.getByTestId('assets-tools-prov-group-copilot-core');
    expect(groupHeader.textContent).toContain('total');
    expect(groupHeader.textContent).toContain('installed');
  });

  it('shows issue count when items have harness issues', () => {
    const item = makeItem({
      itemId: 'skill-1',
      harnessStates: [makeHarnessState({ syncStatus: 'missing', installed: false, active: false })],
    });
    const sections = [makeSection({ items: [item] })];
    render(
      <AssetGroupList sections={sections} selectedItem={null} onSelectItem={() => {}} />
    );

    // Should show the warning badge with count
    const warningBadge = screen.getByText(/⚠.*1/);
    expect(warningBadge).toBeDefined();
    // Group header should mention issues
    const groupHeader = screen.getByTestId('assets-tools-prov-group-copilot-core');
    expect(groupHeader.textContent).toContain('issues');
  });

  it('highlights the selected item', () => {
    const item = makeItem({ itemId: 'skill-1', title: 'Selected Skill' });
    const sections = [makeSection({ items: [item] })];
    render(
      <AssetGroupList sections={sections} selectedItem={item} onSelectItem={() => {}} />
    );

    const card = screen.getByTestId('assets-tools-item-skill-1');
    expect(card.className).toContain('selected');
  });

  it("does not highlight items that aren't selected", () => {
    const item1 = makeItem({ itemId: 'skill-1', title: 'Skill One' });
    const item2 = makeItem({ itemId: 'skill-2', title: 'Skill Two' });
    const sections = [makeSection({ items: [item1, item2] })];
    render(
      <AssetGroupList sections={sections} selectedItem={item1} onSelectItem={() => {}} />
    );

    const card1 = screen.getByTestId('assets-tools-item-skill-1');
    const card2 = screen.getByTestId('assets-tools-item-skill-2');
    expect(card1.className).toContain('selected');
    expect(card2.className).not.toContain('selected');
  });

  it('renders kind badge for each item', () => {
    const sections = [makeSection()];
    render(
      <AssetGroupList sections={sections} selectedItem={null} onSelectItem={() => {}} />
    );

    // The kind badge renders as text inside Badge component
    expect(screen.getByText('skill')).toBeDefined();
  });

  it('renders sourceType badge when present', () => {
    const sections = [makeSection()];
    render(
      <AssetGroupList sections={sections} selectedItem={null} onSelectItem={() => {}} />
    );

    expect(screen.getByText('shipped')).toBeDefined();
  });

  it('calls onSelectItem when clicking an item', () => {
    const onSelect = vi.fn();
    const item = makeItem({ itemId: 'skill-1' });
    const sections = [makeSection({ items: [item] })];
    render(
      <AssetGroupList sections={sections} selectedItem={null} onSelectItem={onSelect} />
    );

    fireEvent.click(screen.getByTestId('assets-tools-item-skill-1'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ itemId: 'skill-1' }));
  });

  it('calls onSelectItem on Enter key press', () => {
    const onSelect = vi.fn();
    const item = makeItem({ itemId: 'skill-1' });
    const sections = [makeSection({ items: [item] })];
    render(
      <AssetGroupList sections={sections} selectedItem={null} onSelectItem={onSelect} />
    );

    fireEvent.keyDown(screen.getByTestId('assets-tools-item-skill-1'), { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('calls onSelectItem on Space key press', () => {
    const onSelect = vi.fn();
    const item = makeItem({ itemId: 'skill-1' });
    const sections = [makeSection({ items: [item] })];
    render(
      <AssetGroupList sections={sections} selectedItem={null} onSelectItem={onSelect} />
    );

    fireEvent.keyDown(screen.getByTestId('assets-tools-item-skill-1'), { key: ' ' });
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('renders multiple groups with mixed provenance', () => {
    const sections = [
      makeSection({
        items: [
          makeItem({ itemId: 'skill-1', title: 'Engine Skill', readPath: 'engine-assets/skills/s1/SKILL.md', sourceId: 'engine-assets' }),
          makeItem({ itemId: 'skill-2', title: 'Codex Skill', readPath: 'codex-assets/skills/s2/SKILL.md', sourceId: 'codex-assets' }),
          makeItem({ itemId: 'skill-3', title: 'OC Skill', readPath: 'opencode-assets/skills/s3/SKILL.md', sourceId: 'opencode-assets' }),
          makeItem({ itemId: 'skill-4', title: 'AG Skill', readPath: 'antigravity-assets/skills/s4/SKILL.md', sourceId: 'antigravity-assets' }),
          makeItem({ itemId: 'skill-5', title: 'Claude Skill', readPath: 'claude-assets/skills/s5/SKILL.md', sourceId: 'claude-assets' }),
          makeItem({ itemId: 'skill-6', title: 'External Skill', readPath: 'user/skills/s6/SKILL.md', sourceId: null, sourceType: 'user' }),
        ],
      }),
    ];
    render(
      <AssetGroupList sections={sections} selectedItem={null} onSelectItem={() => {}} />
    );

    // Should show all groups
    expect(screen.getByTestId('assets-tools-prov-group-copilot-core')).toBeDefined();
    expect(screen.getByTestId('assets-tools-prov-group-codex-specific')).toBeDefined();
    expect(screen.getByTestId('assets-tools-prov-group-opencode-specific')).toBeDefined();
    expect(screen.getByTestId('assets-tools-prov-group-antigravity-specific')).toBeDefined();
    expect(screen.getByTestId('assets-tools-prov-group-claude-specific')).toBeDefined();
    expect(screen.getByTestId('assets-tools-prov-group-user-repo-external')).toBeDefined();
  });
});

// ─── StatusRail tests ───

describe('StatusRail', () => {
  beforeEach(() => {
    cleanup();
  });

  it('shows empty state when no item selected', () => {
    render(<StatusRail item={null} harnesses={[]} />);
    expect(screen.getByText('Select an asset')).toBeDefined();
  });

  it('shows harness status rows for selected item', () => {
    const item = makeItem({
      harnessStates: [
        makeHarnessState({ harnessId: 'copilot', title: 'Copilot', installed: true, active: true, syncStatus: 'synced' }),
      ],
    });
    const harnesses = [makeHarness({ harnessId: 'copilot', title: 'Copilot' })];
    render(<StatusRail item={item} harnesses={harnesses} />);

    expect(screen.getByText('Copilot')).toBeDefined();
    expect(screen.getByText('Synced')).toBeDefined();
  });

  it('shows missing status badge', () => {
    const item = makeItem({
      harnessStates: [
        makeHarnessState({ harnessId: 'copilot', title: 'Copilot', installed: false, active: false, syncStatus: 'missing' }),
      ],
    });
    const harnesses = [makeHarness({ harnessId: 'copilot', title: 'Copilot' })];
    render(<StatusRail item={item} harnesses={harnesses} />);

    expect(screen.getByText('Missing')).toBeDefined();
  });

  it('shows not supported status when harness has no state', () => {
    const item = makeItem({ harnessStates: [] });
    const harnesses = [makeHarness({ harnessId: 'some-other-harness', title: 'Other Harness' })];
    render(<StatusRail item={item} harnesses={harnesses} />);

    expect(screen.getByText('Not supported')).toBeDefined();
  });

  it('shows installed/active badges', () => {
    const item = makeItem({
      harnessStates: [makeHarnessState({ installed: true, active: true })],
    });
    const harnesses = [makeHarness()];
    render(<StatusRail item={item} harnesses={harnesses} />);

    expect(screen.getByText('installed')).toBeDefined();
    expect(screen.getByText('active')).toBeDefined();
  });

  it('shows not installed / inactive when false', () => {
    const item = makeItem({
      harnessStates: [makeHarnessState({ installed: false, active: false })],
    });
    const harnesses = [makeHarness()];
    render(<StatusRail item={item} harnesses={harnesses} />);

    expect(screen.getByText('not installed')).toBeDefined();
    expect(screen.getByText('inactive')).toBeDefined();
  });

  it('shows install path when present', () => {
    const item = makeItem({
      harnessStates: [makeHarnessState({ installPath: '/custom/path/to/skill' })],
    });
    const harnesses = [makeHarness()];
    render(<StatusRail item={item} harnesses={harnesses} />);

    expect(screen.getByText('/custom/path/to/skill')).toBeDefined();
  });

  it('shows "Not evaluated" when item has no quality data', () => {
    const item = makeItem({});
    const harnesses = [makeHarness()];
    render(<StatusRail item={item} harnesses={harnesses} />);

    expect(screen.getByText('Not evaluated')).toBeDefined();
  });

  it('shows quality score badges when present', () => {
    const item = makeItem({ qualityScore: 2 });
    const harnesses = [makeHarness()];
    render(<StatusRail item={item} harnesses={harnesses} />);

    expect(screen.getByText('2 issues')).toBeDefined();
  });

  it('shows "No issues" when qualityScore is 0', () => {
    const item = makeItem({ qualityScore: 0 });
    const harnesses = [makeHarness()];
    render(<StatusRail item={item} harnesses={harnesses} />);

    expect(screen.getByText('No issues')).toBeDefined();
  });

  it('renders multiple harness rows', () => {
    const item = makeItem({
      harnessStates: [
        makeHarnessState({ harnessId: 'copilot', title: 'Copilot', syncStatus: 'synced', installed: true, active: true }),
        makeHarnessState({ harnessId: 'codex', title: 'Codex', syncStatus: 'missing', installed: false, active: false }),
      ],
    });
    const harnesses = [
      makeHarness({ harnessId: 'copilot', title: 'Copilot' }),
      makeHarness({ harnessId: 'codex', title: 'Codex' }),
    ];
    render(<StatusRail item={item} harnesses={harnesses} />);

    expect(screen.getByText('Copilot')).toBeDefined();
    expect(screen.getByText('Codex')).toBeDefined();
    expect(screen.getByText('Synced')).toBeDefined();
    expect(screen.getByText('Missing')).toBeDefined();
  });

  it('shows action button when onItemAction is provided and action is available', () => {
    const item = makeItem({
      actions: { kind: 'external-source', installSurfaceTargets: [] },
      harnessStates: [makeHarnessState({
        syncStatus: 'missing',
        installed: false,
        active: false,
        actions: { canInstall: false, canActivate: true, canDeactivate: false, canSync: false },
      })],
    });
    const harnesses = [makeHarness()];
    render(
      <StatusRail item={item} harnesses={harnesses} onItemAction={() => {}} mutating={false} />
    );

    expect(screen.getByText('Enable source')).toBeDefined();
  });

  it('does not render action button when mutating is true', () => {
    const item = makeItem({
      actions: { kind: 'external-source' },
      harnessStates: [makeHarnessState({
        syncStatus: 'missing',
        installed: false,
        active: false,
        actions: { canInstall: false, canActivate: true, canDeactivate: false, canSync: false },
      })],
    });
    const harnesses = [makeHarness()];
    render(
      <StatusRail item={item} harnesses={harnesses} onItemAction={() => {}} mutating={true} />
    );

    // The action button should not render when mutating
    expect(screen.queryByText('Enable source')).toBeNull();
  });

  it('shows enabled/disabled badges when enabled field is present', () => {
    const item = makeItem({
      harnessStates: [makeHarnessState({ enabled: true })],
    });
    const harnesses = [makeHarness()];
    render(<StatusRail item={item} harnesses={harnesses} />);

    expect(screen.getByText('enabled')).toBeDefined();
  });

  it('shows disabled badge when enabled is false', () => {
    const item = makeItem({
      harnessStates: [makeHarnessState({ enabled: false })],
    });
    const harnesses = [makeHarness()];
    render(<StatusRail item={item} harnesses={harnesses} />);

    expect(screen.getByText('disabled')).toBeDefined();
  });

  it('shows auto-routable badge when autoRoutable is true', () => {
    const item = makeItem({
      harnessStates: [makeHarnessState({ autoRoutable: true })],
    });
    const harnesses = [makeHarness()];
    render(<StatusRail item={item} harnesses={harnesses} />);

    expect(screen.getByText('auto-routable')).toBeDefined();
  });

  it('shows manual badge when autoRoutable is false', () => {
    const item = makeItem({
      harnessStates: [makeHarnessState({ autoRoutable: false })],
    });
    const harnesses = [makeHarness()];
    render(<StatusRail item={item} harnesses={harnesses} />);

    expect(screen.getByText('manual')).toBeDefined();
  });

  it('calls onItemAction when action button is clicked', () => {
    const onAction = vi.fn();
    const item = makeItem({
      actions: { kind: 'external-source' },
      harnessStates: [makeHarnessState({
        syncStatus: 'missing',
        installed: false,
        active: false,
        actions: { canInstall: false, canActivate: true, canDeactivate: false, canSync: false },
      })],
    });
    const harnesses = [makeHarness()];
    render(
      <StatusRail item={item} harnesses={harnesses} onItemAction={onAction} />
    );

    fireEvent.click(screen.getByText('Enable source'));
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});

// ─── InventoryTab tests ───

describe('InventoryTab', () => {
  beforeEach(() => {
    cleanup();
  });

  it('renders three-pane layout', () => {
    render(
      <InventoryTab sections={[makeSection()]} harnesses={[makeHarness()]} summary={null} />
    );

    expect(screen.getByTestId('assets-tools-inventory')).toBeDefined();
    expect(screen.getByTestId('assets-tools-group-list')).toBeDefined();
    expect(screen.getByTestId('assets-tools-reader')).toBeDefined();
    expect(screen.getByTestId('assets-tools-status-rail')).toBeDefined();
  });

  it('auto-selects first item when no attention-needed items', () => {
    render(
      <InventoryTab sections={[makeSection()]} harnesses={[makeHarness()]} summary={null} />
    );

    // The reader should not show "Select an asset to view details"
    expect(screen.queryByText('Select an asset to view details')).toBeNull();
    // The item title appears both in the group list and the reader — check at least one exists
    const matches = screen.getAllByText('Test Skill');
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('auto-selects items needing attention first', () => {
    const normalItem = makeItem({
      itemId: 'normal',
      title: 'Normal Skill',
      harnessStates: [makeHarnessState({ syncStatus: 'synced', installed: true, active: true })],
    });
    const attentionItem = makeItem({
      itemId: 'attention',
      title: 'Attention Skill',
      harnessStates: [makeHarnessState({ syncStatus: 'missing', installed: false, active: false })],
    });
    const sections = [makeSection({ items: [normalItem, attentionItem] })];

    render(
      <InventoryTab sections={sections} harnesses={[makeHarness()]} summary={null} />
    );

    // The attention item should be selected and its card highlighted
    const attentionCard = screen.getByTestId('assets-tools-item-attention');
    expect(attentionCard.className).toContain('selected');

    // The normal item should not be selected
    const normalCard = screen.getByTestId('assets-tools-item-normal');
    expect(normalCard.className).not.toContain('selected');

    // Reader should show attention item title (appears in both list and reader)
    const matches = screen.getAllByText('Attention Skill');
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('renders empty state when no sections provided', () => {
    render(
      <InventoryTab sections={[]} harnesses={[makeHarness()]} summary={null} />
    );

    expect(screen.getByTestId('assets-tools-inventory')).toBeDefined();
    // Reader should show empty state since no item is selected
    expect(screen.getByText('Select an asset to view details')).toBeDefined();
  });

  it('displays status rail for selected item', () => {
    render(
      <InventoryTab sections={[makeSection()]} harnesses={[makeHarness()]} summary={null} />
    );

    // Status rail should show the harness
    expect(screen.getByText('Copilot')).toBeDefined();
    expect(screen.getByText('Synced')).toBeDefined();
  });

  it('switches selected item when clicking a different item', () => {
    const item1 = makeItem({
      itemId: 'first',
      title: 'First Skill',
      harnessStates: [makeHarnessState({ syncStatus: 'synced', installed: true, active: true })],
    });
    const item2 = makeItem({
      itemId: 'second',
      title: 'Second Skill',
      readPath: 'codex-assets/skills/second/SKILL.md',
      sourceId: 'codex-assets',
      // item2 is NOT an attention item — both items are synced so auto-select picks first
      harnessStates: [makeHarnessState({ syncStatus: 'synced', installed: true, active: true })],
    });
    const sections = [makeSection({ items: [item1, item2] })];

    render(
      <InventoryTab sections={sections} harnesses={[makeHarness()]} summary={null} />
    );

    // First item should be selected initially (no attention items)
    const firstCard = screen.getByTestId('assets-tools-item-first');
    expect(firstCard.className).toContain('selected');

    // Click second item
    fireEvent.click(screen.getByTestId('assets-tools-item-second'));

    // Now second item should be selected
    expect(firstCard.className).not.toContain('selected');
    const secondCard = screen.getByTestId('assets-tools-item-second');
    expect(secondCard.className).toContain('selected');

    // Reader and status rail should update to show second item
    const titleMatches = screen.getAllByText('Second Skill');
    expect(titleMatches.length).toBeGreaterThanOrEqual(2);
  });
});
