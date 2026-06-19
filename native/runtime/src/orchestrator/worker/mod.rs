mod supervisor;

use std::collections::BTreeMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc};
use std::thread;
use std::time::{Duration, Instant};

use elegy_native_contracts::types::orchestrator::{
    AdapterCapabilities, AdapterId, DispatchRequest, EvidenceClaim, EvidenceClaimType,
    WorkerResult, WorkerStatus, MAX_WORKER_OUTPUT_BYTES,
};
use serde_json::Value;
use sha2::{Digest, Sha256};
use thiserror::Error;

use supervisor::{configure_process_group, run_process, terminate_process_tree, SupervisorError};
pub use supervisor::{CancellationToken, ProcessSpec, StopReason};

pub trait WorkerAdapter: Send + Sync {
    fn capabilities(&self) -> AdapterCapabilities;
    fn dispatch(
        &self,
        request: &DispatchRequest,
        cancellation: &CancellationToken,
    ) -> Result<WorkerResult, WorkerError>;
}

pub struct WorkerRegistry {
    adapters: BTreeMap<String, Box<dyn WorkerAdapter>>,
}

impl WorkerRegistry {
    pub fn new(adapters: Vec<Box<dyn WorkerAdapter>>) -> Self {
        let adapters = adapters
            .into_iter()
            .map(|adapter| (adapter_key(&adapter.capabilities().adapter_id), adapter))
            .collect();
        Self { adapters }
    }

    pub fn capabilities(&self) -> Vec<AdapterCapabilities> {
        self.adapters
            .values()
            .map(|adapter| adapter.capabilities())
            .collect()
    }

    pub fn dispatch(
        &self,
        request: &DispatchRequest,
        cancellation: &CancellationToken,
    ) -> Result<WorkerResult, WorkerError> {
        request
            .validate()
            .map_err(|error| WorkerError::InvalidDispatch(format!("{error:?}")))?;
        let adapter = self
            .adapters
            .get(&adapter_key(&request.adapter_id))
            .ok_or_else(|| WorkerError::AdapterNotRegistered(request.adapter_id.clone()))?;
        let capabilities = adapter.capabilities();
        if !capabilities.available {
            return Err(WorkerError::AdapterUnavailable(
                capabilities
                    .unavailable_reason
                    .unwrap_or_else(|| "preflight failed".into()),
            ));
        }
        if request.resume_session_id.is_some() && !capabilities.supports_resume {
            return Err(WorkerError::ResumeUnsupported);
        }
        adapter.dispatch(request, cancellation)
    }
}

pub struct CodexExecAdapter {
    executable: PathBuf,
    model: String,
    timeout: Duration,
}

impl CodexExecAdapter {
    pub fn new(executable: PathBuf, model: impl Into<String>, timeout: Duration) -> Self {
        Self {
            executable,
            model: model.into(),
            timeout,
        }
    }

    fn available(&self) -> bool {
        executable_available(&self.executable)
    }
}

impl WorkerAdapter for CodexExecAdapter {
    fn capabilities(&self) -> AdapterCapabilities {
        capabilities(
            AdapterId::CodexExec,
            self.available(),
            true,
            true,
            true,
            (!self.available()).then(|| format!("{} is unavailable", self.executable.display())),
        )
    }

    fn dispatch(
        &self,
        request: &DispatchRequest,
        cancellation: &CancellationToken,
    ) -> Result<WorkerResult, WorkerError> {
        let prompt = request
            .prompt
            .as_deref()
            .ok_or(WorkerError::MissingPrompt)?;
        let mut args = vec!["exec".into()];
        if let Some(session) = &request.resume_session_id {
            args.extend(["resume".into(), session.clone()]);
        }
        args.extend([
            "--json".into(),
            "--sandbox".into(),
            "workspace-write".into(),
            "--model".into(),
            self.model.clone(),
            "-C".into(),
            request.worktree_path.clone(),
            prompt.into(),
        ]);
        let output = run_process(
            &ProcessSpec {
                program: self.executable.clone(),
                args,
                cwd: PathBuf::from(&request.worktree_path),
                stdin: Vec::new(),
                timeout: self.timeout,
                max_output_bytes: MAX_WORKER_OUTPUT_BYTES,
            },
            cancellation,
        )?;
        let status = status_from_stop(output.stop_reason, output.status.success());
        if status != WorkerStatus::Completed {
            return Ok(result(
                request,
                status,
                None,
                text_summary(&output.stderr),
                output.observed_output_bytes,
            ));
        }
        let mut thread_id = request.resume_session_id.clone();
        let mut summary = None;
        for line in String::from_utf8(output.stdout)?.lines() {
            let event: Value = serde_json::from_str(line)
                .map_err(|_| WorkerError::MalformedOutput(line.into()))?;
            let event_type = event
                .get("type")
                .and_then(Value::as_str)
                .ok_or_else(|| WorkerError::MalformedOutput(line.into()))?;
            match event_type {
                "thread.started" => {
                    thread_id = event
                        .get("thread_id")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                        .or(thread_id);
                }
                "turn.completed" => {
                    summary = event
                        .get("message")
                        .or_else(|| event.get("result"))
                        .and_then(Value::as_str)
                        .map(str::to_string);
                }
                "turn.failed" | "error" => {
                    return Ok(result(
                        request,
                        WorkerStatus::Failed,
                        thread_id,
                        event
                            .get("message")
                            .and_then(Value::as_str)
                            .map(str::to_string),
                        output.observed_output_bytes,
                    ));
                }
                "turn.started" | "item.started" | "item.completed" => {}
                _ => return Err(WorkerError::MalformedOutput(line.into())),
            }
        }
        let logical_session_id = thread_id.ok_or(WorkerError::MissingSessionId)?;
        Ok(result(
            request,
            WorkerStatus::Completed,
            Some(logical_session_id),
            summary,
            output.observed_output_bytes,
        ))
    }
}

pub struct OpenCodeAcpAdapter {
    executable: PathBuf,
    timeout: Duration,
}

impl OpenCodeAcpAdapter {
    pub fn new(executable: PathBuf, timeout: Duration) -> Self {
        Self {
            executable,
            timeout,
        }
    }
}

impl WorkerAdapter for OpenCodeAcpAdapter {
    fn capabilities(&self) -> AdapterCapabilities {
        let available = executable_available(&self.executable);
        capabilities(
            AdapterId::OpencodeAcp,
            available,
            true,
            true,
            false,
            (!available).then(|| format!("{} is unavailable", self.executable.display())),
        )
    }

    fn dispatch(
        &self,
        request: &DispatchRequest,
        cancellation: &CancellationToken,
    ) -> Result<WorkerResult, WorkerError> {
        let prompt = request
            .prompt
            .as_deref()
            .ok_or(WorkerError::MissingPrompt)?;
        match run_acp_turn(
            &self.executable,
            request,
            prompt,
            self.timeout,
            cancellation,
        ) {
            Ok(turn) => Ok(result(
                request,
                WorkerStatus::Completed,
                Some(turn.session_id),
                turn.summary,
                turn.observed_output_bytes,
            )),
            Err(WorkerError::Cancelled) => Ok(result(
                request,
                WorkerStatus::Cancelled,
                request.resume_session_id.clone(),
                None,
                0,
            )),
            Err(WorkerError::TimedOut) => Ok(result(
                request,
                WorkerStatus::TimedOut,
                request.resume_session_id.clone(),
                None,
                0,
            )),
            Err(error) => Err(error),
        }
    }
}

struct AcpTurn {
    session_id: String,
    summary: Option<String>,
    observed_output_bytes: u64,
}

fn run_acp_turn(
    executable: &Path,
    request: &DispatchRequest,
    prompt: &str,
    timeout: Duration,
    cancellation: &CancellationToken,
) -> Result<AcpTurn, WorkerError> {
    let mut command = Command::new(executable);
    command
        .args(["acp", "--cwd", &request.worktree_path])
        .current_dir(&request.worktree_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_process_group(&mut command);
    let mut child = command.spawn().map_err(|source| SupervisorError::Spawn {
        program: executable.to_path_buf(),
        source,
    })?;
    let mut stdin = child.stdin.take().expect("piped stdin");
    let stdout = child.stdout.take().expect("piped stdout");
    let mut stderr = child.stderr.take().expect("piped stderr");
    let (sender, receiver) = mpsc::channel();
    let observed = Arc::new(AtomicU64::new(0));
    let stdout_observed = Arc::clone(&observed);
    let stdout_reader = thread::spawn(move || {
        for line in BufReader::new(stdout).split(b'\n') {
            let line = line?;
            stdout_observed.fetch_add(line.len() as u64 + 1, Ordering::SeqCst);
            if sender.send(line).is_err() {
                break;
            }
        }
        Ok::<(), std::io::Error>(())
    });
    let stderr_observed = Arc::clone(&observed);
    let stderr_reader = thread::spawn(move || {
        let mut buffer = [0u8; 8192];
        loop {
            let read = stderr.read(&mut buffer)?;
            if read == 0 {
                return Ok::<(), std::io::Error>(());
            }
            stderr_observed.fetch_add(read as u64, Ordering::SeqCst);
        }
    });
    let deadline = Instant::now() + timeout;
    let outcome = (|| {
        send_rpc(
            &mut stdin,
            &rpc(
                1,
                "initialize",
                serde_json::json!({
                    "protocolVersion": 1,
                    "clientCapabilities": {}
                }),
            ),
        )?;
        let initialized = wait_acp_response(
            &receiver,
            &mut stdin,
            1,
            deadline,
            cancellation,
            child.id(),
            None,
            &observed,
        )?;
        if initialized["result"]["protocolVersion"].as_u64() != Some(1) {
            return Err(WorkerError::ProtocolVersionMismatch);
        }
        let (session_method, session_params) = match &request.resume_session_id {
            Some(session_id) => (
                "session/resume",
                serde_json::json!({
                    "sessionId": session_id,
                    "cwd": request.worktree_path
                }),
            ),
            None => (
                "session/new",
                serde_json::json!({
                    "cwd": request.worktree_path,
                    "mcpServers": []
                }),
            ),
        };
        send_rpc(&mut stdin, &rpc(2, session_method, session_params))?;
        let session = wait_acp_response(
            &receiver,
            &mut stdin,
            2,
            deadline,
            cancellation,
            child.id(),
            request.resume_session_id.as_deref(),
            &observed,
        )?;
        let session_id = session["result"]["sessionId"]
            .as_str()
            .map(str::to_string)
            .or_else(|| request.resume_session_id.clone())
            .ok_or(WorkerError::MissingSessionId)?;
        send_rpc(
            &mut stdin,
            &rpc(
                3,
                "session/prompt",
                serde_json::json!({
                    "sessionId": session_id,
                    "prompt": [{ "type": "text", "text": prompt }]
                }),
            ),
        )?;
        let completed = wait_acp_response(
            &receiver,
            &mut stdin,
            3,
            deadline,
            cancellation,
            child.id(),
            Some(&session_id),
            &observed,
        )?;
        Ok(AcpTurn {
            session_id,
            summary: completed["result"]["stopReason"]
                .as_str()
                .map(str::to_string),
            observed_output_bytes: observed.load(Ordering::SeqCst),
        })
    })();
    drop(stdin);
    terminate_process_tree(child.id());
    let _ = child.wait();
    let _ = stdout_reader.join();
    let _ = stderr_reader.join();
    outcome
}

fn send_rpc(stdin: &mut impl Write, value: &Value) -> Result<(), WorkerError> {
    serde_json::to_writer(&mut *stdin, value)?;
    stdin.write_all(b"\n")?;
    stdin.flush()?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn wait_acp_response(
    receiver: &mpsc::Receiver<Vec<u8>>,
    stdin: &mut impl Write,
    response_id: u64,
    deadline: Instant,
    cancellation: &CancellationToken,
    pid: u32,
    session_id: Option<&str>,
    observed: &AtomicU64,
) -> Result<Value, WorkerError> {
    loop {
        if observed.load(Ordering::SeqCst) > MAX_WORKER_OUTPUT_BYTES {
            terminate_process_tree(pid);
            return Err(WorkerError::OutputLimit);
        }
        if cancellation.is_cancelled() {
            if let Some(session_id) = session_id {
                let _ = send_rpc(
                    stdin,
                    &serde_json::json!({
                        "jsonrpc": "2.0",
                        "method": "session/cancel",
                        "params": { "sessionId": session_id }
                    }),
                );
                thread::sleep(Duration::from_millis(100));
            }
            terminate_process_tree(pid);
            return Err(WorkerError::Cancelled);
        }
        if Instant::now() >= deadline {
            terminate_process_tree(pid);
            return Err(WorkerError::TimedOut);
        }
        match receiver.recv_timeout(Duration::from_millis(10)) {
            Ok(line) => {
                let message: Value = serde_json::from_slice(&line).map_err(|_| {
                    WorkerError::MalformedOutput(String::from_utf8_lossy(&line).into())
                })?;
                if message.get("method").and_then(Value::as_str) == Some("session/update") {
                    continue;
                }
                if message.get("method").and_then(Value::as_str)
                    == Some("session/request_permission")
                {
                    reject_permission(stdin, &message)?;
                    continue;
                }
                if message.get("id").and_then(Value::as_u64) != Some(response_id)
                    || message.get("result").is_none()
                {
                    return Err(WorkerError::MalformedOutput(
                        String::from_utf8_lossy(&line).into(),
                    ));
                }
                return Ok(message);
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err(WorkerError::IncompleteProtocol)
            }
        }
    }
}

fn reject_permission(stdin: &mut impl Write, message: &Value) -> Result<(), WorkerError> {
    let id = message
        .get("id")
        .cloned()
        .ok_or_else(|| WorkerError::MalformedOutput(message.to_string()))?;
    let options = message["params"]["options"]
        .as_array()
        .ok_or_else(|| WorkerError::MalformedOutput(message.to_string()))?;
    let option_id = options
        .iter()
        .find(|option| {
            option["kind"]
                .as_str()
                .is_some_and(|kind| matches!(kind, "reject_once" | "reject_always"))
        })
        .and_then(|option| option["optionId"].as_str())
        .ok_or(WorkerError::PermissionPolicyUnavailable)?;
    send_rpc(
        stdin,
        &serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": { "outcome": { "outcome": "selected", "optionId": option_id } }
        }),
    )
}

#[derive(Default)]
pub struct NativeAdapter;

impl WorkerAdapter for NativeAdapter {
    fn capabilities(&self) -> AdapterCapabilities {
        capabilities(AdapterId::Native, true, true, false, true, None)
    }

    fn dispatch(
        &self,
        request: &DispatchRequest,
        cancellation: &CancellationToken,
    ) -> Result<WorkerResult, WorkerError> {
        let status = if cancellation.is_cancelled() {
            WorkerStatus::Cancelled
        } else {
            WorkerStatus::Completed
        };
        Ok(result(
            request,
            status,
            None,
            request.prompt.clone(),
            request
                .prompt
                .as_ref()
                .map_or(0, |value| value.len() as u64),
        ))
    }
}

fn executable_available(path: &Path) -> bool {
    if path.components().count() > 1 {
        path.is_file()
    } else {
        CommandPath::resolve(path).is_some()
    }
}

struct CommandPath;

impl CommandPath {
    fn resolve(program: &Path) -> Option<PathBuf> {
        std::env::var_os("PATH").and_then(|path| {
            std::env::split_paths(&path).find_map(|directory| {
                let candidate = directory.join(program);
                if candidate.is_file() {
                    return Some(candidate);
                }
                #[cfg(windows)]
                for extension in ["exe", "cmd", "bat"] {
                    let candidate = directory.join(program).with_extension(extension);
                    if candidate.is_file() {
                        return Some(candidate);
                    }
                }
                None
            })
        })
    }
}

fn capabilities(
    adapter_id: AdapterId,
    available: bool,
    supports_cancellation: bool,
    supports_resume: bool,
    supports_structured_result: bool,
    unavailable_reason: Option<String>,
) -> AdapterCapabilities {
    AdapterCapabilities {
        schema_version: "orchestrator-adapter-capabilities/v1".into(),
        kind: "adapter-capabilities".into(),
        adapter_id,
        available,
        supports_cancellation,
        supports_resume,
        supports_structured_result,
        max_concurrent: 1,
        unavailable_reason,
    }
}

fn result(
    request: &DispatchRequest,
    status: WorkerStatus,
    logical_session_id: Option<String>,
    summary: Option<String>,
    observed_output_bytes: u64,
) -> WorkerResult {
    WorkerResult {
        schema_version: "orchestrator-worker-result/v1".into(),
        kind: "worker-result".into(),
        identity: request.identity.clone(),
        adapter_id: request.adapter_id.clone(),
        status,
        logical_session_id,
        summary,
        observed_output_bytes,
        claims: vec![EvidenceClaim {
            schema_version: "orchestrator-evidence-claim/v1".into(),
            kind: "evidence-claim".into(),
            claim_id: deterministic_claim_id(request),
            claim_type: EvidenceClaimType::WorkerReported,
            source: adapter_key(&request.adapter_id),
            summary: "worker completion claim; requires orchestrator verification".into(),
            command: None,
            exit_code: None,
            duration_ms: None,
        }],
    }
}

fn status_from_stop(reason: StopReason, success: bool) -> WorkerStatus {
    match reason {
        StopReason::Cancelled => WorkerStatus::Cancelled,
        StopReason::TimedOut => WorkerStatus::TimedOut,
        StopReason::OutputLimit => WorkerStatus::Malformed,
        StopReason::Exited if success => WorkerStatus::Completed,
        StopReason::Exited => WorkerStatus::Failed,
    }
}

fn text_summary(bytes: &[u8]) -> Option<String> {
    let text = String::from_utf8_lossy(bytes).trim().to_string();
    (!text.is_empty()).then_some(text)
}

fn adapter_key(id: &AdapterId) -> String {
    match id {
        AdapterId::OpencodeAcp => "opencode-acp",
        AdapterId::CodexExec => "codex-exec",
        AdapterId::Native => "native",
    }
    .into()
}

fn deterministic_claim_id(request: &DispatchRequest) -> String {
    let mut hash = Sha256::new();
    hash.update(request.identity.run_id.as_bytes());
    hash.update(request.idempotency_key.as_bytes());
    hash.update(adapter_key(&request.adapter_id).as_bytes());
    format!("claim-{}", hex::encode(&hash.finalize()[..16]))
}

fn rpc(id: u64, method: &str, params: Value) -> Value {
    serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": method,
        "params": params
    })
}

#[derive(Debug, Error)]
pub enum WorkerError {
    #[error("invalid dispatch: {0}")]
    InvalidDispatch(String),
    #[error("adapter is not registered: {0:?}")]
    AdapterNotRegistered(AdapterId),
    #[error("adapter is unavailable: {0}")]
    AdapterUnavailable(String),
    #[error("adapter does not support resume")]
    ResumeUnsupported,
    #[error("dispatch prompt is required")]
    MissingPrompt,
    #[error("worker output is malformed: {0}")]
    MalformedOutput(String),
    #[error("worker protocol ended before the completion boundary")]
    IncompleteProtocol,
    #[error("worker did not provide a logical session identifier")]
    MissingSessionId,
    #[error("ACP protocol version is incompatible")]
    ProtocolVersionMismatch,
    #[error("no policy-approved permission response was offered")]
    PermissionPolicyUnavailable,
    #[error("worker output exceeded the configured limit")]
    OutputLimit,
    #[error("worker was cancelled")]
    Cancelled,
    #[error("worker timed out")]
    TimedOut,
    #[error(transparent)]
    Supervisor(#[from] SupervisorError),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Utf8(#[from] std::string::FromUtf8Error),
}

#[cfg(test)]
mod tests;
