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

function resolveSmokeMode() {
  const raw = process.env.INSTRUCTION_ENGINE_SDK_SMOKE_MODE;
  if (!raw || !raw.trim()) {
    return 'auto';
  }

  const mode = raw.trim().toLowerCase();
  if (!['auto', 'skip', 'require'].includes(mode)) {
    throw new Error(
      `Unsupported INSTRUCTION_ENGINE_SDK_SMOKE_MODE: ${raw}. Use auto, skip, or require.`,
    );
  }

  return mode;
}

function resolveHarnessDetails(repoRoot) {
  const fromEnv = process.env.COPILOT_SDK_ROOT && process.env.COPILOT_SDK_ROOT.trim();
  if (fromEnv) {
    const copilotSdkRoot = path.resolve(fromEnv);
    return {
      copilotSdkRoot,
      replayHarnessPath: path.join(copilotSdkRoot, 'test', 'harness', 'server.ts'),
      resolutionSource: 'COPILOT_SDK_ROOT',
    };
  }

  const copilotSdkRoot = path.resolve(repoRoot, '..', 'copilot-sdk');
  return {
    copilotSdkRoot,
    replayHarnessPath: path.join(copilotSdkRoot, 'test', 'harness', 'server.ts'),
    resolutionSource: 'default sibling checkout',
  };
}

function formatHarnessGuidance({ mode, copilotSdkRoot, replayHarnessPath, resolutionSource }) {
  return [
    `Mode: ${mode}`,
    `Resolved copilot-sdk root (${resolutionSource}): ${copilotSdkRoot}`,
    `Expected replay harness: ${replayHarnessPath}`,
    'Setup: check out copilot-sdk next to instruction-engine or set COPILOT_SDK_ROOT to that checkout.',
    'Fail closed: set INSTRUCTION_ENGINE_SDK_SMOKE_MODE=require.',
    'Intentional local skip: set INSTRUCTION_ENGINE_SDK_SMOKE_MODE=skip.',
    'Command: node copilot-ui\\tests\\e2e\\sdk-smoke.test.js',
  ].join('\n');
}

function run() {
  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  const snapshotPath = path.resolve(__dirname, 'snapshots', 'sdk-smoke.yaml');
  const snapshot = validateSnapshot(snapshotPath);
  if (!snapshot.includes('instruction-engine-sdk-smoke')) {
    throw new Error('Snapshot id mismatch for instruction-engine smoke test.');
  }

  const smokeMode = resolveSmokeMode();
  const harnessDetails = resolveHarnessDetails(repoRoot);
  const guidanceDetails = { ...harnessDetails, mode: smokeMode };
  const { copilotSdkRoot, replayHarnessPath } = harnessDetails;

  if (smokeMode === 'skip') {
    console.log('SDK smoke test skipped: INSTRUCTION_ENGINE_SDK_SMOKE_MODE=skip.');
    console.log(formatHarnessGuidance(guidanceDetails));
    return;
  }

  if (!exists(copilotSdkRoot) || !exists(replayHarnessPath)) {
    const guidance = formatHarnessGuidance(guidanceDetails);
    if (smokeMode === 'require') {
      throw new Error(`SDK smoke test requires the replay harness.\n${guidance}`);
    }

    console.log('SDK smoke test skipped: replay harness not available for auto mode.');
    console.log(guidance);
    return;
  }

  // Lightweight deterministic validation for opt-in E2E wiring.
  // Full proxy startup and bridge runtime execution is environment-dependent and intentionally opt-in.
  console.log('SDK smoke test wiring validated.');
  console.log(`mode: ${smokeMode}`);
  console.log(`copilot-sdk root: ${copilotSdkRoot}`);
  console.log(`replay harness: ${replayHarnessPath}`);
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
  formatHarnessGuidance,
  run,
  resolveHarnessDetails,
  resolveSmokeMode,
  validateSnapshot,
};
