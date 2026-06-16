use axum::extract::{Query, State};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use serde::Deserialize;
use std::path::PathBuf;

use crate::app::AppState;

// ── Helper functions ──

fn notes_dir(state: &AppState) -> PathBuf {
    state.config.elegy_home.join("notes")
}

fn metadata_dir(state: &AppState) -> PathBuf {
    notes_dir(state).join(".metadata")
}

fn metadata_path(state: &AppState) -> PathBuf {
    metadata_dir(state).join("notes.json")
}

fn settings_path(state: &AppState) -> PathBuf {
    metadata_dir(state).join("settings.json")
}

fn note_path(state: &AppState, id: &str) -> PathBuf {
    notes_dir(state).join(format!("{}.md", id))
}

fn ensure_notes_dir(state: &AppState) -> Result<(), String> {
    let dir = notes_dir(state);
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create notes directory: {}", e))
}

fn read_metadata(state: &AppState) -> serde_json::Value {
    let path = metadata_path(state);
    if path.exists() {
        std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    }
}

fn write_metadata(state: &AppState, meta: &serde_json::Value) -> Json<serde_json::Value> {
    if let Some(parent) = metadata_path(state).parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            return Json(serde_json::json!({"ok": false, "error": e.to_string()}));
        }
    }
    match serde_json::to_string_pretty(meta) {
        Ok(content) => match std::fs::write(metadata_path(state), content) {
            Ok(()) => Json(serde_json::json!({"ok": true})),
            Err(e) => Json(serde_json::json!({"ok": false, "error": e.to_string()})),
        },
        Err(e) => Json(serde_json::json!({"ok": false, "error": e.to_string()})),
    }
}

fn read_settings(state: &AppState) -> serde_json::Value {
    let path = settings_path(state);
    if path.exists() {
        std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    }
}

fn write_settings(state: &AppState, settings: &serde_json::Value) -> Json<serde_json::Value> {
    if let Some(parent) = settings_path(state).parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            return Json(serde_json::json!({"ok": false, "error": e.to_string()}));
        }
    }
    match serde_json::to_string_pretty(settings) {
        Ok(content) => match std::fs::write(settings_path(state), content) {
            Ok(()) => Json(serde_json::json!({"ok": true})),
            Err(e) => Json(serde_json::json!({"ok": false, "error": e.to_string()})),
        },
        Err(e) => Json(serde_json::json!({"ok": false, "error": e.to_string()})),
    }
}

/// Extract snippet from content: first non-empty line, stripped of leading `#`.
fn snippet_from_content(content: &str) -> String {
    content
        .lines()
        .find(|line| !line.trim().is_empty())
        .map(|line| line.trim_start_matches('#').trim())
        .unwrap_or("")
        .chars()
        .take(100)
        .collect()
}

// ── Query-parameter structs ──

#[derive(Deserialize)]
struct IdQuery {
    id: String,
}

#[derive(Deserialize)]
struct SearchQuery {
    q: String,
}

#[derive(Deserialize)]
struct KeyQuery {
    key: String,
}

// ── GET /api/notes/list ──

async fn list_notes(State(state): State<AppState>) -> Json<serde_json::Value> {
    if let Err(e) = ensure_notes_dir(&state) {
        return Json(serde_json::json!({"error": e, "notes": [], "count": 0}));
    }

    let dir = notes_dir(&state);
    let metadata = read_metadata(&state);
    let mut notes: Vec<serde_json::Value> = Vec::new();

    if let Ok(entries) = std::fs::read_dir(&dir) {
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
            let snippet = snippet_from_content(&content);

            let mut note = serde_json::json!({
                "id": id,
                "snippet": snippet,
                "title": "",
                "tags": [],
                "created": "",
                "updated": "",
            });

            if let Some(meta) = metadata.get(&id) {
                if let Some(title) = meta.get("title") {
                    note["title"] = title.clone();
                }
                if let Some(tags) = meta.get("tags") {
                    note["tags"] = tags.clone();
                }
                if let Some(created) = meta.get("created") {
                    note["created"] = created.clone();
                }
                if let Some(updated) = meta.get("updated") {
                    note["updated"] = updated.clone();
                }
            }

            notes.push(note);
        }
    }

    // Sort by updated descending
    notes.sort_by(|a, b| {
        let a_up = a["updated"].as_str().unwrap_or("");
        let b_up = b["updated"].as_str().unwrap_or("");
        b_up.cmp(a_up)
    });

    let count = notes.len();
    Json(serde_json::json!({"notes": notes, "count": count}))
}

// ── GET /api/notes/get?id=... ──

async fn get_note(
    State(state): State<AppState>,
    Query(params): Query<IdQuery>,
) -> Json<serde_json::Value> {
    let id = params.id.trim().to_string();
    if id.is_empty() {
        return Json(serde_json::json!({"error": "id query parameter is required", "kind": "bad_request"}));
    }

    let path = note_path(&state, &id);
    if !path.exists() {
        return Json(serde_json::json!({"error": "Note not found", "kind": "not_found"}));
    }

    let content = match std::fs::read_to_string(&path) {
        Ok(c) => c,
        Err(e) => return Json(serde_json::json!({"error": e.to_string(), "kind": "internal"})),
    };

    let metadata = read_metadata(&state);
    let note_meta = metadata.get(&id);

    let mut note = serde_json::json!({
        "id": id,
        "content": content,
        "title": "",
        "tags": [],
        "created": "",
        "updated": "",
    });

    if let Some(meta) = note_meta {
        if let Some(title) = meta.get("title") {
            note["title"] = title.clone();
        }
        if let Some(tags) = meta.get("tags") {
            note["tags"] = tags.clone();
        }
        if let Some(created) = meta.get("created") {
            note["created"] = created.clone();
        }
        if let Some(updated) = meta.get("updated") {
            note["updated"] = updated.clone();
        }
    }

    Json(serde_json::json!({"note": note}))
}

// ── POST /api/notes/create ──

async fn create_note(
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    let content = body["content"].as_str().unwrap_or("");
    if content.is_empty() {
        return Json(serde_json::json!({"error": "content is required", "kind": "bad_request"}));
    }

    if let Err(e) = ensure_notes_dir(&state) {
        return Json(serde_json::json!({"error": e, "kind": "internal"}));
    }

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    // Write content file
    let path = note_path(&state, &id);
    if let Err(e) = std::fs::write(&path, content) {
        return Json(serde_json::json!({"error": e.to_string(), "kind": "internal"}));
    }

    // Update metadata
    let title = body["title"].as_str().unwrap_or("Untitled");
    let tags: Vec<String> = body["tags"]
        .as_array()
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_default();

    let mut metadata = read_metadata(&state);
    metadata[&id] = serde_json::json!({
        "title": title,
        "tags": tags,
        "created": now,
        "updated": now,
    });

    let _ = write_metadata(&state, &metadata);

    Json(serde_json::json!({"ok": true, "id": id}))
}

// ── POST /api/notes/update ──

async fn update_note(
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    let id = body["id"].as_str().unwrap_or("");
    if id.is_empty() {
        return Json(serde_json::json!({"error": "id is required", "kind": "bad_request"}));
    }

    let path = note_path(&state, id);
    if !path.exists() {
        return Json(serde_json::json!({"error": "Note not found", "kind": "not_found"}));
    }

    let now = chrono::Utc::now().to_rfc3339();

    // Update content if provided
    if let Some(content) = body["content"].as_str() {
        if !content.is_empty() {
            if let Err(e) = std::fs::write(&path, content) {
                return Json(serde_json::json!({"error": e.to_string(), "kind": "internal"}));
            }
        }
    }

    // Update metadata
    let mut metadata = read_metadata(&state);
    let mut note_meta = metadata.get(id).cloned().unwrap_or(serde_json::json!({}));

    if let Some(title) = body["title"].as_str() {
        note_meta["title"] = serde_json::json!(title);
    }
    if let Some(tags) = body["tags"].as_array() {
        note_meta["tags"] = serde_json::json!(tags);
    }
    if let Some(content) = body["content"].as_str() {
        if !content.is_empty() {
            note_meta["content_updated"] = serde_json::json!(now);
        }
    }

    note_meta["updated"] = serde_json::json!(now);

    // Preserve created if not set
    if note_meta.get("created").is_none() {
        note_meta["created"] = serde_json::json!(now);
    }

    metadata[id] = note_meta;
    let _ = write_metadata(&state, &metadata);

    Json(serde_json::json!({"ok": true}))
}

// ── Shared delete logic ──

fn delete_note_by_id(state: &AppState, id: &str) -> Json<serde_json::Value> {
    let note_file = note_path(state, id);
    if note_file.exists() {
        if let Err(e) = std::fs::remove_file(&note_file) {
            return Json(serde_json::json!({"error": e.to_string(), "kind": "internal"}));
        }
    }

    let mut metadata = read_metadata(state);
    if let Some(obj) = metadata.as_object_mut() {
        obj.remove(id);
    }
    let _ = write_metadata(state, &metadata);

    Json(serde_json::json!({"ok": true}))
}

// ── DELETE /api/notes/delete?id=... ──

async fn delete_note(
    State(state): State<AppState>,
    Query(params): Query<IdQuery>,
) -> Json<serde_json::Value> {
    let id = params.id.trim().to_string();
    if id.is_empty() {
        return Json(serde_json::json!({"error": "id query parameter is required", "kind": "bad_request"}));
    }
    delete_note_by_id(&state, &id)
}

// ── POST /api/notes/delete (body: { id: "..." }) ──

async fn delete_note_post(
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    let id = body["id"].as_str().unwrap_or("");
    if id.is_empty() {
        return Json(serde_json::json!({"error": "id is required", "kind": "bad_request"}));
    }
    delete_note_by_id(&state, id)
}

// ── GET /api/notes/search?q=... ──

async fn search_notes(
    State(state): State<AppState>,
    Query(params): Query<SearchQuery>,
) -> Json<serde_json::Value> {
    let query = params.q.trim().to_lowercase();
    if query.is_empty() {
        return Json(serde_json::json!({"error": "q query parameter is required", "kind": "bad_request"}));
    }

    if let Err(e) = ensure_notes_dir(&state) {
        return Json(serde_json::json!({"error": e, "results": [], "count": 0}));
    }

    let dir = notes_dir(&state);
    let metadata = read_metadata(&state);
    let mut results: Vec<serde_json::Value> = Vec::new();

    if let Ok(entries) = std::fs::read_dir(&dir) {
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
            let content_lower = content.to_lowercase();

            let title = metadata
                .get(&id)
                .and_then(|m| m.get("title"))
                .and_then(|t| t.as_str())
                .unwrap_or("");

            let matches_content = content_lower.contains(&query);
            let matches_title = title.to_lowercase().contains(&query);

            if !matches_content && !matches_title {
                continue;
            }

            let snippet = snippet_from_content(&content);
            let tags = metadata
                .get(&id)
                .and_then(|m| m.get("tags"))
                .cloned()
                .unwrap_or(serde_json::json!([]));
            let created = metadata
                .get(&id)
                .and_then(|m| m.get("created"))
                .and_then(|c| c.as_str())
                .unwrap_or("");
            let updated = metadata
                .get(&id)
                .and_then(|m| m.get("updated"))
                .and_then(|u| u.as_str())
                .unwrap_or("");

            results.push(serde_json::json!({
                "id": id,
                "title": title,
                "tags": tags,
                "snippet": snippet,
                "created": created,
                "updated": updated,
            }));
        }
    }

    let count = results.len();
    Json(serde_json::json!({"results": results, "count": count}))
}

// ── POST /api/notes/export ──

async fn export_notes(
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    if let Err(e) = ensure_notes_dir(&state) {
        return Json(serde_json::json!({"error": e, "notes": [], "exported": false}));
    }

    let dir = notes_dir(&state);
    let metadata = read_metadata(&state);

    // Determine which notes to export
    let export_all = body.get("all").and_then(|v| v.as_bool()).unwrap_or(false);
    let ids_filter: Option<Vec<String>> = if export_all {
        None
    } else {
        body.get("ids")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
    };

    let mut notes: Vec<serde_json::Value> = Vec::new();

    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("md") {
                continue;
            }
            let Some(file_stem) = path.file_stem().and_then(|s| s.to_str()) else {
                continue;
            };
            let id = file_stem.to_string();

            // Apply optional id filter
            if let Some(ref ids) = ids_filter {
                if !ids.contains(&id) {
                    continue;
                }
            }

            let content = std::fs::read_to_string(&path).unwrap_or_default();
            let note_meta = metadata.get(&id);

            let title = note_meta
                .and_then(|m| m.get("title"))
                .and_then(|t| t.as_str())
                .unwrap_or("Untitled");
            let tags = note_meta
                .and_then(|m| m.get("tags"))
                .cloned()
                .unwrap_or(serde_json::json!([]));
            let created = note_meta
                .and_then(|m| m.get("created"))
                .and_then(|c| c.as_str())
                .unwrap_or("");
            let updated = note_meta
                .and_then(|m| m.get("updated"))
                .and_then(|u| u.as_str())
                .unwrap_or("");

            notes.push(serde_json::json!({
                "id": id,
                "title": title,
                "content": content,
                "tags": tags,
                "created": created,
                "updated": updated,
            }));
        }
    }

    Json(serde_json::json!({"notes": notes, "exported": true}))
}

// ── POST /api/notes/import ──

async fn import_notes(
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    let notes = match body["notes"].as_array() {
        Some(arr) => arr,
        None => {
            return Json(
                serde_json::json!({"error": "Request body must contain a \"notes\" array", "kind": "bad_request"}),
            );
        }
    };

    if let Err(e) = ensure_notes_dir(&state) {
        return Json(serde_json::json!({"error": e, "ok": false, "count": 0}));
    }

    let mut metadata = read_metadata(&state);
    let now = chrono::Utc::now().to_rfc3339();
    let mut count = 0usize;

    for note_val in notes {
        let content = note_val["content"].as_str().unwrap_or("");
        if content.is_empty() {
            continue;
        }

        let id = uuid::Uuid::new_v4().to_string();
        let path = note_path(&state, &id);
        if std::fs::write(&path, content).is_err() {
            continue;
        }

        let title = note_val["title"].as_str().unwrap_or("Untitled");
        let tags: Vec<String> = note_val["tags"]
            .as_array()
            .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
            .unwrap_or_default();

        metadata[&id] = serde_json::json!({
            "title": title,
            "tags": tags,
            "created": now,
            "updated": now,
        });

        count += 1;
    }

    let _ = write_metadata(&state, &metadata);

    Json(serde_json::json!({"ok": true, "count": count}))
}

// ── GET /api/notes/settings ──

async fn get_settings(State(state): State<AppState>) -> Json<serde_json::Value> {
    let settings = read_settings(&state);
    Json(serde_json::json!({"settings": settings}))
}

// ── GET /api/notes/settings/get?key=... ──

async fn get_settings_key(
    State(state): State<AppState>,
    Query(params): Query<KeyQuery>,
) -> Json<serde_json::Value> {
    let key = params.key.trim().to_string();
    if key.is_empty() {
        return Json(serde_json::json!({"error": "key query parameter is required", "kind": "bad_request"}));
    }

    let settings = read_settings(&state);
    let value = settings.get(&key);

    Json(serde_json::json!({"value": value}))
}

// ── POST /api/notes/settings/set ──

async fn set_settings(
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    let mut settings = read_settings(&state);

    if let Some(key) = body["key"].as_str() {
        // Set single key
        settings[key] = body["value"].clone();
    } else if let Some(obj) = body.as_object() {
        // Merge full settings object
        for (k, v) in obj {
            settings[k] = v.clone();
        }
    }

    write_settings(&state, &settings)
}

// ── DELETE /api/notes/settings/delete?key=... ──

async fn delete_settings_key(
    State(state): State<AppState>,
    Query(params): Query<KeyQuery>,
) -> Json<serde_json::Value> {
    let key = params.key.trim().to_string();
    if key.is_empty() {
        return Json(serde_json::json!({"error": "key query parameter is required", "kind": "bad_request"}));
    }

    let mut settings = read_settings(&state);
    if let Some(obj) = settings.as_object_mut() {
        obj.remove(&key);
    }
    write_settings(&state, &settings)
}

// ── POST /api/notes/sync/push (stub) ──

async fn sync_push() -> Json<serde_json::Value> {
    Json(serde_json::json!({"ok": true, "stub": true}))
}

// ── POST /api/notes/sync/pull (stub) ──

async fn sync_pull() -> Json<serde_json::Value> {
    Json(serde_json::json!({"ok": true, "stub": true}))
}

// ── GET /api/notes/sync/status (stub) ──

async fn sync_status_stub() -> Json<serde_json::Value> {
    Json(serde_json::json!({"dirty": false, "ahead": 0, "behind": 0, "stub": true}))
}

// ── Router ──

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/notes/list", get(list_notes))
        .route("/api/notes/get", get(get_note))
        .route("/api/notes/create", post(create_note))
        .route("/api/notes/update", post(update_note))
        .route("/api/notes/delete", delete(delete_note).post(delete_note_post))
        .route("/api/notes/search", get(search_notes))
        .route("/api/notes/export", post(export_notes))
        .route("/api/notes/import", post(import_notes))
        .route("/api/notes/settings", get(get_settings))
        .route("/api/notes/settings/get", get(get_settings_key))
        .route("/api/notes/settings/set", post(set_settings))
        .route("/api/notes/settings/delete", delete(delete_settings_key))
        .route("/api/notes/sync/push", post(sync_push))
        .route("/api/notes/sync/pull", post(sync_pull))
        .route("/api/notes/sync/status", get(sync_status_stub))
        .with_state(state)
}
