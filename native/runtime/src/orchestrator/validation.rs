use std::collections::BTreeMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;

const MAX_INLINE_OUTPUT_BYTES: usize = 65_536;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ValidationOutcome {
    Passed,
    Failed,
    TimedOut,
    Cancelled,
    Neutral,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ValidationCommandResult {
    pub lane: String,
    pub command: String,
    pub reason: String,
    pub outcome: ValidationOutcome,
    pub exit_code: Option<i32>,
    pub duration_ms: u64,
    pub output_summary: String,
    pub output_truncated: bool,
    pub output_ref: Option<PathBuf>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AuthoritativeValidationReport {
    pub schema_version: String,
    pub outcome: ValidationOutcome,
    pub authoritative_gate_passed: bool,
    pub worker_claim_count: usize,
    pub selected_lanes: Vec<String>,
    pub results: Vec<ValidationCommandResult>,
}

#[derive(Debug, Clone)]
struct Lane {
    name: String,
    commands: Vec<String>,
    timeout_ms: u64,
    required: bool,
}

#[derive(Debug, Deserialize)]
struct CommitCheckConfig {
    #[serde(default)]
    lanes: BTreeMap<String, Value>,
}

pub struct AuthoritativeValidator {
    repo_root: PathBuf,
    evidence_root: PathBuf,
    lanes: Vec<Lane>,
}

impl AuthoritativeValidator {
    pub fn discover(repo_root: &Path, elegy_home: &Path) -> Result<Self, ValidationError> {
        let config_path = [
            repo_root.join(".copilot").join("commit-checks.json"),
            repo_root.join(".github").join("commit-checks.json"),
        ]
        .into_iter()
        .find(|path| path.is_file());
        let lanes = match config_path {
            Some(path) => parse_lanes(&fs::read(&path)?)?,
            None => Vec::new(),
        };
        Ok(Self {
            repo_root: repo_root.to_path_buf(),
            evidence_root: elegy_home.join("orchestrator").join("evidence"),
            lanes,
        })
    }

    pub fn run(
        &self,
        run_id: &str,
        changed_paths: &[String],
        worker_claims: &[Value],
        cancelled: Arc<AtomicBool>,
    ) -> Result<AuthoritativeValidationReport, ValidationError> {
        let selected = self.select_lanes(changed_paths);
        if selected.is_empty() {
            let report = AuthoritativeValidationReport {
                schema_version: "orchestrator-validation/v1".into(),
                outcome: ValidationOutcome::Neutral,
                authoritative_gate_passed: false,
                worker_claim_count: worker_claims.len(),
                selected_lanes: Vec::new(),
                results: Vec::new(),
            };
            self.persist_report(run_id, &report)?;
            return Ok(report);
        }

        let run_dir = self.evidence_root.join(run_id);
        fs::create_dir_all(&run_dir)?;
        let mut results = Vec::new();
        for lane in &selected {
            for (index, command) in lane.commands.iter().enumerate() {
                let reason = selection_reason(&lane.name, changed_paths);
                results.push(run_command(
                    &self.repo_root,
                    &run_dir,
                    &lane.name,
                    index,
                    command,
                    lane.timeout_ms,
                    reason,
                    Arc::clone(&cancelled),
                )?);
            }
        }

        let required_failed = selected.iter().filter(|lane| lane.required).any(|lane| {
            results.iter().any(|result| {
                result.lane == lane.name && result.outcome != ValidationOutcome::Passed
            })
        });
        let outcome = if results
            .iter()
            .any(|result| result.outcome == ValidationOutcome::Cancelled)
        {
            ValidationOutcome::Cancelled
        } else if results
            .iter()
            .any(|result| result.outcome == ValidationOutcome::TimedOut)
        {
            ValidationOutcome::TimedOut
        } else if required_failed {
            ValidationOutcome::Failed
        } else {
            ValidationOutcome::Passed
        };
        let report = AuthoritativeValidationReport {
            schema_version: "orchestrator-validation/v1".into(),
            authoritative_gate_passed: outcome == ValidationOutcome::Passed,
            outcome,
            worker_claim_count: worker_claims.len(),
            selected_lanes: selected.iter().map(|lane| lane.name.clone()).collect(),
            results,
        };
        self.persist_report(run_id, &report)?;
        Ok(report)
    }

    fn select_lanes(&self, changed_paths: &[String]) -> Vec<Lane> {
        self.lanes
            .iter()
            .filter(|lane| lane_relevant(&lane.name, changed_paths))
            .cloned()
            .collect()
    }

    fn persist_report(
        &self,
        run_id: &str,
        report: &AuthoritativeValidationReport,
    ) -> Result<(), ValidationError> {
        let directory = self.evidence_root.join(run_id);
        fs::create_dir_all(&directory)?;
        let path = directory.join("validation.json");
        let temp = directory.join(format!("validation-{}.tmp", uuid::Uuid::new_v4()));
        let mut bytes = serde_json::to_vec_pretty(report)?;
        bytes.push(b'\n');
        fs::write(&temp, bytes)?;
        fs::rename(temp, path)?;
        Ok(())
    }
}

fn parse_lanes(bytes: &[u8]) -> Result<Vec<Lane>, ValidationError> {
    let config: CommitCheckConfig = serde_json::from_slice(bytes)?;
    let mut lanes = Vec::new();
    for (name, value) in config.lanes {
        if value.get("enabled").and_then(Value::as_bool) == Some(false) {
            continue;
        }
        let commands = value
            .get("commands")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        if commands.is_empty() {
            continue;
        }
        lanes.push(Lane {
            name,
            commands,
            timeout_ms: value
                .get("timeoutMs")
                .and_then(Value::as_u64)
                .unwrap_or(120_000),
            required: value.get("required").and_then(Value::as_bool) != Some(false),
        });
    }
    Ok(lanes)
}

fn lane_relevant(lane: &str, paths: &[String]) -> bool {
    let has_rust = paths
        .iter()
        .any(|path| path.ends_with(".rs") || path.ends_with("Cargo.toml") || path == "Cargo.lock");
    let has_contracts = paths.iter().any(|path| path.starts_with("contracts/"));
    let has_ui = paths.iter().any(|path| path.starts_with("copilot-ui/ui/"));
    let has_tracker = paths.iter().any(|path| path.starts_with("local-tracker/"));
    match lane {
        "test" | "typecheck" => has_rust || has_contracts || has_ui || has_tracker,
        "lint" | "format" => has_rust,
        "build-contracts" => has_contracts,
        "build-ui" | "stylelint" => has_ui,
        "build-tracker" => has_tracker,
        _ => false,
    }
}

fn selection_reason(lane: &str, paths: &[String]) -> String {
    format!(
        "selected `{lane}` from repository commit-check policy for {} changed path(s)",
        paths.len()
    )
}

#[allow(clippy::too_many_arguments)]
fn run_command(
    cwd: &Path,
    run_dir: &Path,
    lane: &str,
    index: usize,
    command: &str,
    timeout_ms: u64,
    reason: String,
    cancelled: Arc<AtomicBool>,
) -> Result<ValidationCommandResult, ValidationError> {
    if cancelled.load(Ordering::SeqCst) {
        return Ok(command_result(
            lane,
            command,
            reason,
            ValidationOutcome::Cancelled,
            None,
            0,
            Vec::new(),
            None,
        )?);
    }
    let started = Instant::now();
    let mut process = shell_command(command);
    configure_process_group(&mut process);
    let mut child = process
        .current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let mut stdout = child.stdout.take().ok_or(ValidationError::MissingPipe)?;
    let mut stderr = child.stderr.take().ok_or(ValidationError::MissingPipe)?;
    let stdout_thread = thread::spawn(move || {
        let mut bytes = Vec::new();
        stdout.read_to_end(&mut bytes).map(|_| bytes)
    });
    let stderr_thread = thread::spawn(move || {
        let mut bytes = Vec::new();
        stderr.read_to_end(&mut bytes).map(|_| bytes)
    });

    let timeout = Duration::from_millis(timeout_ms);
    let outcome;
    let exit_status;
    loop {
        if cancelled.load(Ordering::SeqCst) {
            terminate_process_tree(child.id());
            exit_status = child.wait()?;
            outcome = ValidationOutcome::Cancelled;
            break;
        }
        if started.elapsed() >= timeout {
            terminate_process_tree(child.id());
            exit_status = child.wait()?;
            outcome = ValidationOutcome::TimedOut;
            break;
        }
        if let Some(status) = child.try_wait()? {
            exit_status = status;
            outcome = ValidationOutcome::Passed;
            break;
        }
        thread::sleep(Duration::from_millis(10));
    }
    let mut combined = stdout_thread
        .join()
        .map_err(|_| ValidationError::OutputThread)??;
    let stderr = stderr_thread
        .join()
        .map_err(|_| ValidationError::OutputThread)??;
    if !stderr.is_empty() {
        combined.extend_from_slice(b"\n");
        combined.extend_from_slice(&stderr);
    }
    let outcome = match outcome {
        ValidationOutcome::Passed if exit_status.success() => ValidationOutcome::Passed,
        ValidationOutcome::Passed => ValidationOutcome::Failed,
        other => other,
    };
    let log_path = run_dir.join(format!("{lane}-{index}.log"));
    fs::write(&log_path, &combined)?;
    command_result(
        lane,
        command,
        reason,
        outcome,
        exit_status.code(),
        started.elapsed().as_millis() as u64,
        combined,
        Some(log_path),
    )
}

fn command_result(
    lane: &str,
    command: &str,
    reason: String,
    outcome: ValidationOutcome,
    exit_code: Option<i32>,
    duration_ms: u64,
    output: Vec<u8>,
    output_ref: Option<PathBuf>,
) -> Result<ValidationCommandResult, ValidationError> {
    let truncated = output.len() > MAX_INLINE_OUTPUT_BYTES;
    let start = output.len().saturating_sub(MAX_INLINE_OUTPUT_BYTES);
    let summary = String::from_utf8_lossy(&output[start..]).to_string();
    Ok(ValidationCommandResult {
        lane: lane.to_string(),
        command: command.to_string(),
        reason,
        outcome,
        exit_code,
        duration_ms,
        output_summary: summary,
        output_truncated: truncated,
        output_ref,
    })
}

fn shell_command(command: &str) -> Command {
    if cfg!(windows) {
        let mut process = Command::new("cmd");
        process.args(["/d", "/c", command]);
        process
    } else {
        let mut process = Command::new("sh");
        process.args(["-c", command]);
        process
    }
}

#[cfg(unix)]
fn configure_process_group(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    command.process_group(0);
}

#[cfg(windows)]
fn configure_process_group(_command: &mut Command) {}

#[cfg(unix)]
fn terminate_process_tree(pid: u32) {
    let group = format!("-{pid}");
    let _ = Command::new("kill").args(["-TERM", &group]).status();
    thread::sleep(Duration::from_millis(50));
    let _ = Command::new("kill").args(["-KILL", &group]).status();
}

#[cfg(windows)]
fn terminate_process_tree(pid: u32) {
    let _ = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

#[derive(Debug, Error)]
pub enum ValidationError {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error("validation output thread panicked")]
    OutputThread,
    #[error("validation child pipe was unavailable")]
    MissingPipe,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn validator(lanes: Value) -> (tempfile::TempDir, tempfile::TempDir, AuthoritativeValidator) {
        let repo = tempfile::tempdir().expect("repo");
        let home = tempfile::tempdir().expect("home");
        fs::create_dir_all(repo.path().join(".copilot")).expect("config dir");
        fs::write(
            repo.path().join(".copilot/commit-checks.json"),
            serde_json::to_vec(&serde_json::json!({ "lanes": lanes })).expect("config"),
        )
        .expect("write config");
        let validator =
            AuthoritativeValidator::discover(repo.path(), home.path()).expect("validator");
        (repo, home, validator)
    }

    #[test]
    fn no_applicable_checks_is_neutral_not_success() {
        let (_repo, _home, validator) = validator(serde_json::json!({
            "build-ui": { "commands": ["echo ui"], "required": true }
        }));
        let report = validator
            .run(
                "run-1",
                &["README.md".into()],
                &[],
                Arc::new(AtomicBool::new(false)),
            )
            .expect("report");
        assert_eq!(report.outcome, ValidationOutcome::Neutral);
        assert!(!report.authoritative_gate_passed);
    }

    #[test]
    fn worker_claims_cannot_satisfy_failed_observed_gate() {
        let fail = if cfg!(windows) { "exit /b 7" } else { "exit 7" };
        let (_repo, _home, validator) = validator(serde_json::json!({
            "test": { "commands": [fail], "required": true, "timeoutMs": 1000 }
        }));
        let report = validator
            .run(
                "run-2",
                &["native/runtime/src/lib.rs".into()],
                &[serde_json::json!({"claim": "tests passed"})],
                Arc::new(AtomicBool::new(false)),
            )
            .expect("report");
        assert_eq!(report.outcome, ValidationOutcome::Failed);
        assert_eq!(report.worker_claim_count, 1);
        assert!(!report.authoritative_gate_passed);
    }

    #[test]
    fn cancellation_is_distinct_and_persisted() {
        let (_repo, _home, validator) = validator(serde_json::json!({
            "test": { "commands": ["echo should-not-run"], "required": true }
        }));
        let report = validator
            .run(
                "run-3",
                &["native/runtime/src/lib.rs".into()],
                &[],
                Arc::new(AtomicBool::new(true)),
            )
            .expect("report");
        assert_eq!(report.outcome, ValidationOutcome::Cancelled);
        assert_eq!(report.results[0].outcome, ValidationOutcome::Cancelled);
    }

    #[test]
    fn timeout_is_distinct_from_failure() {
        let command = "node -e \"setTimeout(() => {}, 5000)\"";
        let (_repo, _home, validator) = validator(serde_json::json!({
            "test": { "commands": [command], "required": true, "timeoutMs": 50 }
        }));
        let report = validator
            .run(
                "run-timeout",
                &["native/runtime/src/lib.rs".into()],
                &[],
                Arc::new(AtomicBool::new(false)),
            )
            .expect("report");
        assert_eq!(report.outcome, ValidationOutcome::TimedOut);
        assert_eq!(report.results[0].outcome, ValidationOutcome::TimedOut);
    }

    #[test]
    fn output_is_bounded_but_full_log_is_referenced() {
        let command = if cfg!(windows) {
            "type large-output.txt"
        } else {
            "cat large-output.txt"
        };
        let (repo, _home, validator) = validator(serde_json::json!({
            "test": { "commands": [command], "required": true, "timeoutMs": 5000 }
        }));
        fs::write(repo.path().join("large-output.txt"), vec![b'x'; 70_000])
            .expect("large output fixture");
        let report = validator
            .run(
                "run-4",
                &["native/runtime/src/lib.rs".into()],
                &[],
                Arc::new(AtomicBool::new(false)),
            )
            .expect("report");
        assert_eq!(report.outcome, ValidationOutcome::Passed);
        assert!(
            report.results[0].output_truncated,
            "outcome={:?} bytes={} summary={}",
            report.results[0].outcome,
            report.results[0].output_summary.len(),
            report.results[0].output_summary
        );
        assert_eq!(
            report.results[0].output_summary.len(),
            MAX_INLINE_OUTPUT_BYTES
        );
        assert!(report.results[0]
            .output_ref
            .as_ref()
            .is_some_and(|path| path.is_file()));
    }
}
