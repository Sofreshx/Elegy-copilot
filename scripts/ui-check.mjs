#!/usr/bin/env node
/**
 * ui-check.mjs — Governed UI check runner
 *
 * Validates UI configuration, executes per-target commands,
 * collects runtime reports, validates evidence coverage, and
 * generates human/machine-readable reports.
 *
 * Usage:
 *   node scripts/ui-check.mjs
 *   node scripts/ui-check.mjs --config .elegy/ui-check.json
 *   node scripts/ui-check.mjs --target header --target footer
 *   node scripts/ui-check.mjs --validate-only
 *   node scripts/ui-check.mjs --json
 *   node scripts/ui-check.mjs --help
 *
 * Exit codes: 0 = all pass, 1 = any fail
 */

'use strict';

// ---------------------------------------------------------------------------
// IMPORTS
// ---------------------------------------------------------------------------

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Use createRequire to load Ajv (a CJS-only package)
const _require = createRequire(import.meta.url);
const Ajv2020 = _require('ajv/dist/2020').default;

// ---------------------------------------------------------------------------
// CONSTANTS
// ---------------------------------------------------------------------------

const SCHEMA_DIR = path.resolve(__dirname, '..', 'contracts', 'session-state');

const DEFAULT_CONFIG_PATH = path.join('.elegy', 'ui-check.json');
const DEFAULT_TIMEOUT = 120000;

// ---------------------------------------------------------------------------
// CLI PARSING
// ---------------------------------------------------------------------------

/**
 * Parse CLI arguments into a flags object.
 *
 * @param {string[]} argv  process.argv slice (excluding node + script)
 * @returns {object}       { config, target, validateOnly, json, repo, timeout, help }
 */
function parseArgs(argv) {
  const flags = {
    config: null,
    target: [],
    validateOnly: false,
    json: false,
    repo: null,
    timeout: DEFAULT_TIMEOUT,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    switch (arg) {
      case '--config':
        flags.config = argv[++i];
        break;
      case '--target':
        flags.target.push(argv[++i]);
        break;
      case '--validate-only':
        flags.validateOnly = true;
        break;
      case '--json':
        flags.json = true;
        break;
      case '--repo':
        flags.repo = argv[++i];
        break;
      case '--timeout': {
        const val = parseInt(argv[++i], 10);
        flags.timeout = Number.isFinite(val) && val > 0 ? val : DEFAULT_TIMEOUT;
        break;
      }
      case '--help':
      case '-h':
        flags.help = true;
        break;
      default:
        // Skip unknown flags silently (or could warn)
        break;
    }
  }

  return flags;
}

/**
 * Print usage help to stdout.
 */
function printHelp() {
  console.log(`
Usage: node scripts/ui-check.mjs [options]

Options:
  --config <path>      Config file path (default: .elegy/ui-check.json)
  --target <id>        Target(s) to run (repeatable; omit = all targets)
  --validate-only      Validate config + paths only, do not run commands
  --json               Output machine-readable JSON report to stdout
  --repo <path>        Repo root directory (default: current working directory)
  --timeout <ms>       Per-command timeout in milliseconds (default: ${DEFAULT_TIMEOUT})
  --help, -h           Print this usage information

Exit codes:
  0   All targets passed (or --validate-only found no issues)
  1   Any target failed or validation error
`);
}

// ---------------------------------------------------------------------------
// CONFIG LOADING & VALIDATION
// ---------------------------------------------------------------------------

/**
 * Load config JSON and validate against ui-check.schema.json using Ajv 2020.
 *
 * Also compiles the runtime-report schema as a secondary schema (for later use).
 *
 * @param {string}  configPath  Absolute path to the config JSON file
 * @param {string}  schemaPath  Absolute path to the config schema
 * @param {string}  repoRoot    Repo root directory (unused but kept for signature consistency)
 * @returns {{ valid: boolean, errors: string[], config: object|null }}
 */
function validateConfig(configPath, schemaPath, repoRoot) {
  const result = { valid: false, errors: [], config: null };

  let configRaw;
  try {
    configRaw = fs.readFileSync(configPath, 'utf-8');
  } catch (err) {
    result.errors.push(`Cannot read config file: ${configPath} — ${err.message}`);
    return result;
  }

  let config;
  try {
    config = JSON.parse(configRaw);
  } catch (err) {
    result.errors.push(`Config file is not valid JSON: ${configPath} — ${err.message}`);
    return result;
  }

  // Load schema
  let schemaRaw;
  try {
    schemaRaw = fs.readFileSync(schemaPath, 'utf-8');
  } catch (err) {
    result.errors.push(`Cannot read schema file: ${schemaPath} — ${err.message}`);
    return result;
  }

  let schema;
  try {
    schema = JSON.parse(schemaRaw);
  } catch (err) {
    result.errors.push(`Schema file is not valid JSON: ${schemaPath} — ${err.message}`);
    return result;
  }

  // Also compile the runtime-report schema (for later use in validateRuntimeReport)
  const runtimeSchemaPath = path.resolve(path.dirname(schemaPath), 'ui-check-runtime-report.schema.json');

  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });

  // Register both schemas (the runtime-report schema may reference the main one or vice versa)
  try {
    const runtimeSchemaRaw = fs.readFileSync(runtimeSchemaPath, 'utf-8');
    const runtimeSchema = JSON.parse(runtimeSchemaRaw);
    ajv.addSchema(runtimeSchema);
  } catch (_) {
    // Runtime schema is optional at validation time; skip if unavailable
  }

  const validate = ajv.compile(schema);
  const valid = validate(config);

  result.valid = valid;
  result.config = config;

  if (!valid && validate.errors) {
    result.errors = validate.errors.map((e) => {
      const ptr = e.instancePath || '(root)';
      return `${ptr}: ${e.message}` + (e.params ? ` (${JSON.stringify(e.params)})` : '');
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// PATH VALIDATION
// ---------------------------------------------------------------------------

/**
 * Verify that all inventory paths exist (relative to repoRoot or workingDirectory).
 *
 * Checks:
 *   - inventory.componentRoots[].path
 *   - inventory.tokenFiles[].path
 *   - inventory.iconRoots[].path
 *   - inventory.patternDocs[].path
 *   - targets.<id>.workingDirectory
 *
 * @param {object} config    Parsed config object
 * @param {string} repoRoot  Absolute path to repo root
 * @returns {{ valid: boolean, missingPaths: string[] }}
 */
function validatePaths(config, repoRoot) {
  const missingPaths = [];

  if (!config || !config.inventory) {
    return { valid: missingPaths.length === 0, missingPaths };
  }

  const { inventory, targets } = config;

  // Inventory component roots
  if (Array.isArray(inventory.componentRoots)) {
    for (const item of inventory.componentRoots) {
      const resolved = path.resolve(repoRoot, item.path);
      if (!fs.existsSync(resolved)) {
        missingPaths.push(`inventory.componentRoots[].path: ${item.path}`);
      }
    }
  }

  // Inventory token files
  if (Array.isArray(inventory.tokenFiles)) {
    for (const item of inventory.tokenFiles) {
      const resolved = path.resolve(repoRoot, item.path);
      if (!fs.existsSync(resolved)) {
        missingPaths.push(`inventory.tokenFiles[].path: ${item.path}`);
      }
    }
  }

  // Inventory icon roots
  if (Array.isArray(inventory.iconRoots)) {
    for (const item of inventory.iconRoots) {
      const resolved = path.resolve(repoRoot, item.path);
      if (!fs.existsSync(resolved)) {
        missingPaths.push(`inventory.iconRoots[].path: ${item.path}`);
      }
    }
  }

  // Inventory pattern docs
  if (Array.isArray(inventory.patternDocs)) {
    for (const item of inventory.patternDocs) {
      const resolved = path.resolve(repoRoot, item.path);
      if (!fs.existsSync(resolved)) {
        missingPaths.push(`inventory.patternDocs[].path: ${item.path}`);
      }
    }
  }

  // Target working directories
  if (targets && typeof targets === 'object') {
    for (const [targetId, target] of Object.entries(targets)) {
      if (target.workingDirectory) {
        const resolved = path.resolve(repoRoot, target.workingDirectory);
        if (!fs.existsSync(resolved)) {
          missingPaths.push(`targets.${targetId}.workingDirectory: ${target.workingDirectory}`);
        }
      }
    }
  }

  return { valid: missingPaths.length === 0, missingPaths };
}

// ---------------------------------------------------------------------------
// COMMAND EXECUTION
// ---------------------------------------------------------------------------

/**
 * Execute target validation commands sequentially.
 *
 * Sets env vars:
 *   UI_CHECK_RUN_ID        — unique run identifier
 *   UI_CHECK_TARGET_ID     — target ID being executed
 *   UI_CHECK_EVIDENCE_DIR  — evidence output directory for this target
 *
 * On command failure (non-zero exit or timeout): stops this target's commands.
 *
 * @param {object}   target       Target config object
 * @param {string}   targetId     Target ID string
 * @param {string}   runId        Unique run identifier
 * @param {string}   evidenceDir  Absolute path to this target's evidence subdirectory
 * @param {number}   timeout      Per-command timeout in ms
 * @param {string}   repoRoot     Repo root directory
 * @param {object}   env          Extra environment variables to merge
 * @returns {{ results: object[], failed: boolean }}
 */
function executeTargetCommands(target, targetId, runId, evidenceDir, timeout, repoRoot, env) {
  const results = [];
  let failed = false;

  const commands = target.validationCommands;
  if (!Array.isArray(commands) || commands.length === 0) {
    // No commands to run — not a failure, just no results
    return { results, failed: false };
  }

  // Resolve working directory
  const cwd = target.workingDirectory
    ? path.resolve(repoRoot, target.workingDirectory)
    : repoRoot;

  for (const cmd of commands) {
    if (failed) {
      // Skip remaining commands for this target
      results.push({
        id: cmd.id,
        command: cmd.command,
        exitCode: null,
        stdout: '',
        stderr: '(skipped — previous command failed)',
        timedOut: false,
        duration: 0,
        skipped: true,
      });
      continue;
    }

    const cmdTimeout = cmd.timeout && cmd.timeout > 0 ? cmd.timeout : timeout;

    const startTime = Date.now();

    const spawnEnv = {
      ...process.env,
      UI_CHECK_RUN_ID: runId,
      UI_CHECK_TARGET_ID: targetId,
      UI_CHECK_EVIDENCE_DIR: evidenceDir,
      ...(env || {}),
    };

    let result;
    let timedOut = false;

    try {
      result = spawnSync(cmd.command, [], {
        cwd,
        shell: true,
        env: spawnEnv,
        timeout: cmdTimeout,
        maxBuffer: 10 * 1024 * 1024, // 10MB
      });
    } catch (err) {
      // Timeout throws on some platforms
      timedOut = true;
      const duration = Date.now() - startTime;
      results.push({
        id: cmd.id,
        command: cmd.command,
        exitCode: null,
        stdout: '',
        stderr: err.message,
        timedOut: true,
        duration,
      });
      failed = true;
      continue;
    }

    const duration = Date.now() - startTime;

    // Detect timeout from result signal
    if (result.signal === 'SIGTERM' || result.status === null) {
      timedOut = true;
    }

    const exitCode = result.status;

    results.push({
      id: cmd.id,
      command: cmd.command,
      exitCode,
      stdout: (result.stdout || '').toString(),
      stderr: (result.stderr || '').toString(),
      timedOut,
      duration,
    });

    if (timedOut || exitCode !== 0) {
      failed = true;
    }
  }

  return { results, failed };
}

// ---------------------------------------------------------------------------
// RUNTIME REPORT VALIDATION
// ---------------------------------------------------------------------------

/**
 * Load and validate a runtime report against the runtime-report schema.
 *
 * Builds an expected result matrix: every route × viewport × state.
 * Excluded states must have status "excluded" and a reason.
 * Non-excluded states must have status "pass", a screenshot path,
 * no consoleErrors, and no networkFailures.
 *
 * @param {string}        reportPath  Absolute path to the runtime-report JSON file
 * @param {object}        target      Target config object (for route definitions)
 * @param {string}        schemaPath  Absolute path to the runtime-report schema
 * @param {string}        repoRoot    Repo root (unused but kept for signature consistency)
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
function validateRuntimeReport(reportPath, target, schemaPath, repoRoot) {
  const errors = [];
  const warnings = [];

  // --- Load the report file ---
  let reportRaw;
  try {
    reportRaw = fs.readFileSync(reportPath, 'utf-8');
  } catch (err) {
    return {
      valid: false,
      errors: [`Cannot read runtime report: ${reportPath} — ${err.message}`],
      warnings,
    };
  }

  let report;
  try {
    report = JSON.parse(reportRaw);
  } catch (err) {
    return {
      valid: false,
      errors: [`Runtime report is not valid JSON: ${err.message}`],
      warnings,
    };
  }

  // --- Validate against schema ---
  let schemaRaw;
  try {
    schemaRaw = fs.readFileSync(schemaPath, 'utf-8');
  } catch (err) {
    errors.push(`Cannot read runtime-report schema: ${schemaPath} — ${err.message}`);
    return { valid: false, errors, warnings };
  }

  let schema;
  try {
    schema = JSON.parse(schemaRaw);
  } catch (err) {
    errors.push(`Runtime-report schema is not valid JSON: ${err.message}`);
    return { valid: false, errors, warnings };
  }

  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
  const validate = ajv.compile(schema);
  const schemaValid = validate(report);

  if (!schemaValid) {
    for (const e of validate.errors || []) {
      const ptr = e.instancePath || '(root)';
      errors.push(`[schema] ${ptr}: ${e.message}`);
    }
    // Schema validation failed — return early since structure is wrong
    return { valid: false, errors, warnings };
  }

  // --- Build expected matrix from target routes ---
  const routes = target.routes || [];
  const surfaceResults = report.surfaceResults || [];

  for (const route of routes) {
    const viewports = route.viewports || [];
    const states = route.states || [];
    const excludedStates = route.excludedStates || [];

    // Build a set of excluded state names for this route
    const excludedStateNames = new Set(excludedStates.map((es) => es.state));

    // Build a set of actually present results for quick lookup
    const resultMap = new Map();
    for (const sr of surfaceResults) {
      if (sr.routeId === route.id) {
        const key = `${sr.viewport}:${sr.state}`;
        resultMap.set(key, sr);
      }
    }

    for (const viewport of viewports) {
      for (const state of states) {
        const key = `${viewport}:${state}`;
        const isExcluded = excludedStateNames.has(state);
        const result = resultMap.get(key);

        if (isExcluded) {
          // Excluded state must have status "excluded"; screenshot optional
          if (!result) {
            errors.push(
              `Missing excluded result for route "${route.id}", viewport "${viewport}", state "${state}". ` +
              'Expected status "excluded".'
            );
          } else if (result.status !== 'excluded') {
            errors.push(
              `Route "${route.id}", viewport "${viewport}", state "${state}" is declared excluded ` +
              `but has status "${result.status}". Expected "excluded".`
            );
          }
          // Also check the excluded state has a reason in the config
          const excludedDef = excludedStates.find((es) => es.state === state);
          if (!excludedDef || !excludedDef.reason) {
            warnings.push(
              `Route "${route.id}", state "${state}" is excluded but missing a reason in config.`
            );
          }
        } else {
          // Non-excluded state must exist with valid data
          if (!result) {
            errors.push(
              `Missing result for route "${route.id}", viewport "${viewport}", state "${state}". ` +
              'Expected status "pass".'
            );
          } else if (result.status !== 'pass') {
            errors.push(
              `Route "${route.id}", viewport "${viewport}", state "${state}" has status ` +
              `"${result.status}". Expected "pass".`
            );
          }

          if (result) {
            // Must have screenshot
            if (!result.screenshot || result.screenshot.length === 0) {
              errors.push(
                `Route "${route.id}", viewport "${viewport}", state "${state}": ` +
                'missing screenshot path.'
              );
            }

            // Must have no console errors
            if (result.consoleErrors && result.consoleErrors.length > 0) {
              errors.push(
                `Route "${route.id}", viewport "${viewport}", state "${state}": ` +
                `found ${result.consoleErrors.length} console error(s): ${result.consoleErrors.join('; ')}`
              );
            }

            // Must have no network failures
            if (result.networkFailures && result.networkFailures.length > 0) {
              errors.push(
                `Route "${route.id}", viewport "${viewport}", state "${state}": ` +
                `found ${result.networkFailures.length} network failure(s): ` +
                result.networkFailures.map((nf) => `${nf.url} (${nf.status})`).join('; ')
              );
            }
          }
        }
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ---------------------------------------------------------------------------
// REPORT GENERATION
// ---------------------------------------------------------------------------

/**
 * Generate report.json (machine-readable) and report.md (human-readable).
 *
 * @param {object} results       Aggregated results keyed by targetId
 * @param {string} evidenceDir   Root evidence directory for this run
 * @param {string} repoRoot      Repo root directory
 */
function generateReport(results, evidenceDir, repoRoot) {
  const runId = results.runId;
  const timestamp = new Date().toISOString();
  const targets = results.targets || {};

  // --- report.json ---
  const jsonReport = {
    runId,
    timestamp,
    targets: {},
  };

  for (const [id, tgt] of Object.entries(targets)) {
    jsonReport.targets[id] = {
      configValid: tgt.configValid !== false,
      pathsValid: tgt.pathsValid !== false,
      commands: tgt.commandResults || [],
      runtimeReport: tgt.runtimeReportResult || null,
      passed: tgt.passed === true,
    };
  }

  const jsonPath = path.join(evidenceDir, 'report.json');
  fs.writeFileSync(jsonPath, JSON.stringify(jsonReport, null, 2), 'utf-8');

  // --- report.md ---
  let md = `# UI Check Report\n\n`;
  md += `- **Run ID:** ${runId}\n`;
  md += `- **Timestamp:** ${timestamp}\n`;
  md += `- **Repo Root:** ${repoRoot}\n\n`;

  md += `## Summary\n\n`;
  md += `| Target | Config | Paths | Commands | Report | Overall |\n`;
  md += `|--------|--------|-------|----------|--------|--------|\n`;

  let allPassed = true;
  for (const [id, tgt] of Object.entries(targets)) {
    const configStatus = tgt.configValid !== false ? '✅ pass' : '❌ fail';
    const pathsStatus = tgt.pathsValid !== false ? '✅ pass' : '❌ fail';

    let cmdStatus;
    const cmdFailed = (tgt.commandResults || []).some((r) => r.exitCode !== 0 || r.timedOut || r.skipped);
    if (cmdFailed) {
      cmdStatus = '❌ fail';
    } else if ((tgt.commandResults || []).length === 0) {
      cmdStatus = '— (none)';
    } else {
      cmdStatus = '✅ pass';
    }

    const reportStatus = tgt.runtimeReportResult
      ? (tgt.runtimeReportResult.valid ? '✅ pass' : '❌ fail')
      : '— (none)';

    const overall = tgt.passed === true ? '✅ pass' : '❌ fail';
    if (tgt.passed !== true) allPassed = false;

    md += `| ${id} | ${configStatus} | ${pathsStatus} | ${cmdStatus} | ${reportStatus} | ${overall} |\n`;
  }

  md += `\n**Overall result: ${allPassed ? 'ALL PASSED' : 'SOME FAILED'}**\n`;

  // Add detail sections per target
  for (const [id, tgt] of Object.entries(targets)) {
    const cmdResults = tgt.commandResults || [];
    const hasIssues =
      tgt.configValid === false ||
      tgt.pathsValid === false ||
      cmdResults.some((r) => r.exitCode !== 0 || r.timedOut || r.skipped) ||
      (tgt.runtimeReportResult && !tgt.runtimeReportResult.valid);

    if (!hasIssues) continue;

    md += `\n---\n\n## Target: ${id}\n\n`;

    if (tgt.configValid === false) {
      md += `### ❌ Config Validation Failed\n\n`;
      md += `Schema validation errors:\n\n`;
      for (const err of tgt.configErrors || []) {
        md += `- \`${err}\`\n`;
      }
      md += '\n';
    }

    if (tgt.pathsValid === false) {
      md += `### ❌ Path Validation Failed\n\n`;
      md += `Missing paths:\n\n`;
      for (const p of tgt.missingPaths || []) {
        md += `- \`${p}\`\n`;
      }
      md += '\n';
    }

    const failedCmds = cmdResults.filter((r) => r.exitCode !== 0 || r.timedOut);
    if (failedCmds.length > 0) {
      md += `### ❌ Command Failures\n\n`;
      for (const r of failedCmds) {
        md += `- **\`${r.id}\`** (\`${r.command}\`)\n`;
        md += `  - Exit code: ${r.exitCode}\n`;
        md += `  - Timed out: ${r.timedOut}\n`;
        md += `  - Duration: ${r.duration}ms\n`;
        if (r.stderr) {
          md += `  - Stderr:\n\`\`\`\n${r.stderr.slice(0, 2000)}\n\`\`\`\n`;
        }
        md += '\n';
      }
    }

    if (tgt.runtimeReportResult && !tgt.runtimeReportResult.valid) {
      md += `### ❌ Runtime Report Validation Failed\n\n`;
      md += `Errors:\n\n`;
      for (const err of tgt.runtimeReportResult.errors || []) {
        md += `- ${err}\n`;
      }
      md += '\n';
      if (tgt.runtimeReportResult.warnings && tgt.runtimeReportResult.warnings.length > 0) {
        md += `Warnings:\n\n`;
        for (const w of tgt.runtimeReportResult.warnings) {
          md += `- ${w}\n`;
        }
        md += '\n';
      }
    }
  }

  const mdPath = path.join(evidenceDir, 'report.md');
  fs.writeFileSync(mdPath, md, 'utf-8');

  return { jsonPath, mdPath };
}

// ---------------------------------------------------------------------------
// UTILITY
// ---------------------------------------------------------------------------

/**
 * Generate a unique run ID from timestamp and random characters.
 *
 * @returns {string}  e.g. "20250101-120000-a1b2c3d4"
 */
function generateRunId() {
  const now = new Date();
  const datePart = now.toISOString().slice(0, 19).replace(/[T:]/g, '-');
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `${datePart}-${randomPart}`;
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------

/**
 * Orchestrate the full UI check run.
 *
 * @param {object}   args  Parsed CLI arguments (from parseArgs)
 * @returns {Promise<number>}  Exit code (0 = all pass, 1 = any fail)
 */
async function main(args) {
  const repoRoot = args.repo ? path.resolve(args.repo) : process.cwd();
  const configPathArg = args.config || DEFAULT_CONFIG_PATH;
  const configPath = path.resolve(repoRoot, configPathArg);
  const schemaPath = path.resolve(SCHEMA_DIR, 'ui-check.schema.json');
  const runtimeSchemaPath = path.resolve(SCHEMA_DIR, 'ui-check-runtime-report.schema.json');

  // --- Help ---
  if (args.help) {
    printHelp();
    return 0;
  }

  // --- JSON output mode ---
  let jsonOutput = null;

  // --- Step 1: Validate config ---
  const configResult = validateConfig(configPath, schemaPath, repoRoot);

  if (!configResult.valid) {
    if (args.json) {
      jsonOutput = { status: 'config_invalid', errors: configResult.errors };
    } else {
      console.error('❌ Config validation failed:');
      for (const err of configResult.errors) {
        console.error(`  - ${err}`);
      }
    }
    if (args.json) {
      console.log(JSON.stringify(jsonOutput, null, 2));
    }
    return 1;
  }

  const config = configResult.config;

  // --- Step 2: Validate paths ---
  const pathsResult = validatePaths(config, repoRoot);

  if (!pathsResult.valid) {
    if (args.json) {
      jsonOutput = { status: 'paths_invalid', missingPaths: pathsResult.missingPaths };
    } else {
      console.error('❌ Path validation failed:');
      for (const p of pathsResult.missingPaths) {
        console.error(`  - missing: ${p}`);
      }
    }
    if (args.json) {
      console.log(JSON.stringify(jsonOutput, null, 2));
    }
    return 1;
  }

  // --- Validate-only mode ---
  if (args.validateOnly) {
    const message = '✅ Config and paths valid.';
    if (args.json) {
      console.log(JSON.stringify({ status: 'valid', message }, null, 2));
    } else {
      console.log(message);
    }
    return 0;
  }

  // --- Step 3: Filter targets ---
  const allTargetIds = Object.keys(config.targets || {});
  let requestedTargetIds;

  if (Array.isArray(args.target) && args.target.length > 0) {
    // Validate requested targets exist
    const unknown = args.target.filter((t) => !allTargetIds.includes(t));
    if (unknown.length > 0) {
      if (args.json) {
        jsonOutput = { status: 'unknown_targets', unknownTargets: unknown };
      } else {
        console.error(`❌ Unknown target(s): ${unknown.join(', ')}`);
        console.error(`  Available targets: ${allTargetIds.join(', ')}`);
      }
      if (args.json) {
        console.log(JSON.stringify(jsonOutput, null, 2));
      }
      return 1;
    }
    requestedTargetIds = args.target;
  } else {
    requestedTargetIds = allTargetIds;
  }

  // --- Step 4: Create evidence root ---
  const runId = generateRunId();
  const evidenceRoot = path.join(repoRoot, 'evidence', 'ui', `${runId}`);
  fs.mkdirSync(evidenceRoot, { recursive: true });

  // --- Step 5: Run targets ---
  const targetResults = {};
  let anyFailed = false;

  for (const targetId of requestedTargetIds) {
    const target = config.targets[targetId];
    const targetEvidenceDir = path.join(evidenceRoot, targetId);
    fs.mkdirSync(targetEvidenceDir, { recursive: true });

    // Store per-target aggregation
    const tgtAgg = {
      configValid: true,
      configErrors: [],
      pathsValid: true,
      missingPaths: [],
      commandResults: [],
      runtimeReportResult: null,
      passed: true,
    };

    // --- Step 5a: Execute commands ---
    const cmdResult = executeTargetCommands(
      target,
      targetId,
      runId,
      targetEvidenceDir,
      args.timeout,
      repoRoot,
      {}
    );
    tgtAgg.commandResults = cmdResult.results;

    if (cmdResult.failed) {
      anyFailed = true;
      tgtAgg.passed = false;
    }

    // --- Step 5b: Load and validate runtime report ---
    const runtimeReportPath = target.runtimeReport
      ? path.join(targetEvidenceDir, target.runtimeReport)
      : path.join(targetEvidenceDir, 'runtime-report.json');

    if (fs.existsSync(runtimeReportPath)) {
      const reportResult = validateRuntimeReport(runtimeReportPath, target, runtimeSchemaPath, repoRoot);
      tgtAgg.runtimeReportResult = reportResult;

      if (!reportResult.valid) {
        anyFailed = true;
        tgtAgg.passed = false;
      }
    } else {
      // No runtime report found — not necessarily a failure if no commands produced one
      if (!target.runtimeReport) {
        // Default path doesn't exist and no explicit path configured — acceptable
        tgtAgg.runtimeReportResult = null;
      } else {
        // Explicit path configured but doesn't exist
        anyFailed = true;
        tgtAgg.passed = false;
        tgtAgg.runtimeReportResult = {
          valid: false,
          errors: [`Runtime report not found at configured path: ${runtimeReportPath}`],
          warnings: [],
        };
      }
    }

    targetResults[targetId] = tgtAgg;
  }

  // --- Step 6: Generate reports ---
  const aggregated = {
    runId,
    targets: targetResults,
  };

  generateReport(aggregated, evidenceRoot, repoRoot);

  // --- Step 7: Output ---
  if (args.json) {
    // Read back the generated report.json
    const reportJsonPath = path.join(evidenceRoot, 'report.json');
    try {
      const reportContent = fs.readFileSync(reportJsonPath, 'utf-8');
      console.log(reportContent);
    } catch (_) {
      // If reading fails, output the in-memory structure
      console.log(JSON.stringify(aggregated, null, 2));
    }
  } else {
    console.log(`\n📋 UI check run complete: ${runId}`);
    console.log(`   Evidence: ${evidenceRoot}`);

    for (const [id, tgt] of Object.entries(targetResults)) {
      const statusSymbol = tgt.passed ? '✅' : '❌';
      console.log(`   ${statusSymbol} ${id}: ${tgt.passed ? 'PASS' : 'FAIL'}`);
    }
  }

  return anyFailed ? 1 : 0;
}

// ---------------------------------------------------------------------------
// EXPORTS
// ---------------------------------------------------------------------------

export { parseArgs, validateConfig, validatePaths, executeTargetCommands, validateRuntimeReport, generateReport, main };

// ---------------------------------------------------------------------------
// ENTRY POINT
// ---------------------------------------------------------------------------

const entryPath = fileURLToPath(import.meta.url);
const invokedPath = path.resolve(process.argv[1] || '');
if (invokedPath === entryPath) {
  main(parseArgs(process.argv.slice(2))).then((exitCode) => process.exit(exitCode));
}
