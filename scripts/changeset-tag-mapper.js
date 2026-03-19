'use strict';

/**
 * Maps package names to their Git tag prefix and release channel.
 * Used by CI to determine which tag pattern to use when publishing.
 *
 * Tag ownership rules (per plan R13):
 * - desktop-v* → copilot-ui (instruction-engine-desktop)
 * - tracker-v* → local-tracker (@instruction-engine/local-tracker)
 *
 * contracts/ is NOT independently released — it is linked with consumers.
 */

const TAG_MAP = Object.freeze({
  'instruction-engine-desktop': {
    prefix: 'desktop-v',
    channel: 'desktop-release',
    releasable: true,
  },
  '@instruction-engine/local-tracker': {
    prefix: 'tracker-v',
    channel: 'tracker-release',
    releasable: true,
  },
  '@instruction-engine/contracts': {
    prefix: null,
    channel: null,
    releasable: false,
  },
  'scripts': {
    prefix: null,
    channel: null,
    releasable: false,
  },
});

/**
 * Get the tag config for a package name.
 * @param {string} packageName
 * @returns {{ prefix: string|null, channel: string|null, releasable: boolean } | null}
 */
function getTagConfig(packageName) {
  return TAG_MAP[packageName] ?? null;
}

/**
 * Build a Git tag string from a package name and version.
 * @param {string} packageName
 * @param {string} version
 * @returns {string|null} e.g. 'desktop-v0.2.0' or null if non-releasable
 */
function buildTag(packageName, version) {
  const config = getTagConfig(packageName);
  if (!config || !config.releasable || !config.prefix) return null;
  return `${config.prefix}${version}`;
}

/**
 * Validate that a changeset targets exactly one releasable package.
 * @param {string[]} packageNames - Packages in the changeset
 * @returns {{ valid: boolean, error?: string }}
 */
function validateChangesetTargets(packageNames) {
  const releasable = packageNames.filter(name => {
    const config = TAG_MAP[name];
    return config && config.releasable;
  });

  if (releasable.length === 0) {
    return { valid: false, error: 'Changeset targets no releasable packages' };
  }
  if (releasable.length > 1) {
    return {
      valid: false,
      error: `Changeset targets multiple releasable packages: ${releasable.join(', ')}. Split into separate changesets.`,
    };
  }

  // Check if contracts is included — requires synchronized bumps
  const hasContracts = packageNames.includes('@instruction-engine/contracts');
  if (hasContracts) {
    const consumers = ['instruction-engine-desktop', '@instruction-engine/local-tracker'];
    const missingConsumers = consumers.filter(c => !packageNames.includes(c));
    if (missingConsumers.length > 0) {
      return {
        valid: false,
        error: `Changeset includes contracts but is missing synchronized bumps for: ${missingConsumers.join(', ')}`,
      };
    }
  }

  return { valid: true };
}

module.exports = { TAG_MAP, getTagConfig, buildTag, validateChangesetTargets };

// CLI mode
if (require.main === module) {
  const arg = process.argv[2];
  if (!arg) {
    console.log('Usage: node changeset-tag-mapper.js <package-name> [version]');
    console.log('       node changeset-tag-mapper.js --list');
    process.exit(0);
  }
  if (arg === '--list') {
    for (const [name, config] of Object.entries(TAG_MAP)) {
      console.log(`${name}: prefix=${config.prefix ?? '(none)'} releasable=${config.releasable}`);
    }
  } else {
    const version = process.argv[3] || '0.0.0';
    const tag = buildTag(arg, version);
    console.log(tag ?? `(not releasable: ${arg})`);
  }
}
