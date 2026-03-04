#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const Ajv2020 = require('ajv/dist/2020').default;

const CANONICAL_SCHEMA_NAME = 'canonical-workflow';
const DEFAULT_CONTRACTS_DIR = path.resolve(__dirname, '..', 'contracts', 'elegy');
const COMPATIBILITY_MANIFEST_FILE = 'compatibility-manifest.json';
const CANONICAL_SCHEMA_FILE = 'canonical-workflow.schema.json';

function assertSafeRelativePath(filePath) {
	if (typeof filePath !== 'string' || !filePath.trim()) {
		throw new Error('schema file path must be a non-empty string');
	}
	if (path.isAbsolute(filePath)) {
		throw new Error(`schema file path must be relative: ${filePath}`);
	}
	const normalized = filePath.replace(/\\/g, '/');
	if (normalized.startsWith('../') || normalized.includes('/../')) {
		throw new Error(`schema file path cannot escape contracts directory: ${filePath}`);
	}
}

function readJsonFile(filePath, label) {
	let raw;
	try {
		raw = fs.readFileSync(filePath, 'utf8');
	} catch (error) {
		throw new Error(`${label} read failed at ${filePath}: ${error.message}`);
	}

	try {
		return JSON.parse(raw);
	} catch (error) {
		throw new Error(`${label} JSON parse failed at ${filePath}: ${error.message}`);
	}
}

function resolveContractsDir(contractsDir) {
	return contractsDir ? path.resolve(contractsDir) : DEFAULT_CONTRACTS_DIR;
}

function loadCompatibilityManifest(options = {}) {
	const contractsDir = resolveContractsDir(options.contractsDir);
	const manifestPath = path.join(contractsDir, COMPATIBILITY_MANIFEST_FILE);
	const manifest = readJsonFile(manifestPath, 'compatibility manifest');
	return { manifest, manifestPath, contractsDir };
}

function resolveCanonicalSchemaFile(manifest) {
	const schemaEntries = manifest && Array.isArray(manifest.schemas) ? manifest.schemas : [];
	const canonical = schemaEntries.find((entry) => entry && entry.name === CANONICAL_SCHEMA_NAME);
	const schemaFile = canonical && canonical.file ? canonical.file : CANONICAL_SCHEMA_FILE;
	assertSafeRelativePath(schemaFile);
	return schemaFile;
}

function loadCanonicalWorkflowSchema(options = {}) {
	const contractsDir = resolveContractsDir(options.contractsDir);
	const loadedManifest = options.manifest
		? { manifest: options.manifest, manifestPath: path.join(contractsDir, COMPATIBILITY_MANIFEST_FILE), contractsDir }
		: loadCompatibilityManifest({ contractsDir });

	const schemaRelPath = resolveCanonicalSchemaFile(loadedManifest.manifest);
	const schemaPath = path.join(loadedManifest.contractsDir, schemaRelPath);
	const schema = readJsonFile(schemaPath, 'canonical workflow schema');

	return {
		schema,
		schemaPath,
		manifest: loadedManifest.manifest,
		manifestPath: loadedManifest.manifestPath,
		contractsDir: loadedManifest.contractsDir,
	};
}

function createCanonicalWorkflowValidator(options = {}) {
	const loaded = loadCanonicalWorkflowSchema(options);
	const ajv = new Ajv2020({
		allErrors: true,
		strict: false,
	});
	const validate = ajv.compile(loaded.schema);
	return { ...loaded, validate };
}

function formatAjvErrors(errors) {
	if (!Array.isArray(errors)) return [];
	return errors.map((error) => ({
		instancePath: error.instancePath || '/',
		schemaPath: error.schemaPath || '',
		message: error.message || 'validation error',
		keyword: error.keyword || '',
	}));
}

function validateCanonicalDocumentPayload(payload, options = {}) {
	const compiled = options.validator
		? { validate: options.validator }
		: createCanonicalWorkflowValidator(options);

	const isValid = compiled.validate(payload);
	return {
		valid: Boolean(isValid),
		errors: isValid ? [] : formatAjvErrors(compiled.validate.errors),
	};
}

module.exports = {
	CANONICAL_SCHEMA_NAME,
	DEFAULT_CONTRACTS_DIR,
	loadCompatibilityManifest,
	loadCanonicalWorkflowSchema,
	createCanonicalWorkflowValidator,
	validateCanonicalDocumentPayload,
};
