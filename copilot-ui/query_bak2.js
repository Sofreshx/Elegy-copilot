const better = require("better-sqlite3");
const db = better("C:\\Users\\lolzi\\.copilot\\elegy-planning.db.bak-20260603-135753", { readonly: true });
try {
  const cfg = db.prepare("SELECT * FROM planning_config").all();
  console.log("Config:", JSON.stringify(cfg, null, 2));
} catch(e) { console.log("Config error:", e.message); }
try {
  console.log("--- ALL tables row counts ---");
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '%fts%'").all();
  for (const t of tables) {
    try {
      const rc = db.prepare("SELECT COUNT(*) as cnt FROM " + t.name).all();
      if (rc[0].cnt > 0) console.log(t.name + ":", rc[0].cnt);
    } catch(e) {}
  }
} catch(e) {}
db.close();