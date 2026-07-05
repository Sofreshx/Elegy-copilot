'use strict';

const assert = require('assert');
const { test } = require('node:test');
const { resolveWindowsPath } = require('../lib/vaultConfig');

test('vault config resolves Windows drive paths to WSL mount paths', () => {
  assert.equal(
    resolveWindowsPath('C:\\Users\\lolzi\\Documents\\Dev Vault'),
    '/mnt/c/Users/lolzi/Documents/Dev Vault'
  );
});
