---
name: writing-great-skills
description: "Design predictable agent skills using vocabulary, information hierarchy, leading words, and pruning principles. Use when designing or refining agent skills, diagnosing skill failure modes, or evaluating skill quality."
disable-model-invocation: true
license: Apache-2.0
metadata: {"source":"https://github.com/mattpocock/skills","adapted":true,"originalName":"writing-great-skills","notes":"GLOSSARY.md ref removed, terms inlined"}
---

A skill should make the agent choose the same process for the same kind of task. Every rule below supports that goal.

## Invocation

Use one invocation mode:

- A **model-invoked** skill keeps a **description**, so the agent can load it automatically and other skills can route to it. Mechanics: omit `disable-model-invocation`, and write a model-facing description with clear trigger phrasing.
- A **user-invoked** skill is loaded only when the user names it. Mechanics: set `disable-model-invocation: true`; keep the `description` human-facing and short.

Pick model-invocation only when the agent must reach the skill on its own, or another skill must. If it only ever fires by hand, make it user-invoked and pay no context load.

When user-invoked skills become hard to remember, add a **router skill**: one user-invoked skill that names the others and when to use each.

## Writing the description

A model-invoked **description** does two jobs — state what the skill is, and list the **branches** that should trigger it. Every word increases **context load**, so a description earns even harder pruning than the body:

- **Front-load the skill's leading word** — the description is where it does its invocation work.
- **One trigger per branch.** Synonyms that rename a single branch are **duplication** — "build features using TDD … asks for test-first development" is one branch written twice. Collapse them; keep only genuinely distinct branches.
- **Cut identity that's already in the body.** Keep the description to triggers, plus any "when another skill needs…" reach clause.

## Information hierarchy

A skill is built from two content types — **steps** and **reference** — that mix freely: a skill can be all steps, all reference, or both. The core decision is which to use and where each sits on the **information hierarchy**, a ladder ranked by how immediately the agent needs the material:

1. **In-skill step** — an ordered action in `SKILL.md`, the primary tier: what the agent does, in order. Each step ends on a **completion criterion**, the condition that tells the agent the work is done. Make it *checkable* (can the agent tell done from not-done?) and, where it matters, *exhaustive* ("every modified model accounted for", not "produce a change list") — a vague criterion invites **premature completion**.
2. **In-skill reference** — a definition, rule, or fact in `SKILL.md`, consulted on demand. Often a legitimately flat peer-set (every rule of a review on one rung) — a fine arrangement, not a smell. *This skill is all reference.*
3. **External reference** — reference pushed out of `SKILL.md` into a separate file, reached by a **context pointer**, loaded only when the pointer fires. (Spans *disclosed* reference — a sibling file, still part of the skill — through fully **external reference** that lives outside the skill system and any skill can point at.)

A demanding completion criterion drives thorough **legwork** — the digging the agent does within the work — whether the skill has steps or not, since "every rule applied" binds flat reference just as "every step done" binds a sequence.

Push too little down and the top bloats; push too much and you hide material the agent actually needs. That tension is the whole decision.

**Progressive disclosure** is the move down the ladder — out of `SKILL.md` into a linked file — so the top stays legible. Mechanics: a linked `.md` file in the skill folder, named for what it holds. Some skills are used in more than one way, and each distinct way is a **branch** — different runs taking different paths through the skill. Branching is the cleanest disclosure test: inline what every branch needs, and push behind a pointer what only some branches reach. A **context pointer**'s *wording*, not its target, decides when and how reliably the agent reaches the material.

Where the ladder decides *how far down* a piece sits, **co-location** decides *what sits beside it* once there: keep a concept's definition, rules, and caveats under one heading rather than scattered, so reading one part brings its neighbours with it.

## When to split

**Granularity** is how finely you divide skills, and each cut spends one of the two loads, so split only when the cut earns it. Two cuts:

- **By invocation** — split off a **model-invoked** skill when you have a distinct **leading word** that should trigger it on its own, or another skill must reach it. You pay **context load** for the new always-loaded **description**, so that independent reach has to be worth it.
- **By sequence** — split a run of **steps** when the steps still ahead (a step's **post-completion steps**) tempt the agent to rush the one in front of it (**premature completion**). Keeping them out of view encourages the agent to do more **legwork** on the current task.

## Pruning

Keep each meaning in a **single source of truth**: one authoritative place, so changing the behaviour is a one-place edit.

Check every line for **relevance**: does it still bear on what the skill does?

Then hunt **no-ops** sentence by sentence, not just line by line: run the no-op test on each sentence in isolation, and when one fails, delete the whole sentence rather than trim words from it. Be aggressive — most prose that fails should go, not be rewritten.

## Stable terms

A **stable term** is a short named concept used consistently across a skill, prompt, and related docs.

It helps in two places. In the body, it names the behavior the agent should repeat. In the description, it gives routing language that can match user prompts and related docs.

Look for repeated phrases that should become one stable term. Examples:

- "fast, deterministic, low-overhead" -> *tight* — one named quality reused across a phase.
- "a loop you believe in" → *red* — converts a fuzzy gate into a binary observable state (the loop goes *red* on the bug, or it doesn't).

Use stable terms only when they remove repeated wording or make a decision point clearer.

## Failure modes

Use these to diagnose issues the user may be having with the skill.

- **Premature completion** — ending a step before it's genuinely done, attention slipping to *being done*. Defence, in order: sharpen the completion criterion first (cheap, local); only if it is irreducibly fuzzy *and* you observe the rush, hide the post-completion steps by splitting (the sequence cut).
- **Duplication** — the same meaning in more than one place. Costs maintenance and tokens, and inflates a meaning's prominence on the ladder past its real rank.
- **Sediment** — stale layers that settle because adding feels safe and removing feels risky. The default fate of any skill without a pruning discipline.
- **Sprawl** — a skill simply too long, even when every line is live and unique. Hurts readability and maintainability and wastes tokens. The cure is the ladder: disclose **reference** behind pointers, and split by **branch** or sequence so each path carries only what it needs.
- **No-op** — a line the model already obeys by default, so you pay load to say nothing. The test: does it change behaviour versus the default? A weak leading word (*be thorough* when the agent is already thorough-ish) is a no-op; the fix is a stronger word (*relentless*), not a different technique.

## References

- [Agent Skills Open Standard](https://agentskills.io/specification) — format specification
- [Skill Best Practices](https://agentskills.io/skill-creation/best-practices) — creation guidance
- Companion skill: `skill-authoring` — format compliance and directory layout conventions

## Boundaries

This skill is about skill **design quality** — predictability, information hierarchy, leading words, failure modes. It is not about skill **format compliance**. For format rules, frontmatter conventions, and directory layout, use `skill-authoring`. It is user-invoked only — the agent cannot load it autonomously.
