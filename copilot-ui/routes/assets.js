'use strict';

const fs = require('fs');
const path = require('path');

const assetsLib = require('../lib/assets');
const { sendJson: defaultSendJson, sendText: defaultSendText, readJsonBody: defaultReadJsonBody } = require('./_helpers');

function safeResolveUnder(baseAbs, relPath) {
  if (typeof relPath !== 'string' || relPath.length === 0) throw new Error('path must be a non-empty string');
  if (path.isAbsolute(relPath)) throw new Error('path must be relative');
  const base = path.resolve(baseAbs);
  const abs = path.resolve(base, relPath);
  const prefix = base.endsWith(path.sep) ? base : base + path.sep;
  if (!abs.startsWith(prefix)) throw new Error('path escapes base');
  return abs;
}

function safeRealpath(absPath, fsImpl = fs) {
  try {
    if (typeof fsImpl.realpathSync?.native === 'function') {
      return fsImpl.realpathSync.native(absPath);
    }
    if (typeof fsImpl.realpathSync === 'function') {
      return fsImpl.realpathSync(absPath);
    }
  } catch {
    return null;
  }
  return null;
}

function isPathWithinRoot(rootAbs, candidateAbs) {
  const normalizeComparablePath = (inputPath) => {
    const resolved = path.resolve(inputPath);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };

  const root = normalizeComparablePath(rootAbs);
  const candidate = normalizeComparablePath(candidateAbs);
  if (candidate === root) {
    return true;
  }
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  return candidate.startsWith(prefix);
}

function assertInspectableAssetPath(absPath, assetsHomeAbs, fsImpl = fs) {
  if (!fsImpl.existsSync(absPath)) {
    return absPath;
  }

  const realPath = safeRealpath(absPath, fsImpl);
  if (!realPath) {
    throw Object.assign(new Error('Unable to resolve asset path'), { statusCode: 404 });
  }
  if (!isPathWithinRoot(assetsHomeAbs, realPath)) {
    throw Object.assign(new Error('Resolved asset path escapes supported Copilot roots'), { statusCode: 400 });
  }
  return realPath;
}

function extractTriggers(absPath, fsImpl = fs) {
  try {
    const text = fsImpl.readFileSync(absPath, 'utf8');
    const match = text.match(/Triggers?\s+on:\s*(.+)/i);
    return match ? match[1].trim() : '';
  } catch {
    return '';
  }
}

function resolvePointerTarget(relPath, absPath, assetsHomeAbs, assets, fsImpl, safeResolveUnderFn) {
  if (!assets.isPointerFile || !assets.isPointerFile(absPath)) {
    return absPath;
  }

  const pointerText = assets.readTextFileSafe(absPath, 64 * 1024);
  const vaultRefMatch = String(pointerText || '').match(/vault-ref:\s*(\S+)/i);
  if (!vaultRefMatch?.[1]) {
    return absPath;
  }

  const pointerTarget = vaultRefMatch[1].trim().replace(/[\\/]+$/, '');
  const candidatePath = /\.md$/i.test(pointerTarget) ? pointerTarget : `${pointerTarget}/SKILL.md`;
  try {
    const resolvedTarget = safeResolveUnderFn(assetsHomeAbs, candidatePath);
    if (fsImpl.existsSync(resolvedTarget)) {
      return resolvedTarget;
    }
  } catch {
    // Keep the original pointer path when the vault-ref is malformed or escapes the home.
  }

  return absPath;
}

function handleAssetsManaged(ctx, deps) {
  const { res, copilotHomeAbs } = ctx;
  const { sendJson, assets, engineRoot } = deps;
  const assetsHomeAbs = copilotHomeAbs;
  const managed = assets.getManagedAssetStatuses(engineRoot, assetsHomeAbs);
  sendJson(res, 200, { managed });
}

function handleAssetsInstalled(ctx, deps) {
  const { res, copilotHomeAbs } = ctx;
  const { sendJson, assets } = deps;
  const assetsHomeAbs = copilotHomeAbs;
  const agents = assets.listInstalledAgents(assetsHomeAbs);
  const skills = typeof assets.listInstalledSkillInventory === 'function'
    ? assets.listInstalledSkillInventory(assetsHomeAbs)
    : assets.listInstalledSkills(assetsHomeAbs);
  const prompts = assets.listInstalledPrompts(assetsHomeAbs);
  const instructions = assets.getInstalledInstructions(assetsHomeAbs);
  sendJson(res, 200, { agents, skills, prompts, instructions });
}

function handleAssetsSyncAll(ctx, deps) {
  const { req, res, copilotHomeAbs } = ctx;
  const { sendJson, readJsonBody, assets, engineRoot } = deps;
  const assetsHomeAbs = copilotHomeAbs;

  readJsonBody(req)
    .then((body) => {
      const result = assets.syncAll(engineRoot, assetsHomeAbs, {
        dryRun: Boolean(body.dryRun),
        force: Boolean(body.force),
        pointerMode: body.pointerMode !== false,
      });
      sendJson(res, 200, { result });
    })
    .catch((e) => sendJson(res, e.statusCode || 400, { error: String(e.message || e) }));
}

function handleAssetsSync(ctx, deps) {
  const { req, res, copilotHomeAbs } = ctx;
  const { sendJson, readJsonBody, assets, engineRoot } = deps;
  const assetsHomeAbs = copilotHomeAbs;

  readJsonBody(req)
    .then((body) => {
      const assetId = body.assetId;
      if (typeof assetId !== 'string' || !assetId) throw Object.assign(new Error('assetId is required'), { statusCode: 400 });
      const result = assets.syncAsset(engineRoot, assetsHomeAbs, assetId, {
        dryRun: Boolean(body.dryRun),
        force: Boolean(body.force),
        pointerMode: body.pointerMode !== false,
      });
      sendJson(res, 200, { result });
    })
    .catch((e) => sendJson(res, e.statusCode || 400, { error: String(e.message || e) }));
}

function handleSkillsPreview(ctx, deps) {
  const { res, copilotHomeAbs } = ctx;
  const { sendJson, assets, path, extractTriggers, engineRoot } = deps;
  const assetsHomeAbs = copilotHomeAbs;

  try {
    if (engineRoot && typeof assets.getSkillCatalogPreview === 'function') {
      const skills = assets.getSkillCatalogPreview(engineRoot, assetsHomeAbs);
      sendJson(res, 200, { skills });
      return;
    }

    const skills = typeof assets.listInstalledSkillInventory === 'function'
      ? assets.listInstalledSkillInventory(assetsHomeAbs)
      : assets.listInstalledSkills(assetsHomeAbs);
    const vaultDir = assets.getVaultDir ? assets.getVaultDir(assetsHomeAbs) : path.join(assetsHomeAbs, 'skills-vault');
    const result = skills.map((s) => {
      const triggers = extractTriggers(s.absPath);
      const vaultPath = s.kind === 'pointer'
        ? path.join(vaultDir, ...(s.namespace ? [s.namespace] : []), s.name, 'SKILL.md')
        : s.kind === 'vault'
          ? s.absPath
        : null;
      return {
        assetId: s.assetId,
        name: s.name,
        kind: s.kind || 'full',
        loadMode: s.kind === 'vault' ? 'on-demand' : 'always',
        availability: s.kind === 'pointer' ? 'scan+vault' : s.kind === 'vault' ? 'vault-only' : 'scan-path',
        triggers,
        absPath: s.absPath,
        vaultPath,
        viewPath: s.viewPath || `skills/${s.name}/SKILL.md`,
        namespace: s.namespace,
        provider: s.provider,
        sourcePackage: s.sourcePackage,
        readOnly: s.readOnly === true,
      };
    });
    sendJson(res, 200, { skills: result });
  } catch (e) {
    sendJson(res, 500, { error: String(e.message || e) });
  }
}

function handleAssetsRemove(ctx, deps) {
  const { req, res, copilotHomeAbs } = ctx;
  const { sendJson, readJsonBody, assets, engineRoot } = deps;
  const assetsHomeAbs = copilotHomeAbs;

  readJsonBody(req)
    .then((body) => {
      const assetId = body.assetId;
      if (typeof assetId !== 'string' || !assetId) throw Object.assign(new Error('assetId is required'), { statusCode: 400 });
      const managed = assets.getManagedAssetStatuses(engineRoot, assetsHomeAbs);
      const asset = managed.find((a) => a.id === assetId);
      if (!asset) throw Object.assign(new Error(`Unknown assetId: ${assetId}`), { statusCode: 404 });
      const result = assets.removeAsset(assetsHomeAbs, asset, { force: Boolean(body.force) });
      sendJson(res, 200, { result });
    })
    .catch((e) => sendJson(res, e.statusCode || 400, { error: String(e.message || e) }));
}

function handleAssetsView(ctx, deps) {
  const { res, u, copilotHomeAbs } = ctx;
  const { sendJson, sendText, assets, fs, path, safeResolveUnder } = deps;
  const assetsHomeAbs = copilotHomeAbs;

  const rel = u.searchParams.get('path');
  if (!rel) {
    sendJson(res, 400, { error: 'Missing ?path=' });
    return;
  }
  try {
    let abs = safeResolveUnder(assetsHomeAbs, rel);
    abs = assertInspectableAssetPath(abs, assetsHomeAbs, fs);
    abs = resolvePointerTarget(rel, abs, assetsHomeAbs, assets, fs, safeResolveUnder);
    abs = assertInspectableAssetPath(abs, assetsHomeAbs, fs);
    const text = assets.readTextFileSafe(abs, 512 * 1024);
    if (text == null) {
      sendText(res, 404, 'Asset not found at the resolved path. If this is a repo-scoped asset, ensure the repo context is active.');
      return;
    }
    sendText(res, 200, text, 'text/plain; charset=utf-8');
  } catch (e) {
    sendJson(res, 400, { error: String(e.message || e) });
  }
}

function handleAssetsDelete(ctx, deps) {
  const { req, res, copilotHomeAbs } = ctx;
  const { sendJson, readJsonBody, fs, safeResolveUnder } = deps;
  const assetsHomeAbs = copilotHomeAbs;

  readJsonBody(req)
    .then((body) => {
      const relPath = body.path;
      const force = Boolean(body.force);
      if (typeof relPath !== 'string' || !relPath.trim()) throw Object.assign(new Error('path is required'), { statusCode: 400 });

      // Guardrails: only delete within agents/ or skills/.
      let normalized = relPath.split('\\').join('/').replace(/^\/+/, '');
      if (!(normalized.startsWith('agents/') || normalized.startsWith('skills/'))) {
        throw Object.assign(new Error('Only agents/* or skills/* may be deleted'), { statusCode: 400 });
      }
      if (normalized === 'agents' || normalized === 'skills' || normalized === 'agents/' || normalized === 'skills/') {
        throw Object.assign(new Error('Refusing to delete top-level directory'), { statusCode: 400 });
      }
      if (normalized.startsWith('agents/') && !normalized.toLowerCase().endsWith('.agent.md')) {
        throw Object.assign(new Error('Refusing to delete non-agent file under agents/ (expected *.agent.md)'), { statusCode: 400 });
      }
      if (normalized.startsWith('skills/')) {
        const match = normalized.match(/^skills\/([^/]+)(?:\/SKILL\.md)?$/i);
        if (!match) {
          throw Object.assign(new Error('Refusing to delete nested skill paths under skills/'), { statusCode: 400 });
        }
        const skillRoot = safeResolveUnder(assetsHomeAbs, `skills/${match[1]}`);
        const skillFile = path.join(skillRoot, 'SKILL.md');
        if (!fs.existsSync(skillFile)) {
          throw Object.assign(new Error('Refusing to delete unsupported skill namespace roots'), { statusCode: 400 });
        }
        normalized = `skills/${match[1]}`;
      }

      if (!force) {
        throw Object.assign(new Error('Deletion requires force=true'), { statusCode: 400 });
      }

      const abs = safeResolveUnder(assetsHomeAbs, normalized);
      if (!fs.existsSync(abs)) {
        throw Object.assign(new Error('Not found'), { statusCode: 404 });
      }

      const stat = fs.statSync(abs);
      if (stat.isDirectory()) {
        fs.rmSync(abs, { recursive: true, force: true });
      } else {
        fs.unlinkSync(abs);
      }

      sendJson(res, 200, { ok: true, deleted: normalized });
    })
    .catch((e) => sendJson(res, e.statusCode || 400, { error: String(e.message || e) }));
}

function register(deps = {}) {
  const resolvedFs = deps.fs || fs;
  const resolvedDeps = {
    fs: resolvedFs,
    path: deps.path || path,
    assets: deps.assets || assetsLib,
    sendJson: deps.sendJson || defaultSendJson,
    sendText: deps.sendText || defaultSendText,
    readJsonBody: deps.readJsonBody || defaultReadJsonBody,
    safeResolveUnder: deps.safeResolveUnder || safeResolveUnder,
    extractTriggers: deps.extractTriggers || ((absPath) => extractTriggers(absPath, resolvedFs)),
    engineRoot: deps.engineRoot,
  };

  return [
    {
      method: 'GET',
      path: '/api/assets/managed',
      handler: (ctx) => handleAssetsManaged(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: '/api/assets/installed',
      handler: (ctx) => handleAssetsInstalled(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/assets/sync-all',
      handler: (ctx) => handleAssetsSyncAll(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/assets/sync',
      handler: (ctx) => handleAssetsSync(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: '/api/skills/preview',
      handler: (ctx) => handleSkillsPreview(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/assets/remove',
      handler: (ctx) => handleAssetsRemove(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: '/api/assets/view',
      handler: (ctx) => handleAssetsView(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/assets/delete',
      handler: (ctx) => handleAssetsDelete(ctx, resolvedDeps),
    },
  ];
}

module.exports = { register };
