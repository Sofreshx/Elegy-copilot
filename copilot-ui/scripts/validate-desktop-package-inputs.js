const fs = require('fs');
const path = require('path');

const workspaceRoot = path.resolve(__dirname, '..');

const requiredPaths = [
  {
    label: 'built React UI entrypoint',
    filePath: path.join(workspaceRoot, 'ui-dist', 'index.html'),
  },
  {
    label: 'built Electron main bundle',
    filePath: path.join(workspaceRoot, 'dist-electron', 'main.js'),
  },
  {
    label: 'built local-tracker runtime',
    filePath: path.join(workspaceRoot, '..', 'local-tracker', 'dist', 'index.js'),
  },
  {
    label: 'built local-tracker messaging gateway runtime',
    filePath: path.join(workspaceRoot, '..', 'local-tracker', 'dist', 'messagingGateway', 'index.js'),
  },
  {
    label: 'embedded desktop planning persistence entrypoint',
    filePath: path.join(workspaceRoot, 'node_modules', '@electric-sql', 'pglite', 'dist', 'index.cjs'),
  },
  {
    label: 'embedded desktop planning persistence wasm payload',
    filePath: path.join(workspaceRoot, 'node_modules', '@electric-sql', 'pglite', 'dist', 'pglite.wasm'),
  },
  {
    label: 'embedded desktop planning persistence data payload',
    filePath: path.join(workspaceRoot, 'node_modules', '@electric-sql', 'pglite', 'dist', 'pglite.data'),
  },
  {
    label: 'embedded desktop planning initdb runtime',
    filePath: path.join(workspaceRoot, 'node_modules', '@electric-sql', 'pglite', 'dist', 'initdb.wasm'),
  },
];

const missing = requiredPaths.filter(({ filePath }) => !fs.existsSync(filePath));

if (missing.length > 0) {
  console.error('Desktop packaging input validation failed. Missing required build output(s):');
  for (const entry of missing) {
    console.error(`- ${entry.label}: ${entry.filePath}`);
  }
  process.exit(1);
}

console.log(`[desktop-package] validated ${requiredPaths.length} required packaged runtime input(s).`);
