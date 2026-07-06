use anyhow::{anyhow, Context, Result};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

pub const CONFIG_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ChecksConfig {
    pub schema_version: u32,
    #[serde(default = "default_config_version")]
    pub config_version: u32,
    #[serde(default)]
    pub generated: Option<String>,
    #[serde(default)]
    pub default_profile: Option<String>,
    #[serde(default)]
    pub profiles: BTreeMap<String, ProfileConfig>,
    #[serde(default)]
    pub groups: BTreeMap<String, GroupConfig>,
    #[serde(default)]
    pub ci_remote_only: Vec<CiRemoteOnly>,
    #[serde(default)]
    pub checks: BTreeMap<String, CheckConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProfileConfig {
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub cost: String,
    #[serde(default)]
    pub opens_window: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GroupConfig {
    #[serde(default)]
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CiRemoteOnly {
    #[serde(default, alias = "workflowFile")]
    pub workflow: String,
    #[serde(default, alias = "jobName")]
    pub job: String,
    #[serde(default)]
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub group: Option<String>,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_cwd")]
    pub cwd: String,
    #[serde(default = "default_timeout_ms")]
    pub timeout_ms: u64,
    #[serde(default = "default_true")]
    pub blocking: bool,
    #[serde(default = "default_true")]
    pub required: bool,
    #[serde(default)]
    pub skippable: bool,
    #[serde(default)]
    pub requires_reason_on_skip: bool,
    #[serde(default)]
    pub default_profiles: Vec<String>,
    #[serde(default = "default_cost")]
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
    pub commands: Vec<String>,
}

impl Default for CheckConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            group: None,
            description: String::new(),
            cwd: default_cwd(),
            timeout_ms: default_timeout_ms(),
            blocking: true,
            required: true,
            skippable: false,
            requires_reason_on_skip: false,
            default_profiles: Vec::new(),
            cost: default_cost(),
            opens_window: false,
            ci_workflow: None,
            ci_job: None,
            ci_required: false,
            commands: Vec::new(),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitResult {
    pub repo_root: String,
    pub config_path: String,
    pub created: bool,
    pub imported_copilot: bool,
    pub check_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationResult {
    pub repo_root: String,
    pub config_path: String,
    pub valid: bool,
    pub errors: Vec<String>,
    pub check_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverResult {
    pub repo_root: String,
    pub source: String,
    pub checks_available: usize,
    pub profiles: BTreeMap<String, ProfileConfig>,
    pub groups: BTreeMap<String, GroupConfig>,
    pub checks: Vec<DiscoveredCheck>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredCheck {
    pub name: String,
    pub path: String,
    pub description: String,
    pub group: Option<String>,
    pub blocking: bool,
    pub ci_workflow: Option<String>,
    pub ci_job: Option<String>,
    pub ci_required: bool,
    pub required: bool,
    pub skippable: bool,
    pub requires_reason_on_skip: bool,
    pub default_profiles: Vec<String>,
    pub cost: String,
    pub opens_window: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterResult {
    pub repo_root: String,
    pub config_path: String,
    pub check: String,
    pub profile: String,
    pub updated: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CopilotConfig {
    #[serde(default)]
    profiles: BTreeMap<String, ProfileConfig>,
    #[serde(default)]
    groups: BTreeMap<String, GroupConfig>,
    #[serde(default)]
    ci_remote_only: Vec<CiRemoteOnly>,
    #[serde(default)]
    lanes: BTreeMap<String, CheckConfig>,
}

pub fn init_repo(repo: &Path, import_copilot: bool) -> Result<InitResult> {
    let repo = normalize_repo(repo)?;
    let config_path = config_path(&repo);
    let mut imported_copilot = false;
    let mut created = false;

    let config = if config_path.exists() {
        load_config(&repo)?
    } else if import_copilot && copilot_config_path(&repo).exists() {
        imported_copilot = true;
        created = true;
        import_copilot_config(&repo)?
    } else {
        created = true;
        default_config()
    };

    if created {
        write_config(&repo, &config)?;
    }

    Ok(InitResult {
        repo_root: repo.display().to_string(),
        config_path: config_path.display().to_string(),
        created,
        imported_copilot,
        check_count: config.checks.len(),
    })
}

pub fn validate_repo(repo: &Path) -> Result<ValidationResult> {
    let repo = normalize_repo(repo)?;
    let config_path = config_path(&repo);
    let config = load_config(&repo)?;
    let errors = validate_config(&config);
    Ok(ValidationResult {
        repo_root: repo.display().to_string(),
        config_path: config_path.display().to_string(),
        valid: errors.is_empty(),
        errors,
        check_count: config.checks.len(),
    })
}

pub fn discover(repo: &Path, config: &ChecksConfig) -> DiscoverResult {
    let checks = config
        .checks
        .iter()
        .filter(|(_, check)| check.enabled)
        .map(|(name, check)| DiscoveredCheck {
            name: name.clone(),
            path: if check.commands.is_empty() {
                "(configured)".to_string()
            } else {
                check.commands.join(", ")
            },
            description: check.description.clone(),
            group: check.group.clone(),
            blocking: check.blocking,
            ci_workflow: check.ci_workflow.clone().filter(|v| !v.is_empty()),
            ci_job: check.ci_job.clone().filter(|v| !v.is_empty()),
            ci_required: check.ci_required,
            required: check.required,
            skippable: check.skippable,
            requires_reason_on_skip: check.requires_reason_on_skip,
            default_profiles: check.default_profiles.clone(),
            cost: check.cost.clone(),
            opens_window: check.opens_window,
        })
        .collect::<Vec<_>>();

    DiscoverResult {
        repo_root: repo.display().to_string(),
        source: "elegy-checks".to_string(),
        checks_available: checks.len(),
        profiles: config.profiles.clone(),
        groups: config.groups.clone(),
        checks,
    }
}

pub fn register_check(
    repo: &Path,
    check_id: &str,
    command: &str,
    profile: &str,
) -> Result<RegisterResult> {
    let repo = normalize_repo(repo)?;
    validate_id(check_id)?;
    validate_id(profile)?;
    let mut config = if config_path(&repo).exists() {
        load_config(&repo)?
    } else {
        default_config()
    };

    config
        .profiles
        .entry(profile.to_string())
        .or_insert(ProfileConfig {
            label: profile.to_string(),
            description: String::new(),
            cost: "medium".to_string(),
            opens_window: false,
        });

    let entry = config
        .checks
        .entry(check_id.to_string())
        .or_insert_with(CheckConfig::default);
    entry.enabled = true;
    entry.commands = vec![command.to_string()];
    if !entry.default_profiles.iter().any(|value| value == profile) {
        entry.default_profiles.push(profile.to_string());
    }
    if entry.description.is_empty() {
        entry.description = format!("{check_id} check");
    }

    config.config_version += 1;
    write_config(&repo, &config)?;

    Ok(RegisterResult {
        repo_root: repo.display().to_string(),
        config_path: config_path(&repo).display().to_string(),
        check: check_id.to_string(),
        profile: profile.to_string(),
        updated: true,
    })
}

pub fn load_config(repo: &Path) -> Result<ChecksConfig> {
    let repo = normalize_repo(repo)?;
    let path = config_path(&repo);
    let raw =
        fs::read_to_string(&path).with_context(|| format!("Unable to read {}", path.display()))?;
    let config: ChecksConfig = serde_json::from_str(&raw)
        .with_context(|| format!("Invalid JSON in {}", path.display()))?;
    let errors = validate_config(&config);
    if !errors.is_empty() {
        return Err(anyhow!("Invalid checks config: {}", errors.join("; ")));
    }
    Ok(config)
}

pub fn write_config(repo: &Path, config: &ChecksConfig) -> Result<()> {
    let path = config_path(repo);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&path, serde_json::to_string_pretty(config)? + "\n")?;
    Ok(())
}

pub fn config_hash(config: &ChecksConfig) -> Result<String> {
    let bytes = serde_json::to_vec(config)?;
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    Ok(format!("{:x}", hasher.finalize()))
}

pub fn normalize_repo(repo: &Path) -> Result<PathBuf> {
    repo.canonicalize()
        .with_context(|| format!("Unable to resolve repo path {}", repo.display()))
}

pub fn config_path(repo: &Path) -> PathBuf {
    repo.join(".elegy").join("checks.json")
}

fn copilot_config_path(repo: &Path) -> PathBuf {
    repo.join(".copilot").join("commit-checks.json")
}

fn import_copilot_config(repo: &Path) -> Result<ChecksConfig> {
    let raw = fs::read_to_string(copilot_config_path(repo))?;
    let copilot: CopilotConfig = serde_json::from_str(&raw)?;
    let mut config = default_config();
    config.generated = Some(Utc::now().to_rfc3339());
    config.profiles = copilot.profiles;
    config.groups = copilot.groups;
    config.ci_remote_only = copilot.ci_remote_only;
    config.checks = copilot.lanes;
    if config.default_profile.is_none() {
        config.default_profile = Some("commit".to_string());
    }
    Ok(config)
}

fn default_config() -> ChecksConfig {
    let mut profiles = BTreeMap::new();
    profiles.insert(
        "commit".to_string(),
        ProfileConfig {
            label: "Commit".to_string(),
            description: "Fast mandatory local gate".to_string(),
            cost: "fast".to_string(),
            opens_window: false,
        },
    );
    profiles.insert(
        "ci-local".to_string(),
        ProfileConfig {
            label: "CI Local".to_string(),
            description: "Local CI parity gate".to_string(),
            cost: "medium".to_string(),
            opens_window: false,
        },
    );

    ChecksConfig {
        schema_version: CONFIG_SCHEMA_VERSION,
        config_version: 1,
        generated: Some(Utc::now().to_rfc3339()),
        default_profile: Some("commit".to_string()),
        profiles,
        groups: BTreeMap::new(),
        ci_remote_only: Vec::new(),
        checks: BTreeMap::new(),
    }
}

fn validate_config(config: &ChecksConfig) -> Vec<String> {
    let mut errors = Vec::new();
    if config.schema_version != CONFIG_SCHEMA_VERSION {
        errors.push(format!("schemaVersion must be {CONFIG_SCHEMA_VERSION}"));
    }
    for (name, check) in &config.checks {
        if validate_id(name).is_err() {
            errors.push(format!("invalid check id: {name}"));
        }
        if check.enabled && check.commands.is_empty() {
            errors.push(format!("check {name} has no commands"));
        }
        if check.timeout_ms == 0 {
            errors.push(format!("check {name} timeoutMs must be greater than 0"));
        }
        if !check.blocking && check.required {
            errors.push(format!(
                "check {name} cannot be required when blocking is false"
            ));
        }
    }
    errors
}

fn validate_id(value: &str) -> Result<()> {
    let valid = !value.is_empty()
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.');
    if valid {
        Ok(())
    } else {
        Err(anyhow!(
            "ids may contain only ASCII letters, digits, '.', '_' and '-'"
        ))
    }
}

fn default_config_version() -> u32 {
    1
}

fn default_true() -> bool {
    true
}

fn default_cwd() -> String {
    ".".to_string()
}

fn default_timeout_ms() -> u64 {
    120_000
}

fn default_cost() -> String {
    "medium".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn imports_copilot_lanes_as_checks() {
        let dir = tempdir().unwrap();
        fs::create_dir_all(dir.path().join(".copilot")).unwrap();
        fs::write(
            dir.path().join(".copilot/commit-checks.json"),
            r#"{
              "profiles": {"commit": {"label": "Commit"}},
              "lanes": {
                "lint": {
                  "commands": ["cargo clippy"],
                  "defaultProfiles": ["commit"],
                  "blocking": true,
                  "required": true
                }
              }
            }"#,
        )
        .unwrap();

        let result = init_repo(dir.path(), true).unwrap();
        assert!(result.created);
        assert!(result.imported_copilot);
        let config = load_config(dir.path()).unwrap();
        assert!(config.checks.contains_key("lint"));
        assert_eq!(config.checks["lint"].commands, vec!["cargo clippy"]);
    }
}
