---
created: 2026-03-01
updated: 2026-03-01
category: research
status: current
doc_kind: node
id: markdownlm-mcp-memory-analysis
summary: Research analysis of MarkdownLM/mcp memory model and what to adopt for instruction-engine without heavy MCP overhead.
tags: [mcp, memory, session-state, context-management, external-research]
---

# Research: MarkdownLM/mcp — Memory for Agentic Sessions

## Source

- Repository: https://github.com/MarkdownLM/mcp
- Inspection status: Reviewed through subagent-driven repo inspection and file-level analysis.

## Motivation

The user is specifically interested in **memory management for agentic sessions** but is skeptical of direct MCP use because it "tends to be too costly in context." We need to evaluate whether this project offers techniques worth adopting vs. added overhead.

---

## Verification Status

| Section | Status |
|---|---|
| Our existing memory/session approaches | Verified |
| MarkdownLM/mcp bridge architecture and tool surface | Verified |
| MarkdownLM backend indexing/compaction internals | Not directly visible (inferred only) |
| Comparative cost model | Partially verified (tool-side visible, backend opaque) |

---

## Our Existing Memory Architecture (Baseline)

We have **three complementary memory tiers** already in place:

### Tier 1: Session State (Instruction Engine — Elegy)

**Location**: `~/.copilot/session-state/<SESSION_ID>/`

**Artifacts**:
```
plan.md              # Plan Pack + Progress Tracker (overwrite)
proposition.md       # Append-only guidance (direction, after-planning, after-execution)
verification-guide.md  # Structured verification guide (optional, overwrite)
plans/               # Plan revision history (index.json + rev-*.md)
```

**Design properties**:
- **Pure Markdown on disk** — no server, no protocol
- **Append-only** semantics for guidance (proposition.md)
- **Overwrite** semantics for plans and verification
- **Versioned** plan revisions with indexed metadata
- **Zero context cost at startup** — agents load only when needed via file read
- **Deterministic contracts** for scoring and gate evaluation

### Tier 2: Session Persistence (Copilot SDK)

**Location**: `~/.copilot/session-state/{sessionId}/`

**Artifacts**:
```
checkpoints/         # Conversation history snapshots (001.json, 002.json...)
plan.md              # Agent's planning state
files/               # Session artifacts (analysis.md, notes.txt)
```

**Design properties**:
- **Named session IDs** for cross-restart resumability
- **Checkpoint-based** conversation history (incremental JSON)
- **Security boundary** — API keys never persisted
- **Tool state is stateless** — not persisted between sessions

### Tier 3: Durable Memory (VS Code Copilot)

**Locations**:
- `/memories/` — user-level (cross-workspace, auto-loaded first 200 lines)
- `/memories/session/` — session-scoped (listed but not auto-loaded)
- `/memories/repo/` — repository-scoped (workspace-local)

**Design properties**:
- **Tiered scope** — user > session > repo
- **Auto-load budget** — only user memory (first 200 lines) consumes startup tokens
- **Session memory is transient** — disappears after conversation ends
- **Manual curation** — agents write/read, user can review

### Total Context Cost of Our Current Memory

| Memory Tier | Startup Tokens | On-Demand Tokens |
|---|---|---|
| User memory (~200 lines) | ~500 | 0 (already loaded) |
| Session memory listing | ~50 | ~200-500 per file read |
| Repo memory listing | ~50 | ~200-500 per file read |
| Session state (Elegy) | 0 | ~1000-3000 per artifact read |
| Session persistence (SDK) | 0 | ~500-5000 per checkpoint |

**Startup overhead**: ~600 tokens for memory tiers. **Everything else is on-demand.**

---

## MarkdownLM/mcp Analysis

### What It Is

`MarkdownLM/mcp` is a thin MCP-to-HTTP bridge server. It exposes a small MCP tool surface and forwards requests to a hosted MarkdownLM backend. The repository does not contain the backend retrieval/indexing implementation.

Observed components:

- MCP server process over stdio transport.
- Request argument validation in the bridge.
- HTTP client calls to MarkdownLM API routes.
- Structured logging and rate limiting in the bridge.

### Tool Surface

The bridge exposes three tools:

1. `query_knowledge_base(query, category)`
2. `validate_code(code, task, category)`
3. `resolve_gap(question, category)`

This is a strong minimal pattern because it separates:

- retrieval of existing guidance,
- policy/compliance validation,
- explicit capture of unresolved knowledge gaps.

### Memory Model

Visible behavior suggests remote persistent memory and governance:

- Retrieval and validation happen via backend API endpoints.
- Gap capture appears to be persisted remotely.
- Local bridge state is minimal and mostly transient (for example, request/rate-limit bookkeeping).

Not visible in this repo:

- backend storage schema,
- semantic ranking/index quality,
- compaction strategy,
- retention and lifecycle policy.

### Context Cost and Practical Tradeoffs

The user's cost concern is valid:

1. MCP adds a non-zero manifest/tool-description footprint at session start.
2. Tool-call wrapping adds serialization overhead each invocation.
3. Network round trips and retries add latency/failure surface.
4. `validate_code` can become expensive if full code blocks are passed repeatedly.

For this repo specifically, tool count is low (3), so overhead is controlled, but not free.

---

## The MCP Cost Concern (Applied to This Repo)

### Baseline Protocol Overhead

Every MCP integration introduces:

1. Tool manifest context cost.
2. Tool call/response framing overhead.
3. Runtime dependency on server availability and configuration.

### Why It Can Still Be Worth It

MCP remains attractive when it delivers one or more of:

1. Better retrieval quality than local grep/file reads.
2. Shared organizational memory across users and machines.
3. Policy validation that would be hard to maintain locally.
4. High-signal gap collection that feeds docs/governance improvements.

---

## Comparative Framework

### File-Based (Our Current) vs Hypothetical MCP Memory

| Dimension | File-Based (Current) | MCP Memory Server |
|---|---|---|
| **Transport** | Native file tools (already available) | MCP tool calls (requires server) |
| **Startup cost** | 0 tokens (on-demand) | ~480+ tokens (tool manifest) |
| **Per-read cost** | ~200-500 tokens (file read) | ~300-600 tokens (tool call + response) |
| **Persistence** | Local filesystem | Server-managed (file, DB, or hybrid) |
| **Progressive disclosure** | Natural — read_file loads only what's needed | Depends on tool design |
| **Semantic search** | None (agent does grep/pattern match) | Could offer server-side search |
| **Automatic compaction** | None (manual or Copilot SDK compaction events) | Could compress old context |
| **Cross-session** | Yes — files at known paths | Yes — server manages lifecycle |
| **Cross-machine** | No (local filesystem only) | Possible if networked |
| **Debugging** | Easy — just read the files | Harder — requires server logs |
| **Complexity** | Very low | Medium-High (server + config + deployment) |
| **Failure modes** | File not found (clear error) | Connection failure, timeout, desync |

Interpretation for instruction-engine: keep file-based memory as default, treat MCP-backed memory/policy checks as optional high-value augmentation.

### Decision Criteria

Adopt MCP memory if it provides **at least two** of:
1. **Semantic search** that materially reduces retrieval misses vs grep
2. **Automatic compaction** that keeps old context useful without manual curation
3. **Cross-machine sync** that enables multi-device workflows
4. **Token efficiency** that beats file-based after amortizing manifest cost

Reject if:
- Tool manifest overhead > typical session memory reads
- It requires infrastructure we don't want to maintain
- Capabilities duplicate what file tools + session-state already provide

---

## Alternative: Lightweight Memory Improvements Without MCP

If MarkdownLM/mcp's MCP overhead is too high but its ideas are good, we could adopt patterns without the protocol:

### A) File-Based Semantic Index

Maintain a `~/.copilot/session-state/_index.md` that summarizes all active sessions:
```markdown
## Active Sessions
- `user-123-task-456`: Analyzing codebase, 3 checkpoints, last active 2h ago
- `feature-auth-redesign`: Planning phase, plan approved, 2 work units pending
```
Cost: One file read (~200 tokens) gives agent overview of all sessions.

### B) Memory Compaction via Agent Convention

Add a convention to proposition.md: when it exceeds N entries, the agent writes a `## Summary` section at the top compacting older entries, then archives the raw entries to a `proposition-archive.md`.

### C) Session Memory Templates

Provide structured templates for different memory types (decisions, blockers, context) in session-state. Currently it's freeform — templates would improve retrieval precision.

### D) Cross-Session Search

A simple script that searches across all session-state directories for a keyword. Cheaper than MCP, usable via agent tool calls.

---

## Adoption Recommendation

Recommendation: **Do not make direct MCP memory the default path** for instruction-engine right now.

Recommended approach:

1. Keep file-based session-state as the primary memory substrate.
2. Adopt the `query -> validate -> gap` interaction model as a local abstraction.
3. Invoke external MCP/remote governance only at high-risk checkpoints.
4. Add lightweight local indexing and compaction conventions before introducing more infrastructure.

This captures most of MarkdownLM/mcp's practical value while keeping startup context cost low and operational complexity manageable.

---

## Caveats

1. Backend retrieval and compaction internals are not publicly visible in this repository.
2. Findings here are based on the bridge/tool layer, not backend quality benchmarks.
3. A direct dependency decision should include legal/operational review of external service expectations.

---

## References

- https://github.com/MarkdownLM/mcp
- [Session state artifacts contract](../system/session-state-artifacts.md)
- [Copilot SDK session persistence](../../copilot-sdk/docs/guides/session-persistence.md)
- [SkillPointer/Code Mode techniques](skillpointer-codemode-techniques.md)
- [Progressive disclosure audit](progressive-disclosure-audit.md)
