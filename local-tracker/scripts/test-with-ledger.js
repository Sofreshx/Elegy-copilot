const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const {
    hashTestFileAndDependencies,
    getPartitionKey,
    updateDiscoveryState,
    readCacheEntry,
    writeCacheEntry,
    writeEvidence,
    isCommandAllowed,
    enforceCacheRetentionLimit,
    cleanupStaleEvidence
} = require('../../scripts/test-ledger-core');

const SCHEMA_VERSION = 'v1';
const workspaceRoot = path.resolve(__dirname, '../..');
const workspace = 'local-tracker';
const command = 'npm run test';

const ledgerDir = path.join(workspaceRoot, '.tmp', 'test-ledger');
const cacheDir = path.join(ledgerDir, 'cache');
const evidenceDir = path.join(workspaceRoot, '.tmp', 'llm-output');

const forceRun = process.argv.includes('--force');
const commandAllowed = isCommandAllowed(workspace, command);
if (!commandAllowed) {
    console.warn(`WARNING: Command "${command}" in workspace "${workspace}" is not in the allowlist. Running all tests without caching.`);
}
const skipCache = forceRun || !commandAllowed;

// 1. Discover tests
const testDir = path.join(__dirname, '../src');
function findTests(dir, fileList = []) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const filePath = path.join(dir, file);
        if (fs.statSync(filePath).isDirectory()) {
            findTests(filePath, fileList);
        } else if (filePath.endsWith('.test.ts') || filePath.endsWith('.spec.ts')) {
            fileList.push(filePath);
        }
    }
    return fileList;
}
const testFiles = findTests(testDir);

const partitionKey = getPartitionKey(workspaceRoot, workspace, command);
const discoveryResult = updateDiscoveryState(ledgerDir, partitionKey, testFiles);

// 2. Determine which tests to run
const testsToRun = [];
const testHashes = {};
const cachedResults = {};

for (const testFile of testFiles) {
    const hash = hashTestFileAndDependencies(testFile);
    testHashes[testFile] = hash;
    
    if (skipCache || !hash) {
        testsToRun.push(testFile);
        continue;
    }
    
    const cacheEntry = readCacheEntry(cacheDir, hash);
    if (cacheEntry && cacheEntry.result && cacheEntry.result.success) {
        cachedResults[testFile] = cacheEntry.result;
    } else {
        testsToRun.push(testFile);
    }
}

const runId = `run-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

// Collect evidence for cached tests
const allEvidence = [];
for (const testFile of testFiles) {
    if (!testsToRun.includes(testFile)) {
        const hash = testHashes[testFile];
        const result = cachedResults[testFile];
        allEvidence.push({
            schemaVersion: SCHEMA_VERSION,
            runId,
            testFilePath: testFile,
            cacheDecisionReason: 'cache hit',
            wasCached: true,
            result,
            timestamp: Date.now()
        });
    }
}

if (testsToRun.length === 0) {
    console.log('All tests cached. Skipping run.');
    const evidenceFile = writeEvidence(evidenceDir, runId, allEvidence);
    console.log(`[TEST-LEDGER-EVIDENCE] ${evidenceFile}`);
    cleanupStaleEvidence(evidenceDir);
    process.exit(0);
}

console.log(`Running ${testsToRun.length} tests...`);

// 3. Write include list
const tmpWorkDir = path.join(workspaceRoot, '.tmp', 'llm-work');
if (!fs.existsSync(tmpWorkDir)) {
    fs.mkdirSync(tmpWorkDir, { recursive: true });
}

const includeListFile = path.join(tmpWorkDir, `include-list-${Date.now()}.json`);
const resultsFile = path.join(tmpWorkDir, `results-${Date.now()}.json`);

fs.writeFileSync(includeListFile, JSON.stringify(testsToRun));

// 4. Run tests
try {
    execSync('npx jest --no-cache --testSequencer=./scripts/ledger-sequencer.js --reporters=default --reporters=./scripts/ledger-reporter.js', { 
        cwd: path.join(__dirname, '..'), 
        stdio: 'inherit',
        env: {
            ...process.env,
            TEST_INCLUDE_LIST_FILE: includeListFile,
            TEST_LEDGER_RESULTS_FILE: resultsFile
        }
    });
} catch (error) {
    console.error('Test run failed or partially failed.');
}

// 5. Process results
let hasFailures = false;
if (fs.existsSync(resultsFile)) {
    const results = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));
    hasFailures = Object.values(results).some(r => !r.success);
    
    for (const testFile of testsToRun) {
        const result = results[testFile] || { success: false, durationMs: 0, stderr: 'Test did not report results' };
        const hash = testHashes[testFile];
        
        if (result.success && hash) {
            writeCacheEntry(cacheDir, hash, {
                schemaVersion: SCHEMA_VERSION,
                hash,
                testFilePath: testFile,
                lastRunTimestamp: Date.now(),
                result
            });
        }
        
        allEvidence.push({
            schemaVersion: SCHEMA_VERSION,
            runId,
            testFilePath: testFile,
            cacheDecisionReason: hash ? 'cache miss: no valid cache entry' : 'cache miss: uncacheable (fail-safe)',
            wasCached: false,
            result,
            timestamp: Date.now()
        });
    }
    
    enforceCacheRetentionLimit(cacheDir);
} else {
    console.error('Results file not found. Tests may have crashed before reporting.');
    hasFailures = true;
}

// Write consolidated evidence
const evidenceFile = writeEvidence(evidenceDir, runId, allEvidence);
console.log(`[TEST-LEDGER-EVIDENCE] ${evidenceFile}`);
cleanupStaleEvidence(evidenceDir);

// 6. Cleanup
try {
    fs.unlinkSync(includeListFile);
    fs.unlinkSync(resultsFile);
} catch (e) {
    // Ignore cleanup errors
}

// Exit with error if any test failed
if (hasFailures) {
    process.exit(1);
}