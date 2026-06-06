'use strict';

const GLOBAL_HARNESSES = Object.freeze([
  { id: 'copilot', title: 'Copilot', home: '~/.copilot', skillsHome: '~/.copilot/skills', supportsMcp: false },
  { id: 'codex', title: 'Codex', home: '~/.codex', skillsHome: '~/.codex/skills', supportsMcp: true },
  { id: 'opencode', title: 'OpenCode', home: '~/.config/opencode', skillsHome: '~/.config/opencode/skills', supportsMcp: true },
  { id: 'antigravity', title: 'Antigravity', home: '~/.gemini/antigravity', skillsHome: '~/.gemini/antigravity/skills', supportsMcp: false },
  { id: 'gemini-cli', title: 'Antigravity CLI', home: '~/.gemini', skillsHome: null, supportsMcp: true },
  { id: 'claude-code', title: 'Claude Code', home: '~/.claude', skillsHome: null, supportsMcp: false },
]);

function normalizeHarnessId(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return normalized === 'antigravity-cli' ? 'gemini-cli' : normalized;
}

function getHarnessById(value) {
  const normalized = normalizeHarnessId(value);
  return GLOBAL_HARNESSES.find((entry) => entry.id === normalized) || null;
}

function humanizeHarnessId(value) {
  const harness = getHarnessById(value);
  if (harness) {
    return harness.title;
  }
  return normalizeHarnessId(value) || 'Unknown';
}

module.exports = {
  GLOBAL_HARNESSES,
  normalizeHarnessId,
  getHarnessById,
  humanizeHarnessId,
};
