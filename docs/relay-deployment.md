# Relay Deployment Guide

> **Last updated**: 2026-02-11
>
> Deployment, backup, and rollback procedures for the Instruction Engine Cloud Relay on a single Vultr VPS behind Traefik v3.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Pre-deployment Checklist](#pre-deployment-checklist)
3. [Deployment](#deployment)
4. [Health Check Verification](#health-check-verification)
5. [Backup](#backup)
6. [Rollback](#rollback)
7. [Volume Management](#volume-management)
8. [Troubleshooting](#troubleshooting)

---

## Architecture Overview

```
Internet ──▶ Traefik (443) ──▶ relay container (3000)
                                   │
                                   ▼
                             /app/data/relay.db  (SQLite, Docker volume: relay-data)
```

- **Image**: `ghcr.io/sofreshx/instruction-engine-cloud-relay:latest`
- **Container name**: `instruction-engine-relay`
- **Domain**: `relay.sfrsh.xyz`
- **Network**: `traefik-proxy` (external Docker network)
- **Data**: SQLite database at `/app/data/relay.db` stored in the `relay-data` Docker volume
- **Compose files**:
  - Production: `cloud-relay/docker-compose.prod.yml`
  - Development: `cloud-relay/docker-compose.yml`

---

## Pre-deployment Checklist

Before deploying or updating the relay, confirm the following:

### Environment Variables

The relay reads its configuration from an `.env` file on the server. Required variables:

| Variable | Description | Required |
|---|---|---|
| `JWT_SECRET` | Secret key for signing JWTs | Yes |
| `GITHUB_CLIENT_ID` | GitHub OAuth app client ID | Yes |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth app client secret | Yes |
| `VAPID_PUBLIC_KEY` | VAPID public key for push notifications | If push enabled |
| `VAPID_PRIVATE_KEY` | VAPID private key for push notifications | If push enabled |
| `VAPID_SUBJECT` | VAPID subject (email or URL) | If push enabled |

The compose file also sets these defaults (override via `.env` if needed):

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `production` | Runtime environment |
| `PORT` | `3000` | Internal listen port |
| `HOST` | `0.0.0.0` | Bind address |
| `JWT_ISSUER` | `instruction-engine-relay` | JWT issuer claim |
| `JWT_AUDIENCE` | `instruction-engine` | JWT audience claim |
| `REQUIRE_AUTH` | `true` | Require JWT for WebSocket |
| `MAX_MESSAGE_SIZE` | `1048576` | Max WebSocket message (bytes) |
| `DB_PATH` | `/app/data/relay.db` | SQLite database path |

### Infrastructure Prerequisites

- [ ] `traefik-proxy` Docker network exists (`docker network ls | grep traefik-proxy`)
- [ ] Traefik is running and healthy
- [ ] DNS A record for `relay.sfrsh.xyz` points to the VPS IP
- [ ] `.env` file exists at the compose directory with all required secrets
- [ ] `.env` file permissions are restricted (`chmod 600 .env`)

---

## Deployment

### First-time Deployment

```bash
# On the VPS
cd /srv/apps/relay

# Ensure the traefik-proxy network exists
docker network ls | grep traefik-proxy || docker network create traefik-proxy

# Create .env with required secrets
# (copy from password manager / GitHub Secrets, never commit)
vim .env
chmod 600 .env

# Deploy
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

### Update Deployment (Standard)

This is the standard procedure for deploying a new version:

```bash
cd /srv/apps/relay

# 1. Back up the database BEFORE any changes
./relay-backup.sh /srv/backups/relay

# 2. Pull the new image
docker compose -f docker-compose.prod.yml pull

# 3. Recreate the container with the new image
docker compose -f docker-compose.prod.yml up -d --no-build

# 4. Verify health (see Health Check section below)
```

**Downtime**: Expect 5–15 seconds while the container restarts. The `start_period` health check grace of 5 seconds covers initialization. Traefik will route traffic only to the healthy container.

### Rebuild from Source (if not using pre-built image)

```bash
cd /srv/apps/relay

# 1. Back up
./relay-backup.sh /srv/backups/relay

# 2. Build and deploy
docker compose -f docker-compose.prod.yml build --no-cache
docker compose -f docker-compose.prod.yml up -d

# 3. Verify health
```

---

## Health Check Verification

After any deployment, verify the relay is healthy:

```bash
# Container health status
docker inspect --format='{{.State.Health.Status}}' instruction-engine-relay
# Expected: healthy

# Liveness probe
curl -sf https://relay.sfrsh.xyz/health/live
# Expected: 200 OK

# Readiness probe
curl -sf https://relay.sfrsh.xyz/health/ready
# Expected: 200 OK

# If readiness fails, it returns 503 with a JSON body that includes which
# required env vars are missing (for example: GITHUB_CLIENT_SECRET).

# Full health endpoint (includes metrics)
curl -s https://relay.sfrsh.xyz/health | jq .

# Container logs (last 50 lines)
docker logs --tail 50 instruction-engine-relay

# Prometheus metrics
curl -s https://relay.sfrsh.xyz/health/metrics
```

### Automated Health Check (post-deploy script)

```bash
#!/bin/bash
# Quick post-deploy verification
set -e

echo "Waiting for container to be healthy..."
for i in {1..30}; do
  STATUS=$(docker inspect --format='{{.State.Health.Status}}' instruction-engine-relay 2>/dev/null || echo "not-found")
  if [[ "$STATUS" == "healthy" ]]; then
    echo "Container is healthy after ${i}s"
    break
  fi
  if [[ $i -eq 30 ]]; then
    echo "ERROR: Container not healthy after 30s"
    docker logs --tail 20 instruction-engine-relay
    exit 1
  fi
  sleep 1
done

# External health check
HTTP_CODE=$(curl -so /dev/null -w '%{http_code}' https://relay.sfrsh.xyz/health/ready)
if [[ "$HTTP_CODE" != "200" ]]; then
  echo "ERROR: Health endpoint returned $HTTP_CODE"
  exit 1
fi

echo "Deployment verified OK"
```

---

## Backup

### About the SQLite Database

The relay uses SQLite (`better-sqlite3`) for persistent storage:
- **Location in container**: `/app/data/relay.db`
- **Docker volume**: `relay-data`
- **Data stored**: offline message queues, user registrations, push subscriptions, device tokens

### Backup Script

Use the provided `scripts/relay-backup.sh`:

```bash
# Default: saves to ./backups/
./scripts/relay-backup.sh

# Custom backup directory
./scripts/relay-backup.sh /srv/backups/relay
```

The script uses SQLite's `.backup` command, which creates a consistent snapshot even while the database is in use (no need to stop the container).

### Manual Backup

```bash
# Using SQLite's online backup API (safe while relay is running)
docker exec instruction-engine-relay \
  sqlite3 /app/data/relay.db ".backup /app/data/relay-backup.db"

docker cp instruction-engine-relay:/app/data/relay-backup.db \
  ./relay-$(date +%Y%m%d_%H%M%S).db

docker exec instruction-engine-relay rm /app/data/relay-backup.db
```

### Backup Retention

Recommended backup schedule for a single-VPS deployment:

| Frequency | Retention | Method |
|---|---|---|
| Before each deploy | Keep last 5 | `relay-backup.sh` |
| Daily (cron) | Keep last 7 | `relay-backup.sh` + prune |

Example cron job (add to server's crontab):

```cron
# Daily relay backup at 03:00 UTC, keep last 7
0 3 * * * /srv/apps/relay/relay-backup.sh /srv/backups/relay && find /srv/backups/relay -name "relay-*.db" -mtime +7 -delete
```

### Verify a Backup

```bash
# Check backup integrity
sqlite3 backup-file.db "PRAGMA integrity_check;"
# Expected: ok

# Check row counts
sqlite3 backup-file.db ".tables"
sqlite3 backup-file.db "SELECT COUNT(*) FROM push_subscriptions;"
```

---

## Rollback

### Scenario 1: Bad Code (Roll Back Image)

If a new relay version introduces bugs, roll back to the previous image:

```bash
cd /srv/apps/relay

# 1. Check available image versions
docker image ls ghcr.io/sofreshx/instruction-engine-cloud-relay

# 2. Update compose file to pin the previous image tag
#    e.g., change :latest to :sha-abc1234
#    Or use the local cached previous image:
docker compose -f docker-compose.prod.yml down

# 3. Run the previous image
docker compose -f docker-compose.prod.yml up -d

# 4. Verify health
curl -sf https://relay.sfrsh.xyz/health/live
```

If using `:latest` tags, Docker caches the previous image locally. You can identify it with:

```bash
# List local images with their digests
docker images --digests ghcr.io/sofreshx/instruction-engine-cloud-relay
```

**Recommendation**: Tag releases with commit SHA or semver (e.g., `:sha-abc1234` or `:v1.2.3`) for deterministic rollbacks. Update the compose file's `image:` field to the known-good tag.

### Scenario 2: Bad Data (Restore Database)

If a deployment corrupts the database or a migration goes wrong:

```bash
cd /srv/apps/relay

# 1. Stop the relay
docker compose -f docker-compose.prod.yml down

# 2. Find the backup
ls -lt /srv/backups/relay/
# Pick the most recent pre-deployment backup

# 3. Restore the backup into the volume
#    First, copy the backup into a temp container that mounts the volume
docker run --rm -v relay-data:/data -v /srv/backups/relay:/backup \
  alpine cp /backup/relay-20260211_120000.db /data/relay.db

# 4. Start the relay
docker compose -f docker-compose.prod.yml up -d

# 5. Verify data
docker exec instruction-engine-relay \
  sqlite3 /app/data/relay.db "PRAGMA integrity_check;"
```

### Scenario 3: Full Rollback (Image + Data)

Combine both procedures: restore the database first, then start with the previous image.

---

## Volume Management

### Inspecting the Volume

```bash
# Volume details
docker volume inspect relay-data

# Volume disk usage
docker system df -v | grep relay-data

# List files inside the volume
docker run --rm -v relay-data:/data alpine ls -la /data/
```

### Volume Location on Host

Docker stores volumes at `/var/lib/docker/volumes/relay-data/_data/` by default. You can access the SQLite file directly from there, but prefer using `docker cp` or the backup script to avoid locking issues.

### Migrating the Volume

To move the relay data to a new server:

```bash
# On the old server: export
docker run --rm -v relay-data:/data -v /tmp:/backup \
  alpine tar czf /backup/relay-data.tar.gz -C /data .

scp /tmp/relay-data.tar.gz newserver:/tmp/

# On the new server: import
docker volume create relay-data
docker run --rm -v relay-data:/data -v /tmp:/backup \
  alpine sh -c "cd /data && tar xzf /backup/relay-data.tar.gz"
```

### Removing the Volume (Destructive)

```bash
# WARNING: This permanently deletes all relay data
docker compose -f docker-compose.prod.yml down
docker volume rm relay-data
```

---

## Troubleshooting

### Container Won't Start

```bash
# Check logs
docker logs instruction-engine-relay

# Common causes:
# - Missing .env file or missing required env vars
# - Port 3000 conflict (unlikely with Traefik routing)
# - SQLite file permissions (volume owned by wrong UID)

```

### `/auth/callback` Returns 500

If the mobile sign-in flow fails with an HTTP 500 from `POST /auth/callback`, the most common cause is missing GitHub OAuth credentials in the relay runtime environment.

Verify readiness and missing keys:

```bash
curl -s https://relay.sfrsh.xyz/health/ready | jq .
```

If it shows `ready: false`, ensure the server `.env` contains `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`, then redeploy.

### Database Locked / Corruption

```bash
# Check database integrity
docker exec instruction-engine-relay \
  sqlite3 /app/data/relay.db "PRAGMA integrity_check;"

# If corrupt: restore from backup (see Rollback section)
```

### Traefik Not Routing to Relay

```bash
# Check Traefik sees the container
docker logs traefik 2>&1 | grep relay

# Verify labels
docker inspect instruction-engine-relay --format='{{json .Config.Labels}}' | jq .

# Verify the shared network
docker network inspect traefik-proxy --format='{{range .Containers}}{{.Name}} {{end}}'
```

### Out of Disk Space

SQLite WAL files can grow if there are many writes. Check disk usage:

```bash
docker exec instruction-engine-relay ls -la /app/data/
docker system df
```

To reclaim space, run a checkpoint:

```bash
docker exec instruction-engine-relay \
  sqlite3 /app/data/relay.db "PRAGMA wal_checkpoint(TRUNCATE);"
```
