import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetAssetView = vi.fn();
const mockGetSkillsPreview = vi.fn();

vi.mock('../ui/src/lib/api', () => ({
  getAssetView: mockGetAssetView,
  getSkillsPreview: mockGetSkillsPreview,
}));

describe('skillsPreviewStore', () => {
  beforeEach(() => {
    mockGetAssetView.mockReset();
    mockGetSkillsPreview.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('tracks duplicate skill names by asset identity and loads the selected nested view path', async () => {
    mockGetSkillsPreview.mockResolvedValue({
      skills: [
        {
          assetId: 'skill-flat-brainstorming',
          name: 'brainstorming',
          kind: 'full',
          viewPath: 'skills/brainstorming/SKILL.md',
        },
        {
          assetId: 'skill-copilot-home-plugin-external-provider-brainstorming',
          name: 'brainstorming',
          kind: 'full',
          namespace: 'external-provider',
          provider: 'copilot-home-plugin',
          readOnly: true,
          viewPath: 'skills/external-provider/brainstorming/SKILL.md',
        },
      ],
    });
    mockGetAssetView.mockResolvedValue('# Plugin Brainstorming');

    const { skillsPreviewStore } = await import('../ui/src/tabs/SkillsPreview/skillsPreviewStore');

    await skillsPreviewStore.loadSkills();
    await skillsPreviewStore.loadSkillDetail('skill-copilot-home-plugin-external-provider-brainstorming');

    expect(mockGetAssetView).toHaveBeenCalledWith('skills/external-provider/brainstorming/SKILL.md');
    expect(skillsPreviewStore.getState().selectedSkillId).toBe('skill-copilot-home-plugin-external-provider-brainstorming');
    expect(skillsPreviewStore.getState().detailText).toContain('Plugin Brainstorming');
  });

  it('ignores stale detail responses after a newer skill selection', async () => {
    mockGetSkillsPreview.mockResolvedValue({
      skills: [
        {
          assetId: 'skill-flat-brainstorming',
          name: 'brainstorming',
          kind: 'full',
          viewPath: 'skills/brainstorming/SKILL.md',
        },
        {
          assetId: 'skill-copilot-home-plugin-external-provider-brainstorming',
          name: 'brainstorming',
          kind: 'full',
          namespace: 'external-provider',
          provider: 'copilot-home-plugin',
          readOnly: true,
          viewPath: 'skills/external-provider/brainstorming/SKILL.md',
        },
      ],
    });

    let resolveFlat: ((value: string) => void) | null = null;
    let resolvePlugin: ((value: string) => void) | null = null;
    mockGetAssetView.mockImplementation((requestedPath: string) => new Promise((resolve) => {
      if (requestedPath.includes('skills/external-provider/brainstorming/SKILL.md')) {
        resolvePlugin = resolve;
        return;
      }
      resolveFlat = resolve;
    }));

    const { skillsPreviewStore } = await import('../ui/src/tabs/SkillsPreview/skillsPreviewStore');

    await skillsPreviewStore.loadSkills();

    const flatLoad = skillsPreviewStore.loadSkillDetail('skill-flat-brainstorming');
    const pluginLoad = skillsPreviewStore.loadSkillDetail('skill-copilot-home-plugin-external-provider-brainstorming');

    expect(resolveFlat).not.toBeNull();
    expect(resolvePlugin).not.toBeNull();

    resolvePlugin?.('# Plugin Brainstorming');
    await pluginLoad;

    resolveFlat?.('# Flat Brainstorming');
    await flatLoad;

    expect(skillsPreviewStore.getState().selectedSkillId).toBe('skill-copilot-home-plugin-external-provider-brainstorming');
    expect(skillsPreviewStore.getState().detailText).toContain('Plugin Brainstorming');
    expect(skillsPreviewStore.getState().detailText).not.toContain('Flat Brainstorming');
  });

  it('does not request asset content for managed skills that are not installed yet', async () => {
    mockGetSkillsPreview.mockResolvedValue({
      skills: [
        {
          assetId: 'skill-missing-skill',
          name: 'missing-skill',
          kind: 'missing',
          availability: 'not-installed',
          managed: true,
        },
      ],
    });

    const { skillsPreviewStore } = await import('../ui/src/tabs/SkillsPreview/skillsPreviewStore');

    await skillsPreviewStore.loadSkills();
    await skillsPreviewStore.loadSkillDetail('skill-missing-skill');

    expect(mockGetAssetView).not.toHaveBeenCalled();
    expect(skillsPreviewStore.getState().detailText).toContain('managed but not installed yet');
    expect(skillsPreviewStore.getState().detailLoading).toBe(false);
  });

  it('does not fall back to a home skill path when the selected preview item has no inspectable view path', async () => {
    mockGetSkillsPreview.mockResolvedValue({
      skills: [
        {
          assetId: 'skill-repo-local-brainstorming',
          name: 'brainstorming',
          kind: 'full',
          availability: 'scan-path',
          description: 'Repo-local brainstorming variant.',
        },
      ],
    });

    const { skillsPreviewStore } = await import('../ui/src/tabs/SkillsPreview/skillsPreviewStore');

    await skillsPreviewStore.loadSkills();
    await skillsPreviewStore.loadSkillDetail('skill-repo-local-brainstorming');

    expect(mockGetAssetView).not.toHaveBeenCalled();
    expect(skillsPreviewStore.getState().detailText).toContain('cannot be previewed');
    expect(skillsPreviewStore.getState().detailLoading).toBe(false);
  });
});
