---
name: concise-writing
description: "Audit and enforce concise, precise, fluff-free writing across docs, skills, agents, and prompts. Bans filler phrases, enforces word budgets, and validates vocabulary precision. Triggers on: concise writing, fluff audit, word budget, writing standards, tighten prose, documentation cleanup."
tags: [documentation, writing, quality, audit, style]
---

# Concise Writing

## Purpose

Audit prose for fluff, vagueness, and word waste. Enforce a minimal-word standard.

## When to apply

Use before publishing docs, skills, agents, or prompts. Also use to audit existing content.

## Rules

### Word budget

| Element | Max |
|---|---|
| Sentence | 25 words |
| Paragraph | 4 sentences |
| Section intro | 3 lines |

### Banned phrases

Delete these on sight. Replace with direct statements.

| Ban | Replace with |
|---|---|
| "it is important to note that" | Delete — whatever follows is the point |
| "as you can see" | Delete |
| "in order to" | "to" |
| "please note that" | Delete |
| "it should be noted that" | Delete |
| "due to the fact that" | "because" |
| "at this point in time" | "now" |
| "in the event that" | "if" |
| "a number of" | "several" or exact count |
| "is able to" | "can" |
| "has the capability to" | "can" |
| "utilize" | "use" |
| "facilitate" (when meaning "help") | "help" or the specific action |
| "leverage" | "use" |
| "on a daily basis" | "daily" |
| "with the exception of" | "except" |

### Vocabulary precision

| Rule | Example violation | Fix |
|---|---|---|
| Use exact domain terms | "the lane agent system in OpenCode" | "OpenCode lane agents" |
| Avoid synonym dilution | Using "framework", "system", "tool", "platform" for the same thing | Pick one term and stick to it |
| Quantify when possible | "several files were changed" | "4 files changed" |
| State ownership explicitly | "the config gets updated" | "OpenCode writes to opencode.jsonc" |
| Prefer active voice | "errors are shown to the user" | "the UI displays errors" |

### Structural rules

- Every section answers what, why, when in the first 3 lines.
- Tables over paragraphs for rules and mappings.
- Bullet lists over prose for checklists and steps.
- One concept per paragraph.
- Skip sections that would be empty. Do not pad.

### Audit mode

When auditing existing content, flag every:
1. Banned phrase
2. Sentence over 25 words
3. Paragraph over 4 sentences
4. Vague term without domain specificity
5. Passive construction that hides the actor
6. Duplicate term (same concept, different word)

Produce a report:

```
CONCISE_AUDIT
- file: <path>
- banned_phrases: <count>
- long_sentences: <count>
- vague_terms: <count>
- passive_voice: <count>
- term_duplication: <list of concept → [terms used]>
- score: <fluff-free % based on total violations / total sentences>
```

## Output contract

After applying this skill, report:
- Files changed
- Violation counts before and after
- Any intentional exceptions (with justification)

Never silently skip violations. If a rule must be broken, state why in the report.
