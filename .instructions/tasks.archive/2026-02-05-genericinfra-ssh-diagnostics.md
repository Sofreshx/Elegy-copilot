---
schema: task/v1
id: task-000428
title: "Add read-only SSH diagnostics workflow to GenericInfrastructure"
type: feature
status: archived
priority: medium
owner: "infra-team"
skills: ["deployment-compose", "infra-settings", "security", "docs"]
depends_on: []
next_tasks: []
created: "2026-02-05"
updated: "2026-02-05"
---

## Context

We need a safe, **read-only** remote diagnostics workflow in `GenericInfrastructure` to help ops/support inspect Docker Compose status and Traefik health over SSH without any risk of destructive changes. There is an existing `GenericInfrastructure/scripts/diagnose-and-fix.sh` that may contain fix steps; this task adds a separate, conservative workflow/script dedicated to read-only inspection.

Relevant files:
- `GenericInfrastructure/DEPLOYMENT.md` 🔧
- `GenericInfrastructure/traefik/traefik.yml` 🔧
- `GenericInfrastructure/traefik/docker-compose.yml` 🔧
- `GenericInfrastructure/scripts/` 🔧

## Acceptance Criteria ✅

- A **new script or workflow** exists in `GenericInfrastructure` that can be run from CI (workflow_dispatch) or locally and uses the secrets:
  - `SERVER_IP`, `SSH_USER`, `SSH_KEY` (already listed in `DEPLOYMENT.md`).
- The implementation runs **allowlisted read-only commands only**, for example:
  - `docker ps` (host-wide container listing)
  - `docker compose -f <path> ps` (per-app compose status)
  - `docker compose -f <path> logs --tail <N>` (tail logs, default capped, e.g., 200 lines)
  - `ss -ltnp` (filtered for ports 80/443) or equivalent to check listeners for HTTP(S)
- The script **accepts an `APP_NAME` or compose path input** to scope diagnostics to a particular app/compose file.
- `GenericInfrastructure/DEPLOYMENT.md` (or a new doc) is updated with how to run the diagnostics, the secret requirements, example invocations, and security notes.
- No destructive commands (stop/down/rm/restart/etc.) are included or callable via this workflow.
- Documentation includes a manual validation procedure (how to run and what to look for in output).

## Plan / Approach 🔧

1. **Create a read-only diagnostics script**: e.g. `GenericInfrastructure/scripts/ssh-diagnostics-readonly.sh`.
   - The script runs a fixed, **pre-defined** set of remote commands (no user-supplied arbitrary command string).
   - Accepts inputs: `--app-name <NAME>` or `--compose-path <PATH>`, `--tail <N>` (logs tail), `--keyfile <PATH>` optional for CI usage.
   - Constructs safe remote invocations such as:
     - `docker ps --no-trunc`
     - `docker compose -f /srv/infrastructure/<app>/docker-compose.yml ps`
     - `docker compose -f <path> logs --tail 200`
     - `ss -ltnp | grep -E ":80|:443"`
   - Limit output size (e.g., `--tail 200`) and exit with non-zero on unexpected errors.
   - Validate/sanitize `APP_NAME` to prevent path injection (only allow [a-z0-9-_]+).
   - Explicitly disallow destructive verbs: `down`, `stop`, `rm`, `restart`, `rmi`, `exec` (that could run arbitrary commands), and shell metacharacters.

2. **Add an optional GitHub Actions workflow** `/.github/workflows/infrastructure-diagnostics.yml` with `workflow_dispatch` that:
   - Uses `secrets.SERVER_IP`, `secrets.SSH_USER`, `secrets.SSH_KEY` (provided in DEPLOYMENT.md).
   - Writes `SSH_KEY` to a temporary file with `chmod 600` and passes it to the diagnostics script.
   - Runs the script and uploads the output as workflow logs/artifact for support.

3. **Documentation**:
   - Add a new subsection in `GenericInfrastructure/DEPLOYMENT.md` titled **Read-only SSH diagnostics** (or add `GenericInfrastructure/docs/SSH_DIAGNOSTICS.md`).
   - Document required secrets, example local invocation, example workflow_dispatch invocation, and expected outputs to look for (containers not running, Traefik errors in logs, ports not bound, etc.).
   - Call out security considerations and the explicit ban on destructive commands.

4. **Testing & Validation**:
   - Manual: Run the script against a known app and confirm output includes `docker compose ps` and `logs` output, and that `ss` indicates ports 80/443 listeners.
   - Add a short checklist in the task for the manual validation steps.

5. **Optional hardening** (follow-up):
   - Add a small accept-only wrapper on the server (e.g., in `/usr/local/bin/infra-diagnostics`) that ensures only predefined commands run, for environments that prefer server-side control.
   - Add a test harness or CI job that runs against a staging app for smoke testing (separate test task).

## Validation Notes (Manual) 🧪

- Run the diagnostics script locally (or trigger the workflow) against a test app:
  - Verify the logs contain expected service names and `docker compose ps` output.
  - Confirm `ss -ltnp` shows a process listening on 80 or 443 if Traefik is up.
  - Confirm the script **never** executes stop/down/remove commands and that logs show only the allowlisted commands.

## Notes / Context

- `GenericInfrastructure/DEPLOYMENT.md` already lists the `SERVER_IP`, `SSH_USER`, and `SSH_KEY` secrets; update it with usage examples and workflow details.
- There's an existing `diagnose-and-fix.sh` script in `GenericInfrastructure/scripts/` — do **not** add destructive fixes into the new read-only diagnostics workflow; instead, call out that fixes live in a separate, privileged workflow.

## Notes / Discoveries

- Implemented a read-only diagnostics script with allowlisted commands and strict input validation.
- Added a workflow_dispatch workflow that runs the script and uploads a diagnostics log artifact.
- Documented usage, security notes, and manual validation steps in `DEPLOYMENT.md`.

## Attempts / Log

- 2026-02-05: Added `scripts/ssh-diagnostics-readonly.sh`, workflow `infrastructure-diagnostics.yml`, and updated deployment docs.
   - Manual validation: run the script with `--app-name traefik` (or an explicit compose path), confirm `docker ps` output, `docker compose ps` output, tail logs, and listener checks for 80/443.

## Next Steps ✅

- Implement the script + (optional) workflow + documentation.
- Follow-up: add a small test task under `.instructions/test-tasks/` to add a staging smoke test for the diagnostics workflow (if desired).
