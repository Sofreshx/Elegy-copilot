---
id: task-000010
title: "Create Deploy Auditor"
status: done
priority: high
owner: agent
depends_on: ["task-000008", "task-000009"]
skills: ["deployment-compose", "terraform"]
created: 2026-01-31
updated: 2026-01-31
---

# task-000010: Create Deploy Auditor

## Summary
Create an auditor that compares local vs production deployment configurations to detect drift and potential issues.

## Acceptance Criteria
- [x] Agent file `.github/agents/deploy-auditor.agent.md` created
- [x] Compares `docker-compose*.yml` files (local vs prod)
- [x] Checks `.env*` files for missing variables
- [x] Identifies port mismatches and service version differences
- [x] Produces `.instructions-output/deploy-audit.md`
- [x] Auto-loads `deployment-compose` and `terraform` skills when relevant

## Implementation Notes
- Look for files: `docker-compose.yml`, `docker-compose.local.yml`, `docker-compose.prod.yml`
- Compare environment variable definitions across files
- Check `deployment/` folder if present
- Report format: table of drift items with severity

## Completion Log
**Completed:** 2026-01-31

**Created:** `.github/agents/deploy-auditor.agent.md`

**Agent includes:**
- Docker Compose service comparison (services, images, ports, volumes, networks)
- Environment variable coverage checks across `.env*` files
- Port mapping consistency validation
- Image version alignment checks
- Terraform infrastructure drift detection (conditional)
- Severity guidelines (Critical/High/Medium/Low)
- Output format following `audit-report.schema.md`
- Finding categories: drift, config, env-vars, infrastructure, networking
