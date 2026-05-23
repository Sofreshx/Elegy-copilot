const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  determineStaleReleaseAssetNames,
  pruneDesktopReleaseAssets,
  resolveExpectedReleaseAssetNames,
} = require('./prune-desktop-release-assets');

function withTempDir(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-release-assets-'));
  try {
    return callback(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function writeFile(filePath, contents = 'fixture') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, 'utf8');
}

test('determineStaleReleaseAssetNames returns names missing from the staged asset set', () => {
  const result = determineStaleReleaseAssetNames(
    [
      'Elegy Copilot_1.0.2_x64-setup.exe',
      'stale-desktop-installer.exe',
      'release-manifest.json',
      'windows-installation-guide.md',
    ],
    [
      'Elegy Copilot_1.0.2_x64-setup.exe',
      'release-manifest.json',
      'windows-installation-guide.md',
    ],
  );

  assert.deepEqual(result, ['stale-desktop-installer.exe']);
});

test('resolveExpectedReleaseAssetNames rejects duplicate basenames in nested artifact directories', () => {
  withTempDir((root) => {
    writeFile(path.join(root, 'a', 'release-manifest.json'));
    writeFile(path.join(root, 'b', 'release-manifest.json'));

    assert.throws(
      () => resolveExpectedReleaseAssetNames(root),
      /duplicate asset names: release-manifest\.json/,
    );
  });
});

test('pruneDesktopReleaseAssets skips when the GitHub release does not exist yet', () => {
  withTempDir((root) => {
    writeFile(path.join(root, 'release-manifest.json'));
    writeFile(path.join(root, 'windows-installation-guide.md'));
    writeFile(path.join(root, 'Elegy Copilot_1.0.2_x64-setup.exe'));

    const result = pruneDesktopReleaseAssets({
      repo: 'test-owner/test-repo',
      releaseTag: '1.0.2',
      artifactsDir: root,
      viewRelease() {
        return {
          ok: false,
          missing: true,
          errorMessage: 'release not found',
          assetNames: [],
        };
      },
    });

    assert.equal(result.status, 'skipped');
    assert.deepEqual(result.staleAssetNames, []);
  });
});

test('pruneDesktopReleaseAssets deletes stale release assets not present in staged artifacts', () => {
  withTempDir((root) => {
    writeFile(path.join(root, 'release-manifest.json'));
    writeFile(path.join(root, 'windows-installation-guide.md'));
    writeFile(path.join(root, 'Elegy Copilot_1.0.2_x64-setup.exe'));

    const deletedAssets = [];
    const result = pruneDesktopReleaseAssets({
      repo: 'test-owner/test-repo',
      releaseTag: 'desktop-v1.0.2',
      artifactsDir: root,
      viewRelease() {
        return {
          ok: true,
          missing: false,
          errorMessage: null,
          assetNames: [
            'Elegy Copilot_1.0.2_x64-setup.exe',
            'stale-desktop-installer.exe',
            'release-manifest.json',
            'windows-installation-guide.md',
          ],
        };
      },
      deleteAsset({ assetName }) {
        deletedAssets.push(assetName);
      },
    });

    assert.equal(result.status, 'pruned');
    assert.deepEqual(result.staleAssetNames, ['stale-desktop-installer.exe']);
    assert.deepEqual(deletedAssets, ['stale-desktop-installer.exe']);
  });
});

test('pruneDesktopReleaseAssets reports noop when release assets already match the staged set', () => {
  withTempDir((root) => {
    writeFile(path.join(root, 'release-manifest.json'));
    writeFile(path.join(root, 'windows-installation-guide.md'));
    writeFile(path.join(root, 'Elegy Copilot_1.0.2_x64-setup.exe'));

    const result = pruneDesktopReleaseAssets({
      repo: 'test-owner/test-repo',
      releaseTag: 'desktop-v1.0.2',
      artifactsDir: root,
      viewRelease() {
        return {
          ok: true,
          missing: false,
          errorMessage: null,
          assetNames: [
            'Elegy Copilot_1.0.2_x64-setup.exe',
            'release-manifest.json',
            'windows-installation-guide.md',
          ],
        };
      },
      deleteAsset() {
        throw new Error('deleteAsset should not be called when nothing is stale');
      },
    });

    assert.equal(result.status, 'noop');
    assert.deepEqual(result.staleAssetNames, []);
  });
});
