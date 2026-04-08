#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_TARGETS = ['copilot-ui'];
const IGNORED_DIRECTORIES = new Set([
'.git',
'node_modules',
'.next',
'.tmp',
'dist',
'build',
 'coverage',
 'ui-dist',
]);
const CODE_FILE_EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx', '.json']);

function shouldIgnoreDirectory(name) {
return IGNORED_DIRECTORIES.has(name.toLowerCase());
}

function readText(filePath) {
try {
return fs.readFileSync(filePath, 'utf8');
} catch {
return '';
}
}

function detectVueSignals(filePath, content) {
const violations = [];

if (filePath.toLowerCase().endsWith('.vue')) {
violations.push('vue_file');
}

if (!content) {
return violations;
}

const checks = [
{ kind: 'vue_import', pattern: /\bimport\s+[^;]*\s+from\s+['"]vue['"]/ },
{ kind: 'vue_import', pattern: /\bimport\s*['"]vue['"]/ },
{ kind: 'vue_require', pattern: /\brequire\(\s*['"]vue['"]\s*\)/ },
{ kind: 'vue_sfc_import', pattern: /\bfrom\s+['"][^'"]+\.vue['"]/ },
{ kind: 'vue_sfc_require', pattern: /\brequire\(\s*['"][^'"]+\.vue['"]\s*\)/ },
{ kind: 'vue_dependency', pattern: /"(?:dependencies|devDependencies|peerDependencies)"\s*:\s*\{[\s\S]*?"vue"\s*:/ },
];

for (const check of checks) {
if (check.pattern.test(content)) {
violations.push(check.kind);
}
}

return violations;
}

function collectFiles(rootDir, files = []) {
if (!fs.existsSync(rootDir)) {
return files;
}

const entries = fs.readdirSync(rootDir, { withFileTypes: true });
for (const entry of entries) {
const absolutePath = path.join(rootDir, entry.name);

if (entry.isDirectory()) {
if (shouldIgnoreDirectory(entry.name)) {
continue;
}
collectFiles(absolutePath, files);
continue;
}

const ext = path.extname(entry.name).toLowerCase();
if (!CODE_FILE_EXTENSIONS.has(ext) && ext !== '.vue') {
continue;
}

files.push(absolutePath);
}

return files;
}

function scanForVueUsage(workspaceRoot, targets = DEFAULT_TARGETS) {
const normalizedTargets = targets.length > 0 ? targets : DEFAULT_TARGETS;
const violations = [];

for (const target of normalizedTargets) {
const targetPath = path.resolve(workspaceRoot, target);
const files = collectFiles(targetPath);

for (const filePath of files) {
const content = readText(filePath);
const signals = detectVueSignals(filePath, content);
if (signals.length === 0) {
continue;
}

violations.push({
filePath,
signals,
});
}
}

return violations;
}

function formatViolation(violation, workspaceRoot) {
const relativePath = path.relative(workspaceRoot, violation.filePath).replace(/\\/g, '/');
return `- ${relativePath}: ${violation.signals.join(', ')}`;
}

function run(argv = process.argv.slice(2)) {
const workspaceRoot = path.resolve(__dirname, '..');
const targets = argv.filter((entry) => entry && !entry.startsWith('-'));

const violations = scanForVueUsage(workspaceRoot, targets);
if (violations.length > 0) {
console.error('Vue-free guard failed. Detected Vue usage in restricted paths:');
for (const violation of violations) {
console.error(formatViolation(violation, workspaceRoot));
}
return 1;
}

const targetLabel = (targets.length > 0 ? targets : DEFAULT_TARGETS).join(', ');
console.log(`Vue-free guard passed for: ${targetLabel}`);
return 0;
}

if (require.main === module) {
process.exitCode = run();
}

module.exports = {
scanForVueUsage,
run,
_internal: {
detectVueSignals,
collectFiles,
},
};
