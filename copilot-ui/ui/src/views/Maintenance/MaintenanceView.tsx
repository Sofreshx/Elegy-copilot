import { Toolbar } from '../../components';
import { useStoreValue } from '../../lib/store';
import { navigationStore, type MaintenanceSection } from '../../stores/navigation';
import AssetsMaintenancePanel from './AssetsMaintenancePanel';
import DiagnosticsPanel from './DiagnosticsPanel';
import UpdatesSection from './UpdatesSection';

const TABS: { id: MaintenanceSection; label: string }[] = [
  { id: 'updates', label: 'Updates' },
  { id: 'diagnostics', label: 'Diagnostics' },
  { id: 'assets', label: 'Assets' },
];

function renderSection(section: MaintenanceSection) {
  switch (section) {
    case 'updates':
      return <UpdatesSection />;
    case 'diagnostics':
      return <DiagnosticsPanel />;
    case 'assets':
      return <AssetsMaintenancePanel />;
    default:
      return <UpdatesSection />;
  }
}

export default function MaintenanceView() {
  const navigationState = useStoreValue(navigationStore);
  const section = navigationState.maintenanceSection;

  return (
    <div className="maintenance-view" data-testid="maintenance-view">
      <Toolbar testId="maintenance-toolbar">
        <h2>Maintenance</h2>
        <div className="maintenance-tabs">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={`maintenance-tab${section === tab.id ? ' maintenance-tab-active' : ''}`}
              data-testid={`maintenance-tab-${tab.id}`}
              onClick={() => navigationStore.setMaintenanceSection(tab.id)}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>
      </Toolbar>

      <div className="maintenance-content" data-testid="maintenance-content">
        {renderSection(section)}
      </div>
    </div>
  );
}
