const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
    runTestWithFailSafes,
    hashTestFileAndDependencies,
    getPartitionKey,
    updateDiscoveryState,
    readCacheEntry,
    writeCacheEntry
} = require('./test-ledger-core');

test('test-ledger-core', async (t) => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-ledger-core-'));

    t.after(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    await t.test('malformed cache entry fallback', async () => {
        const cacheDir = path.join(tempDir, 'cache');
        fs.mkdirSync(cacheDir, { recursive: true });
        const hash = 'malformed-hash';
        const cacheFile = path.join(cacheDir, `${hash}.json`);
        
        // Write malformed JSON
        fs.writeFileSync(cacheFile, '{ invalid json');

        const entry = readCacheEntry(cacheDir, hash);
        assert.strictEqual(entry, null, 'Should return null for malformed cache entry');

        let runnerCalled = false;
        const runnerFn = async () => {
            runnerCalled = true;
            return { success: true };
        };

        await runTestWithFailSafes(runnerFn, {
            cacheDir,
            evidenceDir: path.join(tempDir, 'evidence'),
            hash,
            runId: 'run-1',
            testFilePath: 'test.js'
        });

        assert.strictEqual(runnerCalled, true, 'Runner should be called when cache entry is malformed');
    });

    await t.test('unresolved/dynamic import fail-safe', async () => {
        const testFile = path.join(tempDir, 'dynamic-import.js');
        fs.writeFileSync(testFile, `
            async function run() {
                const mod = await import('./some-module.js');
            }
        `);

        const hash = hashTestFileAndDependencies(testFile);
        assert.strictEqual(hash, null, 'Should return null for files with dynamic imports');
    });

    await t.test('config/lockfile change invalidation', async () => {
        const workspaceRoot = path.join(tempDir, 'workspace');
        const workspace = 'app';
        const workspaceDir = path.join(workspaceRoot, workspace);
        fs.mkdirSync(workspaceDir, { recursive: true });

        const tsconfigPath = path.join(workspaceDir, 'tsconfig.json');
        fs.writeFileSync(tsconfigPath, JSON.stringify({ compilerOptions: { strict: true } }));

        const key1 = getPartitionKey(workspaceRoot, workspace, 'npm run test');

        // Change config
        fs.writeFileSync(tsconfigPath, JSON.stringify({ compilerOptions: { strict: false } }));

        const key2 = getPartitionKey(workspaceRoot, workspace, 'npm run test');

        assert.notStrictEqual(key1, key2, 'Partition key should change when config changes');
    });

    await t.test('renamed/deleted test handling', async () => {
        const ledgerDir = path.join(tempDir, 'ledger');
        const partitionKey = 'test-partition';

        // Initial state
        const test1 = path.join(tempDir, 'test1.js');
        const test2 = path.join(tempDir, 'test2.js');
        fs.writeFileSync(test1, 'console.log("test1");');
        fs.writeFileSync(test2, 'console.log("test2");');

        const result1 = updateDiscoveryState(ledgerDir, partitionKey, [test1, test2]);
        assert.deepStrictEqual(result1.newTests, [test1, test2]);
        assert.deepStrictEqual(result1.deletedTests, []);

        // Second state: test1 deleted, test3 added
        const test3 = path.join(tempDir, 'test3.js');
        fs.writeFileSync(test3, 'console.log("test3");');

        const result2 = updateDiscoveryState(ledgerDir, partitionKey, [test2, test3]);
        assert.deepStrictEqual(result2.newTests, [test3]);
        assert.deepStrictEqual(result2.deletedTests, [test1]);
    });

    await t.test('race-safe discovery state updates', async () => {
        const ledgerDir = path.join(tempDir, 'ledger-race');
        const partitionKey = 'race-partition';
        const stateFile = path.join(ledgerDir, `discovery-${partitionKey}.json`);
        
        fs.mkdirSync(ledgerDir, { recursive: true });
        fs.writeFileSync(stateFile, JSON.stringify({ tests: {} }));

        // Mock fs.statSync to simulate a concurrent modification on the first read
        const originalStatSync = fs.statSync;
        let statCalls = 0;
        fs.statSync = (filePath, options) => {
            if (filePath === stateFile) {
                statCalls++;
                if (statCalls === 2) {
                    // On the second call (inside the check if file was modified),
                    // return a different mtimeMs to trigger a retry
                    return { mtimeMs: Date.now() + 1000 };
                }
            }
            return originalStatSync(filePath, options);
        };

        try {
            const testFile = path.join(tempDir, 'race-test.js');
            fs.writeFileSync(testFile, 'console.log("race");');
            
            const result = updateDiscoveryState(ledgerDir, partitionKey, [testFile]);
            assert.deepStrictEqual(result.newTests, [testFile]);
            // If it succeeded, it means it retried and eventually wrote the file
            assert.ok(statCalls > 2, 'Should have retried due to simulated concurrent modification');
        } finally {
            fs.statSync = originalStatSync;
        }
    });

    await t.test('evidence marker/path emission failure', async () => {
        const cacheDir = path.join(tempDir, 'cache-evidence');
        const evidenceDir = path.join(tempDir, 'evidence-fail');
        
        // Make evidenceDir a file so mkdirSync/writeFileSync fails
        fs.writeFileSync(evidenceDir, 'not a dir');

        const runnerFn = async () => ({ success: true });

        await assert.rejects(
            () => runTestWithFailSafes(runnerFn, {
                cacheDir,
                evidenceDir,
                hash: 'some-hash',
                runId: 'run-fail',
                testFilePath: 'test.js'
            }),
            (err) => {
                assert.strictEqual(err.code, 255, 'Error should have code 255');
                assert.ok(err.message.includes('Failed to generate evidence'), 'Error should mention evidence failure');
                return true;
            }
        );
    });
});
