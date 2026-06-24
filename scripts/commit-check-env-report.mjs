#!/usr/bin/env node

import { discover } from './commit-check-discover.mjs';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SECTION_SYMBOLS = {
  pass: '✅',
  warn: '⚠️',
  fail: '❌',
  info: 'ℹ️',
};

function heading(text, level = 1) {
  const prefix = level === 1 ? '\n═══' : level === 2 ? '\n───' : '\n ·';
  console.log(`${prefix} ${text}`);
}

function line(symbol, text, detail = '') {
  const sym = SECTION_SYMBOLS[symbol] || '  ';
  console.log(`  ${sym} ${text}${detail ? `  (${detail})` : ''}`);
}

function runCargoCheckProbe() {
  // Create a minimal temp project to verify cargo + linker work
  const tmpDir = path.join(os.tmpdir(), '.commit-check-probe-' + Date.now());
  try {
    fs.mkdirSync(tmpDir, { recursive: true });
    const cargoToml = path.join(tmpDir, 'Cargo.toml');
    const mainRs = path.join(tmpDir, 'src');
    fs.mkdirSync(mainRs, { recursive: true });
    fs.writeFileSync(cargoToml, '[package]\nname = "commit-check-probe"\nversion = "0.0.0"\nedition = "2021"\n');
    fs.writeFileSync(path.join(mainRs, 'main.rs'), 'fn main() {}\n');

    const result = spawnSync('cargo', ['check', '--manifest-path', cargoToml], {
      cwd: tmpDir,
      stdio: 'pipe',
      encoding: 'utf8',
      timeout: 60000,
      shell: true,
    });

    return {
      success: result.status === 0,
      exitCode: result.status,
      error: result.status !== 0 ? (result.stderr || result.stdout || '').slice(0, 500) : null,
    };
  } catch (err) {
    return { success: false, exitCode: -1, error: err.message };
  } finally {
    // Cleanup temp dir
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

function runReport(repoRoot, options = {}) {
  const { json } = options;
  const discovery = discover(repoRoot);

  const sections = [];

  // Section 1: Environment
  const envSection = {
    title: 'Environment',
    items: [],
  };
  const env = discovery.environment || {};
  envSection.items.push({ type: 'info', text: `OS: ${env.os || process.platform}` });
  if (env.node) {
    const status = env.node.found && env.node.major >= 18 ? 'pass' : 'fail';
    envSection.items.push({ type: status, text: `Node.js: ${env.node.version || 'not found'}`, detail: env.node.found ? '' : 'required >=18' });
  }
  if (env.git) {
    const status = env.git.found ? 'pass' : 'fail';
    envSection.items.push({ type: status, text: `Git: ${env.git.version || 'not found'}` });
  }
  sections.push(envSection);

  // Section 2: Languages
  const langSection = {
    title: 'Detected Languages',
    items: [],
  };
  const languages = discovery.languages || [];
  if (languages.length === 0) {
    langSection.items.push({ type: 'warn', text: 'No supported languages detected' });
  } else {
    for (const lang of languages) {
      langSection.items.push({ type: 'info', text: lang });
    }
  }
  sections.push(langSection);

  // Section 3: Tool Availability
  const toolSection = {
    title: 'Tool Availability',
    items: [],
  };

  // Cargo health probe (full check including linker)
  if (env.cargo && env.cargo.found) {
    const cargoProbe = runCargoCheckProbe();
    if (cargoProbe.success) {
      toolSection.items.push({ type: 'pass', text: 'Cargo + linker: ready', detail: env.cargo.version });
    } else {
      toolSection.items.push({ type: 'fail', text: 'Cargo found but linker check failed', detail: cargoProbe.error?.slice(0, 100) || `exit ${cargoProbe.exitCode}` });
    }
  } else if (languages.includes('rust')) {
    toolSection.items.push({ type: 'fail', text: 'Cargo not found — Rust checks will fail' });
  }

  // gh CLI
  if (env.gh) {
    toolSection.items.push({ type: env.gh.found ? 'pass' : 'warn', text: `gh CLI: ${env.gh.version || 'not found'}`, detail: env.gh.found ? '' : 'git PR checks will fail' });
  }

  sections.push(toolSection);

  // Section 4: Discovered Lanes
  const laneSection = {
    title: 'Discovered Lanes',
    items: [],
  };
  const lanes = discovery.lanes || {};
  const laneNames = Object.keys(lanes).sort();
  if (laneNames.length === 0) {
    laneSection.items.push({ type: 'warn', text: 'No lanes discovered' });
  } else {
    for (const name of laneNames) {
      const lane = lanes[name];
      if (lane.found) {
        const cmdPreview = (lane.commands || []).slice(0, 2).join(', ') + (lane.commands?.length > 2 ? ` (+${lane.commands.length - 2} more)` : '');
        laneSection.items.push({ type: 'pass', text: `${name}: ${cmdPreview}`, detail: lane.source || '' });
      } else {
        const note = lane.note || 'not found';
        laneSection.items.push({ type: 'warn', text: `${name}: ${note}`, detail: lane.source || '' });
      }
    }
  }
  sections.push(laneSection);

  // Section 5: Unmet Requirements
  const unmetSection = {
    title: 'Unmet Requirements',
    items: [],
  };
  const unmet = discovery.UNMET_REQUIREMENTS || [];
  if (unmet.length === 0) {
    unmetSection.items.push({ type: 'pass', text: 'All requirements met' });
  } else {
    for (const req of unmet) {
      unmetSection.items.push({ type: 'fail', text: `${req.tool}: ${req.detail}` });
      unmetSection.items.push({ type: 'info', text: `  → ${req.remediation}` });
    }
  }
  sections.push(unmetSection);

  // Section 6: Next Steps
  const nextSection = {
    title: 'Recommended Next Steps',
    items: [],
  };
  if (unmet.length > 0) {
    nextSection.items.push({ type: 'info', text: '1. Resolve unmet requirements above' });
  }
  if (laneNames.length > 0) {
    nextSection.items.push({ type: 'info', text: `${unmet.length > 0 ? '2' : '1'}. Run: node scripts/commit-check-setup.mjs` });
    nextSection.items.push({ type: 'info', text: `${unmet.length > 0 ? '3' : '2'}. Run: node scripts/commit-check-run.mjs --profile commit` });
  } else {
    nextSection.items.push({ type: 'warn', text: 'No lanes discovered — review project structure' });
  }
  sections.push(nextSection);

  // Output
  const hasUnmet = unmet.length > 0;

  if (json) {
    const output = {
      timestamp: new Date().toISOString(),
      repoRoot,
      environment: env,
      languages,
      tools: toolSection.items,
      lanes: laneNames.map(name => ({ name, ...discovery.lanes[name] })),
      unmetRequirements: unmet,
      ready: !hasUnmet,
    };
    process.stdout.write(JSON.stringify(output, null, 2) + '\n');
    return output;
  }

  // Text output
  console.log(`\nCommit Check Environment Report — ${repoRoot}`);
  console.log(`Generated: ${new Date().toISOString()}`);
  console.log(`Overall: ${hasUnmet ? 'NOT READY' : 'READY'}`);
  if (hasUnmet) console.log(`${unmet.length} requirement(s) unmet`);

  for (const section of sections) {
    heading(section.title, 2);
    for (const item of section.items) {
      line(item.type, item.text, item.detail);
    }
  }

  return { ready: !hasUnmet, sections };
}

function main() {
  const args = process.argv.slice(2);
  const useJson = args.includes('--json');
  const repoRoot = args.find(a => !a.startsWith('--')) || process.cwd();

  try {
    const result = runReport(repoRoot, { json: useJson });
    const exitCode = result.ready ? 0 : 1;
    process.exit(exitCode);
  } catch (err) {
    console.error(`env-report failed: ${err.message}`);
    process.exit(2);
  }
}

if (process.argv[1]?.endsWith('commit-check-env-report.mjs')) {
  main();
}

export { runReport };
