'use strict';

const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');
const { sendJson } = require('./_helpers');

const PATTERN_ATLAS_DIR = path.resolve(__dirname, '..', 'content', 'pattern-atlas');

function listPatternFiles() {
  try {
    const entries = fs.readdirSync(PATTERN_ATLAS_DIR, { withFileTypes: true });
    return entries
      .filter(
        (entry) =>
          entry.isFile() &&
          (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml')) &&
          !entry.name.startsWith('__'),
      )
      .map((entry) => ({
        name: entry.name,
        id: entry.name.replace(/\.(yaml|yml)$/, ''),
        fullPath: path.join(PATTERN_ATLAS_DIR, entry.name),
      }));
  } catch {
    return [];
  }
}

/**
 * Convert a source value (string URL or {label, url} object) to a
 * normalized {label, url} object for the UI.
 */
function normalizeSource(source) {
  if (typeof source === 'string') {
    let label;
    try {
      const u = new URL(source);
      label = u.hostname.replace(/^www\./, '');
    } catch {
      label = source;
    }
    return { label, url: source };
  }
  // Already an object — pass through
  return source;
}

function loadAllEntries() {
  const files = listPatternFiles();
  const allEntries = [];
  const allTypes = new Set();
  const allDomains = new Set();
  const allTags = new Set();

  for (const file of files) {
    try {
      const content = fs.readFileSync(file.fullPath, 'utf8');
      const doc = yaml.load(content);
      if (!doc || !doc.name) continue;

      const entry = {
        id: file.id,
        name: doc.name,
        aliases: Array.isArray(doc.aliases) ? doc.aliases : [],
        tagline: doc.tagline || '',
        description: doc.description || '',
        type: doc.type || '',
        domain: doc.domain || '',
        confidence: doc.confidence || '',
        tags: Array.isArray(doc.tags) ? doc.tags.map((t) => String(t).toLowerCase()) : [],
        traits: Array.isArray(doc.traits) ? doc.traits : [],
        bestFit: Array.isArray(doc.bestFit) ? doc.bestFit : [],
        avoidIf: Array.isArray(doc.avoidIf) ? doc.avoidIf : [],
        commonFailures: Array.isArray(doc.commonFailures) ? doc.commonFailures : [],
        contrasts: Array.isArray(doc.contrasts) ? doc.contrasts : [],
        compatibilities: Array.isArray(doc.compatibilities) ? doc.compatibilities : [],
        promptLanguage: doc.promptLanguage || '',
        styleRecipe: doc.styleRecipe || '',
        sources: Array.isArray(doc.sources) ? doc.sources.map(normalizeSource) : [],
        image: doc.image || '',
      };

      allEntries.push(entry);

      if (entry.type) allTypes.add(entry.type);
      if (entry.domain) allDomains.add(entry.domain);
      for (const tag of entry.tags) {
        if (tag) allTags.add(tag);
      }
    } catch {
      // skip unparseable files
    }
  }

  // Build compatibilities lookup: entryId → name
  const compatLookup = {};
  for (const entry of allEntries) {
    compatLookup[entry.id] = entry.name;
  }

  // Resolve compat IDs to {entryId, name} objects
  for (const entry of allEntries) {
    if (Array.isArray(entry.compatibilities)) {
      entry.compatibilities = entry.compatibilities
        .map((id) => {
          const name = compatLookup[id];
          return name ? { entryId: id, name } : null;
        })
        .filter(Boolean);
    }
  }

  return {
    entries: allEntries,
    total: allEntries.length,
    filters: {
      types: [...allTypes].sort(),
      domains: [...allDomains].sort(),
      tags: [...allTags].sort(),
    },
  };
}

function searchEntries(entries, query) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return entries;

  const scored = entries.map((entry) => {
    let score = 0;
    const nameLower = entry.name.toLowerCase();
    const aliasesLower = entry.aliases.map((a) => a.toLowerCase());
    const taglineLower = entry.tagline.toLowerCase();
    const descriptionLower = entry.description.toLowerCase();
    const tagsLower = entry.tags.map((t) => t.toLowerCase());
    const traitsLower = entry.traits.map((t) => String(t).toLowerCase());

    for (const term of terms) {
      // name: 100
      if (nameLower === term) {
        score += 100;
      } else if (nameLower.startsWith(term)) {
        score += 80;
      } else if (nameLower.includes(term)) {
        score += 60;
      } else {
        const nameWords = nameLower.split(/[\s-/]+/);
        if (nameWords.some((w) => w.startsWith(term) && w.length > 1)) {
          score += 50;
        }
      }

      // aliases: 80
      if (aliasesLower.some((a) => a === term)) {
        score += 80;
      } else if (aliasesLower.some((a) => a.includes(term))) {
        score += 60;
      }

      // tagline: 60
      if (taglineLower.includes(term)) {
        score += 60;
      }

      // description: 30
      if (descriptionLower.includes(term)) {
        score += 30;
      }

      // tags: 70
      if (tagsLower.includes(term)) {
        score += 70;
      } else if (tagsLower.some((t) => t.includes(term))) {
        score += 50;
      }

      // traits: 40
      if (traitsLower.includes(term)) {
        score += 40;
      } else if (traitsLower.some((t) => t.includes(term))) {
        score += 30;
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
      path: '/api/pattern-atlas',
      handler: (ctx) => {
        try {
          const query = (ctx.query && ctx.query.q || '').trim();
          const typeFilter = (ctx.query && ctx.query.type || '').trim();
          const domainFilter = (ctx.query && ctx.query.domain || '').trim();
          const confidenceFilter = (ctx.query && ctx.query.confidence || '').trim();
          const tagFilter = (ctx.query && ctx.query.tag || '').trim();

          const data = loadAllEntries();
          let filtered = data.entries;

          if (typeFilter) {
            filtered = filtered.filter((e) => e.type === typeFilter);
          }
          if (domainFilter) {
            filtered = filtered.filter((e) => e.domain === domainFilter);
          }
          if (confidenceFilter) {
            filtered = filtered.filter((e) => e.confidence === confidenceFilter);
          }
          if (tagFilter) {
            filtered = filtered.filter((e) => e.tags.includes(tagFilter.toLowerCase()));
          }
          if (query) {
            filtered = searchEntries(filtered, query);
          }

          sendJson(ctx.res, 200, {
            entries: filtered,
            total: data.total,
            filteredTotal: filtered.length,
            filters: data.filters,
          });
        } catch (error) {
          sendJson(ctx.res, 500, {
            error: error instanceof Error ? error.message : String(error),
            entries: [],
            total: 0,
            filteredTotal: 0,
            filters: { types: [], domains: [], tags: [] },
          });
        }
      },
    },
  ];
}

module.exports = { register };
