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
          assetId: 'skill-copilot-home-plugin-superpowers-brainstorming',
          name: 'brainstorming',
          kind: 'full',
          namespace: 'superpowers',
          provider: 'copilot-home-plugin',
          readOnly: true,
          viewPath: 'skills/superpowers/brainstorming/SKILL.md',
        },
      ],
    });
    mockGetAssetView.mockResolvedValue('# Plugin Brainstorming');

    const { skillsPreviewStore } = await import('../ui/src/tabs/SkillsPreview/skillsPreviewStore');

    await skillsPreviewStore.loadSkills();
    await skillsPreviewStore.loadSkillDetail('skill-copilot-home-plugin-superpowers-brainstorming');

    expect(mockGetAssetView).toHaveBeenCalledWith('skills/superpowers/brainstorming/SKILL.md');
    expect(skillsPreviewStore.getState().selectedSkillId).toBe('skill-copilot-home-plugin-superpowers-brainstorming');
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
          assetId: 'skill-copilot-home-plugin-superpowers-brainstorming',
          name: 'brainstorming',
          kind: 'full',
          namespace: 'superpowers',
          provider: 'copilot-home-plugin',
          readOnly: true,
          viewPath: 'skills/superpowers/brainstorming/SKILL.md',
        },
      ],
    });

    let resolveFlat: ((value: string) => void) | null = null;
    let resolvePlugin: ((value: string) => void) | null = null;
    mockGetAssetView.mockImplementation((requestedPath: string) => new Promise((resolve) => {
      if (requestedPath.includes('skills/superpowers/brainstorming/SKILL.md')) {
        resolvePlugin = resolve;
        return;
      }
      resolveFlat = resolve;
    }));

    const { skillsPreviewStore } = await import('../ui/src/tabs/SkillsPreview/skillsPreviewStore');

    await skillsPreviewStore.loadSkills();

    const flatLoad = skillsPreviewStore.loadSkillDetail('skill-flat-brainstorming');
    const pluginLoad = skillsPreviewStore.loadSkillDetail('skill-copilot-home-plugin-superpowers-brainstorming');

    expect(resolveFlat).not.toBeNull();
    expect(resolvePlugin).not.toBeNull();

    resolvePlugin?.('# Plugin Brainstorming');
    await pluginLoad;

    resolveFlat?.('# Flat Brainstorming');
    await flatLoad;

    expect(skillsPreviewStore.getState().selectedSkillId).toBe('skill-copilot-home-plugin-superpowers-brainstorming');
    expect(skillsPreviewStore.getState().detailText).toContain('Plugin Brainstorming');
    expect(skillsPreviewStore.getState().detailText).not.toContain('Flat Brainstorming');
  });
});
