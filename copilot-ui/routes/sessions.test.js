'use strict';

const assert = require('node:assert/strict');

const { register } = require('./sessions');

let passed = 0;

async function test(name, fn) {
	try {
		await fn();
		passed += 1;
		console.log(`  PASS: ${name}`);
	} catch (error) {
		console.error(`  FAIL: ${name}`);
		console.error(`    ${error.message}`);
		process.exitCode = 1;
	}
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function createResponse() {
	const state = {
		statusCode: null,
		headers: null,
		chunks: [],
	};

	return {
		get statusCode() {
			return state.statusCode;
		},
		get bodyText() {
			return state.chunks.join('');
		},
		writeHead(statusCode, headers) {
			state.statusCode = statusCode;
			state.headers = headers;
		},
		write(chunk) {
			if (chunk != null) {
				state.chunks.push(String(chunk));
			}
			return true;
		},
		end(chunk) {
			if (chunk != null) {
				state.chunks.push(String(chunk));
			}
		},
	};
}

function createSendJson() {
	return (res, code, payload) => {
		res.writeHead(code, {
			'Content-Type': 'application/json; charset=utf-8',
			'Cache-Control': 'no-store',
		});
		res.end(JSON.stringify(payload, null, 2));
	};
}

function parseJson(text) {
	return JSON.parse(String(text || '').trim() || '{}');
}

function findRoute(routes, method, pathname) {
	for (const route of routes) {
		if (route.method !== method) {
			continue;
		}

		if (typeof route.path === 'string' && route.path === pathname) {
			return { route, match: null };
		}

		if (route.path instanceof RegExp) {
			const match = pathname.match(route.path);
			if (match) {
				return { route, match };
			}
		}
	}

	throw new Error(`Route not found for ${method} ${pathname}`);
}

async function invoke(routes, method, pathname) {
	const { route, match } = findRoute(routes, method, pathname);
	const req = {};
	const res = createResponse();
	const u = new URL(`http://127.0.0.1${pathname}`);

	route.handler({ req, res, u, match, pathname, copilotHome: 'C:/copilot', vscodeHome: 'C:/vscode', sandboxesHome: 'C:/sandboxes' });
	await sleep(0);
	return { res };
}

function createSessionFs() {
	return {
		existsSync(targetPath) {
			return String(targetPath || '').includes('session-state');
		},
		statSync() {
			return {
				isDirectory() {
					return true;
				},
			};
		},
	};
}

async function run() {
	await test('GET /api/sessions/:id/proposition returns raw and parsed structured entries', async () => {
		const routes = register({
			sendJson: createSendJson(),
			fs: createSessionFs(),
			assets: {
				readTextFileSafe(targetPath) {
					if (String(targetPath).endsWith('proposition.md')) {
						return `## 2026-03-12T12:00:00Z — after-execution — elegy-orchestrator

### Summary
- Execution completed.

### Immediate Next Actions
- Verify the changed files.

### Next Plan Ideas
- Tighten resume heuristics.

### Watch Outs
- Keep parallel-safe ownership explicit.

### Open Risks
- None.

### Details
Completed successfully.
`;
					}
					return null;
				},
			},
			readPlanArtifact() {
				return null;
			},
			listPlanArtifacts() {
				return [];
			},
		});

		const { res } = await invoke(routes, 'GET', '/api/sessions/session-123/proposition');
		const body = parseJson(res.bodyText);

		assert.equal(res.statusCode, 200);
		assert.equal(body.id, 'session-123');
		assert.ok(Array.isArray(body.entries));
		assert.equal(body.entries.length, 1);
		assert.equal(body.latestEntry.phase, 'after-execution');
		assert.ok(body.latestEntry.sections.some((section) => section.key === 'immediateNextActions'));
	});

	await test('GET /api/sessions/:id/handoff returns parsed manifest and required sections', async () => {
		const routes = register({
			sendJson: createSendJson(),
			fs: createSessionFs(),
			assets: {
				readTextFileSafe(targetPath) {
					if (String(targetPath).endsWith('handoff.md')) {
						return `## Handoff Manifest
- Session: session-123
- Plan: plan.md (status: APPROVED)
- Reviewer: Verdict: APPROVED

## Key Decisions
- Use serial execution until file ownership is disjoint.

## Exploration Summary
- engine-assets/agents/elegy-planner.agent.md

## User Constraints
- none

## Immediate Next Actions
- Execute WU-001.

## Next Plan Ideas
- Add richer resume scoring later.

## Watch Outs
- Keep review ledger aligned with handoff state.

## Open Risks
- none
`;
					}
					return null;
				},
			},
			readPlanArtifact() {
				return null;
			},
			listPlanArtifacts() {
				return [];
			},
		});

		const { res } = await invoke(routes, 'GET', '/api/sessions/session-123/handoff');
		const body = parseJson(res.bodyText);

		assert.equal(res.statusCode, 200);
		assert.equal(body.parsed.manifest.session, 'session-123');
		assert.equal(body.parsed.manifest.planStatus, 'APPROVED');
		assert.ok(Array.isArray(body.parsed.sections));
		assert.equal(body.parsed.warnings.length, 0);
	});

	console.log(`\n${passed} tests passed`);
	if (process.exitCode) {
		console.error('Some tests FAILED');
	} else {
		console.log('All tests passed');
	}
}

run();