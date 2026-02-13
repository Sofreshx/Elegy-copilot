const { spawnSync } = require('child_process');

const cli = 'C:/Users/lolzi/Documents/GitHub/instruction-engine/vscode-skill-installer/scripts/e3-cli.js';
const db = 'C:/Users/lolzi/source/repos/SAASTools/.e3-local/executive3.db';

function run(args) {
  const res = spawnSync('node', [cli, ...args, '--db', db], { encoding: 'utf8' });
  if (res.stdout) process.stdout.write(res.stdout.trim() + '\n');
  if (res.stderr) process.stderr.write(res.stderr);
  if (res.status !== 0) {
    throw new Error(`Command failed: ${args.join(' ')}\n${res.stdout}\n${res.stderr}`);
  }
}

const planId = 'plan-20260213-wsui';
const sessionId = 'e3-20260213-203500-wsui';

const plan = {
  id: planId,
  title: 'Workspace shell simplification and targeted agentic UX refactor',
  summary: 'Consolidate workspace into one persistent shell with route-driven subpages; remove tabs/hubs/home/offers-news; simplify agentic session center; move internals to right panel; add workflows/addons/browser-assist/connections pages with strict security boundaries and rollback gate.',
};

const session = {
  id: sessionId,
  plan_id: planId,
  request_summary:
    'Simplify workspace UI: remove tab/hub model, keep consolidated shell with left nav, refactor agentic session UX, add workflows/addons/browser-assist/connections pages, and enforce security-first boundaries.',
  context_snapshot:
    'SAASTools Frontend uses React19+Vite+Zustand+Tailwind feature modules. Target files include AppRouter, AgenticWorkbenchPage, AgenticSidebarView, useWorkspaceStore. Constraints: route-driven navigation, no credential capture for browser-assist/connections, keep design tokens, strong migration/redirect safety and tests.',
};

const tasks = [
  {
    id: 'e3t-wsui-001',
    title: 'Refactor workspace routing and legacy redirects',
    group_id: 'group-01-shell',
    group_title: 'Group 1: Shell foundation',
    group_order: 1,
    priority: 3,
    depends_on: '[]',
    skills: '["frontend","refactor"]',
    description:
      'Create nested /workspace/* routes, set /workspace default to /workspace/agentic-session, and redirect /workbench + legacy tab/home/hub deep links to canonical subpages.',
    acceptance_criteria:
      'All required routes resolve in-place; /workspace redirects to /workspace/agentic-session; legacy workbench/tab/home/hub URLs redirect deterministically without reload loops.',
  },
  {
    id: 'e3t-wsui-002',
    title: 'Build consolidated Workspace shell with persistent nav',
    group_id: 'group-01-shell',
    group_title: 'Group 1: Shell foundation',
    group_order: 1,
    priority: 3,
    depends_on: '["e3t-wsui-001"]',
    skills: '["frontend"]',
    description:
      'Implement shell layout with persistent left menu and nested outlet rendering for Agentic Session, My/Public Workflows, My/Public Addons, Browser Assist, Connections.',
    acceptance_criteria:
      'Left nav persists across subpages; shell branding uses Workspace (not Agentic Workbench); no full-page reload when switching subpages.',
  },
  {
    id: 'e3t-wsui-003',
    title: 'Migrate workspace store away from tabs hubs home',
    group_id: 'group-01-shell',
    group_title: 'Group 1: Shell foundation',
    group_order: 1,
    priority: 3,
    depends_on: '["e3t-wsui-002"]',
    skills: '["frontend","refactor"]',
    description:
      'Remove tab/home/hub navigation state from workspace store and keep only shell UI state (panel collapse/width prefs) with migration for persisted legacy keys.',
    acceptance_criteria:
      'Route drives page selection; no runtime references to tabs/hubs/home for workspace navigation; persisted legacy state migrates without runtime errors.',
  },
  {
    id: 'e3t-wsui-004',
    title: 'Refactor agentic session center and startup resume behavior',
    group_id: 'group-02-agentic',
    group_title: 'Group 2: Agentic session',
    group_order: 2,
    priority: 3,
    depends_on: '["e3t-wsui-002","e3t-wsui-003"]',
    skills: '["frontend"]',
    description:
      'Rework agentic session main area to emphasize high-level execution and steering; define startup behavior: resume active session if present else create new with graceful fallback.',
    acceptance_criteria:
      'Center focuses on execution goals/progress; startup rule is deterministic (resume-or-create) and handles missing/failed resume safely; no shell-visible Agentic Workbench naming.',
  },
  {
    id: 'e3t-wsui-005',
    title: 'Move context and tool internals to right collapsible panel',
    group_id: 'group-02-agentic',
    group_title: 'Group 2: Agentic session',
    group_order: 2,
    priority: 3,
    depends_on: '["e3t-wsui-004"]',
    skills: '["frontend"]',
    description:
      'Create collapsible right details panel and relocate context usage, tool internals, and low-level diagnostics there with persisted collapse state.',
    acceptance_criteria:
      'Context/tool details are off center; right panel collapse persists and does not interrupt execution; sensitive tool values are redacted by default.',
  },
  {
    id: 'e3t-wsui-006',
    title: 'Implement live execution timeline done current next',
    group_id: 'group-02-agentic',
    group_title: 'Group 2: Agentic session',
    group_order: 2,
    priority: 3,
    depends_on: '["e3t-wsui-004"]',
    skills: '["frontend"]',
    description:
      'Add live execution timeline/graph with explicit done/current/next states and stable fallback behavior for sparse or reconnecting event streams.',
    acceptance_criteria:
      'Timeline updates from session events; supports done/current/next semantics; sparse-event fallback and empty/reconnect states are clear and non-broken.',
  },
  {
    id: 'e3t-wsui-007',
    title: 'Enforce async chat control invariants during execution',
    group_id: 'group-02-agentic',
    group_title: 'Group 2: Agentic session',
    group_order: 2,
    priority: 3,
    depends_on: '["e3t-wsui-004","e3t-wsui-006"]',
    skills: '["frontend","design"]',
    description:
      'Define and implement control invariants while running (message send, steer, pause/cancel, disabled states, idempotent action handling).',
    acceptance_criteria:
      'User can chat/steer during run; controls expose deterministic enabled/disabled and pending states; duplicate click/race does not produce duplicated commands.',
  },
  {
    id: 'e3t-wsui-008',
    title: 'Implement My Workflows subpage',
    group_id: 'group-03-content',
    group_title: 'Group 3: Workflows and addons',
    group_order: 3,
    priority: 2,
    depends_on: '["e3t-wsui-002"]',
    skills: '["frontend","react-query"]',
    description: 'Build /workspace/workflows/my list view reusing existing workflow queries and actions.',
    acceptance_criteria:
      'Private workflows load for current user/tenant with consistent list states; existing actions continue to work.',
  },
  {
    id: 'e3t-wsui-009',
    title: 'Implement Public Workflows subpage',
    group_id: 'group-03-content',
    group_title: 'Group 3: Workflows and addons',
    group_order: 3,
    priority: 2,
    depends_on: '["e3t-wsui-008"]',
    skills: '["frontend","react-query"]',
    description:
      'Build /workspace/workflows/public from existing public/template sources with visibility badges and use/clone actions where supported.',
    acceptance_criteria:
      'Public workflows/templates list reliably; badges are consistent; use/clone actions follow existing backend contracts.',
  },
  {
    id: 'e3t-wsui-010',
    title: 'Implement My Addons subpage',
    group_id: 'group-03-content',
    group_title: 'Group 3: Workflows and addons',
    group_order: 3,
    priority: 2,
    depends_on: '["e3t-wsui-002"]',
    skills: '["frontend","react-query"]',
    description:
      'Build /workspace/addons/my with addon availability and normalized states plus remediation actions for pending/invalid states.',
    acceptance_criteria: 'My Addons renders deterministic state badges and relevant actions; permission remediation flows work.',
  },
  {
    id: 'e3t-wsui-011',
    title: 'Implement Public Addons discovery subpage',
    group_id: 'group-03-content',
    group_title: 'Group 3: Workflows and addons',
    group_order: 3,
    priority: 2,
    depends_on: '["e3t-wsui-010"]',
    skills: '["frontend","react-query"]',
    description:
      'Build /workspace/addons/public catalog with concise metadata and access-request entry points.',
    acceptance_criteria:
      'Public addon discovery is available with clear access-required states; no secret values exposed.',
  },
  {
    id: 'e3t-wsui-012',
    title: 'Implement Browser Assist page secure v1',
    group_id: 'group-04-security',
    group_title: 'Group 4: Browser assist and connections',
    group_order: 4,
    priority: 3,
    depends_on: '["e3t-wsui-002","e3t-wsui-007"]',
    skills: '["frontend","security"]',
    description:
      'Build /workspace/browser-assist with observable action feed, explicit permission prompts, and user-browser login handoff model.',
    acceptance_criteria:
      'No credential input fields; privileged actions require permission prompt; UI clearly states user logs in in own browser context only.',
  },
  {
    id: 'e3t-wsui-013',
    title: 'Implement Connections page with secure state model',
    group_id: 'group-04-security',
    group_title: 'Group 4: Browser assist and connections',
    group_order: 4,
    priority: 3,
    depends_on: '["e3t-wsui-002"]',
    skills: '["frontend","security","react-query"]',
    description:
      'Build /workspace/connections with provider cards, state mapping (valid/invalid/pending/not-connected), and connect/reconnect/test/revoke actions via existing flows.',
    acceptance_criteria:
      'Provider states render deterministically; OAuth/connect actions use existing consent hooks; page contains no direct credential-entry controls.',
  },
  {
    id: 'e3t-wsui-014',
    title: 'Remove legacy workspace surfaces and add rollback gate tests',
    group_id: 'group-05-cleanup',
    group_title: 'Group 5: Cleanup and validation',
    group_order: 5,
    priority: 3,
    depends_on:
      '["e3t-wsui-003","e3t-wsui-005","e3t-wsui-006","e3t-wsui-007","e3t-wsui-009","e3t-wsui-011","e3t-wsui-012","e3t-wsui-013"]',
    skills: '["refactor","testing-frontend-unit"]',
    description:
      'Delete workspace hubs/tabs/home/offers-news rendering paths, wire feature flag/kill-switch fallback for rollout, and update tests for routing/security/timeline behavior.',
    acceptance_criteria:
      'Legacy workspace surfaces no longer appear; kill-switch can revert shell route surface safely; tests cover default routing, right panel migration, timeline, and security boundary assertions.',
  },
];

run(['create-plan', JSON.stringify(plan)]);
run(['create-session', JSON.stringify(session)]);
for (const task of tasks) {
  run(['create-task', JSON.stringify({ ...task, plan_id: planId, session_id: sessionId, status: 'not-started' })]);
}
run([
  'log-execution',
  JSON.stringify({
    session_id: sessionId,
    task_id: 'e3t-wsui-001',
    agent_name: 'executive3',
    action: 'created',
    detail: 'Created approved workspace simplification plan and task graph after canceled subagent recovery.',
  }),
]);

console.log(JSON.stringify({ created: true, planId, sessionId, taskCount: tasks.length }));
