#!/usr/bin/env node

import path from 'path';
import { fileURLToPath } from 'url';

import {
  listCompatibilityManifestIds,
  writeCompatibilityManifests,
} from './catalogManifestLib.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const manifestIds = listCompatibilityManifestIds().filter((manifestId) => manifestId !== 'cli');
const results = writeCompatibilityManifests(manifestIds, { repoRoot });

for (const result of results) {
  console.log(`Wrote ${path.relative(repoRoot, result.outputPath)} (${result.manifest.assets.length} assets)`);
}
