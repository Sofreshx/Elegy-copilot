use axum::{Router, extract::{State, Query}, Json};
use axum::routing::{get, post};
use serde::Deserialize;
use std::process::Command;
use crate::app::AppState;
use crate::error::ApiError;

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/git/status", get(git_status))
        .route("/api/git/branches", get(git_branches))
        .route("/api/git/diff", get(git_diff))
        .route("/api/git/log", get(git_log))
        .route("/api/git/graph", get(git_graph))
        .route("/api/git/summary", get(git_summary))
        .route("/api/git/stashes", get(git_stashes))
        .route("/api/git/merge-candidates", get(git_merge_candidates))
        .route("/api/github-status", get(github_status))
        .route("/api/git/pull-request", get(git_pull_request_list).post(git_pull_request_create))
        .route("/api/git/stage", post(git_stage))
        .route("/api/git/unstage", post(git_unstage))
        .route("/api/git/commit", post(git_commit))
        .route("/api/git/commit-message", post(git_commit_message))
        .route("/api/git/checkout", post(git_checkout))
        .route("/api/git/pull", post(git_pull))
        .route("/api/git/push", post(git_push))
        .route("/api/git/stash", post(git_stash))
        .route("/api/git/stash/apply", post(git_stash_apply))
        .route("/api/git/stash/pop", post(git_stash_pop))
        .route("/api/git/stash/drop", post(git_stash_drop))
        .route("/api/git/merge-dry-run", post(git_merge_dry_run))
        .route("/api/git/merge-local", post(git_merge_local))
        .route("/api/git/auth/login", post(git_auth_login))
        .route("/api/git/github-install", post(git_github_install))
        .with_state(state)
}

// ── POST /api/git/pull ──────────────────────────────────────────────────────

/// POST /api/git/pull?repoPath=...
/// Body: { branch: "main" } (optional)
async fn git_pull(
    State(state): State<AppState>,
    Query(query): Query<GitQuery>,
    Json(body): Json<PullBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let cwd = resolve_repo(&state, query.repo_path);

    let branch = body.branch.as_deref().unwrap_or("");

    let output = if branch.is_empty() {
        run_git_str_trimmed(&cwd, &["pull".to_string(), "origin".to_string()])?
    } else {
        run_git_str_trimmed(&cwd, &[
            "pull".to_string(),
            "origin".to_string(),
            branch.to_string(),
        ])?
    };

    Ok(Json(serde_json::json!({ "ok": true, "message": output })))
}

// ── POST /api/git/push ──────────────────────────────────────────────────────

/// POST /api/git/push?repoPath=...
/// Body: { branch: "main", force: false }
async fn git_push(
    State(state): State<AppState>,
    Query(query): Query<GitQuery>,
    Json(body): Json<PushBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let cwd = resolve_repo(&state, query.repo_path);

    let branch = body.branch.as_deref().unwrap_or("");
    let force = body.force.unwrap_or(false);

    let output = if branch.is_empty() {
        if force {
            run_git_str_trimmed(&cwd, &[
                "push".to_string(),
                "origin".to_string(),
                "--force".to_string(),
            ])?
        } else {
            run_git_str_trimmed(&cwd, &["push".to_string(), "origin".to_string()])?
        }
    } else {
        if force {
            run_git_str_trimmed(&cwd, &[
                "push".to_string(),
                "origin".to_string(),
                branch.to_string(),
                "--force".to_string(),
            ])?
        } else {
            run_git_str_trimmed(&cwd, &[
                "push".to_string(),
                "origin".to_string(),
                branch.to_string(),
            ])?
        }
    };

    Ok(Json(serde_json::json!({ "ok": true, "message": output })))
}

// ── GET /api/git/stashes ────────────────────────────────────────────────────

/// GET /api/git/stashes?repoPath=...
async fn git_stashes(
    State(state): State<AppState>,
    Query(query): Query<GitQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let cwd = resolve_repo(&state, query.repo_path);

    let output = run_git_stdout(&cwd, &["stash", "list", "--format=%gd|%gs|%ai"]).unwrap_or_default();

    let stashes: Vec<serde_json::Value> = output.lines()
        .filter(|l| !l.is_empty())
        .filter_map(|l| {
            let parts: Vec<&str> = l.splitn(3, '|').collect();
            if parts.len() < 1 { return None; }
            let stash_ref = parts[0].to_string();
            let message = parts.get(1).unwrap_or(&"").to_string();
            let date = parts.get(2).unwrap_or(&"").to_string();
            Some(serde_json::json!({ "ref": stash_ref, "message": message, "date": date }))
        })
        .collect();

    Ok(Json(serde_json::json!({ "stashes": stashes })))
}

// ── POST /api/git/stash ─────────────────────────────────────────────────────

/// POST /api/git/stash?repoPath=...
/// Body: { message: "optional message" }
async fn git_stash(
    State(state): State<AppState>,
    Query(query): Query<GitQuery>,
    Json(body): Json<StashBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let cwd = resolve_repo(&state, query.repo_path);

    if let Some(ref msg) = body.message {
        if !msg.is_empty() {
            run_git_str_trimmed(&cwd, &["stash".to_string(), "push".to_string(), "-m".to_string(), msg.clone()])?;
        } else {
            run_git_stdout_trimmed(&cwd, &["stash", "push"])?;
        }
    } else {
        run_git_stdout_trimmed(&cwd, &["stash", "push"])?;
    }

    Ok(Json(serde_json::json!({ "ok": true })))
}

// ── POST /api/git/stash/apply ───────────────────────────────────────────────

/// POST /api/git/stash/apply?repoPath=...
/// Body: { ref: "stash@{0}" }
async fn git_stash_apply(
    State(state): State<AppState>,
    Query(query): Query<GitQuery>,
    Json(body): Json<StashRefBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let cwd = resolve_repo(&state, query.repo_path);

    if let Some(ref stash_ref) = body.stash_ref {
        run_git_str_trimmed(&cwd, &["stash".to_string(), "apply".to_string(), stash_ref.clone()])?;
    } else if let Some(idx) = body.index {
        run_git_str_trimmed(&cwd, &[
            "stash".to_string(),
            "apply".to_string(),
            format!("stash@{{{}}}", idx),
        ])?;
    } else {
        run_git_stdout_trimmed(&cwd, &["stash", "apply"])?;
    }

    Ok(Json(serde_json::json!({ "ok": true })))
}

// ── POST /api/git/stash/pop ─────────────────────────────────────────────────

/// POST /api/git/stash/pop?repoPath=...
/// Body: { ref: "stash@{0}" }
async fn git_stash_pop(
    State(state): State<AppState>,
    Query(query): Query<GitQuery>,
    Json(body): Json<StashRefBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let cwd = resolve_repo(&state, query.repo_path);

    if let Some(ref stash_ref) = body.stash_ref {
        run_git_str_trimmed(&cwd, &["stash".to_string(), "pop".to_string(), stash_ref.clone()])?;
    } else if let Some(idx) = body.index {
        run_git_str_trimmed(&cwd, &[
            "stash".to_string(),
            "pop".to_string(),
            format!("stash@{{{}}}", idx),
        ])?;
    } else {
        run_git_stdout_trimmed(&cwd, &["stash", "pop"])?;
    }

    Ok(Json(serde_json::json!({ "ok": true })))
}

// ── POST /api/git/stash/drop ────────────────────────────────────────────────

/// POST /api/git/stash/drop?repoPath=...
/// Body: { ref: "stash@{0}" }
async fn git_stash_drop(
    State(state): State<AppState>,
    Query(query): Query<GitQuery>,
    Json(body): Json<StashRefBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let cwd = resolve_repo(&state, query.repo_path);

    if let Some(ref stash_ref) = body.stash_ref {
        run_git_str_trimmed(&cwd, &["stash".to_string(), "drop".to_string(), stash_ref.clone()])?;
    } else if let Some(idx) = body.index {
        run_git_str_trimmed(&cwd, &[
            "stash".to_string(),
            "drop".to_string(),
            format!("stash@{{{}}}", idx),
        ])?;
    } else {
        run_git_stdout_trimmed(&cwd, &["stash", "drop"])?;
    }

    Ok(Json(serde_json::json!({ "ok": true })))
}

// ── GET /api/git/merge-candidates ───────────────────────────────────────────

/// GET /api/git/merge-candidates?repoPath=...
async fn git_merge_candidates(
    State(state): State<AppState>,
    Query(query): Query<GitQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let cwd = resolve_repo(&state, query.repo_path);

    let merged_output = run_git_stdout(&cwd, &["branch", "--merged"]).unwrap_or_default();
    let merged: Vec<String> = merged_output.lines()
        .map(|l| l.trim().trim_start_matches('*').trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();

    let unmerged_output = run_git_stdout(&cwd, &["branch", "--no-merged", "main"]).unwrap_or_default();
    let unmerged: Vec<String> = unmerged_output.lines()
        .map(|l| l.trim().trim_start_matches('*').trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();

    Ok(Json(serde_json::json!({ "merged": merged, "unmerged": unmerged })))
}

// ── POST /api/git/merge-dry-run ─────────────────────────────────────────────

/// POST /api/git/merge-dry-run?repoPath=...
/// Body: { source: "branch", target: "main", sourceRef: "...", targetRef: "..." }
async fn git_merge_dry_run(
    State(state): State<AppState>,
    Query(query): Query<GitQuery>,
    Json(body): Json<MergeDryRunBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let cwd = resolve_repo(&state, query.repo_path);

    let source = body.source.or(body.source_ref);
    let _target = body.target.or(body.target_ref);

    let source = source.as_deref().unwrap_or("");
    if source.is_empty() {
        return Err(ApiError::BadRequest("source or sourceRef is required".to_string()));
    }

    // Dry run: try merge then abort
    let output = Command::new("git")
        .args(["-C", &cwd, "merge", "--no-commit", "--no-ff", source])
        .output()
        .map_err(|e| ApiError::Internal(e.into()))?;

    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let has_conflicts = !output.status.success();

    // Always abort the dry run merge
    let _ = Command::new("git")
        .args(["-C", &cwd, "merge", "--abort"])
        .output();

    // Parse conflict files from stderr
    let conflicts: Vec<String> = if has_conflicts {
        stderr.lines()
            .filter(|l| l.contains("CONFLICT") || l.contains("merge failed"))
            .map(|l| {
                // Extract filename after "in " or "merge failed in "
                l.split("in ")
                    .nth(1)
                    .unwrap_or(l)
                    .trim()
                    .trim_end_matches('.')
                    .to_string()
            })
            .collect()
    } else {
        Vec::new()
    };

    Ok(Json(serde_json::json!({
        "hasConflicts": has_conflicts,
        "conflicts": conflicts,
        "ok": !has_conflicts,
    })))
}

// ── POST /api/git/merge-local ───────────────────────────────────────────────

/// POST /api/git/merge-local?repoPath=...
/// Body: { source: "branch", sourceRef: "...", target: "...", targetRef: "..." }
async fn git_merge_local(
    State(state): State<AppState>,
    Query(query): Query<GitQuery>,
    Json(body): Json<MergeLocalBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let cwd = resolve_repo(&state, query.repo_path);

    let source = body.source.or(body.source_ref);
    let source = source.as_deref().unwrap_or("");
    if source.is_empty() {
        return Err(ApiError::BadRequest("source or sourceRef is required".to_string()));
    }

    let output = run_git_stdout_trimmed(&cwd, &["merge", source])?;

    Ok(Json(serde_json::json!({ "ok": true, "message": output })))
}

// ── GET /api/github-status ──────────────────────────────────────────────────

/// GET /api/github-status?repoPath=...
async fn github_status(
    State(state): State<AppState>,
    Query(query): Query<GitQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let cwd = resolve_repo(&state, query.repo_path);

    // Check remote URL to determine GitHub connectivity
    let remote_url = get_remote_url(&cwd);
    let is_github = remote_url
        .as_ref()
        .map(|u| u.contains("github.com"))
        .unwrap_or(false);

    Ok(Json(serde_json::json!({
        "connected": is_github,
        "remote": remote_url,
        "service": if is_github { serde_json::Value::String("github".to_string()) } else { serde_json::Value::Null },
    })))
}

// ── POST /api/git/auth/login ────────────────────────────────────────────────

/// POST /api/git/auth/login?repoPath=...
/// Body: { token: "..." }
async fn git_auth_login(
    State(_state): State<AppState>,
    Query(_query): Query<GitQuery>,
    Json(body): Json<AuthLoginBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let token = body.token.unwrap_or_default();
    if token.is_empty() {
        return Err(ApiError::BadRequest("token is required".to_string()));
    }

    // Pipe token into gh auth login --with-token
    let mut child = Command::new("gh")
        .args(["auth", "login", "--with-token"])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| ApiError::Internal(e.into()))?;

    use std::io::Write;
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(token.as_bytes())
            .map_err(|e| ApiError::Internal(e.into()))?;
    }
    drop(child.stdin.take());

    let output = child.wait_with_output()
        .map_err(|e| ApiError::Internal(e.into()))?;

    if output.status.success() {
        Ok(Json(serde_json::json!({
            "ok": true,
            "authenticated": true,
        })))
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        Err(ApiError::Internal(anyhow::anyhow!(
            "gh auth login failed: {}",
            stderr.trim()
        )))
    }
}

// ── POST /api/git/github-install ────────────────────────────────────────────

/// POST /api/git/github-install?repoPath=...
async fn git_github_install(
    State(_state): State<AppState>,
    Query(_query): Query<GitQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    #[cfg(target_os = "windows")]
    let result = {
        let output = Command::new("winget")
            .args([
                "install",
                "--id", "GitHub.cli",
                "--accept-source-agreements",
                "--accept-package-agreements",
            ])
            .output()
            .map_err(|e| ApiError::Internal(e.into()))?;
        if output.status.success() {
            serde_json::json!({
                "ok": true,
                "method": "winget",
                "message": "GitHub CLI installed via winget."
            })
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            serde_json::json!({
                "ok": false,
                "method": "winget",
                "message": format!("winget install failed: {}", stderr.trim()),
                "error": stderr.trim()
            })
        }
    };

    #[cfg(target_os = "macos")]
    let result = {
        let output = Command::new("brew")
            .args(["install", "gh"])
            .output()
            .map_err(|e| ApiError::Internal(e.into()))?;
        if output.status.success() {
            serde_json::json!({
                "ok": true,
                "method": "brew",
                "message": "GitHub CLI installed via Homebrew."
            })
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            serde_json::json!({
                "ok": false,
                "method": "brew",
                "message": format!("brew install failed: {}", stderr.trim()),
                "error": stderr.trim()
            })
        }
    };

    #[cfg(target_os = "linux")]
    let result = {
        let output = Command::new("apt")
            .args(["install", "-y", "gh"])
            .output()
            .map_err(|e| ApiError::Internal(e.into()))?;
        if output.status.success() {
            serde_json::json!({
                "ok": true,
                "method": "apt",
                "message": "GitHub CLI installed via apt."
            })
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            serde_json::json!({
                "ok": false,
                "method": "apt",
                "message": format!("apt install failed: {}", stderr.trim()),
                "error": stderr.trim()
            })
        }
    };

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    let result = serde_json::json!({
        "ok": false,
        "method": "error",
        "message": "Unsupported platform. Please install GitHub CLI manually: https://cli.github.com"
    });

    Ok(Json(result))
}

// ── GET /api/git/pull-request (list) ────────────────────────────────────────

/// GET /api/git/pull-request?repoPath=...
async fn git_pull_request_list(
    State(state): State<AppState>,
    Query(query): Query<GitQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let cwd = resolve_repo(&state, query.repo_path);
    let pr_info = resolve_pull_request(&cwd);
    Ok(Json(pr_info))
}

// ── POST /api/git/pull-request (create) ─────────────────────────────────────

/// POST /api/git/pull-request?repoPath=...
/// Body: { title, body, head, base }
async fn git_pull_request_create(
    State(state): State<AppState>,
    Query(query): Query<GitQuery>,
    Json(body): Json<PullRequestBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let cwd = resolve_repo(&state, query.repo_path);

    // Check gh is available
    if !Command::new("gh").arg("--version").output().is_ok() {
        return Err(ApiError::BadRequest(
            "GitHub CLI is unavailable. Install it first via POST /api/git/github-install".to_string(),
        ));
    }

    // Build args: gh pr create --fill [--title <title>] [--body <body>] [--base <base>] [--head <head>]
    let mut args: Vec<String> = vec!["pr".to_string(), "create".to_string(), "--fill".to_string()];

    if let Some(ref title) = body.title {
        if !title.is_empty() {
            args.push("--title".to_string());
            args.push(title.clone());
        }
    }
    if let Some(ref body_text) = body.body {
        if !body_text.is_empty() {
            args.push("--body".to_string());
            args.push(body_text.clone());
        }
    }
    if let Some(ref base) = body.base_field {
        if !base.is_empty() {
            args.push("--base".to_string());
            args.push(base.clone());
        }
    }
    if let Some(ref head) = body.head {
        if !head.is_empty() {
            args.push("--head".to_string());
            args.push(head.clone());
        }
    }

    let output = Command::new("gh")
        .args(&args)
        .current_dir(&cwd)
        .output()
        .map_err(|e| ApiError::Internal(e.into()))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(ApiError::Internal(anyhow::anyhow!(
            "gh pr create failed: {}",
            stderr.trim()
        )));
    }

    let pr_url = String::from_utf8_lossy(&output.stdout).trim().to_string();

    // Re-query PR info to confirm
    let pr_info = resolve_pull_request(&cwd);

    Ok(Json(serde_json::json!({
        "created": true,
        "pullRequest": pr_info["pullRequest"],
        "output": pr_url,
        "isProtected": false,
        "overrideApplied": false,
    })))
}

// ── POST /api/git/stage ─────────────────────────────────────────────────────

/// POST /api/git/stage?repoPath=...
/// Body: { files: ["path1"], file: "path", all: true }
async fn git_stage(
    State(state): State<AppState>,
    Query(query): Query<GitQuery>,
    Json(body): Json<StageBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let cwd = resolve_repo(&state, query.repo_path);

    if body.all == Some(true) {
        run_git_stdout_trimmed(&cwd, &["add", "-A"])?;
    } else {
        let mut files: Vec<String> = Vec::new();
        if let Some(ref f) = body.file {
            files.push(f.clone());
        }
        if let Some(ref fs) = body.files {
            for f in fs {
                if !files.contains(f) {
                    files.push(f.clone());
                }
            }
        }
        if files.is_empty() {
            // Default: stage all
            run_git_stdout_trimmed(&cwd, &["add", "-A"])?;
        } else {
            let mut args: Vec<String> = vec!["add".to_string(), "--".to_string()];
            args.extend(files);
            run_git_str(&cwd, &args)?;
        }
    }

    Ok(Json(serde_json::json!({ "ok": true })))
}

// ── POST /api/git/unstage ───────────────────────────────────────────────────

/// POST /api/git/unstage?repoPath=...
/// Body: { files: ["path1"], file: "path", all: true }
async fn git_unstage(
    State(state): State<AppState>,
    Query(query): Query<GitQuery>,
    Json(body): Json<StageBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let cwd = resolve_repo(&state, query.repo_path);

    if body.all == Some(true) {
        run_git_stdout_trimmed(&cwd, &["reset", "HEAD"])?;
    } else {
        let mut files: Vec<String> = Vec::new();
        if let Some(ref f) = body.file {
            files.push(f.clone());
        }
        if let Some(ref fs) = body.files {
            for f in fs {
                if !files.contains(f) {
                    files.push(f.clone());
                }
            }
        }
        if files.is_empty() {
            // Default: unstage all
            run_git_stdout_trimmed(&cwd, &["reset", "HEAD"])?;
        } else {
            let mut args: Vec<String> = vec!["reset".to_string(), "HEAD".to_string(), "--".to_string()];
            args.extend(files);
            run_git_str(&cwd, &args)?;
        }
    }

    Ok(Json(serde_json::json!({ "ok": true })))
}

// ── POST /api/git/commit ────────────────────────────────────────────────────

/// POST /api/git/commit?repoPath=...
/// Body: { message: "commit message" }
async fn git_commit(
    State(state): State<AppState>,
    Query(query): Query<GitQuery>,
    Json(body): Json<CommitBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let cwd = resolve_repo(&state, query.repo_path);

    let message = body.message.as_deref().unwrap_or("");
    if message.is_empty() {
        return Err(ApiError::BadRequest("message is required".to_string()));
    }

    let output = run_git_stdout_trimmed(&cwd, &["commit", "-m", message])?;

    // Extract commit hash from output like "[main 1a2b3c4] message"
    let commit_hash = output.split_whitespace()
        .nth(1)
        .map(|s| s.trim_end_matches(']').to_string())
        .unwrap_or_default();

    Ok(Json(serde_json::json!({ "ok": true, "commitHash": commit_hash })))
}

// ── POST /api/git/commit-message ────────────────────────────────────────────

/// POST /api/git/commit-message?repoPath=...
/// Body: { diff: "..." } — stub that generates a message
async fn git_commit_message(
    State(_state): State<AppState>,
    Query(_query): Query<GitQuery>,
    Json(body): Json<CommitMessageBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let diff = body.diff.unwrap_or_default();
    let files = diff.lines().filter(|l| l.starts_with("diff --git")).count();
    let added = diff.lines().filter(|l| l.starts_with('+') && !l.starts_with("+++")).count();
    let removed = diff.lines().filter(|l| l.starts_with('-') && !l.starts_with("---")).count();
    let message = if files == 0 {
        "chore: update project files".to_string()
    } else if files == 1 {
        format!("Update {} file ({} lines)", files, added + removed)
    } else {
        format!("Update {} files (+{}, -{} lines)", files, added, removed)
    };
    Ok(Json(serde_json::json!({
        "message": message,
        "ok": true,
    })))
}

// ── POST /api/git/checkout ──────────────────────────────────────────────────

/// POST /api/git/checkout?repoPath=...
/// Body: { branch: "name", target: "name", branchName: "name", create: false, startPoint: null }
async fn git_checkout(
    State(state): State<AppState>,
    Query(query): Query<GitQuery>,
    Json(body): Json<CheckoutBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let cwd = resolve_repo(&state, query.repo_path);

    let branch = body.branch.or(body.target).or(body.branch_name);
    let branch = branch.as_deref().unwrap_or("");
    if branch.is_empty() {
        return Err(ApiError::BadRequest("branch or target is required".to_string()));
    }

    let create = body.create.unwrap_or(false);

    if create {
        let mut args: Vec<String> = vec!["checkout".to_string(), "-b".to_string(), branch.to_string()];
        if let Some(ref sp) = body.start_point {
            args.push(sp.clone());
        }
        run_git_str(&cwd, &args)?;
    } else {
        run_git_stdout_trimmed(&cwd, &["checkout", branch])?;
    }

    Ok(Json(serde_json::json!({ "ok": true, "branch": branch })))
}

#[derive(Deserialize)]
struct GitQuery {
    #[serde(rename = "repoPath")]
    repo_path: Option<String>,
}

#[derive(Deserialize)]
struct DiffQuery {
    #[serde(rename = "repoPath")]
    repo_path: Option<String>,
    staged: Option<String>,
    path: Option<String>,
}

#[derive(Deserialize)]
struct LogQuery {
    #[serde(rename = "repoPath")]
    repo_path: Option<String>,
    #[serde(rename = "maxCount")]
    max_count: Option<u32>,
}

#[derive(Deserialize)]
struct GraphQuery {
    #[serde(rename = "repoPath")]
    repo_path: Option<String>,
    #[serde(rename = "maxCount")]
    max_count: Option<u32>,
}

#[derive(Deserialize)]
struct StageBody {
    files: Option<Vec<String>>,
    file: Option<String>,
    all: Option<bool>,
}

#[derive(Deserialize)]
struct CommitBody {
    message: Option<String>,
}

#[derive(Deserialize)]
struct CommitMessageBody {
    diff: Option<String>,
}

#[derive(Deserialize)]
struct CheckoutBody {
    branch: Option<String>,
    target: Option<String>,
    #[serde(rename = "branchName")]
    branch_name: Option<String>,
    create: Option<bool>,
    #[serde(rename = "startPoint")]
    start_point: Option<String>,
}

#[derive(Deserialize)]
struct PullBody {
    branch: Option<String>,
}

#[derive(Deserialize)]
struct PushBody {
    branch: Option<String>,
    force: Option<bool>,
    #[serde(rename = "setUpstream")]
    set_upstream: Option<bool>,
}

#[derive(Deserialize)]
struct StashBody {
    message: Option<String>,
}

#[derive(Deserialize)]
struct StashRefBody {
    #[serde(rename = "ref")]
    stash_ref: Option<String>,
    index: Option<u32>,
}

#[derive(Deserialize)]
struct MergeDryRunBody {
    source: Option<String>,
    #[serde(rename = "sourceRef")]
    source_ref: Option<String>,
    target: Option<String>,
    #[serde(rename = "targetRef")]
    target_ref: Option<String>,
}

#[derive(Deserialize)]
struct MergeLocalBody {
    source: Option<String>,
    #[serde(rename = "sourceRef")]
    source_ref: Option<String>,
    target: Option<String>,
    #[serde(rename = "targetRef")]
    target_ref: Option<String>,
}

#[derive(Deserialize)]
struct AuthLoginBody {
    token: Option<String>,
}

#[derive(Deserialize)]
struct PullRequestBody {
    title: Option<String>,
    body: Option<String>,
    head: Option<String>,
    #[serde(rename = "base")]
    base_field: Option<String>,
}

// ── Helper ──────────────────────────────────────────────────────────────────

fn resolve_repo(state: &AppState, repo_path: Option<String>) -> String {
    repo_path.unwrap_or_else(|| state.config.engine_root.to_string_lossy().to_string())
}

fn run_git(cwd: &str, args: &[&str]) -> Result<std::process::Output, ApiError> {
    Command::new("git")
        .args(["-C", cwd])
        .args(args)
        .output()
        .map_err(|e| ApiError::Internal(e.into()))
}

fn run_git_stdout(cwd: &str, args: &[&str]) -> Result<String, ApiError> {
    let output = run_git(cwd, args)?;
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn run_git_stdout_trimmed(cwd: &str, args: &[&str]) -> Result<String, ApiError> {
    run_git_stdout(cwd, args).map(|s| s.trim().to_string())
}

// ── Existing: GET /api/git/status ────────────────────────────────────────────

/// GET /api/git/status?repoPath=... — git status --porcelain=v1
async fn git_status(
    State(state): State<AppState>,
    Query(query): Query<GitQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let cwd = resolve_repo(&state, query.repo_path);
    let output = run_git(&cwd, &["status", "--porcelain=v1", "--branch"])?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let files: Vec<String> = stdout.lines().filter(|l| !l.starts_with("## ")).map(|l| l.to_string()).collect();
    let branch_line = stdout.lines().find(|l| l.starts_with("## ")).unwrap_or("## No branch");

    Ok(Json(serde_json::json!({
        "branch": branch_line.strip_prefix("## ").unwrap_or(branch_line),
        "files": files,
        "changedCount": files.len(),
    })))
}

// ── Existing: GET /api/git/branches ──────────────────────────────────────────

/// GET /api/git/branches?repoPath=... — list branches
async fn git_branches(
    State(state): State<AppState>,
    Query(query): Query<GitQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let cwd = resolve_repo(&state, query.repo_path);

    // Current branch
    let current = Command::new("git")
        .args(["-C", &cwd, "branch", "--show-current"])
        .output().ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string());

    // All local branches
    let local = Command::new("git")
        .args(["-C", &cwd, "branch", "--format=%(refname:short)"])
        .output().ok()
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .lines().map(|l| l.trim().to_string())
                .filter(|l| !l.is_empty())
                .collect::<Vec<_>>()
        }).unwrap_or_default();

    Ok(Json(serde_json::json!({
        "current": current,
        "branches": local,
    })))
}

// ── Helper: run git with string args ─────────────────────────────────────────

fn run_git_str(cwd: &str, args: &[String]) -> Result<String, ApiError> {
    let output = Command::new("git")
        .arg("-C")
        .arg(cwd)
        .args(args)
        .output()
        .map_err(|e| ApiError::Internal(e.into()))?;
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn run_git_str_trimmed(cwd: &str, args: &[String]) -> Result<String, ApiError> {
    run_git_str(cwd, args).map(|s| s.trim().to_string())
}

// ── GH CLI Helpers ───────────────────────────────────────────────────────────

fn check_gh_auth(repo_path: &str) -> bool {
    Command::new("gh")
        .args(["auth", "status"])
        .current_dir(repo_path)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn get_remote_url(repo_path: &str) -> Option<String> {
    Command::new("git")
        .args(["-C", repo_path, "remote", "get-url", "origin"])
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
            } else {
                None
            }
        })
}

fn resolve_pull_request(repo_path: &str) -> serde_json::Value {
    let gh_available = Command::new("gh").arg("--version").output().is_ok();
    if !gh_available {
        return serde_json::json!({
            "available": false, "tool": null,
            "authenticated": false, "pullRequest": null,
            "error": "GitHub CLI is unavailable."
        });
    }
    let authed = check_gh_auth(repo_path);
    let pr = if authed {
        Command::new("gh")
            .args(["pr", "view", "--json", "number,url,state"])
            .current_dir(repo_path)
            .output()
            .ok()
            .and_then(|o| {
                if o.status.success() {
                    serde_json::from_str::<serde_json::Value>(&String::from_utf8_lossy(&o.stdout)).ok()
                } else {
                    None
                }
            })
    } else {
        None
    };
    serde_json::json!({
        "available": true, "tool": "gh",
        "authenticated": authed,
        "pullRequest": pr,
        "error": null
    })
}

// ── GET /api/git/diff ────────────────────────────────────────────────────────

/// GET /api/git/diff?repoPath=...&staged=false&path=...
/// Returns diff output and file stats.
async fn git_diff(
    State(state): State<AppState>,
    Query(query): Query<DiffQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let cwd = resolve_repo(&state, query.repo_path);
    let is_staged = query.staged.as_deref() == Some("true");

    // Build diff args
    let mut diff_args: Vec<String> = Vec::new();
    diff_args.push("diff".to_string());
    if is_staged {
        diff_args.push("--cached".to_string());
    }
    diff_args.push("--unified=3".to_string());
    if let Some(ref p) = query.path {
        if !p.is_empty() {
            diff_args.push("--".to_string());
            diff_args.push(p.clone());
        }
    }

    let diff_str = run_git_str_trimmed(&cwd, &diff_args).unwrap_or_default();

    // Build stat args
    let mut stat_args: Vec<String> = Vec::new();
    stat_args.push("diff".to_string());
    if is_staged {
        stat_args.push("--cached".to_string());
    }
    stat_args.push("--stat".to_string());
    if let Some(ref p) = query.path {
        if !p.is_empty() {
            stat_args.push("--".to_string());
            stat_args.push(p.clone());
        }
    }

    let stat_output = run_git_str(&cwd, &stat_args).unwrap_or_default();

    // Parse stat output lines like: "file.ts | 10 +++++-----"
    let files: Vec<serde_json::Value> = stat_output.lines()
        .filter(|l| l.contains('|'))
        .filter_map(|l| {
            let parts: Vec<&str> = l.split('|').collect();
            if parts.len() < 2 { return None; }
            let path = parts[0].trim();
            let stat_part = parts[1].trim();
            let added = stat_part.matches('+').count() as u64;
            let deleted = stat_part.matches('-').count() as u64;
            Some(serde_json::json!({ "path": path, "added": added, "deleted": deleted }))
        })
        .collect();

    Ok(Json(serde_json::json!({
        "diff": diff_str,
        "files": files,
        "staged": is_staged,
    })))
}

// ── GET /api/git/log ─────────────────────────────────────────────────────────

/// GET /api/git/log?repoPath=...&maxCount=50
/// Returns commit log with details.
async fn git_log(
    State(state): State<AppState>,
    Query(query): Query<LogQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let cwd = resolve_repo(&state, query.repo_path);
    let max_count = query.max_count.unwrap_or(50);

    // Detailed format: hash|author|email|date|subject
    let detail_output = run_git_stdout_trimmed(&cwd, &[
        "log",
        &format!("--max-count={}", max_count),
        "--format=%H|%an|%ae|%ai|%s",
    ])?;

    let mut commits: Vec<serde_json::Value> = Vec::new();
    for line in detail_output.lines().filter(|l| !l.is_empty()) {
        let parts: Vec<&str> = line.splitn(5, '|').collect();
        if parts.len() >= 5 {
            commits.push(serde_json::json!({
                "hash": parts[0],
                "author": parts[1],
                "email": parts[2],
                "date": parts[3],
                "subject": parts[4],
            }));
        }
    }

    Ok(Json(serde_json::json!({
        "commits": commits,
        "totalCount": commits.len(),
    })))
}

// ── GET /api/git/graph ───────────────────────────────────────────────────────

/// GET /api/git/graph?repoPath=...&maxCount=50
/// Returns git log --oneline --graph output as a string.
async fn git_graph(
    State(state): State<AppState>,
    Query(query): Query<GraphQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let cwd = resolve_repo(&state, query.repo_path);
    let max_count = query.max_count.unwrap_or(50);
    let graph_output = run_git_stdout_trimmed(&cwd, &[
        "log",
        "--oneline",
        "--graph",
        "--all",
        &format!("--max-count={}", max_count),
    ])?;

    Ok(Json(serde_json::json!({
        "graph": graph_output,
    })))
}

// ── GET /api/git/summary ─────────────────────────────────────────────────────

/// GET /api/git/summary?repoPath=...
/// Returns repository summary statistics.
async fn git_summary(
    State(state): State<AppState>,
    Query(query): Query<GitQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let cwd = resolve_repo(&state, query.repo_path);

    // Current SHA (short)
    let current_sha = run_git_stdout_trimmed(&cwd, &["rev-parse", "--short", "HEAD"])
        .unwrap_or_else(|_| "unknown".to_string());

    // Total commit count
    let total_commits = run_git_stdout_trimmed(&cwd, &["rev-list", "--count", "HEAD"])
        .unwrap_or_else(|_| "0".to_string());

    // Branch count
    let branch_output = run_git_stdout(&cwd, &["branch", "--list"]).unwrap_or_default();
    let branch_count = branch_output.lines().filter(|l| !l.is_empty()).count();

    // Ahead count: commits in current branch not in main
    let merge_base = run_git_stdout_trimmed(&cwd, &["merge-base", "HEAD", "main"]).ok();
    let ahead_count = if merge_base.is_some() {
        run_git_stdout_trimmed(&cwd, &["rev-list", "--count", "HEAD", "^main"])
            .unwrap_or_else(|_| "0".to_string())
    } else {
        // Fallback if main doesn't exist or merge-base fails
        run_git_stdout_trimmed(&cwd, &["rev-list", "--count", "HEAD", "^HEAD~1"])
            .unwrap_or_else(|_| "0".to_string())
    };

    // Behind count: commits in main not in current
    let behind_count = if let Some(base) = &merge_base {
        run_git_stdout_trimmed(&cwd, &["rev-list", "--count", &format!("{}..HEAD", base)])
            .unwrap_or_else(|_| "0".to_string())
    } else {
        "0".to_string()
    };

    Ok(Json(serde_json::json!({
        "currentSha": current_sha,
        "totalCommits": total_commits,
        "branchCount": branch_count,
        "aheadCount": ahead_count,
        "behindCount": behind_count,
    })))
}
