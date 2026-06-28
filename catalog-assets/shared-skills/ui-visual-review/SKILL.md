---
name: ui-visual-review
description: "Review rendered UI evidence (screenshots, browser output, component renders) without editing code. Report hierarchy, layout, component, UX, accessibility, and aesthetic defects. Triggers on: visual review, UI review, design review, screenshot review, visual check, UI audit, look and feel, visual defects."
license: Apache-2.0
---

# UI Visual Review

## Purpose

Review rendered UI evidence against the declared spec, repo conventions, and
accessibility expectations. Report defects across hierarchy, layout, component
usage, UX flow, accessibility, and aesthetics — without editing code.

This skill is a **read-only judgment lane**, separate from implementation review.
It loads during review gates when UI evidence is present.

## Trigger On

- "review this UI"
- "visual review of..."
- "check the design against..."
- Screenshot or browser evidence present in a review
- Post-implementation visual audit
- UI review gate in the governed workflow

## Do Not Use

- Implementation review (use `implementation-review` or `@code-reviewer`)
- Code edits or fixes — this skill judges, does not fix
- Review of non-UI surfaces (backend, CLI, schema)
- Spec authoring (use `ui-design-spec`)

## Review Dimensions

Every visual review must address these dimensions. Report findings, not opinions.

### 1. Hierarchy

- Is the visual hierarchy clear (primary action > secondary > chrome)?
- Are headings, labels, and body text properly weighted?
- Do z-index layers stack correctly (modals above content, toasts above modals)?

### 2. Layout

- Does the layout match the declared spec (zones, direction, spacing)?
- Are alignment and distribution consistent with the existing pattern library?
- Do responsive states (if declared) actually adapt?
- Is spacing consistent with the token system (no magic numbers)?

### 3. Component Usage

- Are the correct repo components used (no ad-hoc replacements)?
- Do components appear in their intended variants (primary/secondary/ghost)?
- Are icons from the correct library and naming convention?
- Are tokens used instead of hardcoded values?

### 4. UX Flow

- Is the primary user task achievable without confusion?
- Are interactive elements clearly distinguishable from static content?
- Do loading, empty, and error states match their spec?
- Is the navigation path consistent with existing patterns?

### 5. Accessibility

- Is keyboard focus visible and in logical order?
- Do interactive elements have accessible names (aria-label, visible label)?
- Is color contrast sufficient for text and interactive elements?
- Are states communicated through more than color alone (icons, text)?

Note: Accessibility findings are observations from visual evidence.
**Never claim compliance** from a DOM snapshot or screenshot alone.

### 6. Aesthetics

- Is the visual density appropriate (not too sparse, not too crowded)?
- Are type scales, radii, and shadows consistent with the design system?
- Does the surface feel coherent with adjacent surfaces?

Aesthetic findings are the lowest-severity category and should not block
unless they represent a clear regression from the existing surface.

## Finding Format

```text
VISUAL_REVIEW_FINDING
- dimension: <hierarchy|layout|component|ux|a11y|aesthetic>
- severity: blocking | high | medium | low
- location: <description of where on the surface>
- observed: <what is visible in the evidence>
- expected: <what the spec or convention requires>
- fix_hint: <direction for the implementer, not exact code>
```

Severity guide:

| Severity | Criteria |
|----------|----------|
| blocking | User cannot complete primary task; data loss risk; critical a11y violation |
| high | Clear spec violation; component misuse that breaks consistency |
| medium | Layout drift; missing state handling; minor a11y gap |
| low | Aesthetic preference; spacing tweak; cosmetic |

## Output Block

```text
VISUAL_REVIEW
- verdict: approved | changes-requested | blocked
- evidence_reviewed: <list of files/screenshots reviewed>
- dimensions_covered: <list of dimensions checked>
- findings:
  - <VISUAL_REVIEW_FINDING block per finding>
- gaps:
  - <evidence that was expected but missing>
- summary: <one-sentence verdict>
```

## Validation Rule

1. Every finding must reference specific visible evidence (not assumptions).
2. No finding may suggest code edits — only observed defects and fix direction.
3. Accessibility findings must acknowledge the evidence limit (screenshot/DOM only).
4. Aesthetic findings should not block unless they represent a clear regression.

## Authority

- Repo design tokens and conventions > this review.
- The declared UI spec (from `ui-design-spec`) is the expected-behavior authority.
- This review defers to `implementation-review` for code quality and correctness.
- This review does not override user intent or explicit design decisions.

## Handoff

Pass the `VISUAL_REVIEW` block to the orchestration lane. If blocked, include
the specific dimension and observed defect that blocks progress.
