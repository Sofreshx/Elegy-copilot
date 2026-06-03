const better = require("better-sqlite3");
const path = "C:\\Users\\lolzi\\.copilot\\elegy-planning.db.bak-20260603-135753";
const db = better(path, { readonly: true });
try {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  console.log("Tables:", tables.map(function(t){return t.name}).join(", "));
  const rc = db.prepare("SELECT COUNT(*) as cnt FROM roadmaps").all();
  console.log("Roadmap count:", rc[0].cnt);
  const rows = db.prepare("SELECT id, title FROM roadmaps LIMIT 30").all();
  rows.forEach(function(r){ console.log(" - " + r.id + " | " + r.title); });
} catch(e) {
  console.log("Error:", e.message);
  try {
    const tbl = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%plan%'").all();
    console.log("Plan tables:", tbl.map(function(t){return t.name}).join(","));
    const cols = db.prepare("PRAGMA table_info('roadmaps')").all();
    console.log("roadmaps columns:", cols.map(function(c){return c.name}).join(","));
  } catch(e2){ console.log(e2.message); }
} finally { db.close(); }