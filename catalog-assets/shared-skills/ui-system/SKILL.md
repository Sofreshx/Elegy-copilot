---
name: ui-system
description: "Build UI from the existing codebase. Inventory components, primitives, icons, tokens, and stories before creating new UI; reuse local patterns first, treat Figma and Storybook MCP data as context (not authority), and pick the narrowest available validation. Triggers on: ui, component, frontend, view, screen, panel, dialog, form, button, icon, style, styling, design system, storybook, figma, styling consistency, design-system reuse."
---

# UI System

## Purpose

Stop the agent from inventing duplicate UI. The first version is
**repo-grounded and MCP-optional**: it works by searching local code, and
only references Figma or Storybook adapters when those tools are actually
available in the session.

## Trigger On

Use this skill when the request is any of:

- UI creation or new screens / panels / dialogs / forms
- UI refactor, restyle, or visual cleanup
- Component creation, including wrappers, layout primitives, and shared widgets
- Icon work (new icon, swap icon, decide which icon library entry to use)
- Styling consistency, token use, theme work
- Design-system reuse questions ("should I make a new component or use X?")
- Implementing UI that was informed by Figma, Storybook, or another design source
- Frontend visual review of a change

## Do Not Use

- Backend, CLI, schema, or pure data work with no UI surface
- One-line copy or text fixes that do not change the UI surface
- Replacing this skill with raw MCP fetches; local code is the authority, MCP is context

## Target Contract

Before implementing any UI change, confirm or declare:

- **Target route/surface**: the exact view, panel, dialog, or screen
- **Viewports**: desktop, mobile, or both
- **States required**: default, loading, empty, error, disabled, focus
- **Primary user task**: the one thing the user must accomplish on this surface

If any of these are unknown, clarify before implementing.

## Core Workflow

### 1. Inventory First

Before inventory, confirm the target contract (route, viewports, states, primary task).

Before writing or proposing any new UI element, run an inventory:

- Search the repo for:
  - existing **domain components** (Button, Toolbar, SettingsPanel, etc.)
  - existing **shared primitives** (Box, Stack, Modal, Input)
  - existing **icon library, import path, wrapper, and naming convention**
  - existing **token / theme files** (colors, spacing, typography, motion)
  - existing **stories, examples, and nearby screens** that already use the
    same patterns
- Cite the discovered pattern in the plan or handoff. Inventory without
  citation is the same as no inventory.

If you cannot find the pattern in code or story, do **not** invent a new
one and search again. Cite what you searched and what came back.

### 2. Reuse Order

Apply this order before proposing any new component:

1. **Existing domain component** in the same product area
2. **Existing shared primitive** (design system, internal kit)
3. **Existing library primitive wrapped locally** (Radix, Headless UI, etc.,
   only through the local wrapper that already exists)
4. **New component** only after inventory proves no suitable existing
   pattern; the plan must name the inventory commands run and the negative
   result

Stop the order at the first hit. Do not skip straight to "new component"
when a shared primitive already exists.

### 2a. State Handling

Address these states for every interactive surface (state it is N/A when it does not apply):

- **Loading**: skeleton, spinner, or progress indicator
- **Empty**: meaningful message when no data exists
- **Error**: error boundary, inline error, or toast
- **Disabled**: muted styling + `disabled` attribute or `aria-disabled`
- **Focus**: visible focus ring on keyboard navigation
- **Responsive**: layout adapts to declared viewports

If a state is not handled, record it as a state gap in the handoff.

### 3. Icon Rule

- Use the **existing icon library, import path, and wrapper**.
- Follow the **existing naming convention** (kebab-case, PascalCase, prefixed,
  etc.). If unsure, read 2-3 existing icon usages and match the pattern.
- Do **not** add:
  - raw SVGs as inline JSX
  - a new icon package to `package.json`
  - a duplicate icon component that already exists under a different name
- If the needed icon does not exist in the local library, surface the
  inventory result and ask the user before adding a new entry.

### 4. Style And Token Rule

- Use the existing token / theme variables or CSS modules. Do not hardcode
  colors, spacing, font sizes, or motion values in component code.
- If a needed value is missing from the token set, record it as a token gap
  in the handoff instead of inventing a one-off literal.
- Match the existing responsive, density, and dark-mode conventions if
  they exist.

### 5. Figma / Storybook Handling (MCP-Optional)

Only treat Figma / Storybook as **context**, not as authority:

- Prefer local code over the design tool when they conflict.
- When the session has a Figma MCP server:
  - read component, token, and variant data
  - map every MCP name back to a local component, primitive, or token
  - if no local match exists, the local inventory result wins on what to
    add; the MCP result only informs naming and structure
- When the session has a Storybook MCP server:
  - pull the relevant story for the closest existing local component
  - re-implement the change through the local primitive, not by copying
    the story verbatim
- If neither MCP is present, work entirely from local code and stories.
  Do not block on their absence.

## Validation Rule

### Declare a Validation Lane

Every UI change must declare exactly one validation lane:

| Lane | Evidence produced | Gap |
|------|------------------|-----|
| `browser` | Screenshots, console output, network log | Does not prove desktop behavior |
| `desktop` | Native WebView/Tauri screenshot, platform logs | Requires platform tooling |
| `component` | Unit/render test output | Does not prove visual correctness |
| `unavailable` | Explicit gap statement | Must be stated in handoff |

### Pick the Narrowest Proof

Pick the **narrowest** available proof that covers the changed behavior:

- component / unit test
- story update or new story
- focused build or typecheck
- screenshot or browser check
- accessibility check (axe, keyboard, focus order, contrast)
- visual diff or regression snapshot

If no UI validation surface is available in the repo, **state the gap explicitly**
in the handoff. Do not invent or skip validation silently.

## Handoff Notes

When handing off UI work to another session or model, include:

- the inventory commands run and the local patterns they hit
- the chosen reuse level from the reuse order
- icon and token decisions, with file:line references when possible
- the validation command(s) actually run and the result, or the explicit gap
- any Figma / Storybook data that informed the work and how it was
  reconciled with local code
- the declared validation lane and the evidence produced (screenshot path, test output, console log)
- state gaps: any required states not addressed and why
- a pointer to the canonical governance doc when applicable:
  `docs/system/ui-development-governance.md`
