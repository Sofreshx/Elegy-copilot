#!/usr/bin/env node

import path from 'path';
import { fileURLToPath } from 'url';
import {
  buildUsage,
  gateName,
  logInstallWarnings,
  logSummary,
  parseMirrorActionArgs,
  runRepoSkillMirrors,
} from './repo-skill-mirror-lib.mjs';

const __filename = fileURLToPath(import.meta.url);

export function runInstallRepoSkillMirrors(options = {}) {
  return runRepoSkillMirrors({
    ...options,
    mode: 'install',
  });
}

function main() {
  const args = parseMirrorActionArgs(process.argv.slice(2));
  if (args.help) {
    console.log(buildUsage(
      'install-repo-skill-mirrors.mjs',
      'Create only missing generated repo-local skill mirrors without overwriting diverged mirrors.',
      { allowDryRun: true }
    ));
    return;
  }

  const summary = runInstallRepoSkillMirrors(args);
  logSummary(summary);
  logInstallWarnings(summary);
  console.log(`${gateName}: created=${summary.counts.created} skipped=${summary.counts.skipped} conflicts=${summary.counts.skippedConflict} unexpected=${summary.counts.unexpectedMirrors} dryRunCreate=${summary.counts.wouldCreate}`);
}

const isEntrypoint = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isEntrypoint) {
  try {
    main();
  } catch (error) {
    console.error(`${gateName} failed: ${error.message || String(error)}`);
    process.exit(1);
  }
}
