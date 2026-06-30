---
name: brainstorming
description: "Collaborative design dialogue that turns ideas into specs through structured exploration. Use when a feature, system, or architecture needs design before implementation — explore context, clarify requirements, propose approaches, and write a spec. Triggers on: brainstorm, design doc, explore ideas, propose approach, think through, spec out, design exploration, explore approaches."
disable-model-invocation: true
---

# Brainstorming

Turn ideas into fully formed designs and specs through natural collaborative dialogue.

Start by understanding the current project context, then ask questions one at a time to refine the idea. Once you understand what you're building, present the design and get user approval.

## HARD-GATE

Do NOT invoke any implementation skill, write any code, scaffold any project, or take any implementation action until you have presented a design and the user has approved it. This applies to EVERY project regardless of perceived simplicity.

## Anti-Pattern: "This Is Too Simple To Need A Design"

Every project goes through this process. A todo list, a single-function utility, a config change — all of them. "Simple" projects are where unexamined assumptions cause the most wasted work. The design can be short (a few sentences for truly simple projects), but you MUST present it and get approval.

## Checklist

You MUST create a task for each of these items and complete them in order:

1. Explore project context — check files, docs, recent commits
2. Offer visual companion (if topic will involve visual questions) — own message, not combined with a clarifying question
3. Ask clarifying questions — one at a time, understand purpose/constraints/success criteria
4. Propose 2-3 approaches — with trade-offs and your recommendation
5. Present design — in sections scaled to their complexity, get user approval after each section
6. Write design doc — save to `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`
7. Spec self-review — check for placeholders, contradictions, ambiguity, scope
8. User reviews written spec — ask user to review before proceeding
9. Transition to implementation — invoke writing-plans skill to create implementation plan

## Process Flow

```text
digraph brainstorming {
    "Explore project context" [shape=box];
    "Visual questions ahead?" [shape=diamond];
    "Offer Visual Companion\n(own message, no other content)" [shape=box];
    "Ask clarifying questions" [shape=box];
    "Propose 2-3 approaches" [shape=box];
    "Present design sections" [shape=box];
    "User approves design?" [shape=diamond];
    "Write design doc" [shape=box];
    "Spec self-review\n(fix inline)" [shape=box];
    "User reviews spec?" [shape=diamond];
    "Invoke writing-plans skill" [shape=doublecircle];

    "Explore project context" -> "Visual questions ahead?";
    "Visual questions ahead?" -> "Offer Visual Companion\n(own message, no other content)" [label="yes"];
    "Visual questions ahead?" -> "Ask clarifying questions" [label="no"];
    "Offer Visual Companion\n(own message, no other content)" -> "Ask clarifying questions";
    "Ask clarifying questions" -> "Propose 2-3 approaches";
    "Propose 2-3 approaches" -> "Present design sections";
    "Present design sections" -> "User approves design?";
    "User approves design?" -> "Present design sections" [label="no, revise"];
    "User approves design?" -> "Write design doc" [label="yes"];
    "Write design doc" -> "Spec self-review\n(fix inline)";
    "Spec self-review\n(fix inline)" -> "User reviews spec?";
    "User reviews spec?" -> "Write design doc" [label="changes requested"];
    "User reviews spec?" -> "Invoke writing-plans skill" [label="approved"];
}
```

The terminal state is invoking writing-plans. Do NOT invoke frontend-design, mcp-builder, or any other implementation skill. The ONLY skill you invoke after brainstorming is writing-plans.

## The Process

### Understanding the Idea

1. Check out the current project state first (files, docs, recent commits).
2. Before asking detailed questions, assess scope: if the request describes multiple independent subsystems (e.g., "build a platform with chat, file storage, billing, and analytics"), flag this immediately. Don't spend questions refining details of a project that needs to be decomposed first.
3. If the project is too large for a single spec, help the user decompose into sub-projects: what are the independent pieces, how do they relate, what order should they be built? Then brainstorm the first sub-project through the normal design flow. Each sub-project gets its own spec → plan → implementation cycle.
4. For appropriately-scoped projects, ask questions one at a time to refine the idea.
5. Prefer multiple choice questions when possible, but open-ended is fine too.
6. Only one question per message — if a topic needs more exploration, break it into multiple questions.
7. Focus on understanding: purpose, constraints, success criteria.

### Exploring Approaches

1. Propose 2-3 different approaches with trade-offs.
2. Present options conversationally with your recommendation and reasoning.
3. Lead with your recommended option and explain why.

### Presenting the Design

1. Once you believe you understand what you're building, present the design.
2. Scale each section to its complexity: a few sentences if straightforward, up to 200-300 words if nuanced.
3. Ask after each section whether it looks right so far.
4. Cover: architecture, components, data flow, error handling, testing.
5. Be ready to go back and clarify if something doesn't make sense.

### Design for Isolation and Clarity

Break the system into smaller units that each have one clear purpose, communicate through well-defined interfaces, and can be understood and tested independently.

For each unit, you should be able to answer: what does it do, how do you use it, and what does it depend on?

Can someone understand what a unit does without reading its internals? Can you change the internals without breaking consumers? If not, the boundaries need work.

Smaller, well-bounded units are also easier for you to reason about — you can hold more in context at once, and edits are more reliable when files are focused. When a file grows large, that's often a signal that it's doing too much.

### Working in Existing Codebases

Explore the current structure before proposing changes. Follow existing patterns.

Where existing code has problems that affect the work (e.g., a file that's grown too large, unclear boundaries, tangled responsibilities), include targeted improvements as part of the design — the way a good developer improves code they're working in.

Don't propose unrelated refactoring. Stay focused on what serves the current goal.

## After the Design

### Documentation

Write the validated design (spec) to `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`. User preferences for spec location override this default.

Commit the design document to git.

### Spec Self-Review

After writing the spec document, look at it with fresh eyes:

- **Placeholder scan**: Any "TBD", "TODO", incomplete sections, or vague requirements? Fix them.
- **Internal consistency**: Do any sections contradict each other? Does the architecture match the feature descriptions?
- **Scope check**: Is this focused enough for a single implementation plan, or does it need decomposition?
- **Ambiguity check**: Could any requirement be interpreted two different ways? If so, pick one and make it explicit.

Fix any issues inline. No need to re-review — just fix and move on.

### User Review Gate

After the spec review loop passes, ask the user to review the written spec before proceeding:

> "Spec written and committed to `<path>`. Please review it and let me know if you want to make any changes before we start writing out the implementation plan."

Wait for the user's response. If they request changes, make them and re-run the spec review loop. Only proceed once the user approves.

### Implementation

Invoke the writing-plans skill to create a detailed implementation plan. Do NOT invoke any other skill. writing-plans is the next step.

## Key Principles

- One question at a time — don't overwhelm with multiple questions
- Multiple choice preferred — easier to answer than open-ended when possible
- YAGNI ruthlessly — remove unnecessary features from all designs
- Explore alternatives — always propose 2-3 approaches before settling
- Incremental validation — present design, get approval before moving on
- Be flexible — go back and clarify when something doesn't make sense

## Visual Companion

A browser-based companion for showing mockups, diagrams, and visual options during brainstorming. Available as a tool — not a mode. Accepting the companion means it's available for questions that benefit from visual treatment; it does NOT mean every question goes through the browser.

### Offering the Companion

When you anticipate that upcoming questions will involve visual content (mockups, layouts, diagrams), offer it once for consent:

> "Some of what we're working on might be easier to explain if I can show it to you in a web browser. I can put together mockups, diagrams, comparisons, and other visuals as we go. This feature is still new and can be token-intensive. Want to try it? (Requires opening a local URL)"

This offer MUST be its own message. Do not combine it with clarifying questions, context summaries, or any other content. The message should contain ONLY the offer above and nothing else. Wait for the user's response before continuing. If they decline, proceed with text-only brainstorming.

### Per-Question Decision

Even after the user accepts, decide FOR EACH QUESTION whether to use the browser or the terminal. The test: would the user understand this better by seeing it than reading it?

- Use the browser for content that IS visual — mockups, wireframes, layout comparisons, architecture diagrams, side-by-side visual designs
- Use the terminal for content that is text — requirements questions, conceptual choices, tradeoff lists, A/B/C/D text options, scope decisions

A question about a UI topic is not automatically a visual question. "What does personality mean in this context?" is a conceptual question — use the terminal. "Which wizard layout works better?" is a visual question — use the browser.

## Boundaries

This skill is for design exploration and specification only. It does NOT implement code, run tests, or deploy. After the spec is approved and reviewed, delegate implementation to the writing-plans skill.
