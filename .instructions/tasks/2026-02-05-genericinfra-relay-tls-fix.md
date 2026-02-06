---
schema: task/v1
id: task-000429
title: "Diagnose & fix TLS certificate chain for relay.sfrsh.xyz (Traefik)"
type: bug
status: blocked
priority: high
owner: "devops"
skills: ["deployment-compose", "security", "system-editor"]
depends_on: []
next_tasks: []
created: "2026-02-05"
updated: "2026-02-05"
---

## Context

OAuth callback requests to https://relay.sfrsh.xyz/auth/callback are failing with ERR_CERT_AUTHORITY_INVALID. This indicates the TLS certificate chain being served is not trusted by clients (self-signed, staging CA, or incomplete chain). The relay is fronted by Traefik in the GenericInfrastructure repo.

Relevant files & references:
- `GenericInfrastructure/traefik/traefik.yml` 🔧
- `GenericInfrastructure/traefik/docker-compose.yml` 🔧
- `GenericInfrastructure/observability/` (logs/dashboard access) 📊
- `instruction-engine/docs/relay-api-reference.md` (callback URL details) 📚

Validation notes:
- Confirm DNS A record for `relay.sfrsh.xyz` points to SERVER_IP
- Confirm ports 80/443 are open and reachable from the public internet

## Acceptance Criteria ✅
- The task determines whether Traefik's ACME issuance is failing and documents the root cause (e.g., ACME staging CA in use, HTTP challenge failing behind proxy, DNS misconfigured, or incomplete chain served).
- `GenericInfrastructure/traefik` configuration is updated if required so that Traefik serves a trusted certificate for `relay.sfrsh.xyz` (no use of staging CA or self-signed fallback in production).
- Validation step documented and executed: `curl -v https://relay.sfrsh.xyz/auth/callback` returns a trusted chain (no cert errors) and `openssl s_client -connect relay.sfrsh.xyz:443 -servername relay.sfrsh.xyz -showcerts` shows a complete chain with `Verify return code: 0 (ok)`.

## Plan / Approach 🔧
1. Reproduce the problem locally and capture artifacts:
   - `curl -v https://relay.sfrsh.xyz/auth/callback` (capture curl output including cert error)
   - `openssl s_client -connect relay.sfrsh.xyz:443 -servername relay.sfrsh.xyz -showcerts` (inspect chain and verify return code)
   - Document output and date/time in the task log.

2. Verify DNS & networking:
   - `dig +short relay.sfrsh.xyz` / `nslookup relay.sfrsh.xyz` -> confirm A record = SERVER_IP
   - From an external host: `curl -v http://relay.sfrsh.xyz` and `nc -vz relay.sfrsh.xyz 80` / `443` to confirm ports reachable
   - Check cloud provider / firewall / ufw / iptables / port forwarding and confirm 80/443 allowed.

3. Inspect Traefik config & state:
   - Review `GenericInfrastructure/traefik/traefik.yml` for `entryPoints` (web/websecure), certResolvers, and any `acme.caServer` overrides (staging vs prod).
   - Check `docker-compose` or service spec in `GenericInfrastructure/traefik/docker-compose.yml` and ensure Traefik has ports mapped and volumes for `acme.json`.
   - Check contents of the Traefik `acme.json` file and the certificates stored there.
   - Inspect Traefik logs for ACME-related failures: `docker-compose -f GenericInfrastructure/traefik/docker-compose.yml logs traefik --tail 200`.

4. Diagnose root cause possibilities (document whichever applies):
   - ACME using staging CA (untrusted). If `caServer` points to staging, change to production (remove `caServer` or set to production URL).
   - ACME challenge failing because port 80 is blocked or HTTP->HTTPS redirects interfere with http-01 (ensure http challenge entrypoint is reachable on port 80 and returns correct challenge responses).
   - DNS A record points to a different server (fix DNS / point to SERVER_IP).
   - Traefik serving a self-signed certificate fallback (remove fallback or ensure proper resolver is used and functioning).
   - Incomplete chain being served (ensure acme cert contains intermediates; Traefik normally serves full chain — if not, validate `acme.json` and Traefik version).
   - Cloudflare/other reverse proxy set to proxy mode interfering with HTTP-01; either turn proxy off, use DNS-01 with provider, or configure ACME DNS challenge.

5. Implement fix(s):
   - If config needs editing, update `GenericInfrastructure/traefik/traefik.yml` and `docker-compose.yml` as required (cert resolver name, remove staging `caServer`, add DNS challenge provider config if needed).
   - If a DNS/port/networking issue is found, coordinate to update DNS and firewall/SG settings so http-01 can succeed.
   - Restart Traefik (docker-compose up -d) and monitor logs for certificate issuance.
   - Re-run `openssl s_client` + `curl` to validate.

6. Rollback/mitigation plan if issuance fails repeatedly (rate limits):
   - Use Let's Encrypt staging to test configuration, then switch to production only after verifying.
   - If rate-limited, wait or use alternative CA/provider temporarily.

## Validation Steps ✅
- `curl -v https://relay.sfrsh.xyz/auth/callback` — must not show a certificate error (curl exit code success and no CERT_AUTHORITY messages).
- `openssl s_client -connect relay.sfrsh.xyz:443 -servername relay.sfrsh.xyz -showcerts` — chain present and `Verify return code: 0 (ok)`.
- Optional: Run SSL Labs scan against `relay.sfrsh.xyz` or `openssl` verify from multiple clients to confirm cross-platform trust.

## Attempts / Log
- [x] 2026-02-05: External checks from dev machine.
   - `curl -v https://relay.sfrsh.xyz/auth/callback` -> `SEC_E_UNTRUSTED_ROOT` / cert not trusted.
   - `openssl s_client -connect relay.sfrsh.xyz:443 -servername relay.sfrsh.xyz -showcerts` -> `CN=TRAEFIK DEFAULT CERT`, verify return code 18 (self-signed).
- [ ] Add Traefik logs showing ACME errors (paste logs and timestamps).

## Failures
- Document any attempted fixes that did not resolve the issue and their outcomes (e.g., rate limits encountered, DNS TTL delays).

## Notes / Discoveries
- Common root cause to try first: Traefik configured with Let's Encrypt "staging" CA during testing — staging certs are signed by a fake CA and will cause ERR_CERT_AUTHORITY_INVALID.
- If Cloudflare is configured as a proxy for the domain, http-01 will fail unless Cloudflare proxy is disabled or DNS-01 is used.
- Current public endpoint is serving Traefik's default self-signed certificate, which indicates ACME issuance is not completing for `relay.sfrsh.xyz`.
- Blocker: need server-side diagnostics (Traefik logs, `acme.json` permissions, and port 80 reachability) to identify the ACME failure.
   - Requested diagnostics:
      - `docker compose -f /srv/infrastructure/traefik/docker-compose.yml logs traefik --tail 200`
      - `ls -l /srv/infrastructure/traefik/acme.json`
      - `ss -ltnp | grep -E ':80|:443'`
      - `dig +short relay.sfrsh.xyz`

## Next Steps
1. Assign owner and perform the diagnosis steps (DNS, network, reproduce, log collection).
2. Apply configuration fix in `GenericInfrastructure/traefik` and validate using the commands above.
3. If confirmed fixed, note the exact changes in this task and add a short post-mortem and a follow-up task for monitoring/alerts (e.g., certificate expiry alert).

---

**Suggested Adjacent Work:**
- Add an observability check/alert that monitors TLS validity for `relay.sfrsh.xyz` and fails a heartbeat if cert is invalid or chain broken.
- Add a small runbook for ACME issuance issues (common checks: DNS, ports, Cloudflare proxy) and link it in `GenericInfrastructure/README.md`.

**How to validate quickly:**
1. `dig +short relay.sfrsh.xyz` -> should equal SERVER_IP
2. `curl -v https://relay.sfrsh.xyz/auth/callback` -> no cert errors
3. `openssl s_client -connect relay.sfrsh.xyz:443 -servername relay.sfrsh.xyz -showcerts` -> `Verify return code: 0 (ok)`
