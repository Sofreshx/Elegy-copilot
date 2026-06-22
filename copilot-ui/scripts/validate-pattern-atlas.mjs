#!/usr/bin/env node
'use strict';

/**
 * Pattern Atlas YAML Validator
 *
 * Reads all .yaml files from copilot-ui/content/pattern-atlas/ and validates
 * each entry against required fields, enum values, ID format, and structural
 * constraints.
 *
 * Usage: node copilot-ui/scripts/validate-pattern-atlas.mjs
 * Exit:  0 on success, 1 if any errors are found
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONTENT_DIR = path.resolve(__dirname, '..', 'content', 'pattern-atlas');

const VALID_TYPES = ['visual-style', 'ui-component', 'ux-pattern', 'system-pattern'];
const VALID_CONFIDENCE = ['established', 'emerging', 'descriptive'];
const VALID_DOMAINS = [
  'ui-ux',
  'visual-style',
  'software-architecture',
  'data-integration',
  'infrastructure-ops',
  'security-reliability',
  'ai-systems',
];

const REQUIRED_FIELDS = [
  'id',
  'name',
  'type',
  'domain',
  'confidence',
  'tagline',
  'description',
  'traits',
  'bestFit',
  'avoidIf',
  'commonFailures',
  'contrasts',
  'compatibilities',
  'promptLanguage',
  'sources',
  'tags',
];

const ID_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/**
 * Validate a single pattern entry.
 * Returns an array of error message strings (empty = valid).
 */
function validateEntry(entry, fileName, seenIds) {
  const errors = [];

  // -- Required fields ------------------------------------------------------
  for (const field of REQUIRED_FIELDS) {
    if (entry[field] === undefined || entry[field] === null) {
      errors.push(`Missing required field: '${field}'`);
    }
  }

  // Stop further validation if id is missing — subsequent checks depend on it
  if (entry.id === undefined || entry.id === null) {
    return errors;
  }

  // -- ID format ------------------------------------------------------------
  if (!ID_REGEX.test(entry.id)) {
    errors.push(`Invalid id format: '${entry.id}' (expected lowercase kebab-case)`);
  }

  // -- Unique ID ------------------------------------------------------------
  if (seenIds.has(entry.id)) {
    errors.push(`Duplicate ID: '${entry.id}' already used by ${seenIds.get(entry.id)}`);
  } else {
    seenIds.set(entry.id, fileName);
  }

  // Only check type/domain/confidence if they exist (to avoid double-reporting
  // missing fields already caught above).
  if (entry.type !== undefined && !VALID_TYPES.includes(entry.type)) {
    errors.push(
      `Invalid type: '${entry.type}' (expected one of: ${VALID_TYPES.join(', ')})`
    );
  }

  if (entry.confidence !== undefined && !VALID_CONFIDENCE.includes(entry.confidence)) {
    errors.push(
      `Invalid confidence: '${entry.confidence}' (expected one of: ${VALID_CONFIDENCE.join(', ')})`
    );
  }

  if (entry.domain !== undefined && !VALID_DOMAINS.includes(entry.domain)) {
    errors.push(
      `Invalid domain: '${entry.domain}' (expected one of: ${VALID_DOMAINS.join(', ')})`
    );
  }

  // -- traits: at least 3 items --------------------------------------------
  if (entry.traits !== undefined && entry.traits !== null) {
    if (!Array.isArray(entry.traits)) {
      errors.push(`'traits' must be an array`);
    } else if (entry.traits.length < 3) {
      errors.push(`'traits' must have at least 3 items (found ${entry.traits.length})`);
    }
  }

  // -- contrasts: array of { term, difference } objects ---------------------
  if (entry.contrasts !== undefined && entry.contrasts !== null) {
    if (!Array.isArray(entry.contrasts)) {
      errors.push(`'contrasts' must be an array`);
    } else {
      for (let i = 0; i < entry.contrasts.length; i++) {
        const c = entry.contrasts[i];
        if (!c || typeof c !== 'object') {
          errors.push(`'contrasts[${i}]' must be an object with 'term' and 'difference'`);
        } else {
          if (typeof c.term !== 'string') {
            errors.push(`'contrasts[${i}].term' must be a string`);
          }
          if (typeof c.difference !== 'string') {
            errors.push(`'contrasts[${i}].difference' must be a string`);
          }
        }
      }
    }
  }

  // -- Field type checks for array fields ----------------------------------
  const arrayFields = ['bestFit', 'avoidIf', 'commonFailures', 'compatibilities', 'sources', 'tags', 'traits'];
  for (const field of arrayFields) {
    if (entry[field] !== undefined && entry[field] !== null && !Array.isArray(entry[field])) {
      errors.push(`'${field}' must be an array`);
    }
  }

  // -- String field type checks --------------------------------------------
  const stringFields = ['name', 'tagline', 'description', 'promptLanguage'];
  for (const field of stringFields) {
    if (entry[field] !== undefined && entry[field] !== null && typeof entry[field] !== 'string') {
      errors.push(`'${field}' must be a string`);
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  // Ensure content directory exists
  if (!fs.existsSync(CONTENT_DIR)) {
    console.error(`Error: Content directory not found: ${CONTENT_DIR}`);
    process.exit(1);
  }

  // Discover YAML files
  let yamlFiles;
  try {
    yamlFiles = fs
      .readdirSync(CONTENT_DIR)
      .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
      .sort();
  } catch (err) {
    console.error(`Error reading content directory: ${err.message}`);
    process.exit(1);
  }

  if (yamlFiles.length === 0) {
    console.log('No YAML files found in pattern-atlas directory.');
    process.exit(0);
  }

  const seenIds = new Map();
  const allErrors = []; // { file, errors[] }
  let totalEntries = 0;

  for (const file of yamlFiles) {
    const filePath = path.join(CONTENT_DIR, file);
    let entry;

    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      entry = yaml.load(raw);
    } catch (err) {
      allErrors.push({ file, errors: [`Failed to parse YAML: ${err.message}`] });
      continue;
    }

    // Must be a non-null object
    if (!entry || typeof entry !== 'object') {
      allErrors.push({ file, errors: ['File does not contain a valid YAML object'] });
      continue;
    }

    totalEntries++;
    const errors = validateEntry(entry, file, seenIds);
    if (errors.length > 0) {
      allErrors.push({ file, errors });
    }
  }

  // -- Report ---------------------------------------------------------------
  const validCount = totalEntries - allErrors.length;
  const errorCount = allErrors.length;

  console.log('Pattern Atlas Validation');
  console.log('-----------------------');
  console.log(`Total entries: ${totalEntries}`);
  console.log(`Valid: ${validCount}`);
  console.log(`Errors: ${errorCount}`);
  console.log('');

  for (const { file, errors } of allErrors) {
    for (const err of errors) {
      console.log(`❌ ${file}: ${err}`);
    }
  }

  if (errorCount === 0) {
    console.log('✅ All entries valid');
  }

  process.exit(errorCount > 0 ? 1 : 0);
}

main();
