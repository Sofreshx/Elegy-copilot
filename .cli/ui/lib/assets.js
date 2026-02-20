const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function resolveUnder(baseAbs, relPath) {
  if (typeof relPath !== 'string' || relPath.length === 0) {
    throw new Error('Path must be a non-empty string');
  }
  if (path.isAbsolute(relPath)) {
    throw new Error(`Expected relative path, got absolute: ${relPath}`);
  }

  const base = path.resolve(baseAbs);
  const abs = path.resolve(base, relPath);
  const prefix = base.endsWith(path.sep) ? base : base + path.sep;
  if (!abs.startsWith(prefix)) {
    throw new Error(`Resolved path escapes base directory: ${relPath}`);
  }
  return abs;
}

function sha256FileHex(absPath) {
  try {
    const hash = crypto.createHash('sha256');
    const fd = fs.openSync(absPath, 'r');
    try {
      const buf = Buffer.allocUnsafe(64 * 1024);
      while (true) {
        const bytes = fs.readSync(fd, buf, 0, buf.length, null);
        if (!bytes) break;
        hash.update(buf.subarray(0, bytes));
      }
    } finally {
      fs.closeSync(fd);
    }
    return hash.digest('hex');
  } catch {
    return null;
  }
}

function walkFilesRecursive(dirAbs) {
  const results = [];
  const stack = [dirAbs];

  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const abs = path.join(cur, e.name);
      if (e.isDirectory()) {
        stack.push(abs);
        continue;
      }
      if (e.isFile()) {
        results.push(abs);
      }
    }
  }

  results.sort((a, b) => a.localeCompare(b));
  return results;
}

function sha256PathHex(absPath) {
  try {
    const stat = fs.statSync(absPath);
    if (stat.isFile()) return sha256FileHex(absPath);
    if (!stat.isDirectory()) return null;

    const base = path.resolve(absPath);
    const files = walkFilesRecursive(base);
    const hash = crypto.createHash('sha256');
    for (const f of files) {
      const rel = path.relative(base, f).split(path.sep).join('/');
      const fh = sha256FileHex(f);
      if (!fh) return null;
      hash.update(rel);
      hash.update('\0');
      hash.update(fh);
      hash.update('\n');
    }
    return hash.digest('hex');
  } catch {
    return null;
  }
}

function readTextFileSafe(absPath, maxBytes) {
  try {
    const stat = fs.statSync(absPath);
    if (!stat.isFile()) return null;

    const limit = Number.isFinite(maxBytes) && maxBytes > 0 ? Math.floor(maxBytes) : 1024 * 1024;
    const fd = fs.openSync(absPath, 'r');
    try {
      const toRead = Math.min(limit, stat.size);
      const buf = Buffer.alloc(toRead);
      const bytesRead = fs.readSync(fd, buf, 0, toRead, 0);
      let text = buf.subarray(0, bytesRead).toString('utf8');
      if (stat.size > limit) text += '\n…(truncated)\n';
      return text;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

function loadManifest(engineRoot) {
  const rootAbs = path.resolve(engineRoot);
  const manifestPath = path.join(rootAbs, '.cli', 'manifest.json');
  const raw = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(raw);

  if (!manifest || typeof manifest !== 'object') throw new Error('Invalid manifest JSON');
  if (!Array.isArray(manifest.assets)) throw new Error('Manifest missing assets[]');

  return {
    ...manifest,
    _manifestPath: manifestPath,
    _engineRoot: rootAbs,
    _cliRoot: path.join(rootAbs, '.cli'),
  };
}

function getAssetPaths(engineRoot, copilotHome, asset) {
  const engineAbs = path.resolve(engineRoot);
  const copilotAbs = path.resolve(copilotHome);
  const cliRoot = path.join(engineAbs, '.cli');

  // Sources are expected to be relative to the instruction-engine repo root.
  // e.g. ".github/agents/..." or ".cli/instructions/...".
  // (We keep cliRoot computed for legacy debugging / future extension.)
  void cliRoot;
  const sourceAbs = resolveUnder(engineAbs, asset.source);
  const destinationAbs = resolveUnder(copilotAbs, asset.destination);

  return { engineAbs, copilotAbs, cliRoot, sourceAbs, destinationAbs };
}

function listInstalledAgents(copilotHome) {
  const agentsDir = path.join(path.resolve(copilotHome), 'agents');
  try {
    const entries = fs.readdirSync(agentsDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.agent.md'))
      .map((e) => {
        const name = e.name.slice(0, -'.agent.md'.length);
        return { name, fileName: e.name, absPath: path.join(agentsDir, e.name) };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

function listInstalledSkills(copilotHome) {
  const skillsDir = path.join(path.resolve(copilotHome), 'skills');
  try {
    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => {
        const absPath = path.join(skillsDir, e.name, 'SKILL.md');
        return fs.existsSync(absPath) ? { name: e.name, absPath } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

function getManagedAssetStatuses(engineRoot, copilotHome) {
  const manifest = loadManifest(engineRoot);
  return manifest.assets.map((asset) => {
    const { sourceAbs, destinationAbs } = getAssetPaths(engineRoot, copilotHome, asset);
    const sourceHash = sha256PathHex(sourceAbs);
    const installed = fs.existsSync(destinationAbs);
    const destinationHash = installed ? sha256PathHex(destinationAbs) : null;
    const upToDate = Boolean(installed && sourceHash && destinationHash && sourceHash === destinationHash);

    return {
      ...asset,
      managed: true,
      sourceAbs,
      destinationAbs,
      installed,
      upToDate,
      sourceHash,
      destinationHash,
    };
  });
}

function syncAsset(engineRoot, copilotHome, assetId, opts) {
  const { dryRun = false, force = false } = opts || {};
  const manifest = loadManifest(engineRoot);
  const asset = manifest.assets.find((a) => a.id === assetId);
  if (!asset) throw new Error(`Unknown assetId: ${assetId}`);

  const { sourceAbs, destinationAbs } = getAssetPaths(engineRoot, copilotHome, asset);
  const sourceHash = sha256PathHex(sourceAbs);
  if (!sourceHash) throw new Error(`Source missing/unreadable: ${sourceAbs}`);

  const installed = fs.existsSync(destinationAbs);
  const destinationHash = installed ? sha256PathHex(destinationAbs) : null;

  if (installed && destinationHash && destinationHash === sourceHash) {
    return {
      ...asset,
      managed: true,
      sourceAbs,
      destinationAbs,
      action: 'noop',
      installed: true,
      upToDate: true,
      sourceHash,
      destinationHash,
    };
  }

  if (installed && !force && !destinationHash) {
    return {
      ...asset,
      managed: true,
      sourceAbs,
      destinationAbs,
      action: 'skipped',
      reason: 'destination_unreadable',
      installed: true,
      upToDate: false,
      sourceHash,
      destinationHash,
    };
  }

  if (installed && !force && destinationHash && destinationHash !== sourceHash) {
    return {
      ...asset,
      managed: true,
      sourceAbs,
      destinationAbs,
      action: 'skipped',
      reason: 'destination_differs_from_source',
      installed: true,
      upToDate: false,
      sourceHash,
      destinationHash,
    };
  }

  const action = installed ? (dryRun ? 'would_update' : 'updated') : (dryRun ? 'would_install' : 'installed');

  if (!dryRun) {
    fs.mkdirSync(path.dirname(destinationAbs), { recursive: true });
    const st = fs.statSync(sourceAbs);
    if (st.isDirectory()) {
      fs.rmSync(destinationAbs, { recursive: true, force: true });
      if (typeof fs.cpSync === 'function') {
        fs.cpSync(sourceAbs, destinationAbs, { recursive: true, force: true });
      } else {
        // Fallback for older Node: naive recursive copy.
        const files = walkFilesRecursive(sourceAbs);
        for (const f of files) {
          const rel = path.relative(sourceAbs, f);
          const out = path.join(destinationAbs, rel);
          fs.mkdirSync(path.dirname(out), { recursive: true });
          fs.copyFileSync(f, out);
        }
      }
    } else {
      fs.copyFileSync(sourceAbs, destinationAbs);
    }
  }

  const newDestinationHash = dryRun ? destinationHash : sha256PathHex(destinationAbs);

  return {
    ...asset,
    managed: true,
    sourceAbs,
    destinationAbs,
    action,
    installed: true,
    upToDate: Boolean(newDestinationHash && newDestinationHash === sourceHash),
    sourceHash,
    destinationHash: newDestinationHash,
  };
}

function syncAll(engineRoot, copilotHome, opts) {
  const manifest = loadManifest(engineRoot);
  return manifest.assets.map((a) => syncAsset(engineRoot, copilotHome, a.id, opts));
}

function tryRemoveEmptyDirsUp(startDirAbs, stopDirAbs) {
  const stop = path.resolve(stopDirAbs);
  let current = path.resolve(startDirAbs);
  const stopPrefix = stop.endsWith(path.sep) ? stop : stop + path.sep;

  while (current.startsWith(stopPrefix) && current !== stop) {
    try {
      const entries = fs.readdirSync(current);
      if (entries.length !== 0) break;
      fs.rmdirSync(current);
      current = path.dirname(current);
    } catch {
      break;
    }
  }
}

function removeAsset(copilotHome, asset, opts) {
  const { force = false } = opts || {};
  if (!asset || typeof asset !== 'object') throw new Error('asset must be an object');

  const copilotAbs = path.resolve(copilotHome);
  let destinationAbs = asset.destinationAbs || asset.destinationPath;
  if (!destinationAbs) {
    const destinationRel = asset.destination || asset.destinationRel;
    if (!destinationRel) throw new Error('asset is missing destination info');
    destinationAbs = resolveUnder(copilotAbs, destinationRel);
  } else {
    destinationAbs = path.resolve(destinationAbs);
  }

  const copilotPrefix = copilotAbs.endsWith(path.sep) ? copilotAbs : copilotAbs + path.sep;
  if (!destinationAbs.startsWith(copilotPrefix)) {
    throw new Error('Refusing to delete outside copilotHome');
  }

  const isManaged = asset.managed === true;
  const differsFromSource = Boolean(
    asset.sourceHash &&
      asset.destinationHash &&
      asset.sourceHash !== asset.destinationHash
  );
  const canProveUpToDate = Boolean(asset.upToDate === true || (!differsFromSource && asset.sourceHash && asset.destinationHash));

  if (!force) {
    if (!isManaged) {
      return { action: 'blocked', reason: 'unmanaged_asset', destinationAbs };
    }
    if (!canProveUpToDate) {
      return { action: 'blocked', reason: 'destination_differs_or_unknown', destinationAbs };
    }
  }

  if (!fs.existsSync(destinationAbs)) {
    return { action: 'not_found', destinationAbs };
  }

  const stat = fs.statSync(destinationAbs);
  if (!(stat.isFile() || stat.isDirectory())) {
    return { action: 'blocked', reason: 'not_a_file_or_dir', destinationAbs };
  }

  const currentDestinationHash = sha256PathHex(destinationAbs);
  if (!force && asset.destinationHash && currentDestinationHash && currentDestinationHash !== asset.destinationHash) {
    return { action: 'blocked', reason: 'destination_changed_since_status', destinationAbs };
  }

  if (stat.isDirectory()) {
    fs.rmSync(destinationAbs, { recursive: true, force: true });
    tryRemoveEmptyDirsUp(path.dirname(destinationAbs), copilotAbs);
  } else {
    fs.unlinkSync(destinationAbs);
    tryRemoveEmptyDirsUp(path.dirname(destinationAbs), copilotAbs);
  }

  return { action: 'removed', destinationAbs };
}

module.exports = {
  loadManifest,
  listInstalledAgents,
  listInstalledSkills,
  getManagedAssetStatuses,
  readTextFileSafe,
  syncAsset,
  syncAll,
  removeAsset,
};

