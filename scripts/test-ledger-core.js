const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ts = require('typescript');

const SCHEMA_VERSION = 'v1';

// Explicit allowlist for cache-eligible commands
const ALLOWLIST = [
    { workspace: 'local-tracker', command: 'npm run test' },
    { workspace: 'copilot-ui', command: 'npm run test' },
    { workspace: 'scripts', command: 'npm run test' }
];

function isCommandAllowed(workspace, command) {
    return ALLOWLIST.some(item => item.workspace === workspace && item.command === command);
}

function hashString(str) {
    return crypto.createHash('sha256').update(str).digest('hex');
}

function hashFile(filePath) {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
}

// Dependency graph resolution using TS parser
function getDependencies(filePath, visited = new Set()) {
    if (visited.has(filePath)) return [];
    visited.add(filePath);

    if (!fs.existsSync(filePath)) return [];

    const content = fs.readFileSync(filePath, 'utf8');
    const sourceFile = ts.createSourceFile(
        filePath,
        content,
        ts.ScriptTarget.Latest,
        true
    );

    const dependencies = [];
    const dir = path.dirname(filePath);

    function visit(node) {
        if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
            throw new Error('Dynamic imports are not supported for caching');
        }

        let modulePath = null;
        if (ts.isImportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
            modulePath = node.moduleSpecifier.text;
        } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require' && node.arguments.length > 0) {
            const arg = node.arguments[0];
            if (ts.isStringLiteral(arg)) {
                modulePath = arg.text;
            }
        }

        if (modulePath) {
            if (modulePath.startsWith('@/') || modulePath.startsWith('~/')) {
                throw new Error(`Unsupported alias: ${modulePath}`);
            }
            if (modulePath.startsWith('.')) {
                dependencies.push(resolveModulePath(dir, modulePath));
            }
        }
        ts.forEachChild(node, visit);
    }

    visit(sourceFile);

    const allDeps = [...dependencies];
    for (const dep of dependencies) {
        if (dep) {
            allDeps.push(...getDependencies(dep, visited));
        }
    }

    return [...new Set(allDeps.filter(Boolean))];
}

function resolveModulePath(dir, modulePath) {
    const fullPath = path.resolve(dir, modulePath);
    const extensions = ['.ts', '.js', '.tsx', '.jsx', '/index.ts', '/index.js'];
    
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        return fullPath;
    }

    for (const ext of extensions) {
        const withExt = fullPath + ext;
        if (fs.existsSync(withExt) && fs.statSync(withExt).isFile()) {
            return withExt;
        }
    }
    return null;
}

function hashTestFileAndDependencies(filePath) {
    try {
        const deps = getDependencies(filePath);
        const hashes = [hashFile(filePath)];
        
        for (const dep of deps) {
            hashes.push(hashFile(dep));
        }
        
        return hashString(hashes.filter(Boolean).join(','));
    } catch (e) {
        // Fail-safe: if we can't parse dependencies (e.g., dynamic imports, unsupported aliases, parse errors),
        // return null to force a cache miss.
        return null;
    }
}

function getPartitionKey(workspaceRoot, workspace, command) {
    const wrapperScriptHash = hashFile(__filename);
    const nodeVersion = process.version;
    const platform = process.platform;
    
    const configHashes = [];
    const tsconfigPath = path.join(workspaceRoot, workspace, 'tsconfig.json');
    if (fs.existsSync(tsconfigPath)) configHashes.push(hashFile(tsconfigPath));
    
    const jestConfigPath = path.join(workspaceRoot, workspace, 'jest.config.js');
    if (fs.existsSync(jestConfigPath)) configHashes.push(hashFile(jestConfigPath));
    
    const jestConfigCjsPath = path.join(workspaceRoot, workspace, 'jest.config.cjs');
    if (fs.existsSync(jestConfigCjsPath)) configHashes.push(hashFile(jestConfigCjsPath));

    const packageLockPath = path.join(workspaceRoot, workspace, 'package-lock.json');
    if (fs.existsSync(packageLockPath)) configHashes.push(hashFile(packageLockPath));
    else {
        const rootPackageLockPath = path.join(workspaceRoot, 'package-lock.json');
        if (fs.existsSync(rootPackageLockPath)) configHashes.push(hashFile(rootPackageLockPath));
    }

    const envVars = [process.env.NODE_ENV || '', process.env.CI || ''].join('|');

    const keyString = [
        SCHEMA_VERSION,
        wrapperScriptHash,
        workspace,
        command,
        nodeVersion,
        configHashes.join(','),
        platform,
        envVars
    ].join('::');

    return hashString(keyString);
}

// Optimistic concurrency for discovery state
function updateDiscoveryState(ledgerDir, partitionKey, currentTestFiles) {
    if (!fs.existsSync(ledgerDir)) {
        fs.mkdirSync(ledgerDir, { recursive: true });
    }

    const stateFile = path.join(ledgerDir, `discovery-${partitionKey}.json`);
    const maxRetries = 5;
    let retries = 0;

    while (retries < maxRetries) {
        try {
            let state = { tests: {} };
            let mtimeMs = 0;

            if (fs.existsSync(stateFile)) {
                const stat = fs.statSync(stateFile);
                mtimeMs = stat.mtimeMs;
                state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
            }

            const previousTests = Object.keys(state.tests);
            const currentTestSet = new Set(currentTestFiles);
            
            const deletedTests = previousTests.filter(t => !currentTestSet.has(t));
            const newTests = currentTestFiles.filter(t => !state.tests[t]);

            // Update state
            const newState = { tests: {} };
            for (const test of currentTestFiles) {
                newState.tests[test] = {
                    lastSeen: Date.now(),
                    hash: hashTestFileAndDependencies(test)
                };
            }

            // Check if file was modified by another process
            if (fs.existsSync(stateFile)) {
                const currentStat = fs.statSync(stateFile);
                if (currentStat.mtimeMs !== mtimeMs) {
                    retries++;
                    continue; // Retry
                }
            } else if (mtimeMs !== 0) {
                // File was deleted by another process
                retries++;
                continue;
            }

            // Write to a temporary file and rename for atomic write
            const tempFile = `${stateFile}.${Date.now()}-${Math.random().toString(36).substring(2)}.tmp`;
            fs.writeFileSync(tempFile, JSON.stringify(newState, null, 2));
            fs.renameSync(tempFile, stateFile);

            return { deletedTests, newTests, state: newState };
        } catch (error) {
            retries++;
            if (retries >= maxRetries) {
                throw new Error(`Failed to update discovery state after ${maxRetries} retries: ${error.message}`);
            }
            // Small delay before retry
            const delay = Math.floor(Math.random() * 50) + 10;
            const start = Date.now();
            while (Date.now() - start < delay) {
                // busy wait
            }
        }
    }
}


function enforceCacheRetentionLimit(cacheDir, maxFiles = 1000) {
    if (!fs.existsSync(cacheDir)) return;
    const files = fs.readdirSync(cacheDir).filter(f => f.endsWith('.json'));
    if (files.length <= maxFiles) return;

    const fileStats = files.map(f => {
        const filePath = path.join(cacheDir, f);
        return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    });

    fileStats.sort((a, b) => b.mtimeMs - a.mtimeMs); // Newest first

    const toDelete = fileStats.slice(maxFiles);
    for (const file of toDelete) {
        try {
            fs.unlinkSync(file.filePath);
        } catch (e) {
            // Ignore deletion errors
        }
    }
}

function writeCacheEntry(cacheDir, hash, entryData) {
    if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
    }
    const cacheFile = path.join(cacheDir, `${hash}.json`);
    const tempFile = `${cacheFile}.${Date.now()}-${Math.random().toString(36).substring(2)}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(entryData, null, 2));
    fs.renameSync(tempFile, cacheFile);
}

function readCacheEntry(cacheDir, hash) {
    const cacheFile = path.join(cacheDir, `${hash}.json`);
    if (fs.existsSync(cacheFile)) {
        try {
            return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        } catch (e) {
            return null;
        }
    }
    return null;
}

function writeEvidence(evidenceDir, runId, evidenceItems) {
    if (!fs.existsSync(evidenceDir)) {
        fs.mkdirSync(evidenceDir, { recursive: true });
    }
    const evidenceFile = path.join(evidenceDir, `test-run-evidence-${runId}.json`);
    const tempFile = `${evidenceFile}.${Date.now()}-${Math.random().toString(36).substring(2)}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(evidenceItems, null, 2));
    fs.renameSync(tempFile, evidenceFile);
    return evidenceFile;
}

function cleanupStaleEvidence(evidenceDir, maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
    if (!fs.existsSync(evidenceDir)) return;
    const now = Date.now();
    const files = fs.readdirSync(evidenceDir).filter(f => f.startsWith('test-run-evidence-') && f.endsWith('.json'));
    for (const f of files) {
        const filePath = path.join(evidenceDir, f);
        try {
            const stat = fs.statSync(filePath);
            if (now - stat.mtimeMs > maxAgeMs) {
                fs.unlinkSync(filePath);
            }
        } catch (e) {
            // Ignore
        }
    }
}

async function runTestWithFailSafes(testRunnerFn, options) {
    const {
        cacheDir,
        evidenceDir,
        hash,
        runId,
        forceRun = false,
        testFilePath
    } = options;

    let cacheEntry = null;
    let cacheDecisionReason = 'cache miss: unknown';
    let wasCached = false;

    if (!forceRun && hash) {
        cacheEntry = readCacheEntry(cacheDir, hash);
        if (cacheEntry && cacheEntry.result && cacheEntry.result.success) {
            cacheDecisionReason = 'cache hit';
            wasCached = true;
        } else {
            cacheDecisionReason = 'cache miss: no valid cache entry';
        }
    } else if (forceRun) {
        cacheDecisionReason = 'cache miss: force run';
    } else if (!hash) {
        cacheDecisionReason = 'cache miss: uncacheable (fail-safe)';
    }

    let result;
    if (wasCached) {
        result = cacheEntry.result;
    } else {
        try {
            result = await testRunnerFn();
        } catch (e) {
            result = { success: false, durationMs: 0, stderr: e.message };
        }

        if (result.success && hash) {
            writeCacheEntry(cacheDir, hash, {
                schemaVersion: SCHEMA_VERSION,
                hash,
                testFilePath,
                lastRunTimestamp: Date.now(),
                result
            });
            enforceCacheRetentionLimit(cacheDir);
        }
    }

    const evidenceData = {
        schemaVersion: SCHEMA_VERSION,
        runId,
        testFilePath,
        cacheDecisionReason,
        wasCached,
        result,
        timestamp: Date.now()
    };

    try {
        writeEvidence(evidenceDir, runId, [evidenceData]);
        cleanupStaleEvidence(evidenceDir);
    } catch (e) {
        // Fail-closed evidence generation
        const err = new Error(`Failed to generate evidence: ${e.message}`);
        err.code = 255;
        throw err;
    }

    if (!result.success) {
        const err = new Error(`Test failed: ${testFilePath}`);
        err.code = 1;
        throw err;
    }
    
    return result;
}

module.exports = {
    runTestWithFailSafes,
    isCommandAllowed,
    hashTestFileAndDependencies,
    getPartitionKey,
    updateDiscoveryState,
    getDependencies,
    enforceCacheRetentionLimit,
    writeCacheEntry,
    readCacheEntry,
    writeEvidence,
    cleanupStaleEvidence
};

