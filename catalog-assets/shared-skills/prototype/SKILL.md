---
name: prototype
description: "Build a throwaway prototype to flesh out a design — a runnable terminal app for state/business-logic questions, or several radically different UI variations toggleable from one route. Use when the user wants to prototype, experiment, or test a design before committing to implementation."
disable-model-invocation: true
license: Apache-2.0
metadata: {"source":"https://github.com/mattpocock/skills","adapted":true,"originalName":"prototype","notes":"LOGIC.md and UI.md sub-docs inlined as sections"}
---

# Prototype

A prototype is **throwaway code that answers a question**. The question decides the shape.

## Pick a branch

Identify which question is being answered — from the user's prompt, the surrounding code, or by asking if the user is around:

- **"Does this logic / state model feel right?"** → [Logic prototype](#logic-prototype-branch). Build a tiny interactive terminal app that pushes the state machine through cases that are hard to reason about on paper.
- **"What should this look like?"** → [UI prototype](#ui-prototype-branch). Generate several radically different UI variations on a single route, switchable via a URL search param and a floating bottom bar.

The two branches produce very different artifacts — getting this wrong wastes the whole prototype. If the question is genuinely ambiguous and the user isn't reachable, default to whichever branch better matches the surrounding code (a backend module → logic; a page or component → UI) and state the assumption at the top of the prototype.

## Rules that apply to both

1. **Throwaway from day one, and clearly marked as such.** Locate the prototype code close to where it will actually be used (next to the module or page it's prototyping for) so context is obvious — but name it so a casual reader can see it's a prototype, not production. For throwaway UI routes, obey whatever routing convention the project already uses; don't invent a new top-level structure.
2. **One command to run.** Whatever the project's existing task runner supports. The user must be able to start it without thinking.
3. **No persistence by default.** State lives in memory. Persistence is the thing the prototype is *checking*, not something it should depend on. If the question explicitly involves a database, hit a scratch DB or a local file with a clear "PROTOTYPE — wipe me" name.
4. **Skip the polish.** No tests, no error handling beyond what makes the prototype *runnable*, no abstractions. The point is to learn something fast and then delete it.
5. **Surface the state.** After every action (logic) or on every variant switch (UI), print or render the full relevant state so the user can see what changed.
6. **Delete or absorb when done.** When the prototype has answered its question, either delete it or fold the validated decision into the real code — don't leave it rotting in the repo.

## When done

The *answer* is the only thing worth keeping from a prototype. Capture it somewhere durable (commit message, ADR in `docs/system/adr/`, issue, or a `NOTES.md` next to the prototype) along with the question it was answering. If the user is around, that capture is a quick conversation; if not, leave the placeholder so they (or you, on the next pass) can fill in the verdict before deleting the prototype.

---

## Logic prototype branch

*(Originally the content of Matt Pocock's `LOGIC.md` — inlined here.)*

A tiny interactive terminal app that lets the user drive a state model by hand. Use this when the question is about **business logic, state transitions, or data shape** — the kind of thing that looks reasonable on paper but only feels wrong once you push it through real cases.

### When this is the right shape

- "I'm not sure if this state machine handles the edge case where X then Y."
- "Does this data model actually let me represent the case where..."
- "I want to feel out what the API should look like before writing it."
- Anything where the user wants to **press buttons and watch state change**.

### Process

**1. State the question.** Before writing code, write down what state model and what question you're prototyping. One paragraph, in the prototype's README or a comment at the top of the file. A logic prototype that answers the wrong question is pure waste.

**2. Pick the language.** Use whatever the host project uses. If the project has no obvious runtime, ask.

**3. Isolate the logic in a portable module.** Put the actual logic behind a small, pure interface that could be lifted into the real codebase later. The TUI around it is throwaway; the logic module shouldn't be.

The right shape depends on the question:
- **A pure reducer** — `(state, action) => state`. Good when actions are discrete events.
- **A state machine** — explicit states and transitions. Good when "which actions are even legal right now" is part of the question.
- **A small set of pure functions** over a plain data type. Good when there's no implicit current state.
- **A class or module with a clear method surface** when the logic genuinely owns ongoing internal state.

Pick whichever shape best fits the question, *not* whichever is easiest to wire to a TUI. Keep it pure: no I/O, no terminal code, no `console.log` for control flow. The TUI imports it and calls into it; nothing flows the other direction.

**4. Build the smallest TUI that exposes the state.** On every tick, clear the screen and re-render the whole frame. The user should always see one stable view, not an ever-growing scrollback.

Each frame has two parts, in this order:
1. **Current state**, pretty-printed and diff-friendly (one field per line, or formatted JSON). Use bold for field names and dim for less important context.
2. **Keyboard shortcuts**, listed at the bottom: `[a] add user  [d] delete user  [t] tick clock  [q] quit`. Bold the key.

Behaviour: initialise state → render → read keystroke → dispatch to handler → re-render → loop until quit. The whole frame should fit on one screen.

**5. Make it runnable in one command.** Add a script to the project's existing task runner. The user should run one command — never need to remember a path.

**6. Hand it over.** Give the user the run command. The interesting moments are when they say "wait, that shouldn't be possible" — those are bugs in the *idea*.

**7. Capture the answer.** When done, the answer to the question is the only thing worth keeping. Capture it in an ADR, issue, or `NOTES.md` before deleting the prototype.

### Anti-patterns

- **Don't add tests.** A prototype that needs tests is no longer a prototype.
- **Don't wire it to the real database.** Use an in-memory store unless the question is specifically about persistence.
- **Don't generalise.** No "what if we wanted to support X later."
- **Don't blur the logic and the TUI together.** If the reducer references `console.log` or terminal escape codes, it's no longer portable.
- **Don't ship the TUI shell into production.** The logic module behind it is the bit worth keeping.

---

## UI prototype branch

*(Originally the content of Matt Pocock's `UI.md` — inlined here.)*

Generate **several radically different UI variations** on a single route, switchable from a floating bottom bar. The user flips between variants in the browser, picks one (or steals bits from each), then throws the rest away.

### When this is the right shape

- "What should this page look like?"
- "I want to see a few options for this dashboard before committing."
- "Try a different layout for the settings screen."

### Two sub-shapes — strongly prefer sub-shape A

**Sub-shape A — adjustment to an existing page (preferred).** The route already exists. Variants are rendered on the same route, gated by a `?variant=` URL search param. The existing data fetching, params, and auth all stay — only the rendering swaps. This is the default.

**Sub-shape B — a new page (last resort).** Only when the thing being prototyped genuinely has no existing page to live inside. Create a throwaway route with `prototype` in the path. Same `?variant=` pattern.

### Process

**1. State the question and pick N.** Default to **3 variants**. More than 5 stops being radically different. Write down the plan in one line.

**2. Generate radically different variants.** Hold each one to:
- The page's purpose and the data it has access to.
- The project's component library / styling system.
- A clear exported component name: `VariantA`, `VariantB`, `VariantC`.

Variants must be **structurally different** — different layout, different information hierarchy, different primary affordance, not just different colours.

**3. Wire them together.** Create a single switcher component on the route:

```tsx
const variant = searchParams.get('variant') ?? 'A';
return (
  <>
    {variant === 'A' && <VariantA {...data} />}
    {variant === 'B' && <VariantB {...data} />}
    {variant === 'C' && <VariantC {...data} />}
    <PrototypeSwitcher variants={['A','B','C']} current={variant} />
  </>
);
```

**4. Build the floating switcher.** A small fixed-position bar at bottom-centre:
- Left arrow — cycles to previous variant (wraps around).
- Variant label — shows current variant key and name.
- Right arrow — cycles forward (wraps around).

Clicking updates the URL search param. Keyboard `←` `→` also cycle (but not when an input is focused). Gate on `process.env.NODE_ENV !== 'production'` so it can't ship to users.

**5. Hand it over.** Surface the URL and variant keys. The interesting feedback is usually "I want the header from B with the sidebar from C."

**6. Capture the answer and clean up.** Write down which variant won and why. Delete losing variants and the switcher. Fold the winner into the existing page (sub-shape A) or promote to a real route (sub-shape B). Don't leave variant components lying around.

### Anti-patterns

- **Variants that differ only in colour or copy.** That's a tweak, not a prototype.
- **Sharing too much code between variants.** A shared `<Header>` is fine; a shared `<Layout>` defeats the point.
- **Wiring variants to real mutations.** Point at a stub — the question is about look, not backend.
- **Promoting the prototype directly to production.** Rewrite properly when you fold it in.

## References

- Canonical docs: follow the harness instructions' repo discovery chain (use repo domain vocabulary for prototype naming)
- Architectural decisions: `docs/system/adr/` (capture prototype answers here)
- Companion skill: `improve-codebase-architecture` (for deeper architecture questions)

## Boundaries

This skill builds throwaway code. The answer is the only thing worth keeping — capture it in an ADR or spec. It does not produce production code or tests. It is user-invoked only.
