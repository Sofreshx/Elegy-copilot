use crate::config::{self, config_hash};
use crate::evidence::{git_evidence, GitEvidence};
use crate::runner::{RunEvent, RunResult};
use anyhow::{Context, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

#[cfg(test)]
pub static TEST_STATE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StateResult {
    pub repo_id: String,
    pub repo_path: String,
    pub has_state: bool,
    pub state_path: String,
    pub last_run: Option<RunSummary>,
    pub history: Vec<RunSummary>,
    pub freshness: Freshness,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunSummary {
    pub run_id: String,
    pub timestamp: String,
    pub profile: Option<String>,
    pub overall_pass: bool,
    pub checks_run: i64,
    pub checks_passed: i64,
    pub checks_failed: i64,
    pub config_hash: String,
    pub config_path: Option<String>,
    pub branch: Option<String>,
    pub head: Option<String>,
    pub dirty_tree_fingerprint: Option<String>,
    pub plan_identity: Option<PlanIdentitySummary>,
    pub plan_hash: Option<String>,
    pub action: Option<String>,
    pub selection_mode: Option<String>,
    pub runner_version: Option<String>,
    pub source: Option<String>,
    pub logs: Vec<RunEvent>,
    pub lanes: BTreeMap<String, LaneSummary>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanIdentitySummary {
    pub path: String,
    pub hash: String,
}

#[derive(Debug, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaneSummary {
    pub status: String,
    pub exit_code: i64,
    pub duration_ms: i64,
    pub details: String,
    pub blocking: bool,
    #[serde(default)]
    pub required: bool,
    #[serde(default)]
    pub skippable: bool,
    #[serde(default)]
    pub requires_reason_on_skip: bool,
    #[serde(default)]
    pub default_profiles: Vec<String>,
    #[serde(default)]
    pub cost: String,
    #[serde(default)]
    pub opens_window: bool,
    #[serde(default)]
    pub ci_workflow: Option<String>,
    #[serde(default)]
    pub ci_job: Option<String>,
    #[serde(default)]
    pub ci_required: bool,
    #[serde(default)]
    pub gate_strength: String,
    #[serde(default)]
    pub determinism: String,
    #[serde(default)]
    pub source_pack: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub severity: String,
    #[serde(default)]
    pub promotion_state: String,
    #[serde(default)]
    pub owner: Option<String>,
    #[serde(default)]
    pub commands: Vec<CommandSummary>,
}

#[derive(Debug, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandSummary {
    pub command: String,
    pub exit_code: i64,
    pub success: bool,
    pub timed_out: bool,
    pub duration_ms: i64,
    pub stdout: String,
    pub stderr: String,
    pub stdout_bytes: i64,
    pub stderr_bytes: i64,
    pub truncated: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Freshness {
    pub fresh: bool,
    pub reason: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogsResult {
    pub repo_id: String,
    pub run_id: String,
    pub limit: i64,
    pub offset: i64,
    pub next_offset: Option<i64>,
    pub entries: Vec<LogEntry>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub check_id: String,
    pub command_index: i64,
    pub command: String,
    pub exit_code: i64,
    pub success: bool,
    pub timed_out: bool,
    pub duration_ms: i64,
    pub stdout: String,
    pub stderr: String,
    pub stdout_bytes: i64,
    pub stderr_bytes: i64,
    pub truncated: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatsResult {
    pub repo_id: String,
    pub run_count: i64,
    pub pass_count: i64,
    pub fail_count: i64,
    pub pass_rate: f64,
    pub recent_failing_checks: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryResult {
    pub repo_id: String,
    pub branch: Option<String>,
    pub limit: i64,
    pub offset: i64,
    pub next_offset: Option<i64>,
    pub runs: Vec<RunSummary>,
}

pub fn write_run(repo: &Path, result: &RunResult) -> Result<()> {
    let db_path = state_path(repo)?;
    if let Some(parent) = db_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let conn = Connection::open(db_path)?;
    migrate(&conn)?;
    conn.execute(
            "insert into runs
             (run_id, repo_path, profile, started_at, ended_at, config_hash, config_path, overall_pass,
              checks_run, checks_passed, checks_failed, branch, head, dirty_tree_fingerprint,
              plan_path, plan_hash, action, selection_mode, runner_version, source)
             values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)",
        params![
            result.run_id,
            result.repo_root,
            result.profile,
            result.timestamp,
            result.timestamp,
            result.config_hash,
            result.config_path,
            bool_to_int(result.overall_pass),
            result.checks_run as i64,
            result.checks_passed as i64,
            result.checks_failed as i64,
            result.branch,
            result.head,
            result.dirty_tree_fingerprint,
            result.plan_identity.as_ref().map(|plan| plan.path.clone()),
            result
                .plan_hash
                .clone()
                .or_else(|| result.plan_identity.as_ref().map(|plan| plan.hash.clone())),
            result.action,
            result.selection_mode,
            result.runner_version,
            result.source,
        ],
    )?;

    for (check_id, lane) in &result.lanes {
        let metadata = serde_json::to_string(lane)?;
        conn.execute(
            "insert into check_results (run_id, check_id, status, exit_code, duration_ms, blocking, details, metadata)
             values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                result.run_id,
                check_id,
                lane.status,
                lane.exit_code as i64,
                lane.duration_ms as i64,
                bool_to_int(lane.blocking),
                lane.details,
                metadata,
            ],
        )?;
        for (index, command) in lane.commands.iter().enumerate() {
            conn.execute(
                "insert into command_results
                 (run_id, check_id, command_index, command, exit_code, success, timed_out, duration_ms, stdout, stderr, stdout_bytes, stderr_bytes, truncated)
                 values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
                params![
                    result.run_id,
                    check_id,
                    index as i64,
                    command.command,
                    command.exit_code as i64,
                    bool_to_int(command.success),
                    bool_to_int(command.timed_out),
                    command.duration_ms as i64,
                    command.stdout,
                    command.stderr,
                    command.stdout_bytes as i64,
                    command.stderr_bytes as i64,
                    bool_to_int(command.truncated),
                ],
            )?;
        }
    }
    for (index, event) in result.logs.iter().enumerate() {
        conn.execute(
            "insert into run_events (run_id, event_index, timestamp, event, check_id, status)
             values (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                result.run_id,
                index as i64,
                event.timestamp,
                event.event,
                event.check,
                event.status,
            ],
        )?;
    }
    Ok(())
}

pub fn read_state(repo: &Path) -> Result<StateResult> {
    read_state_with_plan(repo, None)
}

pub fn read_state_with_plan(repo: &Path, supplied_plan: Option<&Path>) -> Result<StateResult> {
    let repo = config::normalize_repo(repo)?;
    let repo_id = repo_id(&repo)?;
    let db_path = state_path(&repo)?;
    let mut last_run = None;
    let mut history = Vec::new();
    if db_path.exists() {
        let conn = Connection::open(&db_path)?;
        migrate(&conn)?;
        last_run = query_run_summary(&conn, None, true)?;
        let mut stmt =
            conn.prepare("select run_id from runs order by started_at desc limit ?1 offset 1")?;
        let run_ids = stmt
            .query_map(params![25], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for run_id in run_ids {
            if let Some(summary) = query_run_summary(&conn, Some(&run_id), false)? {
                history.push(summary);
            }
        }
    }

    let freshness = if let Some(run) = &last_run {
        check_freshness(&repo, run, supplied_plan)
    } else {
        Freshness {
            fresh: false,
            reason: "no-prior-run".to_string(),
        }
    };

    Ok(StateResult {
        repo_id,
        repo_path: repo.display().to_string(),
        has_state: last_run.is_some(),
        state_path: db_path.display().to_string(),
        last_run,
        history,
        freshness,
    })
}

pub fn read_logs(
    repo: &Path,
    run_id: &str,
    check: Option<&str>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<LogsResult> {
    let repo = config::normalize_repo(repo)?;
    let repo_id = repo_id(&repo)?;
    let conn = Connection::open(state_path(&repo)?)?;
    migrate(&conn)?;
    let limit = limit.unwrap_or(100).clamp(1, 500);
    let offset = offset.unwrap_or(0).max(0);

    let mut entries = Vec::new();
    if let Some(check) = check {
        let mut stmt = conn.prepare(
            "select check_id, command_index, command, exit_code, success, timed_out, duration_ms, stdout, stderr, stdout_bytes, stderr_bytes, truncated
             from command_results where run_id = ?1 and check_id = ?2 order by command_index limit ?3 offset ?4",
        )?;
        let rows = stmt.query_map(
            params![run_id, check, limit + 1, offset],
            log_entry_from_row,
        )?;
        for row in rows {
            entries.push(row?);
        }
    } else {
        let mut stmt = conn.prepare(
            "select check_id, command_index, command, exit_code, success, timed_out, duration_ms, stdout, stderr, stdout_bytes, stderr_bytes, truncated
             from command_results where run_id = ?1 order by check_id, command_index limit ?2 offset ?3",
        )?;
        let rows = stmt.query_map(params![run_id, limit + 1, offset], log_entry_from_row)?;
        for row in rows {
            entries.push(row?);
        }
    }
    let next_offset = if entries.len() as i64 > limit {
        entries.truncate(limit as usize);
        Some(offset + limit)
    } else {
        None
    };

    Ok(LogsResult {
        repo_id,
        run_id: run_id.to_string(),
        limit,
        offset,
        next_offset,
        entries,
    })
}

pub fn read_history(
    repo: &Path,
    limit: Option<i64>,
    offset: Option<i64>,
    branch: Option<&str>,
) -> Result<HistoryResult> {
    let repo = config::normalize_repo(repo)?;
    let repo_id = repo_id(&repo)?;
    let db_path = state_path(&repo)?;
    let limit = limit.unwrap_or(25).clamp(1, 200);
    let offset = offset.unwrap_or(0).max(0);
    if !db_path.exists() {
        return Ok(HistoryResult {
            repo_id,
            branch: branch.map(ToOwned::to_owned),
            limit,
            offset,
            next_offset: None,
            runs: Vec::new(),
        });
    }
    let conn = Connection::open(db_path)?;
    migrate(&conn)?;
    let mut stmt = conn.prepare(
        "select run_id from runs
             where (?1 is null or branch = ?1)
             order by started_at desc limit ?2 offset ?3",
    )?;
    let mut runs: Vec<RunSummary> = stmt
        .query_map(params![branch, limit + 1, offset], |row| {
            row.get::<_, String>(0)
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?
        .into_iter()
        .map(|run_id| query_run_summary(&conn, Some(&run_id), false))
        .collect::<Result<Vec<_>>>()?
        .into_iter()
        .flatten()
        .collect();
    let next_offset = if runs.len() as i64 > limit {
        runs.truncate(limit as usize);
        Some(offset + limit)
    } else {
        None
    };
    Ok(HistoryResult {
        repo_id,
        branch: branch.map(ToOwned::to_owned),
        limit,
        offset,
        next_offset,
        runs,
    })
}

pub fn read_stats(repo: &Path) -> Result<StatsResult> {
    let repo = config::normalize_repo(repo)?;
    let repo_id = repo_id(&repo)?;
    let db_path = state_path(&repo)?;
    if !db_path.exists() {
        return Ok(StatsResult {
            repo_id,
            run_count: 0,
            pass_count: 0,
            fail_count: 0,
            pass_rate: 0.0,
            recent_failing_checks: Vec::new(),
        });
    }
    let conn = Connection::open(db_path)?;
    migrate(&conn)?;
    let (run_count, pass_count): (i64, i64) = conn.query_row(
        "select count(*), coalesce(sum(overall_pass), 0) from runs",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    let fail_count = run_count - pass_count;
    let pass_rate = if run_count == 0 {
        0.0
    } else {
        pass_count as f64 / run_count as f64
    };
    let mut stmt = conn.prepare(
        "select distinct check_id from check_results where status = 'FAIL' order by rowid desc limit 10",
    )?;
    let recent_failing_checks = stmt
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(StatsResult {
        repo_id,
        run_count,
        pass_count,
        fail_count,
        pass_rate,
        recent_failing_checks,
    })
}

fn query_run_summary(
    conn: &Connection,
    run_id: Option<&str>,
    include_commands: bool,
) -> Result<Option<RunSummary>> {
    let sql = if run_id.is_some() {
        "select run_id, started_at, profile, overall_pass, checks_run, checks_passed,
                checks_failed, config_hash, config_path, branch, head, dirty_tree_fingerprint,
                plan_path, plan_hash, action, selection_mode, runner_version, source
         from runs where run_id = ?1"
    } else {
        "select run_id, started_at, profile, overall_pass, checks_run, checks_passed,
                checks_failed, config_hash, config_path, branch, head, dirty_tree_fingerprint,
                plan_path, plan_hash, action, selection_mode, runner_version, source
         from runs order by started_at desc limit 1"
    };
    let summary = if let Some(run_id) = run_id {
        conn.query_row(sql, params![run_id], run_summary_from_row)
            .optional()?
    } else {
        conn.query_row(sql, [], run_summary_from_row).optional()?
    };
    summary
        .map(|mut summary| {
            summary.lanes = query_lanes(conn, &summary.run_id, include_commands)?;
            summary.logs = query_events(conn, &summary.run_id)?;
            Ok(summary)
        })
        .transpose()
}

fn run_summary_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RunSummary> {
    let plan_path: Option<String> = row.get(12)?;
    let plan_hash: Option<String> = row.get(13)?;
    Ok(RunSummary {
        run_id: row.get(0)?,
        timestamp: row.get(1)?,
        profile: row.get(2)?,
        overall_pass: int_to_bool(row.get::<_, i64>(3)?),
        checks_run: row.get(4)?,
        checks_passed: row.get(5)?,
        checks_failed: row.get(6)?,
        config_hash: row.get(7)?,
        config_path: row.get(8)?,
        branch: row.get(9)?,
        head: row.get(10)?,
        dirty_tree_fingerprint: row.get(11)?,
        plan_identity: plan_path
            .zip(plan_hash)
            .map(|(path, hash)| PlanIdentitySummary { path, hash }),
        plan_hash: row.get(13)?,
        action: row.get(14)?,
        selection_mode: row.get(15)?,
        runner_version: row.get(16)?,
        source: row.get(17)?,
        logs: Vec::new(),
        lanes: BTreeMap::new(),
    })
}

fn query_lanes(
    conn: &Connection,
    run_id: &str,
    include_commands: bool,
) -> Result<BTreeMap<String, LaneSummary>> {
    let mut stmt = conn.prepare(
        "select check_id, status, exit_code, duration_ms, blocking, details, metadata
         from check_results where run_id = ?1 order by check_id",
    )?;
    let rows = stmt
        .query_map(params![run_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
                int_to_bool(row.get::<_, i64>(4)?),
                row.get::<_, String>(5)?,
                row.get::<_, Option<String>>(6)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut lanes = BTreeMap::new();
    for (check_id, status, exit_code, duration_ms, blocking, details, metadata) in rows {
        let mut lane = metadata
            .as_deref()
            .and_then(|value| serde_json::from_str::<LaneSummary>(value).ok())
            .unwrap_or(LaneSummary {
                status,
                exit_code,
                duration_ms,
                details,
                blocking,
                required: blocking,
                skippable: false,
                requires_reason_on_skip: false,
                default_profiles: Vec::new(),
                cost: "medium".to_string(),
                opens_window: false,
                ci_workflow: None,
                ci_job: None,
                ci_required: false,
                gate_strength: if blocking { "blocking" } else { "advisory" }.to_string(),
                determinism: "deterministic-runnable".to_string(),
                source_pack: None,
                tags: Vec::new(),
                severity: if blocking { "error" } else { "warning" }.to_string(),
                promotion_state: if blocking { "enforced" } else { "advisory" }.to_string(),
                owner: None,
                commands: Vec::new(),
            });
        if include_commands {
            lane.commands = query_commands(conn, run_id, &check_id)?;
        } else {
            lane.commands.clear();
        }
        lanes.insert(check_id, lane);
    }
    Ok(lanes)
}

fn query_events(conn: &Connection, run_id: &str) -> Result<Vec<RunEvent>> {
    let mut stmt = conn.prepare(
        "select timestamp, event, check_id, status
         from run_events where run_id = ?1 order by event_index",
    )?;
    let events = stmt
        .query_map(params![run_id], |row| {
            Ok(RunEvent {
                timestamp: row.get(0)?,
                event: row.get(1)?,
                check: row.get(2)?,
                status: row.get(3)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(events)
}

fn query_commands(conn: &Connection, run_id: &str, check_id: &str) -> Result<Vec<CommandSummary>> {
    let mut stmt = conn.prepare(
        "select command, exit_code, success, timed_out, duration_ms, stdout, stderr,
                stdout_bytes, stderr_bytes, truncated
         from command_results where run_id = ?1 and check_id = ?2
         order by command_index",
    )?;
    let commands = stmt
        .query_map(params![run_id, check_id], |row| {
            Ok(CommandSummary {
                command: row.get(0)?,
                exit_code: row.get(1)?,
                success: int_to_bool(row.get::<_, i64>(2)?),
                timed_out: int_to_bool(row.get::<_, i64>(3)?),
                duration_ms: row.get(4)?,
                stdout: row.get(5)?,
                stderr: row.get(6)?,
                stdout_bytes: row.get(7)?,
                stderr_bytes: row.get(8)?,
                truncated: int_to_bool(row.get::<_, i64>(9)?),
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(commands)
}

fn check_freshness(repo: &Path, run: &RunSummary, supplied_plan: Option<&Path>) -> Freshness {
    let git = current_git_evidence(repo);
    if (run.branch.is_some() || git.branch.is_some()) && git.branch != run.branch {
        return Freshness {
            fresh: false,
            reason: "branch-changed".to_string(),
        };
    }
    if (run.head.is_some() || git.head.is_some()) && git.head != run.head {
        return Freshness {
            fresh: false,
            reason: "head-changed".to_string(),
        };
    }
    if (run.dirty_tree_fingerprint.is_some() || git.dirty_tree_fingerprint.is_some())
        && git.dirty_tree_fingerprint != run.dirty_tree_fingerprint
    {
        return Freshness {
            fresh: false,
            reason: "working-tree-changed".to_string(),
        };
    }
    let repository_config_path = config::config_path(repo)
        .canonicalize()
        .unwrap_or_else(|_| config::config_path(repo));
    let uses_repository_config = run
        .config_path
        .as_ref()
        .map(|path| path == &repository_config_path.display().to_string())
        .unwrap_or(true);
    if uses_repository_config {
        match config::load_config(repo).and_then(|cfg| config_hash(&cfg)) {
            Ok(current_hash) if current_hash == run.config_hash => {}
            Ok(_) => {
                return Freshness {
                    fresh: false,
                    reason: "config-changed".to_string(),
                }
            }
            Err(_) if !repository_config_path.exists() => {}
            Err(_) => {
                return Freshness {
                    fresh: false,
                    reason: "config-unavailable".to_string(),
                }
            }
        }
    }
    if let Some(supplied_plan) = supplied_plan {
        match plan_identity_for_repo(repo, supplied_plan) {
            Some(current)
                if run
                    .plan_identity
                    .as_ref()
                    .is_some_and(|plan| plan.path == current.path && plan.hash == current.hash)
                    && run
                        .plan_hash
                        .as_deref()
                        .is_none_or(|hash| hash == current.hash) => {}
            _ => {
                return Freshness {
                    fresh: false,
                    reason: "plan-changed".to_string(),
                }
            }
        }
    } else if let Some(plan) = &run.plan_identity {
        match plan_hash(&plan.path) {
            Some(hash)
                if hash == plan.hash
                    && run.plan_hash.as_deref().is_none_or(|value| value == hash) => {}
            _ => {
                return Freshness {
                    fresh: false,
                    reason: "plan-changed".to_string(),
                }
            }
        }
    }
    Freshness {
        fresh: true,
        reason: "fresh".to_string(),
    }
}

fn current_git_evidence(repo: &Path) -> GitEvidence {
    git_evidence(repo)
}

fn plan_hash(path: &str) -> Option<String> {
    let bytes = fs::read(path).ok()?;
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    Some(format!("{:x}", hasher.finalize()))
}

fn plan_identity_for_repo(repo: &Path, path: &Path) -> Option<PlanIdentitySummary> {
    let resolved = if path.is_absolute() {
        path.to_path_buf()
    } else {
        repo.join(path)
    };
    let canonical = resolved.canonicalize().ok()?;
    Some(PlanIdentitySummary {
        path: canonical.display().to_string(),
        hash: plan_hash(&canonical.display().to_string())?,
    })
}

fn migrate(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        create table if not exists runs (
          run_id text primary key,
          repo_path text not null,
          profile text,
          started_at text not null,
          ended_at text not null,
          config_hash text not null,
          config_path text,
          overall_pass integer not null,
          checks_run integer not null,
          checks_passed integer not null,
          checks_failed integer not null
        );
        create table if not exists check_results (
          run_id text not null,
          check_id text not null,
          status text not null,
          exit_code integer not null,
          duration_ms integer not null,
          blocking integer not null,
          details text not null,
          metadata text
        );
        create table if not exists command_results (
          run_id text not null,
          check_id text not null,
          command_index integer not null,
          command text not null,
          exit_code integer not null,
          success integer not null,
          timed_out integer not null,
          duration_ms integer not null,
          stdout text not null,
          stderr text not null,
          stdout_bytes integer not null,
          stderr_bytes integer not null,
          truncated integer not null
        );
        create table if not exists run_events (
          run_id text not null,
          event_index integer not null,
          timestamp text not null,
          event text not null,
          check_id text not null,
          status text
        );
        ",
    )?;
    let existing_columns = table_columns(conn, "runs")?;
    for (name, definition) in [
        ("branch", "text"),
        ("head", "text"),
        ("dirty_tree_fingerprint", "text"),
        ("config_path", "text"),
        ("plan_path", "text"),
        ("plan_hash", "text"),
        ("action", "text"),
        ("selection_mode", "text"),
        ("runner_version", "text"),
        ("source", "text"),
    ] {
        if !existing_columns.iter().any(|column| column == name) {
            conn.execute(
                &format!("alter table runs add column {name} {definition}"),
                [],
            )?;
        }
    }
    let existing_check_columns = table_columns(conn, "check_results")?;
    if !existing_check_columns
        .iter()
        .any(|column| column == "metadata")
    {
        conn.execute("alter table check_results add column metadata text", [])?;
    }
    Ok(())
}

fn table_columns(conn: &Connection, table: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(&format!("pragma table_info({table})"))?;
    let columns = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(columns)
}

fn log_entry_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<LogEntry> {
    Ok(LogEntry {
        check_id: row.get(0)?,
        command_index: row.get(1)?,
        command: row.get(2)?,
        exit_code: row.get(3)?,
        success: int_to_bool(row.get::<_, i64>(4)?),
        timed_out: int_to_bool(row.get::<_, i64>(5)?),
        duration_ms: row.get(6)?,
        stdout: row.get(7)?,
        stderr: row.get(8)?,
        stdout_bytes: row.get(9)?,
        stderr_bytes: row.get(10)?,
        truncated: int_to_bool(row.get::<_, i64>(11)?),
    })
}

pub fn state_path(repo: &Path) -> Result<PathBuf> {
    let repo_id = repo_id(repo)?;
    Ok(elegy_home()?
        .join("repo-state")
        .join(repo_id)
        .join("checks")
        .join("checks.sqlite"))
}

pub fn repo_id(repo: &Path) -> Result<String> {
    let canonical = repo.canonicalize()?;
    let mut hasher = Sha256::new();
    hasher.update(canonical.to_string_lossy().as_bytes());
    Ok(format!("{:x}", hasher.finalize())[..12].to_string())
}

fn elegy_home() -> Result<PathBuf> {
    if let Ok(value) = env::var("ELEGY_HOME") {
        return Ok(PathBuf::from(value));
    }
    let home = env::var("USERPROFILE")
        .or_else(|_| env::var("HOME"))
        .context("Unable to resolve user home directory")?;
    Ok(PathBuf::from(home).join(".elegy"))
}

fn bool_to_int(value: bool) -> i64 {
    if value {
        1
    } else {
        0
    }
}

fn int_to_bool(value: i64) -> bool {
    value != 0
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{write_config, CheckConfig, ChecksConfig};
    use crate::runner::{run_checks_with_options, RunOptions, Selection};
    use serde_json::Value;
    use tempfile::tempdir;

    #[test]
    fn state_hydrates_latest_lanes_and_history_from_sqlite() {
        let _lock = TEST_STATE_LOCK.lock().unwrap();
        let home = tempdir().unwrap();
        std::env::set_var("ELEGY_HOME", home.path());
        let repo = tempdir().unwrap();
        let mut cfg = ChecksConfig {
            schema_version: 1,
            default_profile: Some("commit".to_string()),
            ..ChecksConfig::default()
        };
        cfg.checks.insert(
            "pass".to_string(),
            CheckConfig {
                commands: vec![if cfg!(windows) {
                    "echo pass"
                } else {
                    "printf pass"
                }
                .to_string()],
                default_profiles: vec!["commit".to_string()],
                ..CheckConfig::default()
            },
        );
        write_config(repo.path(), &cfg).unwrap();

        run_checks_with_options(repo.path(), RunOptions::default()).unwrap();
        run_checks_with_options(
            repo.path(),
            RunOptions {
                selection: Selection::AllEnabled,
                ..RunOptions::default()
            },
        )
        .unwrap();

        let state: Value = serde_json::to_value(read_state(repo.path()).unwrap()).unwrap();
        assert!(state["lastRun"]["lanes"]["pass"]["details"]
            .as_str()
            .is_some());
        assert_eq!(state["history"].as_array().unwrap().len(), 1);
        assert_eq!(state["history"][0]["selectionMode"], "default-profile");
    }

    #[test]
    fn freshness_invalidates_when_plan_changes() {
        let _lock = TEST_STATE_LOCK.lock().unwrap();
        let home = tempdir().unwrap();
        std::env::set_var("ELEGY_HOME", home.path());
        let repo = tempdir().unwrap();
        let mut cfg = ChecksConfig {
            schema_version: 1,
            default_profile: Some("commit".to_string()),
            ..ChecksConfig::default()
        };
        cfg.checks.insert(
            "pass".to_string(),
            CheckConfig {
                commands: vec![if cfg!(windows) {
                    "echo pass"
                } else {
                    "printf pass"
                }
                .to_string()],
                default_profiles: vec!["commit".to_string()],
                ..CheckConfig::default()
            },
        );
        write_config(repo.path(), &cfg).unwrap();
        let plan = repo.path().join("plan.md");
        std::fs::write(&plan, "one").unwrap();
        run_checks_with_options(
            repo.path(),
            RunOptions {
                plan: Some(plan.clone()),
                ..RunOptions::default()
            },
        )
        .unwrap();
        std::fs::write(&plan, "two").unwrap();

        let state = read_state(repo.path()).unwrap();
        assert!(!state.freshness.fresh);
        assert_eq!(state.freshness.reason, "plan-changed");
    }

    #[test]
    fn migrates_legacy_runs_without_replacing_records() {
        let _lock = TEST_STATE_LOCK.lock().unwrap();
        let home = tempdir().unwrap();
        std::env::set_var("ELEGY_HOME", home.path());
        let repo = tempdir().unwrap();
        let cfg = ChecksConfig {
            schema_version: 1,
            ..ChecksConfig::default()
        };
        write_config(repo.path(), &cfg).unwrap();
        let db_path = state_path(repo.path()).unwrap();
        std::fs::create_dir_all(db_path.parent().unwrap()).unwrap();
        let conn = Connection::open(&db_path).unwrap();
        conn.execute_batch(
            "create table runs (
                run_id text primary key, repo_path text not null, profile text,
                started_at text not null, ended_at text not null, config_hash text not null,
                overall_pass integer not null, checks_run integer not null,
                checks_passed integer not null, checks_failed integer not null
             );
             create table check_results (
                run_id text not null, check_id text not null, status text not null,
                exit_code integer not null, duration_ms integer not null,
                blocking integer not null, details text not null
             );
             create table command_results (
                run_id text not null, check_id text not null, command_index integer not null,
                command text not null, exit_code integer not null, success integer not null,
                timed_out integer not null, duration_ms integer not null, stdout text not null,
                stderr text not null, stdout_bytes integer not null, stderr_bytes integer not null,
                truncated integer not null
             );
             insert into runs values ('legacy', 'repo', 'commit', '2020-01-01', '2020-01-01',
                'legacy-config', 1, 1, 1, 0);
             insert into check_results values ('legacy', 'lint', 'PASS', 0, 3, 1, 'Passed');",
        )
        .unwrap();
        drop(conn);

        let state = read_state(repo.path()).unwrap();
        assert_eq!(state.last_run.as_ref().unwrap().run_id, "legacy");
        assert_eq!(
            state.last_run.as_ref().unwrap().lanes["lint"].details,
            "Passed"
        );
        let conn = Connection::open(db_path).unwrap();
        let count: i64 = conn
            .query_row("select count(*) from runs", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }
}
