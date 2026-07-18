'use strict';

const crypto = require('crypto');
const test = require('node:test');
const assert = require('node:assert/strict');

const { validatePublishedDesktopRelease } = require('./desktop-release-acceptance');

function buildFixture({ installerName = 'Elegy.Copilot_1.0.5_x64-setup.exe' } = {}) {
  const installer = Buffer.from('installer payload');
  const signatureName = `${installerName}.sig`;
  const feedName = 'stable-latest.json';
  const manifest = {
    version: '1.0.5',
    releaseChannel: 'stable',
    artifact: {
      relativePath: installerName,
      sha256: crypto.createHash('sha256').update(installer).digest('hex'),
    },
    updateLane: {
      updaterFeedRelativePath: feedName,
      updaterSignatureRelativePath: signatureName,
    },
  };
  const feed = {
    version: '1.0.5',
    platforms: {
      'windows-x86_64': {
        url: `https://github.com/Sofreshx/Elegy-copilot/releases/download/desktop-v1.0.5/${encodeURIComponent(installerName)}`,
        signature: 'signed payload',
      },
    },
  };

  return {
    release: {
      tag_name: 'desktop-v1.0.5',
      draft: false,
      prerelease: false,
      assets: [
        { name: installerName },
        { name: signatureName },
        { name: 'release-manifest.json' },
        { name: feedName },
        { name: 'windows-installation-guide.md' },
      ],
    },
    assetContents: {
      [installerName]: installer,
      [signatureName]: 'signed payload',
      'release-manifest.json': JSON.stringify(manifest),
      [feedName]: JSON.stringify(feed),
      'windows-installation-guide.md': '# Windows Desktop Installation Guide',
    },
  };
}

test('accepts a published desktop release whose manifest and updater feed resolve to its installer', () => {
  const fixture = buildFixture();

  const result = validatePublishedDesktopRelease({
    ...fixture,
    expectedVersion: '1.0.5',
    expectedTag: 'desktop-v1.0.5',
    expectedPrerelease: false,
  });

  assert.equal(result.installerName, 'Elegy.Copilot_1.0.5_x64-setup.exe');
});

test('rejects a release when the manifest names an installer that GitHub did not publish', () => {
  const fixture = buildFixture();
  const manifest = JSON.parse(fixture.assetContents['release-manifest.json']);
  manifest.artifact.relativePath = 'Elegy Copilot_1.0.5_x64-setup.exe';
  fixture.assetContents['release-manifest.json'] = JSON.stringify(manifest);

  assert.throws(
    () => validatePublishedDesktopRelease({
      ...fixture,
      expectedVersion: '1.0.5',
      expectedTag: 'desktop-v1.0.5',
      expectedPrerelease: false,
    }),
    /Published release is missing the installer named by release-manifest\.json/,
  );
});

test('rejects a release when its updater URL names a different downloadable installer', () => {
  const fixture = buildFixture();
  const feed = JSON.parse(fixture.assetContents['stable-latest.json']);
  feed.platforms['windows-x86_64'].url = feed.platforms['windows-x86_64'].url.replace(
    'Elegy.Copilot_1.0.5_x64-setup.exe',
    'Elegy%20Copilot_1.0.5_x64-setup.exe',
  );
  fixture.assetContents['stable-latest.json'] = JSON.stringify(feed);

  assert.throws(
    () => validatePublishedDesktopRelease({
      ...fixture,
      expectedVersion: '1.0.5',
      expectedTag: 'desktop-v1.0.5',
      expectedPrerelease: false,
    }),
    /updater feed URL does not resolve to the published installer/,
  );
});
