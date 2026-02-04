---
name: cloudflare-deploy
description: >
  Cloudflare deployment workflows for client apps (Pages and Workers). Use this when asked to deploy clients to Cloudflare, configure Pages builds, or manage Workers deployments. Triggers on: Cloudflare deploy, Cloudflare Pages, Cloudflare Workers, Wrangler, Cloudflare hosting.
---

# Cloudflare Deploy Skill

## Purpose
Deploy client applications to Cloudflare Pages or Workers using safe defaults.

## Recommended Tooling

- Pages: use `wrangler pages deploy` for static builds.
- Workers: use `wrangler deploy` for edge functions.

## Environment

- `CLOUDFLARE_API_TOKEN` for deployment.
- `CLOUDFLARE_ACCOUNT_ID` if needed by tooling.

## Pages Quick Flow

1. Build the app locally (for example `npm run build`).
2. Deploy the output directory:

```bash
wrangler pages deploy dist --project-name <name>
```

## Workers Quick Flow

```bash
wrangler deploy
```

## Security Defaults

- Use non-production projects for testing.
- Keep secrets out of repo files.
- Require explicit approval before production deploys.

## MCP Note

Only use a Cloudflare MCP server if one has been explicitly configured and approved.
Otherwise, prefer Terraform or `wrangler`.
