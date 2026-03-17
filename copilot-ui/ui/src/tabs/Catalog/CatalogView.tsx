import { Button, Toolbar } from '../../components';
import { useStoreValue } from '../../lib/store';
import { navigationStore, type CatalogSectionId } from '../../stores/navigation';
import { catalogWorkspaceStore } from '../Assets/catalogWorkspaceStore';
import AssetsView from '../Assets/AssetsView';
import SkillsPreviewView from '../SkillsPreview/SkillsPreviewView';
import CatalogAgentsView from './CatalogAgentsView';
import CatalogOverviewView from './CatalogOverviewView';
import './catalog.css';

const SECTION_COPY: Record<CatalogSectionId, { title: string; body: string }> = {
  overview: {
    title: 'Catalog Overview',
    body: 'See discovery context, provider spotlights, bundle status, and jump points for assets, skills, and agents.',
  },
  assets: {
    title: 'Assets',
    body: 'Manage effective assets, installs, bundles, repo registration, and repair flows without hiding provider semantics.',
  },
  skills: {
    title: 'Skills',
    body: 'Inspect vault-first and provider-backed skills with provider-qualified identities kept visible.',
  },
  agents: {
    title: 'Agents',
    body: 'Discover provider-backed agents, spotlight external packs, and hand off directly into runtime engagement.',
  },
};

function navigateToRuntimeWorkspace(): void {
  navigationStore.goToRuntime('sessions');
}

export default function CatalogView() {
  const navigationState = useStoreValue(navigationStore);
  const activeSection = navigationState.catalogSectionId;
  const sectionCopy = SECTION_COPY[activeSection];

  const handleInspectAsset = async (assetId: string) => {
    await catalogWorkspaceStore.selectAsset(assetId);
    navigationStore.setCatalogSectionId('assets');
  };

  return (
    <section className="workspace-stack catalog-hub-view" data-testid="catalog-hub-view">
      <Toolbar testId="catalog-hub-toolbar">
        <div className="workspace-nav-summary">
          <p className="workspace-nav-title">Catalog</p>
          <p className="workspace-nav-copy">{sectionCopy.body}</p>
        </div>

        <div className="workspace-nav" role="tablist" aria-label="Catalog workspaces">
          <Button
            onClick={() => navigationStore.setCatalogSectionId('overview')}
            testId="catalog-section-overview"
            variant={activeSection === 'overview' ? 'primary' : 'ghost'}
          >
            Overview
          </Button>
          <Button
            onClick={() => navigationStore.setCatalogSectionId('assets')}
            testId="catalog-section-assets"
            variant={activeSection === 'assets' ? 'primary' : 'ghost'}
          >
            Assets
          </Button>
          <Button
            onClick={() => navigationStore.setCatalogSectionId('skills')}
            testId="catalog-section-skills"
            variant={activeSection === 'skills' ? 'primary' : 'ghost'}
          >
            Skills
          </Button>
          <Button
            onClick={() => navigationStore.setCatalogSectionId('agents')}
            testId="catalog-section-agents"
            variant={activeSection === 'agents' ? 'primary' : 'ghost'}
          >
            Agents
          </Button>
        </div>
      </Toolbar>

      <p className="workspace-section-label">{sectionCopy.title}</p>

      {activeSection === 'overview' ? (
        <CatalogOverviewView
          onEngageRuntime={navigateToRuntimeWorkspace}
          onOpenSection={navigationStore.setCatalogSectionId}
        />
      ) : null}
      {activeSection === 'assets' ? <AssetsView /> : null}
      {activeSection === 'skills' ? <SkillsPreviewView /> : null}
      {activeSection === 'agents' ? (
        <CatalogAgentsView
          onEngageRuntime={navigateToRuntimeWorkspace}
          onInspectAsset={handleInspectAsset}
          onOpenSection={navigationStore.setCatalogSectionId}
        />
      ) : null}
    </section>
  );
}
