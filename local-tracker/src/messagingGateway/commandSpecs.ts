import type { PlatformCommandSpec } from './platform';

export function getDefaultGatewayCommandSpecs(): PlatformCommandSpec[] {
	return [
		{ name: '/status', description: 'Show gateway status', tier: 'read' },
		{
			name: '/sessions',
			description: 'List recent sessions',
			tier: 'read',
			options: [
				{ name: 'limit', description: 'Max sessions to list (1-200)', type: 'integer' },
				{ name: 'statuses', description: 'Comma-separated statuses filter', type: 'string' },
			],
		},
		{ name: '/git', description: 'Show git status for active workspace', tier: 'read' },
		{ name: '/workspaces', description: 'List allowlisted workspaces', tier: 'read' },
		{
			name: '/task',
			description: 'Run a task (connected-only)',
			tier: 'invoke',
			options: [{ name: 'prompt', description: 'Task prompt', type: 'string', required: true }],
		},
		{
			name: '/plan',
			description: 'Plan work (connected-only)',
			tier: 'invoke',
			options: [{ name: 'prompt', description: 'Planning prompt', type: 'string', required: true }],
		},
		{
			name: '/stop',
			description: 'Stop a session (connected-only)',
			tier: 'invoke',
			options: [{ name: 'sessionid', description: 'Session id', type: 'string', required: true }],
		},
		{
			name: '/switch',
			description: 'Switch the active workspace root',
			tier: 'admin',
			options: [{ name: 'workspaceroot', description: 'Workspace root path', type: 'string', required: true }],
		},
		{
			name: '/workflow',
			description: 'Run or list workflow templates',
			tier: 'admin',
			options: [
				{ name: 'subcommand', description: 'run | list', type: 'string', required: true },
				{ name: 'name', description: 'Workflow template name (for run)', type: 'string' },
			],
		},
	];
}
