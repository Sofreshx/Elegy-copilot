# Rust Backend Migration

## Status: In development (opt-in)

The Node.js HTTP server (`copilot-ui/server.js`) is the default backend. The Rust Axum server (`native/runtime/`) remains in development and is opt-in via the `--rust-backend` flag or `RUST_BACKEND=1` env var. Use Rust only when validating the new runtime.

## What's Done

| Layer | Status | Detail |
|-------|--------|--------|
| Axum router with CORS, tracing, auth middleware | ✅ | Full middleware stack |
| r2d2 connection pool (max 8) | ✅ | Concurrent SQLite access via WAL |
| Automatic schema repair | ✅ | Adds missing columns to pre-existing tables |
| rusqlite with 34 tables (planning.db + ie_* + copilot) | ✅ | Idempotent DDL, WAL mode, busy_timeout |
| 60+ contract types matching TypeScript | ✅ | CamelCase JSON serialization, response shapes parity-verified |
| Bearer token auth with loopback bypass | ✅ | Token resolution: CLI > env > auto-gen |
| 18 CRUD persistence methods | ✅ | Records, suggestions, recaps, artifacts, compare, merge, idempotency |
| ~276 API routes (99.3% of Node.js) | ✅ | 37 route modules |
| Tauri launches Node.js as default backend; Rust opt-in | ✅ | `launch_runtime_host()` default; `launch_rust_runtime()` via `--rust-backend` |
| Real planning persistence health check | ✅ | Table presence, integrity_check |
| Graceful shutdown via stdin + Ctrl+C | ✅ | Reads "shutdown\n" from Tauri stdin |
| Structured HTTP logging with request IDs | ✅ | x-request-id UUID per request, span with method/uri/status |
| Per-domain e2e happy path tests | ✅ | 46 integration tests + 1 concurrent test |
| Response-shape parity with frontend | ✅ | `catalog/repos`, `assets/managed`, `assets/installed`, `catalog/summary`, `dashboard/summary` |
| Frontend SPA served from ui-dist/ | ✅ | Custom fallback for non-API paths |
| Kimaki Remote API parity | ✅ | Rust supervises the pinned Kimaki Node child and serves `/api/remote/*` |

## Known Limitations

| Limitation | Impact | Mitigation |
|---|---|---|
| Schema repair adds columns as TEXT only | Column type mismatches (e.g., INTEGER → TEXT) require manual migration | Adds TEXT NULL columns; existing data unaffected |
| No write-path e2e tests | POST/PUT/PATCH routes only validated at unit level | Unit tests cover persistence; write e2e tests deferred |
| No error-path e2e tests | 4xx/5xx error shapes untested at integration level | ApiError type tested in unit tests |
| `agent/runs/stream` SSE still a stub | Real-time agent output not functional | SSE protocol needs separate implementation |
| Catalog deep CRUD is filesystem-backed | Simpler than full projection service; adequate for single-user | Full projection service deferred |
| No Docker/WSL capability auto-detection | Runtime health reports static capability states | Desktop app runs locally; Docker not needed |

## Test Counts

| Suite | Tests |
|-------|-------|
| Unit (lib) | 46 |
| E2e (integration) | 41 |
| Total | 87 |

## Running

```bash
# Build
cargo build --workspace

# Run (starts on http://127.0.0.1:3211)
cargo run -p elegy-native-runtime

# Test
cargo test -p elegy-native-runtime
```

## Tauri with Rust Backend

```bash
cd copilot-ui
cargo build -p elegy-copilot-tauri-shell
cargo run -p elegy-copilot-tauri-shell                       # Node.js is default
cargo run -p elegy-copilot-tauri-shell -- --rust-backend     # Opt into Rust runtime
```

## Remaining Work

| Item | Detail | Priority |
|---|---|---|
| `agent/runs/stream` SSE endpoint | Cannot implement as REST — stub remains | Medium |
| Full catalog projection service | Replace filesystem-backed CRUD with real projection | Medium |
| Node.js removal from Tauri bundle | Deferred until Rust is the default again | Low |
| CI pipeline | Needs `cargo build --workspace` in CI | Low |
| Installer migration | Tauri installer needs Rust binary bundled | Low |
