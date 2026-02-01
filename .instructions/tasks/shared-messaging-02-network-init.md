---
schema: task/v1
id: shared-messaging-02
title: "Update GenericInfrastructure: Add 'messaging' network initialization"
type: chore
status: not-started
priority: medium
owner: "dylan"
skills: ["deployment-compose", "system-editor"]
depends_on: []
next_tasks: []
created: "2026-01-30"
updated: "2026-01-30"
---

## Context

As part of the Shared Messaging work the infrastructure needs a dedicated Docker network named `messaging`. The existing `GenericInfrastructure/scripts/init-network.sh` script currently creates the `traefik-proxy` and `observability` networks. This task adds creating the `messaging` network so stack(s) can attach to it as an external network.

See: `.instructions/artefacts/shared-messaging-PLAN-artefact.md`

## Acceptance Criteria

- [ ] Running `./scripts/init-network.sh` creates a Docker network named `messaging` when it does not already exist.
- [ ] The script is idempotent and does not fail when the `messaging` network already exists.

## Plan / Approach

1. Update `GenericInfrastructure/scripts/init-network.sh`:
   - Add a `MESSAGING_NETWORK="messaging"` variable and include it in the existing loop that ensures `traefik-proxy` and `observability` exist.
   - Keep the same idempotent check (`docker network ls --filter name=^${NETWORK_NAME}$`) to avoid failure if the network exists.
2. Test locally:
   - Run `./scripts/init-network.sh` on a machine with Docker and verify `docker network ls` shows `messaging`.
   - Re-run the script to verify idempotence and that it prints "already exists" message without failing.
3. (Optional) Add a short note in `GenericInfrastructure/README.md` if necessary indicating that `messaging` is an externally created network for shared messaging services.

## Acceptance Test Steps

- Run `./scripts/init-network.sh` and confirm `docker network ls` includes `messaging`.
- Re-run the script and confirm it exits normally and indicates the network already exists.

## Notes / Discoveries

- No other tasks required; this can be executed in parallel with `shared-messaging-01-create-stack`.
- Keep output messaging consistent with existing script messages.

## Next Steps

- Assign to an owner and implement the script change.
- Run the local validation steps and update the task when done.
