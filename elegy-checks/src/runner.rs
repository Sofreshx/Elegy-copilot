use crate::config::{self, CheckConfig, ChecksConfig};
use crate::store;
use anyhow::{anyhow, Context, Result};
use chrono::Utc;
use serde::Serialize;
use std::collections::BTreeMap;
use std::path::Path;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

const LOG_LIMIT: usize = 64 * 1024;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RunResult {
    pub schema_version: u32,
    pub run_id: String,
    pub timestamp: String,
    pub repo_root: String,
    pub profile: Option<String>,
    pub config_hash: String,
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
    let repo = config::normalize_repo(repo)?;
    let cfg = config::load_config(&repo)?;
    let config_hash = config::config_hash(&cfg)?;
    let selected = select_checks(&cfg, profile, check_filter)?;
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
        profile: profile.map(ToOwned::to_owned),
        config_hash,
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
    profile: Option<&str>,
    check_filter: Option<&str>,
) -> Result<Vec<(String, &'a CheckConfig)>> {
    let profile = profile.or(cfg.default_profile.as_deref());
    let mut selected = Vec::new();
    for (name, check) in &cfg.checks {
        if !check.enabled {
            continue;
        }
        if let Some(filter) = check_filter {
            if name != filter {
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
    Ok(selected)
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
    fn failing_blocking_check_fails_run() {
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
}
