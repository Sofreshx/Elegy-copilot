import DataTable, { DataTableColumn, DataTableRow } from '../../components/DataTable';
import type { ManagedAssetStatus } from '../../lib/types';

interface ManagedAssetsTableProps {
  managedAssets?: ManagedAssetStatus[];
  selectedAssetId?: string | null;
  loading?: boolean;
  error?: string | null;
  onSelectAsset?: (id: string) => void;
}

const tableColumns: DataTableColumn[] = [
  { key: 'id', header: 'Asset ID' },
  { key: 'type', header: 'Type' },
  {
    key: 'managed',
    header: 'Managed',
    align: 'center',
    render: (row) => ((row.managed as boolean) ? 'yes' : 'no'),
  },
  {
    key: 'installed',
    header: 'Installed',
    align: 'center',
    render: (row) => ((row.installed as boolean) ? 'yes' : 'no'),
  },
  {
    key: 'upToDate',
    header: 'Up-to-date',
    align: 'center',
    render: (row) => ((row.upToDate as boolean) ? 'yes' : 'no'),
  },
  {
    key: 'destination',
    header: 'Destination',
    render: (row) =>
      (row.destinationAbs as string | undefined) ?? (row.destination as string | undefined) ?? '-',
  },
];

export default function ManagedAssetsTable({
  managedAssets = [],
  selectedAssetId = null,
  loading = false,
  error = null,
  onSelectAsset,
}: ManagedAssetsTableProps) {
  const rows = managedAssets as DataTableRow[];

  return (
    <section className="managed-assets-table" data-testid="managed-assets-table">
      {loading && managedAssets.length === 0 ? <p className="state-message">Loading managed assets...</p> : null}
      {!loading && error && managedAssets.length === 0 ? (
        <p className="state-message state-error" role="alert">
          {error}
        </p>
      ) : null}

      {managedAssets.length > 0 || (!loading && !error) ? (
        <>
          <DataTable
            caption="Managed assets from the typed API client."
            columns={tableColumns}
            emptyMessage="No managed assets were returned."
            rows={rows}
            testId="managed-assets-data-table"
          />

          {managedAssets.length > 0 ? (
            <div className="asset-select">
              <p className="asset-select-label">Select a managed asset for the viewer</p>
              <ul>
                {managedAssets.map((asset) => (
                  <li key={asset.id}>
                    <button
                      aria-pressed={asset.id === selectedAssetId}
                      className={asset.id === selectedAssetId ? 'selected' : ''}
                      onClick={() => onSelectAsset?.(asset.id)}
                      type="button"
                    >
                      <span className="asset-id">{asset.id}</span>
                      <span className="asset-type">{asset.type}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
