#!/usr/bin/env node

/**
 * Executive3 Database Bootstrap Script
 *
 * Creates or verifies the Executive3 SQLite database outside of VS Code.
 * Useful for CI, manual setup, or debugging.
 *
 * Usage:
 *   node scripts/e3-init.js [--path <db-path>] [--reset]
 *
 * Options:
 *   --path <db-path>   Path for the database file (default: ./.e3-local/executive3.db)
 *   --reset            Drop all data and re-create the schema
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

function main() {
	const args = process.argv.slice(2);
	const resetFlag = args.includes('--reset');
	const pathIdx = args.indexOf('--path');
	const dbDir = pathIdx !== -1 && args[pathIdx + 1]
		? path.dirname(args[pathIdx + 1])
		: path.join(process.cwd(), '.e3-local');
	const dbFile = pathIdx !== -1 && args[pathIdx + 1]
		? args[pathIdx + 1]
		: path.join(dbDir, 'executive3.db');

	// Ensure directory exists
	fs.mkdirSync(dbDir, { recursive: true });

	console.log(`[E3 Init] Database path: ${dbFile}`);

	if (resetFlag && fs.existsSync(dbFile)) {
		fs.unlinkSync(dbFile);
		console.log('[E3 Init] Existing database deleted (--reset)');
	}

	const db = new Database(dbFile);
	db.pragma('journal_mode = WAL');
	db.pragma('foreign_keys = ON');

	// Load and run schema
	const schemaPath = path.join(__dirname, '..', 'src', 'e3-schema.sql');
	if (!fs.existsSync(schemaPath)) {
		console.error(`[E3 Init] ERROR: Schema file not found at ${schemaPath}`);
		process.exit(1);
	}

	const schema = fs.readFileSync(schemaPath, 'utf-8');
	// Strip PRAGMA lines (already set above)
	const cleaned = schema
		.split('\n')
		.filter((line) => !line.trim().startsWith('PRAGMA'))
		.join('\n');

	db.exec(cleaned);

	// Verify
	const version = db.prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1').get();
	const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();

	console.log(`[E3 Init] Schema version: ${version?.version ?? 'unknown'}`);
	console.log(`[E3 Init] Tables: ${tables.map((t) => t.name).join(', ')}`);
	console.log('[E3 Init] Database ready.');

	db.close();
}

main();
