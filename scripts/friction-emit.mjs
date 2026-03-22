#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { repoRoot } from './lib/cli-utils.mjs';

const schemaPath = path.join(repoRoot, 'contracts', 'session-state', 'monitoring-event.schema.json');
const eventsDir = path.join(repoRoot, 'docs', 'issues', 'friction-events');

const VALID_IMPORTANCE = ['low', 'medium', 'high', 'critical'];
const SEVERITY_MAP = { low: 'info', medium: 'warning', high: 'error', critical: 'critical' };

function parseArgs(argv) {
	const args = {};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--dry-run') {
			args.dryRun = true;
			continue;
		}
		if (arg === '--title') {
			args.title = argv[++i] ?? null;
			if (!args.title) throw new Error('Missing value for --title');
			continue;
		}
		if (arg.startsWith('--title=')) {
			args.title = arg.slice('--title='.length);
			if (!args.title) throw new Error('Missing value for --title');
			continue;
		}
		if (arg === '--reason') {
			args.reason = argv[++i] ?? null;
			if (!args.reason) throw new Error('Missing value for --reason');
			continue;
		}
		if (arg.startsWith('--reason=')) {
			args.reason = arg.slice('--reason='.length);
			if (!args.reason) throw new Error('Missing value for --reason');
			continue;
		}
		if (arg === '--importance') {
			args.importance = argv[++i] ?? null;
			if (!args.importance) throw new Error('Missing value for --importance');
			continue;
		}
		if (arg.startsWith('--importance=')) {
			args.importance = arg.slice('--importance='.length);
			if (!args.importance) throw new Error('Missing value for --importance');
			continue;
		}
		if (arg === '--context') {
			args.context = argv[++i] ?? null;
			if (!args.context) throw new Error('Missing value for --context');
			continue;
		}
		if (arg.startsWith('--context=')) {
			args.context = arg.slice('--context='.length);
			if (!args.context) throw new Error('Missing value for --context');
			continue;
		}
		if (arg === '--cluster-id') {
			args.clusterId = argv[++i] ?? null;
			if (!args.clusterId) throw new Error('Missing value for --cluster-id');
			continue;
		}
		if (arg.startsWith('--cluster-id=')) {
			args.clusterId = arg.slice('--cluster-id='.length);
			if (!args.clusterId) throw new Error('Missing value for --cluster-id');
			continue;
		}
		throw new Error(
			`Unknown arg: ${arg} (supported: --dry-run, --title, --reason, --importance, --context, --cluster-id)`
		);
	}
	return args;
}

function validate(args) {
	const errors = [];
	if (!args.title) errors.push('--title is required.');
	if (!args.reason) errors.push('--reason is required.');
	if (!args.importance) {
		errors.push('--importance is required (low, medium, high, critical).');
	} else if (!VALID_IMPORTANCE.includes(args.importance.toLowerCase())) {
		errors.push(`Invalid importance "${args.importance}". Must be one of: ${VALID_IMPORTANCE.join(', ')}`);
	}
	if (!args.context) errors.push('--context is required.');
	return errors;
}

function buildEvent(args) {
	const importance = args.importance.toLowerCase();
	const metadata = {
		reason: args.reason,
		context: args.context,
	};
	if (args.clusterId) {
		metadata.clusterId = args.clusterId;
	}

	return {
		eventId: `friction-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
		timestamp: new Date().toISOString(),
		entityKind: 'skill',
		entityId: 'implementation-friction',
		category: 'friction',
		severity: SEVERITY_MAP[importance],
		message: args.title,
		metadata,
	};
}

function validateAgainstSchema(event) {
	if (!fs.existsSync(schemaPath)) {
		console.warn(`[warn] Schema file not found, skipping schema validation: ${schemaPath}`);
		return { valid: true, errors: [] };
	}

	const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
	const errors = [];

	// Lightweight validation against required fields and enum values
	for (const field of schema.required || []) {
		if (!(field in event)) {
			errors.push(`Missing required field: ${field}`);
		}
	}

	const props = schema.properties || {};
	if (props.entityKind?.enum && !props.entityKind.enum.includes(event.entityKind)) {
		errors.push(`Invalid entityKind: ${event.entityKind}`);
	}
	if (props.category?.enum && !props.category.enum.includes(event.category)) {
		errors.push(`Invalid category: ${event.category}`);
	}
	if (props.severity?.enum && !props.severity.enum.includes(event.severity)) {
		errors.push(`Invalid severity: ${event.severity}`);
	}

	return { valid: errors.length === 0, errors };
}

// --- CLI ---
const args = parseArgs(process.argv.slice(2));
const errors = validate(args);

if (errors.length > 0) {
	console.error('Validation errors:');
	for (const e of errors) console.error(`  - ${e}`);
	process.exit(1);
}

const event = buildEvent(args);
const schemaCheck = validateAgainstSchema(event);
if (!schemaCheck.valid) {
	console.error('Schema validation failed:');
	for (const e of schemaCheck.errors) console.error(`  - ${e}`);
	process.exit(1);
}

const json = JSON.stringify(event, null, 2);

if (args.dryRun) {
	console.log('[dry-run] Would write friction event:');
	console.log(json);
	process.exit(0);
}

fs.mkdirSync(eventsDir, { recursive: true });
const filename = `${event.eventId}.json`;
const outputPath = path.join(eventsDir, filename);
fs.writeFileSync(outputPath, json + '\n', 'utf8');
console.log(`Emitted: ${path.relative(repoRoot, outputPath)}`);

export { parseArgs, validate, buildEvent, validateAgainstSchema, VALID_IMPORTANCE };
