'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { readConfig, writeConfigFields, getRemoteSessions, setRemoteSessions } = require('../lib/copilotConfig');

describe('copilotConfig', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-config-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('readConfig returns {} when file does not exist', () => {
    const config = readConfig(tmpDir);
    assert.deepEqual(config, {});
  });

  it('readConfig returns {} for invalid JSON', () => {
    fs.writeFileSync(path.join(tmpDir, 'config.json'), 'not json', 'utf8');
    const config = readConfig(tmpDir);
    assert.deepEqual(config, {});
  });

  it('readConfig returns parsed object', () => {
    fs.writeFileSync(path.join(tmpDir, 'config.json'), '{"remoteSessions":true,"foo":"bar"}', 'utf8');
    const config = readConfig(tmpDir);
    assert.deepEqual(config, { remoteSessions: true, foo: 'bar' });
  });

  it('writeConfigFields merges without losing existing keys', () => {
    fs.writeFileSync(path.join(tmpDir, 'config.json'), '{"existing":"keep","old":1}', 'utf8');
    writeConfigFields(tmpDir, { remoteSessions: true });
    const config = readConfig(tmpDir);
    assert.equal(config.existing, 'keep');
    assert.equal(config.old, 1);
    assert.equal(config.remoteSessions, true);
  });

  it('writeConfigFields creates config dir if missing', () => {
    const nested = path.join(tmpDir, 'sub', 'dir');
    writeConfigFields(nested, { remoteSessions: false });
    const config = readConfig(nested);
    assert.equal(config.remoteSessions, false);
  });

  it('getRemoteSessions returns false when not set', () => {
    assert.equal(getRemoteSessions(tmpDir), false);
  });

  it('getRemoteSessions returns true when set', () => {
    fs.writeFileSync(path.join(tmpDir, 'config.json'), '{"remoteSessions":true}', 'utf8');
    assert.equal(getRemoteSessions(tmpDir), true);
  });

  it('setRemoteSessions writes the preference', () => {
    setRemoteSessions(tmpDir, true);
    assert.equal(getRemoteSessions(tmpDir), true);
    setRemoteSessions(tmpDir, false);
    assert.equal(getRemoteSessions(tmpDir), false);
  });

  it('setRemoteSessions preserves unknown keys', () => {
    fs.writeFileSync(path.join(tmpDir, 'config.json'), '{"theme":"dark","logLevel":"info"}', 'utf8');
    setRemoteSessions(tmpDir, true);
    const config = readConfig(tmpDir);
    assert.equal(config.theme, 'dark');
    assert.equal(config.logLevel, 'info');
    assert.equal(config.remoteSessions, true);
  });
});
