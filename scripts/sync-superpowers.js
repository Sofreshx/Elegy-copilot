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

function updateManifest(manifestPath) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const superpowersAssetIds = new Set();
  const superpowersAssets = [];

  for (const skillName of SKILL_NAMES) {
    const assetKey = namespacedSkillName(skillName);
    const assetId = `skill-${assetKey}`;
    superpowersAssetIds.add(assetId);
    superpowersAssets.push({
      id: assetId,
      type: 'skill',
      source: `engine-assets/skills/${assetKey}`,
      destination: `skills/${assetKey}`,
      loadMode: 'on-demand',
    });
  }

  superpowersAssetIds.add(`agent-${VENDORED_AGENT_NAME}`);
  superpowersAssets.push({
    id: `agent-${VENDORED_AGENT_NAME}`,
    type: 'agent',
    source: `engine-assets/agents/${VENDORED_AGENT_NAME}.agent.md`,
    destination: `agents/${VENDORED_AGENT_NAME}.agent.md`,
  });

  const existingAssets = Array.isArray(manifest.assets) ? manifest.assets : [];
  manifest.assets = existingAssets
    .filter((asset) => !superpowersAssetIds.has(String(asset && asset.id ? asset.id : '')))
    .concat(superpowersAssets)
    .sort((left, right) => String(left.id || '').localeCompare(String(right.id || '')));

  const existingBundles = Array.isArray(manifest.bundles) ? manifest.bundles : [];
  const nextBundle = {
    id: BUNDLE_ID,
    title: 'Superpowers Workflow Pack',
    description: 'Optional Jesse Vincent Superpowers workflow skills and reviewer agent, vendored for one-click installation through the catalog control plane.',
    assetIds: superpowersAssets.map((asset) => asset.id),
    installTarget: 'user-global',
    activationScope: 'global',
    materialization: 'on-demand',
    tags: ['superpowers', 'workflow', 'planning', 'debugging', 'tdd'],
    defaultRecommended: false,
    dependsOn: [],
  };
  manifest.bundles = existingBundles
    .filter((bundle) => String(bundle && bundle.id ? bundle.id : '') !== BUNDLE_ID)
    .concat([nextBundle]);

  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

function writeProvenance(engineRoot, sourceRoot, upstreamSha) {
  const provenancePath = path.join(engineRoot, 'engine-assets', 'superpowers-vendor.json');
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

  fs.writeFileSync(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`, 'utf8');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const engineRoot = path.resolve(args.engineRoot || path.join(__dirname, '..'));
  const sourceRoot = path.resolve(args.source || path.join(engineRoot, '.tmp', 'llm-work', 'superpowers-copilot', 'plugins', 'superpowers'));
  const sourceSkillsRoot = path.join(sourceRoot, 'skills');
  const sourceAgentsRoot = path.join(sourceRoot, 'agents');
  const targetSkillsRoot = path.join(engineRoot, 'engine-assets', 'skills');
  const targetAgentsRoot = path.join(engineRoot, 'engine-assets', 'agents');

  if (!isDirectory(sourceRoot)) {
    throw new Error(`Superpowers source root not found: ${sourceRoot}`);
  }

  for (const skillName of SKILL_NAMES) {
    const sourceSkillDir = path.join(sourceSkillsRoot, skillName);
    const targetSkillDir = path.join(targetSkillsRoot, namespacedSkillName(skillName));
    if (!isDirectory(sourceSkillDir)) {
      throw new Error(`Missing upstream skill directory: ${sourceSkillDir}`);
    }

    copyDirectory(sourceSkillDir, targetSkillDir);
    for (const filePath of listFilesRecursive(targetSkillDir)) {
      maybeRewriteTextFile(filePath, (content, fileName) => rewriteTextContent(content, fileName, namespacedSkillName(skillName)));
    }
  }

  const sourceAgentPath = path.join(sourceAgentsRoot, `${AGENT_NAME}.md`);
  const targetAgentPath = path.join(targetAgentsRoot, `${VENDORED_AGENT_NAME}.agent.md`);
  if (!isFile(sourceAgentPath)) {
    throw new Error(`Missing upstream agent file: ${sourceAgentPath}`);
  }
  copyFile(sourceAgentPath, targetAgentPath);
  maybeRewriteTextFile(targetAgentPath, (content) => rewriteAgentContent(content));

  updateManifest(path.join(engineRoot, 'engine-assets', 'manifest.json'));
  // Keep vendored Superpowers assets available through the canonical engine manifest
  // and optional bundle metadata, but do not auto-promote them into the public CLI
  // shipping allowlist.
  writeProvenance(engineRoot, sourceRoot, args.upstreamSha);

  console.log(`Vendored Superpowers workflow pack from ${sourceRoot}`);
}

main();
