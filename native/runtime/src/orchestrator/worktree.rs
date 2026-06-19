use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use glob::Pattern;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;

pub const ORCHESTRATOR_WORKTREE_SOURCE: &str = "harness-execution-orchestrator";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeOwnership {
    pub repo_id: String,
    pub worktree_id: String,
    pub run_id: String,
    pub path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitEvidence {
    pub base_head_sha: String,
    pub result_tree_sha: String,
    pub diff_hash: String,
    pub changed_paths: Vec<String>,
}

pub struct OrchestratorWorktree {
    registry_path: PathBuf,
    ownership: WorktreeOwnership,
}

impl OrchestratorWorktree {
    pub fn bind(
        elegy_home: &Path,
        repo_id: &str,
        worktree_id: &str,
        run_id: &str,
        expected_path: &Path,
    ) -> Result<Self, WorktreeError> {
        let registry_path = elegy_home
            .join("repo-state")
            .join(repo_id)
            .join("worktrees")
            .join(format!("{worktree_id}.json"));
        let bytes = fs::read(&registry_path).map_err(|source| WorktreeError::RegistryRead {
            path: registry_path.clone(),
            source,
        })?;
        let mut record: Value = serde_json::from_slice(&bytes)?;
        let object = record
            .as_object_mut()
            .ok_or(WorktreeError::MalformedRegistry)?;

        require_string(object.get("repoId"), repo_id, "repoId")?;
        require_string(object.get("worktreeId"), worktree_id, "worktreeId")?;
        let registered_path = object
            .get("path")
            .and_then(Value::as_str)
            .ok_or(WorktreeError::MissingRegistryField("path"))?;
        if normalize_path(Path::new(registered_path)) != normalize_path(expected_path) {
            return Err(WorktreeError::ForeignWorktree {
                expected: expected_path.to_path_buf(),
                registered: PathBuf::from(registered_path),
            });
        }
        if !expected_path.is_dir() {
            return Err(WorktreeError::MissingWorktree(expected_path.to_path_buf()));
        }
        let inside = git_text(expected_path, &["rev-parse", "--is-inside-work-tree"], None)?;
        if inside != "true" {
            return Err(WorktreeError::NotGitWorktree(expected_path.to_path_buf()));
        }
        let git_dir = resolve_git_metadata_path(
            expected_path,
            &git_text(expected_path, &["rev-parse", "--git-dir"], None)?,
        );
        let common_dir = resolve_git_metadata_path(
            expected_path,
            &git_text(expected_path, &["rev-parse", "--git-common-dir"], None)?,
        );
        if normalize_path(&git_dir) == normalize_path(&common_dir) {
            return Err(WorktreeError::PrimaryCheckout(expected_path.to_path_buf()));
        }
        let status = git(expected_path, &["status", "--porcelain=v1", "-z"], None)?;
        if !status.status.success() {
            return Err(command_failure("git status", &status));
        }
        let dirty_paths = parse_porcelain_paths(&status.stdout)?;
        if !dirty_paths.is_empty() {
            return Err(WorktreeError::DirtyWorktree { paths: dirty_paths });
        }

        let assignment = object
            .entry("assignment")
            .or_insert_with(|| serde_json::json!({}));
        let assignment = assignment
            .as_object_mut()
            .ok_or(WorktreeError::MalformedAssignment)?;
        if let Some(existing) = assignment
            .get("runId")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty() && *value != run_id)
        {
            return Err(WorktreeError::ForeignOwner(existing.to_string()));
        }
        assignment.insert("runId".into(), Value::String(run_id.to_string()));
        object.insert(
            "source".into(),
            Value::String(ORCHESTRATOR_WORKTREE_SOURCE.to_string()),
        );

        write_json_atomic(&registry_path, &record)?;
        Ok(Self {
            registry_path,
            ownership: WorktreeOwnership {
                repo_id: repo_id.to_string(),
                worktree_id: worktree_id.to_string(),
                run_id: run_id.to_string(),
                path: expected_path.to_path_buf(),
            },
        })
    }

    pub fn ownership(&self) -> &WorktreeOwnership {
        &self.ownership
    }

    pub fn registry_path(&self) -> &Path {
        &self.registry_path
    }

    pub fn verify_changes(&self, file_scopes: &[String]) -> Result<GitEvidence, WorktreeError> {
        if file_scopes.is_empty() {
            return Err(WorktreeError::EmptyFileScope);
        }
        verify_git_worktree(&self.ownership.path, file_scopes)
    }
}

fn verify_git_worktree(
    worktree_path: &Path,
    file_scopes: &[String],
) -> Result<GitEvidence, WorktreeError> {
    let status = git(worktree_path, &["status", "--porcelain=v1", "-z"], None)?;
    if !status.status.success() {
        return Err(command_failure("git status", &status));
    }
    let changed_paths = parse_porcelain_paths(&status.stdout)?;
    if changed_paths.is_empty() {
        return Err(WorktreeError::NoChanges);
    }

    let patterns = file_scopes
        .iter()
        .map(|scope| {
            Pattern::new(scope).map_err(|source| WorktreeError::InvalidScope {
                scope: scope.clone(),
                source,
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    let out_of_scope = changed_paths
        .iter()
        .filter(|path| !patterns.iter().any(|pattern| pattern.matches(path)))
        .cloned()
        .collect::<Vec<_>>();
    if !out_of_scope.is_empty() {
        return Err(WorktreeError::OutOfScope {
            paths: out_of_scope,
        });
    }

    let base_head_sha = git_text(worktree_path, &["rev-parse", "HEAD"], None)?;
    let temp_index = std::env::temp_dir().join(format!(
        "elegy-orchestrator-index-{}-{}",
        std::process::id(),
        uuid::Uuid::new_v4()
    ));
    let index_value = temp_index.to_string_lossy().into_owned();
    let env = [("GIT_INDEX_FILE", index_value.as_str())];
    let result = (|| {
        git_success(worktree_path, &["read-tree", "HEAD"], Some(&env))?;
        git_success(worktree_path, &["add", "-A", "--"], Some(&env))?;
        let result_tree_sha = git_text(worktree_path, &["write-tree"], Some(&env))?;
        let diff = git(
            worktree_path,
            &["diff", "--cached", "--binary", "--full-index", "HEAD"],
            Some(&env),
        )?;
        if !diff.status.success() {
            return Err(command_failure("git diff --cached", &diff));
        }
        Ok(GitEvidence {
            base_head_sha,
            result_tree_sha,
            diff_hash: blake3::hash(&diff.stdout).to_hex().to_string(),
            changed_paths,
        })
    })();
    let _ = fs::remove_file(temp_index);
    result
}

fn parse_porcelain_paths(bytes: &[u8]) -> Result<Vec<String>, WorktreeError> {
    let fields = bytes
        .split(|byte| *byte == 0)
        .filter(|field| !field.is_empty())
        .collect::<Vec<_>>();
    let mut paths = BTreeSet::new();
    let mut index = 0;
    while index < fields.len() {
        let field = std::str::from_utf8(fields[index])?;
        if field.len() < 4 {
            return Err(WorktreeError::MalformedGitStatus(field.to_string()));
        }
        let status = &field[..2];
        let path = normalize_git_path(&field[3..]);
        paths.insert(path);
        if status.starts_with('R') || status.starts_with('C') {
            index += 1;
            if let Some(source) = fields.get(index) {
                paths.insert(normalize_git_path(std::str::from_utf8(source)?));
            }
        }
        index += 1;
    }
    Ok(paths.into_iter().collect())
}

fn normalize_git_path(path: &str) -> String {
    path.replace('\\', "/")
}

fn normalize_path(path: &Path) -> String {
    let normalized = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let value = normalized.to_string_lossy().replace('\\', "/");
    if cfg!(windows) {
        value.to_lowercase()
    } else {
        value
    }
}

fn resolve_git_metadata_path(worktree: &Path, value: &str) -> PathBuf {
    let path = PathBuf::from(value);
    if path.is_absolute() {
        path
    } else {
        worktree.join(path)
    }
}

fn require_string(
    value: Option<&Value>,
    expected: &str,
    field: &'static str,
) -> Result<(), WorktreeError> {
    match value.and_then(Value::as_str) {
        Some(actual) if actual == expected => Ok(()),
        Some(actual) => Err(WorktreeError::RegistryIdentityMismatch {
            field,
            expected: expected.to_string(),
            actual: actual.to_string(),
        }),
        None => Err(WorktreeError::MissingRegistryField(field)),
    }
}

fn write_json_atomic(path: &Path, value: &Value) -> Result<(), WorktreeError> {
    let temp = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let mut bytes = serde_json::to_vec_pretty(value)?;
    bytes.push(b'\n');
    fs::write(&temp, bytes)?;
    fs::rename(&temp, path)?;
    Ok(())
}

fn git(cwd: &Path, args: &[&str], env: Option<&[(&str, &str)]>) -> Result<Output, WorktreeError> {
    let mut command = Command::new("git");
    command.arg("-C").arg(cwd).args(args);
    if let Some(env) = env {
        command.envs(env.iter().copied());
    }
    command.output().map_err(WorktreeError::GitLaunch)
}

fn git_success(
    cwd: &Path,
    args: &[&str],
    env: Option<&[(&str, &str)]>,
) -> Result<(), WorktreeError> {
    let output = git(cwd, args, env)?;
    if output.status.success() {
        Ok(())
    } else {
        Err(command_failure(&format!("git {}", args.join(" ")), &output))
    }
}

fn git_text(
    cwd: &Path,
    args: &[&str],
    env: Option<&[(&str, &str)]>,
) -> Result<String, WorktreeError> {
    let output = git(cwd, args, env)?;
    if !output.status.success() {
        return Err(command_failure(&format!("git {}", args.join(" ")), &output));
    }
    Ok(String::from_utf8(output.stdout)?.trim().to_string())
}

fn command_failure(command: &str, output: &Output) -> WorktreeError {
    WorktreeError::GitCommand {
        command: command.to_string(),
        detail: String::from_utf8_lossy(&output.stderr).trim().to_string(),
    }
}

#[derive(Debug, Error)]
pub enum WorktreeError {
    #[error("failed to read worktree registry {path}: {source}")]
    RegistryRead {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("worktree registry is not a JSON object")]
    MalformedRegistry,
    #[error("worktree registry assignment is not an object")]
    MalformedAssignment,
    #[error("worktree registry is missing {0}")]
    MissingRegistryField(&'static str),
    #[error("worktree registry {field} mismatch: expected {expected}, received {actual}")]
    RegistryIdentityMismatch {
        field: &'static str,
        expected: String,
        actual: String,
    },
    #[error("worktree path is foreign: expected {expected}, registry has {registered}")]
    ForeignWorktree {
        expected: PathBuf,
        registered: PathBuf,
    },
    #[error("worktree is owned by foreign run {0}")]
    ForeignOwner(String),
    #[error("worktree path does not exist: {0}")]
    MissingWorktree(PathBuf),
    #[error("path is not a Git worktree: {0}")]
    NotGitWorktree(PathBuf),
    #[error("path is the primary checkout, not an isolated linked worktree: {0}")]
    PrimaryCheckout(PathBuf),
    #[error("worktree is dirty before dispatch: {paths:?}")]
    DirtyWorktree { paths: Vec<String> },
    #[error("work point has no file scopes")]
    EmptyFileScope,
    #[error("invalid file scope {scope}: {source}")]
    InvalidScope {
        scope: String,
        #[source]
        source: glob::PatternError,
    },
    #[error("worktree has no changes to verify")]
    NoChanges,
    #[error("out-of-scope modifications: {paths:?}")]
    OutOfScope { paths: Vec<String> },
    #[error("malformed git status record: {0}")]
    MalformedGitStatus(String),
    #[error("failed to launch git: {0}")]
    GitLaunch(std::io::Error),
    #[error("{command} failed: {detail}")]
    GitCommand { command: String, detail: String },
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Utf8(#[from] std::str::Utf8Error),
    #[error(transparent)]
    StringUtf8(#[from] std::string::FromUtf8Error),
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestRepository {
        _root: tempfile::TempDir,
        worktree: PathBuf,
    }

    impl TestRepository {
        fn path(&self) -> &Path {
            &self.worktree
        }
    }

    fn run(cwd: &Path, args: &[&str]) {
        let output = Command::new("git")
            .arg("-C")
            .arg(cwd)
            .args(args)
            .output()
            .expect("git");
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn repository() -> TestRepository {
        let root = tempfile::tempdir().expect("tempdir");
        let primary = root.path().join("primary");
        let worktree = root.path().join("worktree");
        fs::create_dir_all(&primary).expect("primary");
        run(&primary, &["init"]);
        run(
            &primary,
            &["config", "user.email", "orchestrator@example.test"],
        );
        run(&primary, &["config", "user.name", "Orchestrator Test"]);
        fs::create_dir_all(primary.join("src")).expect("src");
        fs::write(primary.join("src/base.txt"), "base\n").expect("base");
        run(&primary, &["add", "."]);
        run(&primary, &["commit", "-m", "base"]);
        run(
            &primary,
            &[
                "worktree",
                "add",
                "-b",
                "orchestrator-test",
                worktree.to_str().expect("worktree path"),
            ],
        );
        TestRepository {
            _root: root,
            worktree,
        }
    }

    fn registry(home: &Path, repo: &Path, run_id: Option<&str>) -> PathBuf {
        let path = home
            .join("repo-state/repo-1/worktrees")
            .join("worktree-1.json");
        fs::create_dir_all(path.parent().expect("parent")).expect("registry dir");
        fs::write(
            &path,
            serde_json::to_vec_pretty(&serde_json::json!({
                "contractVersion": "1",
                "worktreeId": "worktree-1",
                "repoId": "repo-1",
                "path": repo,
                "source": "opencode-worktree-plugin",
                "assignment": {
                    "sessionId": null,
                    "runId": run_id,
                    "overlaySessionId": null
                },
                "customField": "preserved"
            }))
            .expect("json"),
        )
        .expect("write registry");
        path
    }

    #[test]
    fn binds_existing_registry_without_new_schema() {
        let repo = repository();
        let home = tempfile::tempdir().expect("home");
        let path = registry(home.path(), repo.path(), None);
        let worktree =
            OrchestratorWorktree::bind(home.path(), "repo-1", "worktree-1", "run-1", repo.path())
                .expect("bind");
        assert_eq!(worktree.registry_path(), path);
        let value: Value =
            serde_json::from_slice(&fs::read(path).expect("read")).expect("registry");
        assert_eq!(value["source"], ORCHESTRATOR_WORKTREE_SOURCE);
        assert_eq!(value["assignment"]["runId"], "run-1");
        assert_eq!(value["customField"], "preserved");
        assert_eq!(value["contractVersion"], "1");
    }

    #[test]
    fn foreign_owner_and_path_fail_closed() {
        let repo = repository();
        let home = tempfile::tempdir().expect("home");
        registry(home.path(), repo.path(), Some("other-run"));
        assert!(matches!(
            OrchestratorWorktree::bind(home.path(), "repo-1", "worktree-1", "run-1", repo.path()),
            Err(WorktreeError::ForeignOwner(_))
        ));
    }

    #[test]
    fn dirty_worktree_fails_before_ownership_is_bound() {
        let repo = repository();
        let home = tempfile::tempdir().expect("home");
        let path = registry(home.path(), repo.path(), None);
        fs::write(repo.path().join("dirty.txt"), "dirty\n").expect("dirty");
        assert!(matches!(
            OrchestratorWorktree::bind(
                home.path(),
                "repo-1",
                "worktree-1",
                "run-1",
                repo.path()
            ),
            Err(WorktreeError::DirtyWorktree { paths }) if paths == vec!["dirty.txt"]
        ));
        let value: Value =
            serde_json::from_slice(&fs::read(path).expect("read")).expect("registry");
        assert!(value["assignment"]["runId"].is_null());
    }

    #[test]
    fn derives_untracked_and_modified_changes_and_hashes() {
        let repo = repository();
        fs::write(repo.path().join("src/base.txt"), "changed\n").expect("modify");
        fs::write(repo.path().join("src/new.txt"), "new\n").expect("untracked");
        let evidence = verify_git_worktree(repo.path(), &["src/**".into()]).expect("evidence");
        let repeated = verify_git_worktree(repo.path(), &["src/**".into()]).expect("repeat");
        assert_eq!(evidence.changed_paths, vec!["src/base.txt", "src/new.txt"]);
        assert_eq!(evidence, repeated);
        assert_eq!(evidence.base_head_sha.len(), 40);
        assert_eq!(evidence.result_tree_sha.len(), 40);
        assert_eq!(evidence.diff_hash.len(), 64);
        assert_ne!(evidence.base_head_sha, evidence.result_tree_sha);
        assert_eq!(
            git_text(repo.path(), &["diff", "--cached", "--name-only"], None).expect("real index"),
            ""
        );
    }

    #[test]
    fn out_of_scope_changes_list_actual_paths() {
        let repo = repository();
        fs::write(repo.path().join("outside.txt"), "outside\n").expect("outside");
        assert!(matches!(
            verify_git_worktree(repo.path(), &["src/**".into()]),
            Err(WorktreeError::OutOfScope { paths }) if paths == vec!["outside.txt"]
        ));
    }
}
