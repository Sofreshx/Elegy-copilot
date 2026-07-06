use crate::config::{ChecksConfig, CiRemoteOnly};
use anyhow::{Context, Result};
use serde::Serialize;
use serde_yaml::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Copy)]
pub enum Scope {
    Pr,
    MainPush,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CiMapResult {
    pub repo_root: String,
    pub scope: String,
    pub workflows: Vec<WorkflowSummary>,
    pub mappings: Vec<CiMapping>,
    pub summary: CiSummary,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowSummary {
    pub file_name: String,
    pub name: String,
    pub triggers: Vec<String>,
    pub is_pr_relevant: bool,
    pub is_main_push_relevant: bool,
    pub jobs: Vec<JobSummary>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobSummary {
    pub name: String,
    pub required: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CiMapping {
    pub workflow_file: String,
    pub job_name: String,
    pub required: bool,
    pub local_lanes: Vec<String>,
    pub status: String,
    pub remote_only_reason: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CiSummary {
    pub total_ci_jobs: usize,
    pub mapped: usize,
    pub remote_only: usize,
    pub gaps: usize,
    pub readiness: String,
}

pub fn map_ci(repo: &Path, config: &ChecksConfig, scope: Scope) -> Result<CiMapResult> {
    let repo = crate::config::normalize_repo(repo)?;
    let workflows = discover_workflows(&repo)?;
    let mappings = map_workflows(&workflows, config, scope);
    let mapped = mappings.iter().filter(|m| m.status == "mapped").count();
    let remote_only = mappings
        .iter()
        .filter(|m| m.status == "remote-only")
        .count();
    let gaps = mappings.iter().filter(|m| m.status == "ci-gap").count();
    let readiness = if mappings.is_empty() {
        "no-ci"
    } else if gaps == 0 {
        "ready"
    } else {
        "ci-gap"
    }
    .to_string();
    Ok(CiMapResult {
        repo_root: repo.display().to_string(),
        scope: match scope {
            Scope::Pr => "pr",
            Scope::MainPush => "main-push",
        }
        .to_string(),
        workflows,
        summary: CiSummary {
            total_ci_jobs: mappings.len(),
            mapped,
            remote_only,
            gaps,
            readiness,
        },
        mappings,
    })
}

fn discover_workflows(repo: &Path) -> Result<Vec<WorkflowSummary>> {
    let workflows_dir = repo.join(".github").join("workflows");
    if !workflows_dir.exists() {
        return Ok(Vec::new());
    }
    let mut workflows = Vec::new();
    for entry in fs::read_dir(&workflows_dir)? {
        let entry = entry?;
        let path = entry.path();
        let Some(ext) = path.extension().and_then(|value| value.to_str()) else {
            continue;
        };
        if ext != "yml" && ext != "yaml" {
            continue;
        }
        let file_name = entry.file_name().to_string_lossy().to_string();
        let text = fs::read_to_string(&path)
            .with_context(|| format!("Unable to read {}", path.display()))?;
        let value: Value = serde_yaml::from_str(&text)
            .with_context(|| format!("Invalid workflow YAML {}", path.display()))?;
        workflows.push(parse_workflow(file_name, value));
    }
    workflows.sort_by(|a, b| a.file_name.cmp(&b.file_name));
    Ok(workflows)
}

fn parse_workflow(file_name: String, value: Value) -> WorkflowSummary {
    let name = get_string_key(&value, "name").unwrap_or_else(|| "unnamed".to_string());
    let on = get_key(&value, "on");
    let triggers = trigger_names(on);
    let is_pr_relevant = triggers.iter().any(|trigger| trigger == "pull_request");
    let is_main_push_relevant = has_main_push(on);
    let jobs_value = get_key(&value, "jobs");
    let rich_jobs = parse_jobs(jobs_value);
    let gate_needs = rich_jobs
        .get("required-checks")
        .or_else(|| rich_jobs.get("required-check"))
        .or_else(|| rich_jobs.get("gate"))
        .map(|job| job.needs.clone())
        .unwrap_or_default();
    let has_gate = !gate_needs.is_empty();
    let jobs = rich_jobs
        .into_iter()
        .map(|(name, job)| JobSummary {
            name,
            required: (is_pr_relevant || is_main_push_relevant)
                && (!has_gate || gate_needs.contains(&job.name)),
        })
        .collect();
    WorkflowSummary {
        file_name,
        name,
        triggers,
        is_pr_relevant,
        is_main_push_relevant,
        jobs,
    }
}

#[derive(Debug, Clone)]
struct RichJob {
    name: String,
    needs: BTreeSet<String>,
}

fn parse_jobs(value: Option<&Value>) -> BTreeMap<String, RichJob> {
    let mut jobs = BTreeMap::new();
    let Some(Value::Mapping(mapping)) = value else {
        return jobs;
    };
    for (key, value) in mapping {
        let Some(name) = key.as_str().map(ToOwned::to_owned) else {
            continue;
        };
        let needs = get_key(value, "needs").map(parse_needs).unwrap_or_default();
        jobs.insert(name.clone(), RichJob { name, needs });
    }
    jobs
}

fn parse_needs(value: &Value) -> BTreeSet<String> {
    match value {
        Value::String(value) => [value.clone()].into_iter().collect(),
        Value::Sequence(values) => values
            .iter()
            .filter_map(|value| value.as_str().map(ToOwned::to_owned))
            .collect(),
        _ => BTreeSet::new(),
    }
}

fn trigger_names(value: Option<&Value>) -> Vec<String> {
    match value {
        Some(Value::String(value)) => vec![value.clone()],
        Some(Value::Sequence(values)) => values
            .iter()
            .filter_map(|value| value.as_str().map(ToOwned::to_owned))
            .collect(),
        Some(Value::Mapping(mapping)) => mapping
            .keys()
            .filter_map(|key| key.as_str().map(ToOwned::to_owned))
            .collect(),
        _ => Vec::new(),
    }
}

fn has_main_push(on: Option<&Value>) -> bool {
    let Some(on) = on else {
        return false;
    };
    match on {
        Value::String(value) => value == "push",
        Value::Sequence(values) => values.iter().any(|value| value.as_str() == Some("push")),
        Value::Mapping(mapping) => {
            let push = mapping.iter().find(|(key, _)| key.as_str() == Some("push"));
            let Some((_, push_value)) = push else {
                return false;
            };
            match push_value {
                Value::Null => true,
                Value::Mapping(push_mapping) => {
                    let branches = push_mapping
                        .iter()
                        .find(|(key, _)| key.as_str() == Some("branches"))
                        .map(|(_, value)| parse_string_list(value));
                    match branches {
                        Some(branches) => branches
                            .iter()
                            .any(|branch| branch == "main" || branch == "*" || branch == "**"),
                        None => true,
                    }
                }
                _ => true,
            }
        }
        _ => false,
    }
}

fn parse_string_list(value: &Value) -> Vec<String> {
    match value {
        Value::String(value) => vec![value.clone()],
        Value::Sequence(values) => values
            .iter()
            .filter_map(|value| value.as_str().map(ToOwned::to_owned))
            .collect(),
        _ => Vec::new(),
    }
}

fn map_workflows(
    workflows: &[WorkflowSummary],
    config: &ChecksConfig,
    scope: Scope,
) -> Vec<CiMapping> {
    let mut remote_only = BTreeMap::new();
    for entry in &config.ci_remote_only {
        remote_only.insert(remote_key(entry), entry.reason.clone());
    }

    let mut mappings = Vec::new();
    for workflow in workflows {
        let in_scope = match scope {
            Scope::Pr => workflow.is_pr_relevant,
            Scope::MainPush => workflow.is_main_push_relevant,
        };
        if !in_scope {
            continue;
        }
        for job in &workflow.jobs {
            if is_gate_job(&job.name) {
                continue;
            }
            let local_lanes = config
                .checks
                .iter()
                .filter(|(_, check)| {
                    check.ci_workflow.as_deref() == Some(workflow.file_name.as_str())
                        && check.ci_job.as_deref() == Some(job.name.as_str())
                })
                .map(|(name, _)| name.clone())
                .collect::<Vec<_>>();
            let key = format!("{}/{}", workflow.file_name, job.name);
            let remote_only_reason = remote_only.get(&key).cloned();
            let status = if !local_lanes.is_empty() {
                "mapped"
            } else if remote_only_reason.is_some() {
                "remote-only"
            } else {
                "ci-gap"
            }
            .to_string();
            mappings.push(CiMapping {
                workflow_file: workflow.file_name.clone(),
                job_name: job.name.clone(),
                required: job.required,
                local_lanes,
                status,
                remote_only_reason,
            });
        }
    }
    mappings
}

fn get_key<'a>(value: &'a Value, key: &str) -> Option<&'a Value> {
    let Value::Mapping(mapping) = value else {
        return None;
    };
    mapping.iter().find_map(|(candidate, value)| {
        if candidate.as_str() == Some(key) {
            Some(value)
        } else {
            None
        }
    })
}

fn get_string_key(value: &Value, key: &str) -> Option<String> {
    get_key(value, key)?.as_str().map(ToOwned::to_owned)
}

fn is_gate_job(job: &str) -> bool {
    matches!(
        job,
        "required-checks" | "required-check" | "gate" | "enforce"
    )
}

fn remote_key(entry: &CiRemoteOnly) -> String {
    format!("{}/{}", entry.workflow, entry.job)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{CheckConfig, ChecksConfig};
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn maps_required_jobs_to_local_checks_and_gaps() {
        let dir = tempdir().unwrap();
        fs::create_dir_all(dir.path().join(".github/workflows")).unwrap();
        fs::write(
            dir.path().join(".github/workflows/repo-ci.yml"),
            r#"
name: Repo CI
on:
  pull_request:
    branches: [main]
jobs:
  build:
    runs-on: ubuntu-latest
  required-checks:
    if: always()
    needs: [build]
"#,
        )
        .unwrap();
        let mut cfg = ChecksConfig {
            schema_version: 1,
            ..ChecksConfig::default()
        };
        cfg.checks.insert(
            "ci-local".to_string(),
            CheckConfig {
                ci_workflow: Some("repo-ci.yml".to_string()),
                ci_job: Some("build".to_string()),
                commands: vec!["true".to_string()],
                ..CheckConfig::default()
            },
        );
        let result = map_ci(dir.path(), &cfg, Scope::Pr).unwrap();
        assert_eq!(result.summary.total_ci_jobs, 1);
        assert_eq!(result.summary.mapped, 1);
        assert_eq!(result.summary.gaps, 0);
    }
}
