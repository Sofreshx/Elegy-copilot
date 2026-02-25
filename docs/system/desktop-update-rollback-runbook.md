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
