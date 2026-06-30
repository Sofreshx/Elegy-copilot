# Adaptation Notes — Matt Pocock Skills → Elegy Copilot

**Source**: [github.com/mattpocock/skills](https://github.com/mattpocock/skills)  
**Date adapted**: 2026-06-19  
**Skills adapted**: 9

## General adaptation rules

| Matt's pattern | Our equivalent |
|---|---|
| `CONTEXT.md` (domain glossary) | `docs/system/` canonical doc chain (index → MOC → node) |
| `docs/adr/` (architectural decisions) | `docs/system/adr/` |
| `CONTEXT-MAP.md` (multi-context) | `docs/system/index.md` + MOCs in `docs/system/mocs/` |
| `/slash-command` invocation (Claude Code) | `skill` tool invocation (OpenCode) or slash-command (Claude/Codex) |
| `disable-model-invocation: true` | Same — we support this directly |

## Per-skill adaptation log

### 1. codebase-design
- **Changes**: CONTEXT.md references → `docs/system/index.md`. Added References and Boundaries sections. Removed DEEPENING.md and DESIGN-IT-TWICE.md sub-doc references (future work).
- **Preserved**: Core glossary (module, interface, depth, seam, adapter, leverage, locality). Deep-vs-shallow diagrams. Design principles. Testability patterns.
- **New**: Source attribution in metadata. Companion skill cross-references.

### 2. grilling
- **Changes**: Added Precondition (read docs/system/). Added References and Boundaries. Removed context-less trigger phrases.
- **Preserved**: One-question-at-a-time interview loop. Codebase-explorable skip rule. Completion criterion.
- **New**: Companion references to domain-modeling and rubberduck-plan-review.

### 3. domain-modeling
- **Changes**: File structure diagram rewritten for Elegy Copilot layout. CONTEXT.md → docs/system/ canonical nodes. docs/adr/ → docs/system/adr/. "Update CONTEXT.md inline" → "Update the owning canonical node".
- **Removed content**: CONTEXT-FORMAT.md and ADR-FORMAT.md sub-docs. Their key content is now inlined:
  - Glossary format (opinionated definitions with `_Avoid_` tags, project-specific-only rule)
  - ADR format (single-paragraph ADR, three gate criteria, sequential numbering)
  - Single vs multi-context guidance (now "single vs multi-MOC")
- **Preserved**: Challenge-against-glossary pattern. Sharpen fuzzy language. Stress-test with scenarios. Cross-reference with code. ADR gate criteria.
- **New**: References section. Boundaries section.

### 4. diagnosing-bugs
- **Changes**: CONTEXT.md → `docs/system/` + `docs/system/adr/`. Removed `scripts/hitl-loop.template.sh` reference. Skill references updated.
- **Preserved**: Full 6-phase discipline. Feedback loop construction methods (1-10). Tightening criteria. Non-deterministic bug handling. Falsifiable hypothesis format. Tagged debug log pattern. Correct seam test rule.
- **New**: References and Boundaries sections.

### 5. tdd
- **Changes**: Replaced adapted content with original Matt Pocock version. Updated frontmatter with `disable-model-invocation: true`. Removed companion cross-references to `codebase-design` and `diagnosing-bugs` (original version is self-contained).
- **Preserved**: Core TDD cycle (red-green-refactor). Iron Law. Vertical slice discipline.
- **New**: The Iron Law section. Rationalization debunks. Common rationalizations table. Red Flags list. Bug fix example. When Stuck table. Verification checklist. Final Rule.

### 6. writing-great-skills
- **Changes**: Removed GLOSSARY.md reference. Added skill-authoring cross-reference.
- **Removed content**: GLOSSARY.md contained definitions of bold terms. These are now described inline in their first use. Original GLOSSARY.md covered: context load, cognitive load, model-invoked, user-invoked, router skill, description, information hierarchy, in-skill step, in-skill reference, external reference, context pointer, progressive disclosure, branch, legwork, completion criterion, premature completion, co-location, granularity, duplication, single source of truth, relevance, no-op, leading word, sediment, sprawl.
- **Preserved**: Full invocation theory. Description writing rules. Information hierarchy ladder. Split rules. Pruning discipline. Leading word concept. Failure modes (premature completion, duplication, sediment, sprawl, no-op).
- **New**: References section. Boundaries section clarifying design quality vs format compliance.

### 7. handoff
- **Changes**: Artifact type references updated (PRDs → specs, ADR path changed, elegy-planning references added). Renamed internally to "Cross-Session Handoff" for clarity.
- **Preserved**: Temp-dir write pattern. Reference-by-path rule. Secret redaction. Argument hint.
- **New**: Boundaries section distinguishing from implementation-handoff. Output filename convention.

### 8. prototype
- **Changes**: LOGIC.md and UI.md content inlined as sections. Path references updated.
- **Inlined content (preserved in full)**:
  - **LOGIC.md**: State-the-question rule. Language selection. Portable-module isolation (reducer/state-machine/pure-functions/class shapes). TUI build pattern (clear-screen re-render, state + shortcuts layout). One-command-to-run rule. Handoff and capture steps. Anti-patterns.
  - **UI.md**: Sub-shape A vs B decision tree. Variant count (3 default, 5 max). Structural-difference requirement. Switcher component pseudo-code. Floating switcher design (arrows, keyboard, production gate). Handoff and cleanup steps. Anti-patterns.
- **Removed**: Separate LOGIC.md and UI.md files — content preserved inline.
- **New**: References and Boundaries sections.

### 9. improve-codebase-architecture
- **Changes**: CONTEXT.md → `docs/system/`. docs/adr/ → `docs/system/adr/`. Skill cross-references updated. HTML-REPORT.md adapted as sibling file.
- **Preserved**: Full explore → HTML report → grilling loop process. Candidate card structure. Side-effect update rules.
- **HTML-REPORT.md**: Adapted — CONTEXT.md → `docs/system/` reference, codebase-design skill references updated. Scaffold, diagram patterns (Mermaid, hand-built, cross-section, mass, call-graph), style guidance, tone rules all preserved.
- **New**: References and Boundaries sections.

## Enable/disable mechanism

All 9 skills are in the `engineering-toolkit` bundle in `engine-assets/manifest.json`. Users toggle the bundle in the Copilot UI. Individual skills can be disabled via the manifest's `enabled` flag. All skills use `loadMode: "on-demand"` — they never auto-load into agent context; only loaded when explicitly invoked via the skill tool.
