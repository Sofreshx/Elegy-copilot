import SandboxesView from '../../tabs/Sandboxes/SandboxesView';

export default function SandboxesPanel() {
  return (
    <div className="maintenance-sandboxes-panel" data-testid="maintenance-sandboxes">
      <SandboxesView />
    </div>
  );
}
