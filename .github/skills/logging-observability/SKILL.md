---
name: logging-observability
description: "Logging and OpenTelemetry observability setup across local dev and production, including Grafana Cloud wiring. Use this when asked to configure logs/traces/metrics, OpenTelemetry exporters, or Grafana integration. Triggers on: logging, observability, opentelemetry, otel, grafana, traces, metrics, logs."
---

# Logging & Observability Skill

## When to Use (LLM Routing Guide)
- User asks to “set up logging” or “wire OpenTelemetry”
- Grafana Cloud integration is needed for prod
- Need to switch between local dev (Aspire dashboard/OTLP) and prod exporters
- Service defaults require standard logging filters

## When NOT to Use
- Pure infra provisioning → use terraform/traefik/deployment skills
- General code review → use code-review
- Security audit of secrets → use security

## Inputs
- Service defaults project (usually `ServiceDefaults` or `*ServiceDefaults*`)
- Deployment config (docker-compose, env vars, CI secrets)
- Current logging filters and OpenTelemetry configuration

## Steps
1. Locate service defaults or shared hosting extensions (e.g., `AddServiceDefaults`, `ConfigureOpenTelemetry`).
2. Ensure logging pipeline includes:
   - Console + Debug for local/dev
   - OpenTelemetry logging provider
   - Resource metadata (`service.name`, `service.namespace`, `deployment.environment`)
3. Ensure metrics/tracing pipeline includes:
   - ASP.NET Core instrumentation
   - HTTP client instrumentation
   - Runtime instrumentation
4. Production wiring to Grafana Cloud:
   - Read secrets: `GRAFANA_ENDPOINT`, `GRAFANA_PROTOCOL`, `GRAFANA_HEADERS`.
   - Map them to OTEL env vars if not already set:
     - `OTEL_EXPORTER_OTLP_ENDPOINT`
     - `OTEL_EXPORTER_OTLP_PROTOCOL`
     - `OTEL_EXPORTER_OTLP_HEADERS`
   - Use `UseGrafana()` for logs/metrics/traces in production.
5. Local/dev behavior:
   - Keep console logging and lower minimum level (Debug/Information as required).
   - Prefer Aspire dashboard or OTLP exporter when `OTEL_EXPORTER_OTLP_ENDPOINT` is set.
6. Verify filters for noisy frameworks (e.g., `Wolverine`, `Microsoft.AspNetCore`, `Marten`).
7. Update documentation to describe env vars and prod vs local behavior.

## Default Env Contract (Grafana)
- `GRAFANA_ENDPOINT` → `OTEL_EXPORTER_OTLP_ENDPOINT`
- `GRAFANA_PROTOCOL` → `OTEL_EXPORTER_OTLP_PROTOCOL`
- `GRAFANA_HEADERS` → `OTEL_EXPORTER_OTLP_HEADERS`

## Output
- Shared service defaults updated with consistent logging/exporter wiring
- Env vars mapped for production Grafana Cloud
- Docs updated with logging/observability instructions

## Session Summary Format
- **Done**: [logging/otel wiring]
- **Changes**: [files modified]
- **New tasks**: [none]
- **Warnings**: [missing secrets or ambiguous config]
- **Next**: [optional follow-ups]

```


