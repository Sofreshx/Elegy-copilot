export type SessionTemplate = {
  id: string;
  label: string;
  description: string;
  defaultObjective?: string;
};

export const SESSION_TEMPLATES: SessionTemplate[] = [
  {
    id: 'code-review',
    label: 'Code Review',
    description: 'Review code changes for quality, bugs, and best practices',
    defaultObjective: 'Review the latest changes and provide feedback',
  },
  {
    id: 'feature-impl',
    label: 'Feature Implementation',
    description: 'Implement a new feature end-to-end',
    defaultObjective: 'Implement the specified feature with tests',
  },
  {
    id: 'bug-fix',
    label: 'Bug Fix',
    description: 'Investigate and fix a reported bug',
    defaultObjective: 'Diagnose and fix the reported issue',
  },
  {
    id: 'refactor',
    label: 'Refactor',
    description: 'Improve code structure without changing behavior',
    defaultObjective: 'Refactor the target code for better maintainability',
  },
  {
    id: 'exploration',
    label: 'Exploration',
    description: 'Explore and understand a codebase area',
    defaultObjective: 'Explore and document the target area',
  },
];
