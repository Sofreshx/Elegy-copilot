function $(id) {
  return document.getElementById(id);
}

let sessionSource = 'cli';
let selectedSession = null;
let assetsTarget = 'cli';

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

function withTarget(url) {
  const u = String(url || '');
  if (!u) return u;
  const join = u.includes('?') ? '&' : '?';
  return `${u}${join}target=${encodeURIComponent(assetsTarget)}`;
}

function setStatus(msg) {
  $('status').textContent = msg;
}

async function viewRel(relPath, label) {
  const txt = await api(withTarget(`/api/assets/view?path=${encodeURIComponent(relPath)}`)).catch((e) => `Error: ${e.message}`);
  $('viewer-meta').textContent = label || relPath;
  $('viewer').textContent = txt;
}

async function deleteRel(relPath, label) {
  const ok = window.confirm(`Delete ${relPath}?\n\nThis is destructive and cannot be undone.`);
  if (!ok) return;

  setStatus(`Deleting ${relPath}…`);
  const r = await api(withTarget('/api/assets/delete'), { method: 'POST', body: JSON.stringify({ path: relPath, force: true }) }).catch((e) => ({
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
  $('tab-sessions').classList.toggle('active', sessions);
  $('tab-assets').classList.toggle('active', !sessions);
  $('view-sessions').classList.toggle('hidden', !sessions);
  $('view-assets').classList.toggle('hidden', sessions);
}

async function loadSessions() {
  setStatus('Loading sessions…');
  const data = await api(`/api/sessions?activeWindowMinutes=30&source=${encodeURIComponent(sessionSource)}`);
  const sessions = data.sessions || [];
  const active = sessions.filter((s) => s.status === 'active');
  const past = sessions.filter((s) => s.status !== 'active');
  $('sessions-summary').textContent = `${active.length} active, ${past.length} past`;

  function renderList(target, list) {
    target.textContent = '';
    for (const s of list) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'item';
      const prefix = sessionSource === 'all' ? `[${String(s.source || 'cli').toUpperCase()}] ` : '';
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
  $('session-plan').textContent = '';
  $('session-final').textContent = '';
  $('session-agent-usage').textContent = '';
  $('session-agent-usage').classList.add('muted');
  $('session-events').textContent = '';
  $('session-detail').innerHTML = `
    <div><b>ID:</b> ${s.id}</div>
    <div><b>Source:</b> ${s.source || sessionSource}</div>
    <div><b>Status:</b> ${s.status}</div>
    <div><b>Repo:</b> ${s.repo || ''}</div>
    <div><b>Branch:</b> ${s.branch || ''}</div>
    <div><b>CWD:</b> ${s.cwd || ''}</div>
    <div><b>Mode:</b> ${s.mode || ''}</div>
    <div><b>Last event:</b> ${fmtTime(s.lastEventTime)}</div>
  `;

  setStatus(`Loading plan/events for ${s.id}…`);
  const source = encodeURIComponent(String(s.source || sessionSource || 'cli'));
  const [plan, finalOut, agentUsage, evs] = await Promise.all([
    api(`/api/sessions/${encodeURIComponent(s.id)}/plan?source=${source}`).catch(() => ''),
    api(`/api/sessions/${encodeURIComponent(s.id)}/final?source=${source}`).catch(() => ''),
    api(`/api/sessions/${encodeURIComponent(s.id)}/agent-usage?limit=500&source=${source}`).catch(() => ({ usage: {} })),
    api(`/api/sessions/${encodeURIComponent(s.id)}/events?limit=20&source=${source}`).catch(() => ({ events: [] })),
  ]);

  $('session-plan').textContent = String(plan || '').slice(0, 5000);
  $('session-final').textContent = String(finalOut || '').slice(0, 8000);

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

async function loadManaged() {
  setStatus('Loading managed assets…');
  const data = await api(withTarget('/api/assets/managed'));
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
      await api(withTarget('/api/assets/sync'), { method: 'POST', body: JSON.stringify({ assetId: a.id }) });
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
      const r = await api(withTarget('/api/assets/remove'), { method: 'POST', body: JSON.stringify({ assetId: a.id }) }).catch((e) => ({ error: e.message }));
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
  const data = await api(withTarget('/api/assets/installed'));
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

  // Prompts + instructions are only meaningful for the VS Code assets target.
  const pt = $('prompts-table');
  const ip = $('instructions-panel');
  if (assetsTarget !== 'vscode') {
    if (pt) pt.innerHTML = '<tr><td class="muted" colspan="3">(VS Code target only)</td></tr>';
    if (ip) {
      ip.classList.add('muted');
      ip.textContent = '(VS Code target only)';
    }
    return;
  }

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
  const r = await api(withTarget('/api/assets/sync-all'), { method: 'POST', body: JSON.stringify({ dryRun: false, force: false }) });
  $('viewer-meta').textContent = 'Sync all';
  $('viewer').textContent = JSON.stringify(r, null, 2);
  await loadManaged();
  await loadInstalled();
  setStatus('Sync all complete.');
}

async function patchVscodeSettings() {
  if (assetsTarget !== 'vscode') return;
  const ok = window.confirm(
    'Patch VS Code user settings (chat.*Locations) to point at the VS Code asset home?\n\nThis edits settings.json and creates a backup.'
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
    'Authorize Copilot tool access for:\n\n- ~/.copilot\n- ~/Documents/instruction-engine\n\nThis updates ~/.copilot/permissions-config.json and creates a backup if needed.'
  );
  if (!ok) return;
  setStatus('Authorizing Copilot folders…');
  const r = await api('/api/copilot/authorize', { method: 'POST', body: JSON.stringify({ dryRun: false }) }).catch((e) => ({ error: e.message }));
  $('viewer-meta').textContent = 'Authorize Copilot folders';
  $('viewer').textContent = JSON.stringify(r, null, 2);
  setStatus('Authorization setup attempted.');
}

function bindUi() {
  $('tab-sessions').addEventListener('click', () => switchTab('sessions'));
  $('tab-assets').addEventListener('click', () => switchTab('assets'));
  $('btn-reload').addEventListener('click', () => window.location.reload());

  $('btn-refresh-sessions').addEventListener('click', () => loadSessions().catch((e) => setStatus(e.message)));

  function setSessionsSource(next) {
    sessionSource = next;
    $('tab-sessions-cli').classList.toggle('active', next === 'cli');
    $('tab-sessions-vscode').classList.toggle('active', next === 'vscode');
    $('tab-sessions-all').classList.toggle('active', next === 'all');
    selectedSession = null;
    $('btn-archive-session').disabled = true;
    $('btn-delete-session').disabled = true;
    $('session-detail').textContent = 'Select a session.';
    $('session-detail').classList.add('muted');
    $('session-plan').textContent = '';
    $('session-final').textContent = '';
    $('session-agent-usage').textContent = '';
    $('session-events').textContent = '';
    loadSessions().catch((e) => setStatus(e.message));
  }

  $('tab-sessions-cli').addEventListener('click', () => setSessionsSource('cli'));
  $('tab-sessions-vscode').addEventListener('click', () => setSessionsSource('vscode'));
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

  function setAssetsTarget(next) {
    assetsTarget = next;
    $('tab-assets-cli').classList.toggle('active', next === 'cli');
    $('tab-assets-vscode').classList.toggle('active', next === 'vscode');
    $('btn-vscode-patch-settings').disabled = next !== 'vscode';
    loadManaged().catch((e) => setStatus(e.message));
    loadInstalled().catch((e) => setStatus(e.message));
  }

  $('tab-assets-cli').addEventListener('click', () => setAssetsTarget('cli'));
  $('tab-assets-vscode').addEventListener('click', () => setAssetsTarget('vscode'));
  $('btn-vscode-patch-settings').addEventListener('click', () => patchVscodeSettings().catch((e) => setStatus(e.message)));
  $('btn-copilot-authorize').addEventListener('click', () => authorizeCopilotFolders().catch((e) => setStatus(e.message)));
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

