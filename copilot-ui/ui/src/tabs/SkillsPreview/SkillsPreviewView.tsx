import { useEffect, useMemo } from 'react';
import { Button, FormInput, Panel, StatusBadge, Toolbar } from '../../components';
import { useStoreValue } from '../../lib/store';
import type { SkillPreviewItem } from '../../lib/types';
import { skillsPreviewStore } from './skillsPreviewStore';

function matchesQuery(skill: SkillPreviewItem, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  const fields = [
    skill.name,
    skill.kind,
    skill.loadMode ?? '',
    skill.availability ?? '',
    skill.description ?? '',
    skill.triggers ?? '',
    skill.provider ?? '',
    skill.sourcePackage ?? '',
    skill.namespace ?? '',
  ];
  return fields.some((field) => field.toLowerCase().includes(normalizedQuery));
}

function buildSkillSourceLabel(skill: SkillPreviewItem): string {
  const segments: string[] = [];
  if (skill.sourcePackage) {
    segments.push(skill.sourcePackage);
  } else if (skill.provider && skill.provider !== 'user-home') {
    segments.push(skill.provider);
  }
  if (skill.namespace) {
    segments.push(`namespace: ${skill.namespace}`);
  }
  if (skill.readOnly) {
    segments.push('read-only');
  }
  return segments.join(' · ');
}

export default function SkillsPreviewView() {
  const skillsState = useStoreValue(skillsPreviewStore);

  useEffect(() => {
    void skillsPreviewStore.loadSkills();
  }, []);

  const filteredSkills = useMemo(() => {
    return skillsState.skills.filter((skill) => matchesQuery(skill, skillsState.searchQuery));
  }, [skillsState.skills, skillsState.searchQuery]);

  const alwaysLoadedCount = useMemo(() => {
    return skillsState.skills.filter((skill) => skill.loadMode === 'always').length;
  }, [skillsState.skills]);

  const vaultFirstCount = useMemo(() => {
    return skillsState.skills.filter((skill) => skill.loadMode !== 'always').length;
  }, [skillsState.skills]);
  const providerBackedCount = useMemo(() => {
    return skillsState.skills.filter((skill) => skill.provider && skill.provider !== 'user-home').length;
  }, [skillsState.skills]);
  const featuredProviderSkills = useMemo(() => {
    return skillsState.skills.filter((skill) => skill.provider === 'superpowers-copilot' || skill.namespace === 'superpowers');
  }, [skillsState.skills]);

  const handleRefresh = async () => {
    await skillsPreviewStore.refresh();
  };

  const handleSelectSkill = async (skillId: string) => {
    await skillsPreviewStore.loadSkillDetail(skillId);
  };

  return (
    <section className="skills-preview-view" data-testid="skills-preview-view">
      <Toolbar testId="skills-preview-toolbar">
        <div className="skills-preview-summary">
          <p className="skills-preview-title">Skills Catalog Preview</p>
          <p className="skills-preview-copy">
            {skillsState.skills.length} total skills, {alwaysLoadedCount} always-loaded, {vaultFirstCount} vault-first, {providerBackedCount} provider-backed
          </p>
        </div>

        <div className="skills-preview-toolbar-actions">
          <FormInput
            label="Filter"
            onValueChange={(value) => skillsPreviewStore.setSearchQuery(value)}
            placeholder="Search by skill name, mode, state, description, or triggers"
            testId="skills-preview-search"
            type="search"
            value={skillsState.searchQuery}
          />
          <Button
            disabled={skillsState.loading}
            onClick={handleRefresh}
            testId="skills-preview-refresh"
            variant="secondary"
          >
            {skillsState.loading ? 'Refreshing...' : 'Refresh'}
          </Button>
        </div>
      </Toolbar>

      {skillsState.error ? (
        <p className="skills-preview-error" role="alert">
          {skillsState.error}
        </p>
      ) : null}

      {featuredProviderSkills.length > 0 ? (
        <div className="catalog-featured-provider-banner" data-testid="skills-preview-featured-provider">
          <div>
            <p className="catalog-spotlight-kicker">Provider spotlight</p>
            <p><strong>superpowers-copilot</strong> is surfaced directly in skills discovery with provider-qualified identity intact.</p>
            <p>{featuredProviderSkills.length} skill(s) from the provider are visible in this preview.</p>
          </div>
          <Button
            onClick={() => skillsPreviewStore.setSearchQuery('superpowers-copilot')}
            testId="skills-preview-filter-superpowers"
            variant="secondary"
          >
            Show superpowers
          </Button>
        </div>
      ) : null}

      <div className="skills-preview-grid">
        <Panel
          subtitle="Vault-first catalog from GET /api/skills/preview with scan-path and vault awareness."
          testId="skills-preview-list-panel"
          title="Skills"
        >
          {skillsState.loading && skillsState.skills.length === 0 ? (
            <p className="state-message">Loading skills preview...</p>
          ) : null}

          {!skillsState.loading && filteredSkills.length === 0 ? (
            <p className="state-message">No skills matched the current filter.</p>
          ) : null}

          {filteredSkills.length > 0 ? (
            <table className="skills-preview-table" data-testid="skills-preview-table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Load Mode</th>
                  <th scope="col">State</th>
                  <th scope="col">Triggers</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredSkills.map((skill: SkillPreviewItem) => {
                  const isSelected = skill.assetId === skillsState.selectedSkillId;
                  const sourceLabel = buildSkillSourceLabel(skill);
                  return (
                    <tr className={isSelected ? 'is-selected' : ''} key={skill.assetId || `${skill.name}:${skill.viewPath || skill.absPath || ''}`}>
                      <td>
                        <div>{skill.name}</div>
                        {skill.description ? <small>{skill.description}</small> : null}
                        {sourceLabel ? <small>{sourceLabel}</small> : null}
                      </td>
                      <td>
                        <StatusBadge status={skill.loadMode ?? 'unknown'} testId="skills-preview-kind-badge" />
                      </td>
                      <td>
                        <StatusBadge status={skill.availability ?? skill.kind} testId="skills-preview-state-badge" />
                      </td>
                      <td>{skill.triggers || '-'}</td>
                      <td>
                        <Button
                          disabled={skill.kind === 'missing'}
                          onClick={() => {
                            void handleSelectSkill(skill.assetId || skill.name);
                          }}
                          size="sm"
                          testId="skills-preview-view-button"
                          variant="secondary"
                        >
                          View
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : null}
        </Panel>

        <Panel
          subtitle="Uses the resolved scan-path or vault path for the selected skill."
          testId="skills-preview-detail-panel"
          title="Skill Detail"
        >
          {skillsState.detailError ? (
            <p className="state-message state-error" role="alert">
              {skillsState.detailError}
            </p>
          ) : null}
          <pre className="code-block">{skillsState.detailLoading ? '(loading...)' : skillsState.detailText}</pre>
        </Panel>
      </div>
    </section>
  );
}
