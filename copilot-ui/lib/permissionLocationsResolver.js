'use strict';

const fs = require('fs');
const path = require('path');

const {
  buildPermissionLocations,
  normalizeBaseRoots,
  normalizeSubdir,
} = require('./permissionsContracts');

function listFirstLevelSubdirs(baseRootAbs) {
  const root = path.resolve(baseRootAbs);
  let entries = [];

  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const subdirs = [];
  for (const entry of entries) {
    const rel = normalizeSubdir(entry.name);
    if (!rel) continue;

    if (entry.isDirectory()) {
      subdirs.push(rel);
      continue;
    }

    if (entry.isSymbolicLink()) {
      const abs = path.resolve(root, entry.name);
      try {
        if (fs.statSync(abs).isDirectory()) {
          subdirs.push(rel);
        }
      } catch {
        // ignore broken symlinks
      }
    }
  }

  const unique = Array.from(new Set(subdirs));
  unique.sort((a, b) => a.localeCompare(b));
  return unique;
}

function collectDynamicSubdirsByBase(baseRoots) {
  const roots = normalizeBaseRoots(baseRoots);
  const mapping = {};

  for (const baseRoot of roots) {
    mapping[baseRoot] = listFirstLevelSubdirs(baseRoot);
  }

  return mapping;
}

function resolvePermissionLocations(options) {
  const source = options && typeof options === 'object' && !Array.isArray(options) ? options : {};
  const baseRoots = normalizeBaseRoots(source.baseRoots);
  const scanExistingSubdirs = source.scanExistingSubdirs !== false;
  const includeDefaultSubdirs = source.includeDefaultSubdirs !== false;

  const dynamicSubdirsByBase = scanExistingSubdirs
    ? collectDynamicSubdirsByBase(baseRoots)
    : {};

  const locations = buildPermissionLocations({
    baseRoots,
    includeDefaultSubdirs,
    additionalSubdirsByBase: dynamicSubdirsByBase,
  });

  return {
    locations,
    dynamicSubdirsByBase,
  };
}

module.exports = {
  listFirstLevelSubdirs,
  collectDynamicSubdirsByBase,
  resolvePermissionLocations,
};
