'use strict';

const fs = require('node:fs');
const path = require('node:path');

const resourceDir = path.resolve(__dirname, '..', 'copilot-ui', 'src-tauri', 'gen', 'resources');

fs.mkdirSync(resourceDir, { recursive: true });
console.log(`Prepared Tauri resource directory: ${resourceDir}`);
