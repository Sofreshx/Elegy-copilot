'use strict';

const GLOBAL_HARNESSES = Object.freeze([
  { id: 'copilot', title: 'Copilot', homeKey: 'copilotHomeAbs', skillsHomeKey: null, supportsMcp: false },
  { id: 'codex', title: 'Codex', homeKey: 'codexHome', skillsHomeKey: 'codexSkillsHome', supportsMcp: true },
  { id: 'opencode', title: 'OpenCode', homeKey: 'opencodeHome', skillsHomeKey: 'opencodeSkillsHome', supportsMcp: true },
  { id: 'antigravity', title: 'Antigravity', homeKey: 'antigravityHome', skillsHomeKey: 'antigravitySkillsHome', supportsMcp: false },
  { id: 'gemini-cli', title: 'Antigravity CLI', homeKey: 'geminiHome', skillsHomeKey: null, supportsMcp: true },
  { id: 'host', title: 'Host CLI', homeKey: null, skillsHomeKey: null, supportsMcp: false },
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
