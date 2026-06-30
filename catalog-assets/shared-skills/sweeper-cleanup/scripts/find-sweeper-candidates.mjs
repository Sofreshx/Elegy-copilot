#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = process.cwd();

const EXCLUDED_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.cache',
  '.vitepress',
  'target',
  '.next',
  '.turbo',
]);

const SEARCH_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.jsx',
  '.ts',
  '.tsx',
  '.json',
  '.md',
  '.toml',
  '.yaml',
  '.yml',
  '.rs',
  '.ps1',
  '.sh',
]);

const PACKAGE_METADATA_FILES = new Set([
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
]);

function parseArgs(argv) {
  const args = {
    repoRoot: defaultRepoRoot,
    format: 'json',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--help' || value === '-h') {
      args.help = true;
      continue;
    }
    if (value === '--repo-root') {
      index += 1;
      if (index >= argv.length) throw new Error('Missing value for --repo-root');
      args.repoRoot = argv[index];
      continue;
    }
    if (value.startsWith('--repo-root=')) {
      args.repoRoot = value.slice('--repo-root='.length);
      continue;
    }
    if (value === '--format') {
      index += 1;
      if (index >= argv.length) throw new Error('Missing value for --format');
      args.format = argv[index];
      continue;
    }
    if (value.startsWith('--format=')) {
      args.format = value.slice('--format='.length);
      continue;
    }
    throw new Error(`Unknown argument: ${value}`);
  }

  if (!['json', 'markdown'].includes(args.format)) {
    throw new Error('--format must be json or markdown');
  }

  return {
    ...args,
    repoRoot: path.resolve(args.repoRoot),
  };
}

function toPosix(filePath) {
  return String(filePath || '').replace(/\\/g, '/');
}

function rel(repoRoot, filePath) {
  return toPosix(path.relative(repoRoot, filePath));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function walkFiles(rootDir) {
  const files = [];

  function walk(current) {
    if (!fs.existsSync(current)) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRS.has(entry.name)) {
          walk(path.join(current, entry.name));
        }
        continue;
      }
      if (!entry.isFile()) continue;
      const abs = path.join(current, entry.name);
      if (SEARCH_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        files.push(abs);
      }
    }
  }

  walk(rootDir);
  return files;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function dependencySearchTokens(packageName) {
  const tokens = new Set([packageName]);
  if (packageName.startsWith('@')) {
    const parts = packageName.split('/');
    if (parts[1]) tokens.add(parts[1]);
  }
  return [...tokens];
}

function findUnusedDependencies(repoRoot, files) {
  const packagePath = path.join(repoRoot, 'package.json');
  if (!fs.existsSync(packagePath)) return [];

  const packageJson = readJson(packagePath);
  const dependencyEntries = [
    ...Object.keys(packageJson.dependencies || {}).map((name) => ({ name, bucket: 'dependencies' })),
    ...Object.keys(packageJson.devDependencies || {}).map((name) => ({ name, bucket: 'devDependencies' })),
    ...Object.keys(packageJson.optionalDependencies || {}).map((name) => ({ name, bucket: 'optionalDependencies' })),
  ];

  const searchableFiles = files.filter((filePath) => !PACKAGE_METADATA_FILES.has(path.basename(filePath)));
  const results = [];

  for (const dependency of dependencyEntries) {
    const tokens = dependencySearchTokens(dependency.name);
    const hits = [];
    for (const filePath of searchableFiles) {
      const text = fs.readFileSync(filePath, 'utf8');
      if (tokens.some((token) => new RegExp(`(^|[^A-Za-z0-9_@/-])${escapeRegExp(token)}([^A-Za-z0-9_/-]|$)`).test(text))) {
        hits.push(rel(repoRoot, filePath));
        if (hits.length >= 5) break;
      }
    }
    if (hits.length === 0) {
      results.push({
        id: `unused-dependency:${dependency.name}`,
        kind: 'unused-dependency',
        confidence: 'medium',
        path: 'package.json',
        evidence: `${dependency.bucket}.${dependency.name} has no static textual references outside package metadata.`,
      });
    }
  }

  return results;
}

function listFilesIfExists(dirPath, extension) {
  if (!fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .map((entry) => path.join(dirPath, entry.name));
}

function findUnroutedManagedAssets(repoRoot) {
  const shippedAssetsPath = path.join(repoRoot, 'catalog-assets', 'shippedAssets.mjs');
  if (!fs.existsSync(shippedAssetsPath)) return [];
  const shippedText = fs.readFileSync(shippedAssetsPath, 'utf8');
  const results = [];

  const managedFiles = [
    ...listFilesIfExists(path.join(repoRoot, 'codex-assets', 'agents'), '.toml'),
    ...listFilesIfExists(path.join(repoRoot, 'opencode-assets', 'agents'), '.md'),
  ];

  for (const filePath of managedFiles) {
    const relativePath = rel(repoRoot, filePath);
    if (!shippedText.includes(relativePath)) {
      results.push({
        id: `unrouted-managed-asset:${relativePath}`,
        kind: 'unrouted-managed-asset',
        confidence: 'high',
        path: relativePath,
        evidence: 'File exists under a managed harness asset directory but is not referenced by catalog-assets/shippedAssets.mjs.',
      });
    }
  }

  return results;
}

function findMissingManifestSources(repoRoot) {
  const manifestPaths = [
    'codex-assets/manifest.json',
    'opencode-assets/manifest.json',
    'engine-assets/manifest.json',
    'antigravity-assets/manifest.json',
  ];
  const results = [];

  for (const manifestRel of manifestPaths) {
    const manifestPath = path.join(repoRoot, manifestRel);
    if (!fs.existsSync(manifestPath)) continue;
    const manifest = readJson(manifestPath);
    for (const asset of manifest.assets || []) {
      if (!asset?.source || String(asset.source).startsWith('http')) continue;
      const sourcePath = path.join(repoRoot, asset.source);
      if (!fs.existsSync(sourcePath)) {
        results.push({
          id: `missing-manifest-source:${asset.id}`,
          kind: 'missing-manifest-source',
          confidence: 'high',
          path: manifestRel,
          evidence: `${asset.id} points to missing source ${asset.source}.`,
        });
      }
    }
  }

  return results;
}

function analyze(repoRoot) {
  const files = walkFiles(repoRoot);
  const candidates = [
    ...findUnusedDependencies(repoRoot, files),
    ...findUnroutedManagedAssets(repoRoot),
    ...findMissingManifestSources(repoRoot),
  ];

  return {
    schemaVersion: 1,
    repoRoot,
    generatedAt: new Date().toISOString(),
    summary: {
      filesScanned: files.length,
      candidates: candidates.length,
    },
    candidates,
  };
}

function renderHelp() {
  return [
    'Usage: node find-sweeper-candidates.mjs [--repo-root <path>] [--format json|markdown]',
    '',
    'Finds advisory cleanup candidates. It does not delete files.',
    '',
    'Options:',
    '  --repo-root <path>     Repository to scan. Defaults to the current working directory.',
    '  --format <format>      json or markdown. Defaults to json.',
    '  --help, -h             Show this help.',
    '',
  ].join('\n');
}

function renderMarkdown(result) {
  const lines = [
    '# Sweeper Candidates',
    '',
    `- repo: ${result.repoRoot}`,
    `- files_scanned: ${result.summary.filesScanned}`,
    `- candidates: ${result.summary.candidates}`,
    '',
  ];

  if (result.candidates.length === 0) {
    lines.push('No candidates found.');
    return `${lines.join('\n')}\n`;
  }

  for (const candidate of result.candidates) {
    lines.push(`## ${candidate.id}`);
    lines.push('');
    lines.push(`- kind: ${candidate.kind}`);
    lines.push(`- confidence: ${candidate.confidence}`);
    lines.push(`- path: ${candidate.path}`);
    lines.push(`- evidence: ${candidate.evidence}`);
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(renderHelp());
    process.exit(0);
  }
  const result = analyze(args.repoRoot);
  if (args.format === 'markdown') {
    process.stdout.write(renderMarkdown(result));
  } else {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
} catch (error) {
  console.error(error.message || String(error));
  process.exit(1);
}
