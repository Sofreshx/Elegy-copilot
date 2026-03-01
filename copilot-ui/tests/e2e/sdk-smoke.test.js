const fs = require('node:fs');
const path = require('node:path');

function exists(targetPath) {
  try {
    return fs.existsSync(targetPath);
  } catch {
    return false;
  }
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function validateSnapshot(snapshotPath) {
  if (!exists(snapshotPath)) {
    throw new Error(`Snapshot not found: ${snapshotPath}`);
  }

  const raw = readText(snapshotPath);
  const requiredTokens = ['name:', 'schemaVersion:', 'exchange:', 'assertions:'];
  for (const token of requiredTokens) {
    if (!raw.includes(token)) {
      throw new Error(`Snapshot missing required token: ${token}`);
    }
  }

  return raw;
}

function resolveCopilotSdkRoot(repoRoot) {
  const fromEnv = process.env.COPILOT_SDK_ROOT && process.env.COPILOT_SDK_ROOT.trim();
  if (fromEnv) {
    return path.resolve(fromEnv);
  }

  return path.resolve(repoRoot, '..', 'copilot-sdk');
}

function run() {
  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  const snapshotPath = path.resolve(__dirname, 'snapshots', 'sdk-smoke.yaml');
  const snapshot = validateSnapshot(snapshotPath);

  const copilotSdkRoot = resolveCopilotSdkRoot(repoRoot);
  const replayHarnessPath = path.join(copilotSdkRoot, 'test', 'harness', 'server.ts');

  if (!exists(copilotSdkRoot) || !exists(replayHarnessPath)) {
    console.log('SDK smoke test skipped: copilot-sdk replay harness not available in workspace.');
    return;
  }

  // Lightweight deterministic validation for opt-in E2E wiring.
  // Full proxy startup and bridge runtime execution is environment-dependent and intentionally opt-in.
  if (!snapshot.includes('instruction-engine-sdk-smoke')) {
    throw new Error('Snapshot id mismatch for instruction-engine smoke test.');
  }

  console.log('SDK smoke test wiring validated.');
  console.log(`copilot-sdk root: ${copilotSdkRoot}`);
  console.log(`snapshot: ${snapshotPath}`);
}

if (require.main === module) {
  try {
    run();
  } catch (error) {
    console.error('SDK smoke test failed.');
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

module.exports = {
  run,
  validateSnapshot,
  resolveCopilotSdkRoot,
};
