'use strict';

const fs = require('fs');
const path = require('path');
const { resolveCommitCheckConfig } = require('./commitCheckConfig');

/**
 * Parse job names from a GitHub Actions YAML content (line-based, no external parser).
 * Scans the `jobs:` section for two-space-indented job names.
 *
 * @param {string} yamlContent
 * @returns {string[]} Array of job name strings
 */
function parseWorkflowJobs(yamlContent) {
  const jobs = [];
  const lines = yamlContent.split('\n');
  let inJobs = false;

  for (const line of lines) {
    if (!inJobs) {
      if (/^jobs:\s*$/.test(line)) {
        inJobs = true;
      }
      continue;
    }

    // Exit on non-indented, non-empty, non-comment line
    if (line.length > 0 && !line.startsWith(' ') && !line.startsWith('#') && line.trim() !== '') {
      break;
    }

    const match = line.match(/^  ([a-zA-Z][a-zA-Z0-9_-]*):\s*$/);
    if (match) {
      jobs.push(match[1]);
    }
  }

  return jobs;
}

/**
 * Parse jobs section with `needs` metadata for gate detection.
 * Returns richer job objects than parseWorkflowJobs.
 *
 * @param {string} yamlContent
 * @returns {Array<{name: string, needs: string[]}>}
 */
function parseJobsWithNeeds(yamlContent) {
  const jobs = [];
  const lines = yamlContent.split('\n');
  let inJobs = false;
  let currentJob = null;
  let inNeeds = false;

  for (const line of lines) {
    if (!inJobs) {
      if (/^jobs:\s*$/.test(line)) {
        inJobs = true;
      }
      continue;
    }

    // Exit on non-indented, non-empty, non-comment line
    if (line.length > 0 && !line.startsWith(' ') && !line.startsWith('#') && line.trim() !== '') {
      break;
    }

    const jobMatch = line.match(/^  ([a-zA-Z][a-zA-Z0-9_-]*):\s*$/);
    if (jobMatch) {
      if (currentJob) jobs.push(currentJob);
      currentJob = { name: jobMatch[1], needs: [] };
      inNeeds = false;
      continue;
    }

    if (currentJob) {
      // Check for needs: line (inline array or block start)
      if (/^    needs:/.test(line)) {
        inNeeds = true;
        // Inline array: needs: [a, b, c]
        const inlineMatch = line.match(/^    needs:\s*\[([^\]]*)\]/);
        if (inlineMatch) {
          currentJob.needs = inlineMatch[1]
            .split(',')
            .map((s) => s.trim().replace(/['"]/g, ''))
            .filter(Boolean);
          inNeeds = false;
        }
        // If it's just "needs:" alone on the line, fall through to catch items below
        continue;
      }

      // Multi-line needs items (YAML array under needs:)
      if (inNeeds && /^      - /.test(line)) {
        const itemMatch = line.match(/^      - ['"]?([a-zA-Z][a-zA-Z0-9_-]*)['"]?\s*$/);
        if (itemMatch) {
          currentJob.needs.push(itemMatch[1]);
        }
        continue;
      }

      // Exit needs section when we hit a different key at same indent
      if (inNeeds && line.startsWith('    ') && !line.startsWith('      ') && line.trim() !== '') {
        inNeeds = false;
      }
    }
  }

  if (currentJob) jobs.push(currentJob);
  return jobs;
}

/**
 * Detect trigger types from GitHub Actions YAML content.
 * Checks for push, pull_request, schedule, workflow_dispatch, and tag triggers.
 *
 * @param {string} content
 * @returns {string[]} Array of trigger type strings
 */
function detectTriggers(content) {
  const triggers = [];

  if (/^\s+push:/m.test(content)) triggers.push('push');
  if (/^\s+pull_request:/m.test(content)) triggers.push('pull_request');
  if (/^\s+schedule:/m.test(content)) triggers.push('schedule');
  if (/^\s+workflow_dispatch:/m.test(content)) triggers.push('workflow_dispatch');

  // Tag trigger: push section that also declares tags:
  if (/^\s+push:[\s\S]*?^\s+tags:/m.test(content)) triggers.push('tag');

  return triggers;
}

/**
 * Extract workflow name from YAML content.
 *
 * @param {string} content
 * @returns {string}
 */
function extractWorkflowName(content) {
  const match = content.match(/^name:\s*(.+?)\s*$/m);
  return match ? match[1].trim() : 'unnamed';
}

/**
 * Discover CI workflows from .github/workflows directory.
 * Scans all .yml/.yaml files, parses name, triggers, PR-relevance, and jobs.
 *
 * Job required status:
 * - Only meaningful for PR-relevant workflows
 * - If a `required-checks` gate job exists, jobs in its `needs` list are required
 * - If no gate job exists, all jobs in a PR-relevant workflow are required
 * - Non-PR-relevant workflow jobs are never required
 *
 * @param {string} repoRoot
 * @returns {{ workflows: Array<{name: string, fileName: string, triggers: string[], isPrRelevant: boolean, jobs: Array<{name: string, required: boolean}>}>, unknown: Array<{fileName: string, error: string}> }}
 */
function discoverCiWorkflows(repoRoot) {
  const workflowsDir = path.join(repoRoot, '.github', 'workflows');
  const result = { workflows: [], unknown: [] };

  if (!fs.existsSync(workflowsDir)) {
    return result;
  }

  let files;
  try {
    files = fs.readdirSync(workflowsDir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
  } catch {
    return result;
  }

  for (const fileName of files) {
    const filePath = path.join(workflowsDir, fileName);
    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      result.unknown.push({ fileName, error: `Failed to read: ${err.message}` });
      continue;
    }

    const name = extractWorkflowName(content);
    const triggers = detectTriggers(content);
    const isPrRelevant = triggers.includes('pull_request');

    // Parse jobs with needs metadata
    const richJobs = parseJobsWithNeeds(content);

    // Find required-checks gate job and its needs
    const gateJob = richJobs.find((j) => j.name === 'required-checks');
    const gateNeeds = gateJob ? gateJob.needs : [];
    const hasGate = !!gateJob;

    // Build job list with required status
    const jobs = richJobs.map((j) => ({
      name: j.name,
      required: isPrRelevant && (hasGate ? gateNeeds.includes(j.name) : true),
    }));

    result.workflows.push({ name, fileName, triggers, isPrRelevant, jobs });
  }

  return result;
}

/**
 * Map CI workflow jobs (from PR-relevant workflows) to local commit-check lanes.
 * A lane matches if lane.ciWorkflow === workflow.fileName && lane.ciJob === job.name.
 *
 * @param {{ workflows: Array }} ciWorkflows - result from discoverCiWorkflows
 * @param {Object|null} commitCheckConfig - parsed commit-checks.json
 * @returns {{ mappings: Array<{workflowFile: string, jobName: string, required: boolean, localLane: string|null, status: string}>, summary: {totalCiJobs: number, mapped: number, remoteOnly: number, gaps: number, readiness: string} }}
 */
function mapCiToLocal(ciWorkflows, commitCheckConfig) {
  // Collect real (non-gate) jobs from PR-relevant workflows
  // Gate jobs (required-checks, etc.) enforce other jobs — they don't need local equivalents
  const GATE_JOB_PATTERNS = [/^required-checks?$/i, /^gate$/i, /^enforce$/i];
  function isGateJob(jobName) {
    return GATE_JOB_PATTERNS.some((p) => p.test(jobName));
  }

  const prRelevantJobs = [];
  for (const wf of ciWorkflows.workflows) {
    if (wf.isPrRelevant) {
      for (const job of wf.jobs) {
        if (!isGateJob(job.name)) {
          prRelevantJobs.push({ workflowFile: wf.fileName, jobName: job.name, required: job.required });
        }
      }
    }
  }

  const lanes = (commitCheckConfig && commitCheckConfig.lanes) ? commitCheckConfig.lanes : {};
  const remoteOnlyJobs = new Map();
  for (const entry of Array.isArray(commitCheckConfig?.ciRemoteOnly) ? commitCheckConfig.ciRemoteOnly : []) {
    const workflowFile = String(entry?.workflow || entry?.workflowFile || '').trim();
    const jobName = String(entry?.job || entry?.jobName || '').trim();
    if (workflowFile && jobName) {
      remoteOnlyJobs.set(`${workflowFile}/${jobName}`, entry);
    }
  }

  const mappings = prRelevantJobs.map((ciJob) => {
    // Find ALL matching lanes by ciWorkflow + ciJob (multiple lanes can map to one CI job)
    const matchingLanes = [];
    for (const [laneName, laneConfig] of Object.entries(lanes)) {
      if (laneConfig.ciWorkflow === ciJob.workflowFile && laneConfig.ciJob === ciJob.jobName) {
        matchingLanes.push(laneName);
      }
    }
    const remoteOnly = remoteOnlyJobs.get(`${ciJob.workflowFile}/${ciJob.jobName}`);

    return {
      workflowFile: ciJob.workflowFile,
      jobName: ciJob.jobName,
      required: ciJob.required,
      localLanes: matchingLanes,
      status: matchingLanes.length > 0 ? 'mapped' : remoteOnly ? 'remote-only' : 'ci-gap',
      remoteOnlyReason: remoteOnly?.reason || null,
    };
  });

  const totalCiJobs = mappings.length;
  const mapped = mappings.filter((m) => m.status === 'mapped').length;
  const remoteOnly = mappings.filter((m) => m.status === 'remote-only').length;
  const gaps = mappings.filter((m) => m.status === 'ci-gap').length;

  let readiness = 'no-ci';
  if (totalCiJobs > 0 && gaps === 0) readiness = 'ready';
  else if (totalCiJobs > 0 && gaps > 0) readiness = 'ci-gap';

  return {
    mappings,
    summary: { totalCiJobs, mapped, remoteOnly, gaps, readiness },
  };
}



/**
 * Convenience function: resolve commit-check config, discover workflows, map to local.
 *
 * @param {string} repoRoot
 * @returns {{ repoRoot: string, config: ({laneCount: number, gateCount: number}|null), ciWorkflows: Object, syncResult: Object }}
 */
function syncCiState(repoRoot) {
  const config = resolveCommitCheckConfig(repoRoot);
  const ciWorkflows = discoverCiWorkflows(repoRoot);
  const syncResult = mapCiToLocal(ciWorkflows, config);

  return {
    repoRoot,
    config: config
      ? { laneCount: Object.keys(config.lanes).length, gateCount: (config.gates || []).length }
      : null,
    ciWorkflows,
    syncResult,
  };
}

module.exports = {
  discoverCiWorkflows,
  parseWorkflowJobs,
  mapCiToLocal,
  syncCiState,
};
