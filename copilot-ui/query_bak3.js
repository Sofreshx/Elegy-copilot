const better = require("better-sqlite3");
const db = better("C:\\Users\\lolzi\\.copilot\\elegy-planning.db.bak-20260603-135753", { readonly: true });
try {
  const events = db.prepare("SELECT * FROM planning_events ORDER BY created_at DESC LIMIT 10").all();
  console.log("Events:", events.length);
  events.forEach(e => console.log(e.event_type, e.entity_type, e.entity_id, e.created_at));
} catch(e) { console.log("Events:", e.message); }
try {
  // Check for project_runs which might show CLI versions
  const runs = db.prepare("SELECT * FROM project_runs LIMIT 5").all();
  console.log("Runs:", runs.length);
  runs.forEach(r => console.log(JSON.stringify(r)));
} catch(e) {}
try {
  // Check if scopes or tag_index has repo info
  const tags = db.prepare("SELECT * FROM tag_index LIMIT 20").all();
  console.log("Tags:", JSON.stringify(tags));
} catch(e) {}
db.close();