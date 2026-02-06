# MCP + Infra Secrets Inventory

## Scope

This doc inventories MCP (Vultr, Supabase), infrastructure, and app secrets for the Instruction Engine and GenericInfrastructure repos. It maps each secret to its owning repo, references, and expected storage location.

## Assumptions

- GitHub secrets listing was not available in this environment. Status is marked as unknown for GitHub Actions secrets/vars until the secrets list or screenshot is provided.
- Use the provided GitHub secrets screenshot list (out-of-band) to mark present vs missing where noted below.

## Required secrets list (minimum set)

| Secret | Description | Store | Owner repo | References |
| --- | --- | --- | --- | --- |
| VULTR_API_KEY | Vultr API key for Terraform provisioning | GitHub Actions secret | GenericInfrastructure | .github/workflows/terraform-plan.yml, .github/workflows/terraform-apply.yml |
| SUPABASE_PROJECT_REF | Supabase project reference for MCP | Local env / secret store | instruction-engine | docs/mcp-workflow.md (provider defaults) |
| SUPABASE_ACCESS_TOKEN | Supabase access token for MCP | Local env / secret store | instruction-engine | docs/mcp-workflow.md (provider defaults) |
| SERVER_IP | Server IP used by deploy workflows | GitHub Actions secret | instruction-engine, GenericInfrastructure | instruction-engine/.github/workflows/cloud-relay-deploy.yml, GenericInfrastructure/.github/workflows/deploy-infrastructure.yml |
| SSH_USER | SSH user for deployments | GitHub Actions secret | instruction-engine, GenericInfrastructure | instruction-engine/.github/workflows/cloud-relay-deploy.yml, GenericInfrastructure/.github/workflows/deploy-infrastructure.yml |
| SSH_KEY | SSH private key for deployments | GitHub Actions secret | instruction-engine, GenericInfrastructure | instruction-engine/.github/workflows/cloud-relay-deploy.yml, GenericInfrastructure/.github/workflows/deploy-infrastructure.yml |
| OAUTH_CLIENT_ID | GitHub OAuth client ID | GitHub Actions secret | instruction-engine | instruction-engine/.github/workflows/cloud-relay-deploy.yml, instruction-engine/.github/workflows/mobile-deploy.yml |
| RELAY_HTTP_URL | Relay base URL for mobile build | GitHub Actions variable | instruction-engine | instruction-engine/.github/workflows/mobile-deploy.yml |
| RELAY_WS_URL | Relay WS URL for mobile build | GitHub Actions variable | instruction-engine | instruction-engine/.github/workflows/mobile-deploy.yml |
| RELAY_JWT_SECRET | JWT signing secret for relay | GitHub Actions secret | instruction-engine | instruction-engine/.github/workflows/cloud-relay-deploy.yml |

## Additional secrets and configuration

### Instruction Engine repo

| Secret / Var | Description | Store | References |
| --- | --- | --- | --- |
| OAUTH_CLIENT_SECRET | GitHub OAuth client secret | GitHub Actions secret | .github/workflows/cloud-relay-deploy.yml |
| RELAY_GITHUB_REDIRECT_URI | OAuth redirect URI for relay | GitHub Actions secret | .github/workflows/cloud-relay-deploy.yml |
| RELAY_WEBHOOK_SECRET | Relay webhook auth for remote-agent workflow | GitHub Actions secret | .github/workflows/remote-agent.yml |
| VITE_GITHUB_CLIENT_ID | Client ID for mobile companion (not secret) | .env (local) | mobile-companion/.env.example |
| VITE_GITHUB_REDIRECT_URI | Redirect URI for mobile companion (not secret) | .env (local) | mobile-companion/.env.example |
| VITE_RELAY_HTTP_URL | Relay HTTP URL for mobile companion (not secret) | .env (local) | mobile-companion/.env.example |
| VITE_RELAY_WS_URL | Relay WS URL for mobile companion (not secret) | .env (local) | mobile-companion/.env.example |
| JWT_SECRET | Relay JWT secret used by service | Server .env | cloud-relay/.env.example, .github/workflows/cloud-relay-deploy.yml |

### GenericInfrastructure repo

| Secret / Var | Description | Store | References |
| --- | --- | --- | --- |
| GRAFANA_ADMIN_PASSWORD | Grafana admin password | GitHub Actions secret + server .env | DEPLOYMENT.md, .github/workflows/deploy-infrastructure.yml, observability/.env.example |
| GRAFANA_BASIC_AUTH_USERS | Grafana basic auth users | GitHub Actions secret + server .env | DEPLOYMENT.md, .github/workflows/deploy-infrastructure.yml, observability/.env.example |
| DOCKGE_BASIC_AUTH_USERS | Dockge basic auth users | GitHub Actions secret + server .env | DEPLOYMENT.md, .github/workflows/deploy-infrastructure.yml, ops/.env.example |
| TERRAFORM_CLOUD_TOKEN | Terraform Cloud API token | GitHub Actions secret | .github/workflows/terraform-plan.yml, .github/workflows/terraform-apply.yml, .github/workflows/sync-server-ip.yml |
| TFC_ORG | Terraform Cloud org | GitHub Actions secret | .github/workflows/terraform-plan.yml, .github/workflows/terraform-apply.yml, .github/workflows/sync-server-ip.yml |
| TFC_WORKSPACE | Terraform Cloud workspace | GitHub Actions secret | .github/workflows/terraform-plan.yml, .github/workflows/terraform-apply.yml, .github/workflows/sync-server-ip.yml |
| GH_PAT | GitHub PAT for setting secrets | GitHub Actions secret | .github/workflows/sync-server-ip.yml |
| REDIS_PASSWORD | Redis password | Server .env | messaging/.env.example, DEPLOYMENT.md |
| RABBITMQ_DEFAULT_USER | RabbitMQ user | Server .env | messaging/.env.example, DEPLOYMENT.md |
| RABBITMQ_DEFAULT_PASS | RabbitMQ password | Server .env | messaging/.env.example, DEPLOYMENT.md |
| RABBITMQ_BASIC_AUTH_USERS | RabbitMQ UI basic auth users | Server .env | messaging/.env.example, DEPLOYMENT.md |

## Current vs Missing (needs verification)

GitHub Actions secrets/vars cannot be verified in this environment. Use the GitHub secrets screenshot list (provided out-of-band) or run `gh secret list` to mark each as present or missing.

| Secret / Var | Store | Status | Evidence |
| --- | --- | --- | --- |
| VULTR_API_KEY | GitHub Actions secret | Unknown | Requires GH secrets list or screenshot |
| SUPABASE_PROJECT_REF | Local env / secret store | Unknown | Not referenced in repo; MCP usage only |
| SUPABASE_ACCESS_TOKEN | Local env / secret store | Unknown | Not referenced in repo; MCP usage only |
| SERVER_IP | GitHub Actions secret | Unknown | Requires GH secrets list or screenshot |
| SSH_USER | GitHub Actions secret | Unknown | Requires GH secrets list or screenshot |
| SSH_KEY | GitHub Actions secret | Unknown | Requires GH secrets list or screenshot |
| OAUTH_CLIENT_ID | GitHub Actions secret | Unknown | Requires GH secrets list or screenshot |
| OAUTH_CLIENT_SECRET | GitHub Actions secret | Unknown | Requires GH secrets list or screenshot |
| RELAY_GITHUB_REDIRECT_URI | GitHub Actions secret | Unknown | Requires GH secrets list or screenshot |
| RELAY_JWT_SECRET | GitHub Actions secret | Unknown | Requires GH secrets list or screenshot |
| RELAY_WEBHOOK_SECRET | GitHub Actions secret | Unknown | Requires GH secrets list or screenshot |
| RELAY_HTTP_URL | GitHub Actions variable | Unknown | Requires GH vars list or screenshot |
| RELAY_WS_URL | GitHub Actions variable | Unknown | Requires GH vars list or screenshot |
| GRAFANA_ADMIN_PASSWORD | GitHub Actions secret | Unknown | Requires GH secrets list or screenshot |
| GRAFANA_BASIC_AUTH_USERS | GitHub Actions secret | Unknown | Requires GH secrets list or screenshot |
| DOCKGE_BASIC_AUTH_USERS | GitHub Actions secret | Unknown | Requires GH secrets list or screenshot |
| TERRAFORM_CLOUD_TOKEN | GitHub Actions secret | Unknown | Requires GH secrets list or screenshot |
| TFC_ORG | GitHub Actions secret | Unknown | Requires GH secrets list or screenshot |
| TFC_WORKSPACE | GitHub Actions secret | Unknown | Requires GH secrets list or screenshot |
| GH_PAT | GitHub Actions secret | Unknown | Requires GH secrets list or screenshot |
| REDIS_PASSWORD | Server .env | Expected on server | messaging/.env.example |
| RABBITMQ_DEFAULT_USER | Server .env | Expected on server | messaging/.env.example |
| RABBITMQ_DEFAULT_PASS | Server .env | Expected on server | messaging/.env.example |
| RABBITMQ_BASIC_AUTH_USERS | Server .env | Expected on server | messaging/.env.example |

## Repo ownership and references

### instruction-engine

- .github/workflows/cloud-relay-deploy.yml: SERVER_IP, SSH_USER, SSH_KEY, RELAY_JWT_SECRET, OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET, RELAY_GITHUB_REDIRECT_URI
- .github/workflows/mobile-deploy.yml: OAUTH_CLIENT_ID, RELAY_HTTP_URL, RELAY_WS_URL
- .github/workflows/remote-agent.yml: RELAY_WEBHOOK_SECRET
- mobile-companion/.env.example: VITE_GITHUB_CLIENT_ID, VITE_GITHUB_REDIRECT_URI, VITE_RELAY_HTTP_URL, VITE_RELAY_WS_URL
- cloud-relay/.env.example: JWT_SECRET, JWT_ISSUER, JWT_AUDIENCE, REQUIRE_AUTH, MAX_MESSAGE_SIZE
- docs/mcp-workflow.md: MCP provider defaults (Vultr, Supabase)

### GenericInfrastructure

- .github/workflows/terraform-plan.yml: VULTR_API_KEY, TERRAFORM_CLOUD_TOKEN, TFC_ORG, TFC_WORKSPACE
- .github/workflows/terraform-apply.yml: VULTR_API_KEY, TERRAFORM_CLOUD_TOKEN, TFC_ORG, TFC_WORKSPACE
- .github/workflows/sync-server-ip.yml: TERRAFORM_CLOUD_TOKEN, TFC_ORG, TFC_WORKSPACE, GH_PAT
- .github/workflows/deploy-infrastructure.yml: SERVER_IP, SSH_USER, SSH_KEY, GRAFANA_ADMIN_PASSWORD, GRAFANA_BASIC_AUTH_USERS, DOCKGE_BASIC_AUTH_USERS
- observability/.env.example: GRAFANA_ADMIN_PASSWORD, GRAFANA_BASIC_AUTH_USERS
- ops/.env.example: DOCKGE_BASIC_AUTH_USERS
- messaging/.env.example: REDIS_PASSWORD, RABBITMQ_DEFAULT_USER, RABBITMQ_DEFAULT_PASS, RABBITMQ_BASIC_AUTH_USERS
- DEPLOYMENT.md: GitHub Actions secrets list and server .env guidance

## Per-app .env placement guidance

- Keep repo-wide secrets in GitHub Actions secrets or an external secret store; do not commit them.
- Application runtime secrets should live in app-specific .env files on the server (for example, /srv/apps/<app>/.env), not in infra-wide .env files.
- For frontend apps, treat VITE_ variables as public config and avoid embedding secrets.
- Consider namespacing shared secrets (for example, RELAY__JWT_SECRET) if multiple apps use similar names.
- Keep .env.example files updated in each app directory with non-sensitive placeholders.

## Follow-up suggestions

- Create or verify GitHub Actions secrets/vars listed above using the secrets screenshot list.
- Add a short note to mobile companion docs clarifying that VITE_ vars are public and should not contain secrets.
- Consider adding a CI check that fails deployments when required secrets are missing.
