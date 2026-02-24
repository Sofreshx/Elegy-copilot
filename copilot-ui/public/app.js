function $(id) {
  return document.getElementById(id);
}

let sessionSource = 'all';
let selectedSession = null;
let trackerEventSource = null;
let trackerPendingCount = 0;

async function api(url, opts) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    ...opts,
  });
  const ct = res.headers.get('content-type') || '';
  if (!res.ok) {
    const msg = ct.includes('application/json') ? JSON.stringify(await res.json()) : await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${msg}`);
  }
  if (ct.includes('application/json')) return res.json();
  return res.text();
}

function setStatus(msg) {
  $('status').textContent = msg;
}

async function viewRel(relPath, label) {
  const txt = await api(`/api/assets/view?path=${encodeURIComponent(relPath)}`).catch((e) => `Error: ${e.message}`);
  $('viewer-meta').textContent = label || relPath;
  $('viewer').textContent = txt;
}

async function deleteRel(relPath, label) {
  const ok = window.confirm(`Delete ${relPath}?\n\nThis is destructive and cannot be undone.`);
  if (!ok) return;

  setStatus(`Deleting ${relPath}…`);
  const r = await api('/api/assets/delete', { method: 'POST', body: JSON.stringify({ path: relPath, force: true }) }).catch((e) => ({
    error: e.message,
  }));
  $('viewer-meta').textContent = label || `Delete ${relPath}`;
  $('viewer').textContent = JSON.stringify(r, null, 2);
  await loadManaged();
  await loadInstalled();
  setStatus(`Delete attempted for ${relPath}.`);
}

function fmtTime(ms) {
  if (!ms) return '';
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return String(ms);
  }
}

function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return ch;
    }
  });
}

function evType(ev) {
  return (ev && (ev.type || ev.event || ev.name || ev.kind)) || '(unknown)';
}

function evTime(ev) {
  const v = ev && (ev.time || ev.timestamp || ev.ts || ev.createdAt || (ev.meta && (ev.meta.time || ev.meta.timestamp || ev.meta.ts)));
  const n = typeof v === 'string' ? Number(v) : v;
  if (Number.isFinite(n)) return n;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.getTime() : null;
}

function switchTab(tab) {
  const sessions = tab === 'sessions';
  const assets = tab === 'assets';
  const lsp = tab === 'lsp';
  const tracker = tab === 'tracker';
  const gateway = tab === 'gateway';
  $('tab-sessions').classList.toggle('active', sessions);
  $('tab-assets').classList.toggle('active', assets);
  $('tab-lsp').classList.toggle('active', lsp);
  $('tab-tracker').classList.toggle('active', tracker);
  $('tab-gateway').classList.toggle('active', gateway);
  $('view-sessions').classList.toggle('hidden', !sessions);
  $('view-assets').classList.toggle('hidden', !assets);
  $('view-lsp').classList.toggle('hidden', !lsp);
  $('view-tracker').classList.toggle('hidden', !tracker);
  $('view-gateway').classList.toggle('hidden', !gateway);
  
  if (lsp) {
    loadLspConfig();
  }
  
  // SSE lifecycle: start when viewing tracker, stop otherwise
  if (tracker) {
    loadTracker();
    startTrackerSSE();
  } else {
    stopTrackerSSE();
  }

  if (gateway) {
    loadGatewayConfig();
  }
}

function mergeSessionsWithTracker(fsSessions, acpSessions) {
  const acpMap = new Map();
  for (const s of acpSessions) {
    const id = s.id || s.sessionId;
    if (id) acpMap.set(id, s);
  }

  const merged = [];
  const seen = new Set();

  for (const fs of fsSessions) {
    seen.add(fs.id);
    const acp = acpMap.get(fs.id);
    if (acp) {
      merged.push({
        ...fs,
        status: acp.status || fs.status,
        authority: 'acp',
        acpData: acp,
      });
    } else {
      merged.push({
        ...fs,
        authority: 'fs',
      });
    }
  }

  for (const [id, acp] of acpMap) {
    if (seen.has(id)) continue;
    merged.push({
      id,
      status: acp.status || 'active',
      source: 'acp',
      authority: 'acp',
      acpData: acp,
      repo: null,
      branch: null,
      cwd: null,
      mode: null,
      startTime: null,
      lastEventTime: null,
    });
  }

  return merged;
}

async function loadSessions() {
  setStatus('Loading sessions…');
  const [fsData, acpData] = await Promise.all([
    api(`/api/sessions?activeWindowMinutes=30&source=${encodeURIComponent(sessionSource)}`),
    api('/api/tracker/sessions').catch(() => []),
  ]);
  const fsSessions = fsData.sessions || [];
  const acpSessions = Array.isArray(acpData) ? acpData : (acpData.sessions || []);
  const sessions = mergeSessionsWithTracker(fsSessions, acpSessions);
  const active = sessions.filter((s) => s.status === 'active');
  const past = sessions.filter((s) => s.status !== 'active');
  $('sessions-summary').textContent = `${active.length} active, ${past.length} past`;

  function renderList(target, list) {
    target.textContent = '';
    for (const s of list) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'item';
      const sourceLabel = sessionSource === 'all' ? `[${String(s.source || 'cli').toUpperCase()}] ` : '';
      const authorityBadge = s.authority === 'acp' ? '[ACP] ' : s.authority === 'fs' ? '[FS] ' : '';
      const prefix = authorityBadge + sourceLabel;
      const title = prefix + (s.repo ? `${s.repo}` : s.cwd || s.id);
      const sub = `${s.id} • ${s.status} • ${fmtTime(s.lastEventTime || s.startTime)}`;
      btn.innerHTML = `<div class="item-title"></div><div class="item-sub muted"></div>`;
      btn.querySelector('.item-title').textContent = title;
      btn.querySelector('.item-sub').textContent = sub;
      btn.addEventListener('click', () => selectSession(s));
      target.appendChild(btn);
    }
    if (!list.length) {
      const d = document.createElement('div');
      d.className = 'muted';
      d.textContent = '(none)';
      target.appendChild(d);
    }
  }

  renderList($('sessions-active'), active);
  renderList($('sessions-past'), past);
  setStatus('Sessions loaded.');
}

async function selectSession(s) {
  selectedSession = s;
  $('btn-archive-session').disabled = false;
  $('btn-delete-session').disabled = false;

  $('session-detail').classList.remove('muted');
  $('session-detail').textContent = '';
  $('session-plans').textContent = '';
  $('session-plan').textContent = '';
  $('session-final').textContent = '';
  $('session-agent-usage').textContent = '';
  $('session-agent-usage').classList.add('muted');
  $('session-progress').textContent = '';
  $('session-progress').classList.add('muted');
  $('session-proposition').textContent = '';
  $('session-proposition').classList.add('muted');
  $('session-verification-guide').textContent = '';
  $('session-verification-guide').classList.add('muted');
  $('session-events').textContent = '';
  $('session-detail').innerHTML = `
    <div><b>ID:</b> ${escapeHtml(s.id)}</div>
    <div><b>Source:</b> ${escapeHtml(s.source || sessionSource)}</div>
    <div><b>Authority:</b> ${s.authority === 'acp' ? 'ACP (live)' : 'Filesystem'}</div>
    <div><b>Status:</b> ${escapeHtml(s.status)}</div>
    <div><b>Repo:</b> ${escapeHtml(s.repo || '')}</div>
    <div><b>Branch:</b> ${escapeHtml(s.branch || '')}</div>
    <div><b>CWD:</b> ${escapeHtml(s.cwd || '')}</div>
    <div><b>Mode:</b> ${escapeHtml(s.mode || '')}</div>
    <div><b>Last event:</b> ${fmtTime(s.lastEventTime)}</div>
  `;

  setStatus(`Loading plan/events for ${s.id}…`);
  const source = encodeURIComponent(String(s.source || sessionSource || 'cli'));
  const [plansIndex, finalOut, agentUsage, evs, structuredState, proposition, verificationGuide] = await Promise.all([
    api(`/api/sessions/${encodeURIComponent(s.id)}/plans?source=${source}`).catch(() => ({ plans: [] })),
    api(`/api/sessions/${encodeURIComponent(s.id)}/final?source=${source}`).catch(() => ''),
    api(`/api/sessions/${encodeURIComponent(s.id)}/agent-usage?limit=500&source=${source}`).catch(() => ({ usage: {} })),
    api(`/api/sessions/${encodeURIComponent(s.id)}/events?limit=20&source=${source}`).catch(() => ({ events: [] })),
    api(`/api/sessions/${encodeURIComponent(s.id)}/structured-state?source=${source}`).catch(() => null),
    api(`/api/sessions/${encodeURIComponent(s.id)}/proposition?source=${source}`).catch((e) => {
      const msg = String((e && e.message) || '');
      if (msg.startsWith('404')) return null;
      return { error: msg };
    }),
    api(`/api/sessions/${encodeURIComponent(s.id)}/verification-guide?source=${source}`).catch((e) => {
      const msg = String((e && e.message) || '');
      if (msg.startsWith('404')) return null;
      return { error: msg };
    }),
  ]);

  const plans = (plansIndex && plansIndex.plans) || [];
  function planLabel(p) {
    const status = p && p.status ? String(p.status) : '';
    const verdict = p && p.verdict ? String(p.verdict) : '';
    const parts = [p.id];
    if (status) parts.push(status);
    if (verdict && verdict !== status) parts.push(verdict);
    return parts.join(' • ');
  }

  async function loadPlan(planId) {
    const txt = await api(`/api/sessions/${encodeURIComponent(s.id)}/plans/${encodeURIComponent(planId)}?source=${source}`).catch(() => '');
    $('session-plan').textContent = String(txt || '');
  }

  $('session-plans').textContent = '';
  for (const p of plans) {
    if (!p || !p.id) continue;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'item';
    btn.innerHTML = `<div class="item-title"></div><div class="item-sub muted"></div>`;
    btn.querySelector('.item-title').textContent = planLabel(p);
    const meta = [p.kind, p.source, p.bytes ? `${p.bytes} bytes` : null].filter(Boolean).join(' • ');
    btn.querySelector('.item-sub').textContent = meta;
    btn.addEventListener('click', () => loadPlan(p.id));
    $('session-plans').appendChild(btn);
  }
  if (!plans.length) {
    const d = document.createElement('div');
    d.className = 'muted';
    d.textContent = '(no plan artifacts found)';
    $('session-plans').appendChild(d);
  } else {
    // Auto-load the best default: latest > first.
    const preferred = plans.find((p) => p.id === 'latest') || plans[0];
    if (preferred && preferred.id) await loadPlan(preferred.id);
  }

  $('session-final').textContent = String(finalOut || '').slice(0, 8000);

  // Render progress (WU-008)
  if (structuredState && structuredState.groups) {
    $('session-progress').classList.remove('muted');
    let progressHtml = '';
    
    // Groups overview
     if (Array.isArray(structuredState.groups) && structuredState.groups.length > 0) {
       progressHtml += '<div class="progress-section"><b>Work Unit Groups:</b></div>';
       for (const g of structuredState.groups) {
         const status = g.status || 'unknown';
         const done = g.wusDone || 0;
         const total = g.wusTotal || 0;
         const statusClass = status === 'done' ? 'status-done' : status === 'in-progress' ? 'status-in-progress' : 'status-pending';
         progressHtml += `<div class="progress-item"><span class="badge ${statusClass}">${escapeHtml(status)}</span> ${escapeHtml(g.group || '?')}: ${escapeHtml(g.title || '(untitled)')} (${escapeHtml(done)}/${escapeHtml(total)})</div>`;
       }
     }
     
     // Next unit
     if (structuredState.nextUnit && typeof structuredState.nextUnit === 'object' && structuredState.nextUnit.workUnitId) {
       const nu = structuredState.nextUnit;
       const rationale = nu.rationale ? ` — ${escapeHtml(nu.rationale)}` : '';
       progressHtml += `<div class="progress-section"><b>Next Unit:</b> ${escapeHtml(nu.workUnitId)}${rationale}</div>`;
     }
     
     // Checkpoints
     if (Array.isArray(structuredState.checkpoints) && structuredState.checkpoints.length > 0) {
       progressHtml += '<div class="progress-section"><b>Checkpoints:</b></div>';
       for (const cp of structuredState.checkpoints) {
         const cpStatus = String(cp.status || 'pending').toLowerCase();
         const statusClass = cpStatus === 'passed' ? 'status-done' : cpStatus === 'failed' ? 'status-failed' : cpStatus === 'skipped' ? 'status-skipped' : 'status-pending';
         progressHtml += `<div class="progress-item"><span class="badge ${statusClass}">${escapeHtml(cpStatus)}</span> ${escapeHtml(cp.checkpoint || '?')} (${escapeHtml(cp.trigger || 'manual')})</div>`;
       }
     }
    
    $('session-progress').innerHTML = progressHtml || '(no progress data)';
  } else {
    $('session-progress').textContent = '(no progress data)';
  }

  // Render proposition (WU-009)
  if (proposition && proposition.error) {
    $('session-proposition').textContent = `Error: ${proposition.error}`;
  } else if (proposition && proposition.content) {
    $('session-proposition').classList.remove('muted');
    $('session-proposition').innerHTML = '<pre class="proposition-content"></pre>';
    $('session-proposition').querySelector('.proposition-content').textContent = String(proposition.content).slice(0, 8000);
  } else {
    $('session-proposition').textContent = '(none)';
  }

  // Render verification guide
  if (verificationGuide && verificationGuide.error) {
    $('session-verification-guide').textContent = `Error: ${verificationGuide.error}`;
  } else if (verificationGuide && verificationGuide.content) {
    $('session-verification-guide').classList.remove('muted');
    $('session-verification-guide').innerHTML = '<pre class="proposition-content"></pre>';
    $('session-verification-guide').querySelector('.proposition-content').textContent = String(verificationGuide.content).slice(0, 8000);
  } else {
    $('session-verification-guide').textContent = '(none)';
  }

  const usage = (agentUsage && agentUsage.usage) || {};
  const entries = Object.entries(usage).filter(([, v]) => typeof v === 'number' && v > 0);
  entries.sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
  if (!entries.length) {
    $('session-agent-usage').textContent = '(none detected)';
  } else {
    $('session-agent-usage').classList.remove('muted');
    $('session-agent-usage').textContent = entries.map(([k, v]) => `${k}: ${v}`).join('\n').slice(0, 4000);
  }

  const events = (evs && evs.events) || [];
  events.sort((a, b) => (evTime(b) || 0) - (evTime(a) || 0));
  for (const ev of events) {
    const row = document.createElement('div');
    row.className = 'event';
    const when = fmtTime(evTime(ev));
    row.innerHTML = `<div class="event-top"><span class="badge"></span><span class="muted"></span></div><pre class="event-body"></pre>`;
    row.querySelector('.badge').textContent = evType(ev);
    row.querySelector('.event-top .muted').textContent = when;
    row.querySelector('.event-body').textContent = JSON.stringify(ev, null, 2).slice(0, 4000);
    $('session-events').appendChild(row);
  }
  if (!events.length) $('session-events').textContent = '(no events found)';
  setStatus(`Loaded ${s.id}.`);
}

async function loadTrackerPermissions() {
  try {
    const data = await api('/api/tracker/permissions');
    const perms = data.permissions || [];
    trackerPendingCount = perms.length;
    updateTrackerBadge();
    const container = $('tracker-permissions');
    container.textContent = '';
    if (!perms.length) {
      const d = document.createElement('div');
      d.className = 'muted';
      d.textContent = '(no pending permissions)';
      container.appendChild(d);
      return;
    }
    for (const p of perms) {
      const row = document.createElement('div');
      row.className = 'item';
      const callbackId = escapeHtml(p.callbackId || p.id || '');
      const summary = escapeHtml(p.summary || p.description || p.title || '(no summary)');
      const sessionId = escapeHtml(p.sessionId || '');
      const sandboxId = p.sandboxId ? escapeHtml(p.sandboxId) : '';
      
      row.innerHTML = `
        <div class="item-title">${summary}</div>
        <div class="item-sub muted">ID: ${callbackId}${sessionId ? ' \u2022 Session: ' + sessionId : ''}${sandboxId ? ' \u2022 Sandbox: ' + sandboxId : ''}</div>
        <div class="actions" style="margin-top: 4px;">
          <button class="btn small approve-btn" type="button" data-id="${callbackId}">Approve</button>
          <button class="btn small danger deny-btn" type="button" data-id="${callbackId}">Deny</button>
        </div>
      `;
      
      row.querySelector('.approve-btn').addEventListener('click', async (e) => {
        const id = e.target.dataset.id;
        setStatus('Approving\u2026');
        try {
          await api('/api/tracker/permissions/' + encodeURIComponent(id) + '/approve', { method: 'POST', body: '{}' });
          setStatus('Approved.');
          await loadTrackerPermissions();
        } catch (err) {
          setStatus('Approve failed: ' + err.message);
        }
      });
      
      row.querySelector('.deny-btn').addEventListener('click', async (e) => {
        const id = e.target.dataset.id;
        setStatus('Denying\u2026');
        try {
          await api('/api/tracker/permissions/' + encodeURIComponent(id) + '/deny', { method: 'POST', body: '{}' });
          setStatus('Denied.');
          await loadTrackerPermissions();
        } catch (err) {
          setStatus('Deny failed: ' + err.message);
        }
      });
      
      container.appendChild(row);
    }
  } catch (e) {
    $('tracker-permissions').textContent = 'Error: ' + e.message;
    trackerPendingCount = 0;
    updateTrackerBadge();
  }
}

async function loadTrackerSessions() {
  try {
    const data = await api('/api/tracker/sessions');
    const sessions = Array.isArray(data) ? data : (data.sessions || []);
    const container = $('tracker-sessions');
    container.textContent = '';
    if (!sessions.length) {
      const d = document.createElement('div');
      d.className = 'muted';
      d.textContent = '(no live sessions)';
      container.appendChild(d);
      return;
    }
    for (const s of sessions) {
      const row = document.createElement('div');
      row.className = 'item';
      const title = escapeHtml(s.id || s.sessionId || '(unknown)');
      const status = escapeHtml(s.status || '');
      row.innerHTML = `<div class="item-title">${title}</div><div class="item-sub muted">Status: ${status}</div>`;
      container.appendChild(row);
    }
  } catch (e) {
    $('tracker-sessions').textContent = 'Error: ' + e.message;
  }
}

async function loadTracker() {
  setStatus('Loading tracker data\u2026');
  await Promise.all([loadTrackerPermissions(), loadTrackerSessions()]);
  setStatus('Tracker loaded.');
}

function updateTrackerBadge() {
  const badge = $('tracker-badge');
  if (!badge) return;
  if (trackerPendingCount > 0) {
    badge.textContent = String(trackerPendingCount);
    badge.style.display = '';
  } else {
    badge.style.display = 'none';
  }
}

function startTrackerSSE() {
  if (trackerEventSource) return; // already running
  
  const statusEl = $('tracker-status');
  const eventsEl = $('tracker-events');
  
  try {
    trackerEventSource = new EventSource('/api/tracker/events');
  } catch (e) {
    if (statusEl) statusEl.textContent = 'SSE error: ' + e.message;
    return;
  }
  
  trackerEventSource.addEventListener('connected', () => {
    if (statusEl) statusEl.textContent = 'Connected (live)';
    if (statusEl) statusEl.classList.remove('muted');
  });
  
  trackerEventSource.addEventListener('live', (e) => {
    // Real-time event — refresh permissions and add to event log
    loadTrackerPermissions().catch(() => {});
    
    if (eventsEl) {
      const row = document.createElement('div');
      row.className = 'event';
      let parsed;
      try { parsed = JSON.parse(e.data); } catch { parsed = { raw: e.data }; }
      const type = (parsed && parsed.type) || 'live';
      const now = new Date().toLocaleTimeString();
      row.innerHTML = '<div class="event-top"><span class="badge"></span><span class="muted"></span></div><pre class="event-body"></pre>';
      row.querySelector('.badge').textContent = type;
      row.querySelector('.event-top .muted').textContent = now;
      row.querySelector('.event-body').textContent = JSON.stringify(parsed, null, 2).slice(0, 2000);
      eventsEl.prepend(row);
      // Keep max 50 events visible
      while (eventsEl.children.length > 50) {
        eventsEl.removeChild(eventsEl.lastChild);
      }
    }
  });
  
  trackerEventSource.onerror = () => {
    if (statusEl) statusEl.textContent = 'Disconnected (reconnecting\u2026)';
    if (statusEl) statusEl.classList.add('muted');
  };
}

function stopTrackerSSE() {
  if (trackerEventSource) {
    trackerEventSource.close();
    trackerEventSource = null;
  }
  const statusEl = $('tracker-status');
  if (statusEl) statusEl.textContent = 'Disconnected';
  if (statusEl) statusEl.classList.add('muted');
}

async function loadManaged() {
  setStatus('Loading managed assets…');
  const data = await api('/api/assets/managed');
  const managed = data.managed || [];
  $('assets-summary').textContent = `${managed.length} managed`;

  const body = $('managed-table');
  body.textContent = '';
  for (const a of managed) {
    const tr = document.createElement('tr');
    const installed = a.installed ? 'yes' : 'no';
    const uptodate = a.upToDate ? 'yes' : 'no';
    tr.innerHTML = `
      <td class="mono"></td>
      <td></td>
      <td>${installed}</td>
      <td>${uptodate}</td>
      <td class="actions"></td>
    `;
    tr.children[0].textContent = a.id;
    tr.children[1].textContent = a.type;

    const actions = tr.querySelector('.actions');
    const btnView = document.createElement('button');
    btnView.type = 'button';
    btnView.className = 'btn small';
    btnView.textContent = 'View';
    btnView.addEventListener('click', async () => {
      const viewPath = a.type === 'skill' && !String(a.destination || '').toLowerCase().endsWith('/skill.md')
        ? `${String(a.destination || '').replace(/\\/g, '/').replace(/\/+$/, '')}/SKILL.md`
        : a.destination;
      const txt = await api(`/api/assets/view?path=${encodeURIComponent(viewPath)}`).catch((e) => `Error: ${e.message}`);
      $('viewer-meta').textContent = viewPath;
      $('viewer').textContent = txt;    
    });

    const btnSync = document.createElement('button');
    btnSync.type = 'button';
    btnSync.className = 'btn small';
    btnSync.textContent = 'Sync';
    btnSync.addEventListener('click', async () => {
      setStatus(`Syncing ${a.id}…`);
      await api('/api/assets/sync', { method: 'POST', body: JSON.stringify({ assetId: a.id }) });
      await loadManaged();
      await loadInstalled();
      setStatus(`Synced ${a.id}.`);
    });

    const btnRemove = document.createElement('button');
    btnRemove.type = 'button';
    btnRemove.className = 'btn small danger';
    btnRemove.textContent = 'Remove';
    btnRemove.addEventListener('click', async () => {
      setStatus(`Removing ${a.id}…`);
      const r = await api('/api/assets/remove', { method: 'POST', body: JSON.stringify({ assetId: a.id }) }).catch((e) => ({ error: e.message }));
      $('viewer-meta').textContent = `Remove ${a.id}`;
      $('viewer').textContent = JSON.stringify(r, null, 2);
      await loadManaged();
      await loadInstalled();
      setStatus(`Remove attempted for ${a.id}.`);
    });

    actions.appendChild(btnView);
    actions.appendChild(btnSync);
    actions.appendChild(btnRemove);
    body.appendChild(tr);
  }
  setStatus('Managed assets loaded.');
}

async function loadInstalled() {
  setStatus('Loading installed agents/skills…');
  const data = await api('/api/assets/installed');
  const agents = data.agents || [];
  const skills = data.skills || [];
  const prompts = data.prompts || [];
  const instructions = data.instructions || null;

  const at = $('agents-table');
  at.textContent = '';
  for (const a of agents) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td></td><td class="mono"></td><td class="actions"></td>`;
    tr.children[0].textContent = a.name;
    tr.children[1].textContent = a.fileName;

    const rel = `agents/${a.fileName}`;
    const actions = tr.querySelector('.actions');
    const btnView = document.createElement('button');
    btnView.type = 'button';
    btnView.className = 'btn small';
    btnView.textContent = 'View';
    btnView.addEventListener('click', () => viewRel(rel, rel));

    const btnDelete = document.createElement('button');
    btnDelete.type = 'button';
    btnDelete.className = 'btn small danger';
    btnDelete.textContent = 'Delete';
    btnDelete.addEventListener('click', () => deleteRel(rel, rel));

    actions.appendChild(btnView);
    actions.appendChild(btnDelete);
    at.appendChild(tr);
  }

  const st = $('skills-table');
  st.textContent = '';
  for (const s of skills) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td></td><td class="mono"></td><td class="actions"></td>`;
    tr.children[0].textContent = s.name;
    tr.children[1].textContent = s.absPath;

    const relFile = `skills/${s.name}/SKILL.md`;
    const relDir = `skills/${s.name}`;
    const actions = tr.querySelector('.actions');
    const btnView = document.createElement('button');
    btnView.type = 'button';
    btnView.className = 'btn small';
    btnView.textContent = 'View';
    btnView.addEventListener('click', () => viewRel(relFile, relFile));

    const btnDelete = document.createElement('button');
    btnDelete.type = 'button';
    btnDelete.className = 'btn small danger';
    btnDelete.textContent = 'Delete';
    btnDelete.addEventListener('click', () => deleteRel(relDir, relDir));

    actions.appendChild(btnView);
    actions.appendChild(btnDelete);
    st.appendChild(tr);
  }

  setStatus('Installed inventory loaded.');

  const pt = $('prompts-table');
  const ip = $('instructions-panel');

  if (pt) {
    pt.textContent = '';
    for (const p of prompts) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td></td><td class="mono"></td><td class="actions"></td>`;
      tr.children[0].textContent = p.name;
      tr.children[1].textContent = p.fileName;

      const rel = `prompts/${p.fileName}`;
      const actions = tr.querySelector('.actions');
      const btnView = document.createElement('button');
      btnView.type = 'button';
      btnView.className = 'btn small';
      btnView.textContent = 'View';
      btnView.addEventListener('click', () => viewRel(rel, rel));
      actions.appendChild(btnView);
      pt.appendChild(tr);
    }
    if (!prompts.length) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td class="muted" colspan="3">(none)</td>';
      pt.appendChild(tr);
    }
  }

  if (ip) {
    ip.classList.remove('muted');
    const installed = instructions && instructions.installed === true;
    const rel = 'copilot-instructions.md';
    ip.innerHTML = '';

    const line = document.createElement('div');
    line.className = installed ? '' : 'muted';
    line.textContent = installed ? `Installed: ${rel}` : 'Not installed.';

    const actions = document.createElement('div');
    actions.className = 'actions';
    const btnView = document.createElement('button');
    btnView.type = 'button';
    btnView.className = 'btn small';
    btnView.textContent = 'View';
    btnView.disabled = !installed;
    btnView.addEventListener('click', () => viewRel(rel, rel));

    actions.appendChild(btnView);
    ip.appendChild(line);
    ip.appendChild(actions);
  }
}

async function syncAll() {
  setStatus('Syncing all assets…');
  const r = await api('/api/assets/sync-all', { method: 'POST', body: JSON.stringify({ dryRun: false, force: false }) });
  $('viewer-meta').textContent = 'Sync all';
  $('viewer').textContent = JSON.stringify(r, null, 2);
  await loadManaged();
  await loadInstalled();
  setStatus('Sync all complete.');
}

async function freshAll() {
  const ok = window.confirm('Force-overwrite ALL managed assets into ~/.copilot?\n\nThis replaces any local modifications.');
  if (!ok) return;
  setStatus('Force-syncing all assets…');
  const r = await api('/api/assets/sync-all', { method: 'POST', body: JSON.stringify({ dryRun: false, force: true }) });
  $('viewer-meta').textContent = 'Fresh all (force)';
  $('viewer').textContent = JSON.stringify(r, null, 2);
  await loadManaged();
  await loadInstalled();
  setStatus('Fresh all complete.');
}

async function patchVscodeSettings() {
  const ok = window.confirm(
    'Patch VS Code user settings to use ~/.copilot (chat.*Locations) and install safe terminal auto-approvals (chat.tools.terminal.autoApprove)?\n\nThis edits settings.json and creates a backup.'
  );
  if (!ok) return;
  setStatus('Patching VS Code settings…');
  const r = await api('/api/vscode/patch-settings', { method: 'POST', body: JSON.stringify({ dryRun: false }) }).catch((e) => ({ error: e.message }));
  $('viewer-meta').textContent = 'Patch VS Code settings';
  $('viewer').textContent = JSON.stringify(r, null, 2);
  setStatus('VS Code settings patch attempted.');
}

async function authorizeCopilotFolders() {
  const ok = window.confirm(
    'Authorize Copilot tool access for:\n\n- ~/.copilot (and common subfolders)\n\nThis updates ~/.copilot/permissions-config.json (read/write/memory) and creates a backup if needed.'
  );
  if (!ok) return;
  setStatus('Authorizing Copilot folders…');
  const r = await api('/api/copilot/authorize', { method: 'POST', body: JSON.stringify({ dryRun: false }) }).catch((e) => ({ error: e.message }));
  $('viewer-meta').textContent = 'Authorize Copilot folders';
  $('viewer').textContent = JSON.stringify(r, null, 2);
  setStatus('Authorization setup attempted.');
}

async function loadLspConfig() {
  setStatus('Loading LSP config…');
  try {
    const data = await api('/api/lsp/config');
    $('lsp-config-viewer').textContent = JSON.stringify(data.config, null, 2);
    $('lsp-config-meta').textContent = 'Loaded successfully.';
    setStatus('LSP config loaded.');
  } catch (e) {
    $('lsp-config-viewer').textContent = String(e);
    $('lsp-config-meta').textContent = 'Error loading config.';
    setStatus('Error loading LSP config.');
  }
}

async function installLsp() {
  const ok = window.confirm('This will run the installation script for C#, Rust, and TypeScript language servers. Continue?');
  if (!ok) return;
  
  setStatus('Installing LSPs (this may take a minute)…');
  $('lsp-install-logs').textContent = 'Installing...';
  $('lsp-install-logs').classList.remove('muted');
  
  try {
    const res = await api('/api/lsp/install', { method: 'POST', body: JSON.stringify({}) });
    let logs = '';
    if (res.stdout) logs += res.stdout + '\n';
    if (res.stderr) logs += res.stderr + '\n';
    if (res.error) logs += 'ERROR: ' + res.error + '\n';
    
    $('lsp-install-logs').textContent = logs || 'Done.';
    setStatus('LSP installation finished.');
    await loadLspConfig();
  } catch (e) {
    $('lsp-install-logs').textContent = String(e);
    setStatus('Error installing LSPs.');
  }
}

// --- Gateway config ---
let gatewayAllowedRoots = new Set();
let gatewayActiveRoot = '';
let gatewayScanResults = null;

async function loadGatewayConfig() {
  setStatus('Loading gateway config\u2026');
  try {
    const data = await api('/api/gateway/config');
    $('gateway-config-path').textContent = data.configPath || '';
    const badge = $('gateway-config-badge');
    if (data.exists) {
      badge.textContent = 'exists';
      badge.className = 'badge badge-exists';
    } else {
      badge.textContent = 'not found';
      badge.className = 'badge badge-missing';
    }
    const cfg = data.config || {};
    const acp = cfg.acp || {};
    const discord = cfg.discord || {};
    const ws = cfg.workspaces || {};
    $('gateway-mode').value = cfg.mode || 'auto';
    $('gateway-acp-host').value = acp.host || '127.0.0.1';
    $('gateway-acp-port').value = String(acp.port || 3000);
    $('gateway-discord-guild').value = discord.guildId || '';
    $('gateway-discord-channel').value = discord.channelId || '';
    $('gateway-discord-users').value = (discord.allowlistedUserIds || []).join(', ');
    $('gateway-discord-perms-channel').value = discord.permissionsChannelId || '';
    // Restore checked roots from saved config
    gatewayAllowedRoots = new Set(ws.allowedRoots || []);
    gatewayActiveRoot = ws.activeRoot || '';
    if (gatewayAllowedRoots.size > 0) renderGatewayRepoList(null);
    setStatus('Gateway config loaded.');
  } catch (e) {
    setStatus('Error loading gateway config: ' + e.message);
  }
}

function renderGatewayRepoList(scanData) {
  if (scanData !== null) gatewayScanResults = scanData;
  const container = $('gateway-repo-list');
  container.textContent = '';
  const displayedPaths = new Set();

  if (gatewayScanResults && gatewayScanResults.roots && gatewayScanResults.roots.length) {
    for (const root of gatewayScanResults.roots) {
      const heading = document.createElement('div');
      heading.className = 'gateway-scan-root muted';
      heading.textContent = root.scanRoot;
      container.appendChild(heading);
      for (const repo of root.repos) {
        displayedPaths.add(repo.absPath);
        appendRepoCheckbox(container, repo.absPath, repo.name, gatewayAllowedRoots.has(repo.absPath));
      }
    }
  }

  const orphans = [...gatewayAllowedRoots].filter((p) => !displayedPaths.has(p));
  if (orphans.length) {
    const heading = document.createElement('div');
    heading.className = 'gateway-scan-root muted';
    heading.textContent = '\u2014 Previously saved (not in scan) \u2014';
    container.appendChild(heading);
    for (const p of orphans) appendRepoCheckbox(container, p, p, true);
  }

  if (!container.children.length) {
    const d = document.createElement('div');
    d.className = 'muted';
    d.textContent = '(no repos found \u2014 click Scan repos above)';
    container.appendChild(d);
  }
  refreshActiveRootSelect();
}

function appendRepoCheckbox(container, absPath, label, checked) {
  const row = document.createElement('label');
  row.className = 'repo-row';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.value = absPath;
  cb.checked = checked;
  cb.addEventListener('change', () => {
    if (cb.checked) {
      gatewayAllowedRoots.add(absPath);
    } else {
      gatewayAllowedRoots.delete(absPath);
      if (gatewayActiveRoot === absPath) gatewayActiveRoot = '';
    }
    refreshActiveRootSelect();
  });
  const span = document.createElement('span');
  span.textContent = label;
  row.appendChild(cb);
  row.appendChild(span);
  container.appendChild(row);
}

function refreshActiveRootSelect() {
  const sel = $('gateway-active-root');
  const prev = sel.value || gatewayActiveRoot;
  sel.textContent = '';
  const roots = [...gatewayAllowedRoots];
  if (!roots.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '(check repos above first)';
    sel.appendChild(opt);
    gatewayActiveRoot = '';
    return;
  }
  for (const r of roots) {
    const opt = document.createElement('option');
    opt.value = r;
    opt.textContent = r;
    sel.appendChild(opt);
  }
  if (roots.includes(prev)) {
    sel.value = prev;
    gatewayActiveRoot = prev;
  } else {
    sel.value = roots[0];
    gatewayActiveRoot = roots[0];
  }
}

async function scanGatewayRepos(extraPath) {
  setStatus('Scanning repos\u2026');
  try {
    const url = extraPath ? `/api/gateway/scan-repos?extra=${encodeURIComponent(extraPath)}` : '/api/gateway/scan-repos';
    const data = await api(url);
    const total = (data.roots || []).reduce((acc, r) => acc + (r.repos || []).length, 0);
    renderGatewayRepoList(data);
    setStatus(`Found ${total} repo(s) across ${(data.roots || []).length} scan root(s).`);
  } catch (e) {
    setStatus('Scan error: ' + e.message);
  }
}

async function saveGatewayConfig() {
  const mode = $('gateway-mode').value || 'auto';
  const acpHost = $('gateway-acp-host').value.trim() || '127.0.0.1';
  const acpPort = parseInt($('gateway-acp-port').value, 10) || 3000;
  const guildId = $('gateway-discord-guild').value.trim();
  const channelId = $('gateway-discord-channel').value.trim();
  const usersRaw = $('gateway-discord-users').value.trim();
  const permsChannel = $('gateway-discord-perms-channel').value.trim();
  const activeRoot = $('gateway-active-root').value || gatewayActiveRoot;
  const allowlistedUserIds = usersRaw ? usersRaw.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const allowedRoots = [...gatewayAllowedRoots];
  const statusEl = $('gateway-status');

  if (!guildId || !channelId) {
    statusEl.textContent = 'Validation error: Discord Guild ID and Channel ID are required.';
    statusEl.className = 'pre';
    return;
  }
  if (!allowlistedUserIds.length) {
    statusEl.textContent = 'Validation error: At least one Discord User ID is required.';
    statusEl.className = 'pre';
    return;
  }
  if (!allowedRoots.length) {
    statusEl.textContent = 'Validation error: Select at least one workspace root.';
    statusEl.className = 'pre';
    return;
  }
  if (!activeRoot) {
    statusEl.textContent = 'Validation error: Select an active workspace root.';
    statusEl.className = 'pre';
    return;
  }

  const body = {
    mode,
    acp: { host: acpHost, port: acpPort },
    discord: {
      allowlistedUserIds,
      guildId,
      channelId,
      ...(permsChannel ? { permissionsChannelId: permsChannel } : {}),
    },
    workspaces: { allowedRoots, activeRoot },
  };

  setStatus('Saving gateway config\u2026');
  try {
    const r = await api('/api/gateway/config', { method: 'POST', body: JSON.stringify(body) });
    statusEl.textContent = `Saved \u2192 ${r.configPath}`;
    statusEl.className = 'pre status-saved';
    await loadGatewayConfig();
    setStatus('Gateway config saved.');
  } catch (e) {
    statusEl.textContent = 'Save error: ' + e.message;
    statusEl.className = 'pre';
    setStatus('Failed to save gateway config.');
  }
}

function bindUi() {
  $('tab-sessions').addEventListener('click', () => switchTab('sessions'));
  $('tab-assets').addEventListener('click', () => switchTab('assets'));
  $('tab-lsp').addEventListener('click', () => switchTab('lsp'));
  $('btn-reload').addEventListener('click', () => window.location.reload());

  $('btn-refresh-sessions').addEventListener('click', () => loadSessions().catch((e) => setStatus(e.message)));

  function setSessionsSource(next) {
    sessionSource = next;
    $('tab-sessions-all').classList.toggle('active', next === 'all');
    selectedSession = null;
    $('btn-archive-session').disabled = true;
    $('btn-delete-session').disabled = true;
    $('session-detail').textContent = 'Select a session.';
    $('session-detail').classList.add('muted');
    $('session-plans').textContent = '';
    $('session-plan').textContent = '';
    $('session-final').textContent = '';
    $('session-agent-usage').textContent = '';
    $('session-progress').textContent = '';
    $('session-progress').classList.add('muted');
    $('session-proposition').textContent = '';
    $('session-proposition').classList.add('muted');
    $('session-events').textContent = '';
    loadSessions().catch((e) => setStatus(e.message));
  }

  $('tab-sessions-all').addEventListener('click', () => setSessionsSource('all'));

  $('btn-archive-session').addEventListener('click', async () => {
    if (!selectedSession || !selectedSession.id) return;
    const id = encodeURIComponent(selectedSession.id);
    const src = encodeURIComponent(String(selectedSession.source || sessionSource || 'cli'));
    const ok = window.confirm(`Archive session ${selectedSession.id} (${src})?`);
    if (!ok) return;
    setStatus(`Archiving ${selectedSession.id}…`);
    await api(`/api/sessions/${id}/archive?source=${src}`, { method: 'POST', body: JSON.stringify({}) });
    selectedSession = null;
    $('btn-archive-session').disabled = true;
    $('btn-delete-session').disabled = true;
    await loadSessions();
    setStatus('Session archived.');
  });

  $('btn-delete-session').addEventListener('click', async () => {
    if (!selectedSession || !selectedSession.id) return;
    const id = encodeURIComponent(selectedSession.id);
    const src = encodeURIComponent(String(selectedSession.source || sessionSource || 'cli'));
    const ok = window.confirm(
      `Delete session ${selectedSession.id} (${src}) permanently?\n\nThis cannot be undone.`
    );
    if (!ok) return;
    setStatus(`Deleting ${selectedSession.id}…`);
    await api(`/api/sessions/${id}/delete?source=${src}`, { method: 'POST', body: JSON.stringify({ force: true }) });
    selectedSession = null;
    $('btn-archive-session').disabled = true;
    $('btn-delete-session').disabled = true;
    await loadSessions();
    setStatus('Session deleted.');
  });

  $('btn-refresh-managed').addEventListener('click', () => loadManaged().catch((e) => setStatus(e.message)));
  $('btn-refresh-installed').addEventListener('click', () => loadInstalled().catch((e) => setStatus(e.message)));
  $('btn-refresh-all').addEventListener('click', async () => {
    try {
      await Promise.all([loadManaged(), loadInstalled(), loadSessions()]);
    } catch (e) {
      setStatus(e.message);
    }
  });
  $('btn-sync-all').addEventListener('click', () => syncAll().catch((e) => setStatus(e.message)));
  $('btn-fresh-all').addEventListener('click', () => freshAll().catch((e) => setStatus(e.message)));
  $('btn-patch-vscode-settings').addEventListener('click', () => patchVscodeSettings().catch((e) => setStatus(e.message)));
  $('btn-copilot-authorize').addEventListener('click', () => authorizeCopilotFolders().catch((e) => setStatus(e.message)));

  $('btn-refresh-lsp').addEventListener('click', () => loadLspConfig().catch((e) => setStatus(e.message)));
  $('btn-install-lsp').addEventListener('click', () => installLsp().catch((e) => setStatus(e.message)));

  $('tab-tracker').addEventListener('click', () => switchTab('tracker'));
  $('btn-refresh-tracker').addEventListener('click', () => loadTracker().catch((e) => setStatus(e.message)));

  $('tab-gateway').addEventListener('click', () => switchTab('gateway'));
  $('btn-gateway-scan').addEventListener('click', () => scanGatewayRepos(null).catch((e) => setStatus(e.message)));
  $('btn-gateway-scan-custom').addEventListener('click', () => {
    const extra = $('gateway-custom-path').value.trim();
    scanGatewayRepos(extra || null).catch((e) => setStatus(e.message));
  });
  $('gateway-active-root').addEventListener('change', () => {
    gatewayActiveRoot = $('gateway-active-root').value;
  });
  $('btn-gateway-save').addEventListener('click', () => saveGatewayConfig().catch((e) => {
    $('gateway-status').textContent = 'Error: ' + e.message;
    $('gateway-status').className = 'pre';
    setStatus('Failed to save gateway config.');
  }));
}

async function boot() {
  bindUi();
  try {
    await api('/api/health');
  } catch {
    setStatus('Server not healthy.');
  }
  await loadSessions().catch((e) => setStatus(e.message));
  await loadManaged().catch((e) => setStatus(e.message));
  await loadInstalled().catch((e) => setStatus(e.message));

  // Tracker: 3s permission poll fallback when SSE not connected
  setInterval(async () => {
    try {
      if (trackerEventSource && trackerEventSource.readyState === EventSource.OPEN) return; // SSE is delivering, no need to poll
      await loadTrackerPermissions();
    } catch {
      // ignore polling failures
    }
  }, 3000);

  // Best-effort "watch": poll a version counter the server bumps on fs.watch events.
  let lastVersion = null;
  setInterval(async () => {
    try {
      const v = await api('/api/version');
      if (typeof v.version !== 'number') return;
      if (lastVersion == null) {
        lastVersion = v.version;
        return;
      }
      if (v.version === lastVersion) return;
      lastVersion = v.version;
      await Promise.all([loadSessions(), loadManaged(), loadInstalled()]);
    } catch {
      // ignore polling failures (UI stays manual-refreshable)
    }
  }, 2000);
}

boot();

