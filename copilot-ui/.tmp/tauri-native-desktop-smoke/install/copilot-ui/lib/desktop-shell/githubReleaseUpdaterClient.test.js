'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createGitHubReleaseUpdaterClient } = require('./githubReleaseUpdaterClient');

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get() {
        return null;
      },
    },
    async json() {
      return payload;
    },
  };
}

function binaryResponse(text) {
  const payload = Buffer.from(text, 'utf8');
  return {
    ok: true,
    status: 200,
    headers: {
      get(name) {
        return String(name || '').toLowerCase() === 'content-length' ? String(payload.length) : null;
      },
    },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(payload);
        controller.close();
      },
    }),
    async json() {
      throw new Error('binary response does not support json()');
    },
  };
}

test('GitHub release updater client selects the latest matching stable release manifest', async () => {
  const fetch = async (url) => {
    if (String(url).includes('/releases?')) {
      return jsonResponse([
        {
          id: 11,
          tag_name: 'desktop-v1.0.2',
          name: '1.0.2',
          html_url: 'https://github.com/Sofreshx/Elegy-copilot/releases/tag/desktop-v1.0.2',
          published_at: '2026-04-09T00:00:00Z',
          draft: false,
          prerelease: false,
          assets: [
            {
              name: 'release-manifest.json',
              browser_download_url: 'https://example.test/release-manifest.json',
            },
            {
              name: 'Elegy Copilot_1.0.2_x64-setup.exe',
              browser_download_url: 'https://example.test/Elegy%20Copilot_1.0.2_x64-setup.exe',
            },
          ],
        },
      ]);
    }

    return jsonResponse({
      schemaVersion: 1,
      platform: 'windows',
      shell: 'tauri',
      version: '1.0.2',
      releaseChannel: 'stable',
      desktopReleaseChannelContract: {
        channel: 'stable',
        sdkChannel: 'stable',
        cliChannel: 'stable',
      },
      artifact: {
        relativePath: 'Elegy Copilot_1.0.2_x64-setup.exe',
        sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      },
      updateLane: {
        mode: 'manual_installer',
        autoUpdateEnabled: false,
        failClosedChannelPolicy: true,
        inPlaceUpgradeSupported: false,
      },
    });
  };

  const client = createGitHubReleaseUpdaterClient({
    publishRepository: 'Sofreshx/Elegy-copilot',
    fetch,
  });

  const result = await client.findLatestReleaseCandidate({
    channel: 'stable',
    currentVersion: '1.0.1',
    isCandidateAllowed: () => ({ allowed: true, reason: 'allowed_by_channel_policy' }),
  });

  assert.equal(result.outcome, 'available');
  assert.equal(result.candidate.version, '1.0.2');
  assert.equal(result.candidate.channel, 'stable');
});

test('GitHub release updater client fails closed when the latest matching release is missing a manifest', async () => {
  const client = createGitHubReleaseUpdaterClient({
    publishRepository: 'Sofreshx/Elegy-copilot',
    fetch: async () => jsonResponse([
      {
        id: 12,
        tag_name: 'desktop-v1.0.2',
        name: '1.0.2',
        draft: false,
        prerelease: false,
        assets: [],
      },
    ]),
  });

  const result = await client.findLatestReleaseCandidate({
    channel: 'stable',
    currentVersion: '1.0.1',
    isCandidateAllowed: () => ({ allowed: true, reason: 'allowed_by_channel_policy' }),
  });

  assert.equal(result.outcome, 'blocked');
  assert.equal(result.reason, 'github_release_manifest_missing');
});

test('GitHub release updater client ignores historic semver releases when selecting stable desktop candidates', async () => {
  const fetch = async (url) => {
    if (String(url).includes('/releases?')) {
      return jsonResponse([
        {
          id: 14,
          tag_name: '1.0.3',
          name: '1.0.3',
          draft: false,
          prerelease: false,
          assets: [
            {
              name: 'release-manifest.json',
              browser_download_url: 'https://example.test/preview-release-manifest.json',
            },
            {
              name: 'Elegy Copilot_1.0.3_x64-setup.exe',
              browser_download_url: 'https://example.test/Elegy%20Copilot_1.0.3_x64-setup.exe',
            },
          ],
        },
        {
          id: 15,
          tag_name: 'desktop-v1.0.2',
          name: '1.0.2',
          html_url: 'https://github.com/Sofreshx/Elegy-copilot/releases/tag/desktop-v1.0.2',
          published_at: '2026-04-09T00:00:00Z',
          draft: false,
          prerelease: false,
          assets: [
            {
              name: 'release-manifest.json',
              browser_download_url: 'https://example.test/stable-release-manifest.json',
            },
            {
              name: 'Elegy Copilot_1.0.2_x64-setup.exe',
              browser_download_url: 'https://example.test/Elegy%20Copilot_1.0.2_x64-setup.exe',
            },
          ],
        },
      ]);
    }

    return jsonResponse({
      schemaVersion: 1,
      platform: 'windows',
      shell: 'tauri',
      version: '1.0.2',
      releaseChannel: 'stable',
      desktopReleaseChannelContract: {
        channel: 'stable',
        sdkChannel: 'stable',
        cliChannel: 'stable',
      },
      artifact: {
        relativePath: 'Elegy Copilot_1.0.2_x64-setup.exe',
        sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      },
      updateLane: {
        mode: 'manual_installer',
        autoUpdateEnabled: false,
        failClosedChannelPolicy: true,
        inPlaceUpgradeSupported: false,
      },
    });
  };

  const client = createGitHubReleaseUpdaterClient({
    publishRepository: 'Sofreshx/Elegy-copilot',
    fetch,
  });

  const result = await client.findLatestReleaseCandidate({
    channel: 'stable',
    currentVersion: '1.0.1',
    isCandidateAllowed: () => ({ allowed: true, reason: 'allowed_by_channel_policy' }),
  });

  assert.equal(result.outcome, 'available');
  assert.equal(result.candidate.version, '1.0.2');
  assert.equal(result.candidate.releaseTag, 'desktop-v1.0.2');
});

test('GitHub release updater client tolerates normalized installer asset name matches', async () => {
  const fetch = async (url) => {
    if (String(url).includes('/releases?')) {
      return jsonResponse([
        {
          id: 16,
          tag_name: 'desktop-v1.0.2',
          name: '1.0.2',
          html_url: 'https://github.com/Sofreshx/Elegy-copilot/releases/tag/desktop-v1.0.2',
          published_at: '2026-04-09T00:00:00Z',
          draft: false,
          prerelease: false,
          assets: [
            {
              name: 'release-manifest.json',
              browser_download_url: 'https://example.test/release-manifest.json',
            },
            {
              name: 'Elegy.Copilot_1.0.2_x64-setup.exe',
              browser_download_url: 'https://example.test/Elegy.Copilot_1.0.2_x64-setup.exe',
            },
          ],
        },
      ]);
    }

    return jsonResponse({
      schemaVersion: 1,
      platform: 'windows',
      shell: 'tauri',
      version: '1.0.2',
      releaseChannel: 'stable',
      desktopReleaseChannelContract: {
        channel: 'stable',
        sdkChannel: 'stable',
        cliChannel: 'stable',
      },
      artifact: {
        relativePath: 'Elegy Copilot_1.0.2_x64-setup.exe',
        sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      },
      updateLane: {
        mode: 'manual_installer',
        autoUpdateEnabled: false,
        failClosedChannelPolicy: true,
        inPlaceUpgradeSupported: false,
      },
    });
  };

  const client = createGitHubReleaseUpdaterClient({
    publishRepository: 'Sofreshx/Elegy-copilot',
    fetch,
  });

  const result = await client.findLatestReleaseCandidate({
    channel: 'stable',
    currentVersion: '1.0.1',
    isCandidateAllowed: () => ({ allowed: true, reason: 'allowed_by_channel_policy' }),
  });

  assert.equal(result.outcome, 'available');
  assert.equal(result.candidate.artifact.name, 'Elegy.Copilot_1.0.2_x64-setup.exe');
  assert.equal(result.candidate.artifact.declaredName, 'Elegy Copilot_1.0.2_x64-setup.exe');
});

test('GitHub release updater client downloads the installer and verifies sha256', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-updater-client-'));
  const installerBody = 'hello-installer';
  const expectedSha = require('node:crypto').createHash('sha256').update(installerBody).digest('hex');
  const progress = [];
  const client = createGitHubReleaseUpdaterClient({
    publishRepository: 'Sofreshx/Elegy-copilot',
    downloadRoot: tempRoot,
    fetch: async () => binaryResponse(installerBody),
  });

  const result = await client.downloadInstaller({
    version: '1.0.2',
    channel: 'stable',
    artifact: {
      name: 'Elegy Copilot_1.0.2_x64-setup.exe',
      sha256: expectedSha,
      size: installerBody.length,
      downloadUrl: 'https://example.test/Elegy%20Copilot_1.0.2_x64-setup.exe',
    },
  }, {
    onProgress(update) {
      progress.push(update.progressPercent);
    },
  });

  assert.equal(fs.existsSync(result.installerPath), true);
  assert.equal(fs.readFileSync(result.installerPath, 'utf8'), installerBody);
  assert.equal(result.sha256, expectedSha);
  assert.equal(progress.length > 0, true);
});
