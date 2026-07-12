import Panel from '../../components/Panel';

export default function AppearanceSettings() {
  return (
    <Panel title="Appearance" subtitle="Ember Foundry workspace shell" testId="settings-appearance">
      <div className="appearance-setting" data-testid="theme-preference">
        <span className="appearance-setting-copy">
          <strong>Ember Foundry</strong>
          <span>A focused warm-carbon theme designed for long developer sessions.</span>
        </span>
        <span className="badge badge-success">Active</span>
      </div>
    </Panel>
  );
}
