---
created: 2026-02-25
updated: 2026-02-25
category: system
status: current
doc_kind: node
id: desktop-update-rollback-runbook
summary: Operational runbook for desktop updater rollback controls and global update kill switch.
tags: [desktop, updater, rollback, incident-response]
related: [runtime-permissions-contracts, security-model]
---

# Desktop Update Rollback + Kill Switch Runbook

## Ownership

- **Primary owner:** Desktop release owner (Instruction Engine maintainers)
- **Approver for rollback/kill switch:** On-call incident commander for desktop release incidents
- **Executor:** Release engineer with repo + CI variable access

## Controls and Config Knobs

1. `INSTRUCTION_ENGINE_DISABLE_UPDATES`
   - `true|1|yes|on` → force global update disable (kill switch)
   - `false|0|no|off` → do not force-disable (policy still required)

2. `INSTRUCTION_ENGINE_ROLLBACK_POLICY_JSON`
   - Required for update checks when kill switch is not forcing disable.
   - Must be valid JSON with the shape:

```json
{
  "updatesEnabled": true,
  "minimumSafeVersion": "1.2.3",
  "minimumSafeVersionsByChannel": {
    "stable": "1.2.3",
    "prerelease": "1.3.0-rc.1"
  },
  "channelVersionCeilings": {
    "stable": "1.2.6",
    "prerelease": "1.3.0-rc.4"
  }
}
```

3. `INSTRUCTION_ENGINE_UPDATE_CHANNEL`
   - Existing channel selector (`stable` / `prerelease`) still applies before rollback policy candidate checks.

## Operational Notes

- Policy load is **fail-closed**. Missing or malformed rollback policy data blocks update checks/candidates.
- Kill switch (`INSTRUCTION_ENGINE_DISABLE_UPDATES=true`) always blocks updates, even if policy JSON exists.
- Reason codes are machine-readable and emitted in updater logs.

## Checksum Pass/Fail Semantics (Release-Safety Gate)

- **Pass**: every persisted migration version in `ie_schema_versions` matches the manifest checksum.
   - Migration runner result includes `checksumValidation.outcome=pass` and `checksumValidation.reason=all_manifest_checksums_match`.
- **Fail**: any persisted checksum differs from the manifest checksum for the same version.
   - Migration runner throws `PLANNING_MIGRATION_CHECKSUM_DRIFT` with `checksumValidation.outcome=fail` and `checksumValidation.reason=manifest_checksum_drift_detected`.
   - Treat this as release-safety drift: stop promotion and execute rollback threshold `R1` before re-enabling updates.

## Rollback Trigger Thresholds

| Threshold | Trigger condition | Required action |
|---|---|---|
| `R1` (immediate rollback) | Any single deterministic safety failure: `PLANNING_MIGRATION_CHECKSUM_DRIFT`, `current_version_below_minimum_safe`, or `candidate_version_above_channel_ceiling` | Pause affected channel, point ceiling to last-known-safe version, and set minimum-safe policy before resuming checks |
| `R2` (rollback escalation) | Two consecutive update-check cycles still fail-closed with `rollback_policy_source_unavailable` or `rollback_policy_malformed` after `R1` remediation | Keep channel paused, republish validated rollback policy JSON, and open incident handoff to on-call commander |

## Kill-Switch Ownership + Activation Rules

- **Owner:** Release Engineering owns kill-switch execution (`INSTRUCTION_ENGINE_DISABLE_UPDATES=true`).
- **Approver:** On-call incident commander approves activation/deactivation.
- **Security co-approval:** required when evidence/provenance/signature trust is suspect.

Activation thresholds:

1. **Immediate (`K1`)**
    - Trigger on any trust-chain compromise signal (missing/invalid signing evidence, attestation mismatch, or unresolved checksum drift during release gating).
    - Action: set kill switch to true for the affected channel scope immediately.
2. **Escalated (`K2`)**
    - Trigger when `R2` fail-closed policy outages persist and no safe rollback target can be published.
    - Action: set kill switch to true globally until policy source and safe target are restored.

Deactivation rule:

- Kill switch may be turned off only after rollback policy validates cleanly and a last-known-safe target is confirmed for the active channel.

## Quick Game-Day Checks

1. **Kill switch drill**
   - Set `INSTRUCTION_ENGINE_DISABLE_UPDATES=true`
   - Expected: updater logs `updates_disabled_globally`; no update check call proceeds.

2. **Malformed policy drill**
   - Set `INSTRUCTION_ENGINE_DISABLE_UPDATES=false`
   - Set `INSTRUCTION_ENGINE_ROLLBACK_POLICY_JSON={"updatesEnabled":"not-bool"}`
   - Expected: updater blocks with `rollback_policy_malformed`.

3. **Unavailable policy drill**
   - Unset `INSTRUCTION_ENGINE_ROLLBACK_POLICY_JSON`
   - Expected: updater blocks with `rollback_policy_source_unavailable`.

4. **Ceiling rollback drill**
   - Use policy with stable `channelVersionCeilings.stable` below latest published version.
   - Expected: candidate above ceiling blocked with `candidate_version_above_channel_ceiling`.

5. **Minimum-safe drill**
   - Set `minimumSafeVersion` above current app version.
   - Expected: preflight blocked with `current_version_below_minimum_safe`.
