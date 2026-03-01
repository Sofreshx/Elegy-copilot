const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { scanForVueUsage } = require('./vue-free-guard');

function withTempDir(fn) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vue-guard-'));
  try {
    fn(tempDir);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function writeFile(baseDir, relativePath, content) {
  const absolutePath = path.join(baseDir, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content, 'utf8');
}

(function run() {
  withTempDir((workspaceRoot) => {
    writeFile(workspaceRoot, 'copilot-ui/ui/src/App.tsx', "import React from 'react';\nexport default function App(){ return null; }\n");

    const violations = scanForVueUsage(workspaceRoot, ['copilot-ui']);
    assert.equal(violations.length, 0, 'expected no violations for vue-free sources');
  });

  withTempDir((workspaceRoot) => {
    writeFile(workspaceRoot, 'copilot-ui/ui/src/components/Hello.vue', '<template><div>Hello</div></template>');

    const violations = scanForVueUsage(workspaceRoot, ['copilot-ui']);
    assert.equal(violations.length, 1, 'expected .vue file to be flagged');
    assert.ok(violations[0].signals.includes('vue_file'));
  });

  withTempDir((workspaceRoot) => {
    writeFile(workspaceRoot, 'copilot-ui/ui/src/main.ts', "import { createApp } from 'vue';\n");

    const violations = scanForVueUsage(workspaceRoot, ['copilot-ui']);
    assert.equal(violations.length, 1, 'expected vue import to be flagged');
    assert.ok(violations[0].signals.includes('vue_import'));
  });

  withTempDir((workspaceRoot) => {
    writeFile(workspaceRoot, 'copilot-ui/ui/src/main.ts', "const v = require('vue');\n");

    const violations = scanForVueUsage(workspaceRoot, ['copilot-ui']);
    assert.equal(violations.length, 1, 'expected vue require to be flagged');
    assert.ok(violations[0].signals.includes('vue_require'));
  });

  withTempDir((workspaceRoot) => {
    writeFile(workspaceRoot, 'copilot-ui/node_modules/demo/index.js', "import { createApp } from 'vue';\n");

    const violations = scanForVueUsage(workspaceRoot, ['copilot-ui']);
    assert.equal(violations.length, 0, 'expected node_modules to be ignored');
  });

  console.log('vue-free-guard tests passed');
})();
