function $(id) {
  return document.getElementById(id);
}

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
  const data = await api('/api/sessions?activeWindowMinutes=30');
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
      const title = s.repo ? `${s.repo}` : s.cwd || s.id;
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
  $('session-detail').classList.remove('muted');
  $('session-detail').textContent = '';
  $('session-plan').textContent = '';
  $('session-agent-usage').textContent = '';
  $('session-agent-usage').classList.add('muted');
  $('session-events').textContent = '';
  $('session-detail').innerHTML = `
    <div><b>ID:</b> ${s.id}</div>
    <div><b>Status:</b> ${s.status}</div>
    <div><b>Repo:</b> ${s.repo || ''}</div>
    <div><b>Branch:</b> ${s.branch || ''}</div>
    <div><b>CWD:</b> ${s.cwd || ''}</div>
    <div><b>Mode:</b> ${s.mode || ''}</div>
    <div><b>Last event:</b> ${fmtTime(s.lastEventTime)}</div>
  `;

  setStatus(`Loading plan/events for ${s.id}…`);
  const [plan, agentUsage, evs] = await Promise.all([
    api(`/api/sessions/${encodeURIComponent(s.id)}/plan`).catch(() => ''),
    api(`/api/sessions/${encodeURIComponent(s.id)}/agent-usage?limit=500`).catch(() => ({ usage: {} })),
    api(`/api/sessions/${encodeURIComponent(s.id)}/events?limit=20`).catch(() => ({ events: [] })),
  ]);

  $('session-plan').textContent = String(plan || '').slice(0, 5000);

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

function bindUi() {
  $('tab-sessions').addEventListener('click', () => switchTab('sessions'));
  $('tab-assets').addEventListener('click', () => switchTab('assets'));
  $('btn-reload').addEventListener('click', () => window.location.reload());

  $('btn-refresh-sessions').addEventListener('click', () => loadSessions().catch((e) => setStatus(e.message)));

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

