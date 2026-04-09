'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const workspaceRoot = path.resolve(__dirname, '..');
const tauriReleaseRoot = path.join(workspaceRoot, 'release', 'tauri');
const stagedResourcesRoot = path.join(workspaceRoot, 'src-tauri', 'gen', 'resources');

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function removeWithFs(targetPath) {
  fs.rmSync(targetPath, {
    recursive: true,
    force: true,
    maxRetries: 20,
    retryDelay: 500,
  });
}

function removeWithWindowsRmdir(targetPath) {
  if (process.platform !== 'win32') {
    return;
  }

  const result = spawnSync(
    'cmd.exe',
    ['/d', '/s', '/c', `if exist "${targetPath}" rmdir /s /q "${targetPath}"`],
    { stdio: 'pipe' },
  );

  if (result.status !== 0 && fs.existsSync(targetPath)) {
    const stderr = String(result.stderr || '').trim();
    const stdout = String(result.stdout || '').trim();
    throw new Error(
      `Windows rmdir failed for ${targetPath}: ${stderr || stdout || `exit ${result.status}`}`,
    );
  }
}

function attemptRemoval(targetPath) {
  let lastError = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      removeWithFs(targetPath);
      if (!fs.existsSync(targetPath)) {
        return;
      }
    } catch (error) {
      lastError = error;
    }
    sleep(300 * (attempt + 1));
  }

  try {
    removeWithWindowsRmdir(targetPath);
  } catch (error) {
    lastError = error;
  }

  if (!fs.existsSync(targetPath)) {
    return;
  }

  throw lastError || new Error(`Failed to remove ${targetPath}`);
}

function removeTarget(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return;
  }

  try {
    attemptRemoval(targetPath);
    return;
  } catch (error) {
    if (!fs.existsSync(targetPath)) {
      return;
    }

    const renamedPath = `${targetPath}.cleanup-${Date.now()}`;
    fs.renameSync(targetPath, renamedPath);

    try {
      attemptRemoval(renamedPath);
      return;
    } catch (renameError) {
      throw new Error(
        `Failed to remove ${targetPath} after retry and rename fallback: ${
          renameError instanceof Error ? renameError.message : String(renameError)
        }`,
      );
    }
  }
}

function cleanTauriRelease() {
  removeTarget(tauriReleaseRoot);
  removeTarget(stagedResourcesRoot);

  return {
    tauriReleaseRoot,
    stagedResourcesRoot,
  };
}

if (require.main === module) {
  try {
    const result = cleanTauriRelease();
    console.log(
      `[clean-tauri-release] cleaned ${path.relative(workspaceRoot, result.tauriReleaseRoot)} and `
      + `${path.relative(workspaceRoot, result.stagedResourcesRoot)}.`,
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[clean-tauri-release] ${detail}`);
    process.exit(1);
  }
}

module.exports = {
  cleanTauriRelease,
  removeTarget,
};
