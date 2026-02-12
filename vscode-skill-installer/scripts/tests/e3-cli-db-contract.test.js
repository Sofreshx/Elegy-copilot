const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const cliPath = path.join(__dirname, '..', 'e3-cli.js');

function parseJsonOutput(stdout) {
	const trimmed = String(stdout ?? '').trim();
	if (!trimmed) {
		return null;
	}

	try {
		return JSON.parse(trimmed);
	} catch {
		return null;
	}
}

function buildEnv(overrides = {}) {
	const env = { ...process.env };
	delete env.E3_DB_PATH;
	delete env.E3_SMART_CONTEXT_ENABLED;

	for (const [key, value] of Object.entries(overrides)) {
		if (value === undefined || value === null) {
			delete env[key];
		} else {
			env[key] = value;
		}
	}

	return env;
}

function runCli({ cwd, args, env = {} }) {
	const result = spawnSync(process.execPath, [cliPath, ...args], {
		cwd,
		encoding: 'utf8',
		env: buildEnv(env),
	});

	return {
		status: result.status ?? 1,
		stdout: result.stdout ?? '',
		stderr: result.stderr ?? '',
		json: parseJsonOutput(result.stdout),
	};
}

function withTempWorkspace(run) {
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'e3-cli-contract-test-'));
	try {
		return run(tempRoot);
	} finally {
		fs.rmSync(tempRoot, { recursive: true, force: true });
	}
}

test('strict --db parsing rejects missing/empty values', () => {
	withTempWorkspace((tempRoot) => {
		const first = runCli({
			cwd: tempRoot,
			args: ['export-all', '--db', '--smart-context'],
		});

		assert.equal(first.status, 1);
		assert.equal(typeof first.json?.error, 'string');
		assert.match(first.json.error, /--db value cannot be another flag/i);

		const second = runCli({
			cwd: tempRoot,
			args: ['export-all', '--db='],
		});

		assert.equal(second.status, 1);
		assert.equal(typeof second.json?.error, 'string');
		assert.match(second.json.error, /--db requires a non-empty path value/i);
	});
});

test('explicit --db succeeds and targets the provided DB path', () => {
	withTempWorkspace((tempRoot) => {
		const dbPath = path.join(tempRoot, 'db', 'explicit-contract.db');

		const ensure = runCli({
			cwd: tempRoot,
			args: ['ensure-db', '--db', dbPath],
		});

		assert.equal(ensure.status, 0);
		assert.equal(typeof ensure.json?.path, 'string');
		assert.equal(path.normalize(ensure.json.path), path.normalize(dbPath));
		assert.equal(ensure.json?.resolution?.source, 'flag');

		const exportAll = runCli({
			cwd: tempRoot,
			args: ['export-all', '--db', dbPath],
		});

		assert.equal(exportAll.status, 0);
		assert.ok(Array.isArray(exportAll.json?.plans));
		assert.ok(Array.isArray(exportAll.json?.tasks));
		assert.match(exportAll.stderr, /\[E3 CLI\] DB \(flag\):/i);
	});
});

test('conflict guardrail fails fast with E_DB_PATH_CONFLICT when --db is omitted', () => {
	withTempWorkspace((tempRoot) => {
		const workspaceRoot = path.join(tempRoot, 'workspace-root');
		const localDir = path.join(workspaceRoot, '.e3-local');
		const discoveryFile = path.join(localDir, 'db-path.txt');
		const stalePath = path.join(tempRoot, 'signals', 'missing.db');

		fs.mkdirSync(localDir, { recursive: true });
		fs.writeFileSync(path.join(localDir, 'executive3.db'), '');
		fs.writeFileSync(discoveryFile, stalePath, 'utf8');

		const result = runCli({
			cwd: workspaceRoot,
			args: ['ensure-db'],
		});

		assert.equal(result.status, 1);
		assert.equal(result.json?.code, 'E_DB_PATH_CONFLICT');
		assert.equal(result.json?.classification, 'db-path-signal-conflict');
		assert.ok(Array.isArray(result.json?.reasons));
		assert.ok(result.json.reasons.includes('signal-path-disagreement'));
	});
});

test('smart-context gate is off by default and enabled by --smart-context', () => {
	withTempWorkspace((tempRoot) => {
		const dbPath = path.join(tempRoot, 'db', 'smart-context.db');
		const smartRequest = JSON.stringify({
			scope: 'project',
			query: 'contract',
			limit: 5,
			neighbor_limit: 3,
		});

		const ensure = runCli({
			cwd: tempRoot,
			args: ['ensure-db', '--db', dbPath],
		});

		assert.equal(ensure.status, 0);

		const disabled = runCli({
			cwd: tempRoot,
			args: ['get-context-smart', smartRequest, '--db', dbPath],
		});

		assert.equal(disabled.status, 1);
		assert.equal(disabled.json?.code, 'E_SMART_CONTEXT_DISABLED');

		const enabled = runCli({
			cwd: tempRoot,
			args: ['get-context-smart', smartRequest, '--db', dbPath, '--smart-context'],
		});

		assert.equal(enabled.status, 0);
		assert.equal(enabled.json?.phase, 'phase-b');
		assert.equal(enabled.json?.featureGate?.enabled, true);
		assert.equal(enabled.json?.featureGate?.source, 'flag');
		assert.ok(Array.isArray(enabled.json?.ranked));
	});
});