use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const MAX_WORKER_OUTPUT_BYTES: u64 = 1_048_576;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionIdentity {
    pub repo_id: String,
    pub goal_id: String,
    pub roadmap_id: String,
    pub work_point_id: String,
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum AdapterId {
    OpencodeAcp,
    CodexExec,
    Native,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DispatchRequest {
    pub schema_version: String,
    pub kind: String,
    pub identity: ExecutionIdentity,
    pub adapter_id: AdapterId,
    pub fencing_token: i64,
    pub idempotency_key: String,
    pub worktree_path: String,
    pub file_scopes: Vec<String>,
    pub prompt: Option<String>,
    pub resume_session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum WorkerStatus {
    Completed,
    Failed,
    Cancelled,
    TimedOut,
    Malformed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum EvidenceClaimType {
    WorkerReported,
    OrchestratorObserved,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceClaim {
    pub schema_version: String,
    pub kind: String,
    pub claim_id: String,
    pub claim_type: EvidenceClaimType,
    pub source: String,
    pub summary: String,
    pub command: Option<String>,
    pub exit_code: Option<i32>,
    pub duration_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkerResult {
    pub schema_version: String,
    pub kind: String,
    pub identity: ExecutionIdentity,
    pub adapter_id: AdapterId,
    pub status: WorkerStatus,
    pub logical_session_id: Option<String>,
    pub summary: Option<String>,
    pub observed_output_bytes: u64,
    pub claims: Vec<EvidenceClaim>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AdapterCapabilities {
    pub schema_version: String,
    pub kind: String,
    pub adapter_id: AdapterId,
    pub available: bool,
    pub supports_cancellation: bool,
    pub supports_resume: bool,
    pub supports_structured_result: bool,
    pub max_concurrent: u32,
    pub unavailable_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionEvent {
    pub schema_version: String,
    pub kind: String,
    pub event_id: String,
    pub sequence: u64,
    pub identity: ExecutionIdentity,
    pub event_type: String,
    pub occurred_at: String,
    pub payload: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryState {
    pub base_head_sha: String,
    pub result_tree_sha: String,
    pub diff_hash: String,
    pub target_head_sha: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalToken {
    pub schema_version: String,
    pub kind: String,
    pub token_id: String,
    pub identity: ExecutionIdentity,
    pub repository_state: RepositoryState,
    pub expires_at_unix_ms: u64,
    pub idempotency_key: String,
    pub binding: String,
    pub consumed_at_unix_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IdempotencyRecord {
    pub schema_version: String,
    pub kind: String,
    pub idempotency_key: String,
    pub operation: String,
    pub payload_hash: String,
    pub created_at_unix_ms: u64,
    pub response: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OrchestratorApiError {
    pub schema_version: String,
    pub kind: String,
    pub code: String,
    pub message: String,
    pub retryable: bool,
    pub details: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ContractViolation {
    UnsupportedSchema {
        expected: &'static str,
        received: String,
    },
    OversizedWorkerOutput {
        observed: u64,
        maximum: u64,
    },
    StaleApproval,
    ConsumedApproval,
    RepositoryStateMismatch,
}

impl DispatchRequest {
    pub fn validate(&self) -> Result<(), ContractViolation> {
        require_schema("orchestrator-dispatch/v1", &self.schema_version)
    }
}

impl WorkerResult {
    pub fn validate(&self) -> Result<(), ContractViolation> {
        require_schema("orchestrator-worker-result/v1", &self.schema_version)?;
        if self.observed_output_bytes > MAX_WORKER_OUTPUT_BYTES {
            return Err(ContractViolation::OversizedWorkerOutput {
                observed: self.observed_output_bytes,
                maximum: MAX_WORKER_OUTPUT_BYTES,
            });
        }
        Ok(())
    }
}

impl ApprovalToken {
    pub fn validate_for(
        &self,
        current_state: &RepositoryState,
        now_unix_ms: u64,
    ) -> Result<(), ContractViolation> {
        require_schema("orchestrator-approval/v1", &self.schema_version)?;
        if self.consumed_at_unix_ms.is_some() {
            return Err(ContractViolation::ConsumedApproval);
        }
        if self.expires_at_unix_ms <= now_unix_ms {
            return Err(ContractViolation::StaleApproval);
        }
        if &self.repository_state != current_state {
            return Err(ContractViolation::RepositoryStateMismatch);
        }
        Ok(())
    }
}

fn require_schema(expected: &'static str, received: &str) -> Result<(), ContractViolation> {
    if received == expected {
        Ok(())
    } else {
        Err(ContractViolation::UnsupportedSchema {
            expected,
            received: received.to_string(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> String {
        std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../contracts/orchestrator/fixtures")
                .join(name),
        )
        .expect("read orchestrator fixture")
    }

    #[test]
    fn valid_dispatch_deserializes_and_accepts_additive_fields() {
        let mut value: Value =
            serde_json::from_str(&fixture("dispatch.valid.json")).expect("valid fixture");
        value["futureField"] = Value::Bool(true);
        let dispatch: DispatchRequest = serde_json::from_value(value).expect("dispatch");
        assert_eq!(dispatch.validate(), Ok(()));
    }

    #[test]
    fn malformed_dispatch_fails_closed() {
        let result = serde_json::from_str::<DispatchRequest>(&fixture("dispatch.malformed.json"));
        assert!(result.is_err());
    }

    #[test]
    fn unknown_schema_version_fails_closed() {
        let mut dispatch: DispatchRequest =
            serde_json::from_str(&fixture("dispatch.valid.json")).expect("dispatch");
        dispatch.schema_version = "orchestrator-dispatch/v2".into();
        assert!(matches!(
            dispatch.validate(),
            Err(ContractViolation::UnsupportedSchema { .. })
        ));
    }

    #[test]
    fn oversized_worker_result_is_rejected() {
        let result: WorkerResult =
            serde_json::from_str(&fixture("worker-result.oversized.json")).expect("worker result");
        assert_eq!(
            result.validate(),
            Err(ContractViolation::OversizedWorkerOutput {
                observed: MAX_WORKER_OUTPUT_BYTES + 1,
                maximum: MAX_WORKER_OUTPUT_BYTES,
            })
        );
    }

    #[test]
    fn stale_approval_is_rejected() {
        let approval: ApprovalToken =
            serde_json::from_str(&fixture("approval.stale.json")).expect("approval");
        assert_eq!(
            approval.validate_for(&approval.repository_state, 2),
            Err(ContractViolation::StaleApproval)
        );
    }

    #[test]
    fn mismatched_repository_state_is_rejected() {
        let value: Value =
            serde_json::from_str(&fixture("approval.mismatched.json")).expect("approval fixture");
        let expected: RepositoryState =
            serde_json::from_value(value["expectedRepositoryState"].clone()).expect("state");
        let approval: ApprovalToken = serde_json::from_value(value).expect("approval");
        assert_eq!(
            approval.validate_for(&expected, 1),
            Err(ContractViolation::RepositoryStateMismatch)
        );
    }
}
