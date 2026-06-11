'use strict';

const GLOBAL_HARNESSES = Object.freeze([
  { id: 'copilot', title: 'Elegy', home: '~/.elegy', skillsHome: '~/.elegy/skills', supportsMcp: false, homeKey: 'elegyHomeAbs', skillsHomeKey: null },
  { id: 'codex', title: 'Codex', home: '~/.codex', skillsHome: '~/.codex/skills', supportsMcp: true, homeKey: 'codexHome', skillsHomeKey: 'codexSkillsHome' },
  { id: 'opencode', title: 'OpenCode', home: '~/.config/opencode', skillsHome: '~/.config/opencode/skills', supportsMcp: true, homeKey: 'opencodeHome', skillsHomeKey: 'opencodeSkillsHome' },
  { id: 'antigravity', title: 'Antigravity', home: '~/.gemini/antigravity', skillsHome: '~/.gemini/antigravity/skills', supportsMcp: false, homeKey: 'antigravityHome', skillsHomeKey: 'antigravitySkillsHome' },
  { id: 'gemini-cli', title: 'Antigravity CLI', home: '~/.gemini', skillsHome: null, supportsMcp: true, homeKey: 'geminiHome', skillsHomeKey: null },
  { id: 'claude-code', title: 'Claude Code', home: '~/.claude', skillsHome: '~/.claude/skills', supportsMcp: false, homeKey: 'claudeHome', skillsHomeKey: 'claudeSkillsHome' },
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
