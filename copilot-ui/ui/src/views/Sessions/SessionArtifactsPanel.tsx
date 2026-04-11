import { useState } from 'react';
import { Panel } from '../../components';
import { humanizeToken } from '../../lib/stateDiagnostics';
import type { SessionDetailState } from './sessionDetailStore';

interface Props {
  state: SessionDetailState;
}

function CollapsibleSection({
  title,
  content,
  testId,
}: {
  title: string;
  content: string;
  testId: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="collapsible-section" data-testid={testId}>
      <button
        className="collapsible-section-toggle"
        data-testid={`${testId}-toggle`}
        type="button"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="collapsible-section-arrow">{open ? '▾' : '▸'}</span>
        <span className="collapsible-section-title">{title}</span>
      </button>
      {open && (
        <div className="collapsible-section-body" data-testid={`${testId}-content`}>
          <pre className="artifact-content">{content}</pre>
        </div>
      )}
    </div>
  );
}

export default function SessionArtifactsPanel({ state }: Props) {
  const { plans, handoff, proposition, verificationGuide, agentUsage } = state;

  const topAgents = agentUsage?.usage
    ? Object.entries(agentUsage.usage)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
    : [];

  const hasAnyContent =
    plans.length > 0 ||
    handoff !== null ||
    proposition !== null ||
    verificationGuide !== null ||
    topAgents.length > 0;

  return (
    <div className="session-artifacts-panel" data-testid="session-artifacts-panel">
      {!hasAnyContent && (
        <div className="session-empty-state" data-testid="artifacts-empty-state">
          No artifacts available for this session
        </div>
      )}

      {plans.length > 0 && (
        <Panel title="Plans" testId="artifacts-plans-panel">
          <ul className="artifact-list" data-testid="plan-artifact-list">
            {plans.map((plan) => (
              <li
                key={plan.id}
                className="artifact-list-item"
                data-testid="plan-artifact-item"
              >
                <span className="artifact-item-id">{plan.id}</span>
                {plan.kind && (
                  <span className="artifact-item-kind">{humanizeToken(plan.kind)}</span>
                )}
                {plan.status && (
                  <span className="artifact-item-status">{humanizeToken(plan.status)}</span>
                )}
                {plan.source && (
                  <span className="artifact-item-source">{plan.source}</span>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {handoff !== null && (
        <CollapsibleSection
          title="Handoff"
          content={handoff}
          testId="artifact-handoff"
        />
      )}

      {proposition !== null && (
        <CollapsibleSection
          title="Proposition"
          content={proposition}
          testId="artifact-proposition"
        />
      )}

      {verificationGuide !== null && (
        <CollapsibleSection
          title="Verification Guide"
          content={verificationGuide}
          testId="artifact-verification-guide"
        />
      )}

      {topAgents.length > 0 && (
        <Panel title="Agent Usage" testId="artifacts-agent-usage-panel">
          <ul className="artifact-list" data-testid="agent-usage-list">
            {topAgents.map(([agent, count]) => (
              <li
                key={agent}
                className="artifact-list-item"
                data-testid="agent-usage-item"
              >
                <span className="artifact-item-label">{humanizeToken(agent)}</span>
                <span className="artifact-item-count">{count} call{count !== 1 ? 's' : ''}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
