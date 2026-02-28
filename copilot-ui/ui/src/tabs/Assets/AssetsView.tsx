import { useEffect } from 'react';
import { Button, Panel, Toolbar } from '../../components';
import { useStoreValue } from '../../lib/store';
import AssetViewer from './AssetViewer';
import InstalledInventory from './InstalledInventory';
import ManagedAssetsTable from './ManagedAssetsTable';
import { assetsStore } from './assetsStore';

export default function AssetsView() {
  const assetState = useStoreValue(assetsStore);

  useEffect(() => {
    void assetsStore.loadAssets();
  }, []);

  const installedTotal =
    assetState.installedInventory.agents.length +
    assetState.installedInventory.skills.length +
    assetState.installedInventory.prompts.length +
    (assetState.installedInventory.instructions.installed ? 1 : 0);

  const handleRefresh = async () => {
    await assetsStore.refresh();
  };

  return (
    <section className="assets-view" data-testid="assets-view">
      <Toolbar testId="assets-view-toolbar">
        <div className="assets-summary">
          <p className="assets-title">Managed + Installed Assets</p>
          <p className="assets-copy">
            {assetState.managedAssets.length} managed entries, {installedTotal} installed artifacts
          </p>
        </div>
        <Button
          disabled={assetState.loading}
          onClick={handleRefresh}
          testId="assets-view-refresh"
          variant="secondary"
        >
          {assetState.loading ? 'Refreshing...' : 'Refresh'}
        </Button>
      </Toolbar>

      {assetState.error ? (
        <p className="assets-error" role="alert">
          {assetState.error}
        </p>
      ) : null}

      <div className="assets-grid">
        <Panel
          subtitle="Typed API data for managed asset status."
          testId="assets-managed-panel"
          title="Managed Assets"
        >
          <ManagedAssetsTable
            error={assetState.error}
            loading={assetState.loading}
            managedAssets={assetState.managedAssets}
            onSelectAsset={(id) => assetsStore.selectManagedAsset(id)}
            selectedAssetId={assetState.selectedAssetId}
          />
        </Panel>

        <Panel
          subtitle="Counts and previews from installed assets."
          testId="assets-installed-panel"
          title="Installed Inventory"
        >
          <InstalledInventory
            error={assetState.error}
            inventory={assetState.installedInventory}
            loading={assetState.loading}
            onSelectAsset={(path) => assetsStore.selectInstalledAsset(path)}
            selectedAssetPath={assetState.selectedAssetPath}
          />
        </Panel>

        <Panel
          subtitle="Selected asset metadata JSON preview."
          testId="assets-viewer-panel"
          title="Asset Viewer"
        >
          <AssetViewer
            installedInventory={assetState.installedInventory}
            managedAssets={assetState.managedAssets}
            selectedAssetId={assetState.selectedAssetId}
            selectedAssetPath={assetState.selectedAssetPath}
          />
        </Panel>
      </div>
    </section>
  );
}
