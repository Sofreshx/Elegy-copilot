#!/usr/bin/env node

import path from 'path';
import { fileURLToPath } from 'url';
import {
  buildUsage,
  gateName,
  logSummary,
  parseMirrorActionArgs,
  runRepoSkillMirrors,
} from './repo-skill-mirror-lib.mjs';

const __filename = fileURLToPath(import.meta.url);

export function runUpdateRepoSkillMirrors(options = {}) {
  return runRepoSkillMirrors({
    ...options,
    mode: 'update',
  });
}

function main() {
  const args = parseMirrorActionArgs(process.argv.slice(2));
  if (args.help) {
    console.log(buildUsage(
      'update-repo-skill-mirrors.mjs',
      'Reconcile generated repo-local skill mirrors by creating missing mirrors, overwriting stale mirrors, and pruning unexpected mirrors.',
      { allowDryRun: true }
    ));
    return;
  }

  const summary = runUpdateRepoSkillMirrors(args);
  logSummary(summary);
  console.log(`${gateName}: created=${summary.counts.created} updated=${summary.counts.updated} skipped=${summary.counts.skipped} pruned=${summary.counts.pruned} dryRunCreate=${summary.counts.wouldCreate} dryRunUpdate=${summary.counts.wouldUpdate} dryRunPrune=${summary.counts.wouldPrune}`);
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
