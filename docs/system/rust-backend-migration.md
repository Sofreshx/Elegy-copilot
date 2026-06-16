# Rust Backend Migration

## Status: Core Complete (76%)

The Node.js HTTP server (`copilot-ui/server.js`) is being replaced by a Rust axum server (`native/runtime/`).

## What's Done

| Layer | Status |
|-------|--------|
| Axum router with CORS, tracing, auth middleware | ✅ |
| rusqlite with 34 tables (planning.db + ie_* + copilot) | ✅ |
| 40 contract types matching TypeScript | ✅ |
| Bearer token auth with loopback bypass | ✅ |
| 18 CRUD persistence methods | ✅ |
| 40+ API routes across 12 modules | ✅ |
| Tauri can launch Rust backend via --rust-backend | ✅ |

## Running the Rust Backend

```bash
# Build
cargo build --workspace

# Run (starts on http://127.0.0.1:3211)
cargo run -p elegy-native-runtime

# Test
cargo test --workspace
```

## Running Tauri with Rust Backend

```bash
cd copilot-ui
cargo build -p elegy-copilot-tauri-shell
# Then launch with:
RUST_BACKEND=1 cargo run -p elegy-copilot-tauri-shell
```

## Remaining Work

- Node.js bundle removal from Tauri (manual packaging step)
- Full installer migration to Rust CLI
- CI pipeline update to use Rust binaries
- Test parity validation
