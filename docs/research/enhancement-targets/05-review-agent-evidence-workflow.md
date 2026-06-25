---
created: 2026-06-24
updated: 2026-06-24
category: research
status: current
doc_kind: node
id: enhancement-target-05-review-agent-evidence-workflow
summary: Plan for the review-agent evidence workflow — a shared Evidence schema and ReviewPack contract that make LLM review trustworthy by requiring structured, provenance-tagged citations.
tags: [research, enhancement-targets, evidence, review, provenance, schema, trust]
related: [enhancement-targets-index, enhancement-target-01-architecture-rules-as-tests, enhancement-target-02-structural-search-codemods, enhancement-target-03-codegraph-v0-dependency-boundary-graph, enhancement-target-04-codegraph-v1-symbols-references, enhancement-target-06-evaluation-protocol-metrics]
---

# Theme 05 — Review-Agent Evidence Workflow

> **Status:** Research plan. Promote to `docs/specs/shared-evidence-schema/spec.md` (5a) and `docs/specs/review-evidence-workflow/spec.md` (5b) before implementation.
> **Provenance:** Foundational — the missing contract that makes all other themes trustworthy.
> **First-slice cost:** Days (schema) → weeks (full workflow).
> **Dependencies:** Themes 01-04 produce evidence; the schema (5a) ships first and is consumed by all.

## Why this direction

### The problem

Today, evidence in review outputs is **freeform per-skill**. Each review skill
defines its own output block with its own evidence shape:

| Artifact | Evidence format |
|---|---|
| `IMPLEMENTATION_REVIEW` | Freeform: `validation.evidence`, `validation.gap`, `handoff_notes` |
| `CODE_REVIEW` / `REVIEW_RESULT` | Findings with file:line + confidence scores |
| `SPEC_REVIEW` | Freeform: `gaps`, `required_revisions` |
| `RUBBERDUCK_PLAN_REVIEW` | Freeform: `risks`, `plan_edits`, `validation_required` |
| `SECURITY_REVIEW` | Per-finding: type, severity, location, impact, fix |
| `IMPLEMENTATION_HANDOFF_BRIEF` | `Repo Evidence` (path: why it matters) |
| `CONVENTIONS_GOVERNANCE` | canonical_sources, confirmed/inferred conventions, drift |
| UI evidence | Per-target runtime evidence (screenshots, console, network) |
| `planning_project_run_add_evidence` | Freeform JSON content + evidence type string |

There is **no universal evidence format or shared evidence schema.** The
`reviewer-lane-contract` spec R5 requires citing evidence (file paths, line
numbers, doc references, validation outputs) but does not define a shared
structure. The `reviewer-evidence-contract.test.js` tests that the reviewer
agent requires concrete evidence for approval, but the test checks for keyword
presence, not structured format.

### Why this is the foundational missing piece

The GPT research is explicit about two principles:

1. **Store confidence.** Some edges are compiler-accurate; some are heuristic.
   Agents must know the difference.
2. **The core primitive is `query → evidence → review/check/fix obligation`.**
   Not "understand the repo" — deterministic queries producing evidence that
   the LLM reviews.

Without a shared evidence schema, every theme (01-04, 07) produces evidence in
its own shape, the reviewer agent cannot uniformly consume it, and you cannot
measure whether reviews actually cite structural evidence vs. hallucinate it.
**Trust requires structured provenance.**

A review agent should not ask the graph vague questions. It should run
deterministic queries in a fixed sequence and review the diff **with the
evidence pack, not the whole repo**, and **must cite graph evidence when making
structural claims.**

### Why broad design with incremental migration

The decision (per user input): **broad design, incremental migration.** The
existing review skills already have structured output blocks with verdict
enums. The shared evidence schema should be a **reusable sub-schema that nests
inside each existing block**, not a replacement of the blocks themselves.

- One coherent `Evidence` schema covers all review types from day one.
- Existing skills add an optional `evidence: Evidence[]` field — no rewrite,
  no regression.
- New codegraph evidence uses the same schema — consistency from the start.
- When `evidence` is absent, the finding is implicitly `provenance: "llm-only"`
  — backward compatible.

This avoids the regression risk of a broad retrofit while giving a single
contract to maintain going forward.

## What this is

Two parts:

- **Theme 5a — Shared evidence schema:** The `Evidence` sub-schema + `ReviewPack`
  contract. Ships first (days).
- **Theme 5b — Review-agent evidence workflow:** The deterministic query
  sequence, the review skill that consumes `ReviewPack`, and the reviewer lane
  contract update requiring evidence citation. Ships after 5a and as Themes
  01-04 produce evidence.

### Components

| Layer | Owner | What |
|---|---|---|
| JSON Schemas | This repo (`contracts/elegy/`) | `evidence.schema.json`, `review-pack.schema.json` |
| TypeScript types | This repo (`contracts/src/`) | `evidence.ts`, `reviewPack.ts` |
| Canonical doc | This repo (`docs/system/`) | `evidence-contract.md` |
| Reviewer contract update | This repo | `reviewer-lane-contract` spec R5 update |
| Reviewer agent prompt | This repo (`opencode-assets/agents/`) | Accept `ReviewPack` input; cite `Evidence` |
| Review skill | This repo (`catalog-assets/shared-skills/`) | `elegy-codegraph-review` skill running the fixed sequence |
| Validator | This repo (`scripts/`) | `validate-evidence-schema.js` |
| Dashboard | copilot-ui | Evidence inspector in review view |

### Non-goals

- Do not replace existing review output blocks (`IMPLEMENTATION_REVIEW`, etc.)
  — nest evidence inside them.
- Do not force-migrate all skills in one pass — incremental, opportunistic.
- Do not make evidence citation a hard commit gate — it is a review-quality
  signal, scored in Theme 06, not a commit-blocker (QCP coexistence).
- Do not make the schema so rigid it cannot express heuristic/LLM evidence —
  the `provenance` enum covers the full spectrum.

## Design

### The Evidence sub-schema

```json
{
  "$schema": "elegy-evidence/v1",
  "type": "object",
  "required": ["id", "provenance", "confidence", "source", "message"],
  "properties": {
    "id": { "type": "string", "description": "Unique within the pack" },
    "provenance": {
      "type": "string",
      "enum": ["deterministic-tool", "heuristic-tool", "llm-assisted", "llm-only"],
      "description": "deterministic-tool = reproducible machine output from pinned tool; heuristic-tool = documented FP rate; llm-assisted = LLM augments deterministic findings, cites underlying tool evidence; llm-only = pure LLM, non-blocking, never a pass/fail gate"
    },
    "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
    "source": {
      "type": "object",
      "required": ["kind", "ref"],
      "properties": {
        "kind": { "enum": ["file:line", "rule_id", "symbol_fq_name", "test_result", "doc_ref"] },
        "ref": { "type": "string", "description": "src/path/to/file.ts:42 | arch-rule:cli-no-db | src/planning.ts#nextRunnable" },
        "tool": { "type": "string", "description": "dependency-cruiser@4.0.0 | tsserver | semgrep@1.50 | elegy-codegraph@0.1" },
        "git_sha": { "type": "string" },
        "index_age_seconds": { "type": "integer", "description": "Age of the index/graph this evidence derives from" }
      }
    },
    "message": { "type": "string" },
    "severity": { "enum": ["error", "warning", "info"] }
  }
}
```

### The ReviewPack contract

```json
{
  "$schema": "elegy-review-pack/v1",
  "type": "object",
  "required": ["run", "changed_symbols", "impacted", "review_questions"],
  "properties": {
    "run": {
      "type": "object",
      "required": ["id", "git_sha_base", "git_sha_head", "tool_versions", "status"],
      "properties": {
        "id": { "type": "string" },
        "git_sha_base": { "type": "string" },
        "git_sha_head": { "type": "string" },
        "tool_versions": { "type": "object" },
        "status": { "enum": ["completed", "partial", "failed", "stale"] },
        "started_at": { "type": "string" },
        "completed_at": { "type": "string" }
      }
    },
    "changed_symbols": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "symbol": { "type": "string" },
          "file": { "type": "string" },
          "kind": { "type": "string" },
          "public": { "type": "boolean" },
          "change_kind": { "enum": ["added", "modified", "removed", "signature-changed"] }
        }
      }
    },
    "impacted": {
      "type": "object",
      "properties": {
        "direct_callers": { "type": "array" },
        "importers": { "type": "array" },
        "likely_tests": { "type": "array" },
        "docs": { "type": "array" }
      }
    },
    "architecture_findings": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "rule": { "type": "string" },
          "severity": { "enum": ["error", "warning", "info"] },
          "evidence": { "type": "array", "items": { "$ref": "evidence.schema.json" } }
        }
      }
    },
    "pattern_findings": {
      "type": "array",
      "items": { "$ref": "#/properties/architecture_findings/items" }
    },
    "review_questions": { "type": "array", "items": { "type": "string" } }
  }
}
```

### How it nests into existing skills

Each existing review output block gains an optional `evidence: Evidence[]`
field on findings:

```diff
  ## IMPLEMENTATION_REVIEW
  verdict: pass
  findings:
    - severity: high
      location: src/cli/commands/planning.ts:12
      issue: CLI imports DB layer directly
+     evidence:
+       - id: ev-1
+         provenance: deterministic-tool
+         confidence: 1.0
+         source: { kind: rule_id, ref: "arch-rule:cli-no-db", tool: "dependency-cruiser@4.x" }
+         message: "Forbidden import detected"
+         severity: error
```

When `evidence` is present → must conform to schema. When absent → implicitly
`provenance: "llm-only"`. **No existing skill breaks.**

### The deterministic review sequence

A review agent should run this fixed sequence (not ask the graph vague questions):

1. Build graph for current git SHA (Theme 03).
2. Compute changed files from git diff.
3. Map changed files → changed symbols (Theme 04).
4. Compute impacted files/symbols/tests/docs.
5. Run architecture rules only on affected subgraph (Theme 01).
6. Run pattern rules only on affected files (Theme 02).
7. Produce review evidence pack (`ReviewPack` JSON).
8. LLM reviews the diff WITH the evidence pack, not the whole repo.
9. LLM must cite graph evidence when making structural claims.

Step 9 is the trust mechanism: structural claims without evidence citations are
flagged as `provenance: "llm-only"` and down-weighted in review quality scoring
(Theme 06).

### Provenance semantics (controlled vocabulary)

| Provenance | Meaning | Blocking? |
|---|---|---|
| `deterministic-tool` | Reproducible machine output from a pinned tool version | Can inform blocking review verdicts |
| `heuristic-tool` | Tool output with documented false-positive rate | Advisory; may need triage |
| `llm-assisted` | LLM augments deterministic findings; always cites underlying tool evidence | Advisory; non-blocking |
| `llm-only` | Pure LLM analysis; non-blocking; never a deterministic pass/fail gate | Non-blocking; lowest weight |

This vocabulary is shared with the QCP spec's `Provenance Class` definitions,
ensuring consistency across the control plane.

## Implementation phases

### Phase 5a-1 — Schema + contracts (days)

- Author `contracts/elegy/evidence.schema.json` and `review-pack.schema.json`.
- Author `contracts/src/evidence.ts` and `reviewPack.ts` TypeScript types.
- Build into `contracts/dist/`.
- Author `docs/system/evidence-contract.md` canonical doc.
- Author `scripts/validate-evidence-schema.js` validator.

### Phase 5a-2 — Reviewer lane contract update

- Update `docs/specs/reviewer-lane-contract/spec.md` R5:
  - R5.1: Review verdicts MUST cite evidence conforming to `evidence.schema.json`
    when structural evidence is available.
  - R5.2: Reviewers MUST NOT produce `approved` verdicts on PRs touching public
    APIs or cross-module boundaries without citing at least one
    `provenance: "deterministic-tool"` evidence entry.
  - R5.3: When no structural evidence is available, findings are implicitly
    `provenance: "llm-only"` and the verdict must note the absence.
- Update `opencode-assets/agents/reviewer.md` prompt to accept `ReviewPack` as
  optional input and cite `Evidence` entries.

### Phase 5a-3 — Incremental migration

- Add optional `evidence[]` field to each existing review output block:
  `IMPLEMENTATION_REVIEW`, `SECURITY_REVIEW`, `SPEC_REVIEW`,
  `RUBBERDUCK_PLAN_REVIEW`, `CODE_REVIEW`.
- New codegraph review skill (5b) uses `ReviewPack` as primary input.
- Update `scripts/reviewer-evidence-contract.test.js` to check schema
  conformance, not just keyword presence.
- No deadline on existing skill migration — opportunistic.

### Phase 5b-1 — Review skill (weeks, after Themes 01-04 produce evidence)

- Author `catalog-assets/shared-skills/elegy-codegraph-review/SKILL.md`
  implementing the 9-step deterministic sequence.
- The skill invokes `elegy codegraph review-pack` (Theme 03) and consumes the
  `ReviewPack` JSON.
- The skill instructs the LLM to review the diff + pack, cite evidence for
  structural claims, and produce a review output block with `evidence[]`.

### Phase 5b-2 — Dashboard evidence inspector

- Add an evidence inspector panel in the copilot-ui review view.
- Shows each `Evidence` entry with provenance badge, confidence, source ref,
  staleness, and a link to the underlying file/rule/symbol.

### Phase 5b-3 — Validation

- `validate-evidence-schema.js` validates review outputs citing evidence.
- Reviewer agent, given a `ReviewPack`, cites ≥1 `deterministic-tool` evidence
  entry for a structural claim.
- Reviewer agent, given no `ReviewPack`, notes the absence (R5.3).
- Theme 06 measures evidence-citation quality across seeded PRs.

## Coexistence boundary

- Evidence schema is a **contract**, not a gate. It does not block commits.
- Evidence citation is a **review-quality signal**, scored in Theme 06, not a
  commit-blocker (QCP coexistence).
- The schema does not replace the commit-check trilogy; it enriches review.
- `llm-only` evidence is explicitly non-blocking — it cannot override a
  deterministic-tool finding or a commit-check lane.

## Follow-ups & future work

- **Theme 06 measurement:** The evaluation protocol measures evidence-citation
  quality: does the reviewer cite `deterministic-tool` evidence for structural
  claims? Does it hallucinate structural facts without evidence? This is the
  core trust metric.
- **Evidence staleness alerts:** When `index_age_seconds` exceeds a threshold,
  the review skill warns the reviewer that graph evidence may be stale and
  recommends a rebuild.
- **Cross-harness evidence:** The schema is harness-neutral. Copilot, Codex,
  Antigravity, and Claude Code reviewers can all consume the same `ReviewPack`.
  A follow-up wires each harness's reviewer to accept it.
- **Evidence retention policy:** `ReviewPack` artifacts under
  `.elegy/codegraph/runs/<sha>/` accumulate. A retention policy (keep N most
  recent, or keep all for the current goal's work points) is a follow-up.
- **Evidence in planning state:** `planning_project_run_add_evidence` currently
  accepts freeform JSON. A follow-up constrains it to the `Evidence` schema,
  closing the loop between review evidence and planning state.

## Dependencies & sequencing

- **5a (schema):** No hard dependencies. Ships first. Consumed by all themes.
- **5b (workflow):** Depends on Themes 01-04 producing evidence. Ships as each
  theme lands.
- **Unblocks:** Theme 06 (evidence-citation quality is a core metric), trust in
  all other themes (without the schema, evidence is unmeasurable).

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Schema too rigid; cannot express real evidence | `provenance` enum covers full spectrum; `source.kind` is extensible; `message` is freeform |
| Migration stalls; skills never adopt the field | Opportunistic migration; new skills required to use it; Theme 06 scores adoption |
| Reviewer hallucinates evidence (cites a non-existent rule) | `validate-evidence-schema.js` checks `source.ref` resolves to a real rule/file/symbol; Theme 06 flags hallucinated citations |
| Stale evidence misleads reviewers | `index_age_seconds` + `git_sha` in every evidence entry; staleness banner; rebuild recommended |
| Evidence overload (too many entries) | Severity filtering; `review_questions` surface the top signals; pack size budget |
| Backward-incompatible schema change | Schema-versioned (`elegy-evidence/v1`); semver policy; old packs remain valid |

## Acceptance criteria (for the eventual spec)

- `evidence.schema.json` and `review-pack.schema.json` validate sample payloads.
- `validate-evidence-schema.js` rejects malformed evidence and accepts valid evidence.
- Reviewer lane contract R5 updated to require schema-conformant evidence
  citation for structural claims.
- Reviewer agent prompt accepts `ReviewPack` input and cites `Evidence` entries.
- At least one existing review skill (`IMPLEMENTATION_REVIEW` or `SECURITY_REVIEW`)
  nests an optional `evidence[]` field without breaking existing tests.
- `node scripts/validate-specs.js --strict` passes for the promoted spec(s).

## Related artifacts

- `docs/specs/reviewer-lane-contract/spec.md` — R5 to update
- `docs/specs/code-quality-control-plane-research/spec.md` — Provenance Class vocabulary
- `opencode-assets/agents/reviewer.md` — reviewer agent prompt
- `catalog-assets/shared-skills/implementation-review/SKILL.md` — first migration target
- `scripts/reviewer-evidence-contract.test.js` — test to update
- `contracts/elegy/` — schema home
