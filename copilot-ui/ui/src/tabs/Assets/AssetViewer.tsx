import type {
  InstalledAgent,
  InstalledAssetsResponse,
  InstalledInstructions,
  InstalledPrompt,
  InstalledSkill,
  ManagedAssetStatus,
} from '../../lib/types';

type InstalledSelectionItem = InstalledAgent | InstalledSkill | InstalledPrompt | InstalledInstructions;

interface InstalledSelection {
  category: 'agent' | 'skill' | 'prompt' | 'instructions';
  item: InstalledSelectionItem;
}

interface AssetViewerProps {
  selectedAssetId?: string | null;
  selectedAssetPath?: string | null;
  managedAssets?: ManagedAssetStatus[];
  installedInventory: InstalledAssetsResponse;
}

function matchesPath(value: unknown, selectedPath: string | null): boolean {
  return typeof value === 'string' && typeof selectedPath === 'string' && value === selectedPath;
}

function readManagedPath(asset: ManagedAssetStatus): string | null {
  const candidates = [asset.destinationAbs, asset.destination, asset.sourceAbs, asset.source];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate;
    }
  }

  return null;
}

function findInstalledSelection(
  path: string | null,
  inventory: InstalledAssetsResponse
): InstalledSelection | null {
  if (!path) {
    return null;
  }

  const agent = inventory.agents.find((item) => matchesPath(item.absPath, path));
  if (agent) {
    return { category: 'agent', item: agent };
  }

  const skill = inventory.skills.find((item) => matchesPath(item.absPath, path));
  if (skill) {
    return { category: 'skill', item: skill };
  }

  const prompt = inventory.prompts.find((item) => matchesPath(item.absPath, path));
  if (prompt) {
    return { category: 'prompt', item: prompt };
  }

  if (inventory.instructions.installed && matchesPath(inventory.instructions.absPath, path)) {
    return { category: 'instructions', item: inventory.instructions };
  }

  return null;
}

export default function AssetViewer({
  selectedAssetId = null,
  selectedAssetPath = null,
  managedAssets = [],
  installedInventory,
}: AssetViewerProps) {
  const selectedManagedAsset =
    (selectedAssetId && managedAssets.find((asset) => asset.id === selectedAssetId)) ||
    (selectedAssetPath && managedAssets.find((asset) => readManagedPath(asset) === selectedAssetPath)) ||
    null;

  const selectedInstalledAsset = findInstalledSelection(selectedAssetPath, installedInventory);

  const metadata =
    selectedManagedAsset || selectedInstalledAsset
      ? {
          selection: {
            id: selectedAssetId,
            path: selectedAssetPath,
          },
          managed: selectedManagedAsset,
          installed: selectedInstalledAsset,
        }
      : null;

  const previewJson = metadata ? JSON.stringify(metadata, null, 2) : '';

  return (
    <section className="asset-viewer" data-testid="asset-viewer">
      {metadata ? (
        <>
          <dl className="viewer-summary">
            <div>
              <dt>Selected ID</dt>
              <dd>{selectedAssetId ?? 'None'}</dd>
            </div>
            <div>
              <dt>Selected Path</dt>
              <dd>{selectedAssetPath ?? 'None'}</dd>
            </div>
            <div>
              <dt>Managed Type</dt>
              <dd>{selectedManagedAsset?.type ?? 'None'}</dd>
            </div>
            <div>
              <dt>Installed Category</dt>
              <dd>{selectedInstalledAsset?.category ?? 'None'}</dd>
            </div>
          </dl>

          <pre>{previewJson}</pre>
        </>
      ) : (
        <p className="empty-message">
          Select an asset from the table or inventory preview to inspect metadata.
        </p>
      )}
    </section>
  );
}
