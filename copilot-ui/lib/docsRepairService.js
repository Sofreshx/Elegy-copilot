'use strict';

const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_CONCURRENCY_LIMIT = 3;
const DEFAULT_BATCH_SIZE = 50;
const VALID_BATCH_SIZES = new Set([20, 50]);
const DEFAULT_MODEL_PROFILE = 'opencode-zen-free';
const DEFAULT_MODEL = 'opencode/deepseek-v4-flash-free';
const REPAIR_STATE_VERSION = 1;
const MAX_LOG_ENTRIES = 200;
const COMPLETED_STATUSES = new Set(['succeeded', 'failed']);
const ACTIVE_STATUSES = new Set(['queued', 'running']);
const ELIGIBLE_CODES = new Set([
  'broken_internal_link',
  'frontmatter_invalid',
  'missing_dependency',
  'tool_config_drift',
]);

const CHECK_BY_CODE = {
  broken_internal_link: 'links',
  frontmatter_invalid: 'frontmatter',
  missing_dependency: 'tool-config-sync',
  tool_config_drift: 'tool-config-sync',
};

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function asTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function nowIso(now = Date.now) {
  return new Date(typeof now === 'function' ? now() : Date.now()).toISOString();
}

function toPosix(value) {
  return String(value || '').replace(/\\/g, '/');
}

function normalizeRepoPath(value) {
  return path.resolve(String(value || '')).replace(/\\/g, '/');
}

function hashRepoPath(repoPath) {
  return crypto.createHash('sha1').update(normalizeRepoPath(repoPath).toLowerCase()).digest('hex').slice(0, 16);
}

function resolveRepoStateKey(repoPath, repoId) {
  const explicit = asTrimmedString(repoId);
  if (explicit) {
    return explicit.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 96);
  }
  return `repo-${hashRepoPath(repoPath)}`;
}

function createRunId() {
  return `docs-repair-${crypto.randomUUID().slice(0, 8)}`;
}

function issueKey(issue) {
  return [
    asTrimmedString(issue && issue.code),
    toPosix(asTrimmedString(issue && issue.file)),
    Number(issue && issue.line) || 0,
    asTrimmedString(issue && issue.message),
  ].join('|');
}

function normalizeIssue(value) {
  if (!isObject(value)) return null;
  const code = asTrimmedString(value.code);
  const severity = asTrimmedString(value.severity);
  const file = toPosix(asTrimmedString(value.file));
  const line = Number(value.line) || 0;
  const message = asTrimmedString(value.message);
  if (!code || !severity || !file || !message) return null;
  return {
    code,
    severity,
    file,
    line,
    message,
    suggestion: asTrimmedString(value.suggestion) || null,
    key: issueKey({ code, file, line, message }),
  };
}

function isSafeDocsFile(file) {
  return /\.(md|mdx)$/i.test(toPosix(file));
}

function isEligibleIssue(issue) {
  return Boolean(
    issue
    && ELIGIBLE_CODES.has(issue.code)
    && issue.file
    && isSafeDocsFile(issue.file)
    && Number(issue.line) > 0
  );
}

function summarizeIssues(issues) {
  const byCode = {};
  for (const issue of issues || []) {
    byCode[issue.code] = (byCode[issue.code] || 0) + 1;
  }
  return {
    total: Array.isArray(issues) ? issues.length : 0,
    byCode,
  };
}

function detectOpenCodeBin(env = process.env, childProcessImpl = childProcess, fsImpl = fs) {
  const explicit = asTrimmedString(env.OPENCODE_BIN);
  if (explicit) return explicit;
  if (process.platform === 'win32') {
    for (const command of ['opencode.cmd', 'opencode']) {
      try {
        const output = childProcessImpl.execSync(`where.exe ${command}`, {
          encoding: 'utf8',
          stdio: 'pipe',
          windowsHide: true,
        });
        const first = asTrimmedString(String(output || '').split(/\r?\n/)[0]);
        if (first) return first;
      } catch {
        // try next candidate
      }
    }
    const appData = env.APPDATA || '';
    const candidate = appData ? path.join(appData, 'npm', 'opencode.cmd') : '';
    if (candidate && fsImpl.existsSync(candidate)) return candidate;
    return null;
  }
  try {
    const output = childProcessImpl.execSync('which opencode', { encoding: 'utf8', stdio: 'pipe' });
    return asTrimmedString(output) || null;
  } catch {
    return null;
  }
}

function resolveDocsCheckScript(engineRoot) {
  return path.resolve(engineRoot || path.resolve(__dirname, '..', '..'), 'scripts', 'elegy-docs-check.js');
}

function runExecFile(command, args, options = {}, childProcessImpl = childProcess) {
  return new Promise((resolve, reject) => {
    childProcessImpl.execFile(command, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      encoding: 'utf8',
      timeout: options.timeoutMs || 60_000,
      windowsHide: true,
      maxBuffer: options.maxBuffer || 10 * 1024 * 1024,
      shell: options.shell === true,
    }, (error, stdout, stderr) => {
      const result = {
        stdout: String(stdout || ''),
        stderr: String(stderr || ''),
        status: error && typeof error.code === 'number' ? error.code : 0,
      };
      if (error) {
        reject(Object.assign(error, result));
        return;
      }
      resolve(result);
    });
  });
}

async function runCommand(command, args, options, deps) {
  if (deps && typeof deps.runCommand === 'function') {
    return deps.runCommand(command, args, options);
  }
  return runExecFile(command, args, options, deps.childProcess);
}

function parseJsonReport(stdout) {
  try {
    return JSON.parse(String(stdout || '{}'));
  } catch (error) {
    throw Object.assign(new Error(`Failed to parse docs check output: ${error.message}`), {
      stdout,
    });
  }
}

function buildPrompt(run) {
  const issueLines = run.issues.map((issue, index) => (
    `${index + 1}. [${issue.severity}] ${issue.code} ${issue.file}:${issue.line}\n`
    + `   ${issue.message}\n`
    + (issue.suggestion ? `   Suggestion: ${issue.suggestion}\n` : '')
  )).join('\n');

  return [
    'Fix this bounded batch of deterministic documentation drift issues.',
    '',
    'Rules:',
    '- Fix only the listed issues.',
    '- Preserve unrelated wording and structure.',
    '- Do not perform broad rewrites.',
    '- Do not run git add, git commit, git push, git branch deletion, or git worktree removal.',
    '- Do not edit files unrelated to the listed issue locations unless a link target move requires the smallest local correction.',
    '- Prefer existing nearby paths, package names, and canonical docs over guessing.',
    '- If an issue cannot be safely fixed, leave it unchanged and report it.',
    '',
    `Repo: ${run.repoPath}`,
    `Batch: ${run.id}`,
    `Model: ${run.model}`,
    '',
    'Issues:',
    issueLines,
    '',
    'When done, reply with changed files and unresolved issues only.',
  ].join('\n');
}

class DocsRepairService {
  constructor(config = {}, deps = {}) {
    this._config = isObject(config) ? config : {};
    this._deps = {
      fs: deps.fs || fs,
      path: deps.path || path,
      os: deps.os || os,
      childProcess: deps.childProcess || childProcess,
      now: typeof deps.now === 'function' ? deps.now : () => Date.now(),
      runCommand: deps.runCommand,
      detectOpenCodeBin: deps.detectOpenCodeBin,
    };
    this._elegyHome = path.resolve(
      asTrimmedString(this._config.elegyHome)
      || process.env.ELEGY_HOME
      || path.join(os.homedir(), '.elegy')
    );
    this._engineRoot = path.resolve(
      asTrimmedString(this._config.engineRoot)
      || path.resolve(__dirname, '..', '..')
    );
    this._concurrencyLimit = Number(this._config.concurrencyLimit) > 0
      ? Math.floor(Number(this._config.concurrencyLimit))
      : DEFAULT_CONCURRENCY_LIMIT;
    this._repos = new Map();
    this._draining = new Set();
  }

  getStatus(repoPath, repoId = null) {
    const state = this._loadRepoState(repoPath, repoId);
    return {
      repoPath: state.repoPath,
      repoId: state.repoId,
      concurrencyLimit: this._concurrencyLimit,
      activeCount: state.runs.filter((run) => ACTIVE_STATUSES.has(run.status)).length,
      openCodeAvailable: Boolean(this._resolveOpenCodeBin()),
      runs: state.runs.slice().sort((left, right) => Date.parse(right.updatedAt || '') - Date.parse(left.updatedAt || '')),
    };
  }

  getRun(runId, repoPath = null, repoId = null) {
    const normalizedRunId = asTrimmedString(runId);
    if (!normalizedRunId) return null;
    if (repoPath) {
      const state = this._loadRepoState(repoPath, repoId);
      return state.runs.find((run) => run.id === normalizedRunId) || null;
    }
    for (const state of this._repos.values()) {
      const run = state.runs.find((entry) => entry.id === normalizedRunId);
      if (run) return run;
    }
    return null;
  }

  async startRepair(input = {}) {
    const repoPath = asTrimmedString(input.repoPath);
    if (!repoPath) {
      throw Object.assign(new Error('repoPath is required'), { statusCode: 400 });
    }
    const batchSize = Number(input.batchSize || DEFAULT_BATCH_SIZE);
    if (!VALID_BATCH_SIZES.has(batchSize)) {
      throw Object.assign(new Error('batchSize must be 20 or 50'), { statusCode: 400 });
    }

    const state = this._loadRepoState(repoPath, input.repoId || null);
    const activeCount = state.runs.filter((run) => ACTIVE_STATUSES.has(run.status)).length;
    if (activeCount >= this._concurrencyLimit) {
      throw Object.assign(new Error('Docs repair concurrency limit reached'), { statusCode: 409 });
    }

    const report = await this._resolveReport(repoPath, input.issues);
    const allIssues = (report.issues || []).map(normalizeIssue).filter(Boolean);
    const baselineEligibleKeys = allIssues.filter(isEligibleIssue).map((issue) => issue.key);
    const selected = this._selectIssues(allIssues, input, batchSize);
    if (selected.length === 0) {
      throw Object.assign(new Error('No eligible docs repair issues match the request'), { statusCode: 422 });
    }

    const id = createRunId();
    const timestamp = nowIso(this._deps.now);
    const modelProfile = asTrimmedString(input.modelProfile) || DEFAULT_MODEL_PROFILE;
    const model = this._resolveModel(modelProfile);
    const run = {
      id,
      status: 'queued',
      repoPath: normalizeRepoPath(repoPath),
      repoId: state.repoId,
      batchSize,
      modelProfile,
      model,
      branch: null,
      worktreePath: null,
      commitSha: null,
      prUrl: null,
      issues: selected,
      baselineEligibleKeys,
      issueSummary: summarizeIssues(selected),
      validation: null,
      error: null,
      logs: [],
      createdAt: timestamp,
      updatedAt: timestamp,
      startedAt: null,
      finishedAt: null,
    };

    state.runs.push(run);
    this._trimRuns(state);
    this._persistRepoState(state);
    this._drain(state.key);
    return { run: clone(run), status: this.getStatus(repoPath, input.repoId || null) };
  }

  _statePathFor(repoPath, repoId) {
    const key = resolveRepoStateKey(repoPath, repoId);
    return {
      key,
      statePath: path.join(this._elegyHome, 'repo-state', key, 'docs-repairs', 'state.json'),
    };
  }

  _loadRepoState(repoPath, repoId = null) {
    const normalizedRepoPath = normalizeRepoPath(repoPath);
    const { key, statePath } = this._statePathFor(normalizedRepoPath, repoId);
    if (this._repos.has(key)) {
      return this._repos.get(key);
    }
    let parsed = null;
    try {
      if (this._deps.fs.existsSync(statePath)) {
        parsed = JSON.parse(this._deps.fs.readFileSync(statePath, 'utf8'));
      }
    } catch {
      parsed = null;
    }
    const state = {
      version: REPAIR_STATE_VERSION,
      key,
      repoId: asTrimmedString(repoId) || asTrimmedString(parsed && parsed.repoId) || null,
      repoPath: normalizedRepoPath,
      statePath,
      runs: Array.isArray(parsed && parsed.runs) ? parsed.runs.map((run) => ({
        ...run,
        logs: Array.isArray(run.logs) ? run.logs.slice(-MAX_LOG_ENTRIES) : [],
      })) : [],
    };
    for (const run of state.runs) {
      if (run.status === 'running') {
        run.status = 'failed';
        run.error = run.error || 'Repair run was interrupted before completion.';
        run.finishedAt = run.finishedAt || nowIso(this._deps.now);
        run.updatedAt = run.finishedAt;
      }
    }
    this._repos.set(key, state);
    this._persistRepoState(state);
    return state;
  }

  _persistRepoState(state) {
    this._deps.fs.mkdirSync(path.dirname(state.statePath), { recursive: true });
    this._deps.fs.writeFileSync(state.statePath, `${JSON.stringify({
      version: REPAIR_STATE_VERSION,
      repoId: state.repoId,
      repoPath: state.repoPath,
      runs: state.runs,
    }, null, 2)}\n`, 'utf8');
  }

  _trimRuns(state) {
    if (state.runs.length > 100) {
      state.runs = state.runs.slice(-100);
    }
  }

  _appendLog(state, run, message, data = null) {
    run.logs.push({
      at: nowIso(this._deps.now),
      message,
      data: isObject(data) ? clone(data) : data,
    });
    run.logs = run.logs.slice(-MAX_LOG_ENTRIES);
    run.updatedAt = nowIso(this._deps.now);
    this._persistRepoState(state);
  }

  _resolveOpenCodeBin() {
    if (typeof this._deps.detectOpenCodeBin === 'function') {
      return this._deps.detectOpenCodeBin();
    }
    return detectOpenCodeBin(process.env, this._deps.childProcess, this._deps.fs);
  }

  _resolveModel(profileId) {
    try {
      const profilesPath = path.join(this._engineRoot, 'opencode-assets', 'profiles.json');
      const parsed = JSON.parse(this._deps.fs.readFileSync(profilesPath, 'utf8'));
      const profile = parsed.profiles && parsed.profiles[profileId];
      const roleModels = profile && isObject(profile.roleModels) ? profile.roleModels : {};
      return asTrimmedString(roleModels.implementation) || DEFAULT_MODEL;
    } catch {
      return DEFAULT_MODEL;
    }
  }

  async _resolveReport(repoPath, issues) {
    if (Array.isArray(issues) && issues.length > 0) {
      return { issues };
    }
    const scriptPath = resolveDocsCheckScript(this._engineRoot);
    const result = await runCommand('node', [scriptPath, '--json', '--target', repoPath], {
      cwd: this._engineRoot,
      timeoutMs: 30_000,
    }, this._deps);
    return parseJsonReport(result.stdout);
  }

  _selectIssues(allIssues, input, batchSize) {
    const issueIdSet = new Set(Array.isArray(input.issueIds) ? input.issueIds.map(asTrimmedString).filter(Boolean) : []);
    const severity = asTrimmedString(input.filters && input.filters.severity);
    const selected = [];
    for (const issue of allIssues) {
      if (!isEligibleIssue(issue)) continue;
      if (severity && severity !== 'all' && issue.severity !== severity) continue;
      if (issueIdSet.size > 0 && !issueIdSet.has(issue.key)) continue;
      selected.push(issue);
      if (selected.length >= batchSize) break;
    }
    return selected;
  }

  _drain(key) {
    if (this._draining.has(key)) return;
    this._draining.add(key);
    setTimeout(() => {
      void this._drainNow(key).finally(() => this._draining.delete(key));
    }, 0);
  }

  async _drainNow(key) {
    const state = this._repos.get(key);
    if (!state) return;
    while (state.runs.filter((run) => run.status === 'running').length < this._concurrencyLimit) {
      const next = state.runs.find((run) => run.status === 'queued');
      if (!next) return;
      void this._executeRun(state, next).finally(() => this._drain(key));
      await Promise.resolve();
    }
  }

  async _executeRun(state, run) {
    run.status = 'running';
    run.startedAt = nowIso(this._deps.now);
    run.updatedAt = run.startedAt;
    this._persistRepoState(state);
    try {
      await this._prepareWorktree(state, run);
      await this._runOpenCode(state, run);
      await this._validateRun(state, run);
      await this._publishRun(state, run);
      run.status = 'succeeded';
      run.finishedAt = nowIso(this._deps.now);
      run.updatedAt = run.finishedAt;
      this._appendLog(state, run, 'Repair run completed.');
    } catch (error) {
      run.status = 'failed';
      run.error = error instanceof Error ? error.message : String(error);
      run.finishedAt = nowIso(this._deps.now);
      run.updatedAt = run.finishedAt;
      this._appendLog(state, run, 'Repair run failed.', { error: run.error });
    } finally {
      this._persistRepoState(state);
    }
  }

  async _prepareWorktree(state, run) {
    const shortDate = new Date(this._deps.now()).toISOString().slice(0, 10).replace(/-/g, '');
    const branch = `codex/docs-repair-${shortDate}-${run.id.replace(/^docs-repair-/, '')}`;
    const worktreeBase = path.join(path.dirname(state.statePath), 'worktrees');
    const worktreePath = path.join(worktreeBase, run.id);
    this._deps.fs.mkdirSync(worktreeBase, { recursive: true });
    await runCommand('git', ['-C', run.repoPath, 'worktree', 'add', '-b', branch, worktreePath, 'HEAD'], {
      cwd: run.repoPath,
      timeoutMs: 60_000,
    }, this._deps);
    run.branch = branch;
    run.worktreePath = worktreePath;
    this._appendLog(state, run, 'Created repair worktree.', { branch, worktreePath });
  }

  async _runOpenCode(state, run) {
    const openCodeBin = this._resolveOpenCodeBin();
    if (!openCodeBin) {
      throw new Error('OpenCode CLI is not available.');
    }
    const prompt = buildPrompt(run);
    const args = [
      'run',
      '--model', run.model,
      '--format', 'json',
      '--no-replay',
      '--dangerously-skip-permissions',
      '--dir', run.worktreePath,
      prompt,
    ];
    const shell = process.platform === 'win32' && /\.cmd$/i.test(openCodeBin);
    this._appendLog(state, run, 'Starting OpenCode repair session.', { model: run.model });
    const result = await runCommand(openCodeBin, args, {
      cwd: run.worktreePath,
      timeoutMs: Number(this._config.openCodeTimeoutMs) || 15 * 60_000,
      maxBuffer: 20 * 1024 * 1024,
      shell,
    }, this._deps);
    this._appendLog(state, run, 'OpenCode repair session finished.', {
      stdoutTail: String(result.stdout || '').slice(-4000),
      stderrTail: String(result.stderr || '').slice(-4000),
    });
  }

  async _runDocsCheck(target, check = null) {
    const scriptPath = resolveDocsCheckScript(this._engineRoot);
    const args = [scriptPath, '--json', '--target', target];
    if (check && check !== 'all') {
      args.push('--check', check);
    }
    const result = await runCommand('node', args, {
      cwd: this._engineRoot,
      timeoutMs: 45_000,
    }, this._deps).catch((error) => ({
      stdout: error.stdout || '',
      stderr: error.stderr || error.message || '',
      status: typeof error.status === 'number' ? error.status : 1,
    }));
    return {
      report: parseJsonReport(result.stdout),
      exitCode: result.status,
      stderr: result.stderr || null,
    };
  }

  async _validateRun(state, run) {
    const targetedChecks = [...new Set(run.issues.map((issue) => CHECK_BY_CODE[issue.code]).filter(Boolean))].sort();
    const targeted = {};
    for (const check of targetedChecks) {
      targeted[check] = await this._runDocsCheck(run.worktreePath, check);
    }
    const full = await this._runDocsCheck(run.worktreePath, 'all');
    const afterIssues = (full.report.issues || []).map(normalizeIssue).filter(Boolean);
    const beforeEligibleKeys = new Set(
      Array.isArray(run.baselineEligibleKeys) && run.baselineEligibleKeys.length > 0
        ? run.baselineEligibleKeys
        : run.issues.map((issue) => issue.key)
    );
    const afterKeys = new Set(afterIssues.map((issue) => issue.key));
    const remainingSelected = run.issues.filter((issue) => afterKeys.has(issue.key));
    const fixedCount = run.issues.length - remainingSelected.length;
    const newEligibleErrors = afterIssues.filter((issue) => (
      isEligibleIssue(issue)
      && issue.severity === 'error'
      && !beforeEligibleKeys.has(issue.key)
    ));
    run.validation = {
      targetedChecks,
      targeted,
      full: {
        exitCode: full.exitCode,
        score: full.report.score,
        severityCounts: full.report.severityCounts || null,
      },
      selectedCount: run.issues.length,
      fixedCount,
      remainingSelected: remainingSelected.map((issue) => issue.key),
      newEligibleErrors: newEligibleErrors.map((issue) => issue.key),
    };
    this._appendLog(state, run, 'Validated repair output.', run.validation);
    if (fixedCount <= 0) {
      throw new Error('Validation failed: no selected eligible issues were fixed.');
    }
    if (newEligibleErrors.length > 0) {
      throw new Error('Validation failed: repair introduced new eligible errors.');
    }
  }

  async _publishRun(state, run) {
    const status = await runCommand('git', ['-C', run.worktreePath, 'status', '--porcelain'], {
      cwd: run.worktreePath,
      timeoutMs: 15_000,
    }, this._deps);
    if (!String(status.stdout || '').trim()) {
      throw new Error('Validation passed but no git changes were produced.');
    }
    await runCommand('git', ['-C', run.worktreePath, 'add', '--', '.'], { cwd: run.worktreePath, timeoutMs: 30_000 }, this._deps);
    const commitMessage = `Fix docs drift batch ${run.id}`;
    await runCommand('git', ['-C', run.worktreePath, 'commit', '-m', commitMessage], {
      cwd: run.worktreePath,
      timeoutMs: 60_000,
    }, this._deps);
    const rev = await runCommand('git', ['-C', run.worktreePath, 'rev-parse', 'HEAD'], {
      cwd: run.worktreePath,
      timeoutMs: 15_000,
    }, this._deps);
    run.commitSha = asTrimmedString(rev.stdout) || null;
    await runCommand('git', ['-C', run.worktreePath, 'push', '-u', 'origin', run.branch], {
      cwd: run.worktreePath,
      timeoutMs: 120_000,
    }, this._deps);
    const prBody = [
      `Automated docs drift repair batch ${run.id}.`,
      '',
      `- Selected issues: ${run.validation.selectedCount}`,
      `- Fixed selected issues: ${run.validation.fixedCount}`,
      `- Model: ${run.model}`,
      `- Worktree: ${run.worktreePath}`,
      `- Validation score: ${run.validation.full.score}`,
    ].join('\n');
    await runCommand('gh', [
      'pr', 'create',
      '--draft',
      '--title', commitMessage,
      '--body', prBody,
      '--head', run.branch,
    ], {
      cwd: run.worktreePath,
      timeoutMs: 60_000,
    }, this._deps);
    const prView = await runCommand('gh', ['pr', 'view', '--json', 'url'], {
      cwd: run.worktreePath,
      timeoutMs: 30_000,
    }, this._deps);
    try {
      const parsed = JSON.parse(prView.stdout || '{}');
      run.prUrl = asTrimmedString(parsed.url) || null;
    } catch {
      run.prUrl = null;
    }
    this._appendLog(state, run, 'Published draft pull request.', {
      commitSha: run.commitSha,
      prUrl: run.prUrl,
    });
  }
}

function createDocsRepairService(config = {}, deps = {}) {
  return new DocsRepairService(config, deps);
}

module.exports = {
  DEFAULT_CONCURRENCY_LIMIT,
  DEFAULT_BATCH_SIZE,
  DEFAULT_MODEL_PROFILE,
  DEFAULT_MODEL,
  ELIGIBLE_CODES,
  DocsRepairService,
  createDocsRepairService,
  detectOpenCodeBin,
  isEligibleIssue,
  normalizeIssue,
  issueKey,
};
