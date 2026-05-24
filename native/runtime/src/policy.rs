use std::fs;
use std::path::Path;

use anyhow::{Context, Result};
use chrono::Utc;
use elegy_native_contracts::PolicyPreflightResponse;
use serde_json::Value;
use sha2::{Digest, Sha256};

const LOCK_SCHEMA_VERSION: &str = "1.0.0";

pub fn evaluate_policy_preflight(engine_root: &Path) -> PolicyPreflightResponse {
    let validator_path = engine_root
        .join("scripts")
        .join("validate-policy-lockfiles.js");
    let checked_at = Utc::now().to_rfc3339();

    if !validator_path.is_file() {
        return PolicyPreflightResponse {
            ok: false,
            status: "unavailable".to_string(),
            reason: Some("validator_missing".to_string()),
            checked_at,
            validator_path: validator_path.display().to_string(),
            message: None,
            exit_code: None,
        };
    }

    match validate_policy_lockfiles(engine_root) {
        Ok(message) => PolicyPreflightResponse {
            ok: true,
            status: "passed".to_string(),
            reason: None,
            checked_at,
            validator_path: validator_path.display().to_string(),
            message: Some(message),
            exit_code: None,
        },
        Err(error) => PolicyPreflightResponse {
            ok: false,
            status: "failed".to_string(),
            reason: Some("validation_failed".to_string()),
            checked_at,
            validator_path: validator_path.display().to_string(),
            message: Some(error.to_string()),
            exit_code: Some(1),
        },
    }
}

fn validate_policy_lockfiles(engine_root: &Path) -> Result<String> {
    let policy_path = engine_root
        .join("engine-assets")
        .join("policy")
        .join("pipeline-policy.json");
    let schema_path = engine_root
        .join("engine-assets")
        .join("policy")
        .join("policy.schema.json");
    let lock_path = engine_root
        .join(".cli")
        .join("policy")
        .join("pipeline-policy.lock.json");

    let lock = read_json(&lock_path)?;
    let policy = read_json(&policy_path)?;
    let schema = read_json(&schema_path)?;

    let lock_object = lock
        .as_object()
        .context("lockfile root must be an object")?;
    let lock_schema_version = lock_object
        .get("lockSchemaVersion")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if lock_schema_version != LOCK_SCHEMA_VERSION {
        anyhow::bail!("lockSchemaVersion must be {LOCK_SCHEMA_VERSION}");
    }

    let lock_policy = lock_object
        .get("policy")
        .and_then(Value::as_object)
        .context("lockfile.policy must be an object")?;

    let expected_source = to_posix_relative(engine_root, &policy_path)?;
    let expected_schema_source = to_posix_relative(engine_root, &schema_path)?;
    compare_field(
        lock_policy.get("source").and_then(Value::as_str),
        &expected_source,
        "source",
    )?;
    compare_field(
        lock_policy.get("schemaSource").and_then(Value::as_str),
        &expected_schema_source,
        "schemaSource",
    )?;

    compare_field(
        lock_policy.get("policyVersion").and_then(Value::as_str),
        policy
            .get("policyVersion")
            .and_then(Value::as_str)
            .unwrap_or_default(),
        "policyVersion",
    )?;
    compare_field(
        lock_policy.get("schemaVersion").and_then(Value::as_str),
        policy
            .get("schemaVersion")
            .and_then(Value::as_str)
            .unwrap_or_default(),
        "schemaVersion",
    )?;

    let current_policy_hash = sha256_hex(&canonical_json(&policy));
    let current_schema_hash = sha256_hex(&canonical_json(&schema));

    compare_field(
        lock_policy.get("policySha256").and_then(Value::as_str),
        &current_policy_hash,
        "policySha256",
    )?;
    compare_field(
        lock_policy.get("schemaSha256").and_then(Value::as_str),
        &current_schema_hash,
        "schemaSha256",
    )?;

    Ok("Policy lockfile validation passed".to_string())
}

fn compare_field(actual: Option<&str>, expected: &str, field_name: &str) -> Result<()> {
    let actual_value = actual.unwrap_or_default();
    if actual_value != expected {
        anyhow::bail!("{field_name} mismatch ({actual_value} != {expected})");
    }
    Ok(())
}

fn read_json(file_path: &Path) -> Result<Value> {
    let text = fs::read_to_string(file_path)
        .with_context(|| format!("missing file: {}", file_path.display()))?;
    serde_json::from_str(&text)
        .with_context(|| format!("failed to parse JSON {}", file_path.display()))
}

fn to_posix_relative(root: &Path, path: &Path) -> Result<String> {
    let relative = path.strip_prefix(root).with_context(|| {
        format!(
            "path {} is outside repo root {}",
            path.display(),
            root.display()
        )
    })?;
    Ok(relative
        .components()
        .map(|component| component.as_os_str().to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join("/"))
}

fn canonical_json(value: &Value) -> String {
    match value {
        Value::Null => "null".to_string(),
        Value::Bool(boolean) => boolean.to_string(),
        Value::Number(number) => number.to_string(),
        Value::String(string) => {
            serde_json::to_string(string).expect("string serialization should succeed")
        }
        Value::Array(values) => {
            let entries = values
                .iter()
                .map(canonical_json)
                .collect::<Vec<_>>()
                .join(",");
            format!("[{entries}]")
        }
        Value::Object(map) => {
            let mut keys = map.keys().cloned().collect::<Vec<_>>();
            keys.sort();
            let entries = keys
                .iter()
                .map(|key| {
                    let key_json =
                        serde_json::to_string(key).expect("key serialization should succeed");
                    let value_json = canonical_json(map.get(key).expect("sorted key should exist"));
                    format!("{key_json}:{value_json}")
                })
                .collect::<Vec<_>>()
                .join(",");
            format!("{{{entries}}}")
        }
    }
}

fn sha256_hex(text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    format!("{:x}", hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_json_sorts_object_keys() {
        let value = serde_json::json!({
            "b": 2,
            "a": {
                "d": true,
                "c": [2, 1]
            }
        });

        assert_eq!(
            canonical_json(&value),
            r#"{"a":{"c":[2,1],"d":true},"b":2}"#
        );
    }
}
