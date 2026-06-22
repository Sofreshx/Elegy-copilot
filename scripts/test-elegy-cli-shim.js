'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const workspaceRoot = path.resolve(__dirname, '..');
const instructionsContent = fs.readFileSync(path.join(workspaceRoot, 'configuration', 'assets', 'spec-driven-instructions.md'), 'utf8').trimEnd();
const startMarker = '<!-- elegy-copilot:begin spec-driven -->';
const endMarker = '<!-- elegy-copilot:end spec-driven -->';

function shaText(text) {
  return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex');
}

function shaFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function ensureParentDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function parseApplyArgs(argv) {
  const args = {
    packagePath: '',
    profileId: '',
    targetRoot: '',
    json: false,
    dryRun: false,
    force: false,
    bindings: {},
  };

  if (argv[0] !== 'apply') {
    throw new Error(`Unsupported configuration command: ${argv[0] || '(empty)'}`);
  }

  for (let index = 1; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--package') {
      index += 1;
      if (index >= argv.length) throw new Error('Missing value for --package');
      args.packagePath = argv[index] || '';
      continue;
    }
    if (value === '--profile-id') {
      index += 1;
      if (index >= argv.length) throw new Error('Missing value for --profile-id');
      args.profileId = argv[index] || '';
      continue;
    }
    if (value === '--target') {
      index += 1;
      if (index >= argv.length) throw new Error('Missing value for --target');
      args.targetRoot = argv[index] || '';
      continue;
    }
    if (value === '--binding') {
      index += 1;
      if (index >= argv.length) throw new Error('Missing value for --binding');
      const binding = String(argv[index] || '');
      const separatorIndex = binding.indexOf('=');
      if (separatorIndex <= 0) {
        throw new Error(`Invalid --binding value: ${binding}`);
      }
      args.bindings[binding.slice(0, separatorIndex)] = binding.slice(separatorIndex + 1);
      continue;
    }
    if (value === '--json') {
      args.json = true;
      continue;
    }
    if (value === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (value === '--force') {
      args.force = true;
      continue;
    }

    throw new Error(`Unsupported option: ${value}`);
  }

  if (!args.packagePath) throw new Error('Missing required --package argument');
  if (!args.profileId) throw new Error('Missing required --profile-id argument');
  if (!args.targetRoot) throw new Error('Missing required --target argument');
  if (!args.json) throw new Error('Missing required --json argument');

  return args;
}

function buildManagedBlock() {
  return `${startMarker}\n${instructionsContent}\n${endMarker}`;
}

function renderPatchedText(currentText) {
  const managedBlock = buildManagedBlock();
  if (!currentText) {
    return `${managedBlock}\n`;
  }

  const startIndex = currentText.indexOf(startMarker);
  const endIndex = currentText.indexOf(endMarker);
  if (startIndex >= 0 && endIndex >= startIndex) {
    const before = currentText.slice(0, startIndex);
    const after = currentText.slice(endIndex + endMarker.length);
    const nextText = `${before}${managedBlock}${after}`;
    return nextText.endsWith('\n') ? nextText : `${nextText}\n`;
  }

  const prefix = currentText.endsWith('\n') ? currentText : `${currentText}\n`;
  return `${prefix}\n${managedBlock}\n`;
}

function buildEntry(action, filePath, operationId, templateId, expectedHash, actualHash, detail = '') {
  return {
    action,
    path: filePath,
    operationId,
    templateId,
    expectedHash,
    actualHash,
    detail,
  };
}

function patchTextBlock(targetPath, operationId, options = {}) {
  const templateId = 'elegy-copilot-spec-driven-overlays-template';
  const currentText = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf8') : '';
  const nextText = renderPatchedText(currentText);
  const expectedHash = shaText(nextText);
  const actualHash = currentText ? shaText(currentText) : null;

  if (currentText === nextText) {
    return buildEntry('skipped', targetPath, operationId, templateId, expectedHash, actualHash, 'up-to-date');
  }

  const action = currentText
    ? (options.dryRun ? 'would-update' : 'updated')
    : (options.dryRun ? 'would-create' : 'created');

  if (!options.dryRun) {
    ensureParentDirectory(targetPath);
    fs.writeFileSync(targetPath, nextText, 'utf8');
  }

  return buildEntry(
    action,
    targetPath,
    operationId,
    templateId,
    expectedHash,
    options.dryRun ? actualHash : shaFile(targetPath)
  );
}

function applyProfile(args) {
  const repoRoot = path.resolve(args.targetRoot);
  if (args.profileId === 'elegy-copilot-spec-driven-overlays') {
    const targetInstructions = String(args.bindings['target.instructions'] || '').trim();
    if (!targetInstructions) {
      throw new Error('Missing required target.instructions binding');
    }

    return [
      patchTextBlock(path.join(repoRoot, '.github', 'copilot-instructions.md'), 'patch-copilot-instructions', args),
      patchTextBlock(path.join(repoRoot, targetInstructions), 'patch-surface-instructions', args),
    ];
  }

  throw new Error(`Unsupported test profile: ${args.profileId}`);
}

function main(argv) {
  const args = parseApplyArgs(argv);
  const entries = applyProfile(args);
  const receipt = {
    schemaVersion: 'elegy-configuration-receipt/v1',
    mode: args.dryRun ? 'dry-run' : 'apply',
    sourceKind: 'package',
    profileId: args.profileId,
    targetRoot: path.resolve(args.targetRoot),
    entries,
  };
  process.stdout.write(`${JSON.stringify({ ok: true, data: receipt })}\n`);
}

function createTestElegyCliShim(rootPath) {
  const shimDir = path.join(rootPath, 'elegy-cli-shim');
  const scriptPath = path.join(shimDir, 'configuration');
  fs.mkdirSync(shimDir, { recursive: true });
  fs.writeFileSync(
    scriptPath,
    `#!/usr/bin/env node\nrequire(${JSON.stringify(__filename)}).main(process.argv.slice(2));\n`,
    'utf8'
  );

  return {
    elegyCliPath: process.execPath,
    shimDir,
    scriptPath,
  };
}

function withWorkingDirectory(targetPath, fn) {
  const previousCwd = process.cwd();
  process.chdir(targetPath);
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.finally(() => {
        process.chdir(previousCwd);
      });
    }
    process.chdir(previousCwd);
    return result;
  } catch (error) {
    process.chdir(previousCwd);
    throw error;
  }
}

module.exports = {
  createTestElegyCliShim,
  main,
  withWorkingDirectory,
};
