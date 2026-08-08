'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const workflow = fs.readFileSync(
  path.join(root, '.github', 'workflows', 'desktop-signing-check.yml'),
  'utf8',
);

test('desktop signing check is explicit, read-only, and never publishes artifacts', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /permissions:\s*\n\s*contents: read/);
  assert.match(workflow, /TAURI_SIGNING_PRIVATE_KEY/);
  assert.match(workflow, /verify:tauri:updater-signature/);
  assert.doesNotMatch(workflow, /gh release|upload-artifact|contents: write|desktop:preview:stage/);
});
