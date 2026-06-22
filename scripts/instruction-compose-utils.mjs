import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PRESET_DIR = path.resolve(__dirname, '..', 'catalog-assets', 'presets');

/**
 * Load the content of a named preset from catalog-assets/presets/.
 * @param {string} presetId — e.g. 'constructive-coworker'
 * @returns {string} — preset content
 * @throws if preset file not found
 */
export function loadPresetContent(presetId) {
  const presetPath = path.join(PRESET_DIR, `${presetId}.md`);
  if (!fs.existsSync(presetPath)) {
    throw new Error(`Preset not found: ${presetPath}`);
  }
  return fs.readFileSync(presetPath, 'utf8').trim();
}

/**
 * Build the profile section content from a preset ID and optional custom instructions.
 * Returns an empty string when disabled or no content.
 *
 * Composition: preset content + custom instructions (if any)
 *
 * @param {{ enabled: boolean, presetId: string, customInstructions: string }} profile
 * @returns {string} — profile section content, or empty string
 */
export function buildProfileContent(profile) {
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
    // Preset missing — skip but don't fail composition
    console.error(`[instruction-compose] Preset load failed: ${err.message}`);
  }

  if (profile.customInstructions && profile.customInstructions.trim()) {
    parts.push(profile.customInstructions.trim());
  }

  if (parts.length === 0) {
    return '';
  }

  return '## Collaboration Style\n\n' + parts.join('\n\n');
}

/**
 * Compose a harness instruction file from the shared baseline,
 * an optional user collaboration profile, and a harness appendix.
 *
 * @param {string} baselinePath — absolute path to catalog-assets/instructions/agent-session-defaults.md
 * @param {string} appendixPath — absolute path to the harness appendix (e.g. codex-assets/home/AGENTS-appendix.md)
 * @param {string} [profileContent] — optional profile section content (from buildProfileContent)
 * @returns {string} — composed content
 */
export function composeInstructions(baselinePath, appendixPath, profileContent) {
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

/**
 * Compose instructions from a manifest asset object.
 *
 * The asset must have:
 *   - source: relative path to the shared baseline
 *   - appendix: relative path to the harness appendix
 *
 * Both paths are resolved relative to repoRoot.
 *
 * @param {{ source: string, appendix: string }} asset — manifest asset with source and appendix fields
 * @param {string} repoRoot — absolute path to the repo root
 * @param {string} [profileContent] — optional profile section content
 * @returns {string} — composed content
 */
export function composeInstructionsFromAsset(asset, repoRoot, profileContent) {
  if (!asset || !asset.source || !asset.appendix) {
    throw new Error('Asset must have source and appendix fields for composition');
  }
  const baselinePath = path.resolve(repoRoot, asset.source);
  const appendixPath = path.resolve(repoRoot, asset.appendix);
  return composeInstructions(baselinePath, appendixPath, profileContent);
}
