#!/usr/bin/env node

const { spawnSync } = require('child_process');
const path = require('path');

const cliPath = path.join(__dirname, 'e3-cli.js');

function failWithOutput(result, fallbackMessage) {
	if (result.stdout) {
		process.stderr.write(result.stdout);
	}
	if (result.stderr) {
		process.stderr.write(result.stderr);
	}
	if (!result.stdout && !result.stderr) {
		process.stderr.write(`${fallbackMessage}\n`);
	}
	process.exit(result.status ?? 1);
}

const ensure = spawnSync(process.execPath, [cliPath, 'ensure-db'], {
	encoding: 'utf8',
});

if (ensure.status !== 0) {
	failWithOutput(ensure, 'Failed to run ensure-db.');
}

let ensurePayload;
try {
	ensurePayload = JSON.parse(ensure.stdout);
} catch {
	process.stderr.write('Failed to parse ensure-db output.\n');
	if (ensure.stdout) {
		process.stderr.write(`ensure-db stdout: ${ensure.stdout}\n`);
	}
	process.exit(1);
}

if (!ensurePayload?.path) {
	process.stderr.write('ensure-db did not return a usable `path`.\n');
	process.exit(1);
}

const exportResult = spawnSync(
	process.execPath,
	[cliPath, 'export-all', '--db', ensurePayload.path],
	{ stdio: 'inherit' }
);

process.exit(exportResult.status ?? 1);
