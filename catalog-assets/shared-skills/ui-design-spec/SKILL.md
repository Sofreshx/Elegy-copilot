---
name: ui-design-spec
description: "Convert prompts, screenshots, generated concepts, or Figma context into a structured repo-grounded UI specification. Triggers on: ui spec, design spec, UI specification, screen design, component spec, Figma to spec, screenshot to spec, UI requirements."
---

# UI Design Spec

## Purpose

Convert any design input — prose prompt, screenshot, generated image, or Figma link —
into a structured, repo-grounded specification that an implementation lane can execute.
The spec anchors on the target repo's existing components, tokens, and patterns —
never on assumptions about an external design system.

## Trigger On

- "write a UI spec for..."
- "spec out the design for..."
- User provides a screenshot or generated UI concept
- Figma context needs translation into implementation-ready spec
- New surface or major redesign with unknown scope

## Do Not Use

- Pure implementation work where the scope is already clear (use `ui-system`)
- Visual review of already-built UI (use `ui-visual-review`)
- Specs for non-UI surfaces (backend, CLI, schema)

## Spec Structure

Every `ui-design-spec` output must contain:

### 1. Target Declaration

```text
- Route/Surface: <exact view, panel, dialog, or screen>
- Viewports: desktop | mobile | both
- Primary user task: <one sentence — what must the user accomplish?>
```

### 2. State Inventory

| State | Handling | N/A? |
|-------|----------|------|
| Default | | |
| Loading | | |
| Empty | | |
| Error | | |
| Disabled | | |
| Focus | | |
| Responsive | | |

If a state is N/A, state the reason in one sentence.

### 3. Component Inventory

Run the `ui-system` inventory before completing the spec:

- Existing domain components that match the surface
- Existing shared primitives available
- Icon library entries needed
- Token/theme variables to use
- Layout patterns from nearby surfaces

Cite each finding with file:line or search command.

### 4. Layout Description

Describe the visual hierarchy:

- Primary layout direction (top-to-bottom, left-to-right, grid)
- Key sections/zones with their component assignments
- Spacing and density notes referenced to existing tokens
- Responsive breakpoints if applicable

### 5. Interaction Notes

- Primary interaction path (click flow, form submit, navigation)
- Keyboard shortcuts or accessibility requirements
- Animations/transitions (cite existing patterns, not new values)

### 6. Acceptance Criteria

At least 3 verifiable criteria:

- [ ] <observable user-facing behavior>
- [ ] <observable user-facing behavior>
- [ ] <observable user-facing behavior>

### 7. Evidence Plan

- Declared validation lane: browser | desktop | component | unavailable
- Expected evidence: <what screenshots/logs/tests will prove correctness>

## Input Handling By Source

### Prose Prompt
- Extract the surface name, task, and states the user described.
- Fill gaps by asking the user, not by inventing.

### Screenshot or Generated Image
- Describe the layout, component hierarchy, and visual patterns you observe.
- Map observed patterns to existing repo components where possible.
- Flag anything observed that has no local match as a gap.

### Figma Context
- Map Figma component/variant names to local components.
- Extract token values and cross-reference with local token files.
- If Figma shows a component not in the local inventory, the local inventory wins.
  Record the Figma component as context, not authority.

## Output Format

```text
UI_DESIGN_SPEC
- target: <route/surface>
- viewports: <desktop|mobile|both>
- primary_task: <one sentence>
- states: <list of addressed states with N/A notes>
- components:
  - <file:line or search result>
- tokens:
  - <file:line references>
- icons:
  - <file:line references>
- layout: <primary direction + zones>
- interactions: <primary path + a11y notes>
- acceptance:
  - [ ] <criterion>
  - [ ] <criterion>
  - [ ] <criterion>
- evidence_lane: <browser|desktop|component|unavailable>
- evidence_plan: <what to capture>
- gaps: <missing components, tokens, or states>
```

## Validation Rule

After the spec is written, validate:

1. Every component reference maps to an existing file or search result.
2. Every token reference maps to an existing token file.
3. Every state in the inventory has a handling plan or N/A reason.
4. At least 3 acceptance criteria exist and are verifiable.

## Authority

- Local repo code and tokens > this spec > Figma/Storybook/external context.
- When this spec conflicts with `ui-system`, `ui-system` wins on implementation
  constraints; this spec wins on user-facing behavior and acceptance criteria.

## Handoff

Pass the structured `UI_DESIGN_SPEC` block to the implementation lane.
Include the exact inventory commands run so the implementer can reproduce the
component search.
