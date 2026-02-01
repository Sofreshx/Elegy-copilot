---
schema: task/v1
id: task-000395
title: "Add docs: GenericInfrastructure - Messaging (Redis & RabbitMQ)"
type: docs
status: done
priority: medium
owner: "dylan"
skills: ["docs","deployment-compose","generic-infra.secrets-and-naming"]
depends_on: ["task-000394"]
next_tasks: []
created: "2026-01-30"
updated: "2026-01-31"
---

## Context

The `GenericInfrastructure` repo is getting a shared messaging stack (Redis + RabbitMQ) implemented in `GenericInfrastructure/messaging/` (see `shared-messaging-01-create-stack` task and `.instructions/artefacts/shared-messaging-PLAN-artefact.md`). We need README documentation so app authors know how to connect their services to the shared messaging infrastructure for local/dev and deployment examples.

This task adds a **"Messaging (Redis & RabbitMQ)"** section to `GenericInfrastructure/README.md` describing:
- Which services run and purpose
- How to start the stack
- How apps join the `messaging` network
- Connection string patterns and example environment variables
- Credentials management guidance
- An updated "How to Deploy a New App" example with a docker-compose snippet showing `messaging` network join and connection strings

## Acceptance Criteria

- [ ] `GenericInfrastructure/README.md` includes a **Messaging (Redis & RabbitMQ)** section covering the items above
- [ ] The "How to Deploy a New App" example contains a docker-compose snippet that demonstrates joining the `messaging` network and setting connection strings for Redis and RabbitMQ
- [ ] The README explains where to find the messaging compose file and `.env.example` (i.e., `GenericInfrastructure/messaging/`)

## Plan / Approach

1. Read `.instructions/artefacts/shared-messaging-PLAN-artefact.md` and `GenericInfrastructure/messaging/.env.example` to ensure accurate variable names and credential formats.
2. Add a new **Messaging (Redis & RabbitMQ)** section to `GenericInfrastructure/README.md`:
   - Short summary of services (Redis 7, RabbitMQ with management)
   - How to start locally (point to `GenericInfrastructure/messaging/docker-compose.yml` and `.env.example`, and note `docker network create messaging` if networks are missing)
   - How an app should join the `messaging` network (example `networks: - messaging`) and any relevant network configuration
   - Connection string patterns (examples for Redis and RabbitMQ using env vars from `.env.example`)
   - Credentials management and recommended patterns (use env vars, reference `generic-infra.secrets-and-naming` guidance, and mention using secrets manager or CI/CD secret injection in production)
3. Update the **How to Deploy a New App** example to include a minimal `docker-compose` service snippet showing `networks: - messaging` and `environment:` with `REDIS_URL` and `RABBITMQ_URL` examples.
4. Add a short subsection with example validation / smoke-test steps (e.g., `redis-cli -h redis -a $REDIS_PASSWORD ping`, RabbitMQ Management UI location and example vhost/user check).
5. Run a quick check for typos and ensure the README content is concise and formatted consistently with the repository's style.

## Attempts / Log

- [2026-01-31] Updated `GenericInfrastructure/README.md`:
  - Added **Messaging (Redis & RabbitMQ)** section after "Operations UI (Dockge)" section, covering:
    - What runs (Redis 7, RabbitMQ with Management UI)
    - Access URL: `https://rabbitmq.sfrsh.xyz`
    - How to start: `cd /srv/infrastructure/messaging && cp .env.example .env && docker compose up -d`
    - Connection string patterns for apps
    - Credentials management (`.env` file, reference to `.env.example`, GitHub Secrets for production)
  - Updated "How to Deploy a New App" section:
    - Added step 3 for joining `messaging` network
    - Updated example docker-compose.yml to show `messaging` network and Redis/RabbitMQ connection string environment variables

## Failures

(Leave blank unless failures occur)

## Notes / Discoveries

- This task depends on `task-000394` which implements the actual messaging stack and `.env.example` values.
- Keep examples minimal and link to the messaging compose file rather than duplicating full configuration.

## Next Steps

- Edit `GenericInfrastructure/README.md` to add the Messaging section and example snippet, then open a PR.
- Optionally add a follow-up task to add a `make` target or script that ensures networks exist for local testing.
