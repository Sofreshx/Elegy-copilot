use axum::extract::{Path, State};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::{json, Value};
use std::path::PathBuf;

use crate::app::AppState;

// ── Helper functions ────────────────────────────────────────────────────────

fn resolve_obsidian_cli() -> Option<PathBuf> {
    let exe = if cfg!(windows) { "obsidian.exe" } else { "obsidian" };
    let which = if cfg!(windows) { "where" } else { "which" };
    std::process::Command::new(which)
        .arg(exe)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|_| PathBuf::from(exe))
}

fn read_vault_path(state: &AppState) -> Option<PathBuf> {
    let path = vault_config_path(state);
    if path.exists() {
        std::fs::read_to_string(&path).ok().and_then(|s| {
            serde_json::from_str::<Value>(&s).ok().and_then(|v| {
                v.get("vaultPath")
                    .and_then(|p| p.as_str())
                    .map(PathBuf::from)
            })
        })
    } else {
        None
    }
}

fn read_planning_dir(state: &AppState) -> Option<PathBuf> {
    let path = vault_config_path(state);
    if path.exists() {
        std::fs::read_to_string(&path).ok().and_then(|s| {
            serde_json::from_str::<Value>(&s).ok().and_then(|v| {
                v.get("planningDir")
                    .and_then(|p| p.as_str())
                    .map(PathBuf::from)
            })
        })
    } else {
        None
    }
}

fn vault_config_path(state: &AppState) -> PathBuf {
    state.config.elegy_home.join("obsidian").join("vault-path.json")
}

#[allow(dead_code)]
fn obsidian_dir(state: &AppState) -> PathBuf {
    state.config.elegy_home.join("obsidian")
}

fn detect_vault_planning_dir(vault_path: &PathBuf) -> PathBuf {
    let candidates = [
        vault_path.join("planning"),
        vault_path.join("Elegy").join("planning"),
    ];
    for candidate in &candidates {
        if candidate.exists() && candidate.is_dir() {
            return candidate.clone();
        }
    }
    vault_path.join("planning")
}

fn run_obsidian_cli(args: &[&str]) -> Result<String, String> {
    let exe = if cfg!(windows) { "obsidian.exe" } else { "obsidian" };
    let output = std::process::Command::new(exe)
        .args(args)
        .output()
        .map_err(|e| format!("Obsidian CLI not available: {}", e))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

fn extract_title_from_md(content: &str) -> String {
    content
        .lines()
        .find(|line| line.trim_start().starts_with("# "))
        .map(|line| line.trim_start_matches("# ").trim())
        .unwrap_or("")
        .to_string()
}

fn extract_tags_from_md(content: &str) -> Vec<String> {
    let mut tags: Vec<String> = Vec::new();
    let lines: Vec<&str> = content.lines().collect();

    // Check frontmatter (between --- markers)
    if lines.first().map(|l| l.trim()) == Some("---") {
        let mut in_list = false;
        for line in &lines[1..] {
            let trimmed = line.trim();
            if trimmed == "---" {
                break;
            }
            if trimmed.starts_with("tags:") {
                let rest = trimmed.trim_start_matches("tags:").trim();
                if rest.starts_with('[') {
                    // Inline array: tags: [tag1, "tag two"]
                    let inner = rest
                        .trim_start_matches('[')
                        .trim_end_matches(']');
                    for t in inner.split(',') {
                        let tag = t
                            .trim()
                            .trim_matches('"')
                            .trim_matches('\'')
                            .to_string();
                        if !tag.is_empty() {
                            tags.push(tag);
                        }
                    }
                } else if !rest.is_empty() {
                    // Single inline tag: tags: tag1
                    tags.push(rest.to_string());
                } else {
                    // Block list follows: tags:\n  - tag1
                    in_list = true;
                }
            } else if in_list && trimmed.starts_with('-') {
                let tag = trimmed
                    .trim_start_matches('-')
                    .trim()
                    .trim_matches('"')
                    .to_string();
                if !tag.is_empty() {
                    tags.push(tag);
                }
            } else if in_list && !trimmed.is_empty() {
                in_list = false;
            }
        }
    }

    // Inline #tags anywhere in the content
    for line in &lines {
        for word in line.split_whitespace() {
            if word.starts_with('#') && word.len() > 1 {
                let tag = word.trim_start_matches('#').to_string();
                // Skip if it looks like a markdown heading marker (already found via H1)
                if !tags.contains(&tag) {
                    tags.push(tag);
                }
            }
        }
    }

    tags
}

fn file_modified_epoch(path: &std::path::Path) -> i64 {
    std::fs::metadata(path)
        .ok()
        .and_then(|m| m.modified().ok())
        .map(|t| {
            let duration = t.duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
            duration.as_secs() as i64
        })
        .unwrap_or(0)
}

fn scan_notes(vault_path: &PathBuf) -> Vec<Value> {
    let planning_dir = detect_vault_planning_dir(vault_path);
    let mut notes: Vec<Value> = Vec::new();

    if !planning_dir.exists() {
        return notes;
    }

    if let Ok(entries) = std::fs::read_dir(&planning_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("md") {
                continue;
            }
            let Some(file_stem) = path.file_stem().and_then(|s| s.to_str()) else {
                continue;
            };
            let id = file_stem.to_string();

            let content = std::fs::read_to_string(&path).unwrap_or_default();
            let title = extract_title_from_md(&content);
            let tags = extract_tags_from_md(&content);
            let modified = file_modified_epoch(&path);

            notes.push(json!({
                "id": id,
                "title": title,
                "tags": tags,
                "modified": modified,
            }));
        }
    }

    // Sort by modified descending
    notes.sort_by(|a, b| {
        let a_m = a["modified"].as_i64().unwrap_or(0);
        let b_m = b["modified"].as_i64().unwrap_or(0);
        b_m.cmp(&a_m)
    });

    notes
}

fn scan_representations(vault_path: &PathBuf) -> Vec<Value> {
    let planning_dir = detect_vault_planning_dir(vault_path);
    let mut representations: Vec<Value> = Vec::new();

    if !planning_dir.exists() {
        return representations;
    }

    if let Ok(entries) = std::fs::read_dir(&planning_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("md") {
                continue;
            }
            let Some(file_stem) = path.file_stem().and_then(|s| s.to_str()) else {
                continue;
            };

            // Filter to files matching representation naming patterns
            let file_name = file_stem.to_lowercase();
            let is_representation = file_name.contains("representation")
                || file_name.contains("plan")
                || file_name.contains("goal")
                || file_name.contains("roadmap");

            if !is_representation {
                continue;
            }

            let content = std::fs::read_to_string(&path).unwrap_or_default();
            let title = extract_title_from_md(&content);
            let modified = file_modified_epoch(&path);

            representations.push(json!({
                "id": file_stem.to_string(),
                "title": title,
                "modified": modified,
            }));
        }
    }

    representations
}

// ── GET /api/planning/obsidian/status ───────────────────────────────────────

async fn get_obsidian_status(State(state): State<AppState>) -> Json<Value> {
    let cli_available = resolve_obsidian_cli().is_some();
    let vault_path = read_vault_path(&state);
    let planning_dir = match vault_path.as_ref() {
        Some(vp) => {
            // Check if user configured a custom planningDir, else auto-detect
            let custom = read_planning_dir(&state);
            Some(custom.unwrap_or_else(|| detect_vault_planning_dir(vp)))
        }
        None => None,
    };

    let note_count = vault_path
        .as_ref()
        .map(|vp| scan_notes(vp).len())
        .unwrap_or(0);

    let (status, vault_path_str, planning_dir_str) = if vault_path.is_some() {
        (
            "connected",
            vault_path
                .as_ref()
                .map(|p| p.to_string_lossy().to_string()),
            planning_dir.map(|p| p.to_string_lossy().to_string()),
        )
    } else {
        ("disconnected", None, None)
    };

    Json(json!({
        "status": status,
        "cliAvailable": cli_available,
        "vaultPath": vault_path_str,
        "planningDir": planning_dir_str,
        "noteCount": note_count,
    }))
}

// ── GET /api/planning/obsidian/notes ────────────────────────────────────────

async fn list_obsidian_notes(State(state): State<AppState>) -> Json<Value> {
    let vault_path = match read_vault_path(&state) {
        Some(vp) => vp,
        None => {
            return Json(json!({
                "notes": [],
                "count": 0,
                "error": "Obsidian vault not configured",
                "kind": "not_configured",
            }));
        }
    };

    let notes = scan_notes(&vault_path);
    let count = notes.len();
    Json(json!({ "notes": notes, "count": count }))
}

// ── GET /api/planning/obsidian/notes/{note_id} ─────────────────────────────

async fn get_obsidian_note(
    State(state): State<AppState>,
    Path(note_id): Path<String>,
) -> Json<Value> {
    if note_id.trim().is_empty() {
        return Json(json!({
            "error": "Note id is required",
            "kind": "bad_request",
        }));
    }

    let vault_path = match read_vault_path(&state) {
        Some(vp) => vp,
        None => {
            return Json(json!({
                "note": null,
                "error": "Obsidian vault not configured",
                "kind": "not_configured",
            }));
        }
    };

    let planning_dir = detect_vault_planning_dir(&vault_path);
    let note_file = planning_dir.join(format!("{}.md", note_id));

    if !note_file.exists() {
        return Json(json!({
            "note": null,
            "error": "Note not found",
            "kind": "not_found",
        }));
    }

    let content = match std::fs::read_to_string(&note_file) {
        Ok(c) => c,
        Err(e) => {
            return Json(json!({
                "error": e.to_string(),
                "kind": "internal",
            }));
        }
    };

    let title = extract_title_from_md(&content);
    let tags = extract_tags_from_md(&content);
    let modified = file_modified_epoch(&note_file);

    Json(json!({
        "note": {
            "id": note_id,
            "title": title,
            "content": content,
            "tags": tags,
            "modified": modified,
        }
    }))
}

// ── POST /api/planning/obsidian/sync ────────────────────────────────────────

async fn trigger_obsidian_sync(State(state): State<AppState>) -> Json<Value> {
    // Try Obsidian CLI sync first
    if resolve_obsidian_cli().is_some() {
        match run_obsidian_cli(&["sync"]) {
            Ok(_) => {
                // After CLI sync, scan vault notes
                let vault_path = read_vault_path(&state);
                let notes_processed = vault_path
                    .as_ref()
                    .map(|vp| scan_notes(vp).len())
                    .unwrap_or(0);

                return Json(json!({
                    "ok": true,
                    "synced": true,
                    "notesProcessed": notes_processed,
                }));
            }
            Err(e) => {
                // CLI sync failed, fall through to filesystem fallback
                tracing::warn!("Obsidian CLI sync failed, using filesystem fallback: {}", e);
            }
        }
    }

    // Fallback: filesystem-only scan
    let vault_path = match read_vault_path(&state) {
        Some(vp) => vp,
        None => {
            return Json(json!({
                "ok": false,
                "synced": false,
                "notesProcessed": 0,
                "error": "Obsidian vault not configured",
                "kind": "not_configured",
            }));
        }
    };

    let notes_processed = scan_notes(&vault_path).len();

    Json(json!({
        "ok": true,
        "synced": true,
        "notesProcessed": notes_processed,
    }))
}

// ── POST /api/planning/obsidian/source-selection ───────────────────────────

async fn set_obsidian_source_selection(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> Json<Value> {
    let vault_path = match body["vaultPath"].as_str() {
        Some(vp) => vp.trim().to_string(),
        None => {
            return Json(json!({
                "ok": false,
                "error": "vaultPath is required",
                "kind": "bad_request",
            }));
        }
    };

    if vault_path.is_empty() {
        return Json(json!({
            "ok": false,
            "error": "vaultPath must not be empty",
            "kind": "bad_request",
        }));
    }

    let vp_path = PathBuf::from(&vault_path);
    if !vp_path.exists() {
        return Json(json!({
            "ok": false,
            "error": "vaultPath does not exist on disk",
            "kind": "bad_request",
        }));
    }

    let planning_dir = body["planningDir"]
        .as_str()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| {
            detect_vault_planning_dir(&vp_path)
                .to_string_lossy()
                .to_string()
        });

    let config_path = vault_config_path(&state);
    if let Some(parent) = config_path.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            return Json(json!({
                "ok": false,
                "error": format!("Failed to create config directory: {}", e),
                "kind": "internal",
            }));
        }
    }

    let config = json!({
        "vaultPath": vault_path,
        "planningDir": planning_dir,
    });

    match serde_json::to_string_pretty(&config) {
        Ok(content) => match std::fs::write(&config_path, content) {
            Ok(()) => Json(json!({
                "ok": true,
                "vaultPath": vault_path,
                "planningDir": planning_dir,
            })),
            Err(e) => Json(json!({
                "ok": false,
                "error": e.to_string(),
                "kind": "internal",
            })),
        },
        Err(e) => Json(json!({
            "ok": false,
            "error": e.to_string(),
            "kind": "internal",
        })),
    }
}

// ── GET /api/planning/obsidian/representations/status ──────────────────────

async fn get_obsidian_representation_status(
    State(state): State<AppState>,
) -> Json<Value> {
    let vault_path = match read_vault_path(&state) {
        Some(vp) => vp,
        None => {
            return Json(json!({
                "status": "idle",
                "representationCount": 0,
                "vaultPath": null,
            }));
        }
    };

    let planning_dir = detect_vault_planning_dir(&vault_path);
    let dir_exists = planning_dir.exists();

    let representation_count = if dir_exists {
        scan_representations(&vault_path).len()
    } else {
        0
    };

    let status = if representation_count > 0 { "synced" } else { "idle" };

    Json(json!({
        "status": status,
        "representationCount": representation_count,
    }))
}

// ── GET /api/planning/obsidian/representations ─────────────────────────────

async fn list_obsidian_representations(
    State(state): State<AppState>,
) -> Json<Value> {
    let vault_path = match read_vault_path(&state) {
        Some(vp) => vp,
        None => {
            return Json(json!({
                "representations": [],
                "count": 0,
                "error": "Obsidian vault not configured",
                "kind": "not_configured",
            }));
        }
    };

    let representations = scan_representations(&vault_path);
    let count = representations.len();
    Json(json!({ "representations": representations, "count": count }))
}

// ── POST /api/planning/obsidian/representations/refresh ────────────────────

async fn refresh_obsidian_representations(
    State(state): State<AppState>,
) -> Json<Value> {
    let vault_path = match read_vault_path(&state) {
        Some(vp) => vp,
        None => {
            return Json(json!({
                "ok": false,
                "refreshed": false,
                "count": 0,
                "error": "Obsidian vault not configured",
                "kind": "not_configured",
            }));
        }
    };

    let count = scan_representations(&vault_path).len();

    Json(json!({
        "ok": true,
        "refreshed": true,
        "count": count,
    }))
}

// ── Router ──────────────────────────────────────────────────────────────────

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/planning/obsidian/status", get(get_obsidian_status))
        .route(
            "/api/planning/obsidian/notes",
            get(list_obsidian_notes),
        )
        .route(
            "/api/planning/obsidian/notes/{note_id}",
            get(get_obsidian_note),
        )
        .route(
            "/api/planning/obsidian/sync",
            post(trigger_obsidian_sync),
        )
        .route(
            "/api/planning/obsidian/source-selection",
            post(set_obsidian_source_selection),
        )
        .route(
            "/api/planning/obsidian/representations/status",
            get(get_obsidian_representation_status),
        )
        .route(
            "/api/planning/obsidian/representations",
            get(list_obsidian_representations),
        )
        .route(
            "/api/planning/obsidian/representations/refresh",
            post(refresh_obsidian_representations),
        )
        .with_state(state)
}
