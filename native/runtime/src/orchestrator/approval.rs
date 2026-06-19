use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::sync::Mutex;

use elegy_native_contracts::types::orchestrator::{
    ApprovalToken, ExecutionIdentity, RepositoryState,
};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ApprovalOperation {
    Commit,
    Merge,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApprovalRecord {
    token: ApprovalToken,
    operation: ApprovalOperation,
    payload_hash: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApprovalLedger {
    records: Vec<ApprovalRecord>,
}

pub struct ApprovalService {
    path: PathBuf,
    secret: Vec<u8>,
    lock: Mutex<()>,
}

impl ApprovalService {
    pub fn new(elegy_home: &Path, secret: impl AsRef<[u8]>) -> Result<Self, ApprovalError> {
        let directory = elegy_home.join("orchestrator").join("approvals");
        fs::create_dir_all(&directory)?;
        Ok(Self {
            path: directory.join("ledger.json"),
            secret: secret.as_ref().to_vec(),
            lock: Mutex::new(()),
        })
    }

    pub fn issue(
        &self,
        operation: ApprovalOperation,
        identity: ExecutionIdentity,
        repository_state: RepositoryState,
        expires_at_unix_ms: u64,
    ) -> Result<ApprovalToken, ApprovalError> {
        let _guard = self.lock.lock().map_err(|_| ApprovalError::LockPoisoned)?;
        let mut ledger = self.read_ledger()?;
        let idempotency_key = derived_idempotency_key(&identity, &repository_state);
        let payload_hash = payload_hash(
            operation,
            &identity,
            &repository_state,
            expires_at_unix_ms,
            &idempotency_key,
        )?;
        if let Some(existing) = ledger
            .records
            .iter()
            .find(|record| record.token.idempotency_key == idempotency_key)
        {
            if existing.payload_hash == payload_hash {
                return Ok(existing.token.clone());
            }
            return Err(ApprovalError::IdempotencyConflict);
        }

        let binding = binding(
            &self.secret,
            &repository_state,
            expires_at_unix_ms,
            &idempotency_key,
        )?;
        let token = ApprovalToken {
            schema_version: "orchestrator-approval/v1".into(),
            kind: "approval-token".into(),
            token_id: uuid::Uuid::new_v4().to_string(),
            identity,
            repository_state,
            expires_at_unix_ms,
            idempotency_key,
            binding,
            consumed_at_unix_ms: None,
        };
        ledger.records.push(ApprovalRecord {
            token: token.clone(),
            operation,
            payload_hash,
        });
        self.write_ledger(&ledger)?;
        Ok(token)
    }

    pub fn consume(
        &self,
        token_id: &str,
        operation: ApprovalOperation,
        current_state: &RepositoryState,
        now_unix_ms: u64,
    ) -> Result<ApprovalToken, ApprovalError> {
        let _guard = self.lock.lock().map_err(|_| ApprovalError::LockPoisoned)?;
        let mut ledger = self.read_ledger()?;
        let record = ledger
            .records
            .iter_mut()
            .find(|record| record.token.token_id == token_id)
            .ok_or(ApprovalError::NotFound)?;
        if record.operation != operation {
            return Err(ApprovalError::OperationMismatch);
        }
        if record.token.consumed_at_unix_ms.is_some() {
            return Err(ApprovalError::AlreadyConsumed);
        }
        if record.token.expires_at_unix_ms <= now_unix_ms {
            return Err(ApprovalError::Expired);
        }
        if &record.token.repository_state != current_state {
            return Err(ApprovalError::StaleRepositoryState);
        }
        let payload = binding_payload(
            current_state,
            record.token.expires_at_unix_ms,
            &record.token.idempotency_key,
        )?;
        verify_binding(&self.secret, &payload, &record.token.binding)?;
        record.token.consumed_at_unix_ms = Some(now_unix_ms);
        let token = record.token.clone();
        self.write_ledger(&ledger)?;
        Ok(token)
    }

    pub fn commit(
        &self,
        token_id: &str,
        worktree: &Path,
        target_ref: &str,
        now_unix_ms: u64,
        message: &str,
    ) -> Result<String, ApprovalError> {
        let expected = self.token_state(token_id)?;
        let evidence = super::worktree::derive_git_evidence(worktree, None)?;
        let current_state = RepositoryState {
            base_head_sha: evidence.base_head_sha,
            result_tree_sha: evidence.result_tree_sha,
            diff_hash: evidence.diff_hash,
            target_head_sha: git_text(worktree, &["rev-parse", target_ref])?,
        };
        self.consume(
            token_id,
            ApprovalOperation::Commit,
            &current_state,
            now_unix_ms,
        )?;
        if current_state != expected {
            return Err(ApprovalError::StaleRepositoryState);
        }
        git_success(worktree, &["add", "-A", "--"])?;
        git_success(worktree, &["commit", "-m", message])?;
        git_text(worktree, &["rev-parse", "HEAD"])
    }

    pub fn merge_local(
        &self,
        token_id: &str,
        repository: &Path,
        now_unix_ms: u64,
        source_ref: &str,
    ) -> Result<String, ApprovalError> {
        let expected = self.token_state(token_id)?;
        let result_tree_sha = git_text(
            repository,
            &["rev-parse", &format!("{source_ref}^{{tree}}")],
        )?;
        let diff = git(
            repository,
            &[
                "diff",
                "--binary",
                "--full-index",
                &expected.base_head_sha,
                source_ref,
            ],
        )?;
        if !diff.status.success() {
            return Err(ApprovalError::Git {
                command: "diff".into(),
                detail: String::from_utf8_lossy(&diff.stderr).trim().to_string(),
            });
        }
        let current_state = RepositoryState {
            base_head_sha: expected.base_head_sha.clone(),
            result_tree_sha,
            diff_hash: blake3::hash(&diff.stdout).to_hex().to_string(),
            target_head_sha: git_text(repository, &["rev-parse", "HEAD"])?,
        };
        self.consume(
            token_id,
            ApprovalOperation::Merge,
            &current_state,
            now_unix_ms,
        )?;
        if current_state != expected {
            return Err(ApprovalError::StaleRepositoryState);
        }
        git_success(repository, &["merge", "--no-ff", "--no-edit", source_ref])?;
        git_text(repository, &["rev-parse", "HEAD"])
    }

    fn read_ledger(&self) -> Result<ApprovalLedger, ApprovalError> {
        match fs::read(&self.path) {
            Ok(bytes) => Ok(serde_json::from_slice(&bytes)?),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                Ok(ApprovalLedger::default())
            }
            Err(error) => Err(error.into()),
        }
    }

    fn token_state(&self, token_id: &str) -> Result<RepositoryState, ApprovalError> {
        self.read_ledger()?
            .records
            .into_iter()
            .find(|record| record.token.token_id == token_id)
            .map(|record| record.token.repository_state)
            .ok_or(ApprovalError::NotFound)
    }

    fn write_ledger(&self, ledger: &ApprovalLedger) -> Result<(), ApprovalError> {
        let temp = self
            .path
            .with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
        let mut bytes = serde_json::to_vec_pretty(ledger)?;
        bytes.push(b'\n');
        fs::write(&temp, bytes)?;
        fs::rename(temp, &self.path)?;
        Ok(())
    }
}

fn binding(
    secret: &[u8],
    state: &RepositoryState,
    expiry: u64,
    idempotency_key: &str,
) -> Result<String, ApprovalError> {
    let payload = binding_payload(state, expiry, idempotency_key)?;
    let mut mac = HmacSha256::new_from_slice(secret).map_err(|_| ApprovalError::InvalidSecret)?;
    mac.update(&payload);
    Ok(hex::encode(mac.finalize().into_bytes()))
}

fn binding_payload(
    state: &RepositoryState,
    expiry: u64,
    idempotency_key: &str,
) -> Result<Vec<u8>, ApprovalError> {
    Ok(serde_json::to_vec(&serde_json::json!({
        "base_head_sha": state.base_head_sha,
        "result_tree_sha": state.result_tree_sha,
        "diff_blake3_hash": state.diff_hash,
        "target_head_sha": state.target_head_sha,
        "expiry_unix_ms": expiry,
        "idempotency_key": idempotency_key
    }))?)
}

fn verify_binding(secret: &[u8], payload: &[u8], received: &str) -> Result<(), ApprovalError> {
    let received = hex::decode(received).map_err(|_| ApprovalError::InvalidBinding)?;
    let mut mac = HmacSha256::new_from_slice(secret).map_err(|_| ApprovalError::InvalidSecret)?;
    mac.update(payload);
    mac.verify_slice(&received)
        .map_err(|_| ApprovalError::InvalidBinding)
}

fn payload_hash(
    operation: ApprovalOperation,
    identity: &ExecutionIdentity,
    state: &RepositoryState,
    expiry: u64,
    idempotency_key: &str,
) -> Result<String, ApprovalError> {
    let payload = serde_json::to_vec(&(operation, identity, state, expiry, idempotency_key))?;
    Ok(hex::encode(Sha256::digest(payload)))
}

fn derived_idempotency_key(identity: &ExecutionIdentity, state: &RepositoryState) -> String {
    let mut hash = Sha256::new();
    hash.update(identity.goal_id.as_bytes());
    hash.update(identity.work_point_id.as_bytes());
    hash.update(identity.run_id.as_bytes());
    hash.update(state.base_head_sha.as_bytes());
    let digest = hash.finalize();
    let mut bytes = [0u8; 16];
    bytes.copy_from_slice(&digest[..16]);
    bytes[6] = (bytes[6] & 0x0f) | 0x70;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    uuid::Uuid::from_bytes(bytes).to_string()
}

fn git(cwd: &Path, args: &[&str]) -> Result<Output, ApprovalError> {
    Ok(Command::new("git").arg("-C").arg(cwd).args(args).output()?)
}

fn git_success(cwd: &Path, args: &[&str]) -> Result<(), ApprovalError> {
    let output = git(cwd, args)?;
    if output.status.success() {
        Ok(())
    } else {
        Err(ApprovalError::Git {
            command: args.join(" "),
            detail: String::from_utf8_lossy(&output.stderr).trim().to_string(),
        })
    }
}

fn git_text(cwd: &Path, args: &[&str]) -> Result<String, ApprovalError> {
    let output = git(cwd, args)?;
    if !output.status.success() {
        return Err(ApprovalError::Git {
            command: args.join(" "),
            detail: String::from_utf8_lossy(&output.stderr).trim().to_string(),
        });
    }
    Ok(String::from_utf8(output.stdout)?.trim().to_string())
}

#[derive(Debug, Error)]
pub enum ApprovalError {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Utf8(#[from] std::string::FromUtf8Error),
    #[error("approval ledger lock poisoned")]
    LockPoisoned,
    #[error("idempotency key conflicts with a different approval payload")]
    IdempotencyConflict,
    #[error("approval token not found")]
    NotFound,
    #[error("approval operation does not match")]
    OperationMismatch,
    #[error("approval token was already consumed")]
    AlreadyConsumed,
    #[error("approval token expired")]
    Expired,
    #[error("repository state changed after approval")]
    StaleRepositoryState,
    #[error("approval binding is invalid")]
    InvalidBinding,
    #[error("approval secret is invalid")]
    InvalidSecret,
    #[error(transparent)]
    Worktree(#[from] super::worktree::WorktreeError),
    #[error("git {command} failed: {detail}")]
    Git { command: String, detail: String },
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(cwd: &Path, args: &[&str]) -> String {
        let output = Command::new("git")
            .arg("-C")
            .arg(cwd)
            .args(args)
            .output()
            .expect("git");
        assert!(
            output.status.success(),
            "git {}: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8(output.stdout)
            .expect("utf8")
            .trim()
            .to_string()
    }

    fn repository() -> tempfile::TempDir {
        let repo = tempfile::tempdir().expect("repo");
        run(repo.path(), &["init"]);
        run(
            repo.path(),
            &["config", "user.email", "orchestrator@example.test"],
        );
        run(repo.path(), &["config", "user.name", "Orchestrator Test"]);
        fs::write(repo.path().join("base.txt"), "base\n").expect("base");
        run(repo.path(), &["add", "."]);
        run(repo.path(), &["commit", "-m", "base"]);
        repo
    }

    fn identity() -> ExecutionIdentity {
        ExecutionIdentity {
            repo_id: "repo-1".into(),
            goal_id: "goal-1".into(),
            roadmap_id: "roadmap-1".into(),
            work_point_id: "work-1".into(),
            run_id: "run-1".into(),
        }
    }

    fn state(target: &str) -> RepositoryState {
        RepositoryState {
            base_head_sha: "1".repeat(40),
            result_tree_sha: "2".repeat(40),
            diff_hash: "3".repeat(64),
            target_head_sha: target.into(),
        }
    }

    #[test]
    fn identical_idempotency_replays_and_different_payload_conflicts() {
        let home = tempfile::tempdir().expect("home");
        let service = ApprovalService::new(home.path(), b"secret").expect("service");
        let first = service
            .issue(
                ApprovalOperation::Commit,
                identity(),
                state(&"4".repeat(40)),
                100,
            )
            .expect("issue");
        let replay = service
            .issue(
                ApprovalOperation::Commit,
                identity(),
                state(&"4".repeat(40)),
                100,
            )
            .expect("replay");
        assert_eq!(first, replay);
        assert_eq!(
            uuid::Uuid::parse_str(&first.idempotency_key)
                .expect("uuid")
                .get_version_num(),
            7
        );
        assert!(matches!(
            service.issue(
                ApprovalOperation::Merge,
                identity(),
                state(&"4".repeat(40)),
                100,
            ),
            Err(ApprovalError::IdempotencyConflict)
        ));
    }

    #[test]
    fn stale_target_and_replay_are_rejected() {
        let home = tempfile::tempdir().expect("home");
        let service = ApprovalService::new(home.path(), b"secret").expect("service");
        let original = state(&"4".repeat(40));
        let token = service
            .issue(ApprovalOperation::Merge, identity(), original.clone(), 100)
            .expect("issue");
        assert!(matches!(
            service.consume(
                &token.token_id,
                ApprovalOperation::Merge,
                &state(&"5".repeat(40)),
                10
            ),
            Err(ApprovalError::StaleRepositoryState)
        ));
        service
            .consume(&token.token_id, ApprovalOperation::Merge, &original, 10)
            .expect("consume");
        assert!(matches!(
            service.consume(&token.token_id, ApprovalOperation::Merge, &original, 11),
            Err(ApprovalError::AlreadyConsumed)
        ));
    }

    #[test]
    fn commit_rederives_state_and_consumes_approval() {
        let repo = repository();
        let home = tempfile::tempdir().expect("home");
        let service = ApprovalService::new(home.path(), b"secret").expect("service");
        fs::create_dir_all(repo.path().join("nested")).expect("nested");
        fs::write(repo.path().join("nested/change.txt"), "approved\n").expect("change");
        let evidence =
            super::super::worktree::derive_git_evidence(repo.path(), None).expect("evidence");
        let target = run(repo.path(), &["rev-parse", "HEAD"]);
        let token = service
            .issue(
                ApprovalOperation::Commit,
                identity(),
                RepositoryState {
                    base_head_sha: evidence.base_head_sha,
                    result_tree_sha: evidence.result_tree_sha,
                    diff_hash: evidence.diff_hash,
                    target_head_sha: target.clone(),
                },
                100,
            )
            .expect("issue");

        let commit = service
            .commit(&token.token_id, repo.path(), "HEAD", 10, "approved")
            .expect("commit");
        assert_ne!(commit, target);
        assert_eq!(run(repo.path(), &["status", "--porcelain"]), "");
        assert!(matches!(
            service.commit(&token.token_id, repo.path(), "HEAD", 11, "replay"),
            Err(ApprovalError::Worktree(
                super::super::worktree::WorktreeError::NoChanges
            ))
        ));
    }

    #[test]
    fn commit_rejects_changes_made_after_approval() {
        let repo = repository();
        let home = tempfile::tempdir().expect("home");
        let service = ApprovalService::new(home.path(), b"secret").expect("service");
        fs::write(repo.path().join("change.txt"), "approved\n").expect("change");
        let evidence =
            super::super::worktree::derive_git_evidence(repo.path(), None).expect("evidence");
        let target = run(repo.path(), &["rev-parse", "HEAD"]);
        let token = service
            .issue(
                ApprovalOperation::Commit,
                identity(),
                RepositoryState {
                    base_head_sha: evidence.base_head_sha,
                    result_tree_sha: evidence.result_tree_sha,
                    diff_hash: evidence.diff_hash,
                    target_head_sha: target.clone(),
                },
                100,
            )
            .expect("issue");
        fs::write(repo.path().join("change.txt"), "changed after approval\n")
            .expect("change again");

        assert!(matches!(
            service.commit(&token.token_id, repo.path(), "HEAD", 10, "must fail"),
            Err(ApprovalError::StaleRepositoryState)
        ));
        assert_eq!(run(repo.path(), &["rev-parse", "HEAD"]), target);
    }

    #[test]
    fn local_merge_rederives_source_and_target_state() {
        let repo = repository();
        let home = tempfile::tempdir().expect("home");
        let service = ApprovalService::new(home.path(), b"secret").expect("service");
        let target_branch = run(repo.path(), &["branch", "--show-current"]);
        let base = run(repo.path(), &["rev-parse", "HEAD"]);
        run(repo.path(), &["checkout", "-b", "feature"]);
        fs::write(repo.path().join("feature.txt"), "feature\n").expect("feature");
        run(repo.path(), &["add", "."]);
        run(repo.path(), &["commit", "-m", "feature"]);
        let result_tree = run(repo.path(), &["rev-parse", "feature^{tree}"]);
        let diff = git(
            repo.path(),
            &["diff", "--binary", "--full-index", &base, "feature"],
        )
        .expect("diff");
        assert!(diff.status.success());
        run(repo.path(), &["checkout", &target_branch]);
        let token = service
            .issue(
                ApprovalOperation::Merge,
                identity(),
                RepositoryState {
                    base_head_sha: base.clone(),
                    result_tree_sha: result_tree,
                    diff_hash: blake3::hash(&diff.stdout).to_hex().to_string(),
                    target_head_sha: base,
                },
                100,
            )
            .expect("issue");

        let merge = service
            .merge_local(&token.token_id, repo.path(), 10, "feature")
            .expect("merge");
        assert_eq!(merge, run(repo.path(), &["rev-parse", "HEAD"]));
        assert_eq!(
            run(repo.path(), &["rev-list", "--parents", "-n", "1", "HEAD"])
                .split_whitespace()
                .count(),
            3
        );
    }

    #[test]
    fn local_merge_rejects_target_branch_drift() {
        let repo = repository();
        let home = tempfile::tempdir().expect("home");
        let service = ApprovalService::new(home.path(), b"secret").expect("service");
        let target_branch = run(repo.path(), &["branch", "--show-current"]);
        let base = run(repo.path(), &["rev-parse", "HEAD"]);
        run(repo.path(), &["checkout", "-b", "feature"]);
        fs::write(repo.path().join("feature.txt"), "feature\n").expect("feature");
        run(repo.path(), &["add", "."]);
        run(repo.path(), &["commit", "-m", "feature"]);
        let result_tree = run(repo.path(), &["rev-parse", "feature^{tree}"]);
        let diff = git(
            repo.path(),
            &["diff", "--binary", "--full-index", &base, "feature"],
        )
        .expect("diff");
        assert!(diff.status.success());
        run(repo.path(), &["checkout", &target_branch]);
        let token = service
            .issue(
                ApprovalOperation::Merge,
                identity(),
                RepositoryState {
                    base_head_sha: base.clone(),
                    result_tree_sha: result_tree,
                    diff_hash: blake3::hash(&diff.stdout).to_hex().to_string(),
                    target_head_sha: base,
                },
                100,
            )
            .expect("issue");
        fs::write(repo.path().join("target.txt"), "drift\n").expect("drift");
        run(repo.path(), &["add", "."]);
        run(repo.path(), &["commit", "-m", "target drift"]);
        let drifted_head = run(repo.path(), &["rev-parse", "HEAD"]);

        assert!(matches!(
            service.merge_local(&token.token_id, repo.path(), 10, "feature"),
            Err(ApprovalError::StaleRepositoryState)
        ));
        assert_eq!(run(repo.path(), &["rev-parse", "HEAD"]), drifted_head);
    }
}
