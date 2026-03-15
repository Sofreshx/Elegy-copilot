export const TAB_IDS = [
  'planning',
  'catalog',
  'sessions',
  'state',
] as const;

export type TabId = (typeof TAB_IDS)[number];

export type NavigationTab = {
  id: TabId;
  label: string;
  description: string;
};

export const NAVIGATION_TABS: readonly NavigationTab[] = [
  { id: 'planning', label: 'Planning', description: 'Ideas, records, and compile workflow' },
  { id: 'catalog', label: 'Catalog', description: 'Asset workspace, installs, and skill discovery' },
  { id: 'sessions', label: 'Sessions', description: 'Runtime sessions and sandbox workspaces' },
  { id: 'state', label: 'State', description: 'System readiness, gateway, tracker, and LSP' },
];
