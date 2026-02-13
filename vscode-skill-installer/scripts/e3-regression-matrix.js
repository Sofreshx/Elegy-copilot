#!/usr/bin/env node

const Database = require('better-sqlite3');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const DB_PATH_CONFLICT_CODE = 'E_DB_PATH_CONFLICT';
const DB_PATH_CONFLICT_CLASSIFICATION = 'db-path-signal-conflict';
const cliPath = path.join(__dirname, 'e3-cli.js');

function canonicalPath(inputPath) {
	const normalized = path.normalize(inputPath);
	return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function ensureDirectory(dirPath) {
	fs.mkdirSync(dirPath, { recursive: true });
}

function ensureFile(filePath, content = '') {
	ensureDirectory(path.dirname(filePath));
	fs.writeFileSync(filePath, content, 'utf8');
}

function parseJsonOutput(stdout) {
	const trimmed = (stdout || '').trim();
	if (!trimmed) return null;
	try {
		return JSON.parse(trimmed);
	} catch {
		return null;
	}
}

function extractDbPath(stderr) {
	const match = (stderr || '').match(/\[E3 CLI\] DB \(([^)]+)\):\s*(.+)/);
	if (!match) {
		return { source: null, path: null };
	}
	return {
		source: match[1],
		path: match[2].trim(),
	};
}

function runCli({ cwd, args, env = {} }) {
	const result = spawnSync(process.execPath, [cliPath, ...args], {
		cwd,
		encoding: 'utf8',
		env: { ...process.env, ...env },
	});

	return {
		status: result.status ?? 1,
		stdout: result.stdout || '',
		stderr: result.stderr || '',
		json: parseJsonOutput(result.stdout),
		dbSignal: extractDbPath(result.stderr),
	};
}

function runCliAsync({ cwd, args, env = {} }) {
	return new Promise((resolve) => {
		const child = spawn(process.execPath, [cliPath, ...args], {
			cwd,
			env: { ...process.env, ...env },
			stdio: ['ignore', 'pipe', 'pipe'],
		});

		let stdout = '';
		let stderr = '';

		child.stdout.on('data', (chunk) => {
			stdout += chunk.toString();
		});

		child.stderr.on('data', (chunk) => {
			stderr += chunk.toString();
		});

		child.on('close', (status) => {
			resolve({
				status: status ?? 1,
				stdout,
				stderr,
				json: parseJsonOutput(stdout),
				dbSignal: extractDbPath(stderr),
			});
		});
	});
}

function fail(message, context = {}) {
	const payload = {
		status: 'failed',
		error: message,
		context,
	};
	console.error(JSON.stringify(payload, null, 2));
	throw new Error(message);
}

function assert(condition, message, context = {}) {
	if (!condition) {
		fail(message, context);
	}
}

function createLayout(rootDir) {
	const workspaceRoot = path.join(rootDir, 'workspace');
	const instructionEngineDir = path.join(workspaceRoot, 'instruction-engine');
	const extensionSubdir = path.join(instructionEngineDir, 'vscode-skill-installer', 'src', 'feature');
	const siblingRepoDir = path.join(workspaceRoot, 'GenericInfrastructure');

	ensureDirectory(instructionEngineDir);
	ensureDirectory(extensionSubdir);
	ensureDirectory(siblingRepoDir);

	return {
		workspaceRoot,
		instructionEngineDir,
		extensionSubdir,
		siblingRepoDir,
	};
}

function writeDiscoveryFile(baseDir, targetPath) {
	ensureFile(path.join(baseDir, '.e3-local', 'db-path.txt'), targetPath);
}

function runPositiveScenario(matrixRoot, scenario) {
	const scenarioRoot = path.join(matrixRoot, `positive-${scenario.id}`);
	const layout = createLayout(scenarioRoot);
	const expectedDbPath = path.join(scenarioRoot, 'isolated-db', 'matrix.db');
	const env = {};

	scenario.setup({ layout, expectedDbPath, env, scenarioRoot });

	const ensureResult = runCli({
		cwd: scenario.ensureCwd(layout),
		args: ['ensure-db', '--db', expectedDbPath],
		env,
	});

	assert(ensureResult.status === 0, 'ensure-db should succeed for positive scenario', {
		scenario: scenario.id,
		stdout: ensureResult.stdout,
		stderr: ensureResult.stderr,
	});

	const ensurePayload = ensureResult.json;
	assert(ensurePayload && ensurePayload.path, 'ensure-db must return a path payload', {
		scenario: scenario.id,
		stdout: ensureResult.stdout,
	});

	const authoritativeDbPath = ensurePayload.path;
	assert(canonicalPath(authoritativeDbPath) === canonicalPath(expectedDbPath), 'ensure-db returned unexpected path', {
		scenario: scenario.id,
		expectedDbPath,
		authoritativeDbPath,
	});

	const sessionId = `${scenario.id}-session`;
	const taskId = `${scenario.id}-task`;

	const createSessionPayload = JSON.stringify({
		id: sessionId,
		request_summary: `matrix:${scenario.id}`,
	});

	const createTaskPayload = JSON.stringify({
		id: taskId,
		title: `Matrix task ${scenario.id}`,
		description: 'Regression matrix validation task',
	});

	const createSession = runCli({
		cwd: scenario.commandCwd(layout),
		args: ['create-session', createSessionPayload, '--db', authoritativeDbPath],
		env,
	});

	assert(createSession.status === 0, 'create-session should succeed for positive scenario', {
		scenario: scenario.id,
		stdout: createSession.stdout,
		stderr: createSession.stderr,
	});

	const createTask = runCli({
		cwd: scenario.commandCwd(layout),
		args: ['create-task', createTaskPayload, '--db', authoritativeDbPath],
		env,
	});

	assert(createTask.status === 0, 'create-task should succeed for positive scenario', {
		scenario: scenario.id,
		stdout: createTask.stdout,
		stderr: createTask.stderr,
	});

	const exportAll = runCli({
		cwd: scenario.commandCwd(layout),
		args: ['export-all', '--db', authoritativeDbPath],
		env,
	});

	assert(exportAll.status === 0, 'export-all should succeed for positive scenario', {
		scenario: scenario.id,
		stdout: exportAll.stdout,
		stderr: exportAll.stderr,
	});

	for (const [commandName, result] of [
		['ensure-db', ensureResult],
		['create-session', createSession],
		['create-task', createTask],
		['export-all', exportAll],
	]) {
		assert(result.dbSignal.path, `${commandName} should report DB path in stderr`, {
			scenario: scenario.id,
			stderr: result.stderr,
		});
		assert(canonicalPath(result.dbSignal.path) === canonicalPath(authoritativeDbPath), `${commandName} used a DB path different from ensure-db output`, {
			scenario: scenario.id,
			authoritativeDbPath,
			observedPath: result.dbSignal.path,
		});
	}

	const exportPayload = exportAll.json;
	assert(Array.isArray(exportPayload?.sessions), 'export-all should include sessions array', {
		scenario: scenario.id,
		exportPayload,
	});
	assert(Array.isArray(exportPayload?.tasks), 'export-all should include tasks array', {
		scenario: scenario.id,
		exportPayload,
	});

	assert(exportPayload.sessions.some((session) => session.id === sessionId), 'export-all is missing created session', {
		scenario: scenario.id,
		sessionId,
	});

	assert(exportPayload.tasks.some((task) => task.id === taskId), 'export-all is missing created task', {
		scenario: scenario.id,
		taskId,
	});

	return {
		scenario: scenario.id,
		type: 'positive',
		cwdVariant: scenario.cwdVariant,
		discoveryState: scenario.discoveryState,
		envState: scenario.envState,
		assertion: 'create-session/create-task/export-all all used ensure-db returned --db path',
	};
}

function runNegativeScenario(matrixRoot, scenario) {
	const scenarioRoot = path.join(matrixRoot, `negative-${scenario.id}`);
	const layout = createLayout(scenarioRoot);
	const env = {};

	scenario.setup({ layout, env, scenarioRoot });

	const ensureResult = runCli({
		cwd: scenario.cwd(layout),
		args: ['ensure-db'],
		env,
	});

	assert(ensureResult.status !== 0, 'negative scenario should fail fast', {
		scenario: scenario.id,
		stdout: ensureResult.stdout,
		stderr: ensureResult.stderr,
	});

	const errorPayload = ensureResult.json;
	assert(errorPayload?.code === DB_PATH_CONFLICT_CODE, 'negative scenario should return E_DB_PATH_CONFLICT', {
		scenario: scenario.id,
		errorPayload,
	});
	assert(errorPayload?.classification === DB_PATH_CONFLICT_CLASSIFICATION, 'negative scenario should return conflict classification', {
		scenario: scenario.id,
		errorPayload,
	});

	for (const expectedReason of scenario.expectedReasons) {
		assert(Array.isArray(errorPayload.reasons) && errorPayload.reasons.includes(expectedReason), 'negative scenario missing expected reason', {
			scenario: scenario.id,
			expectedReason,
			actualReasons: errorPayload.reasons,
		});
	}

	return {
		scenario: scenario.id,
		type: 'negative',
		cwdVariant: scenario.cwdVariant,
		discoveryState: scenario.discoveryState,
		envState: scenario.envState,
		assertion: `fail-fast with ${DB_PATH_CONFLICT_CODE} on stale/mismatched signals`,
		reasons: errorPayload.reasons,
	};
}

function verifySqliteReliability(dbPath, sessionId, taskIds) {
	const db = new Database(dbPath, { readonly: true, fileMustExist: true });

	try {
		const integrityRow = db.prepare('PRAGMA integrity_check').get();
		const integrity = integrityRow?.integrity_check ?? Object.values(integrityRow ?? {})[0] ?? null;

		assert(integrity === 'ok', 'SQLite integrity_check should return ok', {
			dbPath,
			integrity,
		});

		const sessionCount = db.prepare('SELECT COUNT(*) as count FROM sessions WHERE id = ?').get(sessionId).count;
		assert(sessionCount === 1, 'SQLite verification expected exactly one session row', {
			dbPath,
			sessionId,
			sessionCount,
		});

		const taskCount = db.prepare('SELECT COUNT(*) as count FROM tasks WHERE session_id = ?').get(sessionId).count;
		assert(taskCount === taskIds.length, 'SQLite verification expected exact task count for session', {
			dbPath,
			sessionId,
			expected: taskIds.length,
			actual: taskCount,
		});

		const distinctTaskCount = db.prepare('SELECT COUNT(DISTINCT id) as count FROM tasks WHERE session_id = ?').get(sessionId).count;
		assert(distinctTaskCount === taskIds.length, 'SQLite verification expected unique task ids', {
			dbPath,
			sessionId,
			expected: taskIds.length,
			actual: distinctTaskCount,
		});

		const placeholders = taskIds.map(() => '?').join(',');
		const matchedTaskCount = db
			.prepare(`SELECT COUNT(*) as count FROM tasks WHERE id IN (${placeholders})`)
			.get(...taskIds).count;

		assert(matchedTaskCount === taskIds.length, 'SQLite verification expected all concurrent task IDs to persist', {
			dbPath,
			expected: taskIds.length,
			actual: matchedTaskCount,
		});

		return {
			integrity,
			sessionCount,
			taskCount,
			distinctTaskCount,
			matchedTaskCount,
		};
	} finally {
		db.close();
	}
}

async function runReliabilityScenario(matrixRoot) {
	const scenarioRoot = path.join(matrixRoot, 'reliability-concurrency');
	const layout = createLayout(scenarioRoot);
	const expectedDbPath = path.join(scenarioRoot, 'isolated-db', 'reliability.db');

	const ensureResult = runCli({
		cwd: layout.instructionEngineDir,
		args: ['ensure-db', '--db', expectedDbPath],
	});

	assert(ensureResult.status === 0, 'ensure-db should succeed for reliability scenario', {
		stdout: ensureResult.stdout,
		stderr: ensureResult.stderr,
	});

	const ensurePayload = ensureResult.json;
	assert(ensurePayload?.path, 'ensure-db must return path for reliability scenario', {
		stdout: ensureResult.stdout,
	});

	const authoritativeDbPath = ensurePayload.path;
	assert(canonicalPath(authoritativeDbPath) === canonicalPath(expectedDbPath), 'reliability ensure-db returned unexpected path', {
		expectedDbPath,
		authoritativeDbPath,
	});

	const sessionId = 'reliability-session';
	const createSessionPayload = JSON.stringify({
		id: sessionId,
		request_summary: 'matrix:reliability-concurrency',
	});

	const createSession = runCli({
		cwd: layout.extensionSubdir,
		args: ['create-session', createSessionPayload, '--db', authoritativeDbPath],
	});

	assert(createSession.status === 0, 'create-session should succeed for reliability scenario', {
		stdout: createSession.stdout,
		stderr: createSession.stderr,
	});

	const concurrentTaskCount = 12;
	const concurrentReadCount = 8;
	const taskIds = Array.from({ length: concurrentTaskCount }, (_, idx) => `reliability-task-${idx + 1}`);

	const writePromises = taskIds.map((taskId) => {
		const payload = JSON.stringify({
			id: taskId,
			session_id: sessionId,
			title: `Reliability task ${taskId}`,
			description: 'Concurrent writer validation',
		});

		return runCliAsync({
			cwd: layout.extensionSubdir,
			args: ['create-task', payload, '--db', authoritativeDbPath],
		});
	});

	const readPromises = Array.from({ length: concurrentReadCount }, () =>
		runCliAsync({
			cwd: layout.instructionEngineDir,
			args: ['export-all', '--db', authoritativeDbPath],
		})
	);

	const [writeResults, readResults] = await Promise.all([
		Promise.all(writePromises),
		Promise.all(readPromises),
	]);

	for (const [index, result] of writeResults.entries()) {
		assert(result.status === 0, 'concurrent create-task should succeed', {
			index,
			stdout: result.stdout,
			stderr: result.stderr,
		});
		assert(canonicalPath(result.dbSignal.path) === canonicalPath(authoritativeDbPath), 'concurrent create-task used unexpected db path', {
			index,
			authoritativeDbPath,
			observedPath: result.dbSignal.path,
		});
	}

	const readTaskCounts = [];
	for (const [index, result] of readResults.entries()) {
		assert(result.status === 0, 'concurrent export-all should succeed', {
			index,
			stdout: result.stdout,
			stderr: result.stderr,
		});
		assert(canonicalPath(result.dbSignal.path) === canonicalPath(authoritativeDbPath), 'concurrent export-all used unexpected db path', {
			index,
			authoritativeDbPath,
			observedPath: result.dbSignal.path,
		});

		const payload = result.json;
		assert(Array.isArray(payload?.tasks), 'concurrent export-all should include tasks array', {
			index,
			payload,
		});

		const observedCount = payload.tasks.length;
		assert(observedCount >= 0 && observedCount <= concurrentTaskCount, 'concurrent read task count should be bounded and deterministic', {
			index,
			observedCount,
			concurrentTaskCount,
		});

		readTaskCounts.push(observedCount);
	}

	const finalExport = runCli({
		cwd: layout.instructionEngineDir,
		args: ['export-all', '--db', authoritativeDbPath],
	});

	assert(finalExport.status === 0, 'final export-all should succeed for reliability scenario', {
		stdout: finalExport.stdout,
		stderr: finalExport.stderr,
	});

	const finalPayload = finalExport.json;
	assert(Array.isArray(finalPayload?.tasks), 'final export-all should include tasks array', {
		payload: finalPayload,
	});

	const finalTaskIds = new Set(finalPayload.tasks.map((task) => task.id));
	for (const taskId of taskIds) {
		assert(finalTaskIds.has(taskId), 'final export-all missing concurrently created task', {
			taskId,
		});
	}

	const sqliteValidation = verifySqliteReliability(authoritativeDbPath, sessionId, taskIds);

	return {
		scenario: 'concurrent-writers-and-readers',
		type: 'reliability',
		dbPath: authoritativeDbPath,
		concurrentTaskCount,
		concurrentReadCount,
		readTaskCounts,
		sqliteValidation,
		assertion: 'parallel create-task and export-all operations succeed with deterministic final row counts and SQLite integrity_check=ok',
	};
}

async function main() {
	const keepTemp = process.argv.includes('--keep-temp');
	const matrixRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'e3-regression-matrix-'));

	const positiveScenarios = [
		{
			id: 'cwd-repo-root-no-signals',
			cwdVariant: 'repo-root',
			discoveryState: 'none',
			envState: 'unset',
			ensureCwd: (layout) => layout.instructionEngineDir,
			commandCwd: (layout) => layout.instructionEngineDir,
			setup: () => {},
		},
		{
			id: 'cwd-nested-explicit-overrides-env-discovery',
			cwdVariant: 'nested-subdir',
			discoveryState: 'set-mismatched',
			envState: 'set-mismatched',
			ensureCwd: (layout) => layout.instructionEngineDir,
			commandCwd: (layout) => layout.extensionSubdir,
			setup: ({ layout, scenarioRoot, env }) => {
				const envDb = path.join(scenarioRoot, 'signals', 'env.db');
				const discoveryDb = path.join(scenarioRoot, 'signals', 'discovery.db');
				ensureFile(envDb);
				ensureFile(discoveryDb);
				writeDiscoveryFile(layout.instructionEngineDir, discoveryDb);
				env.E3_DB_PATH = envDb;
			},
		},
		{
			id: 'cwd-sibling-repo-multiroot-explicit-flag',
			cwdVariant: 'multi-root-sibling',
			discoveryState: 'workspace-root-mismatch',
			envState: 'set-mismatched',
			ensureCwd: (layout) => layout.instructionEngineDir,
			commandCwd: (layout) => layout.siblingRepoDir,
			setup: ({ layout, scenarioRoot, env }) => {
				const envDb = path.join(scenarioRoot, 'signals', 'env-sibling.db');
				const discoveryDb = path.join(scenarioRoot, 'signals', 'discovery-sibling.db');
				ensureFile(envDb);
				ensureFile(discoveryDb);
				writeDiscoveryFile(layout.workspaceRoot, discoveryDb);
				env.E3_DB_PATH = envDb;
			},
		},
	];

	const negativeScenarios = [
		{
			id: 'stale-discovery-file-vs-workspace-default',
			cwdVariant: 'repo-root',
			discoveryState: 'stale',
			envState: 'unset',
			expectedReasons: ['signal-path-disagreement', 'stale-discovery-file'],
			cwd: (layout) => layout.instructionEngineDir,
			setup: ({ layout, scenarioRoot }) => {
				ensureDirectory(path.join(layout.instructionEngineDir, '.e3-local'));
				const stalePath = path.join(scenarioRoot, 'ghost', 'missing.db');
				writeDiscoveryFile(layout.instructionEngineDir, stalePath);
			},
		},
		{
			id: 'env-discovery-mismatch',
			cwdVariant: 'repo-root',
			discoveryState: 'set-existing-mismatch',
			envState: 'set-existing-mismatch',
			expectedReasons: ['signal-path-disagreement'],
			cwd: (layout) => layout.instructionEngineDir,
			setup: ({ layout, scenarioRoot, env }) => {
				const envDb = path.join(scenarioRoot, 'signals', 'env.db');
				const discoveryDb = path.join(scenarioRoot, 'signals', 'discovery.db');
				ensureFile(envDb);
				ensureFile(discoveryDb);
				writeDiscoveryFile(layout.instructionEngineDir, discoveryDb);
				env.E3_DB_PATH = envDb;
			},
		},
		{
			id: 'multiroot-sibling-mismatch-signals',
			cwdVariant: 'multi-root-sibling',
			discoveryState: 'workspace-root-mismatch',
			envState: 'set-existing-mismatch',
			expectedReasons: ['signal-path-disagreement'],
			cwd: (layout) => layout.siblingRepoDir,
			setup: ({ layout, scenarioRoot, env }) => {
				const envDb = path.join(scenarioRoot, 'signals', 'env-sibling.db');
				const discoveryDb = path.join(scenarioRoot, 'signals', 'discovery-sibling.db');
				ensureFile(envDb);
				ensureFile(discoveryDb);
				writeDiscoveryFile(layout.workspaceRoot, discoveryDb);
				env.E3_DB_PATH = envDb;
			},
		},
	];

	const results = {
		status: 'ok',
		contractVersion: 'e3-db-path-v1',
		targetCommands: ['create-session', 'create-task', 'export-all'],
		matrix: {
			positive: [],
			negative: [],
		},
		reliability: null,
		tempRoot: matrixRoot,
	};

	for (const scenario of positiveScenarios) {
		results.matrix.positive.push(runPositiveScenario(matrixRoot, scenario));
	}

	for (const scenario of negativeScenarios) {
		results.matrix.negative.push(runNegativeScenario(matrixRoot, scenario));
	}

	results.reliability = await runReliabilityScenario(matrixRoot);

	if (!keepTemp) {
		fs.rmSync(matrixRoot, { recursive: true, force: true });
		results.tempRoot = null;
	}

	console.log(JSON.stringify(results, null, 2));
}

main().catch(() => {
	process.exit(1);
});
