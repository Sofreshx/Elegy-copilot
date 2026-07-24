'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('desktop dev uses a single-instance identifier distinct from the installed app', () => {
  const source = fs.readFileSync(
    path.join(__dirname, 'run-tauri-dev-windows.js'),
    'utf8',
  );

  assert.match(source, /identifier: 'dev\.elegycopilot\.desktop\.tauri\.local'/);
  assert.match(source, /TAURI_CONFIG: JSON\.stringify\(tauriDevConfig\)/);
});
