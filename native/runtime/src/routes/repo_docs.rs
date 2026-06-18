use axum::{Router, extract::{State, Query}, Json};
use axum::routing::{get, post, delete};
use serde::Deserialize;
use std::path::{Path as StdPath, PathBuf};
use crate::app::AppState;
use crate::error::ApiError;

// ── Constants ────────────────────────────────────────────────────────────────

const ALLOWED_EXTENSIONS: &[&str] = &[".md", ".markdown"];
const TREE_ALLOWED_EXTENSIONS: &[&str] = &[".md", ".markdown", ".json", ".toml"];
const ALLOWED_PREFIXES: &[&str] = &[
    "specs/", "docs/", "skills/", "agents/", ".agents/", ".github/",
    ".opencode/", ".codex/", ".copilot/", ".gemini/", ".antigravity/"
];
const ALLOWED_ROOT_FILES: &[&str] = &[
    "README.md", "readme.md", "CHANGELOG.md", "changelog.md",
    "AGENTS.md", "agents.md", "guidelines.md", "GUIDELINES.md"
];
const CONFIG_DIRECTORIES: &[&str] = &[
    "skills", "agents", ".opencode", ".codex", ".copilot", ".gemini", ".antigravity"
];
const MAX_FILE_SIZE: u64 = 512 * 1024;
const TREE_MAX_DEPTH: u32 = 5;
const TREE_SKIP_DIRS: &[&str] = &["node_modules", ".git", "dist", "build", "target", "__pycache__"];

const TREE_SCAN_PREFIXES: &[(&str, Option<&str>)] = &[
    ("specs/", None),
    ("docs/specs/", None),
    ("docs/", None),
    ("skills/", None),
    ("agents/", None),
    (".agents/", Some("agents")),
    (".github/", Some("copilot")),
    (".opencode/", Some("opencode")),
    (".codex/", Some("codex")),
    (".copilot/", Some("copilot")),
    (".gemini/", Some("antigravity")),
    (".antigravity/", Some("antigravity")),
];

// ── Query / Body types ───────────────────────────────────────────────────────

#[derive(Deserialize)]
#[allow(dead_code)]
struct RepoDocsQuery {
    #[serde(rename = "repoPath")]
    repo_path: Option<String>,
    path: Option<String>,
}

#[derive(Deserialize)]
struct RepoDocsWriteBody {
    #[serde(rename = "repoPath")]
    repo_path: Option<String>,
    path: Option<String>,
    content: Option<String>,
}

// ── Router ───────────────────────────────────────────────────────────────────

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/repo-docs/list", get(repo_docs_list))
        .route("/api/repo-docs/read", get(repo_docs_read))
        .route("/api/repo-docs/tree", get(repo_docs_tree))
        .route("/api/repo-docs/graph", get(repo_docs_graph))
        .route("/api/repo-docs/write", post(repo_docs_write))
        .route("/api/repo-docs/delete", delete(repo_docs_delete))
        .with_state(state)
}

// ── Helpers ──────────────────────────────────────────────────────────────────

fn resolve_root(state: &AppState, repo_path: Option<String>) -> PathBuf {
    repo_path
        .map(PathBuf::from)
        .unwrap_or_else(|| state.config.engine_root.clone())
}

/// Check whether a relative path is allowed for read/write/delete
fn is_allowed_doc_path(relative: &str) -> bool {
    let normalized = relative.replace('\\', "/");
    if normalized.contains("..") || normalized.starts_with('/') {
        return false;
    }
    let ext = StdPath::new(&normalized)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();
    let dot_ext = format!(".{}", ext);
    if !ALLOWED_EXTENSIONS.contains(&dot_ext.as_str()) {
        return false;
    }
    let basename = StdPath::new(&normalized)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");
    if ALLOWED_ROOT_FILES.contains(&basename) {
        return true;
    }
    ALLOWED_PREFIXES.iter().any(|p| normalized.starts_with(p))
}

/// Prevent path traversal outside root
fn check_traversal(full_path: &StdPath, root: &StdPath) -> Result<(), ApiError> {
    let canonical = full_path.canonicalize().unwrap_or_else(|_| full_path.to_path_buf());
    let root_canonical = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    if !canonical.starts_with(&root_canonical) {
        return Err(ApiError::BadRequest("Path traversal detected".to_string()));
    }
    Ok(())
}

/// Recursively scan a directory for markdown files
fn scan_md_files(
    dir: &StdPath,
    base_dir: &StdPath,
    results: &mut Vec<serde_json::Value>,
    extensions: &[&str],
    max_depth: u32,
) {
    if !dir.is_dir() {
        return;
    }
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if TREE_SKIP_DIRS.contains(&name.as_str()) {
            continue;
        }
        let relative = path.strip_prefix(base_dir)
            .unwrap_or(&path)
            .to_string_lossy()
            .to_string()
            .replace('\\', "/");

        let depth = relative.split('/').count() as u32;
        if depth > max_depth && max_depth > 0 {
            continue;
        }

        if let Ok(ftype) = entry.file_type() {
            if ftype.is_dir() {
                scan_md_files(&path, base_dir, results, extensions, max_depth);
            } else if ftype.is_file() {
                let ext = path.extension()
                    .and_then(|e| e.to_str())
                    .map(|e| e.to_lowercase())
                    .unwrap_or_default();
                let dot_ext = format!(".{}", ext);
                if extensions.contains(&dot_ext.as_str()) {
                    if let Ok(meta) = std::fs::metadata(&path) {
                        if meta.len() <= MAX_FILE_SIZE {
                            let modified = meta.modified()
                                .ok()
                                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                                .map(|d| d.as_millis())
                                .unwrap_or(0);
                            results.push(serde_json::json!({
                                "path": relative,
                                "name": name,
                                "size": meta.len(),
                                "modifiedAt": modified,
                            }));
                        }
                    }
                }
            }
        }
    }
}

fn count_tree_dirs(nodes: &[serde_json::Value]) -> u64 {
    let mut count = 0u64;
    for node in nodes {
        if node["type"].as_str() == Some("directory") {
            count += 1;
            if let Some(children) = node["children"].as_array() {
                count += count_tree_dirs(children);
            }
        }
    }
    count
}

/// Extract .md file links from content
fn extract_md_links(content: &str, file_set: &std::collections::HashSet<String>) -> Vec<serde_json::Value> {
    let mut edges = vec![];
    // Markdown links: [text](target.md)
    let md_re = regex::Regex::new(r"\[([^\]]+)\]\(([^)]+\.md)\)").unwrap();
    for cap in md_re.captures_iter(content) {
        let target = cap[2].replace('\\', "/").replacen("./", "", 1);
        if file_set.contains(&target) {
            edges.push(serde_json::json!({ "source": "", "target": target, "type": "link" }));
        }
    }
    // Wiki links: [[target]] or [[target|text]]
    let wiki_re = regex::Regex::new(r"\[\[([^\]|]+)(?:\|[^\]]+)?\]\]").unwrap();
    for cap in wiki_re.captures_iter(content) {
        let target = format!("{}.md", &cap[1]);
        if file_set.contains(&target) {
            edges.push(serde_json::json!({ "source": "", "target": target, "type": "wiki" }));
        }
    }
    edges
}

// ── Route Handlers ───────────────────────────────────────────────────────────

/// GET /api/repo-docs/list?repoPath=...
/// Scan repo for .md docs in docs/, specs/, and config directories
async fn repo_docs_list(
    State(state): State<AppState>,
    Query(query): Query<RepoDocsQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let root = resolve_root(&state, query.repo_path);
    if !root.is_dir() {
        return Err(ApiError::NotFound("Repository path not found".to_string()));
    }

    let mut files = vec![];

    // Scan subdirectories
    for sub_dir in ["specs", "docs"].iter().chain(CONFIG_DIRECTORIES.iter()) {
        let full_path = root.join(sub_dir);
        scan_md_files(&full_path, &root, &mut files, ALLOWED_EXTENSIONS, 10);
    }

    // Scan root files
    for root_file in ALLOWED_ROOT_FILES {
        let full_path = root.join(root_file);
        if full_path.is_file() {
            if let Ok(meta) = std::fs::metadata(&full_path) {
                let modified = meta.modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis())
                    .unwrap_or(0);
                files.push(serde_json::json!({
                    "path": root_file,
                    "name": root_file,
                    "size": meta.len(),
                    "modifiedAt": modified,
                }));
            }
        }
    }

    files.sort_by(|a, b| {
        a["path"].as_str().unwrap_or("").cmp(b["path"].as_str().unwrap_or(""))
    });

    Ok(Json(serde_json::json!({
        "repoPath": root.to_string_lossy(),
        "files": files,
        "count": files.len(),
    })))
}

/// GET /api/repo-docs/read?repoPath=...&path=...
/// Read a specific doc file
async fn repo_docs_read(
    State(state): State<AppState>,
    Query(query): Query<RepoDocsQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let root = resolve_root(&state, query.repo_path);
    let relative_path = query.path.unwrap_or_default();

    if relative_path.is_empty() {
        return Err(ApiError::BadRequest("path query parameter is required".to_string()));
    }
    if !root.is_dir() {
        return Err(ApiError::NotFound("Repository path not found".to_string()));
    }
    if !is_allowed_doc_path(&relative_path) {
        return Err(ApiError::BadRequest("Path is not allowed".to_string()));
    }

    let full_path = root.join(&relative_path);
    check_traversal(&full_path, &root)?;

    if !full_path.is_file() {
        return Err(ApiError::NotFound("File not found".to_string()));
    }

    let meta = std::fs::metadata(&full_path)
        .map_err(|e| ApiError::Internal(e.into()))?;
    if !meta.is_file() {
        return Err(ApiError::BadRequest("Path is not a file".to_string()));
    }
    if meta.len() > MAX_FILE_SIZE {
        return Err(ApiError::BadRequest("File too large".to_string()));
    }

    let content = std::fs::read_to_string(&full_path)
        .map_err(|e| ApiError::Internal(e.into()))?;
    let modified = meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis())
        .unwrap_or(0);

    Ok(Json(serde_json::json!({
        "path": relative_path,
        "name": StdPath::new(&relative_path).file_name().and_then(|n| n.to_str()).unwrap_or(""),
        "content": content,
        "size": meta.len(),
        "modifiedAt": modified,
    })))
}

/// GET /api/repo-docs/tree?repoPath=...
/// Build directory tree of docs/
async fn repo_docs_tree(
    State(state): State<AppState>,
    Query(query): Query<RepoDocsQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let root = resolve_root(&state, query.repo_path);
    if !root.is_dir() {
        return Err(ApiError::NotFound("Repository path not found".to_string()));
    }

    let mut files = vec![];

    // Scan each allowed prefix
    for (prefix, harness) in TREE_SCAN_PREFIXES {
        let full_path = root.join(prefix);
        scan_md_files(&full_path, &root, &mut files, TREE_ALLOWED_EXTENSIONS, TREE_MAX_DEPTH);
        // Add harness info if applicable
        if let Some(h) = harness {
            for f in &mut files {
                if f["harness"].is_null() {
                    f["harness"] = serde_json::json!(h);
                }
            }
        }
    }

    // Scan root files
    for root_file in ALLOWED_ROOT_FILES {
        let full_path = root.join(root_file);
        if full_path.is_file() {
            if let Ok(meta) = std::fs::metadata(&full_path) {
                if meta.len() <= MAX_FILE_SIZE {
                    files.push(serde_json::json!({
                        "path": root_file,
                        "name": root_file,
                        "size": meta.len(),
                        "modifiedAt": meta.modified()
                            .ok()
                            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                            .map(|d| d.as_millis())
                            .unwrap_or(0),
                    }));
                }
            }
        }
    }

    // Build tree from file paths
    let tree = build_tree_from_paths(&files);

    Ok(Json(serde_json::json!({
        "repoPath": root.to_string_lossy(),
        "tree": tree,
        "totalFiles": files.len(),
        "totalDirs": count_tree_dirs(&tree),
    })))
}

/// Build a tree from flat file list
fn build_tree_from_paths(files: &[serde_json::Value]) -> Vec<serde_json::Value> {
    use std::collections::BTreeMap;

    // Phase 1: collect files into their parent directory
    let mut dir_files: BTreeMap<String, Vec<serde_json::Value>> = BTreeMap::new();

    for file in files {
        let path = file["path"].as_str().unwrap_or("").replace('\\', "/");
        let parts: Vec<&str> = path.split('/').collect();
        if parts.is_empty() || (parts.len() == 1 && parts[0].is_empty()) {
            continue;
        }
        let dir_path = if parts.len() == 1 {
            String::new()
        } else {
            parts[..parts.len()-1].join("/")
        };
        let entry = serde_json::json!({
            "name": parts.last().unwrap_or(&""),
            "path": path,
            "kind": "file",
            "size": file["size"],
            "modifiedAt": file["modifiedAt"],
        });
        dir_files.entry(dir_path).or_default().push(entry);
    }

    // Phase 2: build tree recursively
    fn build_node(dir_path: &str, dir_files: &BTreeMap<String, Vec<serde_json::Value>>) -> serde_json::Value {
        let name = StdPath::new(dir_path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(dir_path);

        let mut children: Vec<serde_json::Value> = vec![];

        // Add files in this directory
        if let Some(files) = dir_files.get(dir_path) {
            children.extend(files.iter().cloned());
        }

        // Find subdirectories and recurse
        let prefix = if dir_path.is_empty() {
            String::new()
        } else {
            format!("{}/", dir_path)
        };
        let subdirs: std::collections::BTreeSet<String> = dir_files.keys()
            .filter(|k| {
                if prefix.is_empty() {
                    !k.contains('/')
                } else {
                    k.starts_with(&prefix) && k[prefix.len()..].contains('/')
                }
            })
            .filter_map(|k| {
                if prefix.is_empty() {
                    k.split('/').next().map(|s| s.to_string())
                } else {
                    k[prefix.len()..].split('/').next().map(|s| format!("{}{}", prefix, s))
                }
            })
            .collect();

        for subdir in subdirs {
            if subdir != *dir_path {
                let node = build_node(&subdir, dir_files);
                children.push(node);
            }
        }

        // Sort: directories first, then files alphabetically
        children.sort_by(|a, b| {
            let a_kind = a["kind"].as_str().unwrap_or("file");
            let b_kind = b["kind"].as_str().unwrap_or("file");
            if a_kind != b_kind {
                return if a_kind == "directory" { std::cmp::Ordering::Less } else { std::cmp::Ordering::Greater };
            }
            a["name"].as_str().unwrap_or("").cmp(b["name"].as_str().unwrap_or(""))
        });

        if dir_path.is_empty() {
            // Root level: return children directly
            return serde_json::Value::Array(children);
        }

        serde_json::json!({
            "name": name,
            "path": dir_path,
            "kind": "directory",
            "children": children,
        })
    }

    let result = build_node("", &dir_files);
    result.as_array().cloned().unwrap_or_default()
}

/// GET /api/repo-docs/graph?repoPath=...
/// Build a doc graph from markdown file links
async fn repo_docs_graph(
    State(state): State<AppState>,
    Query(query): Query<RepoDocsQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let root = resolve_root(&state, query.repo_path);
    if !root.is_dir() {
        return Err(ApiError::NotFound("Repository path not found".to_string()));
    }

    let mut files = vec![];
    for sub_dir in ["specs", "docs"].iter().chain(CONFIG_DIRECTORIES.iter()) {
        let full_path = root.join(sub_dir);
        scan_md_files(&full_path, &root, &mut files, ALLOWED_EXTENSIONS, 10);
    }
    for root_file in ALLOWED_ROOT_FILES {
        let full_path = root.join(root_file);
        if full_path.is_file() {
            if let Ok(meta) = std::fs::metadata(&full_path) {
                files.push(serde_json::json!({
                    "path": root_file,
                    "name": root_file,
                    "size": meta.len(),
                    "modifiedAt": 0u64,
                }));
            }
        }
    }

    let file_set: std::collections::HashSet<String> = files.iter()
        .filter_map(|f| f["path"].as_str().map(|s| s.to_string()))
        .collect();

    let mut nodes = vec![];
    let mut edges = vec![];
    let mut errors: Vec<String> = vec![];
    let skipped: Vec<String> = vec![];

    for file in &files {
        let path = file["path"].as_str().unwrap_or("");
        if path.is_empty() { continue; }

        let depth = path.split('/').count().saturating_sub(1);
        nodes.push(serde_json::json!({
            "id": path,
            "label": file["name"],
            "path": path,
            "depth": depth,
        }));

        // Read and extract links
        let full_path = root.join(path);
        if let Ok(content) = std::fs::read_to_string(&full_path) {
            let file_edges = extract_md_links(&content, &file_set);
            for mut e in file_edges {
                e["source"] = serde_json::Value::String(path.to_string());
                edges.push(e);
            }
        } else {
            errors.push(format!("Could not read: {}", path));
        }
    }

    Ok(Json(serde_json::json!({
        "repoPath": root.to_string_lossy(),
        "nodes": nodes,
        "edges": edges,
        "errors": if errors.is_empty() { serde_json::Value::Null } else { serde_json::json!(errors) },
        "skipped": if skipped.is_empty() { serde_json::Value::Null } else { serde_json::json!(skipped) },
    })))
}

/// POST /api/repo-docs/write
/// Body: { repoPath, path, content }
async fn repo_docs_write(
    State(state): State<AppState>,
    Json(body): Json<RepoDocsWriteBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let root = resolve_root(&state, body.repo_path);
    let relative_path = body.path.unwrap_or_default();
    let content = body.content.unwrap_or_default();

    if relative_path.is_empty() {
        return Err(ApiError::BadRequest("path is required in the request body".to_string()));
    }
    if !root.is_dir() {
        return Err(ApiError::NotFound("Repository path not found".to_string()));
    }
    if !is_allowed_doc_path(&relative_path) {
        return Err(ApiError::BadRequest("Path is not allowed".to_string()));
    }

    let full_path = root.join(&relative_path);
    check_traversal(&full_path, &root)?;

    // Ensure parent directory exists
    if let Some(parent) = full_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| ApiError::Internal(e.into()))?;
    }

    std::fs::write(&full_path, &content)
        .map_err(|e| ApiError::Internal(e.into()))?;

    let meta = std::fs::metadata(&full_path)
        .map_err(|e| ApiError::Internal(e.into()))?;

    Ok(Json(serde_json::json!({
        "path": relative_path,
        "name": StdPath::new(&relative_path).file_name().and_then(|n| n.to_str()).unwrap_or(""),
        "size": meta.len(),
        "modifiedAt": meta.modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis())
            .unwrap_or(0),
    })))
}

/// DELETE /api/repo-docs/delete
/// Query: repoPath, path
async fn repo_docs_delete(
    State(state): State<AppState>,
    Query(query): Query<RepoDocsQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let root = resolve_root(&state, query.repo_path);
    let relative_path = query.path.unwrap_or_default();

    if relative_path.is_empty() {
        return Err(ApiError::BadRequest("path query parameter is required".to_string()));
    }
    if !root.is_dir() {
        return Err(ApiError::NotFound("Repository path not found".to_string()));
    }
    if !is_allowed_doc_path(&relative_path) {
        return Err(ApiError::BadRequest("Path is not allowed".to_string()));
    }

    // Check protected files (root-level AGENTS.md, guidelines.md, etc.)
    let normalized_rel = relative_path.replace('\\', "/");
    let basename = StdPath::new(&normalized_rel)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_lowercase();
    let protected_basenames = ["agents.md", "guidelines.md", "readme.md", "changelog.md"];
    if protected_basenames.contains(&basename.as_str()) && !normalized_rel.contains('/') {
        return Err(ApiError::BadRequest("Protected file — cannot be deleted from the document viewer".to_string()));
    }
    let protected_prefixes = [".opencode/", ".codex/", ".copilot/", ".gemini/", ".antigravity/"];
    if protected_prefixes.iter().any(|p| normalized_rel.starts_with(p)) {
        return Err(ApiError::BadRequest("Protected file — cannot be deleted from the document viewer".to_string()));
    }

    let full_path = root.join(&relative_path);
    check_traversal(&full_path, &root)?;

    if !full_path.exists() {
        return Err(ApiError::NotFound("File not found".to_string()));
    }
    if !full_path.is_file() {
        return Err(ApiError::BadRequest("Path is not a file".to_string()));
    }

    std::fs::remove_file(&full_path)
        .map_err(|e| ApiError::Internal(e.into()))?;

    Ok(Json(serde_json::json!({
        "deleted": true,
        "path": relative_path,
    })))
}
