#!/usr/bin/env node
'use strict';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MANIFESTS = [
  'engine-assets/manifest.json',
  'codex-assets/manifest.json',
  'opencode-assets/manifest.json',
  'claude-assets/manifest.json',
  'antigravity-assets/manifest.json',
  'ghcp-assets/manifest.json',
];

const EXTRA_SURFACES = [
  'catalog-assets/instructions/agent-session-defaults.md',
  'engine-assets/copilot-instructions-appendix.md',
  'codex-assets/home/AGENTS-appendix.md',
  'opencode-assets/home/AGENTS-appendix.md',
  'claude-assets/home/CLAUDE-appendix.md',
  'antigravity-assets/home/GEMINI-appendix.md',
  'ghcp-assets/home/AGENTS-appendix.md',
];

const ASSET_SCAN_ROOTS = [
  'engine-assets',
  'catalog-assets',
  'codex-assets',
  'opencode-assets',
  'claude-assets',
  'antigravity-assets',
  'ghcp-assets',
];

const TEXT_EXTENSIONS = new Set(['.md', '.toml', '.yaml', '.yml', '.json']);
const SCANNED_ASSET_TYPES = new Set(['instructions', 'agent', 'prompt', 'skill']);

const BUDGETS = {
  instructions: { maxLines: 260, maxBytes: 18000 },
  appendix: { maxLines: 170, maxBytes: 12000 },
  agent: { maxLines: 360, maxBytes: 24000 },
  prompt: { maxLines: 220, maxBytes: 16000 },
  skill: { maxLines: 760, maxBytes: 48000 },
  reference: { maxLines: 760, maxBytes: 48000 },
};

const PSEUDO_THEORY_PATTERNS = [
  {
    id: 'pseudo-pretrained-word',
    pattern: /\bpretrained\s+word\b/i,
    message: 'Avoid pseudo-theory about pretrained words; use concrete routing terms.',
  },
  {
    id: 'pseudo-cognitive-load',
    pattern: /\bcognitive\s+load\b/i,
    message: 'Avoid cognitive-load framing in shipped instructions; state the operational rule.',
  },
  {
    id: 'pseudo-semantic-anchor',
    pattern: /\bsemantic\s+anchor\b/i,
    message: 'Avoid semantic-anchor prompting theory; name the concrete behavior.',
  },
  {
    id: 'pseudo-priming',
    pattern: /\b(prompt\s+)?priming\b/i,
    message: 'Avoid priming language in shipped instructions.',
  },
  {
    id: 'pseudo-latent',
    pattern: /\blatent\s+(space|reasoning|capabilit(?:y|ies)|intent)\b/i,
    message: 'Avoid latent-space style prompting theory in operational instructions.',
  },
  {
    id: 'pseudo-scaffold',
    pattern: /\b(cognitive|reasoning|semantic)\s+scaffold\b/i,
    message: 'Avoid scaffold metaphors where a direct contract fits.',
  },
  {
    id: 'prompt-hacking-language',
    pattern: /\b(prompt\s+(alchemy|hack(?:ing)?|spell|trick)|jailbreak\s+style)\b/i,
    message: 'Avoid prompt-hacking or alchemy language in maintained assets.',
  },
];

const VAGUE_DIRECTIVE_PATTERNS = [
  {
    id: 'vague-make-robust',
    pattern: /\b(make|keep|ensure|be)\s+(it\s+)?robust\b/i,
    message: 'Replace vague robustness commands with failure modes and checks.',
  },
  {
    id: 'vague-high-quality',
    pattern: /\b(high[- ]quality|best[- ]in[- ]class|world[- ]class)\b/i,
    message: 'Replace broad quality claims with acceptance evidence.',
  },
  {
    id: 'vague-rich-sophisticated',
    pattern: /\brich\s+and\s+sophisticated\b/i,
    message: 'Replace taste adjectives with concrete UI or output requirements.',
  },
  {
    id: 'vague-delight',
    pattern: /\b(delight(?:ful)?|magical|beautifully)\b/i,
    message: 'Avoid motivational adjectives in instruction assets.',
  },
];

const CEREMONY_PATTERNS = [
  {
    id: 'ceremony-praise',
    pattern: /\b(great job|excellent work|you'?ve got this|let'?s dive in)\b/i,
    message: 'Remove conversational ceremony from reusable instructions.',
  },
  {
    id: 'ceremony-identity',
    pattern: /\byou are a deeply\b/i,
    message: 'Avoid expansive persona setup in repo-managed assets.',
  },
];

function findRepoRoot(fromDir) {
  let current = path.resolve(fromDir);
  while (true) {
    if (fs.existsSync(path.join(current, '.git'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function normalizeRel(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function isTextAsset(filePath) {
  return TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function walkTextFiles(rootPath) {
  const results = [];
  if (!fs.existsSync(rootPath)) return results;
  const stat = fs.statSync(rootPath);
  if (stat.isFile()) {
    return isTextAsset(rootPath) ? [rootPath] : [];
  }
  for (const entry of fs.readdirSync(rootPath, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === 'node_modules' || entry.name === 'ui-dist') continue;
    const child = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkTextFiles(child));
    } else if (entry.isFile() && isTextAsset(child)) {
      results.push(child);
    }
  }
  return results;
}

function isInstructionLikeAssetFile(filePath) {
  const base = path.basename(filePath);
  const lower = base.toLowerCase();
  const parent = path.basename(path.dirname(filePath)).toLowerCase();
  if (base === 'SKILL.md') return true;
  if (lower.endsWith('.agent.md')) return true;
  if (lower.endsWith('.prompt.md')) return true;
  if (lower.endsWith('-appendix.md')) return true;
  if (base === 'AGENTS.md' || base === 'CLAUDE.md' || base === 'GEMINI.md') return true;
  if (lower.endsWith('.toml') && parent === 'agents') return true;
  if ((lower.endsWith('.yaml') || lower.endsWith('.yml')) && parent === 'agents') return true;
  return false;
}

function classifyPathKind(filePath) {
  const base = path.basename(filePath);
  const lower = base.toLowerCase();
  if (base === 'SKILL.md') return 'skill';
  if (lower.endsWith('.agent.md') || lower.endsWith('.toml') || lower.endsWith('.yaml') || lower.endsWith('.yml')) return 'agent';
  if (lower.endsWith('.prompt.md')) return 'prompt';
  if (lower.endsWith('-appendix.md')) return 'appendix';
  if (base === 'AGENTS.md' || base === 'CLAUDE.md' || base === 'GEMINI.md') return 'instructions';
  return 'reference';
}

function classifyExtraSurface(rel) {
  if (rel.includes('appendix')) return 'appendix';
  return 'instructions';
}

function classifyAssetFile(asset, absPath) {
  if (asset.type === 'skill' && path.basename(absPath) !== 'SKILL.md') return 'reference';
  return asset.type || 'reference';
}

function collectInstructionAssets(repoRoot) {
  const byPath = new Map();

  function add(absPath, source, kind) {
    const resolved = path.resolve(absPath);
    if (!fs.existsSync(resolved) || !isTextAsset(resolved)) return;
    const rel = normalizeRel(path.relative(repoRoot, resolved));
    const current = byPath.get(resolved);
    const record = {
      path: resolved,
      rel,
      kind,
      sources: current ? [...current.sources, source] : [source],
    };
    byPath.set(resolved, record);
  }

  for (const rel of EXTRA_SURFACES) {
    add(path.join(repoRoot, rel), 'extra-surface', classifyExtraSurface(rel));
  }

  for (const manifestRel of MANIFESTS) {
    const manifestPath = path.join(repoRoot, manifestRel);
    if (!fs.existsSync(manifestPath)) continue;
    const manifest = readJson(manifestPath);
    for (const asset of Array.isArray(manifest.assets) ? manifest.assets : []) {
      if (!asset || !SCANNED_ASSET_TYPES.has(asset.type) || !asset.source) continue;
      const sourcePath = path.join(repoRoot, normalizeRel(asset.source));
      for (const filePath of walkTextFiles(sourcePath)) {
        add(filePath, `${manifestRel}:${asset.id || asset.source}`, classifyAssetFile(asset, filePath));
      }
      if (asset.appendix) {
        const appendixPath = path.join(repoRoot, normalizeRel(asset.appendix));
        add(appendixPath, `${manifestRel}:${asset.id || asset.source}:appendix`, 'appendix');
      }
    }
  }

  for (const rootRel of ASSET_SCAN_ROOTS) {
    const rootPath = path.join(repoRoot, rootRel);
    for (const filePath of walkTextFiles(rootPath)) {
      if (!isInstructionLikeAssetFile(filePath)) continue;
      add(filePath, `${rootRel}:instruction-like-scan`, classifyPathKind(filePath));
    }
  }

  return [...byPath.values()].sort((a, b) => a.rel.localeCompare(b.rel));
}

function lineNumberForIndex(text, index) {
  return String(text).slice(0, index).split(/\r?\n/).length;
}

function stripCodeFences(text) {
  return String(text).replace(/```[\s\S]*?```/g, '');
}

function stripInstructionExamples(text) {
  return stripCodeFences(text).replace(/`[^`\n]+`/g, '');
}

function splitSentences(text) {
  const plain = stripCodeFences(text)
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '---')
    .map((line) => line.replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, ''))
    .filter(Boolean)
    .join(' ');
  return plain
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.replace(/\s+/g, ' ').trim())
    .filter((sentence) => sentence.length >= 80);
}

function checkPatterns(record, text, patterns, diagnostics) {
  const searchable = stripInstructionExamples(text);
  for (const entry of patterns) {
    const match = entry.pattern.exec(searchable);
    entry.pattern.lastIndex = 0;
    if (!match) continue;
    diagnostics.push({
      id: entry.id,
      status: 'violation',
      file: record.rel,
      line: lineNumberForIndex(searchable, match.index),
      detail: `${entry.message} Matched "${match[0]}".`,
    });
  }
}

function checkRepeatedSentences(record, text, diagnostics) {
  const seen = new Map();
  for (const sentence of splitSentences(text)) {
    const normalized = sentence.toLowerCase();
    if (!seen.has(normalized)) {
      seen.set(normalized, sentence);
      continue;
    }
    diagnostics.push({
      id: 'duplicate-sentence',
      status: 'violation',
      file: record.rel,
      line: null,
      detail: `Repeated long sentence: "${sentence.slice(0, 140)}${sentence.length > 140 ? '...' : ''}"`,
    });
    return;
  }
}

function checkBudget(record, text, diagnostics) {
  const budget = BUDGETS[record.kind] || BUDGETS.reference;
  const lines = text.split(/\r?\n/).length;
  const bytes = Buffer.byteLength(text, 'utf8');
  if (lines > budget.maxLines) {
    diagnostics.push({
      id: 'asset-line-budget',
      status: 'violation',
      file: record.rel,
      line: null,
      detail: `${record.kind} asset has ${lines} lines; limit is ${budget.maxLines}.`,
    });
  }
  if (bytes > budget.maxBytes) {
    diagnostics.push({
      id: 'asset-byte-budget',
      status: 'violation',
      file: record.rel,
      line: null,
      detail: `${record.kind} asset has ${bytes} bytes; limit is ${budget.maxBytes}.`,
    });
  }
}

function analyzeInstructionQuality(repoRoot) {
  const assets = collectInstructionAssets(repoRoot);
  const diagnostics = [];

  for (const record of assets) {
    const text = fs.readFileSync(record.path, 'utf8');
    checkBudget(record, text, diagnostics);
    checkPatterns(record, text, PSEUDO_THEORY_PATTERNS, diagnostics);
    checkPatterns(record, text, VAGUE_DIRECTIVE_PATTERNS, diagnostics);
    checkPatterns(record, text, CEREMONY_PATTERNS, diagnostics);
    checkRepeatedSentences(record, text, diagnostics);
  }

  return {
    assets,
    diagnostics: diagnostics.sort((a, b) => {
      const fileCompare = a.file.localeCompare(b.file);
      if (fileCompare !== 0) return fileCompare;
      return a.id.localeCompare(b.id);
    }),
  };
}

function main() {
  const useJson = process.argv.includes('--json');
  const repoRoot = findRepoRoot(__dirname);
  if (!repoRoot) {
    console.error('ERROR: Could not find repo root.');
    process.exit(1);
  }

  const result = analyzeInstructionQuality(repoRoot);
  if (useJson) {
    console.log(JSON.stringify({
      checks: result.diagnostics,
      summary: {
        scanned: result.assets.length,
        fail: result.diagnostics.length,
      },
    }, null, 2));
  } else if (result.diagnostics.length === 0) {
    console.log(`instruction-quality: ok — scanned ${result.assets.length} instruction assets`);
  } else {
    for (const diagnostic of result.diagnostics) {
      const location = diagnostic.line ? `${diagnostic.file}:${diagnostic.line}` : diagnostic.file;
      console.error(`instruction-quality: ${diagnostic.id}: ${location} — ${diagnostic.detail}`);
    }
  }

  if (result.diagnostics.length > 0) process.exit(1);
}

export {
  analyzeInstructionQuality,
  collectInstructionAssets,
  splitSentences,
};

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main();
}
