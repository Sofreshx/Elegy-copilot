## Spec-Driven Development

This repo opts into elegy-copilot spec-driven development for non-trivial work.

- Use `spec-dev` when a task needs spec-first clarification, a durable repo spec, or a narrow spec-as-source flow.
- Durable specs live under `docs/specs/<spec-slug>/spec.md`; keep `docs/specs/index.md` current as durable specs accumulate.
- Use `spec-authoring` to create or refine durable specs and `spec-review` before implementation planning when the spec will drive the work.
- Narrow candidate constraints to the minimum hard constraints needed for the active step instead of copying full plan or policy blocks forward.
- Use ADRs only for key architectural, workflow-authority, trust-boundary, or long-lived contract decisions; do not create ADRs for ordinary local implementation choices.
- Validate specs with `node scripts/validate-specs.js` or `npm run validate:specs` when the repo exposes that script.
