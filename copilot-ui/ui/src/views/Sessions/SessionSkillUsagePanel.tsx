import { Panel, StatusBadge } from '../../components';
import type { SessionAgentUsageResponse } from '../../lib/types';

interface Props {
  agentUsage: SessionAgentUsageResponse | null;
}

function SkillRow({ assetId, count, lastUsed }: { assetId: string; count: number; lastUsed?: string | null }) {
  const label = assetId.replace(/^skill[_-]/, '').replace(/[_-]/g, ' ');
  return (
    <tr className="skill-usage-row" data-testid="skill-usage-row">
      <td className="skill-usage-name">{label}</td>
      <td className="skill-usage-count">{count}</td>
      <td className="skill-usage-last">{lastUsed ?? '—'}</td>
    </tr>
  );
}

function AgentUsageSection({ usage }: { usage: Record<string, number> }) {
  const entries = Object.entries(usage).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return null;

  return (
    <div className="skill-usage-section" data-testid="agent-usage-section">
      <h4 className="skill-usage-section-title">Agent Delegations</h4>
      <table className="skill-usage-table">
        <thead>
          <tr>
            <th>Agent</th>
            <th>Calls</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([agent, count]) => (
            <tr key={agent} className="skill-usage-row" data-testid="agent-usage-row">
              <td className="skill-usage-name">{agent}</td>
              <td className="skill-usage-count">{count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function SessionSkillUsagePanel({ agentUsage }: Props) {
  if (!agentUsage) {
    return (
      <div className="session-skill-usage-panel" data-testid="skill-usage-panel">
        <div className="session-empty-state" data-testid="skill-usage-empty">
          No usage data available for this session
        </div>
      </div>
    );
  }

  const skills = agentUsage.skillUsage?.skills ?? [];
  const totalInvocations = agentUsage.skillUsage?.totalInvocations ?? 0;
  const uniqueCount = agentUsage.skillUsage?.uniqueSkillCount ?? 0;

  return (
    <div className="session-skill-usage-panel" data-testid="skill-usage-panel">
      {skills.length > 0 && (
        <Panel testId="skill-usage-summary-panel">
          <div className="skill-usage-header">
            <h4 className="skill-usage-section-title">Skill Invocations</h4>
            <div className="skill-usage-stats">
              <StatusBadge status={`${totalInvocations} total`} testId="skill-total-badge" />
              <StatusBadge status={`${uniqueCount} unique`} testId="skill-unique-badge" />
            </div>
          </div>
          <table className="skill-usage-table">
            <thead>
              <tr>
                <th>Skill</th>
                <th>Invocations</th>
                <th>Last Used</th>
              </tr>
            </thead>
            <tbody>
              {skills.map((s) => (
                <SkillRow
                  key={s.assetId}
                  assetId={s.assetId}
                  count={s.invocationCount}
                  lastUsed={s.lastInvokedAt}
                />
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      <AgentUsageSection usage={agentUsage.usage ?? {}} />

      {skills.length === 0 && Object.keys(agentUsage.usage ?? {}).length === 0 && (
        <div className="session-empty-state" data-testid="skill-usage-empty">
          No skill or agent usage recorded for this session
        </div>
      )}
    </div>
  );
}
