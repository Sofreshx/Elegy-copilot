const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const includeListFile = process.env.TEST_INCLUDE_LIST_FILE;
const resultsFile = process.env.TEST_LEDGER_RESULTS_FILE;

if (!includeListFile || !resultsFile) {
    console.error('Missing TEST_INCLUDE_LIST_FILE or TEST_LEDGER_RESULTS_FILE environment variables.');
    process.exit(1);
}

if (!fs.existsSync(includeListFile)) {
    console.error(`Include list file not found: ${includeListFile}`);
    process.exit(1);
}

const testsToRun = JSON.parse(fs.readFileSync(includeListFile, 'utf8'));
const results = {};
let hasFailures = false;

for (const testFile of testsToRun) {
    console.log(`Running test: ${testFile}`);
    const startTime = Date.now();
    
    try {
        const result = spawnSync('node', [testFile], {
            stdio: 'pipe',
            encoding: 'utf8'
        });
        
        const durationMs = Date.now() - startTime;
        const success = result.status === 0;
        
        if (!success) {
            hasFailures = true;
            console.error(`Test failed: ${testFile}`);
            if (result.stdout) console.error(result.stdout);
            if (result.stderr) console.error(result.stderr);
        }
        
        results[testFile] = {
            success,
            durationMs,
            stdout: result.stdout || '',
            stderr: result.stderr || ''
        };
    } catch (error) {
        hasFailures = true;
        console.error(`Failed to run test: ${testFile}`, error);
        results[testFile] = {
            success: false,
            durationMs: Date.now() - startTime,
            stderr: error.message
        };
    }
}

fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2));

if (hasFailures) {
    process.exit(1);
}
