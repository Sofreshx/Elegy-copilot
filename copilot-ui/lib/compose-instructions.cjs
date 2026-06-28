'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PRESET_DIR = path.join(REPO_ROOT, 'catalog-assets', 'presets');

function loadPresetContent(presetId) {
  const presetPath = path.join(PRESET_DIR, `${presetId}.md`);
  if (!fs.existsSync(presetPath)) {
    throw new Error(`Preset not found: ${presetPath}`);
  }
  return fs.readFileSync(presetPath, 'utf8').trim();
}

function buildProfileContent(profile) {
  if (!profile || !profile.enabled) {
    return '';
  }

  const parts = [];
  try {
    const presetContent = loadPresetContent(profile.presetId);
    if (presetContent) {
      parts.push(presetContent);
    }
  } catch (err) {
    console.error(`[instruction-compose] Preset load failed: ${err.message}`);
  }

  if (profile.customInstructions && profile.customInstructions.trim()) {
    parts.push(profile.customInstructions.trim());
  }

  if (parts.length === 0) {
    return '';
  }

  return `## Collaboration Style\n\n${parts.join('\n\n')}`;
}

function composeInstructions(baselinePath, appendixPath, profileContent) {
  if (!fs.existsSync(baselinePath)) {
    throw new Error(`Baseline not found: ${baselinePath}`);
  }
  if (!fs.existsSync(appendixPath)) {
    throw new Error(`Appendix not found: ${appendixPath}`);
  }

  const baseline = fs.readFileSync(baselinePath, 'utf8');
  const appendix = fs.readFileSync(appendixPath, 'utf8');

  if (profileContent && profileContent.trim()) {
    return [
      baseline.trim(),
      profileContent.trim(),
      appendix.trim(),
    ].join('\n\n---\n\n') + '\n';
  }

  return `${baseline.trim()}\n\n---\n\n${appendix.trim()}\n`;
}

function composeInstructionsFromAsset(asset, repoRoot, profileContent) {
  if (!asset || !asset.source || !asset.appendix) {
    throw new Error('Asset must have source and appendix fields for composition');
  }
  const baselinePath = path.resolve(repoRoot, asset.source);
  const appendixPath = path.resolve(repoRoot, asset.appendix);
  return composeInstructions(baselinePath, appendixPath, profileContent);
}

module.exports = {
  loadPresetContent,
  buildProfileContent,
  composeInstructions,
  composeInstructionsFromAsset,
};
