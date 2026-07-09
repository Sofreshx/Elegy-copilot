'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const tauriConfigPath = path.join(repoRoot, 'copilot-ui', 'src-tauri', 'tauri.conf.json');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runTauriSigner(password) {
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(
    npmCommand,
    ['--prefix', 'copilot-ui', 'exec', '--', 'tauri', 'signer', 'generate', '--', '--ci', '-p', password],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  if (result.error) {
    throw result.error;
  }

  assert(result.status === 0, `Unable to generate CI Tauri updater signing key: ${result.stderr || result.stdout}`);
  return String(result.stdout || '');
}

function extractKey(output, label, nextLabel) {
  const pattern = new RegExp(`${label}:\\s*\\([^)]*\\)\\s*\\r?\\n([A-Za-z0-9+/=]+)\\s*\\r?\\n\\s*${nextLabel}:`, 'm');
  const match = output.match(pattern);
  assert(match && match[1], `Unable to parse ${label.toLowerCase()} key from Tauri signer output.`);
  return match[1].trim();
}

function extractPublicKey(output) {
  const match = output.match(/Public:\s*\r?\n([A-Za-z0-9+/=]+)\s*(?:\r?\n|$)/m);
  assert(match && match[1], 'Unable to parse public key from Tauri signer output.');
  return match[1].trim();
}

function patchTauriPublicKey(publicKey) {
  const config = JSON.parse(fs.readFileSync(tauriConfigPath, 'utf8'));
  assert(config.plugins && config.plugins.updater, `Missing Tauri updater config in ${tauriConfigPath}.`);
  config.plugins.updater.pubkey = publicKey;
  fs.writeFileSync(tauriConfigPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

function appendGithubEnv(privateKey, password) {
  const githubEnv = process.env.GITHUB_ENV;
  if (!githubEnv) {
    console.log('[ci-tauri-signing] GITHUB_ENV is not set; generated and patched local CI updater key only.');
    return;
  }

  const delimiter = `TAURI_KEY_${crypto.randomBytes(8).toString('hex')}`;
  const payload = [
    `TAURI_SIGNING_PRIVATE_KEY<<${delimiter}`,
    privateKey,
    delimiter,
    `TAURI_SIGNING_PRIVATE_KEY_PASSWORD=${password}`,
    '',
  ].join('\n');
  fs.appendFileSync(githubEnv, payload, 'utf8');
}

function main() {
  const password = crypto.randomBytes(24).toString('base64url');
  const output = runTauriSigner(password);
  const privateKey = extractKey(output, 'Private', 'Public');
  const publicKey = extractPublicKey(output);

  patchTauriPublicKey(publicKey);
  appendGithubEnv(privateKey, password);
  console.log('[ci-tauri-signing] Prepared ephemeral Tauri updater signing key for CI validation artifacts.');
}

main();
