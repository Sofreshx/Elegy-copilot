'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { tailLog } = require('./logReader');

test('returns only the requested Kimaki log tail', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kimaki-log-'));
  const logPath = path.join(root, 'kimaki.log');
  fs.writeFileSync(logPath, 'one\ntwo\nthree\n', 'utf8');
  assert.deepEqual(tailLog(logPath, 2), ['two', 'three']);
  fs.rmSync(root, { recursive: true, force: true });
});
