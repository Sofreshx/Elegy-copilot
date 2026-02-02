---
schema: task/v1
id: task-000400
title: "Design relay protocol for mobile-to-extension communication"
type: research
status: done
priority: high
owner: lolzi
skills: ["design", "security"]
depends_on: ["task-000395"]
next_tasks: ["task-000401", "task-000402", "task-000403", "task-000404"]
created: "2026-02-01"
updated: "2026-02-01"
---

## Context

Design the complete message protocol for bidirectional communication between mobile app, cloud relay, and VS Code extension. This protocol will be the foundation for all cross-network messaging.

**Message Types to Define**:
- **Auth**: JWT generation, refresh, revocation
- **Command**: Mobile → Extension actions (start session, approve permission, etc.)
- **Event**: Extension → Mobile notifications (session progress, status changes)
- **Heartbeat**: Connection health monitoring
- **Error**: Standardized error codes and handling

**Design Considerations**:
- Message versioning for backward compatibility
- Compression for bandwidth efficiency (especially over mobile networks)
- Encryption requirements (TLS + optional message-level encryption)
- Command allowlisting for security
- Rate limiting strategy

**Output Artifact**:
- `.instructions/artefacts/relay-protocol.md` - Comprehensive protocol documentation

## Acceptance Criteria

- [x] Message schema documented (JSON Schema or TypeScript types)
- [x] Auth flow documented (JWT generation, refresh, revocation)
- [x] Event types enumerated with payload schemas
- [x] Command allowlist defined (security)
- [x] Error codes and handling documented
- [x] Message versioning strategy defined
- [x] Compression strategy documented (if applicable)
- [x] Encryption requirements specified
- [x] Rate limiting rules defined
- [x] Example messages provided for each type

## Plan / Approach

1. Survey existing protocols (WebSocket JSON-RPC, SignalR conventions)
2. Define TypeScript interfaces for all message types
3. Document auth flow with sequence diagrams
4. Enumerate all commands with security classification
5. Define error taxonomy (network, auth, validation, execution)
6. Create relay-protocol.md artefact with all specifications
7. Review with security lens (command injection, DoS, replay attacks)

## Attempts / Log

**2026-02-01**: Created comprehensive relay protocol specification at `.instructions/artefacts/relay-protocol.md`:
- Documented JSON-RPC 2.0 base protocol with relay envelope for routing
- Comprehensive authentication flow with GitHub OAuth → JWT tokens
- All 15 command types documented with scopes and security classification (safe/sensitive/admin)
- All 7 event types documented with TypeScript payload schemas
- Standard + custom error codes (-32001 to -32010)
- Rate limiting rules (global, per-command, token bucket algorithm)
- Security considerations (command allowlist, replay prevention, DoS mitigation, audit logging)
- Complete example messages for auth, agent sessions, permissions, heartbeat
- Version negotiation strategy with backward compatibility rules
- TypeScript type definitions appendix for implementation reference

## Failures

(none)

## Notes / Discoveries

- Existing wsTypes.ts already implements JSON-RPC 2.0 patterns correctly
- EventEmitter has robust event types and permission flow already implemented
- Protocol design formalizes and extends existing implementation patterns
- Added relay envelope layer for cross-network routing (not in current local-only implementation)

## Next Steps

- task-000401: Implement cloud relay service using this protocol
- task-000402: Implement GitHub OAuth flow per auth section
- task-000403: Create connection broker for message routing
- task-000404: Implement offline message queue/buffer
