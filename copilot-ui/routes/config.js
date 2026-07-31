'use strict';

const copilotConfigDefault = require('../lib/copilotConfig');
const codexConfigDefault = require('../lib/codexConfig');
const { sendJson: defaultSendJson, sendText: defaultSendText, readJsonBody: defaultReadJsonBody } = require('./_helpers');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { composeInstructions, buildProfileContent } = require('../lib/compose-instructions.cjs');

function register(deps = {}) {
  const resolvedDeps = {
    sendJson: deps.sendJson || defaultSendJson,
    sendText: deps.sendText || defaultSendText,
    readJsonBody: deps.readJsonBody || defaultReadJsonBody,
    copilotConfig: deps.copilotConfig || copilotConfigDefault,
    codexConfig: deps.codexConfig || codexConfigDefault,
  };

  return [
    {
      method: 'GET',
      path: '/api/config/remote-sessions',
      handler: (ctx) => handleGetRemoteSessions(ctx, resolvedDeps),
    },
    {
      method: 'PUT',
      path: '/api/config/remote-sessions',
      handler: (ctx) => handleSetRemoteSessions(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: '/api/config/collaboration-profile',
      handler: (ctx) => handleGetCollaborationProfile(ctx, resolvedDeps),
    },
    {
      method: 'PUT',
      path: '/api/config/collaboration-profile',
      handler: (ctx) => handleSaveCollaborationProfile(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: '/api/config/collaboration-profile/instructions',
      handler: (ctx) => handleGetCollaborationInstructions(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: '/api/config/collaboration-profile/instructions/view',
      handler: (ctx) => handleViewCollaborationInstructionLayer(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: '/api/config/codex-provider',
      handler: (ctx) => handleGetCodexProvider(ctx, resolvedDeps),
    },
  ];
}

// --- Collaboration Profile Handlers ---

const REPO_ROOT = path.resolve(__dirname, '..', '..');

const HARNESS_TARGETS = [
  {
    id: 'copilot',
    instructionFile: 'copilot-instructions.md',
    homeDir: path.join(os.homedir(), '.elegy'),
    baseline: 'catalog-assets/instructions/agent-session-defaults.md',
    appendix: 'engine-assets/copilot-instructions-appendix.md',
    managedBlock: false,
  },
  {
    id: 'codex',
    instructionFile: 'AGENTS.md',
    homeDir: path.join(os.homedir(), '.codex'),
    baseline: 'catalog-assets/instructions/agent-session-defaults.md',
    appendix: 'codex-assets/home/AGENTS-appendix.md',
    managedBlock: false,
  },
  {
    id: 'opencode',
    instructionFile: 'AGENTS.md',
    homeDir: path.join(os.homedir(), '.config', 'opencode'),
    baseline: 'catalog-assets/instructions/agent-session-defaults.md',
    appendix: 'opencode-assets/home/AGENTS-appendix.md',
    managedBlock: false,
  },
  {
    id: 'claude-code',
    instructionFile: 'CLAUDE.md',
    homeDir: path.join(os.homedir(), '.claude'),
    baseline: 'catalog-assets/instructions/agent-session-defaults.md',
    appendix: 'claude-assets/home/CLAUDE-appendix.md',
    managedBlock: false,
  },
  {
    id: 'antigravity',
    instructionFile: 'GEMINI.md',
    homeDir: path.join(os.homedir(), '.gemini'),
    baseline: 'catalog-assets/instructions/agent-session-defaults.md',
    appendix: 'antigravity-assets/home/GEMINI-appendix.md',
    managedBlock: true,
  },
];

const PRESETS = [
  {
    id: 'constructive-coworker',
    label: 'Constructive Coworker',
    description: 'Attention-friendly communication: outcome-first, one thread at a time, explicit next actions.',
    content: fs.readFileSync(
      path.join(REPO_ROOT, 'catalog-assets', 'presets', 'constructive-coworker.md'),
      'utf8',
    ).trim(),
    isDefault: true,
  },
];

const MANAGED_BLOCK_START = '<!-- elegy-copilot:begin antigravity -->';
const MANAGED_BLOCK_END = '<!-- elegy-copilot:end antigravity -->';
const INSTRUCTION_BUDGETS_PATH = path.join(REPO_ROOT, 'catalog-assets', 'instructions', 'budgets.json');

function shaText(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function countLines(text) {
  return String(text).split(/\r?\n/).length;
}

function readInstructionBudgets() {
  return JSON.parse(fs.readFileSync(INSTRUCTION_BUDGETS_PATH, 'utf8'));
}

function readTextIfExists(absPath) {
  if (!fs.existsSync(absPath)) {
    return null;
  }
  return fs.readFileSync(absPath, 'utf8');
}

function normalizeInstructionText(text) {
  if (typeof text !== 'string') {
    return null;
  }
  return text.replace(/\r\n/g, '\n').trim();
}

function extractManagedBlock(text) {
  if (typeof text !== 'string' || !text.includes(MANAGED_BLOCK_START) || !text.includes(MANAGED_BLOCK_END)) {
    return null;
  }

  const start = text.indexOf(MANAGED_BLOCK_START);
  const end = text.indexOf(MANAGED_BLOCK_END);
  if (start < 0 || end < start) {
    return null;
  }

  return text.slice(start, end + MANAGED_BLOCK_END.length).trim();
}

function buildLayerMetrics(name, text, budget) {
  const available = typeof text === 'string';
  const safeText = available ? text : '';
  return {
    name,
    available,
    bytes: available ? Buffer.byteLength(safeText, 'utf8') : 0,
    lines: available ? countLines(safeText) : 0,
    sha256: available ? shaText(safeText) : null,
    overBudget: Boolean(
      available &&
      budget &&
      (Buffer.byteLength(safeText, 'utf8') > Number(budget.maxBytes || 0) ||
        countLines(safeText) > Number(budget.maxLines || 0))
    ),
  };
}

function getTargetPaths(target) {
  return {
    baselinePath: path.resolve(REPO_ROOT, target.baseline),
    appendixPath: path.resolve(REPO_ROOT, target.appendix),
    installedPath: path.join(target.homeDir, target.instructionFile),
  };
}

function getTargetInstructionState(target, profile, budgets) {
  const { baselinePath, appendixPath, installedPath } = getTargetPaths(target);
  const baselineText = fs.readFileSync(baselinePath, 'utf8');
  const appendixText = fs.readFileSync(appendixPath, 'utf8');
  const presetText = (PRESETS.find((preset) => preset.id === profile.presetId)?.content || '').trim();
  const profileContent = profile.enabled ? buildProfileContent(profile) : '';
  const composedText = composeInstructions(baselinePath, appendixPath, profileContent);
  const installedText = readTextIfExists(installedPath);
  const managedBlockText = target.managedBlock ? extractManagedBlock(installedText) : null;
  const comparisonText = target.managedBlock ? managedBlockText : installedText;
  const normalizedComparisonText = normalizeInstructionText(comparisonText);
  const normalizedComposedText = normalizeInstructionText(composedText);
  const drift = typeof normalizedComparisonText === 'string'
    ? shaText(normalizedComparisonText) !== shaText(normalizedComposedText || '')
    : installedText != null;

  return {
    id: target.id,
    instructionFile: target.instructionFile,
    path: installedPath,
    installed: typeof installedText === 'string',
    managedBlock: target.managedBlock,
    drift,
    layers: {
      baseline: buildLayerMetrics('baseline', baselineText, budgets.layers?.baseline),
      preset: buildLayerMetrics('preset', presetText, budgets.layers?.preset),
      appendix: buildLayerMetrics('appendix', appendixText, budgets.layers?.appendix?.[target.id]),
      composed: buildLayerMetrics('composed', composedText, budgets.layers?.composed?.[target.id]),
      installed: buildLayerMetrics('installed', installedText, null),
    },
    texts: {
      baseline: baselineText,
      preset: presetText,
      appendix: appendixText,
      composed: composedText,
      installed: installedText,
      'managed-block': managedBlockText,
    },
  };
}

function getInstructionLayerView(targetId, layerId, profile) {
  const budgets = readInstructionBudgets();
  const target = HARNESS_TARGETS.find((candidate) => candidate.id === targetId);
  if (!target) {
    throw Object.assign(new Error(`Unknown instruction target: ${targetId}`), { statusCode: 404 });
  }

  const state = getTargetInstructionState(target, profile, budgets);
  const normalizedLayer = String(layerId || '').trim();
  if (!Object.prototype.hasOwnProperty.call(state.texts, normalizedLayer)) {
    throw Object.assign(new Error(`Unknown instruction layer: ${normalizedLayer}`), { statusCode: 400 });
  }

  const text = state.texts[normalizedLayer];
  if (typeof text !== 'string') {
    throw Object.assign(new Error(`Instruction layer unavailable: ${normalizedLayer}`), { statusCode: 404 });
  }

  return text;
}

function applyManagedBlock(target, composedContent) {
  const instructionsPath = path.join(target.homeDir, target.instructionFile);

  if (!fs.existsSync(instructionsPath)) {
    return { status: 'not-installed', path: instructionsPath };
  }

  const existingText = fs.readFileSync(instructionsPath, 'utf8').replace(/\r\n/g, '\n');
  const managedContent = [
    MANAGED_BLOCK_START,
    composedContent.trim(),
    MANAGED_BLOCK_END,
    '',
  ].join('\n');

  // Find existing managed block
  const startIndex = existingText.indexOf(MANAGED_BLOCK_START);
  const endIndex = existingText.indexOf(MANAGED_BLOCK_END);

  let nextText;
  if (startIndex >= 0 && endIndex >= startIndex) {
    const blockEnd = endIndex + MANAGED_BLOCK_END.length;
    const before = existingText.slice(0, startIndex).replace(/\s*$/, '');
    const after = existingText.slice(blockEnd).replace(/^\s*/, '');
    nextText = [before, managedContent.trimEnd(), after]
      .filter(Boolean)
      .join('\n\n')
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd() + '\n';
  } else {
    nextText = `${existingText.trimEnd()}\n\n${managedContent}`;
  }

  const previousHash = shaText(existingText);
  const nextHash = shaText(nextText);

  if (previousHash === nextHash) {
    return { status: 'unchanged', path: instructionsPath };
  }

  fs.writeFileSync(instructionsPath, nextText, 'utf8');
  return { status: 'applied', path: instructionsPath };
}

function applyStandardTarget(target, composedContent) {
  const instructionsPath = path.join(target.homeDir, target.instructionFile);

  if (!fs.existsSync(instructionsPath)) {
    return { status: 'not-installed', path: instructionsPath };
  }

  const existingText = fs.readFileSync(instructionsPath, 'utf8');
  const nextText = composedContent;
  const previousHash = shaText(existingText);
  const nextHash = shaText(nextText);

  if (previousHash === nextHash) {
    return { status: 'unchanged', path: instructionsPath };
  }

  fs.writeFileSync(instructionsPath, nextText, 'utf8');
  return { status: 'applied', path: instructionsPath };
}

function applyProfileToTarget(target, profileContent) {
  try {
    const baselinePath = path.resolve(REPO_ROOT, target.baseline);
    const appendixPath = path.resolve(REPO_ROOT, target.appendix);

    const composedContent = composeInstructions(baselinePath, appendixPath, profileContent);

    if (target.managedBlock) {
      return applyManagedBlock(target, composedContent);
    }
    return applyStandardTarget(target, composedContent);
  } catch (err) {
    return { status: 'error', path: path.join(target.homeDir, target.instructionFile), error: err.message };
  }
}

function applyCollaborationProfile(profile) {
  const profileContent = profile.enabled ? buildProfileContent(profile) : '';

  const results = [];
  let allApplied = true;

  for (const target of HARNESS_TARGETS) {
    const result = applyProfileToTarget(target, profileContent);
    if (result.status === 'error') {
      allApplied = false;
    }
    results.push({
      id: target.id,
      path: result.path,
      status: result.status,
      error: result.error,
    });
  }

  return { allApplied, results };
}

async function handleGetCollaborationProfile(ctx, deps) {
  try {
    const profile = deps.copilotConfig.getCollaborationProfile();

    const presets = PRESETS.map((p) => ({ ...p }));

    const targets = HARNESS_TARGETS.map((t) => ({
      id: t.id,
      path: path.join(t.homeDir, t.instructionFile),
      installed: fs.existsSync(path.join(t.homeDir, t.instructionFile)),
    }));

    deps.sendJson(ctx.res, 200, { profile, presets, targets });
  } catch (err) {
    deps.sendJson(ctx.res, 500, { error: err.message });
  }
}

async function handleGetCollaborationInstructions(ctx, deps) {
  try {
    const profile = deps.copilotConfig.getCollaborationProfile();
    const budgets = readInstructionBudgets();
    const targets = HARNESS_TARGETS.map((target) => {
      const state = getTargetInstructionState(target, profile, budgets);
      return {
        id: state.id,
        instructionFile: state.instructionFile,
        path: state.path,
        installed: state.installed,
        managedBlock: state.managedBlock,
        drift: state.drift,
        layers: state.layers,
      };
    });
    deps.sendJson(ctx.res, 200, {
      budgets: budgets.layers,
      targets,
    });
  } catch (err) {
    deps.sendJson(ctx.res, err.statusCode || 500, { error: err.message });
  }
}

async function handleViewCollaborationInstructionLayer(ctx, deps) {
  try {
    const targetId = ctx.u.searchParams.get('target');
    const layerId = ctx.u.searchParams.get('layer');
    if (!targetId || !layerId) {
      deps.sendJson(ctx.res, 400, { error: 'Missing ?target= or ?layer=' });
      return;
    }

    const profile = deps.copilotConfig.getCollaborationProfile();
    const text = getInstructionLayerView(targetId, layerId, profile);
    if (typeof deps.sendText === 'function') {
      deps.sendText(ctx.res, 200, text, 'text/plain; charset=utf-8');
      return;
    }
    ctx.res.statusCode = 200;
    ctx.res.setHeader?.('Content-Type', 'text/plain; charset=utf-8');
    ctx.res.end(text);
  } catch (err) {
    deps.sendJson(ctx.res, err.statusCode || 500, { error: err.message });
  }
}

async function handleSaveCollaborationProfile(ctx, deps) {
  try {
    const body = await deps.readJsonBody(ctx.req);

    // Extract only known fields
    const update = {};
    if (body.enabled !== undefined) {
      if (typeof body.enabled !== 'boolean') {
        deps.sendJson(ctx.res, 400, { saved: false, error: 'enabled must be a boolean' });
        return;
      }
      update.enabled = body.enabled;
    }
    if (typeof body.presetId === 'string') update.presetId = body.presetId.trim();
    if (typeof body.customInstructions === 'string') update.customInstructions = body.customInstructions.trim();

    const saveResult = deps.copilotConfig.setCollaborationProfile(null, update);
    if (!saveResult.saved) {
      deps.sendJson(ctx.res, 400, { saved: false, error: saveResult.error });
      return;
    }

    // Read back the effective profile
    const profile = deps.copilotConfig.getCollaborationProfile();

    // Apply to all installed harnesses
    const { allApplied, results } = applyCollaborationProfile(profile);

    deps.sendJson(ctx.res, 200, {
      saved: true,
      profile,
      allApplied,
      results,
    });
  } catch (err) {
    if (err.statusCode) {
      deps.sendJson(ctx.res, err.statusCode, { error: err.message });
    } else {
      deps.sendJson(ctx.res, 500, { error: err.message });
    }
  }
}

function handleGetRemoteSessions(ctx, deps) {
  const { elegyHome } = ctx;
  try {
    const enabled = deps.copilotConfig.getRemoteSessions(elegyHome);
    deps.sendJson(ctx.res, 200, { enabled });
  } catch (err) {
    deps.sendJson(ctx.res, 500, { error: 'Failed to read config', details: err.message });
  }
}

async function handleSetRemoteSessions(ctx, deps) {
  try {
    const body = await deps.readJsonBody(ctx.req);
    if (typeof body.enabled !== 'boolean') {
      deps.sendJson(ctx.res, 400, { error: '`enabled` must be a boolean' });
      return;
    }

    deps.copilotConfig.setRemoteSessions(ctx.elegyHome, body.enabled);
    if (ctx.sdkBridge && typeof ctx.sdkBridge.restartBaseClient === 'function') {
      try {
        await ctx.sdkBridge.restartBaseClient();
      } catch (restartErr) {
        deps.sendJson(ctx.res, 200, {
          enabled: body.enabled,
          warning: `Config saved but base client restart failed: ${restartErr.message}`,
        });
        return;
      }
    }
    deps.sendJson(ctx.res, 200, { enabled: body.enabled });
  } catch (err) {
    deps.sendJson(ctx.res, 500, { error: 'Failed to update config', details: err.message });
  }
}

function handleGetCodexProvider(ctx, deps) {
  try {
    const status = deps.codexConfig.getStatus(ctx.codexHome);
    deps.sendJson(ctx.res, 200, status);
  } catch (err) {
    deps.sendJson(ctx.res, 500, { error: 'Failed to read Codex provider config', details: err.message });
  }
}

module.exports = { register };
