use axum::{Router, routing::get, extract::{State, Query}, Json};
use serde::Deserialize;
use crate::app::AppState;

#[derive(Deserialize)]
struct LexiconQuery {
    q: Option<String>,
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/lexicon/entries", get(entries_handler))
        .route("/api/lexicon/search", get(search_handler))
        .with_state(state)
}

// ── Helpers ──────────────────────────────────────────────────────────────────

fn lexicon_dir(state: &AppState) -> std::path::PathBuf {
    state.config.engine_root.join("docs").join("lexicon")
}

fn parse_lexicon_entry(file_path: &std::path::Path, category: &str) -> Vec<serde_json::Value> {
    let content = match std::fs::read_to_string(file_path) {
        Ok(c) => c,
        Err(_) => return vec![],
    };

    let mut entries = vec![];
    let mut current_term: Option<String> = None;
    let mut current_def = String::new();
    let mut current_usage = String::new();
    let mut current_related = String::new();
    let mut current_tags: Vec<String> = vec![];

    for line in content.lines() {
        // Heading: ### Term Name
        if let Some(term) = line.strip_prefix("### ") {
            // Flush previous entry
            if let Some(term) = current_term.take() {
                entries.push(serde_json::json!({
                    "term": term,
                    "definition": current_def.trim(),
                    "usage": current_usage.trim(),
                    "related": current_related.trim(),
                    "tags": current_tags,
                    "file": category,
                }));
            }
            current_term = Some(term.trim().to_string());
            current_def = String::new();
            current_usage = String::new();
            current_related = String::new();
            current_tags = vec![];
            continue;
        }

        if current_term.is_none() {
            continue;
        }

        // Parse fields: **Definition:**, **Usage:**, **Related:**, **Tags:**
        if let Some(def) = line.strip_prefix("**Definition:** ") {
            current_def.push_str(def.trim());
            continue;
        }
        if let Some(usage) = line.strip_prefix("**Usage:** ") {
            current_usage.push_str(usage.trim());
            continue;
        }
        if let Some(related) = line.strip_prefix("**Related:** ") {
            current_related.push_str(related.trim());
            continue;
        }
        if let Some(tags_str) = line.strip_prefix("**Tags:** ") {
            current_tags = tags_str.split(',')
                .map(|t| t.trim().to_lowercase())
                .filter(|t| !t.is_empty())
                .collect();
            continue;
        }
    }

    // Flush last entry
    if let Some(term) = current_term {
        entries.push(serde_json::json!({
            "term": term,
            "definition": current_def.trim(),
            "usage": current_usage.trim(),
            "related": current_related.trim(),
            "tags": current_tags,
            "file": category,
        }));
    }

    entries
}

fn load_all_entries(state: &AppState) -> (Vec<serde_json::Value>, u64) {
    let dir = lexicon_dir(state);
    let mut all_entries = vec![];

    if !dir.is_dir() {
        return (all_entries, 0);
    }

    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(ext) = path.extension() {
                    if ext == "md" {
                        let name = entry.file_name().to_string_lossy().to_string();
                        if name.starts_with("__") {
                            continue;
                        }
                        let category = name.strip_suffix(".md").unwrap_or(&name).to_string();
                        let file_entries = parse_lexicon_entry(&path, &category);
                        all_entries.extend(file_entries);
                    }
                }
            }
        }
    }

    let count = all_entries.len() as u64;
    (all_entries, count)
}

fn search_entries(entries: &[serde_json::Value], query: &str) -> Vec<serde_json::Value> {
    let query_lower = query.to_lowercase();
    let terms: Vec<&str> = query_lower.split_whitespace().filter(|t| !t.is_empty()).collect();
    if terms.is_empty() {
        return entries.to_vec();
    }

    let mut scored: Vec<(serde_json::Value, i64)> = entries.iter().map(|entry| {
        let mut score = 0i64;
        let term_lower = entry["term"].as_str().unwrap_or("").to_lowercase();
        let def_lower = entry["definition"].as_str().unwrap_or("").to_lowercase();
        let usage_lower = entry["usage"].as_str().unwrap_or("").to_lowercase();
        let tags: Vec<String> = entry["tags"].as_array()
            .map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_lowercase())).collect())
            .unwrap_or_default();

        for term in &terms {
            if term_lower == *term {
                score += 100;
            } else if term_lower.starts_with(term) {
                score += 80;
            } else if term_lower.contains(term) {
                score += 60;
            }

            if tags.contains(&term.to_string()) {
                score += 70;
            } else if tags.iter().any(|t| t.contains(term)) {
                score += 50;
            }

            if def_lower.contains(term) {
                score += 30;
            }
            if usage_lower.contains(term) {
                score += 20;
            }
        }

        (entry.clone(), score)
    }).collect();

    scored.sort_by(|a, b| b.1.cmp(&a.1));
    scored.into_iter()
        .take(50)
        .filter(|(_, score)| *score > 0)
        .map(|(entry, _)| entry)
        .collect()
}

// ── Route Handlers ───────────────────────────────────────────────────────────

/// GET /api/lexicon/entries
/// List all lexicon entries
async fn entries_handler(
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    let (entries, total) = load_all_entries(&state);
    Json(serde_json::json!({
        "entries": entries,
        "total": total,
    }))
}

/// GET /api/lexicon/search?q=...
/// Search lexicon entries for a term
async fn search_handler(
    State(state): State<AppState>,
    Query(query): Query<LexiconQuery>,
) -> Json<serde_json::Value> {
    let (all_entries, total) = load_all_entries(&state);

    let q = query.q.as_deref().unwrap_or("").trim();
    if q.is_empty() {
        return Json(serde_json::json!({
            "results": [],
            "total": total,
            "filteredTotal": 0,
        }));
    }

    let results = search_entries(&all_entries, q);
    Json(serde_json::json!({
        "results": results,
        "total": total,
        "filteredTotal": results.len(),
    }))
}
