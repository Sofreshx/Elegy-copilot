#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const schemaPath = path.join(repoRoot, 'contracts', 'elegy', 'monitoring-event.schema.json');
const eventsDir = path.join(repoRoot, 'docs', 'issues', 'friction-events');

const VALID_IMPORTANCE = ['low', 'medium', 'high', 'critical'];
const SEVERITY_MAP = { low: 'info', medium: 'warning', high: 'error', critical: 'critical' };

function parseArgs(argv) {
	const args = {};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--dry-run') {
			args.dryRun = true;
		} else if (arg === '--title' && argv[i + 1]) {
			args.title = argv[++i];
		} else if (arg === '--reason' && argv[i + 1]) {
			args.reason = argv[++i];
		} else if (arg === '--importance' && argv[i + 1]) {
			args.importance = argv[++i];
		} else if (arg === '--context' && argv[i + 1]) {
			args.context = argv[++i];
		} else if (arg === '--cluster-id' && argv[i + 1]) {
			args.clusterId = argv[++i];
		}
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
