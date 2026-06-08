import fs from 'fs';

export function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { frontmatter: {}, body: content, raw: '' };

  const raw = match[1];
  const frontmatter = {};
  const lines = raw.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex === -1) continue;
    const key = trimmed.slice(0, colonIndex).trim();
    if (!key) continue;
    let value = trimmed.slice(colonIndex + 1).trim();
    if (value === '' || value === '{}') continue;
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    if (!frontmatter[key]) {
      frontmatter[key] = value;
    }
  }

  const body = content.slice(match[0].length);
  return { frontmatter, body, raw };
}

export function replaceFrontmatterField(content, field, newValue) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return content;

  const raw = match[1];
  const lines = raw.split('\n');
  const updated = lines.map(line => {
    const trimmed = line.trim();
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex === -1) return line;
    const key = trimmed.slice(0, colonIndex).trim();
    if (key !== field) return line;
    const indent = line.match(/^(\s*)/)[1];
    const needsQuotes = String(newValue).includes(':') || String(newValue).includes('#');
    const safeValue = needsQuotes ? `"${newValue}"` : String(newValue);
    return `${indent}${field}: ${safeValue}`;
  }).join('\n');

  return `---\n${updated}\n---${content.slice(match[0].length)}`;
}

export function updateAgentModel(filePath, profile, agentRoles) {
  if (!fs.existsSync(filePath)) return null;

  const agentName = filePath.replace(/\.md$/, '').split('/').pop().split('\\').pop();
  const role = agentRoles[agentName];
  if (!role) return null;

  const modelKey = role;
  const newModel = profile[modelKey];
  const reasoningEffort = profile.reasoningEffort;

  if (!newModel) return null;

  let content = fs.readFileSync(filePath, 'utf8');
  // Normalize CRLF → LF for consistent parsing across platforms
  content = content.replace(/\r\n/g, '\n');
  const { frontmatter } = parseFrontmatter(content);
  const oldModel = frontmatter.model;

  content = replaceFrontmatterField(content, 'model', newModel);
  if (reasoningEffort) {
    content = replaceFrontmatterField(content, 'reasoningEffort', reasoningEffort);
  }

  fs.writeFileSync(filePath, content, 'utf8');

  return {
    agent: agentName,
    role,
    oldModel,
    newModel,
  };
}
