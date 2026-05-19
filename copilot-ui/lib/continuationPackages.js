'use strict';

const {
  CONTINUATION_PACKAGE_CONTRACT_VERSION,
} = require('@elegy-copilot/contracts');

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = normalizeString(value);
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeTargetHarness(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (normalized === 'codex' || normalized === 'opencode' || normalized === 'antigravity' || normalized === 'copilot') {
    return normalized;
  }
  return 'opencode';
}

function normalizePromptTargetLabel(targetHarness) {
  if (targetHarness === 'codex') return 'Codex';
  if (targetHarness === 'opencode') return 'OpenCode';
  if (targetHarness === 'antigravity') return 'Antigravity';
  return 'Copilot';
}

function pickFirstNonEmpty(...values) {
  for (const value of values) {
    const normalized = normalizeString(value);
    if (normalized) {
      return normalized;
    }
  }
  return '';
}

function limitList(values, limit) {
  return uniqueStrings(values).slice(0, Math.max(0, limit));
}

function sliceTranscriptEntries(entries, limit = 6) {
  const list = Array.isArray(entries) ? entries : [];
  const filtered = list
    .filter((entry) => entry && (entry.role === 'user' || entry.role === 'assistant'))
    .map((entry) => ({
      role: entry.role,
      content: normalizeString(entry.content),
      createdAt: normalizeString(entry.createdAt) || null,
    }))
    .filter((entry) => entry.content);
  return filtered.slice(Math.max(0, filtered.length - Math.max(1, limit)));
}

function buildSessionContinuationPrompt(targetHarness, input = {}) {
  const targetLabel = normalizePromptTargetLabel(targetHarness);
  const repo = input.repo && typeof input.repo === 'object' ? input.repo : null;
  const roadmap = input.roadmap && typeof input.roadmap === 'object' ? input.roadmap : null;
  const objective = normalizeString(input.objective || input.summary || 'Continue the current work safely.');
  const summary = normalizeString(input.summary);
  const constraints = limitList(input.constraints, 8);
  const nextActions = limitList(input.nextActions, 8);
  const carryover = limitList(input.carryover, 8);
  const skillsRequired = limitList(input.skillsRequired, 8);
  const transcriptExcerpt = Array.isArray(input.transcriptExcerpt) ? input.transcriptExcerpt : [];

  const lines = [
    `Continue this discussion in ${targetLabel}.`,
    '',
    `Objective: ${objective || 'Continue the current work safely.'}`,
  ];

  if (summary) {
    lines.push('', 'Summary:', `- ${summary}`);
  }

  if (repo && (repo.repoId || repo.repoPath || repo.branch)) {
    lines.push('', 'Repo Context:');
    if (normalizeString(repo.repoId)) lines.push(`- repoId: ${repo.repoId}`);
    if (normalizeString(repo.repoLabel)) lines.push(`- repoLabel: ${repo.repoLabel}`);
    if (normalizeString(repo.repoPath)) lines.push(`- repoPath: ${repo.repoPath}`);
    if (normalizeString(repo.branch)) lines.push(`- branch: ${repo.branch}`);
  }

  if (roadmap && (roadmap.roadmapId || asArray(roadmap.roadmapIds).length || roadmap.sliceId)) {
    lines.push('', 'Roadmap Context:');
    if (normalizeString(roadmap.roadmapId)) lines.push(`- roadmapId: ${roadmap.roadmapId}`);
    if (asArray(roadmap.roadmapIds).length > 0) lines.push(`- roadmapIds: ${uniqueStrings(roadmap.roadmapIds).join(', ')}`);
    if (normalizeString(roadmap.sliceId)) lines.push(`- sliceId: ${roadmap.sliceId}`);
    if (normalizeString(roadmap.planRef)) lines.push(`- planRef: ${roadmap.planRef}`);
  }

  if (skillsRequired.length > 0) {
    lines.push('', 'Load These Skills:');
    for (const skill of skillsRequired) {
      lines.push(`- ${skill}`);
    }
  }

  if (constraints.length > 0) {
    lines.push('', 'Constraints:');
    for (const item of constraints) {
      lines.push(`- ${item}`);
    }
  }

  if (nextActions.length > 0) {
    lines.push('', 'Next Actions:');
    for (const item of nextActions) {
      lines.push(`- ${item}`);
    }
  }

  if (carryover.length > 0) {
    lines.push('', 'Carryover:');
    for (const item of carryover) {
      lines.push(`- ${item}`);
    }
  }

  if (transcriptExcerpt.length > 0) {
    lines.push('', 'Recent Transcript Excerpt:');
    for (const entry of transcriptExcerpt) {
      const label = entry.role === 'user' ? 'User' : 'Assistant';
      lines.push(`- ${label}: ${entry.content}`);
    }
  }

  lines.push('', 'Continue from this context without restarting discovery unnecessarily.');
  return lines.join('\n');
}

function buildSessionContinuationPackage(input = {}) {
  const targetHarness = normalizeTargetHarness(input.targetHarness);
  const source = input.source && typeof input.source === 'object' ? input.source : {};
  const repo = input.repo && typeof input.repo === 'object' ? input.repo : null;
  const roadmap = input.roadmap && typeof input.roadmap === 'object' ? input.roadmap : null;
  const objective = pickFirstNonEmpty(input.objective, input.summary);
  const summary = pickFirstNonEmpty(input.summary, input.objective);
  const constraints = limitList(input.constraints, 12);
  const openQuestions = limitList(input.openQuestions, 12);
  const nextActions = limitList(input.nextActions, 12);
  const carryover = limitList(input.carryover, 12);
  const skillsRequired = limitList(input.skillsRequired, 12);
  const sourceArtifacts = limitList(input.sourceArtifacts, 12);
  const transcriptExcerpt = sliceTranscriptEntries(input.transcriptExcerpt, 6);
  const promptText = buildSessionContinuationPrompt(targetHarness, {
    objective,
    summary,
    repo,
    roadmap,
    constraints,
    nextActions,
    carryover,
    skillsRequired,
    transcriptExcerpt,
  });

  return {
    contractVersion: CONTINUATION_PACKAGE_CONTRACT_VERSION,
    kind: normalizeString(input.kind) || 'session.continuation-package',
    deterministic: true,
    targetHarness,
    source: {
      kind: normalizeString(source.kind) || 'session',
      sessionId: normalizeString(source.sessionId) || null,
      artifactId: normalizeString(source.artifactId) || null,
      harness: normalizeString(source.harness) || null,
      model: normalizeString(source.model) || null,
      sessionSource: normalizeString(source.sessionSource) || null,
    },
    repo: repo
      ? {
          repoId: normalizeString(repo.repoId) || null,
          repoPath: normalizeString(repo.repoPath) || null,
          repoLabel: normalizeString(repo.repoLabel) || null,
          branch: normalizeString(repo.branch) || null,
        }
      : null,
    roadmap: roadmap
      ? {
          roadmapId: normalizeString(roadmap.roadmapId) || null,
          roadmapIds: uniqueStrings(roadmap.roadmapIds || []),
          sliceId: normalizeString(roadmap.sliceId) || null,
          planRef: normalizeString(roadmap.planRef) || null,
          linkedBacklogIds: uniqueStrings(roadmap.linkedBacklogIds || []),
        }
      : null,
    objective: objective || null,
    summary: summary || null,
    constraints,
    openQuestions,
    nextActions,
    carryover,
    skillsRequired,
    sourceArtifacts,
    transcriptExcerpt,
    prompt: {
      title: `Continue in ${normalizePromptTargetLabel(targetHarness)}`,
      text: promptText,
    },
  };
}

module.exports = {
  buildSessionContinuationPackage,
  normalizeTargetHarness,
};
