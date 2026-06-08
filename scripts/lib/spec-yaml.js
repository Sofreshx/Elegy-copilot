/**
 * spec-yaml.js — Shared YAML frontmatter parser for spec.md files.
 *
 * Exports:
 *   parseInlineList(value)     — Parse an inline array like [a, b, c] from a value string
 *   parseFrontmatterYaml(yamlText) — Parse key:value YAML frontmatter into a flat object
 */

// Spec-System Hardening (R6): Shared YAML frontmatter parser. Extracted from validate-specs.js.
// Used by: validate-specs.js, validate-doc-graph.js, spec-readiness-report.js, generate-spec-index.js

'use strict';

/**
 * Parse an inline list value like `[a, b, "c d"]` into an array of strings.
 * Returns null if the value is not an inline list.
 *
 * @param {string} value
 * @returns {string[]|null}
 */
function parseInlineList(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) {
    return null;
  }

  const inner = trimmed.slice(1, -1).trim();
  if (!inner) {
    return [];
  }

  return inner
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((item) => item.replace(/^['"]|['"]$/g, ''));
}

/**
 * Parse spec frontmatter YAML text into a flat metadata object.
 * Handles key:value pairs, inline lists, and dash-prefixed block lists.
 *
 * @param {string} yamlText — the raw YAML text between `---` markers
 * @returns {Object} flat key-value map
 * @throws {Error} on parse errors (duplicate keys, invalid syntax)
 */
function parseFrontmatterYaml(yamlText) {
  const meta = {};
  const lines = String(yamlText || '').split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const line = rawLine.trim();

    if (!line || line.startsWith('#')) {
      continue;
    }

    const colonIndex = line.indexOf(':');
    if (colonIndex <= 0) {
      throw new Error(`Invalid YAML line (expected key: value): ${rawLine}`);
    }

    const key = line.slice(0, colonIndex).trim();
    let value = line.slice(colonIndex + 1).trim();
    if (!key) {
      throw new Error(`Invalid YAML key: ${rawLine}`);
    }

    if (Object.prototype.hasOwnProperty.call(meta, key)) {
      throw new Error(`Duplicate YAML key: ${key}`);
    }

    if (value === '') {
      const items = [];
      while (index + 1 < lines.length) {
        const nextRaw = lines[index + 1];
        const next = nextRaw.trim();
        if (!next) {
          index += 1;
          continue;
        }
        if (!next.startsWith('-')) {
          break;
        }
        const item = next.replace(/^-\s*/, '').trim().replace(/^['"]|['"]$/g, '');
        if (item) {
          items.push(item);
        }
        index += 1;
      }

      meta[key] = items;
      continue;
    }

    const inlineList = parseInlineList(value);
    if (inlineList !== null) {
      meta[key] = inlineList;
      continue;
    }

    value = value.replace(/^['"]|['"]$/g, '');
    meta[key] = value;
  }

  return meta;
}

module.exports = {
  parseInlineList,
  parseFrontmatterYaml,
};
