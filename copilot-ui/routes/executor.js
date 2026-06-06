'use strict';

const { sendJson: defaultSendJson, readJsonBody: defaultReadJsonBody } = require('./_helpers');
const { SESSION_ORCHESTRATION_CONTRACT_VERSION } = require('../lib/runtimeContracts');
const {
  WORKTREE_DISCOVERY_CONTRACT_VERSION,
  discoverAndMergeWorktrees,
} = require('../lib/worktreeDiscovery');
const { execSync, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function requireExecutor(res, deps) {
  if (deps.executorService) {
    return deps.executorService;
  }

  deps.sendJson(res, 503, {
    error: 'Executor service is unavailable.',
  });
  return null;
}

function handleHealth(ctx, deps) {
  const executor = requireExecutor(ctx.res, deps);
  if (!executor) return;
  deps.sendJson(ctx.res, 200, {
    ...executor.getHealth(),
    workflowLayer: deps.workflowLayerService && typeof deps.workflowLayerService.getHealth === 'function'
      ? deps.workflowLayerService.getHealth()
      : null,
    orchestrationContractVersion: SESSION_ORCHESTRATION_CONTRACT_VERSION,
  });
}

function handleListJobs(ctx, deps) {
  const executor = requireExecutor(ctx.res, deps);
  if (!executor) return;
  deps.sendJson(ctx.res, 200, { jobs: executor.listJobs() });
}

function handleListRuns(ctx, deps) {
  const executor = requireExecutor(ctx.res, deps);
  if (!executor) return;
  deps.sendJson(ctx.res, 200, { runs: executor.listRuns() });
}

function handleGetRun(ctx, deps) {
  const executor = requireExecutor(ctx.res, deps);
  if (!executor) return;

  const runId = decodeURIComponent(ctx.match[1] || '').trim();
  const run = executor.getRun(runId);
  if (!run) {
    deps.sendJson(ctx.res, 404, { error: 'Executor run not found' });
    return;
  }

  deps.sendJson(ctx.res, 200, run);
}

async function handleListWorktrees(ctx, deps) {
  const executor = requireExecutor(ctx.res, deps);
  if (!executor) return;

  let searchParams;
  if (ctx.u && typeof ctx.u.searchParams?.get === 'function') {
    searchParams = ctx.u.searchParams;
  } else {
    const url = new URL(ctx.pathname || 'http://localhost/api/executor/worktrees', 'http://localhost');
    searchParams = url.searchParams;
  }
  const repoId = (searchParams.get('repoId') || '').trim() || null;
  const repoPath = (searchParams.get('repoPath') || '').trim() || null;
  const includeGit = searchParams.get('includeGit') !== 'false';

  const persisted = executor.listWorktrees({ repoId });
  if (!includeGit || !repoPath) {
    deps.sendJson(ctx.res, 200, {
      worktrees: persisted,
      orchestrationContractVersion: SESSION_ORCHESTRATION_CONTRACT_VERSION,
      worktreeDiscovery: {
        contractVersion: WORKTREE_DISCOVERY_CONTRACT_VERSION,
        repoId,
        repoPath: repoPath || null,
        gitListOk: null,
        gitListError: null,
        persistedCount: persisted.length,
        discoveredCount: 0,
      },
    });
    return;
  }

  try {
    const result = await deps.worktreeDiscovery.discoverAndMergeWorktrees({
      repoPath,
      persistedRecords: persisted,
    });
    deps.sendJson(ctx.res, 200, {
      worktrees: result.mergedRecords,
      orchestrationContractVersion: SESSION_ORCHESTRATION_CONTRACT_VERSION,
      worktreeDiscovery: {
        contractVersion: WORKTREE_DISCOVERY_CONTRACT_VERSION,
        repoId,
        repoPath: result.repoPath || repoPath,
        gitListOk: result.gitListOk,
        gitListError: result.gitListError,
        persistedCount: result.persistedCount,
        discoveredCount: result.discoveredCount,
      },
    });
  } catch (error) {
    deps.sendJson(ctx.res, 200, {
      worktrees: persisted,
      orchestrationContractVersion: SESSION_ORCHESTRATION_CONTRACT_VERSION,
      worktreeDiscovery: {
        contractVersion: WORKTREE_DISCOVERY_CONTRACT_VERSION,
        repoId,
        repoPath,
        gitListOk: false,
        gitListError: error && error.message ? error.message : String(error),
        persistedCount: persisted.length,
        discoveredCount: 0,
      },
    });
  }
}

async function handleCleanupAnalyze(ctx, deps) {
  const executor = requireExecutor(ctx.res, deps);
  if (!executor) return;
  
  const body = await deps.readJsonBody(ctx.req);
  const repoPath = (body && body.repoPath || '').trim();
  const worktreePath = (body && body.worktreePath || '').trim();
  
  if (!repoPath || !worktreePath) {
    deps.sendJson(ctx.res, 400, { error: 'repoPath and worktreePath are required' });
    return;
  }
  
  // Check if worktree path exists
  const missing = !fs.existsSync(worktreePath);
  
  // Check if worktree is dirty via git status
  let dirty = false;
  let dirtyFiles = 0;
  let conflicts = false;
  let conflictFiles = [];
  let mergedIntoCurrentOrDefault = false;
  let diagnostics = [];
  
  try {
    const statusOutput = execFileSync('git', ['-C', worktreePath, 'status', '--porcelain'], { 
      encoding: 'utf8', 
      timeout: 15000,
      windowsHide: true 
    }).trim();
    if (statusOutput) {
      dirtyFiles = statusOutput.split('\n').length;
      dirty = dirtyFiles > 0;
      // Check for conflicts (UU in porcelain status)
      const lines = statusOutput.split('\n');
      conflictFiles = lines
        .filter(l => l.startsWith('UU ') || l.startsWith('AA ') || l.startsWith('DD '))
        .map(l => l.slice(3).trim());
      conflicts = conflictFiles.length > 0;
    }
  } catch (err) {
    diagnostics.push(`git status failed: ${err.message}`);
  }
  
  // Check if branch is merged into current/default branch
  let branch = (body && body.branch || '').trim();
  if (!branch) {
    try {
      branch = execFileSync('git', ['-C', worktreePath, 'rev-parse', '--abbrev-ref', 'HEAD'], {
        encoding: 'utf8', timeout: 10000, windowsHide: true
      }).trim();
    } catch { /* ignore */ }
  }
  
  if (branch) {
    try {
      // Try merging into default branch (main/master) or current branch
      for (const target of ['main', 'master', 'develop']) {
        try {
          execFileSync('git', ['-C', repoPath, 'merge-base', '--is-ancestor', branch, target], {
            encoding: 'utf8', timeout: 10000, windowsHide: true
          });
          mergedIntoCurrentOrDefault = true;
          break;
        } catch {
          // Not an ancestor, try next target
        }
      }
    } catch { /* ignore */ }
  }
  
  // Check assignment (via safe internal access)
  let assigned = false;
  try {
    if (executor._worktreeService && typeof executor._worktreeService._findPersistedRecordByPath === 'function') {
      const existing = executor._worktreeService._findPersistedRecordByPath(null, null, worktreePath);
      assigned = !!(existing && existing.assignment && (
        existing.assignment.sessionId || existing.assignment.runId || existing.assignment.overlaySessionId
      ));
    }
  } catch {
    // If we can't check assignments, assume not assigned (safe to remove)
  }
  
  const eligible = !dirty && !conflicts && !missing && !assigned && mergedIntoCurrentOrDefault;
  const reasons = [];
  if (dirty) reasons.push('dirty');
  if (conflicts) reasons.push('conflicts');
  if (missing) reasons.push('missing');
  if (assigned) reasons.push('assigned');
  if (!mergedIntoCurrentOrDefault) reasons.push('not merged into default branch');
  
  deps.sendJson(ctx.res, 200, {
    eligible,
    reason: eligible ? 'safe to remove' : reasons.join(', ') || 'unknown',
    dirty,
    dirtyFiles,
    missing,
    assigned,
    mergedIntoCurrentOrDefault,
    conflicts,
    conflictFiles,
    diagnostics,
    branch,
    repoPath,
    worktreePath,
  });
}

async function handleCleanupRemove(ctx, deps) {
  const executor = requireExecutor(ctx.res, deps);
  if (!executor) return;
  
  const body = await deps.readJsonBody(ctx.req);
  const repoPath = (body && body.repoPath || '').trim();
  const worktreePath = (body && body.worktreePath || '').trim();
  
  if (!repoPath || !worktreePath) {
    deps.sendJson(ctx.res, 400, { error: 'repoPath and worktreePath are required' });
    return;
  }
  
  // Safety check: re-validate before removing
  if (!fs.existsSync(worktreePath)) {
    deps.sendJson(ctx.res, 400, { error: 'Worktree path does not exist', missing: true });
    return;
  }
  
  // Check dirty
  let dirty = false;
  try {
    const statusOutput = execFileSync('git', ['-C', worktreePath, 'status', '--porcelain'], {
      encoding: 'utf8', timeout: 15000, windowsHide: true
    }).trim();
    dirty = statusOutput.length > 0;
  } catch { /* ignore */ }
  
  if (dirty && !body.force) {
    deps.sendJson(ctx.res, 400, { 
      error: 'Cannot remove dirty worktree. Resolve changes first.',
      dirty: true 
    });
    return;
  }
  
  // Perform removal
  try {
    const args = ['-C', repoPath, 'worktree', 'remove', worktreePath];
    if (body.force) args.push('--force');
    const output = execFileSync('git', args, {
      encoding: 'utf8', timeout: 30000, windowsHide: true
    }).trim();
    
    deps.sendJson(ctx.res, 200, {
      removed: true,
      worktreePath,
      repoPath,
      output: output || 'Worktree removed successfully',
    });
  } catch (err) {
    deps.sendJson(ctx.res, 500, {
      error: `Failed to remove worktree: ${err.message}`,
      removed: false,
      worktreePath,
    });
  }
}

async function handlePrune(ctx, deps) {
  const executor = requireExecutor(ctx.res, deps);
  if (!executor) return;
  
  const body = await deps.readJsonBody(ctx.req);
  const repoPath = (body && body.repoPath || '').trim();
  
  if (!repoPath) {
    deps.sendJson(ctx.res, 400, { error: 'repoPath is required' });
    return;
  }
  
  try {
    const output = execFileSync('git', ['-C', repoPath, 'worktree', 'prune'], {
      encoding: 'utf8', timeout: 30000, windowsHide: true
    }).trim();
    
    deps.sendJson(ctx.res, 200, {
      pruned: true,
      repoPath,
      output: output || 'Prune completed',
      diagnostics: [output || 'No stale worktrees found'],
    });
  } catch (err) {
    deps.sendJson(ctx.res, 500, {
      error: `Prune failed: ${err.message}`,
      pruned: false,
      repoPath,
    });
  }
}

function register(deps = {}) {
  const resolvedDeps = {
    sendJson: deps.sendJson || defaultSendJson,
    readJsonBody: deps.readJsonBody || defaultReadJsonBody,
    executorService: deps.executorService || null,
    workflowLayerService: deps.workflowLayerService || null,
    worktreeDiscovery: deps.worktreeDiscovery || { discoverAndMergeWorktrees },
  };

  return [
    {
      method: 'GET',
      path: '/api/executor/health',
      handler: (ctx) => handleHealth(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: '/api/executor/jobs',
      handler: (ctx) => handleListJobs(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: '/api/executor/worktrees',
      handler: (ctx) => handleListWorktrees(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: '/api/executor/runs',
      handler: (ctx) => handleListRuns(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: /^\/api\/executor\/runs\/([^/]+)$/,
      handler: (ctx) => handleGetRun(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/executor/worktrees/cleanup/analyze',
      handler: (ctx) => handleCleanupAnalyze(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/executor/worktrees/cleanup/remove',
      handler: (ctx) => handleCleanupRemove(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/executor/worktrees/prune',
      handler: (ctx) => handlePrune(ctx, resolvedDeps),
    },
  ];
}

module.exports = { register, handleListWorktrees, handleCleanupAnalyze, handleCleanupRemove, handlePrune };
