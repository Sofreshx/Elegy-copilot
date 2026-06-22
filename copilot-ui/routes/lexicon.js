'use strict';

const path = require('path');
const fs = require('fs');
const { sendJson } = require('./_helpers');

const LEXICON_DIR = path.resolve(__dirname, '..', '..', 'docs', 'lexicon');

const CATEGORY_LABELS = {
  'ui': 'UI & Interaction',
  'design': 'Design Concepts',
  'architecture': 'Software Architecture',
  'programming': 'Programming & Paradigms',
  'data': 'Data & Storage',
  'networking-api': 'Networking & APIs',
  'infrastructure': 'Infrastructure & DevOps',
  'testing': 'Testing & Quality',
  'security': 'Security',
  'concurrency': 'Concurrency & Performance',
  'process': 'Methodologies & Process',
  'ai-ml': 'AI & Machine Learning',
  'project-specific': 'Elegy Copilot & Holon',
};

const TAG_REGEX = /\*\*Tags:\*\*\s*(.+)/i;
const DEFINITION_REGEX = /\*\*Definition:\*\*\s*(.+)/i;
const USAGE_REGEX = /\*\*Usage:\*\*\s*(.+)/i;
const RELATED_REGEX = /\*\*Related:\*\*\s*(.+)/i;

let cachedResult = null;
let cachedMtime = null;

function listLexiconFiles() {
  try {
    const entries = fs.readdirSync(LEXICON_DIR, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && !entry.name.startsWith('__'))
      .map((entry) => ({
        name: entry.name,
        category: entry.name.replace(/\.md$/, ''),
        fullPath: path.join(LEXICON_DIR, entry.name),
      }));
  } catch {
    return [];
  }
}

function parseTags(raw) {
  if (!raw) return [];
  return raw
    .split(',')
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
}

function parseLexiconFile(filePath, category, categoryLabel) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const entries = [];

  let currentTerm = null;
  let currentFields = {};

  function flushEntry() {
    if (!currentTerm) return;
    entries.push({
      term: currentTerm,
      definition: (currentFields.definition || '').trim(),
      usage: (currentFields.usage || '').trim(),
      related: (currentFields.related || '').trim(),
      tags: parseTags(currentFields.tags),
      file: category,
      categoryLabel,
    });
  }

  for (const line of lines) {
    const termMatch = line.match(/^###\s+(.+)/);
    if (termMatch) {
      flushEntry();
      currentTerm = termMatch[1].trim();
      currentFields = {};
      continue;
    }

    if (!currentTerm) continue;

    const defMatch = line.match(DEFINITION_REGEX);
    if (defMatch) {
      currentFields.definition = (currentFields.definition || '') + defMatch[1].trim();
      continue;
    }

    const usageMatch = line.match(USAGE_REGEX);
    if (usageMatch) {
      currentFields.usage = (currentFields.usage || '') + usageMatch[1].trim();
      continue;
    }

    const relatedMatch = line.match(RELATED_REGEX);
    if (relatedMatch) {
      currentFields.related = (currentFields.related || '') + relatedMatch[1].trim();
      continue;
    }

    const tagsMatch = line.match(TAG_REGEX);
    if (tagsMatch) {
      currentFields.tags = (currentFields.tags || '') + tagsMatch[1].trim();
      continue;
    }
  }

  flushEntry();
  return entries;
}

function loadAllEntries() {
  const files = listLexiconFiles();

  let latestMtime = 0;
  for (const file of files) {
    try {
      const stat = fs.statSync(file.fullPath);
      if (stat.mtimeMs > latestMtime) latestMtime = stat.mtimeMs;
    } catch {
      // skip
    }
  }

  if (cachedResult && cachedMtime === latestMtime) {
    return cachedResult;
  }

  const allEntries = [];

  for (const file of files) {
    const categoryLabel = CATEGORY_LABELS[file.category] || file.category;
    try {
      const entries = parseLexiconFile(file.fullPath, file.category, categoryLabel);
      allEntries.push(...entries);
    } catch {
      // skip unparseable files
    }
  }

  cachedResult = {
    entries: allEntries,
    total: allEntries.length,
    categories: { ...CATEGORY_LABELS },
  };
  cachedMtime = latestMtime;

  return cachedResult;
}

function searchEntries(entries, query) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return entries;

  const scored = entries.map((entry) => {
    let score = 0;
    const termLower = entry.term.toLowerCase();
    const definitionLower = (entry.definition || '').toLowerCase();
    const usageLower = (entry.usage || '').toLowerCase();
    const tagsLower = entry.tags.map((t) => t.toLowerCase());

    for (const term of terms) {
      if (termLower === term) {
        score += 100;
      } else if (termLower.startsWith(term)) {
        score += 80;
      } else if (termLower.includes(term)) {
        score += 60;
      } else {
        const nameWords = termLower.split(/[\s-/]+/);
        if (nameWords.some((w) => w.startsWith(term) && w.length > 1)) {
          score += 50;
        }
      }

      if (tagsLower.includes(term)) {
        score += 70;
      } else if (tagsLower.some((t) => t.includes(term))) {
        score += 50;
      }

      if (definitionLower.includes(term)) {
        score += 30;
      }
      if (usageLower.includes(term)) {
        score += 20;
      }
    }

    return { entry, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 50)
    .map((s) => s.entry);
}

function register(context = {}) {
  return [
    {
      method: 'GET',
      path: '/api/lexicon',
      handler: (ctx) => {
        try {
          const query = (ctx.u.searchParams.get('q') || '').trim();
          const category = (ctx.u.searchParams.get('category') || '').trim();

          const data = loadAllEntries();

          let filtered = data.entries;

          if (category && data.categories[category]) {
            filtered = filtered.filter((e) => e.file === category);
          }

          if (query) {
            filtered = searchEntries(filtered, query);
          }

          sendJson(ctx.res, 200, {
            entries: filtered,
            total: data.total,
            filteredTotal: filtered.length,
            categories: data.categories,
          });
        } catch (error) {
          sendJson(ctx.res, 500, {
            error: error instanceof Error ? error.message : String(error),
            entries: [],
            total: 0,
            filteredTotal: 0,
            categories: CATEGORY_LABELS,
          });
        }
      },
    },
  ];
}

module.exports = { register };
