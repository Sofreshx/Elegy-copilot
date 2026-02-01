# Shared Messaging — PLAN Artefact ✅

## Goal
Make RabbitMQ and Redis shared infrastructure resources in `GenericInfrastructure` following the same pattern as Traefik and Observability. `SAASTools` is the first consumer; other apps will adopt the same approach.

---

## Success / Acceptance Criteria
- **Shared services**: Redis and RabbitMQ run from `GenericInfrastructure/messaging/docker-compose.yml` and advertise a `messaging` Docker network.
- **SAASTools**: `SAASTools/deployment/docker-compose.prod.yml` no longer defines local `redis` or `rabbitmq` services and joins the `messaging` network; app(s) connect to the shared services successfully in production.
- **RabbitMQ UI**: Management UI reachable at `rabbitmq.sfrsh.xyz` via Traefik with basic auth enabled.
- **Local dev**: Aspire + local development (e.g., `builder.AddRedis()` and `builder.AddRabbitMQ()`) remain unchanged and continue to work.
- **Docs**: Documentation updated in `GenericInfrastructure/README.md` and `SAASTools/README.md` (or deployment docs).

---

## Context Loaded (exact files to change)
- **New**: `GenericInfrastructure/messaging/docker-compose.yml`
- **New**: `GenericInfrastructure/messaging/.env.example`
- **Update**: `GenericInfrastructure/scripts/init-network.sh` (add `messaging` network)
- **Update**: `GenericInfrastructure/README.md` (add messaging section + how to expose RabbitMQ)
- **Update**: `SAASTools/deployment/docker-compose.prod.yml` (remove local redis/rabbitmq services; add `networks: - messaging`)
- **Docs**: `SAASTools/README.md` or deployment docs to include connection strings and troubleshooting

---

## Key Decisions & Rationale 💡
- **Single shared stack in GenericInfrastructure**: Matches existing pattern used for `traefik` and `observability` for operational consistency.
- **External Docker network (`messaging`)**: Uses same model as `traefik-proxy` / `observability` so apps can join network and use internal DNS names.
- **Credentials via `.env` file**: Keep a simple shared credentials store for now (per-app vhosts and finer RBAC planned later).
- **Expose RabbitMQ through Traefik with basic auth**: Leverage existing Traefik stack and central auth to avoid introducing additional public-facing management endpoints.
- **No change to local dev Aspire integrations**: Developers keep independent local instances for dev and tests; production-only migration reduces risk.

---

## Task Graph (IDs with deps) 🧭
1. GI-SETUP — GenericInfrastructure Setup
   - GI-1: Create `messaging/docker-compose.yml` (Redis + RabbitMQ + volumes + healthchecks + Traefik labels for `rabbitmq`)  (depends: none)
   - GI-2: Add `messaging/.env.example` and docs about secrets & env vars (depends: GI-1)
   - GI-3: Add `messaging` external network to `scripts/init-network.sh` (depends: GI-1)
   - GI-4: Add Traefik labels and basic-auth configuration for `rabbitmq.sfrsh.xyz` (depends: GI-1)
   - GI-5: Update `GenericInfrastructure/README.md` with install, run, and expose instructions (depends: GI-1, GI-2)

2. ST-MIGRATE — SAASTools Migration
   - ST-1: Remove `redis` and `rabbitmq` services from `SAASTools/deployment/docker-compose.prod.yml` (depends: GI-1, GI-3)
   - ST-2: Add `networks: - messaging` to SAASTools prod compose and set correct hostnames/connection strings (depends: ST-1)
   - ST-3: Update SAASTools deployment docs to reference shared services and `.env` values (depends: ST-2)
   - ST-4: Add sanity checks to CI/test pipeline to ensure no local `rabbitmq` or `redis` services are running in prod compose (depends: ST-1)

3. VALIDATION — Testing & Observability
   - V-1: Standalone run of `GenericInfrastructure/messaging/docker-compose.yml` and smoke tests (depends: GI-1, GI-2)
   - V-2: Deploy SAASTools prod compose (with messaging network) in a test environment and run integration tests (depends: ST-2, V-1)
   - V-3: Verify RabbitMQ logs, Redis metrics, and Docker network connectivity in Grafana / Loki (depends: V-2)
   - V-4: Create a post-deploy checklist & monitoring alert recommendations (depends: V-3)

Notes:
- Each task should have a single owner and one peer reviewer.
- Where applicable, add small unit/integration tests and a deployment smoke-test job.

---

## Execution Notes / How to run 🔧
- To run the messaging stack locally (Sanity):
  - cd `GenericInfrastructure/messaging`
  - cp `.env.example` to `.env` and set creds
  - `docker compose up -d`
  - `docker network ls` should show `messaging` (or use the external network creation script)
  - Check RabbitMQ UI at `http://rabbitmq.sfrsh.xyz` (make sure Traefik is configured / DNS or `/etc/hosts` points to Traefik)
- For SAASTools prod testing:
  - Ensure `GenericInfrastructure` messaging stack is up and `messaging` network is created
  - Update `SAASTools/deployment/docker-compose.prod.yml` to include `external: messaging` and remove local services
  - `docker compose -f deployment/docker-compose.prod.yml up -d` and run application integration tests
- CI: Add a smoke integration job which spins up `GenericInfrastructure/messaging` + `SAASTools` compose and runs a minimal health-check suite.

---

## Risks & Rollback ⚠️
- Single point of failure: Redis/RabbitMQ now shared—mitigation: ensure monitoring/alerts (V-3) and document runbooks.
- Credentials exposure or insufficient isolation: short-term use shared credentials, medium-term migrate to per-app vhosts and RBAC.
- Network connectivity issues: follow proven `observability` / `traefik` network pattern; include a rollback step to re-enable local containers in SAASTools compose if needed.

Rollback plan (short):
- Revert `SAASTools/deployment/docker-compose.prod.yml` to previous commit to restore local containers;
- Stop `GenericInfrastructure/messaging` and remove `messaging` network if requested.

---

## Validation & Acceptance Tests ✅
- **Standalone messaging smoke tests (V-1)**:
  - Start messaging stack; `redis-cli -h redis ping` => `PONG`
  - RabbitMQ: `rabbitmqctl status` (or check API) and Management UI reachable via Traefik
- **Integration (V-2)**:
  - Start `SAASTools` prod compose joined to `messaging` and run app health checks
  - Verify no local `redis` / `rabbitmq` containers are defined in final prod compose
- **Observability (V-3)**:
  - Check that metrics and logs for Redis and RabbitMQ are present in Grafana / Loki
  - Add and verify at least one alert (e.g., RabbitMQ queue length or node offline)

---

## Notes / Open Questions
- DNS / Traefik routing: confirm `rabbitmq.sfrsh.xyz` is already configured in Traefik provider for the environment or whether we need to add host resolution entries for test environments.
- Secrets management: consider storing credentials in secrets manager (Vault/GitHub Secrets) instead of `.env` long-term.

---

## Next steps
- Create per-task tickets (`.instructions/tasks/*`) and assign owners for GI-1 → V-4.
- Implement GI-1 (compose + env example) and GI-3 (init-network) as minimal atomic change and validate V-1.


> Artefact created to keep the big picture of the shared messaging migration stable and discoverable. Use the Task Graph above to create discrete, reviewable tasks.
