use std::fs;
use std::sync::Arc;
use std::thread;

use elegy_native_contracts::types::orchestrator::{
    AdapterId, DispatchRequest, ExecutionIdentity, WorkerStatus,
};

use super::*;

fn node() -> PathBuf {
    CommandPath::resolve(Path::new("node")).expect("node is required by repository tests")
}

fn request(adapter_id: AdapterId, cwd: &Path, prompt: &str) -> DispatchRequest {
    DispatchRequest {
        schema_version: "orchestrator-dispatch/v1".into(),
        kind: "dispatch-request".into(),
        identity: ExecutionIdentity {
            repo_id: "repo-1".into(),
            goal_id: "goal-1".into(),
            roadmap_id: "roadmap-1".into(),
            work_point_id: "work-1".into(),
            run_id: "run-1".into(),
        },
        adapter_id,
        fencing_token: 1,
        idempotency_key: "dispatch-1".into(),
        worktree_path: cwd.to_string_lossy().into_owned(),
        file_scopes: vec!["**".into()],
        prompt: Some(prompt.into()),
        resume_session_id: None,
    }
}

fn write_fixture(root: &Path, name: &str, body: &str) {
    fs::write(root.join(name), body).expect("fixture");
}

#[test]
fn registry_reports_unavailable_adapter_before_dispatch() {
    let missing = CodexExecAdapter::new(
        PathBuf::from("definitely-missing-orchestrator-worker"),
        "model",
        Duration::from_secs(1),
    );
    let registry = WorkerRegistry::new(vec![Box::new(missing)]);
    let root = tempfile::tempdir().expect("root");
    let error = registry
        .dispatch(
            &request(AdapterId::CodexExec, root.path(), "run"),
            &CancellationToken::default(),
        )
        .expect_err("unavailable");
    assert!(matches!(error, WorkerError::AdapterUnavailable(_)));
}

#[test]
fn codex_dispatch_and_resume_preserve_logical_session() {
    let root = tempfile::tempdir().expect("root");
    write_fixture(
        root.path(),
        "exec",
        include_str!("../../../tests/fixtures/worker-adapters/fake-codex.js"),
    );
    let adapter = CodexExecAdapter::new(node(), "model", Duration::from_secs(2));
    let first = adapter
        .dispatch(
            &request(AdapterId::CodexExec, root.path(), "first"),
            &CancellationToken::default(),
        )
        .expect("first");
    assert_eq!(first.status, WorkerStatus::Completed);
    assert_eq!(first.logical_session_id.as_deref(), Some("thread-1"));

    let mut resumed = request(AdapterId::CodexExec, root.path(), "second");
    resumed.resume_session_id = first.logical_session_id;
    let second = adapter
        .dispatch(&resumed, &CancellationToken::default())
        .expect("resume");
    assert_eq!(second.status, WorkerStatus::Completed);
    assert_eq!(second.logical_session_id.as_deref(), Some("thread-1"));
    assert_eq!(second.summary.as_deref(), Some("resumed"));
}

#[test]
fn codex_malformed_output_fails_closed() {
    let root = tempfile::tempdir().expect("root");
    write_fixture(root.path(), "exec", "console.log('not-json')\n");
    let adapter = CodexExecAdapter::new(node(), "model", Duration::from_secs(2));
    assert!(matches!(
        adapter.dispatch(
            &request(AdapterId::CodexExec, root.path(), "run"),
            &CancellationToken::default()
        ),
        Err(WorkerError::MalformedOutput(_))
    ));
}

#[test]
fn codex_oversized_output_is_classified_as_malformed() {
    let root = tempfile::tempdir().expect("root");
    write_fixture(
        root.path(),
        "exec",
        "process.stdout.write('x'.repeat(1100000))\nsetTimeout(() => {}, 10000)\n",
    );
    let adapter = CodexExecAdapter::new(node(), "model", Duration::from_secs(2));
    let result = adapter
        .dispatch(
            &request(AdapterId::CodexExec, root.path(), "oversized"),
            &CancellationToken::default(),
        )
        .expect("result");
    assert_eq!(result.status, WorkerStatus::Malformed);
    assert!(result.observed_output_bytes > MAX_WORKER_OUTPUT_BYTES);
}

#[test]
fn subprocess_timeout_and_cancellation_are_distinct() {
    let root = tempfile::tempdir().expect("root");
    write_fixture(
        root.path(),
        "exec",
        r#"
const {spawn} = require('child_process')
spawn(process.execPath, ['-e', "setTimeout(() => require('fs').writeFileSync('orphan.txt', 'alive'), 500)"], {stdio:'ignore'})
setTimeout(() => {}, 10000)
"#,
    );
    let timeout_adapter = CodexExecAdapter::new(node(), "model", Duration::from_millis(50));
    let timed_out = timeout_adapter
        .dispatch(
            &request(AdapterId::CodexExec, root.path(), "timeout"),
            &CancellationToken::default(),
        )
        .expect("timeout result");
    assert_eq!(timed_out.status, WorkerStatus::TimedOut);

    let adapter = Arc::new(CodexExecAdapter::new(
        node(),
        "model",
        Duration::from_secs(10),
    ));
    let cancellation = CancellationToken::default();
    let worker_cancellation = cancellation.clone();
    let worker_adapter = Arc::clone(&adapter);
    let worker_request = request(AdapterId::CodexExec, root.path(), "cancel");
    let handle =
        thread::spawn(move || worker_adapter.dispatch(&worker_request, &worker_cancellation));
    thread::sleep(Duration::from_millis(100));
    cancellation.cancel();
    let cancelled = handle.join().expect("worker").expect("cancelled result");
    assert_eq!(cancelled.status, WorkerStatus::Cancelled);
    thread::sleep(Duration::from_millis(700));
    assert!(!root.path().join("orphan.txt").exists());
}

#[test]
fn opencode_dispatch_parses_acp_and_resume_session() {
    let root = tempfile::tempdir().expect("root");
    write_fixture(
        root.path(),
        "acp",
        include_str!("../../../tests/fixtures/worker-adapters/fake-opencode-acp.js"),
    );
    let adapter = OpenCodeAcpAdapter::new(node(), Duration::from_secs(2));
    let first = adapter
        .dispatch(
            &request(AdapterId::OpencodeAcp, root.path(), "first"),
            &CancellationToken::default(),
        )
        .expect("first");
    assert_eq!(first.logical_session_id.as_deref(), Some("session-1"));
    let mut resumed = request(AdapterId::OpencodeAcp, root.path(), "resume");
    resumed.resume_session_id = first.logical_session_id;
    let second = adapter
        .dispatch(&resumed, &CancellationToken::default())
        .expect("resume");
    assert_eq!(second.logical_session_id.as_deref(), Some("session-1"));
}

#[test]
fn opencode_malformed_output_and_timeout_fail_closed() {
    let malformed_root = tempfile::tempdir().expect("root");
    write_fixture(
        malformed_root.path(),
        "acp",
        "process.stdin.once('data', () => console.log('not-json'))\n",
    );
    let malformed = OpenCodeAcpAdapter::new(node(), Duration::from_secs(2));
    assert!(matches!(
        malformed.dispatch(
            &request(AdapterId::OpencodeAcp, malformed_root.path(), "malformed"),
            &CancellationToken::default()
        ),
        Err(WorkerError::MalformedOutput(_))
    ));

    let timeout_root = tempfile::tempdir().expect("root");
    write_fixture(timeout_root.path(), "acp", "setTimeout(() => {}, 10000)\n");
    let timeout = OpenCodeAcpAdapter::new(node(), Duration::from_millis(50));
    assert_eq!(
        timeout
            .dispatch(
                &request(AdapterId::OpencodeAcp, timeout_root.path(), "timeout"),
                &CancellationToken::default()
            )
            .expect("timeout result")
            .status,
        WorkerStatus::TimedOut
    );
}

#[test]
fn opencode_cancellation_terminates_the_session_process() {
    let root = tempfile::tempdir().expect("root");
    write_fixture(
        root.path(),
        "acp",
        r#"
const readline = require('readline')
const rl = readline.createInterface({input: process.stdin})
rl.on('line', line => {
  const request = JSON.parse(line)
  if (request.id === 1) console.log(JSON.stringify({jsonrpc:'2.0', id:1, result:{protocolVersion:1}}))
  if (request.id === 2) {
    require('fs').writeFileSync('session-ready.txt', 'yes')
    console.log(JSON.stringify({jsonrpc:'2.0', id:2, result:{sessionId:'session-cancel'}}))
  }
  if (request.method === 'session/cancel') require('fs').writeFileSync('cancel-seen.txt', 'yes')
})
setTimeout(() => {}, 10000)
"#,
    );
    let adapter = Arc::new(OpenCodeAcpAdapter::new(node(), Duration::from_secs(10)));
    let cancellation = CancellationToken::default();
    let worker_cancellation = cancellation.clone();
    let worker_adapter = Arc::clone(&adapter);
    let worker_request = request(AdapterId::OpencodeAcp, root.path(), "cancel");
    let handle =
        thread::spawn(move || worker_adapter.dispatch(&worker_request, &worker_cancellation));
    for _ in 0..100 {
        if root.path().join("session-ready.txt").exists() {
            break;
        }
        thread::sleep(Duration::from_millis(10));
    }
    assert!(root.path().join("session-ready.txt").exists());
    cancellation.cancel();
    assert_eq!(
        handle
            .join()
            .expect("worker")
            .expect("cancelled result")
            .status,
        WorkerStatus::Cancelled
    );
    assert_eq!(
        fs::read_to_string(root.path().join("cancel-seen.txt")).expect("semantic cancel"),
        "yes"
    );
}

#[test]
fn native_adapter_is_deterministic_and_honors_precancel() {
    let adapter = NativeAdapter;
    let root = tempfile::tempdir().expect("root");
    let request = request(AdapterId::Native, root.path(), "native");
    let first = adapter
        .dispatch(&request, &CancellationToken::default())
        .expect("first");
    let second = adapter
        .dispatch(&request, &CancellationToken::default())
        .expect("second");
    assert_eq!(first.status, WorkerStatus::Completed);
    assert_eq!(first, second);
    let cancellation = CancellationToken::default();
    cancellation.cancel();
    assert_eq!(
        adapter
            .dispatch(&request, &cancellation)
            .expect("cancelled")
            .status,
        WorkerStatus::Cancelled
    );
}
