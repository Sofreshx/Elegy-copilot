#!/usr/bin/env node
const assert = require('assert');
const childProcess = require('child_process');
const path = require('path');

const validatorPath = path.resolve(__dirname, 'validate-skill-discovery-map.js');

let passed = 0;
function test(name, fn) {
	try {
		fn();
		passed++;
		console.log(`  PASS: ${name}`);
	} catch (error) {
		console.error(`  FAIL: ${name}`);
		console.error(`    ${error.message}`);
		process.exitCode = 1;
	}
}

test('validate-skill-discovery-map passes on current repository state', () => {
	const result = childProcess.spawnSync(process.execPath, [validatorPath], {
		cwd: path.resolve(__dirname, '..'),
		stdio: 'pipe',
	});

	assert.strictEqual(result.status, 0, `validator should pass: ${result.stderr}`);
});

console.log(`\n${passed} tests passed`);
if (process.exitCode) {
	console.error('Some tests FAILED');
} else {
	console.log('All tests passed');
}
