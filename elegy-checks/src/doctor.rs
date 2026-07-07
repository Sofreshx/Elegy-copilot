use crate::{ci, config, store};
use anyhow::Result;
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoctorResult {
    pub repo_root: String,
    pub binary_version: String,
    pub config: DoctorCheck,
    pub state: DoctorCheck,
    pub pr_ci: DoctorCheck,
    pub main_push_ci: DoctorCheck,
    pub overall: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoctorCheck {
    pub status: String,
    pub detail: String,
}

pub fn diagnose(repo: &Path) -> Result<DoctorResult> {
    let repo = config::normalize_repo(repo)?;
    let binary_version = env!("CARGO_PKG_VERSION").to_string();
    let validation = config::validate_repo(&repo);
    let config_check = match &validation {
        Ok(result) if result.valid => DoctorCheck {
            status: "ok".to_string(),
            detail: format!("{} checks configured", result.check_count),
        },
        Ok(result) => DoctorCheck {
            status: "error".to_string(),
            detail: result.errors.join("; "),
        },
        Err(error) => DoctorCheck {
            status: "error".to_string(),
            detail: error.to_string(),
        },
    };

    let state = store::read_state(&repo);
    let state_check = match &state {
        Ok(result) if result.has_state => DoctorCheck {
            status: "ok".to_string(),
            detail: format!("state at {}", result.state_path),
        },
        Ok(_) => DoctorCheck {
            status: "warn".to_string(),
            detail: "no prior check run".to_string(),
        },
        Err(error) => DoctorCheck {
            status: "error".to_string(),
            detail: error.to_string(),
        },
    };

    let cfg = config::load_config(&repo)?;
    let pr_ci = ci::map_ci(&repo, &cfg, ci::Scope::Pr);
    let pr_ci_check = ci_check(pr_ci);
    let main_push_ci = ci::map_ci(&repo, &cfg, ci::Scope::MainPush);
    let main_push_ci_check = ci_check(main_push_ci);
    let overall = if [
        &config_check,
        &state_check,
        &pr_ci_check,
        &main_push_ci_check,
    ]
    .iter()
    .any(|check| check.status == "error")
    {
        "error"
    } else if [&state_check, &pr_ci_check, &main_push_ci_check]
        .iter()
        .any(|check| check.status == "warn")
    {
        "warn"
    } else {
        "ok"
    }
    .to_string();

    Ok(DoctorResult {
        repo_root: repo.display().to_string(),
        binary_version,
        config: config_check,
        state: state_check,
        pr_ci: pr_ci_check,
        main_push_ci: main_push_ci_check,
        overall,
    })
}

fn ci_check(result: Result<ci::CiMapResult>) -> DoctorCheck {
    match result {
        Ok(result) if result.summary.gaps == 0 => DoctorCheck {
            status: "ok".to_string(),
            detail: format!(
                "{} mapped, {} remote-only",
                result.summary.mapped, result.summary.remote_only
            ),
        },
        Ok(result) => DoctorCheck {
            status: "warn".to_string(),
            detail: format!("{} CI gaps", result.summary.gaps),
        },
        Err(error) => DoctorCheck {
            status: "error".to_string(),
            detail: error.to_string(),
        },
    }
}
