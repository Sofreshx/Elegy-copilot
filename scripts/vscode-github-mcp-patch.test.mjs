#!/usr/bin/env node

import assert from 'assert';
import childProcess from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const scriptPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'vscode-github-mcp-patch.mjs');

let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  PASS: ${name}`);
  } catch (error) {
    console.error(`  FAIL: ${name}`);
    console.error(`    ${error.message}`);
    process.exitCode = 1;
  }
}

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-github-mcp-patch-'));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function runPatch({ workspaceRoot, mcpPath }) {
  const args = [scriptPath];
  if (workspaceRoot) {
    args.push('--workspace-root', workspaceRoot);
  }
  if (mcpPath) {
    args.push('--mcp', mcpPath);
  }
  const stdout = childProcess.execFileSync(process.execPath, args, {
    encoding: 'utf8',
    stdio: 'pipe',
  });
  return JSON.parse(stdout);
}

test('patcher adds a GitHub MCP entry without disturbing existing servers', () => {
  withTempDir((root) => {
    const mcpPath = path.join(root, '.vscode', 'mcp.json');
    fs.mkdirSync(path.dirname(mcpPath), { recursive: true });
    fs.writeFileSync(
      mcpPath,
      `${JSON.stringify({
        mcpServers: {
          supabase: {
            url: 'https://mcp.supabase.com/mcp',
          },
        },
      }, null, 2)}\n`,
      'utf8',
    );

    const result = runPatch({ mcpPath });
    const patched = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));

    assert.strictEqual(result.changed, true);
    assert.ok(patched.mcpServers.supabase);
    assert.deepStrictEqual(patched.mcpServers.github, {
      type: 'http',
      url: 'https://api.githubcopilot.com/mcp/',
      headers: {
        Authorization: 'Bearer ${env:GITHUB_MCP_PAT}',
      },
    });
  });
});

test('patcher is idempotent after the GitHub MCP entry is present', () => {
  withTempDir((root) => {
    const resultPath = path.join(root, '.vscode', 'mcp.json');

    const first = runPatch({ mcpPath: resultPath });
    const initial = fs.readFileSync(resultPath, 'utf8');
    const second = runPatch({ mcpPath: resultPath });
    const final = fs.readFileSync(resultPath, 'utf8');

    assert.strictEqual(first.changed, true);
    assert.strictEqual(second.changed, false);
    assert.strictEqual(final, initial);
  });
});

test('patcher creates the workspace MCP file when it is missing', () => {
  withTempDir((root) => {
    const result = runPatch({ workspaceRoot: root });
    const mcpPath = path.join(root, '.vscode', 'mcp.json');
    const patched = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));

    assert.strictEqual(result.createdFile, true);
    assert.strictEqual(result.mcpPath, mcpPath);
    assert.ok(patched.mcpServers.github);
  });
});

console.log(`\n${passed} tests passed`);
if (process.exitCode) {
  console.error('Some tests FAILED');
} else {
  console.log('All tests passed');
}
