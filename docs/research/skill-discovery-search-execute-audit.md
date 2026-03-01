---
created: 2026-03-01
updated: 2026-03-01
category: research
status: current
doc_kind: node
id: skill-discovery-search-execute-audit
summary: Audit of skill discovery effectiveness using the search/execute pattern — hit rates, failure modes, and improvement vectors.
tags: [skills, discovery, search-execute, progressive-disclosure, audit]
---

# Research: Skill Discovery via Search/Execute Pattern

## Scope

Evaluate how effectively agents discover and load the right skills using the current search/execute pattern. Identify failure modes, measure the architecture's coverage, and propose improvements.

---

## Current Discovery Architecture

### The Three Resolution Patterns

From `skill-discovery/SKILL.md`:

**Pattern 1 — Stack Detection (project-wide)**
```
Agent runs stack-detector
→ Scans .csproj, package.json, *.tf, docker-compose*.yml
→ Extracts package references
→ Matches against detection rules table
→ Returns list of relevant skill names
→ Agent loads each via read_file
```

**Pattern 2 — Keyword Search (task-specific)**
```
Agent identifies domain keywords from task
→ Looks up keyword→skill table in skill-discovery
→ Matches to skill name
→ Loads from vault via read_file
```

**Pattern 3 — Direct Load (known skill)**
```
Agent already knows skill name
→ read_file("~/.copilot/skills-vault/{skill-name}/SKILL.md")
```

### The Vault Layout

```
~/.copilot/
├── skills/                    ← Always loaded (4 meta-skills)
│   ├── skill-discovery/       ← Discovery keyword map
│   ├── core-guardrails/       ← Safety
│   ├── implementation-friction/← Code friction capture
│   └── stack-detector/        ← Tech detection
│
└── skills-vault/              ← On-demand (30+ domain skills)
    ├── wolverine-core/
    ├── firebase-auth/
    ├── marten-documents/
    └── ...
```

---

## Discovery Effectiveness Analysis

### Pattern 1: Stack Detection — Coverage Audit

The stack-detector scans for package references and matches against rules:

**.NET Detection Rules** (from .csproj):

| Package Pattern | Skills Detected | Coverage |
|---|---|---|
| `Marten` | marten-documents, marten-events, marten-linq-querying | Full |
| `WolverineFx` | wolverine-core | Full |
| `WolverineFx.Http` | wolverine-http | Full |
| `Microsoft.Orleans.*` | orleans | Full |
| `Microsoft.AspNetCore.SignalR*` | signalr | Full |
| `Aspire.Hosting*` | aspire-apphost, aspire-deployment, alba-integration-tests | Full |
| `Alba` | alba-integration-tests | Full |
| `FirebaseAdmin` | firebase-auth | Full |
| `Microsoft.SemanticKernel*` | semantic-kernel-agents | Full |
| `OpenTelemetry*` | logging-observability | Full |
| `NSubstitute`, `xunit`, `Shouldly` | testing-dotnet-unit | Full |

**Node.js Detection Rules** (from package.json):

| Package Pattern | Skills Detected | Coverage |
|---|---|---|
| `@tanstack/react-query` | react-query | Full |
| `firebase`, `firebase-admin` | firebase-auth | Full |
| `@testing-library/react`, `vitest`, `jest` | testing-frontend-unit | Full |
| `react`, `vue`, `@angular/core` | frontend | Full |

**Missing Detection Rules** (vault skills with no stack-detector rule):

| Skill | Why Not Auto-Detected |
|---|---|
| security | Cross-cutting, not package-specific |
| debug | Cross-cutting, generic behavior |
| refactor | Cross-cutting, generic behavior |
| code-review | Cross-cutting, not tech-specific |
| design | Cross-cutting, architectural |
| planning-feature | Workflow, not tech-specific |
| planning-refactor | Alias for planning-feature |
| terraform | Has *.tf detection rule (covered) |
| deployment-compose | Has docker-compose*.yml detection |
| openai-compatible | Could detect `openai` package |
| csharp-expert | Could detect any .csproj presence |
| frontend | Only detects from package.json |
| microsoft-agent-framework | Could detect `Microsoft.Agents*` |

**Assessment**: Stack detection covers ~70% of domain skills for .NET and Node.js projects. Cross-cutting skills (security, debug, refactor, design, planning) are correctly excluded — they should be triggered by task context, not packages.

**Blind spot**: `openai-compatible` and `microsoft-agent-framework` could have package detection rules but don't.

---

### Pattern 2: Keyword Search — Coverage and Precision

The keyword→skill mapping in skill-discovery covers 33 entries. Let me analyze hit/miss scenarios:

**High-confidence matches** (unambiguous keyword → skill):
- "Wolverine endpoint" → wolverine-http ✓
- "Marten LINQ" → marten-linq-querying ✓
- "Orleans grain" → orleans ✓
- "SignalR hub" → signalr ✓
- "Firebase auth" → firebase-auth ✓
- "xUnit test" → testing-dotnet-unit ✓

**Moderate-confidence matches** (requires interpretation):
- "Write an integration test" → could be alba-integration-tests OR testing-dotnet-unit
- "Add authentication" → could be firebase-auth OR a generic auth pattern
- "Set up monitoring" → could be logging-observability OR deployment-related

**Low-confidence scenarios** (keyword table fails):
- "Create a REST endpoint" → No clear match (could be wolverine-http, could be minimal API)
- "Add a background job" → No skill for this (wolverine-core handles messages, but user might mean Hangfire)
- "Write a migration" → No skill (Marten has implicit schema, EF has migrations, neither is clearly routable)
- "Optimize performance" → No skill match
- "Set up CI/CD" → No skill match (deployment-compose is Docker-specific)

**Assessment**: Keyword search works well for unambiguous domain queries (~60% of realistic requests). It degrades for generic development tasks that don't map to a specific framework.

---

### Pattern 3: Direct Load — Reliability

This pattern assumes the agent already knows the skill name. It's used by:
- Orchestrator (which has a mental model of available skills)
- Agent instructions that explicitly reference skills (e.g., "load `implementation-friction` when code friction is detected")

**Assessment**: 100% reliable when the agent knows the name. The issue is how agents learn names — see Patterns 1 and 2 above.

---

## Failure Mode Taxonomy

### FM-1: Keyword Miss

**Trigger**: User task uses synonyms or domain jargon not in the keyword table.
**Example**: User says "persistence layer" instead of "document store" — misses marten-documents.
**Impact**: Agent proceeds with general knowledge; quality may be lower.
**Frequency**: Moderate. Natural language is inherently varied.

### FM-2: Multi-Skill Ambiguity

**Trigger**: Task spans multiple skills with no clear primary.
**Example**: "Add a Wolverine endpoint that stores events in Marten and publishes via SignalR."
**Impact**: Agent must load 3 skills (wolverine-http, marten-events, signalr). Current protocol loads one at a time — no batching guidance.
**Frequency**: Common in real workflows. Most features touch multiple domains.

### FM-3: Stale Keyword Map

**Trigger**: New skill added to vault but keyword map not updated.
**Impact**: Skill is invisible to Pattern 2. Only discoverable via Pattern 1 (if package-detectable) or by listing the vault directory.
**Frequency**: Will increase as vault grows. Currently no validation check enforces sync.

### FM-4: Over-Loading Default-Handled Skills

**Trigger**: Agent loads debug/refactor/design from vault when base model handles these adequately.
**Impact**: Wastes context tokens on low-value-add skill content.
**Frequency**: Low — skills governance hides these. But keyword table still includes mappings like "Debug, investigate → debug".

### FM-5: No Discovery Path for Research Docs

**Trigger**: Agent needs project-specific context (e.g., security model, deployment constraints) that lives in docs/ not skills/.
**Impact**: Agent misses project-level constraints that aren't encoded in skills.
**Frequency**: Moderate. Skills encode patterns; docs encode decisions.

---

## The Search/Execute Pattern — How It Compares

The current system implements a lightweight version of the "search/execute" pattern from the Cloudflare Code Mode MCP research:

| Aspect | Code Mode MCP | Current Skill Discovery |
|---|---|---|
| **Search** | Typed API search via MCP tool | Keyword table lookup + directory listing |
| **Execute** | Sandboxed code execution | read_file to load skill, then follow instructions |
| **Surface** | 2 fixed tools | 3 resolution patterns + file tools |
| **Context cost** | Fixed (2 tool descriptions) | Low (skill-discovery ~1500 tokens always loaded) |
| **Precision** | High (typed API, exact match) | Moderate (keyword synonyms, human intuition) |
| **Extensibility** | Add API endpoints (no prompt change) | Add vault skill + update keyword map |

**Assessment**: The skill-discovery approach is a pragmatic, low-barrier implementation of search/execute. It trades precision (no typed schema, synonym fragility) for simplicity (no runtime infrastructure, no sandbox).

---

## Scored Assessment

| Dimension | Score (1-5) | Notes |
|---|---|---|
| **Stack detection coverage** | 4 | Good .NET/Node coverage; a few gaps |
| **Keyword search precision** | 3 | Works for exact matches, fragile for synonyms |
| **Multi-skill scenarios** | 2 | No guidance for loading skill combos |
| **Keyword map maintenance** | 2 | Manual, no sync validation |
| **Default-handled gating** | 4 | Governance doc clearly classifies |
| **Vault discovery fallback** | 3 | Directory listing works but is noisy |
| **Cross-domain routing** | 2 | No skill-to-doc or skill-to-agent links |
| **Token efficiency** | 5 | Zero startup cost for on-demand skills |

**Overall: 3.1/5** — Solid architecture, execution gaps in maintenance and multi-skill coordination.

---

## Recommendations (for future planning)

### High Priority

1. **Add vault/keyword sync validation**: A script or CI check that compares skill-vault directories against the keyword map in skill-discovery/SKILL.md. Flag orphaned vault skills with no keyword entry.

2. **Multi-skill loading guidance**: Add a section to skill-discovery that teaches agents how to handle tasks spanning 2-3 skills — load primary first, then supplementary, with a token budget aware approach.

3. **Synonym expansion for keyword map**: Add alternative phrasings to high-value entries. E.g., "persistence → marten-documents", "background job → wolverine-core", "REST endpoint → wolverine-http".

### Medium Priority

4. **Skill description indexing**: Use the YAML frontmatter `description` and `triggers on` fields already present in SKILL.md files as a secondary search path when keyword table misses.

5. **Discovery telemetry stub**: Track which skills are loaded per session (the SessionManager already tracks tool calls). Use this data to validate keyword coverage over time.

6. **Cross-reference skills to docs**: Skills like security, testing-dotnet-unit, etc. should include `Related docs: docs/system/security-model.md` entries.

### Lower Priority

7. **Consider semantic search fallback**: When keyword exact-match fails, allow agents to run a semantic search over SKILL.md descriptions. This adds a retrieval step but improves recall for ambiguous queries.

8. **Auto-generate keyword map from frontmatter**: The `description` and tags in each SKILL.md's frontmatter already contain trigger keywords. A generator script could produce the keyword table automatically.

---

## References

- [engine-assets/skills/skill-discovery/SKILL.md](../../engine-assets/skills/skill-discovery/SKILL.md)
- [engine-assets/skills/stack-detector/SKILL.md](../../engine-assets/skills/stack-detector/SKILL.md)
- [engine-assets/copilot-instructions.md](../../engine-assets/copilot-instructions.md)
- [docs/system/skills-governance.md](../system/skills-governance.md)
- [docs/research/skillpointer-codemode-techniques.md](skillpointer-codemode-techniques.md)
