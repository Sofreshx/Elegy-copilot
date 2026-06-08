/**
 * spec-headings.js — Heading and frontmatter extraction utilities for spec.md files.
 *
 * Exports:
 *   matchFrontmatter(text)    — Extract YAML frontmatter block delimited by `---`
 *   extractH2Sections(body)   — Split markdown body into `##` heading sections
 */

// Spec-System Hardening (R6): Shared markdown heading extraction. Extracted from validate-specs.js.
// Provides matchFrontmatter() and extractH2Sections(). Used by all spec validators.

'use strict';

/**
 * Match and extract the YAML frontmatter block from a spec file's raw text.
 * Returns null if the text does not start with `---`.
 *
 * @param {string} text — raw file content
 * @returns {{ full: string, yaml: string } | null}
 */
function matchFrontmatter(text) {
  if (!String(text || '').startsWith('---')) {
    return null;
  }

  const match = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    return null;
  }

  return {
    full: match[0],
    yaml: match[1],
  };
}

/**
 * Split a markdown body into sections keyed by `##` heading titles.
 *
 * @param {string} markdownBody — markdown content after frontmatter
 * @returns {Map<string, string>} heading title → section content
 */
function extractH2Sections(markdownBody) {
  const lines = String(markdownBody || '').split(/\r?\n/);
  const sections = new Map();
  let currentHeading = '';
  let currentLines = [];

  function commitCurrent() {
    if (!currentHeading) {
      return;
    }
    sections.set(currentHeading, currentLines.join('\n').trim());
  }

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+?)\s*$/);
    if (headingMatch) {
      commitCurrent();
      currentHeading = headingMatch[1].trim();
      currentLines = [];
      continue;
    }

    if (currentHeading) {
      currentLines.push(line);
    }
  }

  commitCurrent();
  return sections;
}

module.exports = {
  matchFrontmatter,
  extractH2Sections,
};
