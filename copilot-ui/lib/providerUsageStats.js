'use strict';

const opencodeLogReader = require('./opencodeLogReader');
const fs = require('fs');
const path = require('path');
const os = require('os');

function getCodexSessionCount() {
  const indexPath = path.join(os.homedir(), '.codex', 'session_index.jsonl');
  if (!fs.existsSync(indexPath)) return { count: 0, sessions: [] };
  try {
    const raw = fs.readFileSync(indexPath, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    const sessions = [];
    const seen = new Set();
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.id && !seen.has(entry.id)) {
          seen.add(entry.id);
          sessions.push({
            id: entry.id,
            updatedAt: entry.updated_at || null,
            name: entry.thread_name || null,
          });
        }
      } catch {
        // skip malformed lines
      }
    }
    const sorted = sessions.sort((a, b) => {
      const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return bTime - aTime;
    });
    return { count: sorted.length, sessions: sorted.slice(0, 20) };
  } catch {
    return { count: 0, sessions: [] };
  }
}

function buildProviderUsage() {
  const logData = opencodeLogReader.readRequestLogs({ limit: 500 });
  const requests = logData.requests || [];
  const total = logData.total || 0;

  const providers = {};
  const models = {};
  const agents = {};

  for (const entry of requests) {
    // Provider counts
    const provider = entry.provider || 'unknown';
    if (!providers[provider]) {
      providers[provider] = { count: 0 };
    }
    providers[provider].count += 1;

    // Model counts
    const model = entry.model || 'unknown';
    if (!models[model]) {
      models[model] = { count: 0, provider };
    }
    models[model].count += 1;

    // Agent/lane counts
    const agent = entry.agent || 'unknown';
    if (!agents[agent]) {
      agents[agent] = { count: 0 };
    }
    agents[agent].count += 1;
  }

  // Sort by count descending
  const sortByCount = (a, b) => b.count - a.count;

  const providerList = Object.entries(providers)
    .map(([name, data]) => ({ name, ...data }))
    .sort(sortByCount);

  const modelList = Object.entries(models)
    .map(([name, data]) => ({ name, ...data }))
    .sort(sortByCount);

  const agentList = Object.entries(agents)
    .map(([name, data]) => ({ name, ...data }))
    .sort(sortByCount);

  const codexSessions = getCodexSessionCount();

  return {
    opencode: {
      totalRequests: total,
      sampledRequests: requests.length,
      logFiles: logData.logFiles || 0,
      providers: providerList,
      topModels: modelList.slice(0, 10),
      topAgents: agentList.slice(0, 10),
    },
    codex: {
      sessionCount: codexSessions.count,
      recentSessions: codexSessions.sessions,
    },
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  buildProviderUsage,
  getCodexSessionCount,
};
