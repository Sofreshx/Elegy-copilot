use std::path::Path;

use crate::db::Database;
use serde_json::json;

pub fn build_planning_persistence_health(elegy_home: &Path) -> serde_json::Value {
    let planning_db = elegy_home.join("planning.db");

    if !planning_db.exists() {
        return json!({
            "kind": "planning.persistence.health",
            "contractVersion": "planning_api_v1",
            "ready": false,
            "status": "disabled",
            "required": false,
            "configured": false,
            "usable": false,
            "initSupported": false,
            "initRequired": false,
            "error": format!("planning.db not found at {}", planning_db.display()),
        });
    }

    match Database::open_readonly(&planning_db) {
        Ok(db) => {
            let mut errors: Vec<String> = Vec::new();

            let tables: Vec<&str> = crate::db::planning_table_names().to_vec();
            for table in &tables {
                let exists: bool = db
                    .conn()
                    .query_row(
                        "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name=?1",
                        [table],
                        |row| row.get(0),
                    )
                    .unwrap_or(false);
                if !exists {
                    errors.push(format!("missing table: {}", table));
                }
            }

            let integrity = db
                .conn()
                .query_row("PRAGMA integrity_check", [], |row| {
                    row.get::<_, String>(0)
                })
                .unwrap_or_else(|e| e.to_string());
            if !integrity.eq_ignore_ascii_case("ok") {
                errors.push(format!("integrity_check: {}", integrity));
            }

            let _wal_mode: String = db
                .conn()
                .pragma_query_value(None, "journal_mode", |row| row.get(0))
                .unwrap_or_default();

            let ready = errors.is_empty();
            let status = if ready { "ok" } else { "error" };

            json!({
                "kind": "planning.persistence.health",
                "contractVersion": "planning_api_v1",
                "ready": ready,
                "status": status,
                "required": false,
                "configured": true,
                "usable": ready,
                "initSupported": false,
                "initRequired": false,
                "errors": errors,
                "error": errors.first().map(|s| s.as_str()),
            })
        }
        Err(e) => json!({
            "kind": "planning.persistence.health",
            "contractVersion": "planning_api_v1",
            "ready": false,
            "status": "error",
            "required": false,
            "configured": true,
            "usable": false,
            "initSupported": false,
            "initRequired": false,
            "error": format!("Failed to open planning.db: {}", e),
        }),
    }
}
