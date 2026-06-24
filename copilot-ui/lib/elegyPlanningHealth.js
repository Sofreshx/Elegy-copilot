'use strict';

/**
 * Resolve planning CLI health by running `elegy-planning health --json`.
 *
 * @param {string} cliPath - Path to the elegy-planning CLI binary
 * @param {object} childProcess - Node child_process module or compatible mock
 * @returns {{ ready: boolean, cliVersion: string|null, version: string|null, schemaVersion: string|null, error: string|null }}
 */
function resolvePlanningHealth(cliPath, childProcess) {
  const command = typeof cliPath === 'string' ? cliPath.trim() : '';
  if (!command) return { ready: false, cliVersion: null, version: null, schemaVersion: null, error: 'no cliPath' };
  if (!childProcess || typeof childProcess.spawnSync !== 'function') {
    return { ready: false, cliVersion: null, version: null, schemaVersion: null, error: 'no childProcess.spawnSync' };
  }
  try {
    const result = childProcess.spawnSync(command, ['health', '--json'], {
      timeout: 10_000,
      windowsHide: true,
      stdio: 'pipe',
      shell: false,
      encoding: 'utf8',
    });
    const output = (result.stdout || '').trim();
    if (!output) {
      const errMsg = (result.stderr || '').trim();
      return { ready: false, cliVersion: null, version: null, schemaVersion: null, error: errMsg || 'empty health output' };
    }
    const parsed = JSON.parse(output);
    const schemaVersion = parsed && parsed.data && parsed.data.schemaVersion
      ? String(parsed.data.schemaVersion)
      : null;
    return {
      ready: parsed && parsed.status === 'ok',
      version: schemaVersion,   // kept for backward compat
      schemaVersion,
      error: null,
    };
  } catch (err) {
    return {
      ready: false,
      cliVersion: null,
      version: null,
      schemaVersion: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function resolvePlanningHelp(cliPath, args, childProcess) {
  const command = typeof cliPath === 'string' ? cliPath.trim() : '';
  if (!command) return '';
  if (!childProcess || typeof childProcess.spawnSync !== 'function') return '';
  try {
    const result = childProcess.spawnSync(command, args, {
      timeout: 10_000,
      windowsHide: true,
      stdio: 'pipe',
      shell: false,
      encoding: 'utf8',
    });
    return `${result.stdout || ''}\n${result.stderr || ''}`;
  } catch {
    return '';
  }
}

function resolvePlanningCapabilities(cliPath, childProcess) {
  const command = typeof cliPath === 'string' ? cliPath.trim() : '';
  if (!command) return null;
  if (!childProcess || typeof childProcess.spawnSync !== 'function') return null;
  try {
    const result = childProcess.spawnSync(command, ['capabilities', '--json'], {
      timeout: 10_000,
      windowsHide: true,
      stdio: 'pipe',
      shell: false,
      encoding: 'utf8',
    });
    const output = (result.stdout || '').trim();
    if (!output) return null;
    const parsed = JSON.parse(output);
    return typeof parsed.cliVersion === 'string' ? parsed.cliVersion : null;
  } catch {
    return null;
  }
}

function resolvePlanningCliVersion(cliPath, childProcess) {
  // Prefer capabilities --json (exact cliVersion field)
  const capVersion = resolvePlanningCapabilities(cliPath, childProcess);
  if (capVersion) return capVersion;

  // Fallback: parse --version output
  try {
    const result = childProcess.spawnSync(cliPath, ['--version'], {
      timeout: 10_000,
      windowsHide: true,
      stdio: 'pipe',
      shell: false,
      encoding: 'utf8',
    });
    const output = (result.stdout || '').trim();
    const match = output.match(/(\d+\.\d+\.\d+)/);
    if (match) return match[1];
  } catch {
    // ignore
  }
  return null;
}

function resolvePlanningFeatureStatus(cliPath, childProcess) {
  const rootHelp = resolvePlanningHelp(cliPath, ['--help'], childProcess);
  const goalHelp = resolvePlanningHelp(cliPath, ['goal', '--help'], childProcess);
  const roadmapHelp = resolvePlanningHelp(cliPath, ['roadmap', '--help'], childProcess);
  const planHelp = resolvePlanningHelp(cliPath, ['plan', '--help'], childProcess);
  const todoHelp = resolvePlanningHelp(cliPath, ['todo', '--help'], childProcess);
  const issueHelp = resolvePlanningHelp(cliPath, ['issue', '--help'], childProcess);
  const projectRunHelp = resolvePlanningHelp(cliPath, ['project-run', '--help'], childProcess);
  const sessionHelp = resolvePlanningHelp(cliPath, ['session', '--help'], childProcess);

  const checks = [
    { id: 'session', ok: /\bsession\b/i.test(rootHelp) && /\binit\b/i.test(sessionHelp) },
    { id: 'project-run', ok: /\bproject-run\b/i.test(rootHelp) && /\bclaim\b/i.test(projectRunHelp) },
    { id: 'root-search', ok: /\bsearch\b/i.test(rootHelp) },
    { id: 'goal-update-status', ok: /\bupdate-status\b/i.test(goalHelp) },
    { id: 'roadmap-update-status', ok: /\bupdate-status\b/i.test(roadmapHelp) },
    { id: 'plan-update-status', ok: /\bupdate-status\b/i.test(planHelp) },
    { id: 'todo-update-status', ok: /\bupdate-status\b/i.test(todoHelp) },
    { id: 'issue-update-status', ok: /\bupdate-status\b/i.test(issueHelp) },
    { id: 'entity-search', ok: /\bsearch\b/i.test(goalHelp) && /\bsearch\b/i.test(planHelp) },
  ];

  const missing = checks.filter((check) => check.ok !== true).map((check) => check.id);
  return {
    required: checks.map((check) => check.id),
    missing,
    complete: missing.length === 0,
  };
}

module.exports = { resolvePlanningHealth, resolvePlanningHelp, resolvePlanningFeatureStatus, resolvePlanningCapabilities, resolvePlanningCliVersion };
