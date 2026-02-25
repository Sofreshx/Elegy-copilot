'use strict';

const path = require('path');

const PERMISSIONS_CONTRACT_VERSION = '1.0.0';

const DEFAULT_COPILOT_SUBDIRS = Object.freeze([
  'agents',
  'skills',
  'prompts',
  'session-state',
  'repo-state',
  'sessions-archive',
]);

function toPathKey(absPath) {
  const resolved = path.resolve(absPath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function normalizeAbsolutePath(input) {
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  if (!raw || !path.isAbsolute(raw)) return null;
  return path.resolve(raw);
}

function normalizeSubdir(input) {
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  if (!raw) return null;

  const normalizedSeparators = raw.replace(/[\\/]+/g, path.sep).replace(new RegExp(`^[\\${path.sep}]+`), '');
  if (!normalizedSeparators) return null;

  const normalized = path.normalize(normalizedSeparators);
  if (!normalized || normalized === '.') return null;
  if (path.isAbsolute(normalized)) return null;

  const parts = normalized.split(path.sep).filter(Boolean);
  if (parts.includes('..')) return null;

  return normalized;
}

function normalizeBaseRoots(baseRoots) {
  const roots = Array.isArray(baseRoots) ? baseRoots : [];
  const normalized = [];
  const seen = new Set();

  for (const root of roots) {
    const abs = normalizeAbsolutePath(root);
    if (!abs) continue;
    const key = toPathKey(abs);
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(abs);
  }

  normalized.sort((a, b) => a.localeCompare(b));
  return normalized;
}

function normalizeSubdirList(subdirs) {
  const values = Array.isArray(subdirs) ? subdirs : [];
  const normalized = [];
  const seen = new Set();

  for (const subdir of values) {
    const normalizedSubdir = normalizeSubdir(subdir);
    if (!normalizedSubdir) continue;
    const key = process.platform === 'win32' ? normalizedSubdir.toLowerCase() : normalizedSubdir;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(normalizedSubdir);
  }

  normalized.sort((a, b) => a.localeCompare(b));
  return normalized;
}

function getDynamicSubdirsForBase(additionalSubdirsByBase, baseAbs) {
  if (!additionalSubdirsByBase || typeof additionalSubdirsByBase !== 'object' || Array.isArray(additionalSubdirsByBase)) {
    return [];
  }

  const targetKey = toPathKey(baseAbs);
  const dynamic = [];

  for (const [rawBase, subdirs] of Object.entries(additionalSubdirsByBase)) {
    const normalizedBase = normalizeAbsolutePath(rawBase);
    if (!normalizedBase) continue;
    if (toPathKey(normalizedBase) !== targetKey) continue;
    if (!Array.isArray(subdirs)) continue;
    dynamic.push(...subdirs);
  }

  return normalizeSubdirList(dynamic);
}

function isPathUnderRoot(rootAbs, candidateAbs) {
  const root = normalizeAbsolutePath(rootAbs);
  const candidate = normalizeAbsolutePath(candidateAbs);
  if (!root || !candidate) return false;

  const rootKey = toPathKey(root);
  const candidateKey = toPathKey(candidate);

  if (candidateKey === rootKey) return true;

  const prefix = rootKey.endsWith(path.sep) ? rootKey : `${rootKey}${path.sep}`;
  return candidateKey.startsWith(prefix);
}

function buildPermissionLocations(options) {
  const source = options && typeof options === 'object' && !Array.isArray(options) ? options : {};
  const baseRoots = normalizeBaseRoots(source.baseRoots);
  const includeDefaults = source.includeDefaultSubdirs !== false;
  const additionalByBase = source.additionalSubdirsByBase;

  const locations = [];
  const seen = new Set();

  function addLocation(absPath) {
    const normalizedAbsPath = normalizeAbsolutePath(absPath);
    if (!normalizedAbsPath) return;
    const key = toPathKey(normalizedAbsPath);
    if (seen.has(key)) return;
    seen.add(key);
    locations.push(normalizedAbsPath);
  }

  for (const baseRoot of baseRoots) {
    addLocation(baseRoot);

    const mergedSubdirs = includeDefaults
      ? [...DEFAULT_COPILOT_SUBDIRS, ...getDynamicSubdirsForBase(additionalByBase, baseRoot)]
      : getDynamicSubdirsForBase(additionalByBase, baseRoot);

    const subdirs = normalizeSubdirList(mergedSubdirs);
    for (const subdir of subdirs) {
      const abs = path.resolve(baseRoot, subdir);
      if (!isPathUnderRoot(baseRoot, abs)) continue;
      addLocation(abs);
    }
  }

  locations.sort((a, b) => a.localeCompare(b));
  return locations;
}

module.exports = {
  PERMISSIONS_CONTRACT_VERSION,
  DEFAULT_COPILOT_SUBDIRS,
  normalizeAbsolutePath,
  normalizeSubdir,
  normalizeBaseRoots,
  buildPermissionLocations,
  isPathUnderRoot,
};