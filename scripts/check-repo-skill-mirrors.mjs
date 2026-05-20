#!/usr/bin/env node

import path from 'path';
import { fileURLToPath } from 'url';
import {
  buildUsage,
  gateName,
  logCheckFailures,
  logSummary,
  parseMirrorActionArgs,
  runRepoSkillMirrors,
} from './repo-skill-mirror-lib.mjs';

const __filename = fileURLToPath(import.meta.url);

export function runCheckRepoSkillMirrors(options = {}) {
  return runRepoSkillMirrors({
    ...options,
    mode: 'check',
  });
}

function main() {
  const args = parseMirrorActionArgs(process.argv.slice(2), { allowDryRun: false });
  if (args.help) {
    console.log(buildUsage(
      'check-repo-skill-mirrors.mjs',
      'Verify generated repo-local skill mirrors against the canonical .github/skills source.',
      { allowDryRun: false }
    ));
    return;
  }

  const summary = runCheckRepoSkillMirrors(args);
  logSummary(summary);
  if (!summary.ok) {
    logCheckFailures(summary);
    process.exitCode = 1;
    return;
  }

  console.log(`${gateName} ok`);
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
