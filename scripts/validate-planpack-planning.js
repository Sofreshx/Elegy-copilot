#!/usr/bin/env node
'use strict';

const childProcess = require('child_process');
const path = require('path');

const validatorPath = path.join(__dirname, 'validate-planpack.js');
const forwardedArgs = process.argv.slice(2);
const result = childProcess.spawnSync(process.execPath, [validatorPath, '--phase', 'planning', ...forwardedArgs], {
	stdio: 'inherit',
});

if (result.error) {
	throw result.error;
}

process.exit(result.status == null ? 1 : result.status);