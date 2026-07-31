use crate::config::{self, CheckConfig, ChecksConfig};
use crate::evidence::git_evidence;
use crate::store;
use anyhow::{anyhow, Context, Result};
use chrono::Utc;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::path::Path;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

const LOG_LIMIT: usize = 64 * 1024;
pub const RUNNER_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Debug, Clone)]
pub enum Selection {
    Default,
    AllEnabled,
    Profile(String),
    Check(String),
    Checks(Vec<String>),
}

impl Default for Selection {
    fn default() -> Self {
        Self::Default
    }
}

#[derive(Debug, Clone, Default)]
pub struct RunOptions {
    pub selection: Selection,
    pub action: String,
    pub plan: Option<std::path::PathBuf>,
    pub plan_hash: Option<String>,
    pub config_path: Option<std::path::PathBuf>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PlanIdentity {
    pub path: String,
    pub hash: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RunResult {
    pub schema_version: u32,
    pub run_id: String,
    pub timestamp: String,
    pub repo_root: String,
    pub profile: Option<String>,
    pub config_hash: String,
    pub config_path: Option<String>,
    pub branch: Option<String>,
    pub head: Option<String>,
    pub dirty_tree_fingerprint: Option<String>,
    pub plan_identity: Option<PlanIdentity>,
    pub plan_hash: Option<String>,
    pub action: String,
    pub selection_mode: String,
    pub runner_version: String,
    pub source: String,
    pub overall_pass: bool,
    pub checks_run: usize,
    pub checks_passed: usize,
    pub checks_failed: usize,
    pub blocking_failures: Vec<String>,
    pub lanes: BTreeMap<String, LaneResult>,
    pub logs: Vec<RunEvent>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LaneResult {
    pub status: String,
    pub exit_code: i32,
    pub duration_ms: u128,
    pub details: String,
    pub commands: Vec<CommandResult>,
    pub group: Option<String>,
    pub blocking: bool,
    pub required: bool,
    pub skippable: bool,
    pub requires_reason_on_skip: bool,
    pub default_profiles: Vec<String>,
    pub cost: String,
    pub opens_window: bool,
    pub ci_workflow: Option<String>,
    pub ci_job: Option<String>,
    pub ci_required: bool,
    pub gate_strength: String,
    pub determinism: String,
    pub source_pack: Option<String>,
    pub tags: Vec<String>,
    pub severity: String,
    pub promotion_state: String,
    pub owner: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CommandResult {
    pub command: String,
    pub exit_code: i32,
    pub success: bool,
    pub timed_out: bool,
    pub duration_ms: u128,
    pub stdout: String,
    pub stderr: String,
    pub stdout_bytes: usize,
    pub stderr_bytes: usize,
    pub truncated: bool,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RunEvent {
    pub timestamp: String,
    pub event: String,
    pub check: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
}

pub fn run_checks(
    repo: &Path,
    profile: Option<&str>,
    check_filter: Option<&str>,
) -> Result<RunResult> {
    let selection = if let Some(check) = check_filter {
        Selection::Check(check.to_string())
    } else if let Some(profile) = profile {
        Selection::Profile(profile.to_string())
    } else {
        Selection::Default
    };
    run_checks_with_options(
        repo,
        RunOptions {
            selection,
            ..RunOptions::default()
        },
    )
}

pub fn run_all_checks(repo: &Path) -> Result<RunResult> {
    run_checks_with_options(
        repo,
        RunOptions {
            selection: Selection::AllEnabled,
            ..RunOptions::default()
        },
    )
}

pub fn run_checks_with_options(repo: &Path, options: RunOptions) -> Result<RunResult> {
    let repo = config::normalize_repo(repo)?;
    let cfg = if let Some(config_path) = options.config_path.as_deref() {
        config::load_config_path(config_path)?
    } else {
        config::load_config(&repo)?
    };
    let config_hash = config::config_hash(&cfg)?;
    let config_path = options
        .config_path
        .as_ref()
        .map(|path| {
            path.canonicalize()
                .unwrap_or_else(|_| path.clone())
                .display()
                .to_string()
        })
        .or_else(|| Some(config::config_path(&repo).display().to_string()));
    let (selected, profile, selection_mode) = select_checks(&cfg, &options.selection)?;
    let plan_identity = options
        .plan
        .as_deref()
        .map(|path| plan_identity(&repo, path))
        .transpose()?;
    let plan_hash = options
        .plan_hash
        .clone()
        .or_else(|| plan_identity.as_ref().map(|plan| plan.hash.clone()));
    let git = git_evidence(&repo);
    let run_id = format!("{}-{}", Utc::now().timestamp_millis(), std::process::id());
    let timestamp = Utc::now().to_rfc3339();

    let mut lanes = BTreeMap::new();
    let mut logs = Vec::new();
    let mut blocking_failures = Vec::new();

    for (name, check) in selected {
        logs.push(RunEvent {
            timestamp: Utc::now().to_rfc3339(),
            event: "check_start".to_string(),
            check: name.clone(),
            status: None,
        });
        let lane = run_one_check(&repo, &name, check)?;
        if lane.gate_strength == "blocking" && lane.status == "FAIL" {
            blocking_failures.push(name.clone());
        }
        logs.push(RunEvent {
            timestamp: Utc::now().to_rfc3339(),
            event: "check_end".to_string(),
            check: name.clone(),
            status: Some(lane.status.clone()),
        });
        lanes.insert(name, lane);
    }

    let checks_run = lanes.len();
    let checks_failed = lanes.values().filter(|lane| lane.status == "FAIL").count();
    let checks_passed = checks_run.saturating_sub(checks_failed);
    let overall_pass = blocking_failures.is_empty();

    let result = RunResult {
        schema_version: config::CONFIG_SCHEMA_VERSION,
        run_id,
        timestamp,
        repo_root: repo.display().to_string(),
        profile,
        config_hash,
        config_path,
        branch: git.branch,
        head: git.head,
        dirty_tree_fingerprint: git.dirty_tree_fingerprint,
        plan_identity,
        plan_hash,
        action: if options.action.is_empty() {
            "run".to_string()
        } else {
            options.action
        },
        selection_mode,
        runner_version: RUNNER_VERSION.to_string(),
        source: "elegy-checks".to_string(),
        overall_pass,
        checks_run,
        checks_passed,
        checks_failed,
        blocking_failures,
        lanes,
        logs,
    };

    store::write_run(&repo, &result)?;
    Ok(result)
}

fn select_checks<'a>(
    cfg: &'a ChecksConfig,
    selection: &Selection,
) -> Result<(Vec<(String, &'a CheckConfig)>, Option<String>, String)> {
    let (profile, check_filter, check_filters, selection_mode) = match selection {
        Selection::Default => (
            cfg.default_profile.as_deref(),
            None,
            None,
            "default-profile".to_string(),
        ),
        Selection::AllEnabled => (None, None, None, "all-enabled".to_string()),
        Selection::Profile(profile) => (Some(profile.as_str()), None, None, "profile".to_string()),
        Selection::Check(check) => (None, Some(check.as_str()), None, "check".to_string()),
        Selection::Checks(checks) => (None, None, Some(checks.as_slice()), "checks".to_string()),
    };
    let mut selected = Vec::new();
    for (name, check) in &cfg.checks {
        if !check.enabled {
            continue;
        }
        if let Some(filter) = check_filter {
            if name != filter {
                continue;
            }
        } else if let Some(filters) = check_filters {
            if !filters.iter().any(|filter| name == filter) {
                continue;
            }
        } else if let Some(profile) = profile {
            if !check.default_profiles.iter().any(|value| value == profile) {
                continue;
            }
        }
        selected.push((name.clone(), check));
    }
    if let Some(filter) = check_filter {
        if selected.is_empty() {
            return Err(anyhow!("Unknown or disabled check: {filter}"));
        }
    }
    if let Some(filters) = check_filters {
        if let Some(filter) = filters
            .iter()
            .find(|filter| !selected.iter().any(|(name, _)| name == *filter))
        {
            return Err(anyhow!("Unknown or disabled check: {filter}"));
        }
    }
    Ok((selected, profile.map(ToOwned::to_owned), selection_mode))
}

fn plan_identity(repo: &Path, path: &Path) -> Result<PlanIdentity> {
    let resolved = if path.is_absolute() {
        path.to_path_buf()
    } else {
        repo.join(path)
    };
    let canonical = resolved.canonicalize().unwrap_or(resolved);
    let bytes = std::fs::read(&canonical)
        .with_context(|| format!("Unable to read plan {}", canonical.display()))?;
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    Ok(PlanIdentity {
        path: canonical.display().to_string(),
        hash: format!("{:x}", hasher.finalize()),
    })
}

fn run_one_check(repo: &Path, name: &str, check: &CheckConfig) -> Result<LaneResult> {
    let mut command_results = Vec::new();
    let mut passed = true;
    let start = Instant::now();
    for command in &check.commands {
        let result = run_command(repo, check, command)
            .with_context(|| format!("Failed to run command for check {name}: {command}"))?;
        if !result.success {
            passed = false;
        }
        command_results.push(result);
        if !passed {
            break;
        }
    }

    let status = if passed {
        "PASS"
    } else if check.gate_strength == "advisory" {
        "WARN"
    } else {
        "FAIL"
    }
    .to_string();
    let details = command_results
        .iter()
        .find(|result| !result.success)
        .map(summarize_command_failure)
        .unwrap_or_else(|| "Passed".to_string());
    let exit_code = command_results
        .iter()
        .find(|result| !result.success)
        .map(|result| result.exit_code)
        .unwrap_or(0);

    Ok(LaneResult {
        status,
        exit_code,
        duration_ms: start.elapsed().as_millis(),
        details,
        commands: command_results,
        group: check.group.clone(),
        blocking: check.blocking,
        required: check.required,
        skippable: check.skippable,
        requires_reason_on_skip: check.requires_reason_on_skip,
        default_profiles: check.default_profiles.clone(),
        cost: check.cost.clone(),
        opens_window: check.opens_window,
        ci_workflow: check.ci_workflow.clone().filter(|value| !value.is_empty()),
        ci_job: check.ci_job.clone().filter(|value| !value.is_empty()),
        ci_required: check.ci_required,
        gate_strength: check.gate_strength.clone(),
        determinism: check.determinism.clone(),
        source_pack: check.source_pack.clone(),
        tags: check.tags.clone(),
        severity: check.severity.clone(),
        promotion_state: check.promotion_state.clone(),
        owner: check.owner.clone(),
    })
}

fn run_command(repo: &Path, check: &CheckConfig, command: &str) -> Result<CommandResult> {
    let cwd = repo.join(&check.cwd);
    let start = Instant::now();
    let mut child = shell_command(command)
        .current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    let timeout = Duration::from_millis(check.timeout_ms);
    let mut timed_out = false;
    loop {
        if child.try_wait()?.is_some() {
            break;
        }
        if start.elapsed() >= timeout {
            timed_out = true;
            let _ = child.kill();
            break;
        }
        thread::sleep(Duration::from_millis(25));
    }

    let output = child.wait_with_output()?;
    let duration_ms = start.elapsed().as_millis();
    let stdout_bytes = output.stdout.len();
    let stderr_bytes = output.stderr.len();
    let stdout = truncate_utf8(output.stdout);
    let stderr = truncate_utf8(output.stderr);
    let exit_code = if timed_out {
        -1
    } else {
        output.status.code().unwrap_or(-2)
    };
    let success = !timed_out && output.status.success();

    Ok(CommandResult {
        command: command.to_string(),
        exit_code,
        success,
        timed_out,
        duration_ms,
        stdout,
        stderr,
        stdout_bytes,
        stderr_bytes,
        truncated: stdout_bytes > LOG_LIMIT || stderr_bytes > LOG_LIMIT,
    })
}

fn shell_command(command: &str) -> Command {
    #[cfg(windows)]
    {
        let mut cmd = Command::new("cmd");
        cmd.args(["/C", command]);
        cmd
    }
    #[cfg(not(windows))]
    {
        let mut cmd = Command::new("sh");
        cmd.args(["-c", command]);
        cmd
    }
}

fn truncate_utf8(bytes: Vec<u8>) -> String {
    let mut limited = bytes;
    if limited.len() > LOG_LIMIT {
        limited.truncate(LOG_LIMIT);
    }
    String::from_utf8_lossy(&limited).to_string()
}

fn summarize_command_failure(result: &CommandResult) -> String {
    if result.timed_out {
        return "Timed out".to_string();
    }
    let combined = [&result.stderr, &result.stdout]
        .into_iter()
        .filter(|value| !value.trim().is_empty())
        .map(|value| value.lines().take(3).collect::<Vec<_>>().join("; "))
        .collect::<Vec<_>>()
        .join("; ");
    if combined.is_empty() {
        format!("Exit code {}", result.exit_code)
    } else {
        combined
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{write_config, ChecksConfig};
    use tempfile::tempdir;

    #[test]
    fn all_enabled_selection_ignores_default_profile() {
        let _lock = crate::store::TEST_STATE_LOCK.lock().unwrap();
        let dir = tempdir().unwrap();
        let mut cfg = ChecksConfig {
            schema_version: 1,
            default_profile: Some("commit".to_string()),
            ..ChecksConfig::default()
        };
        cfg.checks.insert(
            "commit-only".to_string(),
            CheckConfig {
                commands: vec![success_command()],
                default_profiles: vec!["commit".to_string()],
                ..CheckConfig::default()
            },
        );
        cfg.checks.insert(
            "ci-only".to_string(),
            CheckConfig {
                commands: vec![success_command()],
                default_profiles: vec!["ci-local".to_string()],
                ..CheckConfig::default()
            },
        );
        write_config(dir.path(), &cfg).unwrap();

        let result = run_checks_with_options(
            dir.path(),
            RunOptions {
                selection: Selection::AllEnabled,
                ..RunOptions::default()
            },
        )
        .unwrap();

        assert_eq!(result.lanes.len(), 2);
        assert_eq!(result.selection_mode, "all-enabled");
        assert_eq!(result.action, "run");

        let legacy_default = run_checks(dir.path(), None, None).unwrap();
        assert_eq!(legacy_default.lanes.len(), 1);
        assert_eq!(legacy_default.selection_mode, "default-profile");
    }

    #[test]
    fn explicit_check_selection_runs_multiple_requested_lanes() {
        let _lock = crate::store::TEST_STATE_LOCK.lock().unwrap();
        let dir = tempdir().unwrap();
        let mut cfg = ChecksConfig {
            schema_version: 1,
            default_profile: Some("commit".to_string()),
            ..ChecksConfig::default()
        };
        for name in ["first", "second", "third"] {
            cfg.checks.insert(
                name.to_string(),
                CheckConfig {
                    commands: vec![success_command()],
                    ..CheckConfig::default()
                },
            );
        }
        write_config(dir.path(), &cfg).unwrap();

        let result = run_checks_with_options(
            dir.path(),
            RunOptions {
                selection: Selection::Checks(vec!["first".to_string(), "third".to_string()]),
                ..RunOptions::default()
            },
        )
        .unwrap();

        assert_eq!(result.lanes.len(), 2);
        assert!(result.lanes.contains_key("first"));
        assert!(result.lanes.contains_key("third"));
        assert!(!result.lanes.contains_key("second"));
        assert_eq!(result.selection_mode, "checks");
    }

    #[test]
    fn run_result_contains_execution_evidence_and_plan_identity() {
        let _lock = crate::store::TEST_STATE_LOCK.lock().unwrap();
        let dir = tempdir().unwrap();
        let mut cfg = ChecksConfig {
            schema_version: 1,
            default_profile: Some("commit".to_string()),
            ..ChecksConfig::default()
        };
        cfg.checks.insert(
            "pass".to_string(),
            CheckConfig {
                commands: vec![success_command()],
                default_profiles: vec!["commit".to_string()],
                ..CheckConfig::default()
            },
        );
        write_config(dir.path(), &cfg).unwrap();
        let plan = dir.path().join("plan.md");
        std::fs::write(&plan, "approved plan\n").unwrap();

        let result = run_checks_with_options(
            dir.path(),
            RunOptions {
                action: "verify".to_string(),
                plan: Some(plan),
                ..RunOptions::default()
            },
        )
        .unwrap();
        let json = serde_json::to_value(result).unwrap();

        assert_eq!(json["action"], "verify");
        assert_eq!(json["selectionMode"], "default-profile");
        assert_eq!(json["source"], "elegy-checks");
        assert!(!json["runnerVersion"].as_str().unwrap().is_empty());
        assert!(!json["configHash"].as_str().unwrap().is_empty());
        assert!(!json["planIdentity"]["hash"].as_str().unwrap().is_empty());
    }

    #[test]
    fn failing_blocking_check_fails_run() {
        let _lock = crate::store::TEST_STATE_LOCK.lock().unwrap();
        let dir = tempdir().unwrap();
        let mut cfg = ChecksConfig {
            schema_version: 1,
            default_profile: Some("commit".to_string()),
            ..ChecksConfig::default()
        };
        cfg.checks.insert(
            "fail".to_string(),
            CheckConfig {
                commands: vec![fail_command()],
                default_profiles: vec!["commit".to_string()],
                blocking: true,
                required: true,
                ..CheckConfig::default()
            },
        );
        write_config(dir.path(), &cfg).unwrap();

        let result = run_checks(dir.path(), Some("commit"), None).unwrap();
        assert!(!result.overall_pass);
        assert_eq!(result.checks_failed, 1);
        assert_eq!(result.blocking_failures, vec!["fail"]);
    }

    fn fail_command() -> String {
        if cfg!(windows) {
            "exit /b 7".to_string()
        } else {
            "exit 7".to_string()
        }
    }

    fn success_command() -> String {
        if cfg!(windows) {
            "exit /b 0".to_string()
        } else {
            "true".to_string()
        }
    }
}
