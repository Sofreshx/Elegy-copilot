import fs from 'fs';
import path from 'path';

/**
 * Compose a harness instruction file from the shared baseline and a harness appendix.
 *
 * @param {string} baselinePath — absolute path to catalog-assets/instructions/agent-session-defaults.md
 * @param {string} appendixPath — absolute path to the harness appendix (e.g. codex-assets/home/AGENTS-appendix.md)
 * @returns {string} — composed content: baseline + separator + appendix
 */
export function composeInstructions(baselinePath, appendixPath) {
  if (!fs.existsSync(baselinePath)) {
    throw new Error(`Baseline not found: ${baselinePath}`);
  }
  if (!fs.existsSync(appendixPath)) {
    throw new Error(`Appendix not found: ${appendixPath}`);
  }
  const baseline = fs.readFileSync(baselinePath, 'utf8');
  const appendix = fs.readFileSync(appendixPath, 'utf8');
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
 * @returns {string} — composed content
 */
export function composeInstructionsFromAsset(asset, repoRoot) {
  if (!asset || !asset.source || !asset.appendix) {
    throw new Error('Asset must have source and appendix fields for composition');
  }
  const baselinePath = path.resolve(repoRoot, asset.source);
  const appendixPath = path.resolve(repoRoot, asset.appendix);
  return composeInstructions(baselinePath, appendixPath);
}
