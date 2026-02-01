---
schema: task/v1
id: task-000395
title: "Migrate SAASTools production compose to shared messaging (Redis + RabbitMQ)"
type: chore
status: not-started
priority: medium
owner: "dylan"
skills: ["deployment-compose","generic-infra.secrets-and-naming","docs"]
depends_on: ["task-000394"]
next_tasks: []
created: "2026-01-30"
updated: "2026-01-30"
---

## Context

As part of the shared messaging initiative, production compose for SAASTools should stop defining local Redis/RabbitMQ and instead use the shared messaging stack provided by `GenericInfrastructure` (see `.instructions/artefacts/shared-messaging-PLAN-artefact.md`). This task migrates `SAASTools/deployment/docker-compose.prod.yml` so SAASTools services use the shared messaging network and credentials supplied by environment (GitHub Secrets).

**Related:** `task-000394` (Create shared messaging stack)

## Acceptance Criteria

- [ ] `docker compose config` validates without errors for `SAASTools/deployment/docker-compose.prod.yml`
- [ ] No `redis` or `rabbitmq` service definitions exist in the production compose file
- [ ] No local `redis-data` or `rabbitmq-data` named volumes are defined in the production compose file
- [ ] `messaging` is referenced (as an external network) and required services (reverseproxy, accountmanager, tools) join the `messaging` network
- [ ] Connection strings are updated to point to shared hosts:
  - Redis: `redis:6379,password=${REDIS_PASSWORD}`
  - RabbitMQ: `amqp://${RABBITMQ_USER}:${RABBITMQ_PASSWORD}@rabbitmq:5672`
- [ ] `REDIS_PASSWORD`, `RABBITMQ_USER`, and `RABBITMQ_PASSWORD` are documented to come from environment (GitHub Secrets)

## Deliverables

- Update `SAASTools/deployment/docker-compose.prod.yml` to:
  - Remove `redis` and `rabbitmq` service definitions
  - Remove `redis-data` and `rabbitmq-data` volumes
  - Add `messaging` to `networks:` as an external network
  - Ensure `reverseproxy`, `accountmanager`, and `tools` services join the `messaging` network
  - Update any relevant environment variables/connection strings in the services to use the shared hostnames and password/user env vars shown above
- Add/Update `SAASTools/deployment/.env.example` (or deployment documentation) to reference required secrets and point to GitHub Secrets usage
- Document required GitHub repository secrets and scopes (`REDIS_PASSWORD`, `RABBITMQ_USER`, `RABBITMQ_PASSWORD`) and add a short PR description for infra team coordination

## Plan / Approach

1. Search the repo for existing references to `redis`, `rabbitmq`, `redis-data`, `rabbitmq-data`, and `messaging` to scope changes.
2. Edit `SAASTools/deployment/docker-compose.prod.yml`:
   - Remove the `redis` and `rabbitmq` service blocks and their named volumes.
   - Add `messaging:` under `networks:` with `external: true` (or the project's existing pattern for external networks).
   - Add `messaging` to the `networks:` section for `reverseproxy`, `accountmanager`, and `tools` services.
   - Update service environment variables/connection strings to use shared hostnames and env vars (see Deliverables).
3. Update `SAASTools/deployment/.env.example` and `deployment` docs to list `REDIS_PASSWORD`, `RABBITMQ_USER`, `RABBITMQ_PASSWORD` and mention that values come from GitHub Secrets.
4. Validate changes locally with:
   - `docker compose -f SAASTools/deployment/docker-compose.prod.yml --env-file SAASTools/deployment/.env.example config`
   - Ensure `docker compose config` produces no errors and that `redis`/`rabbitmq` are not defined
5. Open a PR with a clear description of the migration and request review/coordination from the infra team owning the shared messaging stack (reference `task-000394`).
6. After PR approval, coordinate deploy and verify behavior in staging/production (ensure apps can connect to shared Redis/RabbitMQ and logs/healthchecks are green).

## Testing / Validation

- `docker compose config` must succeed
- Confirm `redis` and `rabbitmq` are not present in the output of `docker compose config` (search for references)
- Confirm `messaging` appears under `networks:` and is marked external
- Confirm service environment variables or connection strings reference the expected `redis`/`rabbitmq` hostnames and env vars
- Run smoke tests against staging after deployment to ensure connectivity

## Notes / Considerations

- This task assumes the shared messaging stack (`task-000394`) exists and is reachable from the SAASTools environment (network and DNS).
- If any service constructs connection strings dynamically or uses different env var names (e.g., `REDIS_URL`, `RABBITMQ_CONNECTION`), update those values consistently and document the mapping in the PR.
- Consider adding a short migration note in `deployment/README.md` explaining the change and the required GitHub secrets.

## Next Steps

- Implement changes and open a PR. Request infra review to ensure the shared messaging stack is ready and secrets are in place.
- After deployment, verify connectivity and monitor for errors.
