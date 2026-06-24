/* eslint-disable no-console */
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const checkerScript = path.join(__dirname, 'elegy-docs-check.js');

function runCheck(args = []) {
  const result = spawnSync('node', [checkerScript, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 30000,
  });
  return result;
}

function validateReport(report) {
  const errors = [];

  // Required fields
  if (typeof report.score !== 'number' || report.score < 0 || report.score > 100) {
    errors.push('score must be a number between 0 and 100');
  }
  if (!Array.isArray(report.issues)) {
    errors.push('issues must be an array');
  }
  if (typeof report.timestamp !== 'string') {
    errors.push('timestamp must be a string');
  }

  // Issue shape validation
  for (const issue of report.issues) {
    if (!issue.code || !issue.severity || !issue.file || issue.line === undefined || !issue.message) {
      errors.push(`Issue missing required field: ${JSON.stringify(issue)}`);
    }
    const validSeverities = ['error', 'warning', 'info'];
    if (!validSeverities.includes(issue.severity)) {
      errors.push(`Invalid severity '${issue.severity}': ${JSON.stringify(issue)}`);
    }
  }

  return errors;
}

function main() {
  const errors = [];

  // Test 1: JSON output is valid
  const jsonResult = runCheck(['--json']);
  if (jsonResult.status !== 0 && jsonResult.status !== 1) {
    // exit code 1 means errors found (expected), exit code != 1 means crash
    errors.push(`--json check crashed with status ${jsonResult.status}: ${jsonResult.stderr}`);
  }

  let report;
  try {
    report = JSON.parse(jsonResult.stdout);
  } catch (e) {
    errors.push(`--json output is not valid JSON: ${e.message}`);
  }

  if (report) {
    const reportErrors = validateReport(report);
    errors.push(...reportErrors);
  }

  // Test 2: --help works
  const helpResult = runCheck(['--help']);
  if (helpResult.status !== 0) {
    errors.push(`--help failed with status ${helpResult.status}`);
  }
  if (!helpResult.stdout.includes('Usage:')) {
    errors.push('--help output does not contain "Usage:"');
  }

  // Test 3: Subset checks work
  for (const check of ['claims', 'frontmatter', 'links', 'scripts']) {
    const subsetResult = runCheck(['--json', '--check', check]);
    if (subsetResult.status !== 0 && subsetResult.status !== 1) {
      errors.push(`--check ${check} crashed with status ${subsetResult.status}`);
    }
    try {
      JSON.parse(subsetResult.stdout);
    } catch (e) {
      errors.push(`--check ${check} output is not valid JSON: ${e.message}`);
    }
  }

  // Report
  if (errors.length > 0) {
    console.error('Repo context validation FAILED:');
    for (const err of errors) {
      console.error(`  - ${err}`);
    }
    process.exitCode = 1;
  } else {
    console.log('OK: repo context validation passed.');
  }
}

if (require.main === module) {
  main();
}

module.exports = { validateReport, runCheck };
