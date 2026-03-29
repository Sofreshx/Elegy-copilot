#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const UPSTREAM_REPO = 'DwainTR/superpowers-copilot';
const SKILL_NAMES = [
  'brainstorming',
  'dispatching-parallel-agents',
  'executing-plans',
  'finishing-a-development-branch',
  'receiving-code-review',
  'requesting-code-review',
  'subagent-driven-development',
  'systematic-debugging',
  'test-driven-development',
  'using-git-worktrees',
  'using-superpowers',
  'verification-before-completion',
  'writing-plans',
  'writing-skills',
];
const AGENT_NAME = 'code-reviewer';
const VENDORED_AGENT_NAME = 'superpowers-code-reviewer';
const BUNDLE_ID = 'superpowers-workflow';
const TEXT_EXTENSIONS = new Set(['.md', '.txt', '.js', '.ts', '.sh', '.html', '.dot', '.json']);
const BUNDLE_DESCRIPTION = 'Optional Jesse Vincent Superpowers compatibility pack, kept catalog-installable for legacy/reference workflows. Its members are default-handled or deprecated-compatibility guidance rather than current default workflow surfaces.';
const BUNDLE_TAGS = ['superpowers', 'workflow', 'planning', 'debugging', 'tdd'];
const SUPERPOWERS_DIRECTORY_NAME_PATTERN = /^superpowers-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SUPERPOWERS_AGENT_FILE_PATTERN = /^superpowers-[a-z0-9]+(?:-[a-z0-9]+)*\.agent\.md$/;
const SUPERPOWERS_GOVERNANCE = {
  [`agent-${VENDORED_AGENT_NAME}`]: {
    routingClass: 'deprecated-compatibility',
    routingNote: 'Informational only; retained for compatibility-oriented review flows, not current default workflow guidance.',
  },
  'skill-superpowers-brainstorming': {
    routingClass: 'deprecated-compatibility',
    routingNote: 'Informational only; retained for compatibility-oriented use rather than current default workflow guidance.',
  },
  'skill-superpowers-dispatching-parallel-agents': {
    routingClass: 'default-handled',
    routingNote: 'Informational only; normal routing should handle this directly unless explicit compatibility use is needed.',
  },
  'skill-superpowers-executing-plans': {
    routingClass: 'deprecated-compatibility',
    routingNote: 'Informational only; retained for compatibility-oriented use rather than current default workflow guidance.',
  },
  'skill-superpowers-finishing-a-development-branch': {
    routingClass: 'deprecated-compatibility',
    routingNote: 'Informational only; retained for compatibility-oriented use rather than current default workflow guidance.',
  },
  'skill-superpowers-receiving-code-review': {
    routingClass: 'default-handled',
    routingNote: 'Informational only; normal routing should handle this directly unless explicit compatibility use is needed.',
  },
  'skill-superpowers-requesting-code-review': {
    routingClass: 'deprecated-compatibility',
    routingNote: 'Informational only; retained for compatibility-oriented use rather than current default workflow guidance.',
  },
  'skill-superpowers-subagent-driven-development': {
    routingClass: 'deprecated-compatibility',
    routingNote: 'Informational only; retained for compatibility-oriented use rather than current default workflow guidance.',
  },
  'skill-superpowers-systematic-debugging': {
    routingClass: 'default-handled',
    routingNote: 'Informational only; normal routing should handle this directly unless explicit compatibility use is needed.',
  },
  'skill-superpowers-test-driven-development': {
    routingClass: 'default-handled',
    routingNote: 'Informational only; normal routing should handle this directly unless explicit compatibility use is needed.',
  },
  'skill-superpowers-using-git-worktrees': {
    routingClass: 'default-handled',
    routingNote: 'Informational only; normal routing should handle this directly unless explicit compatibility use is needed.',
  },
  'skill-superpowers-using-superpowers': {
    routingClass: 'deprecated-compatibility',
    routingNote: 'Informational only; retained for compatibility-oriented use rather than current default workflow guidance.',
  },
  'skill-superpowers-verification-before-completion': {
    routingClass: 'default-handled',
    routingNote: 'Informational only; normal routing should handle this directly unless explicit compatibility use is needed.',
  },
  'skill-superpowers-writing-plans': {
    routingClass: 'deprecated-compatibility',
    routingNote: 'Informational only; retained for compatibility-oriented use rather than current default workflow guidance.',
  },
  'skill-superpowers-writing-skills': {
    routingClass: 'deprecated-compatibility',
    routingNote: 'Informational only; retained for compatibility-oriented use rather than current default workflow guidance.',
  },
};

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--source') {
      args.source = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === '--upstream-sha') {
      args.upstreamSha = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === '--engine-root') {
      args.engineRoot = argv[index + 1];
      index += 1;
    }
  }
  return args;
}

function namespacedSkillName(skillName) {
  return `superpowers-${skillName}`;
}

function isDirectory(filePath) {
  return fs.existsSync(filePath) && fs.statSync(filePath).isDirectory();
}

function isFile(filePath) {
  return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
}

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function listFilesRecursive(rootPath) {
  const output = [];
  const pending = [rootPath];

  while (pending.length > 0) {
    const current = pending.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const absPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(absPath);
      } else if (entry.isFile()) {
        output.push(absPath);
      }
    }
  }

  output.sort((left, right) => left.localeCompare(right));
  return output;
}

function removePath(targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function validateVendoredSkillDirectoryName(skillDirectoryName, sourceDescription) {
  if (!SUPERPOWERS_DIRECTORY_NAME_PATTERN.test(skillDirectoryName)) {
    throw new Error(`Invalid vendored skill directory in ${sourceDescription}: ${skillDirectoryName}`);
  }

  return skillDirectoryName;
}

function validateVendoredAgentName(agentName, sourceDescription) {
  if (!SUPERPOWERS_DIRECTORY_NAME_PATTERN.test(agentName)) {
    throw new Error(`Invalid vendored agent name in ${sourceDescription}: ${agentName}`);
  }

  return agentName;
}

function validateVendoredAgentFileName(agentFileName, sourceDescription) {
  if (!SUPERPOWERS_AGENT_FILE_PATTERN.test(agentFileName)) {
    throw new Error(`Invalid vendored agent file name in ${sourceDescription}: ${agentFileName}`);
  }

  return agentFileName;
}

function canonicalizePathForComparison(filePath) {
  const pendingSegments = [];
  let currentPath = path.resolve(filePath);

  while (!fs.existsSync(currentPath)) {
    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      break;
    }

    pendingSegments.unshift(path.basename(currentPath));
    currentPath = parentPath;
  }

  let canonicalPath = currentPath;
  if (fs.existsSync(currentPath)) {
    canonicalPath = (fs.realpathSync.native || fs.realpathSync)(currentPath);
  }

  if (pendingSegments.length > 0) {
    canonicalPath = path.join(canonicalPath, ...pendingSegments);
  }

  return process.platform === 'win32' ? canonicalPath.toLowerCase() : canonicalPath;
}

function isSameOrDescendantPath(parentPath, candidatePath) {
  const relativePath = path.relative(parentPath, candidatePath);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function validateSourceTargetOverlap(sourceRoots, targetRoots) {
  const overlaps = [];

  for (const sourceRoot of sourceRoots) {
    const normalizedSourceRoot = canonicalizePathForComparison(sourceRoot.rootPath);
    for (const targetRoot of targetRoots) {
      const normalizedTargetRoot = canonicalizePathForComparison(targetRoot.rootPath);
      if (
        isSameOrDescendantPath(normalizedSourceRoot, normalizedTargetRoot)
        || isSameOrDescendantPath(normalizedTargetRoot, normalizedSourceRoot)
      ) {
        overlaps.push(`${sourceRoot.label} (${sourceRoot.rootPath}) overlaps ${targetRoot.label} (${targetRoot.rootPath})`);
      }
    }
  }

  if (overlaps.length > 0) {
    throw new Error(`Refusing to sync Superpowers from overlapping source and target roots: ${overlaps.join('; ')}`);
  }
}

function resolveManagedTargetPath(targetRoot, entryName, kind) {
  const resolvedRoot = path.resolve(targetRoot);
  const resolvedTarget = path.resolve(targetRoot, entryName);
  const relativeTarget = path.relative(resolvedRoot, resolvedTarget);

  if (!relativeTarget || relativeTarget.startsWith('..') || path.isAbsolute(relativeTarget)) {
    throw new Error(`Refusing to prune ${kind} outside target root: ${entryName}`);
  }

  return resolvedTarget;
}

function buildManagedSuperpowersInventory(skillDirectoryNames, agentFileNames) {
  const normalizedSkillDirectories = Array.from(new Set(skillDirectoryNames.filter(Boolean))).sort((left, right) => left.localeCompare(right));
  const normalizedAgentFiles = Array.from(new Set(agentFileNames.filter(Boolean))).sort((left, right) => left.localeCompare(right));

  return {
    skillDirectories: normalizedSkillDirectories,
    agentFiles: normalizedAgentFiles,
    assetIds: new Set([
      ...normalizedSkillDirectories.map((skillDirectoryName) => `skill-${skillDirectoryName}`),
      ...normalizedAgentFiles.map((agentFileName) => `agent-${path.basename(agentFileName, '.agent.md')}`),
    ]),
  };
}

function mergeManagedSuperpowersInventories(inventories) {
  const skillDirectories = [];
  const agentFiles = [];

  for (const inventory of inventories) {
    if (!inventory) {
      continue;
    }

    if (Array.isArray(inventory.skillDirectories)) {
      skillDirectories.push(...inventory.skillDirectories);
    }

    if (Array.isArray(inventory.agentFiles)) {
      agentFiles.push(...inventory.agentFiles);
    }
  }

  return buildManagedSuperpowersInventory(skillDirectories, agentFiles);
}

function normalizeManifestPath(relativePath) {
  return String(relativePath || '')
    .replace(/\\/g, '/')
    .replace(/^(?:\.\/)+/, '')
    .replace(/\/+$/, '');
}

function readManagedSkillDirectoryFromManifestAsset(asset) {
  const assetId = String(asset && asset.id ? asset.id : '');
  const sourcePath = normalizeManifestPath(asset && asset.source ? asset.source : '');
  const sourcePrefix = 'engine-assets/skills/';

  if (!sourcePath.startsWith(sourcePrefix)) {
    throw new Error(`Invalid Superpowers skill source in manifest asset ${assetId}: ${sourcePath}`);
  }

  const skillDirectoryName = sourcePath.slice(sourcePrefix.length);
  if (!skillDirectoryName || skillDirectoryName.includes('/')) {
    throw new Error(`Invalid Superpowers skill source in manifest asset ${assetId}: ${sourcePath}`);
  }

  return validateVendoredSkillDirectoryName(skillDirectoryName, `manifest asset ${assetId}`);
}

function readManagedAgentFileFromManifestAsset(asset) {
  const assetId = String(asset && asset.id ? asset.id : '');
  const sourcePath = normalizeManifestPath(asset && asset.source ? asset.source : '');
  const sourcePrefix = 'engine-assets/agents/';

  if (!sourcePath.startsWith(sourcePrefix)) {
    throw new Error(`Invalid Superpowers agent source in manifest asset ${assetId}: ${sourcePath}`);
  }

  const agentFileName = sourcePath.slice(sourcePrefix.length);
  if (!agentFileName || agentFileName.includes('/')) {
    throw new Error(`Invalid Superpowers agent source in manifest asset ${assetId}: ${sourcePath}`);
  }

  return validateVendoredAgentFileName(agentFileName, `manifest asset ${assetId}`);
}

function buildDesiredSuperpowersInventory() {
  const skillDirectories = SKILL_NAMES.map((skillName) => namespacedSkillName(skillName));
  const agentFiles = [`${VENDORED_AGENT_NAME}.agent.md`];
  const inventory = buildManagedSuperpowersInventory(skillDirectories, agentFiles);

  return {
    ...inventory,
    assets: [
      ...skillDirectories.map((skillDirectoryName) => withSuperpowersGovernance({
        id: `skill-${skillDirectoryName}`,
        type: 'skill',
        source: `engine-assets/skills/${skillDirectoryName}`,
        destination: `skills/${skillDirectoryName}`,
        loadMode: 'on-demand',
      })),
      withSuperpowersGovernance({
        id: `agent-${VENDORED_AGENT_NAME}`,
        type: 'agent',
        source: `engine-assets/agents/${VENDORED_AGENT_NAME}.agent.md`,
        destination: `agents/${VENDORED_AGENT_NAME}.agent.md`,
      }),
    ],
  };
}

function readRecordedSuperpowersInventory(manifestPath) {
  if (!isFile(manifestPath)) {
    return null;
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const bundle = Array.isArray(manifest.bundles)
    ? manifest.bundles.find((candidate) => String(candidate && candidate.id ? candidate.id : '') === BUNDLE_ID)
    : null;

  if (!bundle) {
    return null;
  }

  if (!Array.isArray(bundle.assetIds)) {
    throw new Error(`Invalid Superpowers bundle assetIds in manifest: ${BUNDLE_ID}`);
  }

  const assetsById = new Map(
    (Array.isArray(manifest.assets) ? manifest.assets : [])
      .map((asset) => [String(asset && asset.id ? asset.id : ''), asset])
  );

  const skillDirectories = [];
  const agentFiles = [];

  for (const assetIdValue of bundle.assetIds) {
    const assetId = String(assetIdValue || '');
    const asset = assetsById.get(assetId);
    if (!asset) {
      throw new Error(`Superpowers bundle references missing manifest asset: ${assetId}`);
    }

    const assetType = String(asset && asset.type ? asset.type : '');
    if (assetType === 'skill') {
      skillDirectories.push(readManagedSkillDirectoryFromManifestAsset(asset));
      continue;
    }

    if (assetType === 'agent') {
      const agentFileName = readManagedAgentFileFromManifestAsset(asset);
      agentFiles.push(agentFileName);
      validateVendoredAgentName(path.basename(agentFileName, '.agent.md'), `manifest asset ${assetId}`);
      continue;
    }

    throw new Error(`Unsupported Superpowers bundle asset type in manifest: ${assetType || '<missing>'}`);
  }

  return buildManagedSuperpowersInventory(skillDirectories, agentFiles);
}

function readValidatedProvenanceSuperpowersInventory(provenancePath) {
  if (!isFile(provenancePath)) {
    return null;
  }

  const provenance = JSON.parse(fs.readFileSync(provenancePath, 'utf8'));
  const skills = Array.isArray(provenance.skills) ? provenance.skills : null;
  if (!skills) {
    throw new Error('Invalid Superpowers provenance file: skills must be an array');
  }

  const skillDirectories = skills.map((skill, index) => {
    const vendoredName = String(skill && skill.vendored ? skill.vendored : '');
    if (!vendoredName) {
      throw new Error(`Invalid Superpowers provenance skill entry at index ${index}: missing vendored name`);
    }

    return validateVendoredSkillDirectoryName(vendoredName, `provenance skill entry ${index}`);
  });

  const agent = provenance.agent;
  if (!agent || typeof agent !== 'object') {
    throw new Error('Invalid Superpowers provenance file: agent must be an object');
  }

  const vendoredAgentName = validateVendoredAgentName(
    String(agent && agent.vendored ? agent.vendored : ''),
    'provenance agent entry'
  );
  const agentFileName = validateVendoredAgentFileName(`${vendoredAgentName}.agent.md`, 'provenance agent entry');

  return buildManagedSuperpowersInventory(skillDirectories, [agentFileName]);
}

function rollbackPrunedEntries(stagedPrunes) {
  for (let index = stagedPrunes.length - 1; index >= 0; index -= 1) {
    const stagedPrune = stagedPrunes[index];
    if (!stagedPrune) {
      continue;
    }

    if (fs.existsSync(stagedPrune.targetPath)) {
      removePath(stagedPrune.targetPath);
    }

    if (stagedPrune.backupPath && fs.existsSync(stagedPrune.backupPath)) {
      fs.renameSync(stagedPrune.backupPath, stagedPrune.targetPath);
    }
  }
}

function cleanupPrunedBackups(stagedPrunes) {
  for (const stagedPrune of stagedPrunes) {
    if (stagedPrune && stagedPrune.backupPath && fs.existsSync(stagedPrune.backupPath)) {
      removePath(stagedPrune.backupPath);
    }
  }
}

function stagePrunedManagedEntries(targetRoot, managedEntryNames, desiredEntryNames, kind, validateEntryName) {
  const desiredEntries = new Set(desiredEntryNames);
  const stagedPrunes = [];

  try {
    for (const entryName of managedEntryNames) {
      if (desiredEntries.has(entryName)) {
        continue;
      }

      if (validateEntryName) {
        validateEntryName(entryName, `managed ${kind}`);
      }

      const targetPath = resolveManagedTargetPath(targetRoot, entryName, kind);
      if (!fs.existsSync(targetPath)) {
        continue;
      }

      const backupPath = createTemporarySiblingPath(targetPath, 'superpowers-prune-backup');
      fs.renameSync(targetPath, backupPath);
      stagedPrunes.push({
        targetPath,
        backupPath,
      });
    }

    return stagedPrunes;
  } catch (error) {
    rollbackPrunedEntries(stagedPrunes);
    throw error;
  }
}

function pruneVendoredSkillDirectories(targetSkillsRoot, managedSkillDirectories, desiredSkillDirectories) {
  return stagePrunedManagedEntries(
    targetSkillsRoot,
    managedSkillDirectories,
    desiredSkillDirectories,
    'skill directory',
    validateVendoredSkillDirectoryName
  );
}

function pruneVendoredAgentFiles(targetAgentsRoot, managedAgentFileNames, desiredAgentFileNames) {
  return stagePrunedManagedEntries(
    targetAgentsRoot,
    managedAgentFileNames,
    desiredAgentFileNames,
    'agent file',
    validateVendoredAgentFileName
  );
}

function validateUpstreamSources(sourceSkillsRoot, sourceAgentsRoot) {
  const missingPaths = [];
  const sourceSkillDirectories = SKILL_NAMES.map((skillName) => {
    const sourceSkillDir = path.join(sourceSkillsRoot, skillName);
    if (!isDirectory(sourceSkillDir)) {
      missingPaths.push(sourceSkillDir);
    }

    return { skillName, sourceSkillDir };
  });
  const sourceAgentPath = path.join(sourceAgentsRoot, `${AGENT_NAME}.md`);
  if (!isFile(sourceAgentPath)) {
    missingPaths.push(sourceAgentPath);
  }

  if (missingPaths.length > 0) {
    throw new Error(`Missing required upstream Superpowers sources: ${missingPaths.join(', ')}`);
  }

  return {
    sourceSkillDirectories,
    sourceAgentPath,
  };
}

function copyDirectory(sourceDir, targetDir) {
  removePath(targetDir);
  ensureDirectory(path.dirname(targetDir));
  fs.cpSync(sourceDir, targetDir, { recursive: true });
}

function copyFile(sourceFile, targetFile) {
  removePath(targetFile);
  ensureDirectory(path.dirname(targetFile));
  fs.copyFileSync(sourceFile, targetFile);
}

let stagingCounter = 0;

function createTemporarySiblingPath(targetPath, label) {
  const parentPath = path.dirname(targetPath);
  const baseName = path.basename(targetPath);

  while (true) {
    const candidatePath = path.join(
      parentPath,
      `.${baseName}.${label}.${process.pid}.${Date.now()}.${stagingCounter}`
    );
    stagingCounter += 1;
    if (!fs.existsSync(candidatePath)) {
      return candidatePath;
    }
  }
}

function cleanupStagedTargets(stagedTargets) {
  for (const stagedTarget of stagedTargets) {
    if (stagedTarget && stagedTarget.stagedPath && fs.existsSync(stagedTarget.stagedPath)) {
      removePath(stagedTarget.stagedPath);
    }
  }
}

function cleanupSwapBackups(completedSwaps) {
  for (const completedSwap of completedSwaps) {
    if (completedSwap && completedSwap.backupPath && fs.existsSync(completedSwap.backupPath)) {
      removePath(completedSwap.backupPath);
    }
  }
}

function rollbackCompletedSwaps(completedSwaps) {
  for (let index = completedSwaps.length - 1; index >= 0; index -= 1) {
    const completedSwap = completedSwaps[index];
    if (!completedSwap) {
      continue;
    }

    if (fs.existsSync(completedSwap.targetPath)) {
      removePath(completedSwap.targetPath);
    }

    if (completedSwap.backupPath && fs.existsSync(completedSwap.backupPath)) {
      fs.renameSync(completedSwap.backupPath, completedSwap.targetPath);
    }
  }
}

function swapStagedTargets(stagedTargets) {
  const completedSwaps = [];

  try {
    for (const stagedTarget of stagedTargets) {
      const backupPath = fs.existsSync(stagedTarget.targetPath)
        ? createTemporarySiblingPath(stagedTarget.targetPath, 'superpowers-backup')
        : null;

      if (backupPath) {
        fs.renameSync(stagedTarget.targetPath, backupPath);
      }

      try {
        fs.renameSync(stagedTarget.stagedPath, stagedTarget.targetPath);
      } catch (error) {
        if (backupPath && fs.existsSync(backupPath) && !fs.existsSync(stagedTarget.targetPath)) {
          fs.renameSync(backupPath, stagedTarget.targetPath);
        }
        throw error;
      }

      completedSwaps.push({
        targetPath: stagedTarget.targetPath,
        backupPath,
      });
    }

    return completedSwaps;
  } catch (error) {
    rollbackCompletedSwaps(completedSwaps);
    throw error;
  }
}

function replaceAll(content, replacements) {
  let next = content;
  for (const [pattern, replacement] of replacements) {
    next = next.replace(pattern, replacement);
  }
  return next;
}

function rewriteTextContent(content, fileName, targetName) {
  let next = replaceAll(content, [
    [/superpowers:/g, 'superpowers-'],
    [/Task tool \(superpowers-code-reviewer\)/g, 'Task tool (superpowers-code-reviewer)'],
  ]);

  if (fileName === 'SKILL.md') {
    next = next.replace(/^name:\s*.+$/m, `name: ${targetName}`);
  }

  return next;
}

function rewriteAgentContent(content) {
  return replaceAll(content, [
    [/^name:\s*code-reviewer$/m, `name: ${VENDORED_AGENT_NAME}`],
    [/superpowers:/g, 'superpowers-'],
  ]);
}

function maybeRewriteTextFile(filePath, transform) {
  const ext = path.extname(filePath).toLowerCase();
  const fileName = path.basename(filePath);
  if (!TEXT_EXTENSIONS.has(ext) && fileName !== 'SKILL.md') {
    return;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const next = transform(content, fileName);
  if (next !== content) {
    fs.writeFileSync(filePath, next, 'utf8');
  }
}

function withSuperpowersGovernance(asset) {
  const governance = SUPERPOWERS_GOVERNANCE[asset.id];
  if (!governance) {
    throw new Error(`Missing governance entry for vendored Superpowers asset: ${asset.id}`);
  }

  return {
    ...asset,
    governance: { ...governance },
  };
}

function buildUpdatedManifestContent(desiredInventory, recordedInventory, manifestPath) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const removableAssetIds = new Set([
    ...desiredInventory.assetIds,
    ...(recordedInventory ? recordedInventory.assetIds : []),
  ]);

  const existingAssets = Array.isArray(manifest.assets) ? manifest.assets : [];
  manifest.assets = existingAssets
    .filter((asset) => !removableAssetIds.has(String(asset && asset.id ? asset.id : '')))
    .concat(desiredInventory.assets)
    .sort((left, right) => String(left.id || '').localeCompare(String(right.id || '')));

  const existingBundles = Array.isArray(manifest.bundles) ? manifest.bundles : [];
  const nextBundle = {
    id: BUNDLE_ID,
    title: 'Superpowers Workflow Pack',
    description: BUNDLE_DESCRIPTION,
    assetIds: desiredInventory.assets.map((asset) => asset.id),
    installTarget: 'user-global',
    activationScope: 'global',
    materialization: 'on-demand',
    classification: 'workflow',
    targeting: {
      tags: [...BUNDLE_TAGS],
    },
    tags: [...BUNDLE_TAGS],
    defaultRecommended: false,
    dependsOn: [],
  };
  manifest.bundles = existingBundles
    .filter((bundle) => String(bundle && bundle.id ? bundle.id : '') !== BUNDLE_ID)
    .concat([nextBundle]);

  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function buildProvenanceContent(engineRoot, sourceRoot, upstreamSha) {
  const provenance = {
    schemaVersion: 1,
    upstreamRepo: UPSTREAM_REPO,
    upstreamSha: upstreamSha || null,
    sourceRoot: path.relative(engineRoot, sourceRoot).replace(/\\/g, '/'),
    importedAt: new Date().toISOString(),
    skills: SKILL_NAMES.map((skillName) => ({
      upstream: skillName,
      vendored: namespacedSkillName(skillName),
    })),
    agent: {
      upstream: AGENT_NAME,
      vendored: VENDORED_AGENT_NAME,
    },
  };

  return `${JSON.stringify(provenance, null, 2)}\n`;
}

function stageTextFileWrite(targetPath, content) {
  const stagedPath = createTemporarySiblingPath(targetPath, 'superpowers-stage');
  ensureDirectory(path.dirname(stagedPath));
  fs.writeFileSync(stagedPath, content, 'utf8');
  return {
    targetPath,
    stagedPath,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const engineRoot = path.resolve(args.engineRoot || path.join(__dirname, '..'));
  const manifestPath = path.join(engineRoot, 'engine-assets', 'manifest.json');
  const provenancePath = path.join(engineRoot, 'engine-assets', 'superpowers-vendor.json');
  const sourceRoot = path.resolve(args.source || path.join(engineRoot, '.tmp', 'llm-work', 'superpowers-copilot', 'plugins', 'superpowers'));
  const sourceSkillsRoot = path.join(sourceRoot, 'skills');
  const sourceAgentsRoot = path.join(sourceRoot, 'agents');
  const targetSkillsRoot = path.join(engineRoot, 'engine-assets', 'skills');
  const targetAgentsRoot = path.join(engineRoot, 'engine-assets', 'agents');
  const desiredInventory = buildDesiredSuperpowersInventory();
  const recordedInventory = mergeManagedSuperpowersInventories([
    readRecordedSuperpowersInventory(manifestPath),
    readValidatedProvenanceSuperpowersInventory(provenancePath),
    desiredInventory,
  ]);

  if (!isDirectory(sourceRoot)) {
    throw new Error(`Superpowers source root not found: ${sourceRoot}`);
  }

  const validatedUpstreamSources = validateUpstreamSources(sourceSkillsRoot, sourceAgentsRoot);

  validateSourceTargetOverlap(
    [
      { label: 'source skills root', rootPath: sourceSkillsRoot },
      { label: 'source agents root', rootPath: sourceAgentsRoot },
    ],
    [
      { label: 'target skills root', rootPath: targetSkillsRoot },
      { label: 'target agents root', rootPath: targetAgentsRoot },
    ]
  );

  const stagedTargets = [];

  try {
    for (const { skillName, sourceSkillDir } of validatedUpstreamSources.sourceSkillDirectories) {
      const targetSkillDir = path.join(targetSkillsRoot, namespacedSkillName(skillName));
      const stagedSkillDir = createTemporarySiblingPath(targetSkillDir, 'superpowers-stage');
      copyDirectory(sourceSkillDir, stagedSkillDir);
      for (const filePath of listFilesRecursive(stagedSkillDir)) {
        maybeRewriteTextFile(filePath, (content, fileName) => rewriteTextContent(content, fileName, namespacedSkillName(skillName)));
      }
      stagedTargets.push({
        targetPath: targetSkillDir,
        stagedPath: stagedSkillDir,
      });
    }

    const { sourceAgentPath } = validatedUpstreamSources;
    const targetAgentPath = path.join(targetAgentsRoot, `${VENDORED_AGENT_NAME}.agent.md`);
    const stagedAgentPath = createTemporarySiblingPath(targetAgentPath, 'superpowers-stage');
    copyFile(sourceAgentPath, stagedAgentPath);
    maybeRewriteTextFile(stagedAgentPath, (content) => rewriteAgentContent(content));
    stagedTargets.push({
      targetPath: targetAgentPath,
      stagedPath: stagedAgentPath,
    });

    const preparedManifestContent = buildUpdatedManifestContent(desiredInventory, recordedInventory, manifestPath);
    const preparedProvenanceContent = buildProvenanceContent(engineRoot, sourceRoot, args.upstreamSha);
    stagedTargets.push(stageTextFileWrite(manifestPath, preparedManifestContent));
    stagedTargets.push(stageTextFileWrite(provenancePath, preparedProvenanceContent));

    const completedSwaps = swapStagedTargets(stagedTargets);
    const stagedPrunes = [];
    try {
      stagedPrunes.push(
        ...pruneVendoredSkillDirectories(targetSkillsRoot, recordedInventory.skillDirectories, desiredInventory.skillDirectories)
      );
      stagedPrunes.push(
        ...pruneVendoredAgentFiles(targetAgentsRoot, recordedInventory.agentFiles, desiredInventory.agentFiles)
      );
    } catch (error) {
      rollbackPrunedEntries(stagedPrunes);
      rollbackCompletedSwaps(completedSwaps);
      cleanupSwapBackups(completedSwaps);
      throw error;
    }

    cleanupPrunedBackups(stagedPrunes);
    cleanupSwapBackups(completedSwaps);
  } catch (error) {
    cleanupStagedTargets(stagedTargets);
    throw error;
  }

  console.log(`Vendored Superpowers workflow pack from ${sourceRoot}`);
}

main();
