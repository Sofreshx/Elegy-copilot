const fs = require('fs');
const { spawnSync } = require('child_process');

const includeListFile = process.env.TEST_INCLUDE_LIST_FILE;
const resultsFile = process.env.TEST_LEDGER_RESULTS_FILE;

// Per-test timeout; callers may override via environment.
const TEST_TIMEOUT_MS = Number.parseInt(process.env.TEST_TIMEOUT_MS || '120000', 10);

if (!includeListFile || !resultsFile) {
    console.error('Missing TEST_INCLUDE_LIST_FILE or TEST_LEDGER_RESULTS_FILE environment variables.');
    process.exit(1);
}

if (!fs.existsSync(includeListFile)) {
    console.error(`Include list file not found: ${includeListFile}`);
    process.exit(1);
}

let testsToRun;
try {
    testsToRun = JSON.parse(fs.readFileSync(includeListFile, 'utf8'));
} catch (error) {
    console.error(`Failed to parse include list file: ${error.message}`);
    process.exit(1);
}

const results = {};
let hasFailures = false;

for (const testFile of testsToRun) {
    console.log(`Running test: ${testFile}`);
    const startTime = Date.now();

    const result = spawnSync('node', [testFile], {
        stdio: 'pipe',
        encoding: 'utf8',
        timeout: TEST_TIMEOUT_MS
    });

    const durationMs = Date.now() - startTime;

    // spawnSync sets result.error when spawn fails or the timeout is exceeded.
    if (result.error) {
        hasFailures = true;
        const reason = result.error.code === 'ETIMEDOUT'
            ? `Timed out after ${TEST_TIMEOUT_MS}ms`
            : `Failed to spawn: ${result.error.message}`;
        console.error(`Test failed: ${testFile} — ${reason}`);
        results[testFile] = { success: false, durationMs, stdout: '', stderr: reason };
        continue;
    }

    // A non-null signal means the process was terminated by a signal (e.g. SIGKILL).
    const killedBySignal = result.signal != null;
    const success = result.status === 0 && !killedBySignal;

    if (!success) {
        hasFailures = true;
        const reason = killedBySignal ? `Killed by signal: ${result.signal}` : `Exited with code: ${result.status}`;
        console.error(`Test failed: ${testFile} — ${reason}`);
        if (result.stdout) console.error(result.stdout);
        if (result.stderr) console.error(result.stderr);
    }

    results[testFile] = {
        success,
        durationMs,
        stdout: result.stdout || '',
        stderr: result.stderr || ''
    };
}

try {
    fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2));
} catch (error) {
    console.error(`Failed to write results file: ${error.message}`);
    process.exit(1);
}

if (hasFailures) {
    process.exit(1);
}
