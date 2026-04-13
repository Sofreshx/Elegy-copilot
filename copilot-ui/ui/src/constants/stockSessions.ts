export interface StockSession {
  id: string;
  label: string;
  description: string;
  icon: string;
  agentId: string;
  objectiveTemplate: string;
  defaultModel?: string;
  /** Whether this preset needs the "Plan from Backlog" inline flow instead of direct wizard open */
  usesBacklogFlow?: boolean;
}

export const STOCK_SESSIONS: StockSession[] = [
  {
    id: 'plan-from-backlog',
    label: 'Plan from Backlog',
    description: 'Select backlog items and create a planning session',
    icon: '📋',
    agentId: 'orchestrator-cli',
    objectiveTemplate: 'Create an implementation plan addressing the following backlog items:\n\n{bullets}',
    defaultModel: 'claude-opus-4.6',
    usesBacklogFlow: true,
  },
  {
    id: 'code-review',
    label: 'Code Review',
    description: 'Review recent changes for bugs, security issues, and improvements',
    icon: '🔍',
    agentId: 'ask',
    objectiveTemplate: 'Review the recent code changes in this repository. Focus on bugs, security vulnerabilities, and code quality improvements.',
    defaultModel: 'claude-opus-4.6',
  },
  {
    id: 'fix-bug',
    label: 'Fix a Bug',
    description: 'Investigate and fix a reported issue',
    icon: '🐛',
    agentId: 'orchestrator-cli',
    objectiveTemplate: '',
    defaultModel: 'claude-opus-4.6',
  },
  {
    id: 'run-tests',
    label: 'Run Tests',
    description: 'Execute test suite and generate a report',
    icon: '🧪',
    agentId: 'autonomous-tester',
    objectiveTemplate: 'Run the full test suite for this project. Report any failures, coverage gaps, and suggestions for improvement.',
    defaultModel: 'gpt-5.4',
  },
];
