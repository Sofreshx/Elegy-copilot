---
created: 2026-06-24
updated: 2026-06-24
category: research
status: current
doc_kind: node
id: enhancement-target-07-security-dataflow-backend
summary: Plan for the security/dataflow backend — CodeQL/Joern for taint, source/sink, and auth-boundary analysis, as a separate heavy check for security-critical lanes.
tags: [research, enhancement-targets, security, codeql, joern, taint, dataflow, code-property-graph]
related: [enhancement-targets-index, enhancement-target-03-codegraph-v0-dependency-boundary-graph, enhancement-target-04-codegraph-v1-symbols-references]
---

# Theme 07 — Security & Dataflow Backend

> **Status:** Research plan. Defer until Themes 01-05 prove value.
> **Provenance:** Proven in security, heavier for general dev.
> **First-slice cost:** Weeks.
> **Dependencies:** Themes 03-04 (symbol graph). Defer criteria below.

## Why this direction

### The problem

The existing `security` skill (`engine-assets/skills/security/SKILL.md`) checks
six categories: secrets in git, auth bypass, dependency confusion, path
traversal, cookie security, injection. These are **pattern-based** checks — the
LLM (or a Semgrep pattern from Theme 02) flags syntactic shapes.

But security review often needs **dataflow**: "does user-controlled input flow
from this source to that sink without sanitization?" Pattern matching cannot
answer this reliably; it flags every `fs.readFile(userPath)` even when the path
is sanitized upstream, and misses flows where the dangerous construction is
indirect.

The research is clear:

- **CodeQL** creates databases from source (AST + name binding + type info) and
  runs QL queries; strong for variant analysis.
- **Joern** generates code property graphs (CPG) for source, bytecode, and
  binaries, with taint analysis, data-flow steps, and a Scala query language.
- **Recent LLM+static-analysis work** (QLCoder, CodeBadger) shows that
  constraining an LLM with CodeQL/Joern/CPG feedback dramatically outperforms
  LLM-only security review. QLCoder produced correct CVE-detecting queries for
  53.4% of evaluated CVEs vs. 10% for Claude Code alone.

### The design lesson

> Use CPG-style depth only when the task needs it. For normal agent review,
> imports/symbols/tests/rules are enough. For security review, taint, slicing,
> and dataflow become valuable.

This is why Theme 07 is **V3, optional, and separate**. It is not always-on.
It runs only for security-critical lanes and produces findings that feed the
same evidence workflow (Theme 05) but with heavier provenance.

### Why defer

Theme 07 is the most expensive slice: CodeQL requires a database build, Joern
requires a CPG build, and both have non-trivial install/run costs. The
research explicitly recommends:

> This should be a separate heavy check, not always-on review.

Defer criteria: ship Themes 01-05 first. Pick up Theme 07 when:

- A security-critical change (auth, JWT, OAuth, relay) needs dataflow review, OR
- The pattern-based security checks (Theme 02 + security skill) miss a real
  vulnerability that dataflow would have caught, OR
- A compliance requirement demands SAST with taint analysis.

## What this is

A **dataflow analysis backend** (CodeQL and/or Joern) for taint, source/sink,
unsafe command execution, path traversal, secret handling, SQL construction,
and auth-boundary mistakes. Produces findings that conform to the shared
evidence schema (Theme 05) with `provenance: "deterministic-tool"`.

### Components

| Layer | Owner | What |
|---|---|---|
| Dataflow CLI | Elegy plugin (`elegy-security` crate or adapter) | `analyze`, `query`, `taint` commands; CodeQL + Joern backends |
| Query pack | This repo (`.elegy/security-queries/`) | CodeQL/Joern queries grounded in the threat model |
| Security skill update | This repo | `security` skill consumes dataflow findings, not just patterns |
| Dashboard | copilot-ui | Security findings view with taint paths |
| Contract | This repo (`contracts/elegy/`) | `security-finding.schema.json` (extends evidence schema) |

### Non-goals

- Do not make CodeQL/Joern always-on — it is a separate heavy check.
- Do not replace the pattern-based security checks (Theme 02 + security skill)
  — they remain the fast first line; dataflow is the deep second line.
- Do not build a custom CPG — use CodeQL or Joern, do not hand-roll.
- Do not run on every commit — run on security-critical changes or on demand.
- Do not block commits — security findings are advisory (QCP coexistence),
  though they may inform review verdicts.

## Design

### Threat-model-grounded queries

The repo has a documented threat model in `docs/system/security-model.md` (645
lines): 11 attack vectors, OAuth→JWT auth, scope-based authorization, relay
architecture. Query packs should target these specific vectors, not generic
CVE patterns:

| Query | Targets | Tool |
|---|---|---|
| `jwt-alg-none-acceptance` | JWT verifier accepting `alg: none` | CodeQL |
| `oauth-state-not-validated` | OAuth state parameter not checked with timing-safe compare | CodeQL |
| `relay-scope-escalation` | Client accessing scope not granted to its type | CodeQL |
| `path-traversal-fs-read` | User input → `fs.readFile`/`res.sendFile` without sanitization | Joern taint |
| `sql-construction-taint` | User input → SQL string construction without parameterization | Joern taint |
| `command-exec-taint` | User input → `exec`/`spawn` without sanitization | Joern taint |
| `secret-in-log-taint` | Secret material → log/console output | Joern taint |
| `idor-dataflow` | User input → object lookup without ownership check | CodeQL |
| `csrf-state-missing` | OAuth flow missing state validation | CodeQL |

Each query maps to a threat-model vector and produces findings with the taint
path (source → flow → sink) when a violation is found.

### Finding schema (extends evidence)

```json
{
  "rule_id": "path-traversal-fs-read",
  "severity": "error",
  "file": "src/routes/files.ts",
  "line": 42,
  "taint_path": [
    { "symbol": "req.body.path", "file": "src/routes/files.ts", "line": 38, "kind": "source" },
    { "symbol": "sanitizePath(path)", "file": "src/lib/sanitize.ts", "line": 12, "kind": "sanitizer", "note": "sanitizer present — verify correctness" },
    { "symbol": "fs.readFile(sanitized)", "file": "src/routes/files.ts", "line": 42, "kind": "sink" }
  ],
  "message": "User input flows to fs.readFile; sanitizer present but verify correctness",
  "evidence": {
    "provenance": "deterministic-tool",
    "confidence": 0.95,
    "source": { "kind": "rule_id", "ref": "security-query:path-traversal-fs-read", "tool": "joern@2.x" }
  }
}
```

The `taint_path` is the key addition over pattern findings — it shows the full
flow, enabling the reviewer to verify the sanitizer rather than guess.

### CLI shape

```
elegy-security analyze --queries <pack> [--backend codeql|joern] [--json]
elegy-security taint --source <pattern> --sink <pattern> [--json]
elegy-security query --ql <file> [--json]              # ad-hoc CodeQL query
```

`analyze` builds the database (CodeQL) or CPG (Joern) on first run, caches it
per SHA, and runs all enabled queries. Subsequent runs reuse the cache unless
the SHA changed.

### Backend selection

| Capability | CodeQL | Joern |
|---|---|---|
| TS/JS dataflow | ✓ (excellent) | ✓ |
| Rust dataflow | ✓ (experimental) | ✓ (via CPG) |
| Taint analysis | ✓ | ✓ (stronger) |
| Variant analysis | ✓ (strong) | ✓ |
| Custom query language | QL | Scala |
| Install weight | heavy | heavy |
| Database build time | minutes | minutes |

Recommendation: **CodeQL as primary** (better TS/JS support, QL is purpose-built
for this), **Joern as research/alternative** for cases where CPG-based slicing
is needed. Do not require both; pick one per repo.

## Implementation phases

### Phase 1 — Query pack + adapter (Elegy plugin)

- Author CodeQL query pack targeting the threat model vectors above.
- Implement `elegy-security analyze` with CodeQL backend.
- Implement database caching per SHA.
- Implement `taint` and `query` commands.
- Ship managed binary (or document CodeQL CLI dependency).

### Phase 2 — Security skill update (this repo)

- Update `engine-assets/skills/security/SKILL.md` to consume dataflow findings.
- The skill now has two tiers: pattern checks (fast, always) + dataflow checks
  (deep, on-demand for security-critical changes).
- Findings conform to the shared evidence schema (Theme 05).

### Phase 3 — Dashboard (copilot-ui)

- Add "Security Findings" view with taint-path visualization.
- Distinct from architecture findings — security findings show the flow, not
  just the violation site.
- "Run deep security analysis" action (explicit, not always-on).

### Phase 4 — Validation

- Query pack catches ≥3 seeded vulnerabilities from the eval corpus (Theme 06).
- Taint paths are accurate (source → sink flow verified).
- False-positive rate <10% per query (measured in Theme 06).
- Security skill correctly distinguishes pattern vs. dataflow findings.

## Defer criteria

Pick up Theme 07 only when one of:

1. A security-critical change (auth, JWT, OAuth, relay, Tauri IPC) needs
   dataflow review that patterns cannot provide.
2. The pattern-based security checks (Theme 02 + security skill) miss a real
   vulnerability that dataflow would have caught — proven by Theme 06.
3. A compliance requirement demands SAST with taint analysis.

Until then, Themes 02 + the security skill cover the fast pattern-based
security review, which is sufficient for most changes.

## Coexistence boundary

- Commit-check owns: test, coverage, lint, format, typecheck.
- Security dataflow owns (additively): deep taint/dataflow analysis.
- Does not duplicate Theme 02 pattern checks — those are the fast first line;
  dataflow is the deep second line.
- Security findings are advisory (QCP coexistence); they may inform review
  verdicts but do not block commits directly.
- The `security` skill remains the single review surface; dataflow findings
  feed into it, they do not create a parallel security reviewer.

## Follow-ups & future work

- **Joern spike:** Evaluate Joern CPG for Rust (Tauri backend) where CodeQL
  support is experimental. If Joern proves better for Rust, add as a second
  backend.
- **CodeBadger-style integration:** Integrate CPG capabilities into high-level
  LLM tools for slicing, taint tracking, and navigation, specifically to avoid
  whole-repo file reading during security review.
- **QLCoder-style LLM-assisted query authoring:** An agent drafts CodeQL
  queries from natural-language vulnerability descriptions; human validates.
  Useful for novel vulnerability patterns not covered by the seed pack.
- **Secret scanning integration:** The QCP spec defers secrets scanning ("no
  tool configured in repo"). Theme 07 could include a secrets-scanning query
  pack (gitleaks/trufflehog) alongside dataflow, unifying the security surface.
- **Compliance reporting:** Map findings to compliance frameworks (OWASP,
  CWE) for auditability.
- **Continuous security monitoring:** Run the query pack nightly on `main` to
  catch regressions, not just on PRs.

## Dependencies & sequencing

- **Hard dependency:** Theme 04 (symbol graph) — dataflow analysis benefits
  from the symbol/reference index for cross-file tracing. CodeQL/Joern build
  their own databases, but the symbol graph helps prioritize and contextualize.
- **Soft dependency:** Theme 05 (evidence schema) — security findings conform
  to the shared evidence schema.
- **Defer gate:** Themes 01-05 must prove value first. Theme 07 is picked up
  only when the defer criteria are met.
- **Unblocks:** Nothing — this is a terminal deep-analysis layer.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| CodeQL/Joern install is heavy and fragile | Document install as optional; cache databases per SHA; provide a fallback to pattern-only review |
| Database build is slow (minutes) | Cache per SHA; run on-demand, not per-commit; nightly for main |
| False positives in taint analysis | `confidence` on findings; per-query FP tracking (Theme 06); reviewer triages |
| CodeQL Rust support is experimental | Use Joern for Rust; or restrict CodeQL to TS/JS; document language coverage honestly |
| Security findings overload reviewers | Run only for security-critical changes (auth, relay, IPC); severity filtering; distinct from architecture findings |
| Query pack rots as code evolves | Theme 06 regression tracking; periodic query review against the threat model |

## Acceptance criteria (for the eventual spec)

- `elegy-security analyze --queries .elegy/security-queries/ --json` produces
  findings with taint paths.
- Query pack catches ≥3 seeded vulnerabilities from the eval corpus.
- Taint paths accurately trace source → sink.
- False-positive rate <10% per query (measured in Theme 06).
- Security skill correctly consumes dataflow findings and distinguishes them
  from pattern findings.
- `node scripts/validate-specs.js --strict` passes for the promoted spec.

## Related artifacts

- `docs/system/security-model.md` — threat model grounding the query pack
- `engine-assets/skills/security/SKILL.md` — security skill to update
- `docs/research/enhancement-targets/02-structural-search-codemods.md` — pattern-based security (fast first line)
- `docs/research/enhancement-targets/05-review-agent-evidence-workflow.md` — evidence schema
- `docs/research/enhancement-targets/06-evaluation-protocol-metrics.md` — FP-rate measurement
- External: CodeQL, Joern, QLCoder, CodeBadger
