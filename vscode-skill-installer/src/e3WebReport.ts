function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function toPrettyJson(data: unknown): string {
	return escapeHtml(JSON.stringify(data, null, 2));
}

export function buildE3DashboardHtml(payload: Record<string, unknown[]>): string {
	const sections = [
		{ key: 'sessions', title: 'Sessions' },
		{ key: 'todos', title: 'Todos' },
		{ key: 'task_plans', title: 'Task Plans' },
		{ key: 'tasks', title: 'Tasks' },
		{ key: 'plans', title: 'Plans' },
		{ key: 'execution_log', title: 'Execution Log' },
		{ key: 'context_notes', title: 'Context Notes' },
		{ key: 'context_links', title: 'Context Links' },
		{ key: 'context_embeddings', title: 'Context Embeddings' },
	] as const;

	const cards = sections.map((section) => {
		const rows = payload[section.key] ?? [];
		const count = Array.isArray(rows) ? rows.length : 0;
		const preview = Array.isArray(rows) ? rows.slice(0, 10) : rows;
		return `
			<section class="card">
				<h2>${escapeHtml(section.title)} <span>${count}</span></h2>
				<pre>${toPrettyJson(preview)}</pre>
			</section>
		`;
	});

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<title>Executive3 Dashboard</title>
	<style>
		:root {
			color-scheme: dark;
			font-family: Segoe UI, system-ui, -apple-system, sans-serif;
			background: #0f111a;
			color: #e6edf3;
		}
		body { margin: 0; padding: 24px; }
		header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; }
		h1 { margin: 0; font-size: 20px; }
		.meta { color: #9da7b3; font-size: 12px; }
		.grid {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
			gap: 14px;
		}
		.card {
			background: #161b22;
			border: 1px solid #2d333b;
			border-radius: 10px;
			padding: 12px;
			min-height: 220px;
		}
		.card h2 {
			font-size: 14px;
			display: flex;
			justify-content: space-between;
			margin: 0 0 8px;
		}
		.card h2 span {
			font-weight: 600;
			color: #7ee787;
		}
		pre {
			margin: 0;
			white-space: pre-wrap;
			word-break: break-word;
			font-size: 12px;
			line-height: 1.45;
			color: #c9d1d9;
		}
	</style>
</head>
<body>
	<header>
		<h1>Executive3 Browser Dashboard</h1>
		<div class="meta">Generated: ${escapeHtml(new Date().toISOString())}</div>
	</header>
	<div class="grid">
		${cards.join('\n')}
	</div>
</body>
</html>`;
}
