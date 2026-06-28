# Skill Catalog Governance

Rules for creating and maintaining skills in this catalog. Every skill must satisfy
these rules before being promoted past `draft` lifecycle state.

## 1. One skill = one coherent job
A skill does exactly one thing. If a skill has two distinct workflows, split it.

## 2. Model-invoked skills must be safe to trigger accidentally
Skills loaded by the model automatically (`loadMode: always` or `on-demand` without
`disable-model-invocation`) must have no side effects (disk writes, network calls,
external process mutations). If a skill has side effects, add
`disable-model-invocation: true` or split into read/write companions.

## 3. Side-effecting skills are user-invoked
Any skill that writes durable state, mutates external systems, downloads binaries,
or runs destructive commands must use `disable-model-invocation: true`.

## 4. Descriptions front-load trigger terms
The `description` field must lead with what the skill DOES and WHEN to use it.
Avoid preamble. Keep under 500 characters. Trigger keywords must appear in the first
80 characters.

## 5. Repo-specific paths require precondition + fallback
Skills must not assume hardcoded paths (e.g., `docs/system/index.md`). If a path
is repo-specific, check for its existence and provide a fallback.

## 6. No duplicate skill names
Skill `name` fields must be unique across the catalog. The validator checks this.
Name must match the parent directory.

## 7. No repeated global doctrine across skills
Do not re-embed baseline instructions (repo discovery, canonical doc chains) in
individual skills. Reference the harness instructions instead.

## 8. Every multi-step skill needs a completion criterion
Skills with workflows must define when the workflow is DONE. Example: "All
implementation-blocking decisions resolved" or "Validator passes with 0 critical."

## 9. Every mutating skill needs approval posture and rollback note
Skills that write or delete must state:
- When user approval is required
- Whether the operation is reversible
- How to validate the result

## 10. Every skill should include trigger tests
Each skill directory should have a `tests/trigger-evals.md` with 3 should-trigger
and 3 should-not-trigger prompts. The shared `TRIGGER-TESTS.md` provides the
canonical set.

## Validation

Run `npm run validate:skills` to check rules 1, 4, 6, and 7 automatically.
Manual review is required for rules 2, 3, 5, 8, 9, and 10.

## Lifecycle States

| State | Meaning |
|---|---|
| `draft` | Under development; may not satisfy all rules |
| `active` | Satisfies all rules; ready for production use |
| `deprecated` | Superseded by another skill; remove from auto-load |
| `retired` | Removed from catalog |

No skill should be promoted to `active` without passing all 10 governance rules.
