# Test Coverage Map: messagingGateway

**Generated**: 2026-02-26 (WU-050)
**Purpose**: Safety net for upcoming platform abstraction refactors (WS-1)

## Coverage Table

| Test File | Covers Module(s) | Key Scenarios | ~Tests | Notes |
|---|---|---|---|---|
| acpEventMapping.test.ts | acpEventMapping | tool_call→tool_called; request_permission→permission_requested | 2 | Direct unit |
| acpReadinessProbe.test.ts | acpReadinessProbe | Initialize handshake; retry+backoff; timeout→SandboxReadinessFailed | 3 | Real NDJSON TCP server |
| config.test.ts | config | sandboxLifecycle values; invalid field rejection; resolveSandboxLifecycleConfig defaults | 5 | Env-based config via INSTRUCTION_ENGINE_GATEWAY_CONFIG_JSON |
| containerManager.test.ts | containerManager | spawn (labels/ports/env/limits/max/clamp); get/getOrSpawn; list; stop/stopAll; reconcile | 15 | FakeDocker; thorough CRUD |
| gatewayHttpServer.test.ts | gatewayHttpServer | Auth (401 missing/wrong/malformed/Basic); CRUD; SSE; lifecycle HTTP; compat headers; idempotent retry; conflict-fast; policy gate; shell fuzz | ~30 | Real HTTP on ephemeral port |
| index.test.ts | index | createSandboxLifecycleRuntime wiring; defaults; createSandboxStartupSnapshot dedup | 3 | Factory/composition tests |
| lifecycleOpenTerminal.test.ts | lifecycleOpenTerminal | Payload validation; env injection fuzz; containsUnsafeShellSyntax; buildTerminalLaunchTemplate | 5 | Security fuzz |
| lifecycleOperations.test.ts | lifecycleOperations | create/start/stop/finish; concurrent dedup+coalescence; idempotency; pr-open dedup | ~18 | Core lifecycle logic |
| permissionOrchestrator.test.ts | permissionOrchestrator, bridgeClient(iface) | Pending tracking+auto-deny; approve/deny; getPendingBySandbox; clientResolver; first-writer-wins | 8 | FakeBridgeClient; fake timers |
| portAllocator.test.ts | portAllocator | Range validation; sequential alloc+release; concurrent serialization; skip unavailable; exhaustion | 5 | canBindTcpPort injection |
| rateLimiting.test.ts | commandRouter, rateLimiter | Per-tier limits (read:30, invoke:6, admin:3/min); cross-tier independence | 3 | Indirect commandRouter coverage |
| sandboxCommands.test.ts | commandRouter, sandboxRegistry | /sandbox list (entries, empty, no registry) | 3 | Indirect commandRouter coverage |
| sandboxDirs.test.ts | sandboxDirs | resolveSandboxDirs; ensureSandboxDirs; removeSandboxDirs; listSandboxIds; cleanupSandboxDirs | ~15 | Real filesystem in tmp |
| sandboxRegistry.test.ts | sandboxRegistry | CRUD; dispatchEvent; updateStatus; stopAll; createSandboxEventRouter | ~18 | FakeBridgeClient; event routing |
| sanitizerChunking.test.ts | sanitizer, chunking | Mention stripping; JWT/bearer/token redaction; chunking cap (1800 chars, 3 chunks) | 3 | Two modules combined |
| secrets.test.ts | secrets | PR token lease: issue/resolve/status/revoke; edge cases (empty/bad TTL/expired) | 5 | Mocks @napi-rs/keyring |
| securityHardening.test.ts | commandRouter, permissionOrch | Allowlist; workspace boundary; cross-tier isolation; per-user rates; replayed approvals; malformed payloads; invoke concurrency | ~22 | Multi-module security tests |
| sessionsHelpers.test.ts | sessionsHelpers | parseBridgeSessions; formatSessionLine; isActiveSessionStatus | 6 | Unit tests |
| sessionThreadManager.test.ts | sessionThreadManager | Sandbox-aware naming; sandboxId propagation; first-write-wins | 3 | Fake timers+handles |

**Total: ~173 test cases across 19 test files + 1 helper (fakeJsonRpcWsServer.ts)**

## Gaps: No Dedicated Test Coverage

| Module | Gap Notes |
|---|---|
| **auditLogger.ts** | Used as mock dep everywhere; own write/append logic untested |
| **statusFile.ts** | Atomic write, heartbeat, schema untested |
| **discordPlatform.ts** | Zero coverage — Discord adapter untested |
| **acpBridgeClient.ts** | Real ACP WebSocket impl untested (only FakeBridgeClient tested) |
| **artefactsMonitor.ts** | No coverage |
| **formatSummary.ts** | No coverage |
| **gitSnapshot.ts** | Always mocked; own logic untested |
| **status.ts** | No coverage |
| **workspaceDetection.ts** | No coverage |
| **platform.ts** | Type/interface file; indirectly used via fakes |
| **bridgeClient.ts** | Interface; tested indirectly via fakes |

## Indirect Coverage Cross-Reference

| Test File | Also Covers |
|---|---|
| rateLimiting.test.ts | rateLimiter (via commandRouter), gitSnapshot (mocked) |
| sandboxCommands.test.ts | commandRouter /sandbox route |
| securityHardening.test.ts | commandRouter (allowlist/rate/payload), permissionOrchestrator, rateLimiter |
| index.test.ts | Wiring to containerManager + portAllocator |
| sanitizerChunking.test.ts | sanitizer + chunking combined |

## Prioritized Gaps for WS-1 Safety Net

1. **commandRouter.ts** — Substantial indirect coverage via rateLimiting/sandboxCommands/securityHardening, but no dedicated unit tests for command dispatch, scope resolution, or error paths
2. **discordPlatform.ts** — Zero coverage; will be heavily refactored in WS-1 (command spec extraction, parseSlashCommandArgs)
3. **auditLogger.ts** — Used by many modules; own logic untested
4. **statusFile.ts** — Atomic write semantics matter for multi-adapter health reporting
5. **config.ts** — Has tests but missing: env var JSON mode edge cases, extra fields handling, config path resolution, golden snapshot
