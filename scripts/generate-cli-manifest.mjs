#!/usr/bin/env node
/* eslint-disable no-console */

import path from 'path';
import { fileURLToPath } from 'url';

import { writeCompatibilityManifest } from './catalogManifestLib.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseArgs(argv) {
	const args = { all: false };
	for (const a of argv || []) {
		if (a === '--all') {
			args.all = true;
		} else {
			throw new Error(`Unknown arg: ${a} (supported: --all)`);
		}
	}
	return args;
}

function main() {
	const args = parseArgs(process.argv.slice(2));
	const engineRoot = path.resolve(__dirname, '..');
	const result = writeCompatibilityManifest('cli', {
		repoRoot: engineRoot,
		all: args.all,
	});
	console.log(`Wrote ${result.outputPath} (${result.manifest.assets.length} assets)`);
}

main();
