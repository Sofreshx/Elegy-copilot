export const TAB_IDS = [
  'sessions',
  'assets',
  'planning',
  'gateway',
  'sandboxes',
  'lsp',
  'tracker',
  'skills-preview',
  'workflows',
] as const;

export type TabId = (typeof TAB_IDS)[number];

export type NavigationTab = {
  id: TabId;
  label: string;
  description: string;
};

export const NAVIGATION_TABS: readonly NavigationTab[] = [
  { id: 'sessions', label: 'Sessions', description: 'Runtime and active sessions' },
  { id: 'assets', label: 'Assets', description: 'Asset catalog and installs' },
  { id: 'planning', label: 'Planning', description: 'Plan packs and sequencing' },
  { id: 'gateway', label: 'Gateway', description: 'Policy and command routing' },
  { id: 'sandboxes', label: 'Sandboxes', description: 'Workspace isolation controls' },
  { id: 'lsp', label: 'LSP', description: 'Language server lifecycle' },
  { id: 'tracker', label: 'Tracker', description: 'Local tracker diagnostics' },
  { id: 'skills-preview', label: 'Skills Preview', description: 'Skill discovery and previews' },
  { id: 'workflows', label: 'Workflows', description: 'Migration wave orchestration' },
];
