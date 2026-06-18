use std::collections::BTreeSet;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use serde::de::DeserializeOwned;
use serde::Deserialize;
use thiserror::Error;

pub const REQUIRED_RESULT_SCHEMA: &str = "planning-result/v1";
pub const REQUIRED_PLANNING_SCHEMA: &str = "10";
pub const REQUIRED_LEASE_CAPABILITIES: [&str; 5] = [
    "project-run.claim.v2",
    "project-run.activate.fenced.v1",
    "project-run.heartbeat.v1",
    "project-run.release.fenced.v1",
    "project-run.add-evidence.fenced.v1",
];

#[derive(Clone, Debug)]
pub struct PlanningCliResolver {
    pub runtime_root: PathBuf,
    pub elegy_home: PathBuf,
    pub override_path: Option<PathBuf>,
}

impl PlanningCliResolver {
    pub fn resolve(&self) -> Result<PathBuf, PlanningClientError> {
        if let Some(path) = self
            .override_path
            .as_ref()
            .filter(|candidate| candidate.is_file())
        {
            return Ok(path.clone());
        }

        for candidate in candidate_paths(
            &self.runtime_root,
            &self.elegy_home,
            cfg!(target_os = "windows"),
        ) {
            if candidate.is_file() {
                return Ok(candidate);
            }
        }

        let executable = executable_name(cfg!(target_os = "windows"));
        let lookup = if cfg!(target_os = "windows") {
            "where"
        } else {
            "which"
        };
        if Command::new(lookup)
            .arg(executable)
            .output()
            .is_ok_and(|output| output.status.success())
        {
            return Ok(PathBuf::from(executable));
        }

        Err(PlanningClientError::CliUnavailable {
            searched: candidate_paths(
                &self.runtime_root,
                &self.elegy_home,
                cfg!(target_os = "windows"),
            ),
        })
    }
}

fn executable_name(windows: bool) -> &'static str {
    if windows {
        "elegy-planning.exe"
    } else {
        "elegy-planning"
    }
}

fn candidate_paths(runtime_root: &Path, elegy_home: &Path, windows: bool) -> Vec<PathBuf> {
    let executable = executable_name(windows);
    vec![
        runtime_root.join("elegy-planning").join(executable),
        runtime_root
            .join("elegy-planning")
            .join("bin")
            .join(executable),
        runtime_root
            .join("copilot-ui")
            .join("resources")
            .join("elegy-planning")
            .join(executable),
        elegy_home
            .join("managed-cli")
            .join("planning")
            .join("bin")
            .join(executable),
        elegy_home
            .join("managed-cli")
            .join("planning")
            .join(executable),
        elegy_home.join("bin").join(executable),
        elegy_home.join("elegy-planning").join(executable),
    ]
}

#[derive(Clone, Debug)]
pub struct PlanningClientConfig {
    pub cli_path: PathBuf,
    pub db_path: PathBuf,
    pub scope: String,
    pub max_busy_attempts: u8,
    pub retry_delay: Duration,
}

impl PlanningClientConfig {
    pub fn new(cli_path: PathBuf, db_path: PathBuf, scope: impl Into<String>) -> Self {
        Self {
            cli_path,
            db_path,
            scope: scope.into(),
            max_busy_attempts: 3,
            retry_delay: Duration::from_millis(50),
        }
    }
}

#[derive(Clone)]
pub struct PlanningClient {
    config: PlanningClientConfig,
    runner: Arc<dyn PlanningCommandRunner>,
}

impl PlanningClient {
    pub fn new(config: PlanningClientConfig) -> Self {
        Self {
            config,
            runner: Arc::new(SystemPlanningCommandRunner),
        }
    }

    #[cfg(test)]
    fn with_runner(config: PlanningClientConfig, runner: Arc<dyn PlanningCommandRunner>) -> Self {
        Self { config, runner }
    }

    pub fn negotiate(&self) -> Result<PlanningCapabilities, PlanningClientError> {
        let capabilities: PlanningCapabilities = self.invoke(&["capabilities"])?;
        capabilities.require_lease_contract()?;
        Ok(capabilities)
    }

    pub fn claim(
        &self,
        request: &ClaimProjectRunRequest,
    ) -> Result<ProjectRunLease, PlanningClientError> {
        self.negotiate()?;
        let lease_seconds = request.lease_seconds.to_string();
        let args = [
            "project-run",
            "claim",
            "--goal-id",
            request.goal_id.as_str(),
            "--roadmap-id",
            request.roadmap_id.as_str(),
            "--work-point-id",
            request.work_point_id.as_str(),
            "--owner-id",
            request.owner_id.as_str(),
            "--idempotency-key",
            request.idempotency_key.as_str(),
            "--lease-seconds",
            lease_seconds.as_str(),
        ];
        self.invoke(&args)
    }

    fn invoke<T: DeserializeOwned>(&self, command_args: &[&str]) -> Result<T, PlanningClientError> {
        let mut args = vec![
            OsString::from("--json"),
            OsString::from("--non-interactive"),
            OsString::from("--db"),
            self.config.db_path.as_os_str().to_os_string(),
            OsString::from("--scope"),
            OsString::from(&self.config.scope),
        ];
        args.extend(command_args.iter().map(OsString::from));

        let attempts = self.config.max_busy_attempts.max(1);
        for attempt in 1..=attempts {
            let output = self
                .runner
                .run(&self.config.cli_path, &args)
                .map_err(|source| PlanningClientError::CliLaunch {
                    path: self.config.cli_path.clone(),
                    source,
                })?;

            match parse_output(output) {
                Err(error)
                    if error.is_retryable_infrastructure()
                        && attempt < self.config.max_busy_attempts =>
                {
                    thread::sleep(self.config.retry_delay);
                }
                result => return result,
            }
        }

        unreachable!("attempt loop always returns on its final iteration")
    }
}

trait PlanningCommandRunner: Send + Sync {
    fn run(&self, executable: &Path, args: &[OsString]) -> std::io::Result<Output>;
}

struct SystemPlanningCommandRunner;

impl PlanningCommandRunner for SystemPlanningCommandRunner {
    fn run(&self, executable: &Path, args: &[OsString]) -> std::io::Result<Output> {
        Command::new(executable).args(args).output()
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PlanningCapabilities {
    pub cli_version: String,
    pub result_schema_version: String,
    pub planning_schema_version: String,
    pub capabilities: BTreeSet<String>,
}

impl PlanningCapabilities {
    fn require_lease_contract(&self) -> Result<(), PlanningClientError> {
        if self.result_schema_version != REQUIRED_RESULT_SCHEMA
            || self.planning_schema_version != REQUIRED_PLANNING_SCHEMA
        {
            return Err(PlanningClientError::Incompatible {
                reason: format!(
                    "expected result schema {REQUIRED_RESULT_SCHEMA} and planning schema {REQUIRED_PLANNING_SCHEMA}; received {} and {}",
                    self.result_schema_version, self.planning_schema_version
                ),
            });
        }

        let missing = REQUIRED_LEASE_CAPABILITIES
            .iter()
            .filter(|capability| !self.capabilities.contains(**capability))
            .copied()
            .collect::<Vec<_>>();
        if !missing.is_empty() {
            return Err(PlanningClientError::Incompatible {
                reason: format!("missing required capabilities: {}", missing.join(", ")),
            });
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ClaimProjectRunRequest {
    pub goal_id: String,
    pub roadmap_id: String,
    pub work_point_id: String,
    pub owner_id: String,
    pub idempotency_key: String,
    pub lease_seconds: i64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRunLease {
    pub id: String,
    pub work_point_id: String,
    pub owner_id: String,
    pub idempotency_key: String,
    pub fencing_token: i64,
    pub lease_expires_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MachineEnvelope<T> {
    schema_version: String,
    status: String,
    data: Option<T>,
    error: Option<String>,
}

fn parse_output<T: DeserializeOwned>(output: Output) -> Result<T, PlanningClientError> {
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let envelope = serde_json::from_str::<MachineEnvelope<T>>(&stdout).map_err(|source| {
        PlanningClientError::Protocol {
            detail: if stderr.is_empty() {
                stdout.clone()
            } else {
                stderr.clone()
            },
            source,
        }
    })?;

    if envelope.schema_version != REQUIRED_RESULT_SCHEMA {
        return Err(PlanningClientError::Incompatible {
            reason: format!(
                "expected envelope schema {REQUIRED_RESULT_SCHEMA}; received {}",
                envelope.schema_version
            ),
        });
    }
    if output.status.success() && envelope.status == "ok" {
        return envelope
            .data
            .ok_or(PlanningClientError::ProtocolMissingData);
    }

    let message = envelope
        .error
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| {
            if stderr.is_empty() {
                format!("planning CLI returned status {}", envelope.status)
            } else {
                stderr
            }
        });
    Err(classify_cli_error(message))
}

fn classify_cli_error(message: String) -> PlanningClientError {
    let normalized = message.to_ascii_lowercase();
    if normalized.contains("sqlite_busy")
        || normalized.contains("database is locked")
        || normalized.contains("database table is locked")
    {
        PlanningClientError::RetryableInfrastructure { message }
    } else if normalized.contains("unsupported planning schema")
        || normalized.contains("unknown argument")
        || normalized.contains("unrecognized subcommand")
    {
        PlanningClientError::Incompatible { reason: message }
    } else {
        PlanningClientError::Authority { message }
    }
}

#[derive(Debug, Error)]
pub enum PlanningClientError {
    #[error("elegy-planning CLI is unavailable; searched {searched:?}")]
    CliUnavailable { searched: Vec<PathBuf> },
    #[error("failed to launch elegy-planning at {path}: {source}")]
    CliLaunch {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("planning CLI is incompatible: {reason}")]
    Incompatible { reason: String },
    #[error("retryable planning infrastructure failure: {message}")]
    RetryableInfrastructure { message: String },
    #[error("planning authority rejected the request: {message}")]
    Authority { message: String },
    #[error("planning CLI returned invalid JSON ({detail}): {source}")]
    Protocol {
        detail: String,
        #[source]
        source: serde_json::Error,
    },
    #[error("planning CLI returned an ok envelope without data")]
    ProtocolMissingData,
}

impl PlanningClientError {
    pub fn is_retryable_infrastructure(&self) -> bool {
        matches!(
            self,
            Self::CliUnavailable { .. }
                | Self::CliLaunch { .. }
                | Self::RetryableInfrastructure { .. }
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;
    use std::process::ExitStatus;
    use std::sync::Mutex;

    #[cfg(unix)]
    use std::os::unix::process::ExitStatusExt;
    #[cfg(windows)]
    use std::os::windows::process::ExitStatusExt;

    fn status(code: u32) -> ExitStatus {
        ExitStatus::from_raw(code)
    }

    fn output(code: u32, stdout: &str) -> Output {
        Output {
            status: status(code),
            stdout: stdout.as_bytes().to_vec(),
            stderr: Vec::new(),
        }
    }

    #[test]
    fn windows_candidates_match_repository_resolver_precedence() {
        let runtime = Path::new(r"C:\runtime");
        let home = Path::new(r"C:\Users\test\.elegy");
        assert_eq!(
            candidate_paths(runtime, home, true),
            vec![
                runtime.join("elegy-planning").join("elegy-planning.exe"),
                runtime
                    .join("elegy-planning")
                    .join("bin")
                    .join("elegy-planning.exe"),
                runtime
                    .join("copilot-ui")
                    .join("resources")
                    .join("elegy-planning")
                    .join("elegy-planning.exe"),
                home.join("managed-cli")
                    .join("planning")
                    .join("bin")
                    .join("elegy-planning.exe"),
                home.join("managed-cli")
                    .join("planning")
                    .join("elegy-planning.exe"),
                home.join("bin").join("elegy-planning.exe"),
                home.join("elegy-planning").join("elegy-planning.exe"),
            ]
        );
    }

    #[test]
    fn capabilities_reject_missing_required_contract() {
        let capabilities = PlanningCapabilities {
            cli_version: "0.1.0".into(),
            result_schema_version: REQUIRED_RESULT_SCHEMA.into(),
            planning_schema_version: REQUIRED_PLANNING_SCHEMA.into(),
            capabilities: BTreeSet::from(["project-run.claim.v2".into()]),
        };
        assert!(matches!(
            capabilities.require_lease_contract(),
            Err(PlanningClientError::Incompatible { .. })
        ));
    }

    #[test]
    fn classifies_sqlite_busy_as_retryable_infrastructure() {
        let error = classify_cli_error("database is locked (SQLITE_BUSY)".into());
        assert!(error.is_retryable_infrastructure());
        assert!(matches!(
            error,
            PlanningClientError::RetryableInfrastructure { .. }
        ));
    }

    #[test]
    fn unavailable_cli_is_a_retryable_infrastructure_state() {
        let error = PlanningClientError::CliUnavailable {
            searched: vec![PathBuf::from("missing-elegy-planning")],
        };
        assert!(error.is_retryable_infrastructure());
    }

    struct FakeRunner {
        outputs: Mutex<VecDeque<Output>>,
        calls: Mutex<usize>,
    }

    impl PlanningCommandRunner for FakeRunner {
        fn run(&self, _executable: &Path, _args: &[OsString]) -> std::io::Result<Output> {
            *self.calls.lock().expect("calls lock") += 1;
            Ok(self
                .outputs
                .lock()
                .expect("outputs lock")
                .pop_front()
                .expect("fake output"))
        }
    }

    #[test]
    fn retries_sqlite_busy_with_a_bound() {
        let busy = r#"{"schemaVersion":"planning-result/v1","status":"error","error":"database is locked (SQLITE_BUSY)"}"#;
        let ok = r#"{"schemaVersion":"planning-result/v1","status":"ok","data":{"cliVersion":"0.1.0","resultSchemaVersion":"planning-result/v1","planningSchemaVersion":"10","capabilities":["project-run.claim.v2","project-run.activate.fenced.v1","project-run.heartbeat.v1","project-run.release.fenced.v1","project-run.add-evidence.fenced.v1"]}}"#;
        let runner = Arc::new(FakeRunner {
            outputs: Mutex::new(VecDeque::from([
                output(1, busy),
                output(1, busy),
                output(0, ok),
            ])),
            calls: Mutex::new(0),
        });
        let mut config = PlanningClientConfig::new(
            PathBuf::from("elegy-planning"),
            PathBuf::from("planning.db"),
            "test",
        );
        config.retry_delay = Duration::ZERO;
        let client = PlanningClient::with_runner(config, runner.clone());

        assert!(client.negotiate().is_ok());
        assert_eq!(*runner.calls.lock().expect("calls lock"), 3);
    }
}
