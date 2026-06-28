import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

export function getUserHome() {
  return process.env.HOME || process.env.USERPROFILE || os.homedir();
}

export function normalizeRel(value) {
  return String(value || '').replace(/\\/g, '/');
}

export function shaText(text) {
  return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex');
}

export function shaFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

export function dirHash(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return '';
  }

  const files = [];

  function walk(current, base) {
    const entries = fs.readdirSync(current, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      const rel = path.relative(base, abs).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        walk(abs, base);
      } else if (entry.isFile()) {
        files.push(`${rel}\0${shaFile(abs)}`);
      }
    }
  }

  walk(dirPath, dirPath);
  return crypto.createHash('sha256').update(files.join('\n')).digest('hex');
}

export function ensureDir(targetPath, dryRun, log = console.log) {
  if (fs.existsSync(targetPath)) {
    return { action: 'exists', path: targetPath };
  }

  if (dryRun) {
    log(`[DRY-RUN] mkdir ${targetPath}`);
    return { action: 'would_create_dir', path: targetPath };
  }

  fs.mkdirSync(targetPath, { recursive: true });
  return { action: 'created_dir', path: targetPath };
}

function createTempSibling(targetPath, suffix = 'tmp') {
  return path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.${suffix}`,
  );
}

function removePathSafe(targetPath) {
  try {
    if (!fs.existsSync(targetPath)) {
      return;
    }
    const stat = fs.statSync(targetPath);
    if (stat.isDirectory()) {
      fs.rmSync(targetPath, { recursive: true, force: true });
      return;
    }
    fs.rmSync(targetPath, { force: true });
  } catch {
    // Best-effort cleanup for temp/backup paths.
  }
}

function replacePathAtomically(tempPath, targetPath) {
  const backupPath = fs.existsSync(targetPath) ? createTempSibling(targetPath, 'bak') : '';

  try {
    if (backupPath) {
      fs.renameSync(targetPath, backupPath);
    }
    fs.renameSync(tempPath, targetPath);
    removePathSafe(backupPath);
  } catch (error) {
    try {
      if (!fs.existsSync(targetPath) && backupPath && fs.existsSync(backupPath)) {
        fs.renameSync(backupPath, targetPath);
      }
    } catch {
      // Ignore rollback failures and rethrow the original error.
    }
    removePathSafe(tempPath);
    throw error;
  }
}

function copyDirectoryContents(sourcePath, destinationPath) {
  fs.mkdirSync(destinationPath, { recursive: true });
  const entries = fs.readdirSync(sourcePath, { withFileTypes: true });
  for (const entry of entries) {
    const sourceEntryPath = path.join(sourcePath, entry.name);
    const destinationEntryPath = path.join(destinationPath, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryContents(sourceEntryPath, destinationEntryPath);
      continue;
    }
    if (entry.isFile()) {
      fs.mkdirSync(path.dirname(destinationEntryPath), { recursive: true });
      fs.copyFileSync(sourceEntryPath, destinationEntryPath);
    }
  }
}

function copyFileAtomically(sourcePath, destinationPath) {
  const tempPath = createTempSibling(destinationPath);
  fs.copyFileSync(sourcePath, tempPath);
  replacePathAtomically(tempPath, destinationPath);
}

function copyTextAtomically(content, destinationPath) {
  const tempPath = createTempSibling(destinationPath);
  fs.writeFileSync(tempPath, content, 'utf8');
  replacePathAtomically(tempPath, destinationPath);
}

export function writeTextAtomically(content, destinationPath) {
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  copyTextAtomically(content, destinationPath);
}

function copyDirectoryAtomically(sourcePath, destinationPath) {
  const tempPath = createTempSibling(destinationPath, 'tmpdir');
  fs.mkdirSync(tempPath, { recursive: true });
  try {
    copyDirectoryContents(sourcePath, tempPath);
    replacePathAtomically(tempPath, destinationPath);
  } catch (error) {
    removePathSafe(tempPath);
    throw error;
  }
}

function buildSyncResult(action, targetPath, metadata = {}) {
  return {
    action,
    path: targetPath,
    ...metadata,
  };
}

function logSyncAction(action, targetPath, log) {
  if (action === 'created') {
    log(`[CREATE] ${targetPath}`);
    return;
  }
  if (action === 'updated') {
    log(`[UPDATE] ${targetPath}`);
    return;
  }
  if (action === 'would_create') {
    log(`[DRY-RUN] CREATE ${targetPath}`);
    return;
  }
  if (action === 'would_update') {
    log(`[DRY-RUN] UPDATE ${targetPath}`);
    return;
  }
  if (action === 'skipped') {
    log(`[SKIP]   ${targetPath} (up-to-date)`);
    return;
  }
  if (action === 'skipped_conflict') {
    log(`[SKIP]   ${targetPath} (differs; re-run with --force to overwrite)`);
  }
}

export function syncFile(src, dst, options = {}) {
  const log = options.log || console.log;
  const dstDir = path.dirname(dst);
  ensureDir(dstDir, options.dryRun, log);

  const sourceHash = shaFile(src);
  if (!fs.existsSync(dst)) {
    const action = options.dryRun ? 'would_create' : 'created';
    if (!options.dryRun) {
      fs.copyFileSync(src, dst);
    }
    logSyncAction(action, dst, log);
    return buildSyncResult(action, dst, { sourceHash, destinationHash: options.dryRun ? null : shaFile(dst) });
  }

  const destinationHash = shaFile(dst);
  if (sourceHash === destinationHash) {
    logSyncAction('skipped', dst, log);
    return buildSyncResult('skipped', dst, { sourceHash, destinationHash });
  }

  if (!options.force) {
    logSyncAction('skipped_conflict', dst, log);
    return buildSyncResult('skipped_conflict', dst, { sourceHash, destinationHash });
  }

  const action = options.dryRun ? 'would_update' : 'updated';
  if (!options.dryRun) {
    copyFileAtomically(src, dst);
  }
  logSyncAction(action, dst, log);
  return buildSyncResult(action, dst, {
    sourceHash,
    destinationHash: options.dryRun ? destinationHash : shaFile(dst),
  });
}

export function syncDirectory(src, dst, options = {}) {
  const log = options.log || console.log;
  ensureDir(path.dirname(dst), options.dryRun, log);

  const sourceHash = dirHash(src);
  if (!fs.existsSync(dst)) {
    const action = options.dryRun ? 'would_create' : 'created';
    if (!options.dryRun) {
      fs.cpSync(src, dst, { recursive: true });
    }
    logSyncAction(action, dst, log);
    return buildSyncResult(action, dst, { sourceHash, destinationHash: options.dryRun ? null : dirHash(dst) });
  }

  const destinationHash = dirHash(dst);
  if (sourceHash === destinationHash) {
    logSyncAction('skipped', dst, log);
    return buildSyncResult('skipped', dst, { sourceHash, destinationHash });
  }

  if (!options.force) {
    logSyncAction('skipped_conflict', dst, log);
    return buildSyncResult('skipped_conflict', dst, { sourceHash, destinationHash });
  }

  const action = options.dryRun ? 'would_update' : 'updated';
  if (!options.dryRun) {
    copyDirectoryAtomically(src, dst);
  }
  logSyncAction(action, dst, log);
  return buildSyncResult(action, dst, {
    sourceHash,
    destinationHash: options.dryRun ? destinationHash : dirHash(dst),
  });
}

export function syncText(content, dst, options = {}) {
  const log = options.log || console.log;
  ensureDir(path.dirname(dst), options.dryRun, log);

  const sourceHash = shaText(content);
  if (!fs.existsSync(dst)) {
    const action = options.dryRun ? 'would_create' : 'created';
    if (!options.dryRun) {
      fs.writeFileSync(dst, content, 'utf8');
    }
    logSyncAction(action, dst, log);
    return buildSyncResult(action, dst, { sourceHash, destinationHash: options.dryRun ? null : shaFile(dst) });
  }

  const destinationText = fs.readFileSync(dst, 'utf8');
  const destinationHash = shaText(destinationText);
  if (sourceHash === destinationHash) {
    logSyncAction('skipped', dst, log);
    return buildSyncResult('skipped', dst, { sourceHash, destinationHash });
  }

  if (!options.force) {
    logSyncAction('skipped_conflict', dst, log);
    return buildSyncResult('skipped_conflict', dst, { sourceHash, destinationHash });
  }

  const action = options.dryRun ? 'would_update' : 'updated';
  if (!options.dryRun) {
    copyTextAtomically(content, dst);
  }
  logSyncAction(action, dst, log);
  return buildSyncResult(action, dst, {
    sourceHash,
    destinationHash: options.dryRun ? destinationHash : shaFile(dst),
  });
}
