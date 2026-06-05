import { useMemo, useState, useEffect } from 'react';
import { Button, Panel } from '../../components';
import { useStoreValue } from '../../lib/store';
import { repositoriesStore } from './repositoriesStore';

function parsePathListInput(input: string): string[] {
  return Array.from(new Set(
    input
      .split(/\r?\n|,/)
      .map((v) => v.trim())
      .filter(Boolean)
  ));
}

function formatPathList(values: string[] | null | undefined): string {
  return Array.isArray(values) && values.length > 0 ? values.join(' · ') : '\u2014';
}

export default function SourcesConfigPanel() {
  const state = useStoreValue(repositoriesStore);
  const savedCustomRoots = state.workspaceScan?.customScanRoots ?? [];
  const [input, setInput] = useState(savedCustomRoots.join('\n'));
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!dirty) {
      setInput(savedCustomRoots.join('\n'));
    }
  }, [savedCustomRoots, dirty]);

  const draftRoots = useMemo(() => parsePathListInput(input), [input]);
  const hasChanges = useMemo(
    () => draftRoots.join('|') !== savedCustomRoots.join('|'),
    [draftRoots, savedCustomRoots]
  );

  async function handleSave() {
    await repositoriesStore.saveScanRoots(draftRoots);
    setDirty(false);
  }

  function handleReset() {
    setInput(savedCustomRoots.join('\n'));
    setDirty(false);
  }

  return (
    <Panel
      title="Source Folders"
      subtitle="Folders scanned for git repositories"
      testId="repos-sources-config"
    >
      <p className="state-copy">
        Default scan roots: <code>{formatPathList(state.workspaceScan?.defaultRoots)}</code>
      </p>
      <p className="state-copy">
        Effective scan roots: <code>{formatPathList(state.workspaceScan?.scanRoots)}</code>
      </p>
      <label className="form-label" htmlFor="repos-custom-scan-roots">
        Custom scan roots
      </label>
      <textarea
        id="repos-custom-scan-roots"
        className="form-textarea"
        rows={4}
        placeholder={'C:\\Users\\you\\Documents\\GitHub\nD:\\work\\repos'}
        value={input}
        onChange={(e) => {
          setDirty(true);
          setInput(e.target.value);
        }}
      />
      <p className="state-copy">
        One path per line. Saved to{' '}
        <code>{state.workspaceScan?.storage?.path || '~/.copilot/catalog/repo-discovery.json'}</code>.
      </p>
      <div className="catalog-action-row">
        <Button
          variant="secondary"
          size="sm"
          testId="repos-save-scan-roots"
          disabled={state.loading || !hasChanges}
          onClick={handleSave}
        >
          {state.loading ? 'Saving\u2026' : 'Save'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          testId="repos-reset-scan-roots"
          disabled={!dirty}
          onClick={handleReset}
        >
          Reset
        </Button>
      </div>
    </Panel>
  );
}
