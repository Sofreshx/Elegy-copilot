const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function toPosixRelPath(p) {
  return String(p || '').replace(/\\/g, '/');
}

function safeReadDir(dirAbs, opts) {
  try {
    return fs.readdirSync(dirAbs, opts);
  } catch {
    return [];
  }
}

function deriveAssetId(type, fileOrDirName) {
  const n = String(fileOrDirName || '').trim();
  if (!n) return null;
  if (type === 'agent') {
    const base = n.replace(/\.agent\.md$/i, '').replace(/^agent-/, '');
    return `agent-${base}`;
  }
  if (type === 'prompt') {
    const base = n.replace(/\.prompt\.md$/i, '');
    return `prompt-${base}`;
  }
  if (type === 'skill') {
    return `skill-${n}`;
  }
  return null;
}

function expandAssetsFromSourcePatterns(manifest, engineRootAbs) {
  if (!manifest || typeof manifest !== 'object') return manifest;

  const patterns = Array.isArray(manifest.sourcePatterns) ? manifest.sourcePatterns : [];
  if (!patterns.length) return manifest;

  const assets = Array.isArray(manifest.assets) ? [...manifest.assets] : [];
  const bySource = new Set();
  const byDestination = new Set();

  for (const a of assets) {
    if (!a || typeof a !== 'object') continue;
    if (typeof a.source === 'string' && a.source.trim()) bySource.add(toPosixRelPath(a.source.trim()));
    if (typeof a.destination === 'string' && a.destination.trim()) byDestination.add(toPosixRelPath(a.destination.trim()));
  }

  for (const p of patterns) {
    if (!p || typeof p !== 'object') continue;
    const type = String(p.type || '').trim();
    const sourceGlob = toPosixRelPath(String(p.sourceGlob || '').trim());
    const destinationDir = toPosixRelPath(String(p.destinationDir || '').trim()).replace(/\/$/, '');
    if (!type || !sourceGlob || !destinationDir) continue;

    // This is intentionally a minimal glob implementation: it supports only the simple
    // patterns we publish in engine-assets/manifest.json (flat "*" in final segment).
    if (sourceGlob === 'engine-assets/agents/*.agent.md' && type === 'agent') {
      const dirAbs = path.join(engineRootAbs, 'engine-assets', 'agents');
      const entries = safeReadDir(dirAbs, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isFile()) continue;
        if (!e.name.toLowerCase().endsWith('.agent.md')) continue;
        const fileName = e.name;

        const source = `engine-assets/agents/${fileName}`;
        const destination = `${destinationDir}/${fileName}`;
        if (bySource.has(source) || byDestination.has(destination)) continue;

        const id = deriveAssetId(type, fileName);
        if (!id) continue;
        assets.push({ id, type, source, destination });
        bySource.add(source);
        byDestination.add(destination);
      }
      continue;
    }

    if (sourceGlob === 'engine-assets/prompts/*.prompt.md' && type === 'prompt') {
      const dirAbs = path.join(engineRootAbs, 'engine-assets', 'prompts');
      const entries = safeReadDir(dirAbs, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isFile()) continue;
        if (!e.name.toLowerCase().endsWith('.prompt.md')) continue;
        const fileName = e.name;

        const source = `engine-assets/prompts/${fileName}`;
        const destination = `${destinationDir}/${fileName}`;
        if (bySource.has(source) || byDestination.has(destination)) continue;

        const id = deriveAssetId(type, fileName);
        if (!id) continue;
        assets.push({ id, type, source, destination });
        bySource.add(source);
        byDestination.add(destination);
      }
      continue;
    }

    if (sourceGlob === 'engine-assets/skills/*' && type === 'skill') {
      const dirAbs = path.join(engineRootAbs, 'engine-assets', 'skills');
      const entries = safeReadDir(dirAbs, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        const name = e.name;
        const source = `engine-assets/skills/${name}`;
        const destination = `${destinationDir}/${name}`;
        if (bySource.has(source) || byDestination.has(destination)) continue;
        const id = deriveAssetId(type, name);
        if (!id) continue;
        assets.push({ id, type, source, destination });
        bySource.add(source);
        byDestination.add(destination);
      }
      continue;
    }
  }

  assets.sort((a, b) => {
    const at = String(a.type || '');
    const bt = String(b.type || '');
    if (at !== bt) return at.localeCompare(bt);
    const ad = String(a.destination || '');
    const bd = String(b.destination || '');
    return ad.localeCompare(bd);
  });

  return { ...manifest, assets };
}

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
  const manifestPath = path.join(rootAbs, 'engine-assets', 'manifest.json');
  const raw = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(raw);

  if (!manifest || typeof manifest !== 'object') throw new Error('Invalid manifest JSON');
  if (!Array.isArray(manifest.assets)) throw new Error('Manifest missing assets[]');

  const expanded = expandAssetsFromSourcePatterns(manifest, rootAbs);
  return {
    ...expanded,
    _manifestPath: manifestPath,
    _engineRoot: rootAbs,
  };
}

function getAssetPaths(engineRoot, destinationHome, asset, opts) {
  const engineAbs = path.resolve(engineRoot);
  const homeAbs = path.resolve(destinationHome);

  const sourceRel = asset.source;
  const sourceAbs = resolveUnder(engineAbs, sourceRel);
  const destinationAbs = resolveUnder(homeAbs, asset.destination);

  return { engineAbs, homeAbs, sourceAbs, destinationAbs, sourceRel };
}

function listInstalledAgents(home) {
  const agentsDir = path.join(path.resolve(home), 'agents');
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

function listInstalledSkills(home) {
  const skillsDir = path.join(path.resolve(home), 'skills');
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

function listInstalledPrompts(home) {
  const promptsDir = path.join(path.resolve(home), 'prompts');
  try {
    const entries = fs.readdirSync(promptsDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.prompt.md'))
      .map((e) => ({
        name: e.name.replace(/\.prompt\.md$/i, ''),
        fileName: e.name,
        absPath: path.join(promptsDir, e.name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

function getInstalledInstructions(home) {
  const absPath = path.join(path.resolve(home), 'copilot-instructions.md');
  try {
    return fs.existsSync(absPath) && fs.statSync(absPath).isFile() ? { installed: true, absPath } : { installed: false, absPath };
  } catch {
    return { installed: false, absPath };
  }
}

function getManagedAssetStatuses(engineRoot, destinationHome) {
  const manifest = loadManifest(engineRoot);
  return manifest.assets.map((asset) => {
    const { sourceAbs, destinationAbs, sourceRel } = getAssetPaths(engineRoot, destinationHome, asset);
    const sourceHash = sha256PathHex(sourceAbs);
    const installed = fs.existsSync(destinationAbs);
    const destinationHash = installed ? sha256PathHex(destinationAbs) : null;
    const upToDate = Boolean(installed && sourceHash && destinationHash && sourceHash === destinationHash);

    return {
      ...asset,
      managed: true,
      
      source: sourceRel,
      sourceAbs,
      destinationAbs,
      installed,
      upToDate,
      sourceHash,
      destinationHash,
    };
  });
}

function syncAsset(engineRoot, destinationHome, assetId, opts) {
  const { dryRun = false, force = false } = opts || {};
  const manifest = loadManifest(engineRoot);
  const asset = manifest.assets.find((a) => a.id === assetId);
  if (!asset) throw new Error(`Unknown assetId: ${assetId}`);

  const { sourceAbs, destinationAbs, sourceRel } = getAssetPaths(engineRoot, destinationHome, asset);
  const sourceHash = sha256PathHex(sourceAbs);
  if (!sourceHash) throw new Error(`Source missing/unreadable: ${sourceAbs}`);

  const installed = fs.existsSync(destinationAbs);
  const destinationHash = installed ? sha256PathHex(destinationAbs) : null;

  if (installed && destinationHash && destinationHash === sourceHash) {
    return {
      ...asset,
      managed: true,
      
      source: sourceRel,
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
      
      source: sourceRel,
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
      
      source: sourceRel,
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
    
    source: sourceRel,
    sourceAbs,
    destinationAbs,
    action,
    installed: true,
    upToDate: Boolean(newDestinationHash && newDestinationHash === sourceHash),
    sourceHash,
    destinationHash: newDestinationHash,
  };
}

function syncAll(engineRoot, destinationHome, opts) {
  const manifest = loadManifest(engineRoot);
  return manifest.assets.map((a) => syncAsset(engineRoot, destinationHome, a.id, opts));
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

function removeAsset(destinationHome, asset, opts) {
  const { force = false } = opts || {};
  if (!asset || typeof asset !== 'object') throw new Error('asset must be an object');

  const homeAbs = path.resolve(destinationHome);
  let destinationAbs = asset.destinationAbs || asset.destinationPath;
  if (!destinationAbs) {
    const destinationRel = asset.destination || asset.destinationRel;
    if (!destinationRel) throw new Error('asset is missing destination info');
    destinationAbs = resolveUnder(homeAbs, destinationRel);
  } else {
    destinationAbs = path.resolve(destinationAbs);
  }

  const homePrefix = homeAbs.endsWith(path.sep) ? homeAbs : homeAbs + path.sep;
  if (!destinationAbs.startsWith(homePrefix)) {
    throw new Error('Refusing to delete outside destination home');
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
    tryRemoveEmptyDirsUp(path.dirname(destinationAbs), homeAbs);
  } else {
    fs.unlinkSync(destinationAbs);
    tryRemoveEmptyDirsUp(path.dirname(destinationAbs), homeAbs);
  }

  return { action: 'removed', destinationAbs };
}

module.exports = {
  
  loadManifest,
  listInstalledAgents,
  listInstalledSkills,
  listInstalledPrompts,
  getInstalledInstructions,
  getManagedAssetStatuses,
  readTextFileSafe,
  syncAsset,
  syncAll,
  removeAsset,
};

