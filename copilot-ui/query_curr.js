const better = require("better-sqlite3");
const db = better("C:\\Users\\lolzi\\.copilot\\elegy-planning.db", { readonly: true });
try {
  const cfg = db.prepare("SELECT * FROM planning_config").all();
  console.log("Config:", JSON.stringify(cfg));
  const rc = db.prepare("SELECT COUNT(*) as cnt FROM roadmaps").all();
  console.log("Roadmaps:", rc[0].cnt);
  const rows = db.prepare("SELECT id, title, status, goalId FROM roadmaps").all();
  rows.forEach(r => console.log(r.id, "|", r.title, "|", r.status, "| goal=", r.goalId));
  const goals = db.prepare("SELECT id, title FROM goals").all();
  console.log("Goals:", goals.length);
  const plans = db.prepare("SELECT COUNT(*) as cnt FROM plans").all();
  console.log("Plans:", plans[0].cnt);
} catch(e) { console.log("Error:", e.message); }
db.close();