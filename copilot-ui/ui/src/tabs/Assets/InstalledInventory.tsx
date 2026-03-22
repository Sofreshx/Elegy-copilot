import type {
  InstalledAgent,
  InstalledAssetsResponse,
  InstalledPrompt,
  InstalledSkill,
} from '../../lib/types';

interface InstalledInventoryProps {
  inventory: InstalledAssetsResponse;
  loading?: boolean;
  error?: string | null;
  selectedAssetPath?: string | null;
  onSelectAsset?: (path: string) => void;
}

const PREVIEW_LIMIT = 4;

function describeInstalledMetadata(item: {
  provider?: string;
  sourcePackage?: string;
  namespace?: string;
  readOnly?: boolean;
}): string {
  const segments: string[] = [];
  if (item.sourcePackage) {
    segments.push(item.sourcePackage);
  } else if (item.provider && item.provider !== 'user-home') {
    segments.push(item.provider);
  }
  if (item.namespace) {
    segments.push(`namespace: ${item.namespace}`);
  }
  if (item.readOnly) {
    segments.push('read-only');
  }
  return segments.join(' · ');
}

function displayAgent(item: InstalledAgent): string {
  return item.name || item.fileName || 'Unknown agent';
}

function displaySkill(item: InstalledSkill): string {
  return item.name || 'Unknown skill';
}

function displayPrompt(item: InstalledPrompt): string {
  return item.name || item.fileName || 'Unknown prompt';
}

export default function InstalledInventory({
  inventory,
  loading = false,
  error = null,
  selectedAssetPath = null,
  onSelectAsset,
}: InstalledInventoryProps) {
  const agentCount = inventory.agents.length;
  const skillCount = inventory.skills.length;
  const promptCount = inventory.prompts.length;

  const agentPreview = inventory.agents.slice(0, PREVIEW_LIMIT);
  const skillPreview = inventory.skills.slice(0, PREVIEW_LIMIT);
  const promptPreview = inventory.prompts.slice(0, PREVIEW_LIMIT);

  const handleSelect = (path: string) => {
    if (!path.trim()) {
      return;
    }
    onSelectAsset?.(path);
  };

  return (
    <section className="installed-inventory" data-testid="installed-inventory">
      {loading && agentCount + skillCount + promptCount === 0 ? (
        <p className="state-message">Loading installed inventory...</p>
      ) : null}
      {!loading && error && agentCount + skillCount + promptCount === 0 ? (
        <p className="state-message state-error" role="alert">
          {error}
        </p>
      ) : null}

      {!loading || agentCount + skillCount + promptCount > 0 || !error ? (
        <>
          <div aria-label="Installed asset summary" className="inventory-summary" role="list">
            <article role="listitem">
              <p className="label">Agents</p>
              <p className="value">{agentCount}</p>
            </article>
            <article role="listitem">
              <p className="label">Skills</p>
              <p className="value">{skillCount}</p>
            </article>
            <article role="listitem">
              <p className="label">Prompts</p>
              <p className="value">{promptCount}</p>
            </article>
          </div>

          <div className="preview-grid">
            <section>
              <p className="preview-title">Agent Preview</p>
              {agentPreview.length === 0 ? <p className="preview-empty">No installed agents.</p> : null}
              {agentPreview.length > 0 ? (
                <ul>
                  {agentPreview.map((item) => (
                    <li key={item.absPath}>
                      <button
                        className={item.absPath === selectedAssetPath ? 'selected' : ''}
                        onClick={() => handleSelect(item.absPath)}
                        type="button"
                      >
                        <span>{displayAgent(item)}</span>
                        {describeInstalledMetadata(item) ? <small>{describeInstalledMetadata(item)}</small> : null}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>

            <section>
              <p className="preview-title">Skill Preview</p>
              {skillPreview.length === 0 ? <p className="preview-empty">No installed skills.</p> : null}
              {skillPreview.length > 0 ? (
                <ul>
                  {skillPreview.map((item) => (
                    <li key={item.absPath}>
                      <button
                        className={item.absPath === selectedAssetPath ? 'selected' : ''}
                        onClick={() => handleSelect(item.absPath)}
                        type="button"
                      >
                        <span>{displaySkill(item)}</span>
                        {describeInstalledMetadata(item) ? <small>{describeInstalledMetadata(item)}</small> : null}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>

            <section>
              <p className="preview-title">Prompt Preview</p>
              {promptPreview.length === 0 ? <p className="preview-empty">No installed prompts.</p> : null}
              {promptPreview.length > 0 ? (
                <ul>
                  {promptPreview.map((item) => (
                    <li key={item.absPath}>
                      <button
                        className={item.absPath === selectedAssetPath ? 'selected' : ''}
                        onClick={() => handleSelect(item.absPath)}
                        type="button"
                      >
                        <span>{displayPrompt(item)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          </div>

          <section className="instructions-status">
            <p className="preview-title">Instructions</p>
            {inventory.instructions.installed ? (
              <button
                className={inventory.instructions.absPath === selectedAssetPath ? 'selected' : ''}
                onClick={() => handleSelect(inventory.instructions.absPath)}
                type="button"
              >
                {inventory.instructions.absPath}
              </button>
            ) : (
              <p className="preview-empty">Instructions not installed.</p>
            )}
          </section>
        </>
      ) : null}
    </section>
  );
}
