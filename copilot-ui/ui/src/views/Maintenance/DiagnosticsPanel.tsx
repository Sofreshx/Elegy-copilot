import { useState } from 'react';
import { Panel } from '../../components';
import GatewayView from '../../tabs/Gateway/GatewayView';
import LspView from '../../tabs/LSP/LspView';
import StatsView from '../../tabs/Stats/StatsView';
import TrackerView from '../../tabs/Tracker/TrackerView';

interface DiagnosticSection {
  id: string;
  label: string;
  content: JSX.Element;
}

const SECTIONS: DiagnosticSection[] = [
  { id: 'stats', label: 'Runtime & Stats', content: <StatsView /> },
  { id: 'gateway', label: 'Gateway', content: <GatewayView /> },
  { id: 'tracker', label: 'Tracker', content: <TrackerView /> },
  { id: 'lsp', label: 'LSP', content: <LspView /> },
];

export default function DiagnosticsPanel() {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    stats: true,
    gateway: false,
    tracker: false,
    lsp: false,
  });

  function toggleSection(id: string) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  return (
    <div className="maintenance-diagnostics-panel" data-testid="maintenance-diagnostics">
      {SECTIONS.map((section) => (
        <Panel key={section.id} testId={`diagnostics-section-${section.id}`}>
          <button
            className="diagnostics-section-header"
            data-testid={`diagnostics-toggle-${section.id}`}
            onClick={() => toggleSection(section.id)}
            type="button"
          >
            <span>{expanded[section.id] ? '▾' : '▸'} {section.label}</span>
          </button>
          {expanded[section.id] ? (
            <div className="diagnostics-section-body" data-testid={`diagnostics-body-${section.id}`}>
              {section.content}
            </div>
          ) : null}
        </Panel>
      ))}
    </div>
  );
}
