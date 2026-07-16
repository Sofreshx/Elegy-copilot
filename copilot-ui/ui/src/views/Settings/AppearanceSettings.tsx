import Panel from '../../components/Panel';

export default function AppearanceSettings() {
  return (
    <Panel title="Appearance" subtitle="Graphite workspace shell" testId="settings-appearance">
      <div className="appearance-setting" data-testid="theme-preference">
        <span className="appearance-setting-copy">
          <strong>Graphite</strong>
          <span>A restrained neutral theme designed for focused developer work.</span>
        </span>
        <span className="badge badge-success">Active</span>
      </div>
    </Panel>
  );
}
