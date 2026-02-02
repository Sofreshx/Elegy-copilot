/**
 * Agent selector component for choosing default agent.
 */
import { useSettings, useSetDefaultAgent } from '../../hooks/useSettings';
import './AgentSelector.css';

const AGENT_DESCRIPTIONS: Record<string, string> = {
  'executive2-planner': 'Planning and task breakdown',
  'executive2': 'Full orchestration and execution',
  'debugger': 'Error investigation and fixes',
  'code-explorer': 'Codebase analysis and mapping',
  'code-reviewer': 'Code quality and security review',
  'code-architect': 'Architecture design and blueprints',
  'task-runner': 'Single task execution',
  'test-runner': 'Test execution with safety',
  'test-executive': 'Test orchestration and planning',
};

export default function AgentSelector() {
  const { data: settings, isLoading } = useSettings();
  const setDefault = useSetDefaultAgent();

  if (isLoading || !settings) {
    return (
      <div className="agent-selector loading">
        <span className="spinner-small"></span>
        Loading agents...
      </div>
    );
  }

  const handleSelect = (agentId: string) => {
    if (agentId !== settings.agent.defaultAgent) {
      setDefault.mutate(agentId);
    }
  };

  return (
    <div className="agent-selector">
      <div className="agent-selector-list">
        {settings.agent.availableAgents.map((agentId) => (
          <button
            key={agentId}
            className={`agent-option ${settings.agent.defaultAgent === agentId ? 'selected' : ''}`}
            onClick={() => handleSelect(agentId)}
            disabled={setDefault.isPending}
          >
            <div className="agent-option-header">
              <span className="agent-option-name">@{agentId}</span>
              {settings.agent.defaultAgent === agentId && (
                <span className="agent-option-badge">Default</span>
              )}
            </div>
            <span className="agent-option-desc">
              {AGENT_DESCRIPTIONS[agentId] || 'AI agent'}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
