#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

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

function main() {
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
		tempRoot: matrixRoot,
	};

	for (const scenario of positiveScenarios) {
		results.matrix.positive.push(runPositiveScenario(matrixRoot, scenario));
	}

	for (const scenario of negativeScenarios) {
		results.matrix.negative.push(runNegativeScenario(matrixRoot, scenario));
	}

	if (!keepTemp) {
		fs.rmSync(matrixRoot, { recursive: true, force: true });
		results.tempRoot = null;
	}

	console.log(JSON.stringify(results, null, 2));
}

try {
	main();
} catch {
	process.exit(1);
}
