'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { DEFAULT_PROVIDER_CATALOG } = require('@elegy-copilot/contracts');
const { loadProviderCatalog } = require('./providerCatalog');

function makeTempEngineRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'instruction-engine-provider-catalog-'));
}

test('loadProviderCatalog reads engine-assets/providers.json as the canonical source', () => {
  const engineRoot = makeTempEngineRoot();
  const providersPath = path.join(engineRoot, 'engine-assets', 'providers.json');

  fs.mkdirSync(path.dirname(providersPath), { recursive: true });
  fs.writeFileSync(providersPath, JSON.stringify({
    schemaVersion: 2,
    providers: [
      {
        id: 'custom-provider',
        title: 'Custom Provider',
        sourceType: 'github-repo',
        installStrategy: 'managed-import',
      },
    ],
  }, null, 2));

  const loaded = loadProviderCatalog(engineRoot);

  assert.equal(loaded.providerCatalogPath, providersPath);
  assert.deepEqual(loaded.providerCatalog, {
    schemaVersion: 2,
    providers: [
      {
        id: 'custom-provider',
        title: 'Custom Provider',
        sourceType: 'github-repo',
        installStrategy: 'managed-import',
      },
    ],
  });
});

test('loadProviderCatalog falls back to the shared contract mirror when the canonical file is absent', () => {
  const engineRoot = makeTempEngineRoot();

  const loaded = loadProviderCatalog(engineRoot);

  assert.deepEqual(loaded.providerCatalog, DEFAULT_PROVIDER_CATALOG);
});
