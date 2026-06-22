'use strict';

/**
 * CJS wrapper for scripts/instruction-compose-utils.mjs (ESM).
 * Provides synchronous composition functions for the CommonJS server.
 *
 * The ESM module is loaded once on first use via dynamic import().
 * Because top-level await is available in Node 14.8+, we use an IIFE
 * pattern that resolves the module at startup.
 */

const path = require('path');

let _composeModule = null;
let _loadError = null;

// Resolve the ESM module path relative to the repo root
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ESM_MODULE_PATH = path.join(REPO_ROOT, 'scripts', 'instruction-compose-utils.mjs');

// Load the ESM module at require time
(async function loadModule() {
  try {
    // Convert to file:// URL for ESM import
    const fileUrl = require('url').pathToFileURL(ESM_MODULE_PATH).href;
    _composeModule = await import(fileUrl);
  } catch (err) {
    _loadError = err;
  }
})();

function ensureModule() {
  if (_loadError) {
    throw new Error(`Failed to load instruction-compose-utils.mjs: ${_loadError.message}`);
  }
  if (!_composeModule) {
    throw new Error('instruction-compose-utils.mjs not yet loaded — retry after startup');
  }
}

/**
 * Load and return the content of a named preset.
 * @param {string} presetId
 * @returns {string}
 */
function loadPresetContent(presetId) {
  ensureModule();
  return _composeModule.loadPresetContent(presetId);
}

/**
 * Build the profile section content from a profile object.
 * @param {{ enabled: boolean, presetId: string, customInstructions: string }} profile
 * @returns {string}
 */
function buildProfileContent(profile) {
  ensureModule();
  return _composeModule.buildProfileContent(profile);
}

/**
 * Compose instructions from baseline + optional profile + appendix.
 * @param {string} baselinePath
 * @param {string} appendixPath
 * @param {string} [profileContent]
 * @returns {string}
 */
function composeInstructions(baselinePath, appendixPath, profileContent) {
  ensureModule();
  return _composeModule.composeInstructions(baselinePath, appendixPath, profileContent);
}

/**
 * Compose instructions from a manifest asset object.
 * @param {{ source: string, appendix: string }} asset
 * @param {string} repoRoot
 * @param {string} [profileContent]
 * @returns {string}
 */
function composeInstructionsFromAsset(asset, repoRoot, profileContent) {
  ensureModule();
  return _composeModule.composeInstructionsFromAsset(asset, repoRoot, profileContent);
}

module.exports = {
  loadPresetContent,
  buildProfileContent,
  composeInstructions,
  composeInstructionsFromAsset,
};
