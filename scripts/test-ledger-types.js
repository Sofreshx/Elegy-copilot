/**
 * @file test-ledger-types.js
 * @description JSDoc type definitions for the test caching ledger and evidence contracts.
 */

/**
 * @typedef {Object} TestCacheEntry
 * @property {string} schemaVersion - The version of the schema (e.g., "1.0.0").
 * @property {string} hash - The hash of the test file and its dependencies.
 * @property {string} testFilePath - The path to the test file.
 * @property {number} lastRunTimestamp - The timestamp of the last successful run.
 * @property {RunnerResult} result - The result of the test run.
 */

/**
 * @typedef {Object} DiscoveryState
 * @property {string} schemaVersion - The version of the schema.
 * @property {string} workspace - The workspace identifier.
 * @property {string} commandHash - The hash of the test command.
 * @property {Array<string>} discoveredTests - List of discovered test file paths.
 * @property {number} discoveryTimestamp - When the discovery was performed.
 */

/**
 * @typedef {Object} RunnerResult
 * @property {boolean} success - Whether the test run was successful.
 * @property {number} durationMs - The duration of the test run in milliseconds.
 * @property {string} [stdout] - Standard output from the test runner.
 * @property {string} [stderr] - Standard error from the test runner.
 * @property {Array<Object>} [failedTests] - Details of any failed tests.
 */

/**
 * @typedef {Object} VerificationEvidence
 * @property {string} schemaVersion - The version of the schema.
 * @property {string} runId - Unique identifier for this test run.
 * @property {string} testFilePath - The path to the test file.
 * @property {string} cacheDecisionReason - The reason for the cache decision (e.g., "cache hit", "cache miss: file changed", "cache miss: dependency changed").
 * @property {boolean} wasCached - Whether the result was served from cache.
 * @property {RunnerResult} result - The result of the test run.
 * @property {number} timestamp - When the evidence was generated.
 */

module.exports = {};
