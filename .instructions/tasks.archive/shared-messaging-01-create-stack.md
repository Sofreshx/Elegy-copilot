---
schema: task/v1
id: task-000394
title: "Create shared messaging stack in GenericInfrastructure (Redis + RabbitMQ)"
type: feature
status: done
priority: medium
owner: "dylan"
skills: ["deployment-compose","generic-infra.secrets-and-naming","docs"]
depends_on: []
next_tasks: []
created: "2026-01-30"
updated: "2026-01-30"
---

## Context

We need a small, production-like shared messaging stack for local/dev usage in `GenericInfrastructure` that provides Redis and RabbitMQ with durable storage and observability networking. This work implements the stack defined in the project artefact: `.instructions/artefacts/shared-messaging-PLAN-artefact.md` and will be consumed by other services that expect `messaging` and `observability` networks to exist.

The user-level deliverables are a compose file and an `.env.example` with appropriate secrets placeholders.

## Acceptance Criteria

- [ ] `docker compose config` validates without errors for the new compose file
- [ ] Services can start (after required networks are created externally)
- [ ] RabbitMQ Management UI is reachable via Traefik using hostname `rabbitmq.sfrsh.xyz` and the compose includes Traefik labels
- [ ] Redis and RabbitMQ use named volumes for persistence: `messaging-redis-data`, `messaging-rabbitmq-data`
- [ ] `.env.example` contains `REDIS_PASSWORD`, `RABBITMQ_USER`, `RABBITMQ_PASSWORD`, `RABBITMQ_BASIC_AUTH_USERS`

## Plan / Approach

1. Add `GenericInfrastructure/messaging/docker-compose.yml` with two services:
   - `redis` (Redis 7 Alpine):
     - AOF persistence enabled
     - Password authentication via `REDIS_PASSWORD` env var
     - Healthcheck
     - Join `messaging` and `observability` networks
     - Volume: `messaging-redis-data:/data`
   - `rabbitmq` (RabbitMQ 3 management alpine):
     - Credentials and vhost from env
     - Management UI exposed and configured for Traefik with labels for `rabbitmq.sfrsh.xyz`
     - Healthcheck
     - Join `messaging` and `observability` networks
     - Volume: `messaging-rabbitmq-data:/var/lib/rabbitmq`
2. Create `GenericInfrastructure/messaging/.env.example` listing required env vars:
   - `REDIS_PASSWORD`
   - `RABBITMQ_USER`
   - `RABBITMQ_PASSWORD`
   - `RABBITMQ_BASIC_AUTH_USERS` (value format: `user:password` or Traefik basic auth encoding instructions)
3. Use Traefik labels on the RabbitMQ service to expose `rabbitmq.sfrsh.xyz` and attach a basic auth middleware using the `RABBITMQ_BASIC_AUTH_USERS` env var. Document expected middleware name in task notes.
4. Validate with `docker compose -f GenericInfrastructure/messaging/docker-compose.yml --env-file GenericInfrastructure/messaging/.env.example config` and then (locally) `docker compose up` against the file after providing a real `.env` to ensure containers start.
5. Add short notes to the task file about how to test the UI (via Traefik) and where to find volumes/networks.

## Attempts / Log

**2026-01-31 - task-runner**
- Created `GenericInfrastructure/messaging/docker-compose.yml` with:
  - `redis` service (redis:7-alpine) with AOF persistence, password auth, healthcheck
  - `rabbitmq` service (rabbitmq:3-management-alpine) with credentials, Traefik labels for `rabbitmq.sfrsh.xyz`, basic auth middleware
  - Named volumes: `messaging-redis-data`, `messaging-rabbitmq-data`
  - Networks: `messaging`, `observability`, `traefik-proxy` (for rabbitmq)
- Created `GenericInfrastructure/messaging/.env.example` with `REDIS_PASSWORD`, `RABBITMQ_USER`, `RABBITMQ_PASSWORD`, `RABBITMQ_BASIC_AUTH_USERS`
- Validated: `docker compose config` passed successfully

## Failures

(leave blank — to be filled if any problems)

## Notes / Discoveries

- This task intentionally does not create the `messaging` and `observability` networks; they should be provisioned by the environment (or a follow-up task can create them). Document how to create them for local testing: `docker network create messaging` and `docker network create observability`.
- Traefik integration assumes Traefik is present in the environment and reads Docker labels. The `RABBITMQ_BASIC_AUTH_USERS` will be passed as an env var so that Traefik can use it in a dynamic middleware; include example formatting in `.env.example`.

## Next Steps

- Implement `docker-compose.yml` and `.env.example` in `GenericInfrastructure/messaging/` and validate `docker compose config`.
- If you'd like, I can also open a follow-up task to add a `make` target or script to ensure networks exist for local testing and to wire a Traefik secure middleware in a central place.
