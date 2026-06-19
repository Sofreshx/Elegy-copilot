mod common;

use std::fs;
use std::path::Path;
use std::process::{Command, Output};

use axum::body::Body;
use axum::http::{Request, StatusCode};
use elegy_native_contracts::types::orchestrator::{ExecutionIdentity, RepositoryState};
use elegy_native_runtime::app::build_router;
use elegy_native_runtime::orchestrator::approval::{
    ApprovalError, ApprovalOperation, ApprovalService,
};
use serde_json::{json, Value};
use tower::util::ServiceExt;

fn git(cwd: &Path, args: &[&str]) -> Output {
    let output = Command::new("git")
        .arg("-C")
        .arg(cwd)
        .args(args)
        .output()
        .expect("git");
    assert!(
        output.status.success(),
        "git {}: {}",
        args.join(" "),
        String::from_utf8_lossy(&output.stderr)
    );
    output
}

fn git_text(cwd: &Path, args: &[&str]) -> String {
    String::from_utf8(git(cwd, args).stdout)
        .expect("utf8")
        .trim()
        .to_string()
}

fn repository() -> tempfile::TempDir {
    let repo = tempfile::tempdir().expect("repo");
    git(repo.path(), &["init"]);
    git(
        repo.path(),
        &["config", "user.email", "orchestrator@example.test"],
    );
    git(repo.path(), &["config", "user.name", "Orchestrator Test"]);
    fs::write(repo.path().join("shared.txt"), "base\n").expect("base");
    git(repo.path(), &["add", "."]);
    git(repo.path(), &["commit", "-m", "base"]);
    repo
}

fn identity() -> ExecutionIdentity {
    ExecutionIdentity {
        repo_id: "repo-1".into(),
        goal_id: "goal-1".into(),
        roadmap_id: "roadmap-1".into(),
        work_point_id: "work-1".into(),
        run_id: "run-1".into(),
    }
}

async fn post(app: axum::Router, path: &str, key: &str, body: Value) -> (StatusCode, Value) {
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(path)
                .header("content-type", "application/json")
                .header("idempotency-key", key)
                .body(Body::from(serde_json::to_vec(&body).expect("body")))
                .expect("request"),
        )
        .await
        .expect("response");
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 1024 * 1024)
        .await
        .expect("bytes");
    (status, serde_json::from_slice(&bytes).expect("json"))
}

async fn get(app: axum::Router, path: &str) -> (StatusCode, Value) {
    let response = app
        .oneshot(
            Request::builder()
                .uri(path)
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 1024 * 1024)
        .await
        .expect("bytes");
    (status, serde_json::from_slice(&bytes).expect("json"))
}

#[tokio::test]
async fn simultaneous_duplicate_commands_create_one_session() {
    let root = tempfile::tempdir().expect("root");
    let app = build_router(common::test_state(root.path()));
    let body = json!({
        "sessionId": "session-concurrent",
        "repoId": "repo-1",
        "adapterId": "native"
    });
    let (first, second) = tokio::join!(
        post(
            app.clone(),
            "/api/orchestrator/sessions",
            "same-command",
            body.clone()
        ),
        post(
            app.clone(),
            "/api/orchestrator/sessions",
            "same-command",
            body
        )
    );
    assert_eq!(first.0, StatusCode::CREATED);
    assert_eq!(first, second);
    let (status, sessions) = get(app, "/api/orchestrator/sessions").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(sessions["sessions"].as_array().expect("sessions").len(), 1);
}

#[tokio::test]
async fn lost_acknowledgement_replays_without_duplicate_side_effect() {
    let root = tempfile::tempdir().expect("root");
    let app = build_router(common::test_state(root.path()));
    let body = json!({
        "sessionId": "session-lost-ack",
        "repoId": "repo-1",
        "adapterId": "native"
    });
    let _discarded = post(
        app.clone(),
        "/api/orchestrator/sessions",
        "lost-ack",
        body.clone(),
    )
    .await;
    let replay = post(app.clone(), "/api/orchestrator/sessions", "lost-ack", body).await;
    assert_eq!(replay.0, StatusCode::CREATED);
    let (_, sessions) = get(app, "/api/orchestrator/sessions").await;
    assert_eq!(sessions["sessions"].as_array().expect("sessions").len(), 1);
}

#[test]
fn approved_merge_conflict_aborts_cleanly_and_cannot_replay() {
    let repo = repository();
    let target_branch = git_text(repo.path(), &["branch", "--show-current"]);
    let base = git_text(repo.path(), &["rev-parse", "HEAD"]);
    git(repo.path(), &["checkout", "-b", "feature"]);
    fs::write(repo.path().join("shared.txt"), "feature\n").expect("feature");
    git(repo.path(), &["add", "."]);
    git(repo.path(), &["commit", "-m", "feature"]);
    let result_tree = git_text(repo.path(), &["rev-parse", "feature^{tree}"]);
    let diff = git(
        repo.path(),
        &["diff", "--binary", "--full-index", &base, "feature"],
    );
    git(repo.path(), &["checkout", &target_branch]);
    fs::write(repo.path().join("shared.txt"), "target\n").expect("target");
    git(repo.path(), &["add", "."]);
    git(repo.path(), &["commit", "-m", "target"]);
    let target_head = git_text(repo.path(), &["rev-parse", "HEAD"]);

    let home = tempfile::tempdir().expect("home");
    let approvals = ApprovalService::new(home.path(), b"secret").expect("service");
    let token = approvals
        .issue(
            ApprovalOperation::Merge,
            identity(),
            RepositoryState {
                base_head_sha: base,
                result_tree_sha: result_tree,
                diff_hash: blake3::hash(&diff.stdout).to_hex().to_string(),
                target_head_sha: target_head.clone(),
            },
            100,
        )
        .expect("approval");
    assert!(matches!(
        approvals.merge_local(&token.token_id, repo.path(), 10, "feature"),
        Err(ApprovalError::MergeConflict(_))
    ));
    assert_eq!(git_text(repo.path(), &["rev-parse", "HEAD"]), target_head);
    assert_eq!(git_text(repo.path(), &["status", "--porcelain"]), "");
    assert!(matches!(
        approvals.merge_local(&token.token_id, repo.path(), 11, "feature"),
        Err(ApprovalError::AlreadyConsumed)
    ));
}
