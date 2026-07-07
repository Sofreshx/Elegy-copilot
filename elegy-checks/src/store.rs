use crate::config::{self, config_hash};
use crate::runner::RunResult;
use anyhow::{Context, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StateResult {
    pub repo_id: String,
    pub repo_path: String,
    pub has_state: bool,
    pub state_path: String,
    pub last_run: Option<RunSummary>,
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
            "insert into runs (run_id, repo_path, profile, started_at, ended_at, config_hash, overall_pass, checks_run, checks_passed, checks_failed)
         values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            result.run_id,
            result.repo_root,
            result.profile,
            result.timestamp,
            result.timestamp,
            result.config_hash,
            bool_to_int(result.overall_pass),
            result.checks_run as i64,
            result.checks_passed as i64,
            result.checks_failed as i64,
        ],
    )?;

    for (check_id, lane) in &result.lanes {
        conn.execute(
            "insert into check_results (run_id, check_id, status, exit_code, duration_ms, blocking, details)
             values (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                result.run_id,
                check_id,
                lane.status,
                lane.exit_code as i64,
                lane.duration_ms as i64,
                bool_to_int(lane.blocking),
                lane.details,
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
    Ok(())
}

pub fn read_state(repo: &Path) -> Result<StateResult> {
    let repo = config::normalize_repo(repo)?;
    let repo_id = repo_id(&repo)?;
    let db_path = state_path(&repo)?;
    let mut last_run = None;
    if db_path.exists() {
        let conn = Connection::open(&db_path)?;
        migrate(&conn)?;
        last_run = conn
            .query_row(
                "select run_id, started_at, profile, overall_pass, checks_run, checks_passed, checks_failed, config_hash
                 from runs order by started_at desc limit 1",
                [],
                |row| {
                    Ok(RunSummary {
                        run_id: row.get(0)?,
                        timestamp: row.get(1)?,
                        profile: row.get(2)?,
                        overall_pass: int_to_bool(row.get::<_, i64>(3)?),
                        checks_run: row.get(4)?,
                        checks_passed: row.get(5)?,
                        checks_failed: row.get(6)?,
                        config_hash: row.get(7)?,
                    })
                },
            )
            .optional()?;
    }

    let freshness = if let Some(run) = &last_run {
        match config::load_config(&repo).and_then(|cfg| config_hash(&cfg)) {
            Ok(current_hash) if current_hash == run.config_hash => Freshness {
                fresh: true,
                reason: "fresh".to_string(),
            },
            Ok(_) => Freshness {
                fresh: false,
                reason: "config-changed".to_string(),
            },
            Err(_) => Freshness {
                fresh: false,
                reason: "config-unavailable".to_string(),
            },
        }
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

pub fn read_history(repo: &Path, limit: Option<i64>, offset: Option<i64>) -> Result<HistoryResult> {
    let repo = config::normalize_repo(repo)?;
    let repo_id = repo_id(&repo)?;
    let db_path = state_path(&repo)?;
    let limit = limit.unwrap_or(25).clamp(1, 200);
    let offset = offset.unwrap_or(0).max(0);
    if !db_path.exists() {
        return Ok(HistoryResult {
            repo_id,
            limit,
            offset,
            next_offset: None,
            runs: Vec::new(),
        });
    }
    let conn = Connection::open(db_path)?;
    migrate(&conn)?;
    let mut stmt = conn.prepare(
        "select run_id, started_at, profile, overall_pass, checks_run, checks_passed, checks_failed, config_hash
         from runs order by started_at desc limit ?1 offset ?2",
    )?;
    let mut runs = stmt
        .query_map(params![limit + 1, offset], |row| {
            Ok(RunSummary {
                run_id: row.get(0)?,
                timestamp: row.get(1)?,
                profile: row.get(2)?,
                overall_pass: int_to_bool(row.get::<_, i64>(3)?),
                checks_run: row.get(4)?,
                checks_passed: row.get(5)?,
                checks_failed: row.get(6)?,
                config_hash: row.get(7)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let next_offset = if runs.len() as i64 > limit {
        runs.truncate(limit as usize);
        Some(offset + limit)
    } else {
        None
    };
    Ok(HistoryResult {
        repo_id,
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
          details text not null
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
        ",
    )?;
    Ok(())
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
