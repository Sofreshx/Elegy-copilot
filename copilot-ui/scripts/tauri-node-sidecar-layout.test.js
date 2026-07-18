'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  isOptionalResource,
  loadTauriNodeSidecarLayout,
  validateTauriBundleConfig,
} = require('./tauri-node-sidecar-layout');

test('declares catalog-assets as a packaged runtime resource', () => {
  const { manifest } = loadTauriNodeSidecarLayout();
  assert.ok(manifest.resourceCopies.some((resource) => (
    resource.id === 'catalog-assets'
      && resource.kind === 'directory'
      && resource.source === '../catalog-assets'
      && resource.target === 'catalog-assets'
  )));

  const bundle = validateTauriBundleConfig();
  assert.deepEqual(bundle.resourceMappings, {
    'gen/resources': 'resources',
  });
});

test('treats the optional Moon Bridge binary as optional during installed-layout validation', () => {
  const { manifest } = loadTauriNodeSidecarLayout();
  const moonBridge = manifest.resourceCopies.find((resource) => resource.id === 'moon-bridge-binary');

  assert.ok(moonBridge);
  assert.equal(isOptionalResource(moonBridge), true);
});

test('declares js-yaml because packaged runtime routes require it', () => {
  const { manifest } = loadTauriNodeSidecarLayout();

  assert.ok(
    manifest.nodeModulePayload.requiredRuntimePackages.includes('js-yaml'),
    'Expected the packaged runtime dependency closure to include js-yaml.',
  );
});
