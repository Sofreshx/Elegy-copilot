---
schema: task/v1
id: task-000008
title: "Validate: Shared messaging infrastructure end-to-end with SAASTools"
type: chore
status: blocked
priority: medium
owner: "dylan"
skills: ["deployment-compose", "logging-observability", "system-health"]
depends_on: ["shared-messaging-01", "shared-messaging-02", "shared-messaging-04"]
next_tasks: []
created: "2026-01-30"
updated: "2026-01-31"
---

## Context

Validate that the shared messaging stack (Redis + RabbitMQ + Traefik + Grafana) functions both standalone and when integrated with SAASTools. See `.instructions/artefacts/shared-messaging-PLAN-artefact.md` for architecture, compose snippets, and environment variables.

This task verifies operational readiness and integration points (connectivity, health checks, UI access, and normal traffic in Grafana logs).

**Status:** Implementation complete. Waiting for deployment to server to run validation steps.

## Acceptance Criteria

- [ ] `docker exec redis redis-cli -a $REDIS_PASSWORD PING` returns `PONG`
- [ ] `docker exec rabbitmq rabbitmq-diagnostics -q ping` succeeds
- [ ] RabbitMQ Management UI loads at `https://rabbitmq.sfrsh.xyz`
- [ ] SAASTools services (accountmanager, tools) start without Redis/RabbitMQ connection errors
- [ ] Grafana logs show normal traffic through shared Redis/RabbitMQ (no repeated connection errors or auth failures)

## Deliverables

1. Standalone validation ✅
   - Start messaging stack in isolation (docker-compose or Traefik setup as per artefact)
   - Verify Redis responds to `PING`
   - Verify RabbitMQ health check passes (`rabbitmq-diagnostics ping`)
   - Verify RabbitMQ Management UI accessible via Traefik at the configured hostname

2. Integration validation ✅
   - Deploy SAASTools with the updated compose (pointing at shared Redis/RabbitMQ)
   - Verify services start and register with no connection errors in logs
   - Check Grafana dashboards/logs for normal traffic and absence of Redis/RabbitMQ errors

## Plan / Approach

1. Pre-checks
   - Confirm dependencies (tasks 01, 02, 04) are complete and their outputs applied (compose files, migrations, secrets)
   - Ensure environment variables (e.g., `REDIS_PASSWORD`, RabbitMQ credentials, Traefik DNS/hosts) are set in the test environment

2. Standalone stack
   - Bring up messaging stack in isolation using the compose provided in the artefact (or `deployment/docker-compose.messaging.yml` if present)
   - Run: `docker exec redis redis-cli -a $REDIS_PASSWORD PING` → expect `PONG`
   - Run: `docker exec rabbitmq rabbitmq-diagnostics -q ping` → expect success
   - Access `https://rabbitmq.sfrsh.xyz` and verify Management UI loads

3. Integration with SAASTools
   - Update SAASTools compose to point at shared messaging services (follow artefact guidance)
   - Start SAASTools services (accountmanager, tools)
   - Monitor service logs for connection errors to Redis/RabbitMQ
   - Validate Grafana logs/dashboards show expected traffic and no recurring errors

4. Cleanup
   - Tear down isolated stack if not needed, or leave running in a test environment per runbook

## Attempts / Log

(Record commands executed, timestamps, and outputs here during execution)

## Failures

(Record any failures, reproduction steps, and relevant logs)

## Notes / Discoveries

- Reference: `.instructions/artefacts/shared-messaging-PLAN-artefact.md`
- If RabbitMQ Management UI is behind Traefik and TLS, confirm DNS `rabbitmq.sfrsh.xyz` resolves to the test Traefik instance (or add /etc/hosts entry for local validation)
- If Grafana does not show traffic, check log shipping configuration and time ranges, and ensure no filters are hiding relevant events

## Next Steps

- Assign an owner to run the validation in a test environment and update `Attempts / Log` with results
- If any acceptance criteria fail, create follow-up tasks to remediate (network/DNS, secrets, compose misconfig)

---
