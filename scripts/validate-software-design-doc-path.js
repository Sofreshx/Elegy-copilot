#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const errors = [];

function check(filePath, wikilink, mdLink, missingCode, invalidPairCode) {
  const abs = path.join(ROOT, filePath);
  if (!fs.existsSync(abs)) {
    errors.push(`${missingCode} File not found: ${filePath}`);
    return;
  }
  const content = fs.readFileSync(abs, 'utf8');
  const hasWiki = content.includes(`[[${wikilink}]]`);
  const hasMd = content.includes(mdLink);

  if (!hasWiki && !hasMd) {
    errors.push(`${missingCode} Missing edge: ${wikilink} in ${filePath}`);
    return;
  }
  if (!hasWiki || !hasMd) {
    errors.push(`${invalidPairCode} Dual-link incomplete in ${filePath}: wikilink=${hasWiki}, mdLink=${hasMd}`);
  }
  // Check same or adjacent line
  if (hasWiki && hasMd) {
    const lines = content.split('\n');
    let found = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes(`[[${wikilink}]]`) && line.includes(mdLink)) { found = true; break; }
      if (line.includes(`[[${wikilink}]]`) && i + 1 < lines.length && lines[i + 1].includes(mdLink)) { found = true; break; }
      if (line.includes(mdLink) && i + 1 < lines.length && lines[i + 1].includes(`[[${wikilink}]]`)) { found = true; break; }
    }
    if (!found) {
      errors.push(`${invalidPairCode} Dual-link not on same/adjacent line in ${filePath}`);
    }
  }
}

// Edge A: index -> moc-software-design-concepts
check(
  'docs/system/index.md',
  'moc-software-design-concepts',
  'docs/system/mocs/software-design-concepts.md',
  'SDP001',
  'SDP005A'
);

// Edge B: moc -> glossary
check(
  'docs/system/mocs/software-design-concepts.md',
  'software-design-concepts-glossary',
  'docs/system/software-design-concepts-glossary.md',
  'SDP002',
  'SDP005B'
);

// Edge C: orchestration-and-agents -> moc-software-design-concepts
check(
  'docs/system/mocs/orchestration-and-agents.md',
  'moc-software-design-concepts',
  'docs/system/mocs/software-design-concepts.md',
  'SDP003',
  'SDP005C'
);

if (errors.length > 0) {
  errors.sort();
  for (const e of errors) console.error(e);
  process.exit(1);
} else {
  console.log('SDP: All edges valid.');
  process.exit(0);
}
