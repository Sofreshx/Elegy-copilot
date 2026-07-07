use crate::config::{self, CheckConfig, ChecksConfig};
use anyhow::{anyhow, Result};
use serde::Serialize;
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckPack {
    pub id: String,
    pub version: String,
    pub description: String,
    pub checks: Vec<PackCheck>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackCheck {
    pub id: String,
    pub description: String,
    pub commands: Vec<String>,
    pub group: String,
    pub default_profiles: Vec<String>,
    pub gate_strength: String,
    pub determinism: String,
    pub severity: String,
    pub tags: Vec<String>,
    pub timeout_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PacksListResult {
    pub packs: Vec<CheckPack>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditResult {
    pub repo_root: String,
    pub detected_stacks: Vec<String>,
    pub proposals: Vec<AuditProposal>,
    pub summary: AuditSummary,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditProposal {
    pub id: String,
    pub pack: String,
    pub check_id: String,
    pub status: String,
    pub gate_strength: String,
    pub severity: String,
    pub reason: String,
    pub commands: Vec<String>,
    pub tags: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditSummary {
    pub proposal_count: usize,
    pub missing: usize,
    pub configured: usize,
    pub advisory: usize,
    pub blocking: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyResult {
    pub repo_root: String,
    pub config_path: String,
    pub applied: Vec<String>,
    pub skipped: Vec<String>,
    pub check_count: usize,
}

pub fn list_packs() -> PacksListResult {
    PacksListResult {
        packs: builtin_packs(),
    }
}

pub fn show_pack(id: &str) -> Result<CheckPack> {
    builtin_packs()
        .into_iter()
        .find(|pack| pack.id == id)
        .ok_or_else(|| anyhow!("Unknown check pack: {id}"))
}

pub fn audit_repo(repo: &Path) -> Result<AuditResult> {
    let repo = config::normalize_repo(repo)?;
    let cfg = if config::config_path(&repo).exists() {
        config::load_config(&repo)?
    } else {
        ChecksConfig::default()
    };
    let detected = detect_stacks(&repo);
    let mut proposals = Vec::new();
    for pack in active_packs(&detected) {
        for check in &pack.checks {
            let materialized = materialize_check(&repo, check);
            if !check_applicable(&repo, &materialized) {
                continue;
            }
            let status = if cfg.checks.contains_key(&check.id) {
                "configured"
            } else {
                "missing"
            }
            .to_string();
            proposals.push(AuditProposal {
                id: format!("{}/{}", pack.id, check.id),
                pack: pack.id.clone(),
                check_id: check.id.clone(),
                status,
                gate_strength: check.gate_strength.clone(),
                severity: check.severity.clone(),
                reason: check.description.clone(),
                commands: materialized.commands,
                tags: check.tags.clone(),
            });
        }
    }
    let summary = summarize(&proposals);
    Ok(AuditResult {
        repo_root: repo.display().to_string(),
        detected_stacks: detected.into_iter().collect(),
        proposals,
        summary,
    })
}

pub fn apply_repo(repo: &Path, proposal: Option<&str>, all: bool) -> Result<ApplyResult> {
    let repo = config::normalize_repo(repo)?;
    let mut cfg = if config::config_path(&repo).exists() {
        config::load_config(&repo)?
    } else {
        ChecksConfig {
            schema_version: config::CONFIG_SCHEMA_VERSION,
            default_profile: Some("commit".to_string()),
            ..ChecksConfig::default()
        }
    };
    let audit = audit_repo(&repo)?;
    let mut applied = Vec::new();
    let mut skipped = Vec::new();
    for item in &audit.proposals {
        let selected =
            all || proposal == Some(item.id.as_str()) || proposal == Some(item.check_id.as_str());
        if !selected || item.status != "missing" {
            skipped.push(item.id.clone());
            continue;
        }
        let Some(mut pack_check) = find_pack_check(&item.pack, &item.check_id) else {
            skipped.push(item.id.clone());
            continue;
        };
        pack_check.commands = item.commands.clone();
        cfg.checks.insert(
            pack_check.id.clone(),
            pack_check.to_check_config(&item.pack),
        );
        applied.push(item.id.clone());
    }
    if applied.is_empty() && !all && proposal.is_none() {
        return Err(anyhow!("Pass --all or --proposal <id>"));
    }
    cfg.schema_version = config::CONFIG_SCHEMA_VERSION;
    cfg.config_version += 1;
    config::write_config(&repo, &cfg)?;
    Ok(ApplyResult {
        repo_root: repo.display().to_string(),
        config_path: config::config_path(&repo).display().to_string(),
        applied,
        skipped,
        check_count: cfg.checks.len(),
    })
}

fn summarize(proposals: &[AuditProposal]) -> AuditSummary {
    AuditSummary {
        proposal_count: proposals.len(),
        missing: proposals.iter().filter(|p| p.status == "missing").count(),
        configured: proposals
            .iter()
            .filter(|p| p.status == "configured")
            .count(),
        advisory: proposals
            .iter()
            .filter(|p| p.gate_strength == "advisory")
            .count(),
        blocking: proposals
            .iter()
            .filter(|p| p.gate_strength == "blocking")
            .count(),
    }
}

fn active_packs(detected: &BTreeSet<String>) -> Vec<CheckPack> {
    builtin_packs()
        .into_iter()
        .filter(|pack| pack.id == "core" || detected.contains(&pack.id))
        .collect()
}

fn find_pack_check(pack_id: &str, check_id: &str) -> Option<PackCheck> {
    show_pack(pack_id)
        .ok()?
        .checks
        .into_iter()
        .find(|check| check.id == check_id)
}

fn check_applicable(repo: &Path, check: &PackCheck) -> bool {
    check
        .commands
        .iter()
        .all(|command| command_available(repo, command))
}

fn materialize_check(repo: &Path, check: &PackCheck) -> PackCheck {
    if !check
        .commands
        .iter()
        .any(|command| command.starts_with("cargo "))
        || repo.join("Cargo.toml").exists()
    {
        return check.clone();
    }
    let manifests = cargo_manifests(repo);
    if manifests.is_empty() {
        return check.clone();
    }
    let mut next = check.clone();
    next.commands = manifests
        .iter()
        .flat_map(|manifest| {
            check.commands.iter().map(move |command| {
                let manifest = manifest.to_string_lossy().replace('\\', "/");
                if command == "cargo fmt -- --check" {
                    format!("cargo fmt --manifest-path {manifest} -- --check")
                } else if let Some(rest) = command.strip_prefix("cargo clippy ") {
                    format!("cargo clippy --manifest-path {manifest} {rest}")
                } else if command == "cargo test" {
                    format!("cargo test --manifest-path {manifest}")
                } else {
                    command.to_string()
                }
            })
        })
        .collect();
    next
}

fn cargo_manifests(repo: &Path) -> Vec<PathBuf> {
    let mut manifests = Vec::new();
    let mut stack = vec![repo.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let file_name = entry.file_name();
            if file_name == "node_modules" || file_name == "target" || file_name == ".git" {
                continue;
            }
            if file_name == "Cargo.toml" {
                if let Ok(rel) = path.strip_prefix(repo) {
                    manifests.push(rel.to_path_buf());
                }
            } else if path.is_dir() {
                stack.push(path);
            }
        }
    }
    manifests.sort();
    manifests
}

fn command_available(repo: &Path, command: &str) -> bool {
    if command.starts_with("npm run ") {
        let script = command
            .trim_start_matches("npm run ")
            .split_whitespace()
            .next()
            .unwrap_or_default();
        return package_has_script(&repo.join("package.json"), script);
    }
    if command.starts_with("npm --prefix ") {
        let mut parts = command.split_whitespace();
        let _npm = parts.next();
        let _prefix = parts.next();
        let Some(prefix_path) = parts.next() else {
            return false;
        };
        let _run = parts.next();
        let Some(script) = parts.next() else {
            return false;
        };
        return package_has_script(&repo.join(prefix_path).join("package.json"), script);
    }
    if command.starts_with("node ") {
        let script = command
            .trim_start_matches("node ")
            .split_whitespace()
            .next()
            .unwrap_or_default();
        return repo.join(script).exists();
    }
    if command.starts_with("cargo ") {
        return repo.join("Cargo.toml").exists() || !cargo_manifests(repo).is_empty();
    }
    true
}

fn package_has_script(path: &Path, script: &str) -> bool {
    let Ok(raw) = fs::read_to_string(path) else {
        return false;
    };
    let Ok(json) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return false;
    };
    json.get("scripts")
        .and_then(|scripts| scripts.get(script))
        .is_some()
}

fn detect_stacks(repo: &Path) -> BTreeSet<String> {
    let mut stacks = BTreeSet::new();
    if repo.join("package.json").exists() {
        stacks.insert("node-typescript".to_string());
    }
    if has_file_named(repo, "tsconfig.json") {
        stacks.insert("node-typescript".to_string());
    }
    if has_dependency(repo, "react") || has_dependency(repo, "vite") {
        stacks.insert("react-vite".to_string());
    }
    if has_file_named(repo, "Cargo.toml") {
        stacks.insert("rust".to_string());
    }
    if has_file_named(repo, "tauri.conf.json") || has_file_named(repo, "tauri.conf.json5") {
        stacks.insert("tauri".to_string());
    }
    if repo.join("docs").exists() || repo.join("README.md").exists() {
        stacks.insert("docs".to_string());
    }
    if repo.join("docs/specs").exists() {
        stacks.insert("specs".to_string());
    }
    if repo.join("AGENTS.md").exists() || repo.join(".github/copilot-instructions.md").exists() {
        stacks.insert("agents-instructions".to_string());
    }
    if repo.join(".github/workflows").exists() {
        stacks.insert("github-actions".to_string());
    }
    stacks.insert("security-basics".to_string());
    stacks
}

fn has_file_named(repo: &Path, name: &str) -> bool {
    let mut stack = vec![repo.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let file_name = entry.file_name();
            if file_name == "node_modules" || file_name == "target" || file_name == ".git" {
                continue;
            }
            if file_name == name {
                return true;
            }
            if path.is_dir() {
                stack.push(path);
            }
        }
    }
    false
}

fn has_dependency(repo: &Path, dep: &str) -> bool {
    for package in package_json_files(repo) {
        let Ok(raw) = fs::read_to_string(package) else {
            continue;
        };
        let Ok(json) = serde_json::from_str::<serde_json::Value>(&raw) else {
            continue;
        };
        for key in ["dependencies", "devDependencies", "peerDependencies"] {
            if json.get(key).and_then(|deps| deps.get(dep)).is_some() {
                return true;
            }
        }
    }
    false
}

fn package_json_files(repo: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    let mut stack = vec![repo.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let file_name = entry.file_name();
            if file_name == "node_modules" || file_name == "target" || file_name == ".git" {
                continue;
            }
            if file_name == "package.json" {
                files.push(path);
            } else if path.is_dir() {
                stack.push(path);
            }
        }
    }
    files
}

impl PackCheck {
    fn to_check_config(&self, pack_id: &str) -> CheckConfig {
        CheckConfig {
            enabled: true,
            group: Some(self.group.clone()),
            description: self.description.clone(),
            timeout_ms: self.timeout_ms,
            blocking: self.gate_strength == "blocking",
            required: self.gate_strength == "blocking",
            default_profiles: self.default_profiles.clone(),
            commands: self.commands.clone(),
            gate_strength: self.gate_strength.clone(),
            determinism: self.determinism.clone(),
            source_pack: Some(pack_id.to_string()),
            tags: self.tags.clone(),
            severity: self.severity.clone(),
            promotion_state: if self.gate_strength == "blocking" {
                "enforced".to_string()
            } else {
                "advisory".to_string()
            },
            ..CheckConfig::default()
        }
    }
}

fn builtin_packs() -> Vec<CheckPack> {
    vec![
        pack(
            "core",
            "Common repository checks",
            vec![
                check(
                    "ci-local",
                    "Run the repo local CI parity command",
                    ["npm run ci:local"],
                    "ci",
                    ["ci-local"],
                    "blocking",
                    ["ci", "parity"],
                    600_000,
                ),
                check(
                    "readme-present",
                    "Warn when the repository does not have a README entrypoint",
                    ["node -e \"process.exit(require('fs').existsSync('README.md')?0:1)\""],
                    "governance",
                    [],
                    "advisory",
                    ["readme", "governance"],
                    10_000,
                ),
            ],
        ),
        pack(
            "node-typescript",
            "Node and TypeScript checks",
            vec![
                check(
                    "typecheck",
                    "Run TypeScript type checks",
                    ["npm run typecheck"],
                    "commit",
                    ["commit"],
                    "blocking",
                    ["typescript"],
                    120_000,
                ),
                check(
                    "test",
                    "Run JavaScript/TypeScript tests",
                    ["npm test"],
                    "push",
                    ["commit"],
                    "blocking",
                    ["test"],
                    120_000,
                ),
                check(
                    "lint-js",
                    "Run JavaScript/TypeScript linting when available",
                    ["npm run lint"],
                    "commit",
                    ["commit"],
                    "blocking",
                    ["lint"],
                    120_000,
                ),
            ],
        ),
        pack(
            "react-vite",
            "React and Vite checks",
            vec![check(
                "build-ui",
                "Build the UI bundle",
                ["npm run build"],
                "ci",
                [],
                "blocking",
                ["react", "vite", "build"],
                180_000,
            )],
        ),
        pack(
            "rust",
            "Rust checks",
            vec![
                check(
                    "rust-format",
                    "Check Rust formatting",
                    ["cargo fmt -- --check"],
                    "commit",
                    ["commit"],
                    "blocking",
                    ["rust", "format"],
                    60_000,
                ),
                check(
                    "rust-clippy",
                    "Run Rust clippy with warnings denied",
                    ["cargo clippy -- -D warnings"],
                    "commit",
                    ["commit"],
                    "blocking",
                    ["rust", "lint"],
                    120_000,
                ),
                check(
                    "rust-test",
                    "Run Rust tests",
                    ["cargo test"],
                    "push",
                    [],
                    "blocking",
                    ["rust", "test"],
                    120_000,
                ),
            ],
        ),
        pack(
            "tauri",
            "Tauri desktop checks",
            vec![check(
                "tauri-check",
                "Run Tauri/Rust desktop compile checks",
                ["npm --prefix copilot-ui run tauri:check"],
                "ci",
                [],
                "blocking",
                ["tauri", "desktop"],
                300_000,
            )],
        ),
        pack(
            "docs",
            "Documentation checks",
            vec![
                check(
                    "docs-links",
                    "Check markdown links",
                    ["npm run docs:check:links"],
                    "docs",
                    [],
                    "advisory",
                    ["docs", "links"],
                    120_000,
                ),
                check(
                    "docs-graph",
                    "Check documentation graph/frontmatter",
                    ["node scripts/validate-doc-graph.js"],
                    "docs",
                    [],
                    "advisory",
                    ["docs", "frontmatter"],
                    60_000,
                ),
            ],
        ),
        pack(
            "specs",
            "Spec governance checks",
            vec![check(
                "specs-validate",
                "Validate spec structure and index drift when the repo opts into specs",
                ["node scripts/validate-specs.js --strict docs/specs"],
                "governance",
                [],
                "advisory",
                ["specs"],
                120_000,
            )],
        ),
        pack(
            "agents-instructions",
            "Agent instruction surface checks",
            vec![
                check(
                    "instruction-wiring",
                    "Validate instruction wiring",
                    ["npm run validate:instruction-wiring"],
                    "governance",
                    [],
                    "advisory",
                    ["agents", "instructions"],
                    60_000,
                ),
                check(
                    "instruction-quality",
                    "Validate deterministic instruction quality heuristics",
                    ["npm run validate:instruction-quality"],
                    "governance",
                    [],
                    "advisory",
                    ["agents", "instructions"],
                    60_000,
                ),
                check(
                    "instruction-budgets",
                    "Warn when instruction surfaces exceed configured budgets",
                    ["npm run validate:instruction-budgets"],
                    "governance",
                    [],
                    "advisory",
                    ["agents", "instructions"],
                    60_000,
                ),
            ],
        ),
        pack(
            "github-actions",
            "GitHub Actions local checks",
            vec![check(
                "ci-map-pr",
                "Map local checks to PR workflow jobs and report gaps",
                ["elegy-checks ci-map --repo . --scope pr --json"],
                "ci",
                [],
                "advisory",
                ["github-actions", "ci"],
                30_000,
            )],
        ),
        pack(
            "security-basics",
            "Basic dependency/security hygiene checks",
            vec![check(
                "npm-audit-advisory",
                "Run npm audit as advisory dependency hygiene",
                ["npm audit --audit-level=high"],
                "security",
                [],
                "advisory",
                ["security", "dependencies"],
                120_000,
            )],
        ),
    ]
}

fn pack(id: &str, description: &str, checks: Vec<PackCheck>) -> CheckPack {
    CheckPack {
        id: id.to_string(),
        version: "1".to_string(),
        description: description.to_string(),
        checks,
    }
}

#[allow(clippy::too_many_arguments)]
fn check<const C: usize, const P: usize, const T: usize>(
    id: &str,
    description: &str,
    commands: [&str; C],
    group: &str,
    profiles: [&str; P],
    gate_strength: &str,
    tags: [&str; T],
    timeout_ms: u64,
) -> PackCheck {
    PackCheck {
        id: id.to_string(),
        description: description.to_string(),
        commands: commands.into_iter().map(ToOwned::to_owned).collect(),
        group: group.to_string(),
        default_profiles: profiles.into_iter().map(ToOwned::to_owned).collect(),
        gate_strength: gate_strength.to_string(),
        determinism: "deterministic-runnable".to_string(),
        severity: if gate_strength == "blocking" {
            "error".to_string()
        } else {
            "warning".to_string()
        },
        tags: tags.into_iter().map(ToOwned::to_owned).collect(),
        timeout_ms,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn audits_missing_repo_checks_from_detected_packs() {
        let dir = tempdir().unwrap();
        fs::write(
            dir.path().join("package.json"),
            r#"{"scripts":{"ci:local":"node ok.js","typecheck":"tsc --noEmit"}}"#,
        )
        .unwrap();
        fs::write(dir.path().join("README.md"), "Test").unwrap();
        let result = audit_repo(dir.path()).unwrap();
        assert!(result
            .detected_stacks
            .contains(&"node-typescript".to_string()));
        assert!(result
            .proposals
            .iter()
            .any(|item| item.check_id == "ci-local"));
    }
}
