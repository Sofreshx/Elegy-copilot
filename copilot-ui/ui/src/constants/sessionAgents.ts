export interface SessionAgent {
  id: string;
  label: string;
  description: string;
  icon: string;
  defaultObjective?: string;
  defaultModel?: string;
}

export const SESSION_AGENTS: SessionAgent[] = [
  {
    id: 'orchestrator-cli',
    label: 'Work on Codebase',
    description: 'Plan and implement changes, fix bugs, refactor code',
    icon: '🛠',
    defaultModel: 'claude-opus-4.6',
  },
  {
    id: 'ask',
    label: 'Ask / Research',
    description: 'Ask questions, explore code, get explanations',
    icon: '💬',
    defaultModel: 'claude-opus-4.6',
  },
  {
    id: 'autonomous-tester',
    label: 'Test & Report',
    description: 'Run features, find bugs, generate test reports',
    icon: '🧪',
    defaultModel: 'gpt-5.4',
  },
  {
    id: 'devops',
    label: 'DevOps & Infra',
    description: 'GitHub Actions, CI/CD, releases, infrastructure checks',
    icon: '⚙',
    defaultModel: 'gpt-5.4',
  },
];

export const DEFAULT_AGENT_ID = 'orchestrator-cli';
